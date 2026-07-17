import { canonicalJson, stableNativeId } from "@materialpilot/domain";
import { z } from "zod";

export const paintingChannels = [
  "albedo",
  "metallic",
  "roughness",
  "emission",
  "normal",
  "depth",
  "occlusion"
] as const;

export const rawPaintLayerSchema: z.ZodType<RawPaintLayer> = z.lazy(() =>
  z.looseObject({
    name: z.string(),
    type: z.number().int().min(0).max(2).default(0),
    index: z.number().int().nonnegative().optional(),
    hidden: z.boolean().default(false),
    layers: z.array(rawPaintLayerSchema).optional(),
    material: z.record(z.string(), z.unknown()).optional()
  })
);

export const rawMmppProjectSchema = z.looseObject({
  model: z.string().min(1),
  settings: z.record(z.string(), z.unknown()).optional(),
  texture_size: z.number().int().positive().optional(),
  idmap: z.string().optional(),
  layers: z.array(rawPaintLayerSchema)
});

export type RawPaintLayer = {
  name: string;
  type: number;
  index?: number | undefined;
  hidden: boolean;
  layers?: RawPaintLayer[] | undefined;
  material?: Record<string, unknown> | undefined;
  [key: string]: unknown;
};

export type RawMmppProject = z.infer<typeof rawMmppProjectSchema>;
export type PaintLayer = {
  id: string;
  name: string;
  type: "paint" | "procedural" | "mask";
  index: number;
  hidden: boolean;
  opacity: Record<(typeof paintingChannels)[number], number>;
  textureReferences: Record<string, string>;
  material: Record<string, unknown> | null;
  layers: PaintLayer[];
};

export type PaintingProjectInspection = {
  projectId: string;
  model: string;
  idMap: string | null;
  textureSize: number | null;
  settings: Record<string, unknown>;
  layers: PaintLayer[];
  references: string[];
};

export function parseMmpp(
  text: string,
  options: { maxBytes?: number; maxLayers?: number } = {}
): RawMmppProject {
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error(`MMPP exceeds ${maxBytes} bytes`);
  const project = rawMmppProjectSchema.parse(JSON.parse(text));
  const maxLayers = options.maxLayers ?? 1000;
  if (countRawLayers(project.layers) > maxLayers)
    throw new Error(`MMPP exceeds ${maxLayers} layers`);
  return project;
}

export function serializeMmpp(project: RawMmppProject, pretty = true): string {
  const parsed = rawMmppProjectSchema.parse(project);
  return pretty ? `${JSON.stringify(parsed, null, "\t")}\n` : canonicalJson(parsed);
}

export function inspectMmpp(project: RawMmppProject, projectId: string): PaintingProjectInspection {
  let fallbackIndex = 0;
  const references = new Set<string>([project.model]);
  if (project.idmap) references.add(project.idmap);
  const mapLayer = (raw: RawPaintLayer, path: string): PaintLayer => {
    const index = raw.index ?? fallbackIndex++;
    const textures: Record<string, string> = {};
    for (const key of ["albedo", "mr", "emission", "normal", "do", "mask"]) {
      if (typeof raw[key] === "string") {
        textures[key] = raw[key];
        references.add(raw[key]);
      }
    }
    return {
      id: stableNativeId("paintLayer", projectId, `${path}:${index}:${raw.name}`),
      name: raw.name,
      type: raw.type === 1 ? "procedural" : raw.type === 2 ? "mask" : "paint",
      index,
      hidden: raw.hidden,
      opacity: Object.fromEntries(
        paintingChannels.map((channel) => [
          channel,
          typeof raw[`${channel}_alpha`] === "number" ? raw[`${channel}_alpha`] : 1
        ])
      ) as PaintLayer["opacity"],
      textureReferences: textures,
      material: raw.material ?? null,
      layers: (raw.layers ?? []).map((child, childIndex) =>
        mapLayer(child, `${path}/${childIndex}`)
      )
    };
  };
  const settings = project.settings ?? {};
  const exponent = typeof settings.texture_size === "number" ? settings.texture_size : undefined;
  const textureSize = exponent === undefined ? (project.texture_size ?? null) : 2 ** exponent;
  return {
    projectId,
    model: project.model,
    idMap: project.idmap ?? null,
    textureSize,
    settings,
    layers: project.layers.map((layer, index) => mapLayer(layer, String(index))),
    references: [...references]
  };
}

export function flattenLayers(layers: readonly PaintLayer[]): PaintLayer[] {
  return layers.flatMap((layer) => [layer, ...flattenLayers(layer.layers)]);
}

function countRawLayers(layers: readonly RawPaintLayer[]): number {
  return layers.reduce((count, layer) => count + 1 + countRawLayers(layer.layers ?? []), 0);
}
