import type { NodeTypeDescriptor } from "./types.js";

const grayscaleOutput = [
  {
    name: "output",
    label: "Output",
    dataType: "grayscale" as const,
    required: false,
    description: "Generated grayscale texture"
  }
];

const materialOutputPorts = [
  {
    name: "albedo_export",
    label: "Albedo Export",
    dataType: "rgba" as const,
    required: false,
    description: "RGBA albedo and opacity export view"
  },
  {
    name: "orm_export",
    label: "ORM Export",
    dataType: "rgba" as const,
    required: false,
    description: "Ambient occlusion, roughness, and metallic packed export view"
  },
  {
    name: "emission_export",
    label: "Emission Export",
    dataType: "rgba" as const,
    required: false,
    description: "Emission export view"
  },
  {
    name: "normal_opengl",
    label: "OpenGL Normal",
    dataType: "rgba" as const,
    required: false,
    description: "OpenGL tangent-space normal export view"
  },
  {
    name: "depth_export",
    label: "Depth Export",
    dataType: "grayscale" as const,
    required: false,
    description: "Clamped depth export view"
  },
  {
    name: "subsurface_export",
    label: "Subsurface Export",
    dataType: "grayscale" as const,
    required: false,
    description: "Subsurface-scattering export view"
  },
  {
    name: "metallic_smoothness",
    label: "Metallic Smoothness",
    dataType: "rgba" as const,
    required: false,
    description: "Metallic RGB with smoothness in alpha"
  },
  {
    name: "normal_blender",
    label: "Blender Normal",
    dataType: "rgba" as const,
    required: false,
    description: "Blender-compatible OpenGL tangent-space normal export view"
  },
  {
    name: "displacement_export",
    label: "Displacement Export",
    dataType: "grayscale" as const,
    required: false,
    description: "Inverted displacement export view used by the Blender profile"
  },
  {
    name: "ambient_occlusion_export",
    label: "Ambient Occlusion Export",
    dataType: "grayscale" as const,
    required: false,
    description: "Ambient-occlusion export view"
  },
  {
    name: "normal_directx",
    label: "DirectX Normal",
    dataType: "rgba" as const,
    required: false,
    description: "DirectX tangent-space normal export view"
  },
  {
    name: "mask_map_export",
    label: "Mask Map Export",
    dataType: "rgba" as const,
    required: false,
    description: "Metallic, AO, detail, and smoothness packed export view"
  },
  {
    name: "metallic_export",
    label: "Metallic Export",
    dataType: "grayscale" as const,
    required: false,
    description: "Standalone metallic export view"
  },
  {
    name: "roughness_export",
    label: "Roughness Export",
    dataType: "grayscale" as const,
    required: false,
    description: "Standalone roughness export view"
  }
];

export const builtinNodeDescriptors: readonly NodeTypeDescriptor[] = [
  {
    typeId: "mm.source.uniform",
    nativeId: "uniform_grayscale",
    displayName: "Grayscale Uniform",
    category: "simple",
    description: "Produces a constant grayscale value.",
    semanticTags: ["source", "mask_generation"],
    inputs: [],
    outputs: grayscaleOutput,
    parameters: [
      {
        name: "color",
        label: "Value",
        type: "number",
        default: 0.5,
        required: true,
        minimum: 0,
        maximum: 1,
        step: 0.01,
        description: "Constant output value"
      }
    ],
    relativeCost: "low",
    compatibility: {
      minMaterialMakerVersion: "1.7",
      aliases: ["uniform_grayscale", "uniform_greyscale"]
    },
    safety: "safe"
  },
  {
    typeId: "mm.noise.perlin",
    nativeId: "perlin",
    displayName: "Value Noise",
    category: "noise",
    description: "Produces tileable fractal Perlin noise.",
    semanticTags: ["source", "macro_structure", "variation"],
    inputs: [],
    outputs: grayscaleOutput,
    parameters: [
      {
        name: "scale_x",
        label: "Scale X",
        type: "number",
        default: 4,
        required: true,
        minimum: 1,
        maximum: 32,
        step: 1,
        description: "Noise frequency along the X axis"
      },
      {
        name: "scale_y",
        label: "Scale Y",
        type: "number",
        default: 4,
        required: true,
        minimum: 1,
        maximum: 32,
        step: 1,
        description: "Noise frequency along the Y axis"
      },
      {
        name: "iterations",
        label: "Iterations",
        type: "integer",
        default: 3,
        required: true,
        minimum: 1,
        maximum: 10,
        step: 1,
        description: "Fractal octave count"
      },
      {
        name: "persistence",
        label: "Persistence",
        type: "number",
        default: 0.5,
        required: true,
        minimum: 0,
        maximum: 1,
        step: 0.05,
        description: "Amplitude falloff per octave"
      }
    ],
    relativeCost: "medium",
    compatibility: { minMaterialMakerVersion: "1.7", aliases: ["perlin", "noise"] },
    safety: "safe"
  },
  {
    typeId: "mm.filter.blend",
    nativeId: "blend",
    displayName: "Blend",
    category: "filter",
    description: "Combines two texture inputs using a selectable blend mode and mask.",
    semanticTags: ["mask_generation", "color_mapping"],
    inputs: [
      {
        name: "foreground",
        label: "Foreground",
        dataType: "rgba",
        required: true,
        description: "Top layer"
      },
      {
        name: "background",
        label: "Background",
        dataType: "rgba",
        required: true,
        description: "Bottom layer"
      },
      {
        name: "opacity",
        label: "Opacity",
        dataType: "grayscale",
        required: false,
        description: "Optional mask"
      }
    ],
    outputs: [
      {
        name: "output",
        label: "Output",
        dataType: "rgba",
        required: false,
        description: "Blended texture"
      }
    ],
    parameters: [
      {
        name: "blend_type",
        label: "Blend Mode",
        type: "integer",
        default: 0,
        required: true,
        minimum: 0,
        maximum: 14,
        step: 1,
        description: "Blend algorithm"
      },
      {
        name: "amount",
        label: "Amount",
        type: "number",
        default: 0.5,
        required: true,
        minimum: 0,
        maximum: 1,
        step: 0.01,
        description: "Blend opacity"
      }
    ],
    relativeCost: "low",
    compatibility: { minMaterialMakerVersion: "1.7", aliases: ["blend"] },
    safety: "safe"
  },
  {
    typeId: "mm.filter.colorize",
    nativeId: "colorize",
    displayName: "Colorize",
    category: "filter",
    description: "Maps grayscale values through a color gradient.",
    semanticTags: ["color_mapping"],
    inputs: [
      {
        name: "input",
        label: "Input",
        dataType: "grayscale",
        required: true,
        description: "Source texture"
      }
    ],
    outputs: [
      {
        name: "output",
        label: "Output",
        dataType: "rgba",
        required: false,
        description: "Colorized texture"
      }
    ],
    parameters: [
      {
        name: "gradient",
        label: "Gradient",
        type: "gradient",
        default: {
          kind: "gradient",
          stops: [
            { offset: 0, color: { kind: "color", r: 0, g: 0, b: 0, a: 1 } },
            { offset: 1, color: { kind: "color", r: 1, g: 1, b: 1, a: 1 } }
          ]
        },
        required: true,
        description: "Output color ramp"
      }
    ],
    relativeCost: "low",
    compatibility: { minMaterialMakerVersion: "1.7", aliases: ["colorize"] },
    safety: "safe"
  },
  {
    typeId: "mm.filter.normal-map",
    nativeId: "normal_map2",
    displayName: "Normal Map",
    category: "filter",
    description: "Converts height information to Material Maker's internal normal representation.",
    semanticTags: ["height_to_normal"],
    inputs: [
      {
        name: "input",
        label: "Input",
        dataType: "grayscale",
        required: true,
        description: "Height source"
      }
    ],
    outputs: [
      {
        name: "normal",
        label: "Normal",
        dataType: "rgba",
        required: false,
        description: "Normal texture"
      }
    ],
    parameters: [
      {
        name: "strength",
        label: "Strength",
        type: "number",
        default: 1,
        required: true,
        minimum: 0,
        maximum: 10,
        step: 0.01,
        description: "Normal intensity"
      },
      {
        name: "buffer",
        label: "Buffered Output",
        type: "integer",
        default: 1,
        required: false,
        minimum: 0,
        maximum: 1,
        description: "Material Maker native output-buffer toggle"
      },
      {
        name: "param2",
        label: "Native Option",
        type: "number",
        default: 0,
        required: false,
        description: "Material Maker native normal-map option"
      },
      {
        name: "size",
        label: "Buffer Resolution Exponent",
        type: "integer",
        default: 10,
        required: false,
        minimum: 4,
        maximum: 13,
        step: 1,
        description: "Material Maker native buffer resolution"
      }
    ],
    relativeCost: "low",
    compatibility: {
      minMaterialMakerVersion: "1.7",
      aliases: ["normal_map2", "normal_map"]
    },
    safety: "safe"
  },
  {
    typeId: "mm.output.material",
    nativeId: "material",
    displayName: "Material",
    category: "material",
    description: "Standard PBR material output.",
    semanticTags: ["output", "channel_packing"],
    inputs: [
      {
        name: "albedo",
        label: "Albedo",
        dataType: "rgba",
        required: true,
        description: "Base color channel"
      },
      {
        name: "metallic",
        label: "Metallic",
        dataType: "grayscale",
        required: false,
        description: "Metallic channel"
      },
      {
        name: "roughness",
        label: "Roughness",
        dataType: "grayscale",
        required: false,
        description: "Roughness channel"
      },
      {
        name: "emission",
        label: "Emission",
        dataType: "rgba",
        required: false,
        description: "Emission channel"
      },
      {
        name: "normal",
        label: "Normal",
        dataType: "rgba",
        required: false,
        description: "Normal channel"
      },
      {
        name: "ao",
        label: "Ambient Occlusion",
        dataType: "grayscale",
        required: false,
        description: "AO channel"
      },
      {
        name: "depth",
        label: "Depth",
        dataType: "grayscale",
        required: false,
        description: "Depth channel"
      }
    ],
    outputs: materialOutputPorts,
    parameters: [
      {
        name: "albedo_color",
        label: "Albedo Color",
        type: "color",
        default: { kind: "color", r: 1, g: 1, b: 1, a: 1 },
        required: false,
        description: "Albedo multiplier"
      },
      {
        name: "ao",
        label: "Ambient Occlusion",
        type: "number",
        default: 1,
        required: false,
        description: "Ambient-occlusion multiplier"
      },
      {
        name: "depth_scale",
        label: "Depth Scale",
        type: "number",
        default: 0.5,
        required: false,
        description: "Parallax/depth intensity"
      },
      {
        name: "emission_energy",
        label: "Emission Energy",
        type: "number",
        default: 1,
        required: false,
        description: "Emission intensity"
      },
      {
        name: "flags_transparent",
        label: "Transparent",
        type: "boolean",
        default: false,
        required: false,
        description: "Enable transparent material output"
      },
      {
        name: "metallic",
        label: "Metallic",
        type: "number",
        default: 0,
        required: false,
        description: "Metallic multiplier"
      },
      {
        name: "normal",
        label: "Normal Strength",
        type: "number",
        default: 1,
        required: false,
        description: "Normal-map multiplier"
      },
      {
        name: "roughness",
        label: "Roughness",
        type: "number",
        default: 1,
        required: false,
        description: "Roughness multiplier"
      },
      {
        name: "size",
        label: "Resolution Exponent",
        type: "integer",
        default: 10,
        required: true,
        minimum: 4,
        maximum: 13,
        step: 1,
        description: "Base-2 export resolution"
      },
      {
        name: "sss",
        label: "Subsurface Scattering",
        type: "number",
        default: 1,
        required: false,
        description: "Subsurface-scattering multiplier"
      }
    ],
    relativeCost: "medium",
    compatibility: { minMaterialMakerVersion: "1.7", aliases: ["material"] },
    safety: "filesystem"
  },
  {
    typeId: "mm.utility.reroute",
    nativeId: "reroute",
    displayName: "Reroute",
    category: "workflow",
    description: "Routes a connection for graph readability.",
    semanticTags: ["documentation"],
    inputs: [
      {
        name: "input",
        label: "Input",
        dataType: "unknown",
        required: true,
        description: "Any compatible source"
      }
    ],
    outputs: [
      {
        name: "output",
        label: "Output",
        dataType: "unknown",
        required: false,
        description: "Routed source"
      }
    ],
    parameters: [],
    relativeCost: "low",
    compatibility: { minMaterialMakerVersion: "1.7", aliases: ["reroute"] },
    safety: "safe"
  },
  {
    typeId: "mm.utility.variations-grayscale",
    nativeId: "variations_greyscale",
    displayName: "Grayscale Variations",
    category: "workflow",
    description: "Exposes deterministic seed modifiers for a grayscale procedural source.",
    semanticTags: ["variation", "controls"],
    inputs: [
      {
        name: "input",
        label: "Input",
        dataType: "grayscale",
        required: true,
        description: "Procedural source to vary"
      }
    ],
    outputs: Array.from({ length: 5 }, (_, index) => ({
      name: `output_${index + 1}`,
      label: `Variation ${index + 1}`,
      dataType: "grayscale" as const,
      required: false,
      description: "Seed-controlled variation"
    })),
    parameters: Array.from({ length: 5 }, (_, index) => ({
      name: `v${index + 1}`,
      label: `Seed modifier ${index + 1}`,
      type: "number" as const,
      default: index * 0.1,
      required: true,
      minimum: 0,
      maximum: 1,
      step: 0.01,
      description: "Deterministic seed offset"
    })),
    relativeCost: "low",
    compatibility: {
      minMaterialMakerVersion: "1.7",
      aliases: ["variations_greyscale", "variations_grayscale"]
    },
    safety: "safe"
  },
  {
    typeId: "mm.workflow.comment",
    nativeId: "comment",
    displayName: "Comment",
    category: "workflow",
    description: "Documents a semantic stage directly in the editable graph.",
    semanticTags: ["documentation"],
    inputs: [],
    outputs: [],
    parameters: [],
    relativeCost: "low",
    compatibility: { minMaterialMakerVersion: "1.7", aliases: ["comment"] },
    safety: "safe"
  },
  {
    typeId: "mm.workflow.remote-controls",
    nativeId: "remote",
    displayName: "Remote Controls",
    category: "workflow",
    description: "Exposes named controls linked to parameters on other graph nodes.",
    semanticTags: ["documentation", "controls"],
    inputs: [],
    outputs: [],
    parameters: [],
    relativeCost: "low",
    compatibility: { minMaterialMakerVersion: "1.7", aliases: ["remote"] },
    safety: "safe"
  }
];
