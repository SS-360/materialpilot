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

function toPort(raw: RawShaderPort, index: number): PortDescriptor {
  return {
    name: raw.name ?? `port_${index}`,
    label: raw.label || raw.shortdesc || raw.name || `Port ${index}`,
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
        : rawType === "bool"
          ? "boolean"
          : rawType === "int"
            ? "integer"
            : undefined;
  if (!type) return undefined;
  const defaultValue = (raw.default ??
    (type === "boolean" ? false : type === "enum" ? "" : 0)) as ParameterValue;
  return {
    name,
    label: raw.label || raw.shortdesc || name,
    type,
    default: defaultValue,
    required: true,
    ...(raw.min === undefined ? {} : { minimum: raw.min }),
    ...(raw.max === undefined ? {} : { maximum: raw.max }),
    ...(raw.step === undefined ? {} : { step: raw.step }),
    ...(raw.values ? { values: raw.values.map((value) => value.value ?? value.name ?? "") } : {}),
    description: raw.longdesc ?? raw.shortdesc ?? ""
  };
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
    const nativeId = raw.type ?? basename(file, ".mmg");
    const model = raw.shader_model;
    const outputs = model?.outputs
      ? Array.isArray(model.outputs)
        ? model.outputs
        : [model.outputs]
      : [];
    const parameters = (model?.parameters ?? [])
      .map(toParameter)
      .filter((parameter): parameter is ParameterDescriptor => parameter !== undefined);
    descriptors.push({
      typeId: `mm.generated.${nativeId.replaceAll("_", "-")}`,
      nativeId,
      displayName: model?.shortdesc || raw.name || nativeId.replaceAll("_", " "),
      category: raw.nodes ? "subgraph" : "generated",
      description: model?.longdesc ?? "Extracted from a Material Maker node definition.",
      semanticTags: raw.nodes ? ["subgraph"] : [],
      inputs: (model?.inputs ?? []).map(toPort),
      outputs: outputs.map(toPort),
      parameters,
      relativeCost: "unknown",
      compatibility: { minMaterialMakerVersion: "1.7", aliases: [nativeId] },
      safety: "safe"
    });
  }
  return descriptors;
}
