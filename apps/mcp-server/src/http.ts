import { randomUUID, timingSafeEqual } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import type { PermissionMode } from "@materialpilot/domain";
import type { MaterialBackend } from "./backend.js";
import { createMaterialPilotServer } from "./server.js";

function tokenMatches(received: string | undefined, expected: string): boolean {
  if (!received?.startsWith("Bearer ")) return false;
  const value = Buffer.from(received.slice(7));
  const target = Buffer.from(expected);
  return value.length === target.length && timingSafeEqual(value, target);
}

export async function startHttpServer(options: {
  port: number;
  token: string;
  backend: MaterialBackend;
  permissionMode: PermissionMode;
}): Promise<{ close(): Promise<void> }> {
  if (options.token.length < 32)
    throw new Error("MATERIALPILOT_HTTP_TOKEN must contain at least 32 characters.");
  const app = createMcpExpressApp({ host: "127.0.0.1" });
  const transports = new Map<string, StreamableHTTPServerTransport>();
  app.use("/mcp", (request, response, next) => {
    if (!tokenMatches(request.headers.authorization, options.token)) {
      response.status(401).json({ error: "Bearer authentication required" });
      return;
    }
    next();
  });
  app.post("/mcp", async (request, response) => {
    try {
      const sessionId = request.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport && !sessionId && isInitializeRequest(request.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          }
        });
        transport.onclose = () => {
          if (transport?.sessionId) transports.delete(transport.sessionId);
        };
        const { server } = createMaterialPilotServer({
          backend: options.backend,
          permissionMode: options.permissionMode
        });
        await server.connect(transport as never);
      }
      if (!transport) {
        response.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32_000, message: "Missing or invalid MCP session" },
          id: null
        });
        return;
      }
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      process.stderr.write(
        `MaterialPilot HTTP request failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
      if (!response.headersSent) response.status(500).json({ error: "Internal server error" });
    }
  });
  const streamHandler = async (request: Request, response: Response) => {
    const id = request.headers["mcp-session-id"] as string | undefined;
    const transport = id ? transports.get(id) : undefined;
    if (!transport) {
      response.status(400).send("Invalid or missing MCP session");
      return;
    }
    await transport.handleRequest(request, response);
  };
  app.get("/mcp", streamHandler);
  app.delete("/mcp", streamHandler);
  const listener = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const candidate = app.listen(options.port, "127.0.0.1", () => resolve(candidate));
    candidate.once("error", reject);
  });
  return {
    async close() {
      await Promise.all([...transports.values()].map((transport) => transport.close()));
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve()))
      );
    }
  };
}
