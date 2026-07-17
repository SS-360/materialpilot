import { z } from "zod";
import { capabilityManifestSchema } from "@materialpilot/domain";

export const bridgeProtocolVersion = "1.0" as const;

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string().min(1),
  params: z.unknown().optional()
});
export const jsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1),
  params: z.unknown().optional()
});
export const jsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional()
});
export const jsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: jsonRpcErrorSchema.optional()
});

export const bridgeInitializeParamsSchema = z.object({
  protocolVersion: z.literal(bridgeProtocolVersion),
  client: z.object({ name: z.string(), version: z.string() }),
  token: z.string().min(32),
  requestedCapabilities: z.array(z.string()),
  nonce: z.string().min(16)
});
export const bridgeInitializeResultSchema = capabilityManifestSchema.extend({
  instanceId: z.string(),
  nonce: z.string()
});

export const requestMetadataSchema = z.object({
  requestId: z.string(),
  idempotencyKey: z.string().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  actor: z.object({ type: z.literal("mcp-agent"), sessionId: z.string() }),
  approvalToken: z.string().optional()
});

export const runtimeEndpointSchema = z.object({
  url: z.string().url(),
  token: z.string().min(32),
  instanceId: z.string(),
  pid: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().optional()
});

export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;
export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>;
export type BridgeInitializeResult = z.infer<typeof bridgeInitializeResultSchema>;
export type RuntimeEndpoint = z.infer<typeof runtimeEndpointSchema>;
