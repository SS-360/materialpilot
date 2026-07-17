import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { BridgeClient, bridgeProtocolVersion, type RuntimeEndpoint } from "../src/index.js";

const servers: WebSocketServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe("BridgeClient", () => {
  it("performs an authenticated nonce handshake and requests data", async () => {
    const token = randomBytes(32).toString("hex");
    const instanceId = "mmi_test";
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    server.on("connection", (socket) => {
      socket.on("message", (data) => {
        const request = JSON.parse(data.toString());
        if (request.method === "bridge.initialize") {
          expect(request.params.token).toBe(token);
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result: {
                protocolVersion: bridgeProtocolVersion,
                bridgeVersion: "0.1.0",
                instanceId,
                nonce: request.params.nonce,
                materialMakerVersion: "1.7",
                godotVersion: "4.7",
                projectTypes: ["material", "painting"],
                features: { "graph.read": true },
                limits: {
                  maxPatchOperations: 500,
                  maxPayloadBytes: 8388608,
                  maxConcurrentJobs: 2,
                  maxPreviewResolution: 4096
                }
              }
            })
          );
        } else {
          socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { pong: true } }));
        }
      });
    });
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("Expected TCP address");
    const endpoint: RuntimeEndpoint = {
      url: `ws://127.0.0.1:${address.port}`,
      token,
      instanceId,
      pid: process.pid,
      createdAt: new Date().toISOString()
    };
    const { client, capabilities } = await BridgeClient.connect(endpoint);
    expect(client.connected).toBe(true);
    expect(capabilities.materialMakerVersion).toBe("1.7");
    await expect(client.request("app.ping")).resolves.toEqual({ pong: true });
    client.close();
  });
});
