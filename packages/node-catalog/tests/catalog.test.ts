import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NodeCatalog,
  extractMmgCatalog,
  isPortCompatible,
  validateParameterValue
} from "../src/index.js";

describe("NodeCatalog", () => {
  const catalog = new NodeCatalog();

  it("resolves stable ids and upstream aliases", () => {
    expect(catalog.get("mm.noise.perlin").nativeId).toBe("perlin");
    expect(catalog.get("perlin").typeId).toBe("mm.noise.perlin");
  });

  it("searches semantic content", () => {
    expect(catalog.search({ query: "normal" }).map((node) => node.typeId)).toContain(
      "mm.filter.normal-map"
    );
    expect(catalog.search({ tags: ["output"] })).toHaveLength(1);
  });

  it("models safe implicit port conversions", () => {
    expect(isPortCompatible("grayscale", "rgba")).toBe(true);
    expect(isPortCompatible("sdf2d", "rgba")).toBe(false);
  });

  it("validates parameter bounds", () => {
    const scale = catalog
      .get("mm.noise.perlin")
      .parameters.find((parameter) => parameter.name === "scale_x")!;
    expect(validateParameterValue(scale, 32)).toEqual([]);
    expect(validateParameterValue(scale, 512)).toContain("Must be <= 32");
  });

  it("matches Material Maker 1.7 material port indices and native controls", () => {
    const material = catalog.get("mm.output.material");
    expect(material.inputs.map((port) => port.name)).toEqual([
      "albedo",
      "metallic",
      "roughness",
      "emission",
      "normal",
      "ao",
      "depth"
    ]);
    expect(material.parameters.map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining(["depth_scale", "flags_transparent", "metallic", "roughness", "size"])
    );
    expect(material.outputs.map((port) => port.name)).toEqual([
      "albedo_export",
      "orm_export",
      "emission_export",
      "normal_opengl",
      "depth_export",
      "subsurface_export",
      "metallic_smoothness",
      "normal_blender",
      "displacement_export",
      "ambient_occlusion_export",
      "normal_directx",
      "mask_map_export",
      "metallic_export",
      "roughness_export"
    ]);
  });

  it("ships the generated Material Maker 1.7 catalog needed for production graphs", () => {
    expect(catalog.list().length).toBeGreaterThan(380);
    expect(catalog.get("voronoi").outputs.map((port) => port.label)).toEqual(
      expect.arrayContaining(["Nodes", "Borders"])
    );
    expect(catalog.get("hbao").parameters.map((parameter) => parameter.label)).toEqual(
      expect.arrayContaining(["Radius", "Depth Scale", "Intensity"])
    );
    expect(catalog.search({ query: "warp" }).length).toBeGreaterThan(3);
  });

  it("extracts unique native IDs, semantic port names, and graph remote controls", async () => {
    const directory = mkdtempSync(join(tmpdir(), "materialpilot-catalog-"));
    try {
      writeFileSync(
        join(directory, "voronoi.mmg"),
        JSON.stringify({
          shader_model: {
            shortdesc: "Voronoi",
            inputs: [],
            outputs: [
              { type: "f", shortdesc: "Nodes" },
              { type: "f", shortdesc: "Borders" }
            ],
            parameters: []
          }
        })
      );
      writeFileSync(
        join(directory, "hbao.mmg"),
        JSON.stringify({
          label: "HBAO",
          nodes: [
            { name: "gen_inputs", ports: [{ name: "input", label: "Input", type: "f" }] },
            { name: "gen_outputs", ports: [{ name: "output", label: "Output", type: "f" }] },
            {
              name: "hbao_node",
              shader_model: {
                parameters: [
                  { name: "radius", type: "float", shortdesc: "Radius", default: 0.2 },
                  {
                    name: "depth_scale",
                    type: "float",
                    shortdesc: "Depth Scale",
                    default: 1
                  },
                  { name: "intensity", type: "float", shortdesc: "Intensity", default: 1 }
                ]
              }
            },
            {
              name: "gen_parameters",
              widgets: [
                {
                  name: "radius",
                  label: "Radius",
                  type: "named_parameter",
                  linked_widgets: [{ node: "hbao_node", widget: "radius" }]
                },
                {
                  name: "depth_scale",
                  label: "Depth Scale",
                  type: "named_parameter",
                  linked_widgets: [{ node: "hbao_node", widget: "depth_scale" }]
                },
                {
                  name: "intensity",
                  label: "Intensity",
                  type: "named_parameter",
                  linked_widgets: [{ node: "hbao_node", widget: "intensity" }]
                }
              ]
            }
          ]
        })
      );

      const descriptors = await extractMmgCatalog(directory);
      const voronoi = descriptors.find((descriptor) => descriptor.nativeId === "voronoi");
      expect(voronoi?.outputs.map((port) => port.name)).toEqual(
        expect.arrayContaining(["nodes_0", "borders_1"])
      );
      const hbao = descriptors.find((descriptor) => descriptor.nativeId === "hbao");
      expect(hbao?.inputs).toHaveLength(1);
      expect(hbao?.outputs).toHaveLength(1);
      expect(hbao?.parameters.map((parameter) => parameter.label)).toEqual(
        expect.arrayContaining(["Radius", "Depth Scale", "Intensity"])
      );
      expect(new Set(descriptors.map((descriptor) => descriptor.nativeId)).size).toBe(
        descriptors.length
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
