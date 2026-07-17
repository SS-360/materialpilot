import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MaterialBackend } from "./backend.js";

function jsonResource(
  uri: URL | string,
  value: unknown,
  trust: "trusted" | "untrusted-project-data" = "trusted"
) {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: "application/json",
        text: JSON.stringify({ _materialpilotTrust: trust, data: value }, null, 2)
      }
    ]
  };
}

export function registerResources(server: McpServer, backend: MaterialBackend): void {
  server.registerResource(
    "server-about",
    "materialmaker://server/about",
    {
      mimeType: "application/json",
      description: "MaterialPilot server identity and operating principles"
    },
    (uri) =>
      jsonResource(uri, {
        name: "MaterialPilot",
        version: "0.1.0",
        principles: [
          "inspect before mutation",
          "revision-safe atomic patches",
          "deterministic validation",
          "local-first security",
          "editable graph output"
        ]
      })
  );
  server.registerResource(
    "server-capabilities",
    "materialmaker://server/capabilities",
    { mimeType: "application/json", description: "Negotiated server and bridge capabilities" },
    async (uri) => jsonResource(uri, await backend.capabilities())
  );
  server.registerResource(
    "server-policy",
    "materialmaker://server/policy",
    { mimeType: "application/json", description: "Current permission and trust policy" },
    (uri) =>
      jsonResource(uri, {
        permissionMode: backend.permissionMode,
        customCode: false,
        projectContentTrust: "untrusted",
        mutationsRequireRevision: true,
        mutationsRequireIdempotencyKey: true
      })
  );
  server.registerResource(
    "catalog-version",
    "materialmaker://catalog/version",
    { mimeType: "application/json", description: "Deterministic node catalog version" },
    (uri) =>
      jsonResource(uri, { version: backend.catalog.version, count: backend.catalog.list().length })
  );
  server.registerResource(
    "catalog-categories",
    "materialmaker://catalog/categories",
    { mimeType: "application/json", description: "Available node catalog categories" },
    (uri) => jsonResource(uri, backend.catalog.categories())
  );
  server.registerResource(
    "projects",
    "materialmaker://projects",
    { mimeType: "application/json", description: "Projects visible to this MaterialPilot session" },
    async (uri) => jsonResource(uri, await backend.listProjects(), "untrusted-project-data")
  );

  server.registerResource(
    "project-graph",
    new ResourceTemplate("materialmaker://project/{projectId}/graph", {
      list: async () => ({
        resources: (await backend.listProjects()).map((project) => ({
          name: `${project.name} graph`,
          uri: `materialmaker://project/${project.id}/graph`,
          mimeType: "application/json"
        }))
      })
    }),
    { mimeType: "application/json", description: "Canonical project graph snapshot" },
    async (uri, variables) =>
      jsonResource(
        uri,
        await backend.getSnapshot(String(variables.projectId)),
        "untrusted-project-data"
      )
  );
  server.registerResource(
    "project-validation",
    new ResourceTemplate("materialmaker://project/{projectId}/validation", {
      list: async () => ({
        resources: (await backend.listProjects()).map((project) => ({
          name: `${project.name} validation`,
          uri: `materialmaker://project/${project.id}/validation`,
          mimeType: "application/json"
        }))
      })
    }),
    {
      mimeType: "application/json",
      description: "Latest deterministic standard validation report"
    },
    async (uri, variables) =>
      jsonResource(
        uri,
        await backend.validate(String(variables.projectId), "standard"),
        "untrusted-project-data"
      )
  );
  server.registerResource(
    "catalog-node",
    new ResourceTemplate("materialmaker://catalog/node/{typeId}", {
      list: async () => ({
        resources: backend.catalog.list().map((node) => ({
          name: node.displayName,
          uri: `materialmaker://catalog/node/${encodeURIComponent(node.typeId)}`,
          mimeType: "application/json"
        }))
      })
    }),
    { mimeType: "application/json", description: "Typed node descriptor" },
    (uri, variables) =>
      jsonResource(uri, backend.catalog.get(decodeURIComponent(String(variables.typeId))))
  );
}
