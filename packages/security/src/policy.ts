import { existsSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { MaterialPilotError, type PermissionMode } from "@materialpilot/domain";

export type ApprovalClass = "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7";
export type FilesystemIntent = "read" | "write" | "export";

export type WorkspacePolicyOptions = {
  readRoots: readonly string[];
  writeRoots: readonly string[];
  exportRoots: readonly string[];
  overwrite?: "deny" | "allow";
  allowedExtensions?: readonly string[];
  allowUnc?: boolean;
};

function canonicalExisting(path: string): string {
  return realpathSync.native(resolve(path));
}

function canonicalCandidate(path: string): string {
  let existing = resolve(path);
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missing.unshift(existing.slice(parent.length).replace(/^[/\\]/, ""));
    existing = parent;
  }
  const base = existsSync(existing) ? canonicalExisting(existing) : resolve(existing);
  return resolve(base, ...missing);
}

function contains(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function isUncOrDevice(path: string): boolean {
  return path.startsWith("\\\\") || path.startsWith("\\\\?\\") || path.startsWith("\\\\.\\");
}

export class WorkspacePolicy {
  readonly readRoots: readonly string[];
  readonly writeRoots: readonly string[];
  readonly exportRoots: readonly string[];
  readonly overwrite: "deny" | "allow";
  readonly allowedExtensions: ReadonlySet<string>;
  readonly allowUnc: boolean;

  constructor(options: WorkspacePolicyOptions) {
    this.readRoots = options.readRoots.map(canonicalExisting);
    this.writeRoots = options.writeRoots.map(canonicalExisting);
    this.exportRoots = options.exportRoots.map(canonicalExisting);
    this.overwrite = options.overwrite ?? "deny";
    this.allowedExtensions = new Set(
      (
        options.allowedExtensions ?? [
          ".ptex",
          ".mmpp",
          ".png",
          ".jpg",
          ".jpeg",
          ".webp",
          ".exr",
          ".json",
          ".zip",
          ".md"
        ]
      ).map((extension) => extension.toLocaleLowerCase())
    );
    this.allowUnc = options.allowUnc ?? false;
  }

  authorize(path: string, intent: FilesystemIntent, options: { overwrite?: boolean } = {}): string {
    if (!this.allowUnc && isUncOrDevice(path)) {
      throw new MaterialPilotError("PATH_OUTSIDE_WORKSPACE", "UNC and device paths are disabled.");
    }
    const candidate = canonicalCandidate(path);
    const roots =
      intent === "read" ? this.readRoots : intent === "write" ? this.writeRoots : this.exportRoots;
    if (!roots.some((root) => contains(root, candidate))) {
      throw new MaterialPilotError(
        "PATH_OUTSIDE_WORKSPACE",
        `${candidate} is outside the configured ${intent} roots.`,
        {
          repairSuggestion: "Choose a path inside an approved workspace root."
        }
      );
    }
    const extension = extname(candidate).toLocaleLowerCase();
    if (extension && !this.allowedExtensions.has(extension)) {
      throw new MaterialPilotError(
        "PATH_OUTSIDE_WORKSPACE",
        `File extension ${extension} is not allowed.`
      );
    }
    if (
      intent !== "read" &&
      existsSync(candidate) &&
      this.overwrite === "deny" &&
      !options.overwrite
    ) {
      throw new MaterialPilotError("OVERWRITE_NOT_ALLOWED", `${candidate} already exists.`);
    }
    return candidate;
  }
}

export type ApprovalToken = {
  value: string;
  approvalClass: ApprovalClass;
  expiresAt: number;
};

export class PermissionPolicy {
  readonly mode: PermissionMode;
  readonly customCodeEnabled: boolean;
  readonly networkEnabled: boolean;
  readonly #tokens = new Map<string, ApprovalToken>();

  constructor(
    options: {
      mode?: PermissionMode;
      customCodeEnabled?: boolean;
      networkEnabled?: boolean;
    } = {}
  ) {
    this.mode = options.mode ?? "assisted";
    this.customCodeEnabled = options.customCodeEnabled ?? false;
    this.networkEnabled = options.networkEnabled ?? false;
  }

  registerApproval(token: ApprovalToken): void {
    this.#tokens.set(token.value, token);
  }

  authorize(approvalClass: ApprovalClass, approvalToken?: string): void {
    if (approvalClass === "A6" && !this.customCodeEnabled) {
      throw new MaterialPilotError(
        "SHADER_CODE_NOT_ALLOWED",
        "Generated custom code is disabled by policy."
      );
    }
    if (approvalClass === "A5" && !this.networkEnabled) {
      throw new MaterialPilotError("PERMISSION_DENIED", "Network access is disabled by policy.");
    }
    const requiresApproval =
      this.mode === "observe"
        ? approvalClass !== "A0"
        : this.mode === "assisted"
          ? approvalClass !== "A0"
          : this.mode === "workspace-autonomous"
            ? ["A4", "A5", "A6", "A7"].includes(approvalClass)
            : ["A5", "A6", "A7"].includes(approvalClass);
    if (!requiresApproval) return;
    const token = approvalToken ? this.#tokens.get(approvalToken) : undefined;
    if (!token || token.approvalClass !== approvalClass || token.expiresAt < Date.now()) {
      throw new MaterialPilotError("PERMISSION_DENIED", `${approvalClass} approval is required.`, {
        repairSuggestion: "Ask the user to approve this operation."
      });
    }
    this.#tokens.delete(token.value);
  }
}
