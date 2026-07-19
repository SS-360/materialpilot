import {
  canonicalHash,
  MaterialPilotError,
  type ParameterValue,
  type PortDataType
} from "@materialpilot/domain";
import { builtinNodeDescriptors } from "./builtin.js";
import generatedCatalog from "./generated.json" with { type: "json" };
import {
  nodeTypeDescriptorSchema,
  type NodeTypeDescriptor,
  type ParameterDescriptor
} from "./types.js";

export type CatalogSearch = {
  query?: string;
  category?: string;
  tags?: readonly string[];
  inputType?: PortDataType;
  outputType?: PortDataType;
};

export class NodeCatalog {
  readonly #descriptors: Map<string, NodeTypeDescriptor>;
  readonly version: string;

  constructor(
    descriptors: readonly NodeTypeDescriptor[] = [
      ...builtinNodeDescriptors,
      ...(generatedCatalog.descriptors as NodeTypeDescriptor[]).filter(
        (generated) =>
          !builtinNodeDescriptors.some((builtin) => builtin.nativeId === generated.nativeId)
      )
    ]
  ) {
    const parsed = descriptors.map((descriptor) => nodeTypeDescriptorSchema.parse(descriptor));
    this.#descriptors = new Map(parsed.map((descriptor) => [descriptor.typeId, descriptor]));
    this.version = canonicalHash(
      parsed.toSorted((left, right) => left.typeId.localeCompare(right.typeId))
    );
  }

  list(): NodeTypeDescriptor[] {
    return [...this.#descriptors.values()].toSorted((left, right) =>
      left.displayName.localeCompare(right.displayName)
    );
  }

  categories(): string[] {
    return [...new Set(this.list().map((descriptor) => descriptor.category))].toSorted();
  }

  get(typeIdOrAlias: string): NodeTypeDescriptor {
    const direct = this.#descriptors.get(typeIdOrAlias);
    const descriptor =
      direct ??
      this.list().find(
        (candidate) =>
          candidate.nativeId === typeIdOrAlias ||
          candidate.compatibility.aliases.includes(typeIdOrAlias)
      );
    if (!descriptor) {
      throw new MaterialPilotError("NODE_TYPE_NOT_FOUND", `Unknown node type: ${typeIdOrAlias}`, {
        repairSuggestion: "Search the node catalog and use a stable typeId."
      });
    }
    return descriptor;
  }

  search(filter: CatalogSearch): NodeTypeDescriptor[] {
    const query = filter.query?.trim().toLocaleLowerCase();
    return this.list().filter((descriptor) => {
      const haystack = [
        descriptor.typeId,
        descriptor.nativeId,
        descriptor.displayName,
        descriptor.description,
        ...descriptor.semanticTags,
        ...descriptor.compatibility.aliases,
        ...descriptor.parameters.map((parameter) => parameter.name)
      ]
        .join(" ")
        .toLocaleLowerCase();
      return (
        (!query || haystack.includes(query)) &&
        (!filter.category || descriptor.category === filter.category) &&
        (!filter.tags || filter.tags.every((tag) => descriptor.semanticTags.includes(tag))) &&
        (!filter.inputType ||
          descriptor.inputs.some((port) => isPortCompatible(filter.inputType!, port.dataType))) &&
        (!filter.outputType ||
          descriptor.outputs.some((port) => isPortCompatible(port.dataType, filter.outputType!)))
      );
    });
  }

  compatibleTargets(outputType: PortDataType): NodeTypeDescriptor[] {
    return this.search({ inputType: outputType });
  }

  export(): { version: string; descriptors: NodeTypeDescriptor[] } {
    return { version: this.version, descriptors: this.list() };
  }
}

const compatibility: Readonly<Record<PortDataType, readonly PortDataType[]>> = {
  grayscale: ["grayscale", "number", "color", "rgba", "unknown"],
  number: ["number", "grayscale", "unknown"],
  color: ["color", "rgba", "unknown"],
  rgba: ["rgba", "color", "unknown"],
  sdf2d: ["sdf2d", "unknown"],
  sdf3d: ["sdf3d", "sdf3d_color", "unknown"],
  sdf3d_color: ["sdf3d_color", "unknown"],
  material: ["material", "unknown"],
  boolean: ["boolean", "unknown"],
  vector2: ["vector2", "unknown"],
  vector3: ["vector3", "unknown"],
  unknown: [
    "grayscale",
    "color",
    "rgba",
    "sdf2d",
    "sdf3d",
    "sdf3d_color",
    "material",
    "boolean",
    "number",
    "vector2",
    "vector3",
    "unknown"
  ]
};

export function isPortCompatible(output: PortDataType, input: PortDataType): boolean {
  return compatibility[output].includes(input);
}

function parameterMatchesType(value: ParameterValue, descriptor: ParameterDescriptor): boolean {
  if (value === null) return !descriptor.required;
  switch (descriptor.type) {
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "string":
    case "enum":
      return typeof value === "string" || typeof value === "number";
    default:
      return typeof value === "object" && value.kind === descriptor.type;
  }
}

export function validateParameterValue(
  descriptor: ParameterDescriptor,
  value: ParameterValue
): string[] {
  const issues: string[] = [];
  if (!parameterMatchesType(value, descriptor)) {
    return [`Expected ${descriptor.type}`];
  }
  if (typeof value === "number") {
    if (descriptor.minimum !== undefined && value < descriptor.minimum)
      issues.push(`Must be >= ${descriptor.minimum}`);
    if (descriptor.maximum !== undefined && value > descriptor.maximum)
      issues.push(`Must be <= ${descriptor.maximum}`);
  }
  if (descriptor.values && !descriptor.values.includes(value as string | number)) {
    issues.push(`Must be one of: ${descriptor.values.join(", ")}`);
  }
  return issues;
}
