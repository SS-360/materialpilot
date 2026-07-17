import { createEntityId } from "./ids.js";

export const errorCodes = [
  "APPLICATION_NOT_RUNNING",
  "BRIDGE_NOT_AUTHENTICATED",
  "CAPABILITY_NOT_AVAILABLE",
  "PROJECT_NOT_FOUND",
  "PROJECT_TYPE_UNSUPPORTED",
  "PROJECT_DIRTY_CONFLICT",
  "REVISION_CONFLICT",
  "NODE_NOT_FOUND",
  "NODE_TYPE_NOT_FOUND",
  "PORT_NOT_FOUND",
  "PORT_TYPE_MISMATCH",
  "CONNECTION_ALREADY_EXISTS",
  "CONNECTION_WOULD_CREATE_INVALID_CYCLE",
  "PARAMETER_NOT_FOUND",
  "PARAMETER_TYPE_MISMATCH",
  "PARAMETER_OUT_OF_RANGE",
  "PATH_OUTSIDE_WORKSPACE",
  "OVERWRITE_NOT_ALLOWED",
  "SHADER_CODE_NOT_ALLOWED",
  "PERMISSION_DENIED",
  "INVALID_REQUEST",
  "RESOURCE_BUSY",
  "TRANSACTION_FAILED",
  "ROLLBACK_FAILED",
  "RENDER_FAILED",
  "EXPORT_FAILED",
  "JOB_CANCELLED",
  "TIMEOUT",
  "INTERNAL_ERROR"
] as const;

export type MaterialPilotErrorCode = (typeof errorCodes)[number];

export class MaterialPilotError extends Error {
  readonly code: MaterialPilotErrorCode;
  readonly retryable: boolean;
  readonly entityIds: readonly string[];
  readonly correlationId: string;
  readonly repairSuggestion: string | undefined;

  constructor(
    code: MaterialPilotErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      entityIds?: readonly string[];
      correlationId?: string;
      repairSuggestion?: string;
      cause?: unknown;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "MaterialPilotError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.entityIds = options.entityIds ?? [];
    this.correlationId = options.correlationId ?? createEntityId("request");
    this.repairSuggestion = options.repairSuggestion;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      entityIds: this.entityIds,
      correlationId: this.correlationId,
      repairSuggestion: this.repairSuggestion
    };
  }
}
