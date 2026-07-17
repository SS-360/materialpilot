import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import WebSocket from "ws";
import { MaterialPilotError } from "@materialpilot/domain";
import {
  bridgeInitializeResultSchema,
  bridgeProtocolVersion,
  jsonRpcNotificationSchema,
  jsonRpcResponseSchema,
  runtimeEndpointSchema,
  type BridgeInitializeResult,
  type RuntimeEndpoint
} from "./schemas.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

function requireLoopback(urlString: string): URL {
  const url = new URL(urlString);
  if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new MaterialPilotError(
      "BRIDGE_NOT_AUTHENTICATED",
      "The native bridge endpoint must use loopback WebSocket."
    );
  }
  return url;
}

export async function readRuntimeEndpoint(path: string): Promise<RuntimeEndpoint> {
  const endpoint = runtimeEndpointSchema.parse(JSON.parse(await readFile(path, "utf8")));
  requireLoopback(endpoint.url);
  if (endpoint.expiresAt && Date.parse(endpoint.expiresAt) <= Date.now()) {
    throw new MaterialPilotError(
      "APPLICATION_NOT_RUNNING",
      "The native bridge endpoint record has expired."
    );
  }
  return endpoint;
}

export class BridgeClient extends EventEmitter {
  readonly #endpoint: RuntimeEndpoint;
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #initialized = false;

  private constructor(endpoint: RuntimeEndpoint, socket: WebSocket) {
    super();
    this.#endpoint = endpoint;
    this.#socket = socket;
    socket.on("message", (data) => this.#onMessage(data.toString()));
    socket.on("close", () => {
      this.#initialized = false;
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(
          new MaterialPilotError("APPLICATION_NOT_RUNNING", "Native bridge disconnected.", {
            retryable: true
          })
        );
      }
      this.#pending.clear();
      this.emit("disconnected");
    });
    socket.on("error", (error) => this.emit("error", error));
  }

  static async connect(
    endpoint: RuntimeEndpoint,
    options: { timeoutMs?: number; requestedCapabilities?: string[] } = {}
  ): Promise<{ client: BridgeClient; capabilities: BridgeInitializeResult }> {
    requireLoopback(endpoint.url);
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const candidate = new WebSocket(endpoint.url, { maxPayload: 8 * 1024 * 1024 });
      const timer = setTimeout(() => {
        candidate.terminate();
        reject(
          new MaterialPilotError("TIMEOUT", "Timed out connecting to the native bridge.", {
            retryable: true
          })
        );
      }, options.timeoutMs ?? 5000);
      candidate.once("open", () => {
        clearTimeout(timer);
        resolve(candidate);
      });
      candidate.once("error", (error) => {
        clearTimeout(timer);
        reject(
          new MaterialPilotError(
            "APPLICATION_NOT_RUNNING",
            "Could not connect to the native bridge.",
            { cause: error }
          )
        );
      });
    });
    const client = new BridgeClient(endpoint, socket);
    const nonce = randomBytes(24).toString("hex");
    const result = bridgeInitializeResultSchema.parse(
      await client.request(
        "bridge.initialize",
        {
          protocolVersion: bridgeProtocolVersion,
          client: { name: "materialpilot-mcp", version: "0.1.0" },
          token: endpoint.token,
          requestedCapabilities: options.requestedCapabilities ?? [
            "application.read",
            "project.read",
            "graph.read"
          ],
          nonce
        },
        options.timeoutMs
      )
    );
    if (result.nonce !== nonce || result.instanceId !== endpoint.instanceId) {
      socket.terminate();
      throw new MaterialPilotError(
        "BRIDGE_NOT_AUTHENTICATED",
        "Native bridge handshake identity check failed."
      );
    }
    client.#initialized = true;
    return { client, capabilities: result };
  }

  static async connectFromRuntimeFile(path: string, options: { timeoutMs?: number } = {}) {
    return BridgeClient.connect(await readRuntimeEndpoint(path), options);
  }

  get connected(): boolean {
    return this.#initialized && this.#socket.readyState === WebSocket.OPEN;
  }

  get instanceId(): string {
    return this.#endpoint.instanceId;
  }

  async request(method: string, params?: unknown, timeoutMs = 5000): Promise<unknown> {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      throw new MaterialPilotError("APPLICATION_NOT_RUNNING", "Native bridge is not connected.", {
        retryable: true
      });
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new MaterialPilotError("TIMEOUT", `Bridge request ${method} timed out.`, {
            retryable: true
          })
        );
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#socket.send(
        JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })
      );
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.#socket.readyState !== WebSocket.OPEN) return;
    this.#socket.send(
      JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })
    );
  }

  close(): void {
    this.#socket.close(1000, "MaterialPilot client closed");
  }

  #onMessage(message: string): void {
    let value: unknown;
    try {
      value = JSON.parse(message);
    } catch {
      this.emit(
        "protocolError",
        new MaterialPilotError("INVALID_REQUEST", "Bridge returned invalid JSON.")
      );
      return;
    }
    const response = jsonRpcResponseSchema.safeParse(value);
    if (response.success) {
      const pending = this.#pending.get(Number(response.data.id));
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pending.delete(Number(response.data.id));
      if (response.data.error) {
        pending.reject(
          new MaterialPilotError("INTERNAL_ERROR", response.data.error.message, {
            cause: response.data.error.data
          })
        );
      } else {
        pending.resolve(response.data.result);
      }
      return;
    }
    const notification = jsonRpcNotificationSchema.safeParse(value);
    if (notification.success) this.emit(notification.data.method, notification.data.params);
  }
}
