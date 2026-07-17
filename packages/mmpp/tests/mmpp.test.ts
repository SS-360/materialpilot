import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { flattenLayers, inspectMmpp, parseMmpp, serializeMmpp } from "../src/index.js";

const path = fileURLToPath(
  new URL("../../../fixtures/painting-projects/painting-basic.mmpp", import.meta.url)
);

describe("MMPP adapter", () => {
  it("round-trips painting project metadata", () => {
    const project = parseMmpp(readFileSync(path, "utf8"));
    expect(parseMmpp(serializeMmpp(project))).toEqual(project);
  });

  it("inspects stable layers and referenced artifacts", () => {
    const inspection = inspectMmpp(parseMmpp(readFileSync(path, "utf8")), "mmpr_paint");
    expect(inspection.textureSize).toBe(1024);
    expect(flattenLayers(inspection.layers)).toHaveLength(3);
    expect(inspection.references).toContain("mask_2.png");
    expect(inspection.layers[0]?.id).toMatch(/^mml_native_/);
  });
});
