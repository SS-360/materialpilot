import { z } from "zod";

export const rawPositionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const rawPtexConnectionSchema = z.object({
  from: z.string(),
  from_port: z.number().int().nonnegative(),
  to: z.string(),
  to_port: z.number().int().nonnegative()
});
export const rawPtexNodeSchema: z.ZodType<RawPtexNode> = z.lazy(() =>
  z
    .object({
      name: z.string(),
      type: z.string(),
      node_position: rawPositionSchema.optional(),
      parameters: z.record(z.string(), z.unknown()).optional(),
      seed_int: z.number().int().optional(),
      nodes: z.array(rawPtexNodeSchema).optional(),
      connections: z.array(rawPtexConnectionSchema).optional()
    })
    .passthrough()
);
export const rawPtexProjectSchema = z.intersection(
  rawPtexNodeSchema,
  z.object({
    nodes: z.array(rawPtexNodeSchema),
    connections: z.array(rawPtexConnectionSchema)
  })
);

export type RawPtexConnection = z.infer<typeof rawPtexConnectionSchema>;
export type RawPtexNode = {
  name: string;
  type: string;
  node_position?: { x: number; y: number } | undefined;
  parameters?: Record<string, unknown> | undefined;
  seed_int?: number | undefined;
  nodes?: RawPtexNode[] | undefined;
  connections?: RawPtexConnection[] | undefined;
  [key: string]: unknown;
};
export type RawPtexProject = RawPtexNode & {
  nodes: RawPtexNode[];
  connections: RawPtexConnection[];
};
