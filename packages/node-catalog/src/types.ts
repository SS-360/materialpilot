import { z } from "zod";
import { parameterValueSchema, portDataTypeSchema } from "@materialpilot/domain";

export const parameterDescriptorSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum([
    "string",
    "number",
    "integer",
    "boolean",
    "color",
    "vector2",
    "vector3",
    "gradient",
    "curve",
    "enum",
    "expression"
  ]),
  default: parameterValueSchema,
  required: z.boolean().default(true),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  values: z.array(z.union([z.string(), z.number()])).optional(),
  description: z.string().default("")
});

export const portDescriptorSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  dataType: portDataTypeSchema,
  required: z.boolean().default(false),
  variadic: z.boolean().optional(),
  description: z.string().default("")
});

export const nodeTypeDescriptorSchema = z.object({
  typeId: z.string().min(1),
  nativeId: z.string().min(1),
  displayName: z.string().min(1),
  category: z.string().min(1),
  description: z.string(),
  semanticTags: z.array(z.string()),
  inputs: z.array(portDescriptorSchema),
  outputs: z.array(portDescriptorSchema),
  parameters: z.array(parameterDescriptorSchema),
  relativeCost: z.enum(["low", "medium", "high", "unknown"]),
  compatibility: z.object({
    minMaterialMakerVersion: z.string(),
    maxMaterialMakerVersion: z.string().optional(),
    aliases: z.array(z.string()).default([])
  }),
  safety: z.enum(["safe", "filesystem", "network", "custom-code"])
});

export type ParameterDescriptor = z.infer<typeof parameterDescriptorSchema>;
export type PortDescriptor = z.infer<typeof portDescriptorSchema>;
export type NodeTypeDescriptor = z.infer<typeof nodeTypeDescriptorSchema>;
