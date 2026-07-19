import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";

import { NativeBackend } from "../apps/mcp-server/dist/backend.js";
import { BridgeClient } from "../packages/bridge-protocol/dist/index.js";
import { WorkspacePolicy } from "../packages/security/dist/index.js";

const smokeMode = process.env.MATERIALPILOT_SMOKE === "1";
const root = path.resolve(
  process.env.MATERIALPILOT_ARTIFACT_ROOT ?? "artifacts/abandoned-industrial-floor"
);
const bridgeRecord = path.resolve(
  process.env.MATERIALPILOT_RUNTIME_FILE ??
    path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".materialpilot", "bridge.json")
);
const expectedChannels = [
  "albedo",
  "roughness",
  "metallic",
  "normal",
  "height",
  "ambient_occlusion"
];
const previewResolution = 256;
const report = { warnings: [], steps: [], artifacts: [] };

function step(name, details = {}) {
  report.steps.push({ name, status: "passed", ...details });
  process.stderr.write(`[material-build] passed: ${name}\n`);
}

function temp(label) {
  return `tmp_${label}`;
}
function node(label, typeId, x, y, parameters = {}, extra = {}) {
  return {
    type: "node.create",
    tempId: temp(label),
    nodeTypeId: typeId,
    position: { x, y },
    displayName: label,
    parameters,
    ...extra
  };
}
function connect(from, outputPort, to, inputPort) {
  return {
    type: "connection.create",
    fromNodeId: temp(from),
    fromPort: outputPort,
    toNodeId: temp(to),
    toPort: inputPort
  };
}
function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}
function exrDimensions(data) {
  if (data.length < 16 || data.readUInt32LE(0) !== 0x01312f76)
    throw new Error("Invalid OpenEXR header");
  let offset = 8;
  while (offset < data.length && data[offset] !== 0) {
    const nameEnd = data.indexOf(0, offset);
    const typeEnd = data.indexOf(0, nameEnd + 1);
    if (nameEnd < 0 || typeEnd < 0 || typeEnd + 5 > data.length) break;
    const name = data.toString("ascii", offset, nameEnd);
    const size = data.readUInt32LE(typeEnd + 1);
    const valueOffset = typeEnd + 5;
    if (name === "dataWindow" && size === 16 && valueOffset + size <= data.length) {
      const xMin = data.readInt32LE(valueOffset),
        yMin = data.readInt32LE(valueOffset + 4);
      const xMax = data.readInt32LE(valueOffset + 8),
        yMax = data.readInt32LE(valueOffset + 12);
      return { width: xMax - xMin + 1, height: yMax - yMin + 1 };
    }
    offset = valueOffset + size;
  }
  throw new Error("OpenEXR dataWindow is missing");
}
function pngChannelRanges(data) {
  let width = 0;
  let height = 0;
  let channels = 0;
  const imageData = [];
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      if (chunk[8] !== 8 || ![2, 6].includes(chunk[9])) {
        throw new Error(`Unsupported preview PNG format: depth=${chunk[8]} color=${chunk[9]}`);
      }
      channels = chunk[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      imageData.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  const filtered = inflateSync(Buffer.concat(imageData));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const ranges = Array.from({ length: channels }, () => ({ minimum: 255, maximum: 0 }));
  const paeth = (a, b, c) => {
    const estimate = a + b - c;
    const distanceA = Math.abs(estimate - a);
    const distanceB = Math.abs(estimate - b);
    const distanceC = Math.abs(estimate - c);
    return distanceA <= distanceB && distanceA <= distanceC ? a : distanceB <= distanceC ? b : c;
  };
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[source++];
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const above = y > 0 ? pixels[previous + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[previous + x - channels] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : filter === 4
                  ? paeth(left, above, upperLeft)
                  : (() => {
                      throw new Error(`Unsupported PNG filter ${filter}`);
                    })();
      const value = (filtered[source++] + predictor) & 0xff;
      pixels[row + x] = value;
      const channel = x % channels;
      ranges[channel].minimum = Math.min(ranges[channel].minimum, value);
      ranges[channel].maximum = Math.max(ranges[channel].maximum, value);
    }
  }
  return ranges;
}
function gradient(...hexColors) {
  const toColor = (hex) => ({
    kind: "color",
    r: Number.parseInt(hex.slice(1, 3), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
    a: 1
  });
  return {
    kind: "gradient",
    stops: hexColors.map((color, index) => ({
      offset: index / (hexColors.length - 1),
      color: toColor(color)
    }))
  };
}

const controls = {
  concrete_scale: [
    { nodeId: temp("Concrete Noise"), parameter: "scale_x" },
    { nodeId: temp("Concrete Noise"), parameter: "scale_y" }
  ],
  crack_density: [
    { nodeId: temp("Crack Cells"), parameter: "scale_x" },
    { nodeId: temp("Crack Cells"), parameter: "scale_y" }
  ],
  crack_depth: [{ nodeId: temp("Crack Depth"), parameter: "default_in2" }],
  exposed_metal_amount: [{ nodeId: temp("Plate Mask"), parameter: "default_in1" }],
  rust_amount: [{ nodeId: temp("Rust Amount"), parameter: "default_in2" }],
  oil_stain_amount: [{ nodeId: temp("Oil Amount"), parameter: "default_in2" }],
  wetness: [{ nodeId: temp("Wet Amount"), parameter: "default_in2" }],
  dirt_amount: [{ nodeId: temp("Dirt Amount"), parameter: "default_in2" }],
  overall_wear: [{ nodeId: temp("Chip Wear"), parameter: "default_in2" }],
  random_seed: [{ nodeId: temp("Concrete Noise"), parameter: "offset" }]
};

function graphOperations(values, initialOutputNodeId) {
  const outputSize = smokeMode ? 9 : 11;
  const ops = [
    { type: "node.move", nodeId: initialOutputNodeId, position: { x: 4500, y: 0 } },
    {
      type: "node.set_parameter",
      nodeId: initialOutputNodeId,
      parameter: "size",
      value: outputSize
    }
  ];
  const comment = (name, text, x, y, w = 1220, h = 500) =>
    ops.push(
      node(
        name,
        "mm.workflow.comment",
        x,
        y,
        {},
        { comment: { title: name, text, size: { width: w, height: h } } }
      )
    );
  comment(
    "STAGE 01 - SOURCES",
    "Tileable concrete, cellular cracks, plate layout, corrosion, oil, and moisture fields. Edit through Exposed Controls.",
    -1550,
    -700,
    1400,
    1550
  );
  comment(
    "STAGE 02 - MASKS",
    "Controlled masks isolate exposed metal, rust, crack dirt, oil, wetness, and chipped transitions.",
    -100,
    -700,
    1380,
    1550
  );
  comment(
    "STAGE 03 - PBR SURFACE",
    "Shared masks drive height, normals, AO, metallic response, and cinematic roughness.",
    1350,
    -700,
    1580,
    1550
  );
  comment(
    "STAGE 04 - ALBEDO",
    "Concrete, metal, rust, crack dirt, oil, and wet color layers. Output is at far right.",
    2980,
    -700,
    1450,
    1550
  );
  ops.push(
    node("Concrete Noise", "mm.generated.fbm2", -1400, -450, {
      scale_x: values.concrete_scale,
      scale_y: values.concrete_scale,
      iterations: 4,
      persistence: 0.55,
      offset: values.random_seed
    })
  );
  ops.push(
    node("Crack Cells", "mm.generated.voronoi", -1400, -250, {
      scale_x: values.crack_density,
      scale_y: values.crack_density,
      stretch_x: 1,
      stretch_y: 1,
      intensity: 1
    })
  );
  ops.push(
    node("Plate Pattern", "mm.generated.bricks", -1400, -50, {
      columns: 5,
      rows: 5,
      mortar: 0.08,
      bevel: 0.08,
      corner: 0.08
    })
  );

  ops.push(node("Crack Mask", "mm.generated.math", 50, -450, { op: 15, default_in2: 0.055 }));
  ops.push(connect("Crack Cells", "borders_1", "Crack Mask", "in1"));
  ops.push(
    node("Plate Mask", "mm.generated.math", 50, -250, {
      op: 15,
      default_in1: values.exposed_metal_amount
    })
  );
  ops.push(connect("Plate Pattern", "bricks_pattern_0", "Plate Mask", "in2"));
  ops.push(
    node("Rust Amount", "mm.generated.math", 350, -250, { op: 2, default_in2: values.rust_amount })
  );
  ops.push(connect("Concrete Noise", "output_0", "Rust Amount", "in1"));
  ops.push(node("Rust Mask", "mm.generated.math", 600, -250, { op: 2 }));
  ops.push(
    connect("Rust Amount", "output_0", "Rust Mask", "in1"),
    connect("Plate Mask", "output_0", "Rust Mask", "in2")
  );
  ops.push(
    node("Dirt Amount", "mm.generated.math", 350, -50, { op: 2, default_in2: values.dirt_amount })
  );
  ops.push(connect("Concrete Noise", "output_0", "Dirt Amount", "in1"));
  ops.push(node("Crack Dirt", "mm.generated.math", 600, -50, { op: 2 }));
  ops.push(
    connect("Dirt Amount", "output_0", "Crack Dirt", "in1"),
    connect("Crack Mask", "output_0", "Crack Dirt", "in2")
  );
  ops.push(node("Oil Threshold", "mm.generated.math", 50, 180, { op: 15, default_in1: 0.61 }));
  ops.push(connect("Concrete Noise", "output_0", "Oil Threshold", "in2"));
  ops.push(
    node("Oil Amount", "mm.generated.math", 350, 180, {
      op: 2,
      default_in2: values.oil_stain_amount
    })
  );
  ops.push(connect("Oil Threshold", "output_0", "Oil Amount", "in1"));
  ops.push(node("Wet Threshold", "mm.generated.math", 50, 380, { op: 15, default_in1: 0.57 }));
  ops.push(connect("Concrete Noise", "output_0", "Wet Threshold", "in2"));
  ops.push(
    node("Wet Amount", "mm.generated.math", 350, 380, { op: 2, default_in2: values.wetness })
  );
  ops.push(connect("Wet Threshold", "output_0", "Wet Amount", "in1"));
  ops.push(node("Plate Edges", "mm.generated.edge-detect", 850, 100, { width: 1 }));
  ops.push(connect("Plate Mask", "output_0", "Plate Edges", "in"));
  ops.push(
    node("Chip Wear", "mm.generated.math", 1080, 100, { op: 2, default_in2: values.overall_wear })
  );
  ops.push(connect("Plate Edges", "output_0", "Chip Wear", "in1"));

  ops.push(node("Concrete Scale", "mm.generated.math", 1500, -450, { op: 2, default_in2: 0.16 }));
  ops.push(connect("Concrete Noise", "output_0", "Concrete Scale", "in1"));
  ops.push(node("Concrete Base", "mm.generated.math", 1750, -450, { op: 0, default_in2: 0.52 }));
  ops.push(connect("Concrete Scale", "output_0", "Concrete Base", "in1"));
  ops.push(node("Plate Lift", "mm.generated.math", 1500, -260, { op: 2, default_in2: 0.13 }));
  ops.push(connect("Plate Mask", "output_0", "Plate Lift", "in1"));
  ops.push(node("Raised Surface", "mm.generated.math", 1750, -260, { op: 0 }));
  ops.push(
    connect("Concrete Base", "output_0", "Raised Surface", "in1"),
    connect("Plate Lift", "output_0", "Raised Surface", "in2")
  );
  ops.push(
    node("Crack Depth", "mm.generated.math", 1500, -60, { op: 2, default_in2: values.crack_depth })
  );
  ops.push(connect("Crack Mask", "output_0", "Crack Depth", "in1"));
  ops.push(node("Cracked Height", "mm.generated.math", 1750, -60, { op: 1 }));
  ops.push(
    connect("Raised Surface", "output_0", "Cracked Height", "in1"),
    connect("Crack Depth", "output_0", "Cracked Height", "in2")
  );
  ops.push(node("Chip Depth", "mm.generated.math", 1500, 140, { op: 2, default_in2: 0.075 }));
  ops.push(connect("Chip Wear", "output_0", "Chip Depth", "in1"));
  ops.push(node("Final Height", "mm.generated.math", 2000, 20, { op: 1 }));
  ops.push(
    connect("Cracked Height", "output_0", "Final Height", "in1"),
    connect("Chip Depth", "output_0", "Final Height", "in2")
  );
  ops.push(
    node("Surface Normal", "mm.filter.normal-map", 2260, -300, {
      size: outputSize,
      strength: 2,
      buffer: 0,
      param2: 0
    })
  );
  ops.push(connect("Final Height", "output_0", "Surface Normal", "input"));
  ops.push(node("AO Occlusion", "mm.generated.math", 2260, -100, { op: 0 }));
  ops.push(
    connect("Crack Dirt", "output_0", "AO Occlusion", "in1"),
    connect("Rust Mask", "output_0", "AO Occlusion", "in2")
  );
  ops.push(node("AO Strength", "mm.generated.math", 2500, -100, { op: 2, default_in2: 0.55 }));
  ops.push(connect("AO Occlusion", "output_0", "AO Strength", "in1"));
  ops.push(node("Surface AO", "mm.generated.math", 2740, -100, { op: 1, default_in1: 1 }));
  ops.push(connect("AO Strength", "output_0", "Surface AO", "in2"));
  ops.push(
    node("Rust Metallic Loss", "mm.generated.math", 1500, 300, { op: 2, default_in2: 0.88 })
  );
  ops.push(connect("Rust Mask", "output_0", "Rust Metallic Loss", "in1"));
  ops.push(node("Metallic", "mm.generated.math", 1750, 300, { op: 1, clamp: true }));
  ops.push(
    connect("Plate Mask", "output_0", "Metallic", "in1"),
    connect("Rust Metallic Loss", "output_0", "Metallic", "in2")
  );
  ops.push(node("Plate Smoothness", "mm.generated.math", 1500, 500, { op: 2, default_in2: 0.42 }));
  ops.push(connect("Plate Mask", "output_0", "Plate Smoothness", "in1"));
  ops.push(node("Base Roughness", "mm.generated.math", 1750, 500, { op: 1, default_in1: 0.88 }));
  ops.push(connect("Plate Smoothness", "output_0", "Base Roughness", "in2"));
  ops.push(node("Rust Roughness", "mm.generated.math", 2000, 380, { op: 2, default_in2: 0.34 }));
  ops.push(connect("Rust Mask", "output_0", "Rust Roughness", "in1"));
  ops.push(node("Weathered Roughness", "mm.generated.math", 2250, 420, { op: 0 }));
  ops.push(
    connect("Base Roughness", "output_0", "Weathered Roughness", "in1"),
    connect("Rust Roughness", "output_0", "Weathered Roughness", "in2")
  );
  ops.push(node("Oil Gloss", "mm.generated.math", 2000, 570, { op: 2, default_in2: 0.33 }));
  ops.push(connect("Oil Amount", "output_0", "Oil Gloss", "in1"));
  ops.push(node("Oily Roughness", "mm.generated.math", 2250, 570, { op: 1 }));
  ops.push(
    connect("Weathered Roughness", "output_0", "Oily Roughness", "in1"),
    connect("Oil Gloss", "output_0", "Oily Roughness", "in2")
  );
  ops.push(node("Wet Gloss", "mm.generated.math", 2500, 570, { op: 2, default_in2: 0.47 }));
  ops.push(connect("Wet Amount", "output_0", "Wet Gloss", "in1"));
  ops.push(node("Final Roughness", "mm.generated.math", 2750, 500, { op: 1, clamp: true }));
  ops.push(
    connect("Oily Roughness", "output_0", "Final Roughness", "in1"),
    connect("Wet Gloss", "output_0", "Final Roughness", "in2")
  );

  ops.push(
    node("Concrete Color", "mm.filter.colorize", 3050, -520, {
      gradient: gradient("#252824", "#454942", "#686b64", "#8b8b82")
    })
  );
  ops.push(
    node("Metal Color", "mm.filter.colorize", 3050, -330, {
      gradient: gradient("#30363a", "#555f63", "#778286", "#98a0a0")
    })
  );
  ops.push(
    node("Rust Color", "mm.filter.colorize", 3050, -140, {
      gradient: gradient("#24150f", "#542615", "#853819", "#b35a25")
    })
  );
  ops.push(
    node("Dirt Color", "mm.filter.colorize", 3050, 50, {
      gradient: gradient("#100c08", "#25180d", "#3b2919", "#55432d")
    })
  );
  ops.push(
    node("Oil Color", "mm.filter.colorize", 3050, 240, {
      gradient: gradient("#030405", "#080a09", "#11120e", "#211b12")
    })
  );
  ops.push(
    node("Wet Color", "mm.filter.colorize", 3050, 430, {
      gradient: gradient("#10171a", "#1a2426", "#273235", "#3c4645")
    })
  );
  for (const colorNode of [
    "Concrete Color",
    "Metal Color",
    "Rust Color",
    "Dirt Color",
    "Oil Color",
    "Wet Color"
  ]) {
    ops.push(connect("Concrete Noise", "output_0", colorNode, "input"));
  }
  ops.push(node("Metal Layer", "mm.filter.blend", 3330, -420, { blend_type: 0, amount: 1 }));
  ops.push(
    connect("Metal Color", "output", "Metal Layer", "foreground"),
    connect("Concrete Color", "output", "Metal Layer", "background"),
    connect("Plate Mask", "output_0", "Metal Layer", "opacity")
  );
  ops.push(node("Rust Layer", "mm.filter.blend", 3520, -230, { blend_type: 0, amount: 1 }));
  ops.push(
    connect("Rust Color", "output", "Rust Layer", "foreground"),
    connect("Metal Layer", "output", "Rust Layer", "background"),
    connect("Rust Mask", "output_0", "Rust Layer", "opacity")
  );
  ops.push(node("Dirt Layer", "mm.filter.blend", 3710, -40, { blend_type: 0, amount: 1 }));
  ops.push(
    connect("Dirt Color", "output", "Dirt Layer", "foreground"),
    connect("Rust Layer", "output", "Dirt Layer", "background"),
    connect("Crack Dirt", "output_0", "Dirt Layer", "opacity")
  );
  ops.push(node("Oil Layer", "mm.filter.blend", 3900, 150, { blend_type: 0, amount: 1 }));
  ops.push(
    connect("Oil Color", "output", "Oil Layer", "foreground"),
    connect("Dirt Layer", "output", "Oil Layer", "background"),
    connect("Oil Amount", "output_0", "Oil Layer", "opacity")
  );
  ops.push(node("Final Albedo", "mm.filter.blend", 4140, 340, { blend_type: 0, amount: 0.62 }));
  ops.push(
    connect("Wet Color", "output", "Final Albedo", "foreground"),
    connect("Oil Layer", "output", "Final Albedo", "background"),
    connect("Wet Amount", "output_0", "Final Albedo", "opacity")
  );
  ops.push(
    node(
      "Exposed Controls",
      "mm.workflow.remote-controls",
      -1500,
      100,
      {},
      {
        remoteControls: Object.entries(controls).map(([name, links]) => ({
          name,
          label: name.replaceAll("_", " "),
          description: `Abandoned Industrial Floor: ${name.replaceAll("_", " ")}`,
          links
        }))
      }
    )
  );
  ops.push({
    type: "connection.create",
    fromNodeId: temp("Final Albedo"),
    fromPort: "output",
    toNodeId: initialOutputNodeId,
    toPort: "albedo"
  });
  ops.push({
    type: "connection.create",
    fromNodeId: temp("Final Roughness"),
    fromPort: "output_0",
    toNodeId: initialOutputNodeId,
    toPort: "roughness"
  });
  ops.push({
    type: "connection.create",
    fromNodeId: temp("Metallic"),
    fromPort: "output_0",
    toNodeId: initialOutputNodeId,
    toPort: "metallic"
  });
  ops.push({
    type: "connection.create",
    fromNodeId: temp("Surface Normal"),
    fromPort: "normal",
    toNodeId: initialOutputNodeId,
    toPort: "normal"
  });
  ops.push({
    type: "connection.create",
    fromNodeId: temp("Final Height"),
    fromPort: "output_0",
    toNodeId: initialOutputNodeId,
    toPort: "depth"
  });
  ops.push({
    type: "connection.create",
    fromNodeId: temp("Surface AO"),
    fromPort: "output_0",
    toNodeId: initialOutputNodeId,
    toPort: "ao"
  });
  return ops;
}

const variants = [
  [
    "Base",
    "abandoned-industrial-floor",
    {
      concrete_scale: 7.5,
      crack_density: 13,
      crack_depth: 0.18,
      exposed_metal_amount: 0.35,
      rust_amount: 0.58,
      oil_stain_amount: 0.46,
      wetness: 0.4,
      dirt_amount: 0.64,
      overall_wear: 0.52,
      random_seed: 0.13
    }
  ],
  [
    "Heavy Rust",
    "abandoned-industrial-floor-heavy-rust",
    {
      concrete_scale: 7.5,
      crack_density: 13,
      crack_depth: 0.2,
      exposed_metal_amount: 0.39,
      rust_amount: 0.82,
      oil_stain_amount: 0.34,
      wetness: 0.3,
      dirt_amount: 0.72,
      overall_wear: 0.66,
      random_seed: 0.27
    }
  ],
  [
    "Oil Soaked",
    "abandoned-industrial-floor-oil-soaked",
    {
      concrete_scale: 7,
      crack_density: 12,
      crack_depth: 0.17,
      exposed_metal_amount: 0.29,
      rust_amount: 0.5,
      oil_stain_amount: 0.88,
      wetness: 0.76,
      dirt_amount: 0.58,
      overall_wear: 0.48,
      random_seed: 0.49
    }
  ],
  [
    "Dry Neglect",
    "abandoned-industrial-floor-dry-neglect",
    {
      concrete_scale: 8.2,
      crack_density: 15,
      crack_depth: 0.27,
      exposed_metal_amount: 0.33,
      rust_amount: 0.63,
      oil_stain_amount: 0.21,
      wetness: 0.1,
      dirt_amount: 0.86,
      overall_wear: 0.78,
      random_seed: 0.73
    }
  ]
];
const activeVariants = smokeMode ? variants.slice(0, 1) : variants;

async function verifyArtifact(file, kind) {
  const data = await readFile(file);
  const info = await stat(file);
  if (!info.isFile() || data.length === 0) throw new Error(`Artifact is empty: ${file}`);
  const result = { path: file, kind, bytes: data.length, sha256: sha256(data) };
  if (file.endsWith(".png")) {
    if (data.toString("ascii", 1, 4) !== "PNG") throw new Error(`Invalid PNG: ${file}`);
    result.width = data.readUInt32BE(16);
    result.height = data.readUInt32BE(20);
  }
  if (file.endsWith(".exr")) Object.assign(result, exrDimensions(data));
  if (file.endsWith(".ptex")) JSON.parse(data.toString("utf8"));
  report.artifacts.push(result);
  return result;
}

async function main() {
  await mkdir(root, { recursive: false });
  const { client, capabilities: bridgeCapabilities } = await BridgeClient.connectFromRuntimeFile(
    bridgeRecord,
    {
      requestedCapabilities: [
        "application.read",
        "project.read",
        "project.create",
        "project.save",
        "graph.read",
        "graph.write",
        "graph.transactions",
        "preview.capture",
        "preview.nodeOutput",
        "preview.material3d",
        "export.write"
      ]
    }
  );
  const backend = new NativeBackend(client, bridgeCapabilities, "workspace-autonomous");
  const policy = new WorkspacePolicy({
    readRoots: [root],
    writeRoots: [root],
    exportRoots: [root],
    allowedExtensions: [".ptex", ".png", ".exr", ".json", ".md"],
    overwrite: "deny"
  });
  try {
    const capabilities = await backend.capabilities();
    for (const feature of [
      "project.create",
      "graph.write",
      "graph.transactions",
      "project.save",
      "preview.material3d",
      "export.write"
    ])
      if (!capabilities.features[feature])
        throw new Error(`Required capability unavailable: ${feature}`);
    step("inspect node catalog", { catalogVersion: capabilities.catalogVersion });
    const plan = {
      material: "Abandoned Industrial Floor",
      resolution: smokeMode ? 512 : 2048,
      smokeMode,
      channels: expectedChannels,
      stages: ["sources", "masks", "surface", "color", "output"],
      controls: Object.keys(controls),
      variants: activeVariants.map(([name]) => name)
    };
    await writeFile(path.join(root, "material-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, {
      flag: "wx"
    });
    step("create structured material plan");

    for (let index = 0; index < activeVariants.length; index++) {
      const [displayName, slug, values] = activeVariants[index];
      const project = await backend.createMaterialProject(
        `${displayName} - Abandoned Industrial Floor`
      );
      const snapshotName =
        index === 0
          ? "Before Abandoned Industrial Floor Build"
          : `Before ${displayName} Variation Build`;
      const snapshot = await backend.createNamedSnapshot(project.id, snapshotName);
      await writeFile(
        path.join(root, `${slug}-snapshot.json`),
        `${JSON.stringify(snapshot, null, 2)}\n`,
        { flag: "wx" }
      );
      step(`create named snapshot: ${displayName}`, { snapshotId: snapshot.id });
      const initialOutput = snapshot.snapshot.nodes.find(
        (candidate) => candidate.typeId === "mm.output.material"
      );
      if (!initialOutput)
        throw new Error(`Default material output was not found for ${displayName}`);
      const operations = graphOperations(values, initialOutput.id);
      const dryPatch = {
        patchVersion: "1",
        projectId: project.id,
        expectedRevision: project.revision,
        idempotencyKey: randomUUID(),
        label: `Dry run ${displayName}`,
        dryRun: true,
        operations,
        validationPolicy: "strict",
        rollbackOnWarningCodes: []
      };
      const dry = await backend.planPatch(dryPatch);
      if (
        !dry.validation.valid ||
        dry.validation.diagnostics.some((d) => ["error", "fatal"].includes(d.severity))
      )
        throw new Error(
          `Dry run failed for ${displayName}: ${JSON.stringify(dry.validation.diagnostics)}`
        );
      const afterDry = await backend.getSnapshot(project.id);
      if (afterDry.revision !== snapshot.revision || afterDry.hash !== snapshot.hash)
        throw new Error(`Dry run mutated ${displayName}`);
      step(`dry-run graph patch: ${displayName}`, {
        operationCount: operations.length,
        warnings: dry.warnings.map((d) => d.code)
      });
      const applied = await backend.applyPatch({
        ...dryPatch,
        dryRun: false,
        idempotencyKey: randomUUID(),
        label: `Build ${displayName}`
      });
      if (applied.status !== "committed")
        throw new Error(
          `Atomic apply failed for ${displayName}: ${JSON.stringify(applied.validation.diagnostics)}`
        );
      step(`apply graph atomically: ${displayName}`, {
        revision: applied.revision,
        graphHash: applied.snapshot.hash
      });
      step(`organize nodes into semantic stages: ${displayName}`);
      step(`add comments: ${displayName}`);
      let validation = await backend.validate(project.id, "strict");
      const deterministic = validation.diagnostics.flatMap((d) =>
        d.deterministic ? d.suggestedFixes.filter((f) => f.risk === "safe") : []
      );
      if (deterministic.length) {
        const current = await backend.getSnapshot(project.id);
        const repair = await backend.applyPatch({
          patchVersion: "1",
          projectId: project.id,
          expectedRevision: current.revision,
          idempotencyKey: randomUUID(),
          label: `Deterministic repairs ${displayName}`,
          dryRun: false,
          operations: deterministic.flatMap((f) => f.operations),
          validationPolicy: "strict",
          rollbackOnWarningCodes: []
        });
        if (repair.status !== "committed")
          throw new Error(`Deterministic repair failed for ${displayName}`);
        validation = await backend.validate(project.id, "strict");
      }
      if (
        !validation.valid ||
        validation.diagnostics.some((d) => ["warning", "error", "fatal"].includes(d.severity))
      )
        throw new Error(
          `Strict validation failed for ${displayName}: ${JSON.stringify(validation.diagnostics)}`
        );
      await writeFile(
        path.join(root, `${slug}-validation.json`),
        `${JSON.stringify(validation, null, 2)}\n`,
        { flag: "wx" }
      );
      step(`run strict validation: ${displayName}`, { diagnostics: validation.diagnostics.length });
      step(`repair deterministic problems: ${displayName}`, { repairs: deterministic.length });
      const current = await backend.getSnapshot(project.id);
      const ptex = policy.authorize(path.join(root, `${slug}.ptex`), "write");
      await backend.saveProject(project.id, ptex, current.revision, randomUUID(), false);
      await verifyArtifact(ptex, "editable-project");
      step(`save editable project: ${displayName}`);
      if (!smokeMode) {
        process.stderr.write(`[material-build] rendering Blender export: ${displayName}\n`);
        const exportPrefix = policy
          .authorize(path.join(root, `${slug}.png`), "export")
          .slice(0, -4);
        const exported = await backend.exportBlender(
          project.id,
          exportPrefix,
          current.revision,
          randomUUID(),
          false
        );
        for (const artifact of exported) {
          const verified = await verifyArtifact(artifact.path, "blender-export");
          if (verified.sha256 !== artifact.sha256 || verified.bytes !== artifact.sizeBytes)
            throw new Error(`Bridge export verification mismatch: ${artifact.path}`);
          if (verified.width !== 2048 || verified.height !== 2048)
            throw new Error(`Blender map is not 2048 x 2048: ${artifact.path}`);
          if (artifact.path.endsWith("_normal.png")) {
            const ranges = pngChannelRanges(await readFile(artifact.path));
            if (
              ranges[0].maximum - ranges[0].minimum < 8 ||
              ranges[1].maximum - ranges[1].minimum < 8
            )
              throw new Error(
                `Blender normal export is effectively flat: ${JSON.stringify(ranges)}`
              );
          }
        }
        step(`export for Blender: ${displayName}`, { artifacts: exported.length });
      }
      const geometries = index === 0 ? ["sphere", "plane"] : ["plane"];
      for (const geometry of geometries) {
        process.stderr.write(`[material-build] rendering ${geometry} preview: ${displayName}\n`);
        const preview = await backend.renderMaterialPreview(
          project.id,
          geometry,
          previewResolution
        );
        const previewPath = path.join(root, `${slug}-${geometry}.png`);
        await writeFile(previewPath, Buffer.from(preview.data, "base64"), { flag: "wx" });
        const verified = await verifyArtifact(previewPath, "3d-preview");
        if (verified.width !== previewResolution || verified.height !== previewResolution)
          throw new Error(`Unexpected preview dimensions: ${previewPath}`);
      }
      step(`render 3D previews: ${displayName}`, { geometries });
      if (index === 0) {
        const graph = await backend.getSnapshot(project.id);
        const outputMap = {
          albedo: ["Final Albedo", "output"],
          roughness: ["Final Roughness", "output_0"],
          metallic: ["Metallic", "output_0"],
          normal: ["Surface Normal", "normal"],
          height: ["Final Height", "output_0"],
          ambient_occlusion: ["Surface AO", "output_0"]
        };
        for (const channel of expectedChannels) {
          process.stderr.write(`[material-build] rendering channel preview: ${channel}\n`);
          const [nodeName, outputPort] = outputMap[channel];
          const nodeId = applied.temporaryIds[temp(nodeName)];
          const target = graph.nodes.find((candidate) => candidate.id === nodeId);
          if (!target) throw new Error(`Missing preview source: ${channel}`);
          const rendered = await backend.renderNodePreview(
            project.id,
            target.id,
            outputPort,
            previewResolution
          );
          const previewPath = path.join(root, `${slug}-${channel}.png`);
          await writeFile(previewPath, Buffer.from(rendered.data, "base64"), { flag: "wx" });
          const verified = await verifyArtifact(previewPath, "channel-preview");
          if (verified.width !== previewResolution || verified.height !== previewResolution)
            throw new Error(`Unexpected channel preview dimensions: ${previewPath}`);
          if (channel === "normal") {
            const ranges = pngChannelRanges(await readFile(previewPath));
            if (
              ranges[0].maximum - ranges[0].minimum < 8 ||
              ranges[1].maximum - ranges[1].minimum < 8
            )
              throw new Error(`Normal preview is effectively flat: ${JSON.stringify(ranges)}`);
          }
        }
        step("render channel previews", { channels: expectedChannels });
      }
    }
    step(smokeMode ? "complete visual smoke build" : "create three controlled variations", {
      variations: activeVariants.slice(1).map(([name]) => name)
    });

    const guide = `# Abandoned Industrial Floor\n\nA seamless, cinematic 2048 × 2048 procedural PBR material for Blender. The editable Material Maker graph builds cracked concrete, exposed corroded plates, oil, wetness, crack dirt, and chipped transitions from shared tileable masks.\n\n## Channels\n\nAlbedo, roughness, metallic, normal, height, and ambient occlusion are exported. Blender exports include the native Material Maker channel files listed in the artifact manifest.\n\n## Exposed controls\n\n${Object.keys(
      controls
    )
      .map(
        (name) =>
          `- **${name.replaceAll("_", " ")}** — edits the linked procedural source or mask without flattening the graph.`
      )
      .join(
        "\n"
      )}\n\n## Variations\n\n- Base: balanced cinematic decay.\n- Heavy Rust: more exposed plate corrosion and wear.\n- Oil Soaked: broad dark oil and wet gloss.\n- Dry Neglect: deeper cracks, concentrated dirt, little standing moisture.\n\n## Blender setup\n\nUse the exported albedo as Base Color (sRGB). Set roughness, metallic, normal, height, and AO textures to Non-Color. Feed normal through a Normal Map node. Use height with a Bump or Displacement node, depending on the renderer. Multiply AO into albedo only if the target lighting pipeline requires baked occlusion. The maps tile seamlessly.\n\n## Editing\n\nOpen the matching .ptex file in Material Maker 1.7. Controls are grouped in the Exposed Controls node; semantic comments divide Sources, Masks, Surface, and Color stages. Keep output size at 2048 and change random seed for a controlled re-roll.\n`;
    await writeFile(path.join(root, "MATERIAL_GUIDE.md"), guide, { flag: "wx" });
    step("generate Markdown material guide");
    await verifyArtifact(path.join(root, "material-plan.json"), "plan");
    for (const [, slug] of activeVariants) {
      await verifyArtifact(path.join(root, `${slug}-snapshot.json`), "snapshot");
      await verifyArtifact(path.join(root, `${slug}-validation.json`), "validation-report");
    }
    await verifyArtifact(path.join(root, "MATERIAL_GUIDE.md"), "guide");
    const alreadyVerified = new Set(
      report.artifacts.map((artifact) => path.resolve(artifact.path))
    );
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isFile() && !alreadyVerified.has(path.resolve(file)))
        await verifyArtifact(
          file,
          entry.name.endsWith(".mmcr") ? "crash-recovery-sidecar" : "supplemental"
        );
    }
    const manifestPath = path.join(root, "artifact-manifest.json");
    const finalReport = {
      ...report,
      artifactCount: report.artifacts.length,
      generatedAt: new Date().toISOString()
    };
    await writeFile(manifestPath, `${JSON.stringify(finalReport, null, 2)}\n`, { flag: "wx" });
    step("verify every artifact", { artifactCount: report.artifacts.length + 1 });
    console.log(
      JSON.stringify(
        {
          root,
          manifestPath,
          steps: report.steps.length,
          artifacts: report.artifacts.length + 1,
          warnings: report.warnings
        },
        null,
        2
      )
    );
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
