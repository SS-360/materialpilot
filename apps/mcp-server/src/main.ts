#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BridgeClient } from "@materialpilot/bridge-protocol";
import type { PermissionMode } from "@materialpilot/domain";
import { InMemoryBackend, NativeBackend, type MaterialBackend } from "./backend.js";
import { startHttpServer } from "./http.js";
import { createMaterialPilotServer } from "./server.js";

function permissionMode(): PermissionMode {
  const value = process.env.MATERIALPILOT_PERMISSION_MODE ?? "assisted";
  if (!["observe", "assisted", "workspace-autonomous", "developer"].includes(value)) {
    throw new Error(`Invalid MATERIALPILOT_PERMISSION_MODE: ${value}`);
  }
  return value as PermissionMode;
}

async function main(): Promise<void> {
  const mode = permissionMode();
  const backend = await selectBackend(mode);
  const httpPort = process.env.MATERIALPILOT_HTTP_PORT;
  if (httpPort) {
    const token = process.env.MATERIALPILOT_HTTP_TOKEN;
    if (!token) throw new Error("MATERIALPILOT_HTTP_TOKEN is required for Streamable HTTP mode.");
    const http = await startHttpServer({
      port: Number(httpPort),
      token,
      backend,
      permissionMode: mode
    });
    process.stderr.write(`MaterialPilot MCP listening on http://127.0.0.1:${httpPort}/mcp\n`);
    const shutdown = async () => {
      await http.close();
      process.exitCode = 0;
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }
  const { server } = createMaterialPilotServer({ backend, permissionMode: mode });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("MaterialPilot MCP connected over STDIO\n");
}

async function selectBackend(mode: PermissionMode): Promise<MaterialBackend> {
  if (process.env.MATERIALPILOT_OFFLINE === "1")
    return new InMemoryBackend({ permissionMode: mode });
  const runtimeFile =
    process.env.MATERIALPILOT_RUNTIME_FILE ?? join(homedir(), ".materialpilot", "bridge.json");
  if (!existsSync(runtimeFile)) {
    process.stderr.write(
      "MaterialPilot native bridge was not discovered; offline graph mode is active.\n"
    );
    return new InMemoryBackend({ permissionMode: mode });
  }
  try {
    const { client, capabilities } = await BridgeClient.connectFromRuntimeFile(runtimeFile);
    process.stderr.write(
      `MaterialPilot connected to native instance ${capabilities.instanceId}.\n`
    );
    return new NativeBackend(client, capabilities, mode);
  } catch (error) {
    process.stderr.write(
      `MaterialPilot native bridge connection failed; offline graph mode is active: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return new InMemoryBackend({ permissionMode: mode });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `MaterialPilot MCP failed: ${error instanceof Error ? error.stack : String(error)}\n`
  );
  process.exitCode = 1;
});
