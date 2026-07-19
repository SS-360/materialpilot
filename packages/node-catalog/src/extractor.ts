import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ParameterValue, PortDataType } from "@materialpilot/domain";
import type { NodeTypeDescriptor, ParameterDescriptor, PortDescriptor } from "./types.js";

type RawShaderPort = {
  name?: string;
  label?: string;
  shortdesc?: string;
  longdesc?: string;
  type?: string;
};
type RawParameter = RawShaderPort & {
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  first?: number;
  last?: number;
  values?: Array<{ name?: string; value?: string | number }>;
};
type RawNode = {
  type?: string;
  name?: string;
  shader_model?: {
    shortdesc?: string;
    longdesc?: string;
    inputs?: RawShaderPort[];
    outputs?: RawShaderPort | RawShaderPort[];
    parameters?: RawParameter[];
  };
  nodes?: unknown[];
  label?: string;
  shortdesc?: string;
  longdesc?: string;
  ports?: RawShaderPort[];
  widgets?: Array<{
    name?: string;
    label?: string;
    shortdesc?: string;
    longdesc?: string;
    type?: string;
    min?: number;
    max?: number;
    step?: number;
    default?: unknown;
    linked_widgets?: Array<{ node?: string; widget?: string }>;
  }>;
  parameters?: Record<string, unknown>;
};

const portTypes: Record<string, PortDataType> = {
  f: "grayscale",
  grayscale: "grayscale",
  rgb: "color",
  color: "color",
  rgba: "rgba",
  sdf2d: "sdf2d",
  sdf3d: "sdf3d",
  sdf3dc: "sdf3d_color",
  bool: "boolean",
  boolean: "boolean",
  number: "number",
  vec2: "vector2",
  vec3: "vector3"
};

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : path.endsWith(".mmg") ? [path] : [];
    })
  );
  return nested.flat();
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return normalized || "port";
}

function toPort(raw: RawShaderPort, index: number): PortDescriptor {
  const label = raw.label || raw.shortdesc || raw.name || `Port ${index}`;
  return {
    name: raw.name ? slug(raw.name.replaceAll("#", "")) : slug(label) + `_${index}`,
    label,
    dataType: portTypes[raw.type ?? ""] ?? "unknown",
    required: false,
    description: raw.longdesc ?? raw.shortdesc ?? ""
  };
}

function toParameter(raw: RawParameter, index: number): ParameterDescriptor | undefined {
  const name = raw.name ?? `parameter_${index}`;
  const rawType = raw.type ?? "string";
  const type =
    rawType === "float"
      ? "number"
      : rawType === "enum"
        ? "enum"
        : rawType === "bool" || rawType === "boolean"
          ? "boolean"
          : rawType === "int"
            ? "integer"
            : rawType === "size"
              ? "integer"
              : undefined;
  if (!type) return undefined;
  const candidateDefault = raw.default ?? (type === "boolean" ? false : 0);
  const defaultValue = (
    type === "boolean"
      ? typeof candidateDefault === "boolean"
        ? candidateDefault
        : false
      : type === "number" || type === "integer"
        ? typeof candidateDefault === "number"
          ? candidateDefault
          : 0
        : typeof candidateDefault === "string" || typeof candidateDefault === "number"
          ? candidateDefault
          : 0
  ) as ParameterValue;
  return {
    name,
    label: raw.label || raw.shortdesc || name,
    type,
    default: defaultValue,
    required: true,
    ...((raw.min ?? raw.first) === undefined ? {} : { minimum: raw.min ?? raw.first }),
    ...((raw.max ?? raw.last) === undefined ? {} : { maximum: raw.max ?? raw.last }),
    ...(raw.step === undefined || raw.step <= 0 ? {} : { step: raw.step }),
    ...(raw.values ? { values: raw.values.map((_value, valueIndex) => valueIndex) } : {}),
    description: raw.longdesc ?? raw.shortdesc ?? ""
  };
}

function graphPorts(raw: RawNode, type: "inputs" | "outputs"): PortDescriptor[] {
  const wantedName = type === "inputs" ? "gen_inputs" : "gen_outputs";
  const io = (raw.nodes ?? []).find(
    (candidate): candidate is RawNode =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as RawNode).name === wantedName
  );
  return (io?.ports ?? []).map(toPort);
}

function graphParameters(raw: RawNode): ParameterDescriptor[] {
  const nodes = (raw.nodes ?? []).filter(
    (candidate): candidate is RawNode => typeof candidate === "object" && candidate !== null
  );
  const remote = nodes.find((candidate) => candidate.name === "gen_parameters");
  if (!remote) return [];
  return (remote.widgets ?? [])
    .map((widget, index): ParameterDescriptor | undefined => {
      const linked = widget.linked_widgets?.[0];
      const linkedNode = nodes.find((candidate) => candidate.name === linked?.node);
      const linkedRaw = linkedNode?.shader_model?.parameters?.find(
        (candidate) => candidate.name === linked?.widget
      );
      const source: RawParameter = {
        name: widget.name ?? `parameter_${index}`,
        label: widget.label || widget.shortdesc || widget.name || `Parameter ${index}`,
        type:
          widget.type === "named_parameter"
            ? "float"
            : (linkedRaw?.type ?? (typeof widget.default === "boolean" ? "bool" : "float"))
      };
      const longdesc = widget.longdesc ?? linkedRaw?.longdesc;
      const minimum = widget.min ?? linkedRaw?.min;
      const maximum = widget.max ?? linkedRaw?.max;
      const step = widget.step ?? linkedRaw?.step;
      const defaultValue =
        remote.parameters?.[widget.name ?? ""] ?? widget.default ?? linkedRaw?.default;
      if (longdesc !== undefined) source.longdesc = longdesc;
      if (minimum !== undefined) source.min = minimum;
      if (maximum !== undefined) source.max = maximum;
      if (step !== undefined && step > 0) source.step = step;
      if (defaultValue !== undefined) source.default = defaultValue;
      return toParameter(source, index);
    })
    .filter((parameter): parameter is ParameterDescriptor => parameter !== undefined);
}

export async function extractMmgCatalog(directory: string): Promise<NodeTypeDescriptor[]> {
  const files = await walk(directory);
  const descriptors: NodeTypeDescriptor[] = [];
  for (const file of files.toSorted()) {
    let raw: RawNode;
    try {
      raw = JSON.parse(await readFile(file, "utf8")) as RawNode;
    } catch {
      continue;
    }
    const nativeId = basename(file, ".mmg");
    const model = raw.shader_model;
    const outputs = model?.outputs
      ? Array.isArray(model.outputs)
        ? model.outputs
        : [model.outputs]
      : [];
    const parameters = raw.nodes
      ? graphParameters(raw)
      : (model?.parameters ?? [])
          .map(toParameter)
          .filter((parameter): parameter is ParameterDescriptor => parameter !== undefined);
    const inputs = raw.nodes ? graphPorts(raw, "inputs") : (model?.inputs ?? []).map(toPort);
    const graphOutputs = raw.nodes ? graphPorts(raw, "outputs") : outputs.map(toPort);
    descriptors.push({
      typeId: `mm.generated.${nativeId.replaceAll("_", "-")}`,
      nativeId,
      displayName:
        model?.shortdesc || raw.label || raw.shortdesc || raw.name || nativeId.replaceAll("_", " "),
      category: raw.nodes ? "subgraph" : "generated",
      description:
        model?.longdesc ?? raw.longdesc ?? "Extracted from a Material Maker node definition.",
      semanticTags: raw.nodes ? ["subgraph"] : [],
      inputs,
      outputs: graphOutputs,
      parameters,
      relativeCost: "unknown",
      compatibility: { minMaterialMakerVersion: "1.7", aliases: [nativeId] },
      safety: "safe"
    });
  }
  return descriptors;
}
