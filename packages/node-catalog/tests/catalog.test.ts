import { describe, expect, it } from "vitest";
import { NodeCatalog, isPortCompatible, validateParameterValue } from "../src/index.js";

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
});
