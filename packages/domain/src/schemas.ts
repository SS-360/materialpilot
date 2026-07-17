import { z } from "zod";

export const projectTypeSchema = z.enum(["material", "painting"]);
export const permissionModeSchema = z.enum([
  "observe",
  "assisted",
  "workspace-autonomous",
  "developer"
]);

export const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const sizeSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive()
});

export const colorSchema = z.object({
  kind: z.literal("color"),
  r: z.number().finite(),
  g: z.number().finite(),
  b: z.number().finite(),
  a: z.number().finite()
});
export const vector2Schema = z.object({
  kind: z.literal("vector2"),
  x: z.number().finite(),
  y: z.number().finite()
});
export const vector3Schema = z.object({
  kind: z.literal("vector3"),
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite()
});
export const gradientSchema = z.object({
  kind: z.literal("gradient"),
  stops: z.array(
    z.object({
      offset: z.number().finite().min(0).max(1),
      color: colorSchema
    })
  )
});
export const curveSchema = z.object({
  kind: z.literal("curve"),
  points: z.array(
    z.object({
      x: z.number().finite(),
      y: z.number().finite(),
      leftTangent: z.number().finite().optional(),
      rightTangent: z.number().finite().optional()
    })
  )
});
export const expressionSchema = z.object({ kind: z.literal("expression"), source: z.string() });
export const parameterValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  colorSchema,
  vector2Schema,
  vector3Schema,
  gradientSchema,
  curveSchema,
  expressionSchema,
  z.null()
]);

export const portDataTypeSchema = z.enum([
  "grayscale",
  "color",
  "rgba",
  "sdf2d",
  "sdf3d",
  "sdf3d_color",
  "material",
  "boolean",
  "number",
  "vector2",
  "vector3",
  "unknown"
]);

export const portSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  direction: z.enum(["input", "output"]),
  index: z.number().int().nonnegative(),
  name: z.string().min(1),
  dataType: portDataTypeSchema,
  required: z.boolean(),
  variadic: z.boolean().optional(),
  connected: z.boolean()
});

export const graphNodeSchema = z.object({
  id: z.string().min(1),
  nativeId: z.string().min(1),
  typeId: z.string().min(1),
  displayName: z.string().min(1),
  position: positionSchema,
  size: sizeSchema.optional(),
  minimized: z.boolean(),
  disabled: z.boolean().optional(),
  seed: z.number().int().optional(),
  inputs: z.array(portSchema),
  outputs: z.array(portSchema),
  parameters: z.record(z.string(), parameterValueSchema),
  metadata: z.record(z.string(), z.unknown())
});

export const connectionSchema = z.object({
  id: z.string().min(1),
  fromNodeId: z.string().min(1),
  fromPortId: z.string().min(1),
  toNodeId: z.string().min(1),
  toPortId: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const selectionSchema = z.object({
  nodeIds: z.array(z.string()),
  focusedNodeId: z.string().nullable().default(null)
});

export const graphSnapshotSchema = z.object({
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  graphId: z.string().min(1),
  name: z.string().min(1),
  nodes: z.array(graphNodeSchema),
  connections: z.array(connectionSchema),
  selection: selectionSchema,
  outputNodeIds: z.array(z.string()),
  unresolvedReferences: z.array(z.string()),
  catalogVersion: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/i)
});

export const projectSchema = z.object({
  id: z.string().min(1),
  type: projectTypeSchema,
  name: z.string().min(1),
  path: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  dirty: z.boolean(),
  active: z.boolean(),
  graphIds: z.array(z.string()),
  createdAt: z.iso.datetime().optional(),
  modifiedAt: z.iso.datetime().optional(),
  compatibility: z.object({
    materialMakerVersion: z.string(),
    schemaVersion: z.string().optional()
  })
});

const nodeCreateOperationSchema = z.object({
  type: z.literal("node.create"),
  tempId: z.string().optional(),
  nodeTypeId: z.string().min(1),
  position: positionSchema,
  displayName: z.string().optional(),
  parameters: z.record(z.string(), parameterValueSchema).optional()
});
const nodeDeleteOperationSchema = z.object({
  type: z.literal("node.delete"),
  nodeId: z.string(),
  cascade: z.enum(["reject", "disconnect"]).default("reject")
});
const nodeMoveOperationSchema = z.object({
  type: z.literal("node.move"),
  nodeId: z.string(),
  position: positionSchema
});
const nodeRenameOperationSchema = z.object({
  type: z.literal("node.rename"),
  nodeId: z.string(),
  displayName: z.string().min(1)
});
const nodeSetParameterOperationSchema = z.object({
  type: z.literal("node.set_parameter"),
  nodeId: z.string(),
  parameter: z.string().min(1),
  value: parameterValueSchema
});
const connectionCreateOperationSchema = z.object({
  type: z.literal("connection.create"),
  tempId: z.string().optional(),
  fromNodeId: z.string(),
  fromPort: z.union([z.string(), z.number().int().nonnegative()]),
  toNodeId: z.string(),
  toPort: z.union([z.string(), z.number().int().nonnegative()])
});
const connectionDeleteOperationSchema = z.object({
  type: z.literal("connection.delete"),
  connectionId: z.string()
});
const selectionSetOperationSchema = z.object({
  type: z.literal("selection.set"),
  nodeIds: z.array(z.string()),
  focusedNodeId: z.string().nullable().optional()
});

export const graphOperationSchema = z.discriminatedUnion("type", [
  nodeCreateOperationSchema,
  nodeDeleteOperationSchema,
  nodeMoveOperationSchema,
  nodeRenameOperationSchema,
  nodeSetParameterOperationSchema,
  connectionCreateOperationSchema,
  connectionDeleteOperationSchema,
  selectionSetOperationSchema
]);

export const validationProfileSchema = z.enum([
  "none",
  "structural",
  "standard",
  "strict",
  "release"
]);
export const graphPatchSchema = z.object({
  patchVersion: z.literal("1"),
  projectId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8).max(200),
  label: z.string().min(1).max(200),
  dryRun: z.boolean(),
  operations: z.array(graphOperationSchema).min(1).max(500),
  validationPolicy: validationProfileSchema,
  rollbackOnWarningCodes: z.array(z.string()).optional()
});

export const diagnosticSeveritySchema = z.enum(["info", "warning", "error", "fatal"]);
export const diagnosticSchema = z.object({
  id: z.string(),
  code: z.string(),
  severity: diagnosticSeveritySchema,
  message: z.string(),
  projectId: z.string(),
  entity: z
    .object({
      type: z.enum(["node", "connection", "parameter", "output", "file", "project"]),
      id: z.string()
    })
    .optional(),
  evidence: z.record(z.string(), z.unknown()),
  suggestedFixes: z.array(
    z.object({
      fixId: z.string(),
      risk: z.enum(["safe", "review", "artistic"]),
      description: z.string(),
      operations: z.array(graphOperationSchema)
    })
  ),
  deterministic: z.boolean()
});

export const validationReportSchema = z.object({
  projectId: z.string(),
  revision: z.number().int().nonnegative(),
  profile: validationProfileSchema.exclude(["none"]),
  valid: z.boolean(),
  diagnostics: z.array(diagnosticSchema),
  generatedAt: z.iso.datetime()
});

export const artifactSchema = z.object({
  id: z.string(),
  kind: z.string(),
  uri: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional()
});
export const jobSchema = z.object({
  id: z.string(),
  type: z.string(),
  state: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  progress: z.number().min(0).max(1).optional(),
  message: z.string().optional(),
  artifacts: z.array(artifactSchema),
  diagnostics: z.array(diagnosticSchema)
});

export const transactionSchema = z.object({
  id: z.string(),
  label: z.string(),
  actor: z.object({ type: z.string(), sessionId: z.string() }),
  timestamp: z.iso.datetime(),
  preRevision: z.number().int().nonnegative(),
  postRevision: z.number().int().nonnegative().nullable(),
  operations: z.array(graphOperationSchema),
  warnings: z.array(diagnosticSchema),
  snapshotId: z.string(),
  changedEntityIds: z.array(z.string()),
  durationMs: z.number().nonnegative(),
  state: z.enum(["committed", "rolled_back", "failed"])
});

export const capabilityManifestSchema = z.object({
  protocolVersion: z.string(),
  bridgeVersion: z.string(),
  materialMakerVersion: z.string(),
  godotVersion: z.string(),
  projectTypes: z.array(projectTypeSchema),
  features: z.record(z.string(), z.boolean()),
  limits: z.object({
    maxPatchOperations: z.number().int().positive(),
    maxPayloadBytes: z.number().int().positive(),
    maxConcurrentJobs: z.number().int().positive(),
    maxPreviewResolution: z.number().int().positive()
  })
});

export type Project = z.infer<typeof projectSchema>;
export type PermissionMode = z.infer<typeof permissionModeSchema>;
export type Position = z.infer<typeof positionSchema>;
export type PortDataType = z.infer<typeof portDataTypeSchema>;
export type Port = z.infer<typeof portSchema>;
export type ParameterValue = z.infer<typeof parameterValueSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type GraphSnapshot = z.infer<typeof graphSnapshotSchema>;
export type GraphOperation = z.infer<typeof graphOperationSchema>;
export type GraphPatch = z.infer<typeof graphPatchSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type ValidationProfile = z.infer<typeof validationProfileSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Job = z.infer<typeof jobSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;
