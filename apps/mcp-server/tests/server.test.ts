import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { InMemoryBackend } from "../src/backend.js";
import { createMaterialPilotServer } from "../src/server.js";

async function connectedPair() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const backend = new InMemoryBackend({ permissionMode: "workspace-autonomous" });
  const { server } = createMaterialPilotServer({ backend, permissionMode: "workspace-autonomous" });
  const client = new Client({ name: "materialpilot-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, backend };
}

describe("MaterialPilot MCP server", () => {
  it("lists coherent tools, resources, and prompts", async () => {
    const { client, server } = await connectedPair();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("graph_apply_patch");
    expect(tools.tools.map((tool) => tool.name)).toContain("workflow_create_material");
    expect(tools.tools.map((tool) => tool.name)).toContain("preview_render_node_output");
    expect((await client.listResources()).resources.length).toBeGreaterThan(3);
    expect((await client.listPrompts()).prompts.length).toBeGreaterThan(3);
    await client.close();
    await server.close();
  });

  it("creates and observes a project through MCP calls", async () => {
    const { client, server } = await connectedPair();
    const created = await client.callTool({
      name: "project_create_material",
      arguments: { name: "MCP Test" }
    });
    expect(created.isError).not.toBe(true);
    const projects = (await client.callTool({ name: "project_list", arguments: {} })) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const content = projects.content[0];
    expect(content?.type).toBe("text");
    if (content?.type !== "text" || typeof content.text !== "string")
      throw new Error("Expected text content");
    expect(JSON.parse(content.text)).toHaveLength(1);
    await client.close();
    await server.close();
  });

  it("runs the baseline material workflow transactionally", async () => {
    const { client, server, backend } = await connectedPair();
    const result = await client.callTool({
      name: "workflow_create_material",
      arguments: { name: "Stone", resolution: 1024, scale: 12 }
    });
    expect(result.isError).not.toBe(true);
    const project = await backend.activeProject();
    expect(project).not.toBeNull();
    const snapshot = await backend.getSnapshot(project!.id);
    expect(snapshot.nodes).toHaveLength(4);
    expect(snapshot.connections).toHaveLength(5);
    expect((await backend.validate(project!.id, "standard")).valid).toBe(true);
    await client.close();
    await server.close();
  });
});
