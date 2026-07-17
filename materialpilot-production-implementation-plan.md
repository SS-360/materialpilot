# MaterialPilot
## Production-Grade MCP Server and Native Integration Plan for Material Maker

**Document status:** Engineering blueprint  
**Target audience:** Maintainers, contributors, reviewers, AI coding agents, and potential employers  
**Prepared:** July 16, 2026  
**Primary target:** Material Maker 1.7 on Godot 4.5.1  
**Primary MCP clients:** OpenAI Codex, Claude Code, and other standards-compliant MCP hosts  
**License recommendation:** Apache-2.0 for MaterialPilot code, while preserving Material Maker's upstream MIT notices  
**Project type:** Open-source developer and creative-productivity infrastructure

---

## 1. Executive summary

MaterialPilot will be a production-grade Model Context Protocol server and native Material Maker integration that allows an AI agent to operate Material Maker through structured, observable, reversible, and testable actions.

The system will not simulate mouse clicks. It will integrate with Material Maker's internal project, graph, rendering, preview, export, library, and painting systems. The agent will be able to inspect a project, understand available node types, construct and modify procedural graphs, configure parameters, preview results, validate graph structure, manage variations, export assets, and recover safely from failures.

The central product promise is:

> MaterialPilot gives AI agents structured hands and reliable eyes inside Material Maker, while preserving human control, editable procedural graphs, deterministic validation, and reversible operations.

A production release must support more than "prompt to texture." It must provide:

- a stable native bridge inside Material Maker;
- a standards-compliant MCP server;
- a versioned domain model independent of Material Maker internals;
- complete read APIs before broad write APIs;
- atomic graph transactions and undo integration;
- typed node, port, parameter, and project schemas;
- progress reporting and cancellation;
- deterministic validation;
- preview and export resources;
- local security boundaries;
- compatibility testing against supported Material Maker versions;
- cross-platform packaging;
- reliable documentation and examples;
- a clear extension mechanism for future node types and upstream changes.

Material Maker 1.7 is the current upstream release as of this document. It uses Godot's `GraphEdit` interface for interconnected procedural nodes and includes material authoring, 3D model painting, 2D and 3D previews, histograms, asset libraries, remote controls, subgraphs, custom shader nodes, variations, and exports for Blender, Godot, Unity, and Unreal.[^mm-repo][^mm-release][^mm-docs]

The recommended architecture is a four-part system:

1. **MaterialPilot MCP Server**, written in TypeScript.
2. **MaterialPilot Native Bridge**, written in GDScript and integrated into a maintained Material Maker fork or upstream-compatible addon.
3. **Material Domain SDK**, containing stable schemas, validators, compatibility adapters, and `.ptex`/`.mmpp` support.
4. **Test and Packaging Infrastructure**, including fixtures, headless tests, compatibility matrices, signed release artifacts, and sample projects.

The implementation should prioritize correctness and observability over the raw number of tools. A smaller number of well-designed workflow tools should sit above a complete atomic operation layer. Agents can use the workflow tools for normal work and the atomic tools for repair or advanced control.

---

## 2. Product definition

### 2.1 Product name

Working name: **MaterialPilot**

Alternative repository names:

- `materialpilot`
- `material-maker-mcp`
- `mcp-material-maker`
- `materialpilot-mcp`

Recommended GitHub repository:

```text
materialpilot/materialpilot
```

Recommended packages:

```text
@materialpilot/mcp-server
@materialpilot/domain
@materialpilot/ptex
@materialpilot/validator
```

### 2.2 One-sentence description

MaterialPilot is a production-grade MCP integration that lets AI agents inspect, create, modify, validate, preview, and export editable procedural materials and painting projects inside Material Maker.

### 2.3 User groups

Primary users:

- technical artists;
- indie game developers;
- 3D environment artists;
- material artists;
- Godot, Blender, Unity, and Unreal users;
- creative coding students;
- educators teaching procedural graphics;
- researchers studying agent interaction with visual programming systems.

Secondary users:

- studios building material libraries;
- open-source contributors;
- AI-agent developers;
- accessibility users who benefit from natural-language control;
- automation engineers building asset pipelines.

### 2.4 Core jobs to be done

A user should be able to ask an agent to:

- create an editable procedural material from a written specification;
- inspect and explain an unfamiliar graph;
- repair missing, invalid, or inefficient graph sections;
- add a requested visual feature to an existing material;
- generate controlled variations;
- expose useful artist parameters;
- reorganize a graph without changing output;
- convert or adapt a graph for a different export target;
- validate PBR channel structure;
- export textures and target-specific assets;
- create or modify custom nodes;
- operate selected painting workflows;
- batch process a library of materials;
- collect diagnostics and performance information.

### 2.5 Non-goals for the first stable release

The first stable release should not promise:

- human-level artistic taste;
- guaranteed photorealism;
- perfect matching from arbitrary reference images;
- unrestricted execution of generated shader code;
- arbitrary remote control over the public internet;
- pixel-perfect UI automation;
- support for every historical Material Maker release;
- replacement of Material Maker's UI;
- hidden one-shot generation that bypasses editable graphs.

---

## 3. Product principles

### 3.1 Editable output over flattened output

The primary artifact is the procedural graph and project, not only exported images.

### 3.2 Observation before mutation

Every destructive or modifying workflow starts by retrieving project state, revision, selected objects, and validation status.

### 3.3 Atomicity

A multi-step agent edit either succeeds as a transaction or rolls back without leaving a partially broken graph.

### 3.4 Human control

Users choose permission mode, workspace roots, overwrite policy, approval policy, and whether generated code is allowed.

### 3.5 Deterministic rules before model judgment

Structural correctness, port compatibility, path safety, value ranges, and export completeness must be checked by deterministic code.

### 3.6 Stable domain model

The MCP contract must not expose raw Godot objects or unstable internal class names as its only interface.

### 3.7 Progressive capability

Clients discover available tools and features based on:

- Material Maker version;
- project type;
- current workspace;
- installed node libraries;
- enabled security mode;
- platform capabilities.

### 3.8 No silent failure

Every operation returns:

- status;
- project revision;
- affected entities;
- warnings;
- validation changes;
- generated artifacts;
- rollback information;
- diagnostic correlation ID.

### 3.9 Idempotent automation

Write operations should accept an idempotency key. Repeating the same request after a transport failure must not duplicate nodes or exports.

### 3.10 Upstream respect

MaterialPilot should minimize invasive changes and aim to contribute generic hooks upstream when appropriate.

---

## 4. Research-backed feasibility

Material Maker is an open-source application built with Godot. Its interface is based on `GraphEdit`, and textures and brushes are represented as interconnected nodes.[^mm-repo]

Material Maker can open `.ptex` files directly and supports command-line material export to Blender, Godot, Unity, and Unreal.[^mm-cli] Material exports generate channel images and target-specific files, including packed ORM output in relevant material workflows.[^mm-export][^mm-material-node]

The application includes material and painting project types. Material projects expose graph, hierarchy, 2D preview, 3D preview, histogram, and reference panels. Painting projects include brush, parameter, layer, and paint panels.[^mm-overview] The 3D preview can select models and environments, configure UV scale and tessellation, and generate mesh maps such as normal, inverse UV, curvature, ambient occlusion, and thickness maps.[^mm-preview3d]

Material Maker's developer has described it as primarily a shader-generation system, with almost 250 nodes, support for custom nodes and export targets, and a community asset website.[^godot-showcase] This means a production integration must model more than image files. It must represent node semantics, shader generation, graph structure, project state, and export configuration.

MCP supports server tools, resources, and prompts over a stateful JSON-RPC protocol. It also supports progress, cancellation, logging, and capability negotiation.[^mcp-spec] Codex can connect to local STDIO servers and Streamable HTTP servers and reads server instructions supplied during MCP initialization.[^codex-mcp]

---

## 5. System context

```text
┌───────────────────────────────────────────────────────────────────┐
│ MCP Host                                                          │
│ Codex App / Codex CLI / IDE / Claude Code / other MCP client      │
└───────────────────────────────┬───────────────────────────────────┘
                                │ MCP
                                │ STDIO or Streamable HTTP
┌───────────────────────────────▼───────────────────────────────────┐
│ MaterialPilot MCP Server                                          │
│                                                                   │
│ Tool registry       Resource registry       Prompt registry       │
│ Permission policy   Session manager         Progress/cancel       │
│ Domain validation   Bridge client           Audit logging         │
└───────────────────────────────┬───────────────────────────────────┘
                                │ Local bridge protocol
                                │ authenticated JSON-RPC over WS/HTTP
┌───────────────────────────────▼───────────────────────────────────┐
│ MaterialPilot Native Bridge                                       │
│ GDScript module inside Material Maker                             │
│                                                                   │
│ Project adapter    Graph adapter       Preview adapter            │
│ Export adapter     Painting adapter    Library adapter            │
│ Undo adapter       Diagnostics         Event stream               │
└───────────────────────────────┬───────────────────────────────────┘
                                │ Internal calls
┌───────────────────────────────▼───────────────────────────────────┐
│ Material Maker                                                     │
│ GraphEdit, generators, shaders, previews, exports, painting       │
└───────────────────────────────────────────────────────────────────┘
```

Supporting components:

```text
Domain SDK
├── schemas
├── node catalog
├── graph validator
├── compatibility adapters
├── serializers
└── test fixtures

CLI and Developer Tools
├── bridge health checker
├── MCP inspector configuration
├── project linter
├── batch exporter
└── fixture generator
```

---

## 6. Architecture decisions

### ADR-001: Use a native bridge, not UI automation

**Decision:** Integrate through GDScript and Material Maker's internal APIs.

**Reasoning:**

- UI coordinates are unstable.
- Graph ports and semantic state cannot be reliably inferred from pixels.
- Native integration supports undo, project revisions, validation, selection, and events.
- Headless and automated tests become possible.
- Accessibility and alternative layouts do not break the integration.

**Fallback:** A `.ptex` adapter may provide offline read/write and migration support, but should not be the only runtime integration.

### ADR-002: Use TypeScript for the MCP server

**Decision:** Use Node.js 22 LTS and TypeScript.

**Reasoning:**

- strong JSON Schema and Zod ecosystem;
- mature MCP SDK;
- easy STDIO packaging;
- cross-platform installers;
- good test tooling;
- straightforward event streaming;
- familiar ecosystem for Codex-generated development.

### ADR-003: Separate MCP protocol from Material Maker bridge protocol

**Decision:** The native bridge will not itself be the public MCP server.

**Reasoning:**

- keeps GDScript simpler;
- isolates MCP spec changes;
- supports multiple Material Maker instances;
- allows richer validation before internal calls;
- permits an offline project service;
- makes unit testing possible without launching Godot.

### ADR-004: Use stable MaterialPilot IDs

**Decision:** Every project entity exposed through MCP receives a stable MaterialPilot ID.

Example:

```text
node:mmn_01JY3C7X44T2K8R6B6R0
connection:mmc_01JY3C83Q7F1
transaction:mmtx_01JY3C8BEQ
```

Do not use UI indices as permanent identifiers.

### ADR-005: Use optimistic concurrency

Every project state has a monotonically increasing `revision`.

A write request includes:

```json
{
  "expectedRevision": 42
}
```

If the project has changed since inspection, the operation fails with `REVISION_CONFLICT`.

### ADR-006: Use graph patches for complex changes

Atomic graph tools remain available, but complex agent work should use `graph_apply_patch`.

Benefits:

- fewer model calls;
- atomic validation;
- easier dry runs;
- clean audit trail;
- predictable rollback;
- easier testing.

### ADR-007: Local-first security

The native bridge binds to loopback only by default. Remote MCP is optional and must be explicitly configured.

### ADR-008: Feature negotiation by capability manifest

The bridge reports capabilities such as:

```json
{
  "materialMakerVersion": "1.7",
  "godotVersion": "4.5.1",
  "projectTypes": ["material", "painting"],
  "features": {
    "graph.read": true,
    "graph.write": true,
    "preview.capture": true,
    "painting.stroke": false,
    "customNode.write": true
  }
}
```

---

## 7. Repository design

```text
materialpilot/
├── AGENTS.md
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE
├── NOTICE
├── README.md
├── SECURITY.md
├── SUPPORT.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
│
├── apps/
│   ├── mcp-server/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── server/
│   │   │   ├── tools/
│   │   │   ├── resources/
│   │   │   ├── prompts/
│   │   │   ├── policy/
│   │   │   ├── sessions/
│   │   │   ├── telemetry/
│   │   │   └── bridge/
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── material-maker-bridge/
│   │   ├── addon/
│   │   │   └── materialpilot/
│   │   │       ├── plugin.cfg
│   │   │       ├── plugin.gd
│   │   │       ├── bridge/
│   │   │       ├── adapters/
│   │   │       ├── transactions/
│   │   │       ├── security/
│   │   │       ├── ui/
│   │   │       └── tests/
│   │   └── README.md
│   │
│   ├── desktop-manager/
│   │   └── optional installer and diagnostics UI
│   │
│   └── docs-site/
│
├── packages/
│   ├── domain/
│   │   ├── src/entities/
│   │   ├── src/events/
│   │   ├── src/errors/
│   │   └── src/schemas/
│   │
│   ├── bridge-protocol/
│   ├── node-catalog/
│   ├── graph-engine/
│   ├── validator/
│   ├── ptex/
│   ├── mmpp/
│   ├── security/
│   ├── testkit/
│   └── cli/
│
├── fixtures/
│   ├── materials/
│   ├── painting-projects/
│   ├── node-catalogs/
│   ├── invalid-projects/
│   └── expected-exports/
│
├── examples/
│   ├── cracked-stone/
│   ├── aged-metal/
│   ├── stylized-bricks/
│   ├── sci-fi-panels/
│   ├── organic-skin/
│   └── painting-demo/
│
├── schemas/
│   ├── materialpilot-domain.schema.json
│   ├── graph-patch.schema.json
│   ├── bridge-rpc.schema.json
│   └── capability-manifest.schema.json
│
├── scripts/
│   ├── build-all.*
│   ├── package-release.*
│   ├── update-node-catalog.*
│   ├── run-compatibility-suite.*
│   └── generate-sbom.*
│
└── .github/
    ├── workflows/
    ├── ISSUE_TEMPLATE/
    ├── PULL_REQUEST_TEMPLATE.md
    └── dependabot.yml
```

---

## 8. Domain model

The domain model is the stable language shared by tools, resources, tests, and the bridge.

### 8.1 Core entities

```text
ApplicationInstance
Workspace
Project
ProjectTab
Graph
Node
Port
Connection
Parameter
Expression
RemoteControl
Subgraph
Comment
Selection
MaterialOutput
ExportTarget
PreviewConfiguration
RenderedPreview
Environment
PreviewModel
MeshMap
Library
LibraryItem
CustomNodeDefinition
PaintingProject
PaintLayer
PaintMask
Brush
Stroke
Transaction
Snapshot
ValidationReport
Diagnostic
Artifact
Job
```

### 8.2 Project

```ts
interface Project {
  id: string;
  type: "material" | "painting";
  name: string;
  path: string | null;
  revision: number;
  dirty: boolean;
  active: boolean;
  graphIds: string[];
  createdAt?: string;
  modifiedAt?: string;
  compatibility: {
    materialMakerVersion: string;
    schemaVersion?: string;
  };
}
```

### 8.3 Node

```ts
interface GraphNode {
  id: string;
  nativeId: string;
  typeId: string;
  displayName: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  minimized: boolean;
  disabled?: boolean;
  seed?: number;
  inputs: Port[];
  outputs: Port[];
  parameters: Record<string, ParameterValue>;
  metadata: Record<string, unknown>;
}
```

### 8.4 Port

```ts
type PortDataType =
  | "grayscale"
  | "color"
  | "rgba"
  | "sdf2d"
  | "sdf3d"
  | "sdf3d_color"
  | "material"
  | "boolean"
  | "number"
  | "vector2"
  | "vector3"
  | "unknown";

interface Port {
  id: string;
  nodeId: string;
  direction: "input" | "output";
  index: number;
  name: string;
  dataType: PortDataType;
  required: boolean;
  variadic?: boolean;
  connected: boolean;
}
```

Material Maker documents multiple port types, including grayscale, color, RGBA, and signed distance function types.[^mm-node-common]

### 8.5 Parameter

```ts
type ParameterValue =
  | string
  | number
  | boolean
  | { kind: "color"; r: number; g: number; b: number; a: number }
  | { kind: "vector2"; x: number; y: number }
  | { kind: "vector3"; x: number; y: number; z: number }
  | { kind: "gradient"; stops: GradientStop[] }
  | { kind: "curve"; points: CurvePoint[] }
  | { kind: "expression"; source: string }
  | null;
```

### 8.6 Graph snapshot

A graph snapshot should include:

- project ID and revision;
- graph metadata;
- all nodes;
- all connections;
- current selection;
- hierarchy;
- output nodes;
- unresolved references;
- catalog version;
- hash of canonical serialized content.

### 8.7 Graph patch

```ts
interface GraphPatch {
  patchVersion: "1";
  projectId: string;
  expectedRevision: number;
  idempotencyKey: string;
  label: string;
  dryRun: boolean;
  operations: GraphOperation[];
  validationPolicy: "none" | "structural" | "standard" | "strict";
  rollbackOnWarningCodes?: string[];
}
```

Supported operation types:

```text
node.create
node.delete
node.duplicate
node.move
node.resize
node.rename
node.minimize
node.set_parameter
node.set_expression
node.set_seed
connection.create
connection.delete
selection.set
comment.create
comment.update
subgraph.create
subgraph.update
remote.create
remote.bind
layout.apply
material.configure_output
export.configure_target
```

### 8.8 Jobs

Long-running operations such as preview rendering, mesh-map generation, material export, or batch validation return a job.

```ts
interface Job {
  id: string;
  type: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress?: number;
  message?: string;
  artifacts: Artifact[];
  diagnostics: Diagnostic[];
}
```

---

## 9. Native bridge protocol

### 9.1 Transport

Recommended initial transport:

- loopback WebSocket;
- JSON-RPC 2.0 messages;
- randomly selected port;
- session token written to a permission-restricted runtime file;
- optional named pipe or Unix domain socket in later releases.

Alternative:

- loopback HTTP with server-sent events;
- local file queue only as an emergency fallback.

### 9.2 Handshake

MCP server sends:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "bridge.initialize",
  "params": {
    "protocolVersion": "1.0",
    "client": {
      "name": "materialpilot-mcp",
      "version": "0.1.0"
    },
    "token": "<ephemeral-token>",
    "requestedCapabilities": [
      "application.read",
      "project.read",
      "graph.read",
      "graph.write",
      "preview.read",
      "export.write"
    ]
  }
}
```

Bridge returns:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "1.0",
    "instanceId": "mmi_...",
    "materialMakerVersion": "1.7",
    "godotVersion": "4.5.1",
    "capabilities": {},
    "limits": {
      "maxPatchOperations": 500,
      "maxPayloadBytes": 8388608,
      "maxConcurrentJobs": 2
    }
  }
}
```

### 9.3 Events

The bridge emits:

```text
application.started
application.stopping
project.opened
project.closed
project.activated
project.changed
project.saved
graph.changed
selection.changed
preview.invalidated
preview.rendered
export.started
export.progress
export.completed
job.progress
job.completed
transaction.committed
transaction.rolled_back
diagnostic.created
capabilities.changed
```

### 9.4 Request metadata

Every mutating request includes:

```json
{
  "requestId": "req_...",
  "idempotencyKey": "idem_...",
  "expectedRevision": 42,
  "actor": {
    "type": "mcp-agent",
    "sessionId": "session_..."
  },
  "approvalToken": "optional"
}
```

### 9.5 Error model

Standard error codes:

```text
APPLICATION_NOT_RUNNING
BRIDGE_NOT_AUTHENTICATED
CAPABILITY_NOT_AVAILABLE
PROJECT_NOT_FOUND
PROJECT_TYPE_UNSUPPORTED
PROJECT_DIRTY_CONFLICT
REVISION_CONFLICT
NODE_NOT_FOUND
NODE_TYPE_NOT_FOUND
PORT_NOT_FOUND
PORT_TYPE_MISMATCH
CONNECTION_ALREADY_EXISTS
CONNECTION_WOULD_CREATE_INVALID_CYCLE
PARAMETER_NOT_FOUND
PARAMETER_TYPE_MISMATCH
PARAMETER_OUT_OF_RANGE
PATH_OUTSIDE_WORKSPACE
OVERWRITE_NOT_ALLOWED
SHADER_CODE_NOT_ALLOWED
TRANSACTION_FAILED
ROLLBACK_FAILED
RENDER_FAILED
EXPORT_FAILED
JOB_CANCELLED
TIMEOUT
INTERNAL_ERROR
```

Each error must include:

- safe user message;
- machine-readable code;
- retryability;
- affected entity IDs;
- diagnostics;
- correlation ID;
- optional repair suggestion.

---

## 10. MCP server design

### 10.1 MCP transports

Support:

1. **STDIO**, the default for local Codex and local desktop clients.
2. **Streamable HTTP**, optional for local network or managed remote use.

Codex currently supports both STDIO and Streamable HTTP MCP servers, including bearer and OAuth authentication for HTTP servers.[^codex-mcp]

STDIO rules:

- never log to stdout;
- write structured logs to stderr or rotating files;
- reserve stdout exclusively for MCP JSON-RPC messages.[^mcp-build]

### 10.2 MCP server instructions

Initialization instructions should tell the agent:

- inspect before modifying;
- prefer workflow tools for normal tasks;
- use `graph_apply_patch` for multi-node edits;
- include `expectedRevision`;
- render and validate after meaningful graph changes;
- do not overwrite project files without explicit permission;
- do not generate custom shader code unless capability and policy allow it;
- use transactions and snapshots;
- report uncertainty about artistic choices;
- avoid declaring visual success based only on graph structure.

### 10.3 Dynamic capability registration

Tools should appear or disappear based on context.

Examples:

- painting tools appear only for a painting project;
- custom shader write tools disappear in restricted mode;
- export tools reflect installed targets;
- preview model tools depend on the active panel and project;
- website/library upload tools remain disabled by default.

MCP supports dynamic capability lists and list-change notifications. Use them when project context changes.[^mcp-architecture]

### 10.4 Tool annotations and safety metadata

Every tool should declare:

- read-only or mutating;
- destructive;
- idempotent;
- requires approval;
- long-running;
- network access;
- filesystem access;
- custom-code execution;
- expected side effects.

### 10.5 Progress and cancellation

Operations over approximately one second should report progress:

```text
rendering graph
generating albedo
generating roughness
generating normal
packing ORM
writing export metadata
```

Cancellation should propagate from MCP to the bridge job.

---

## 11. Complete MCP tool catalog

The tool list below is the desired production surface. Tools can be introduced gradually, but schemas should be designed as one coherent API.

## 11.1 Application and connection tools

### `app_get_status`

Returns:

- running state;
- Material Maker version;
- Godot version;
- bridge version;
- active instance;
- connected project count;
- capability summary;
- permission mode.

Read-only.

### `app_list_instances`

Lists multiple running Material Maker instances.

### `app_select_instance`

Chooses the active instance for the MCP session.

### `app_get_capabilities`

Returns the complete capability manifest and limits.

### `app_get_preferences`

Returns MaterialPilot-safe application preferences.

### `app_set_safe_preferences`

Changes only allowlisted settings such as:

- preview resolution;
- validation strictness;
- approval mode;
- autosnapshot count;
- default export directory.

### `app_ping`

Health and latency check.

---

## 11.2 Workspace and project tools

### `workspace_get`

Returns configured roots, read/write permissions, and output rules.

### `workspace_set_roots`

Requires explicit user approval. Cannot silently broaden roots.

### `project_list`

Lists open tabs and projects.

### `project_get_active`

Returns active project summary.

### `project_create_material`

Creates a new material project.

### `project_create_painting`

Creates a painting project from a permitted model path.

### `project_open`

Opens `.ptex` or `.mmpp` within configured roots.

### `project_close`

Supports save, discard, or cancel policy.

### `project_activate`

Activates a tab.

### `project_save`

Saves current path.

### `project_save_as`

Requires allowed destination and overwrite policy.

### `project_reload`

Reloads from disk after conflict checks.

### `project_get_metadata`

Returns type, path, revision, dirty state, output summary, and compatibility.

### `project_create_snapshot`

Creates a named internal and optional disk snapshot.

### `project_restore_snapshot`

Destructive and approval-gated.

### `project_compare_snapshot`

Returns structural diff.

### `project_validate`

Runs selected validation profile.

### `project_export_manifest`

Returns the files expected from configured outputs.

---

## 11.3 Graph observation tools

### `graph_get_summary`

Compact graph statistics:

- node count;
- connection count;
- output nodes;
- disconnected components;
- selected nodes;
- warnings;
- estimated complexity.

### `graph_get_snapshot`

Returns full canonical graph state.

Parameters:

- include parameter values;
- include metadata;
- include hidden/internal nodes;
- include binary references;
- pagination or compression options.

### `graph_get_hierarchy`

Returns subgraph and group hierarchy.

### `graph_get_selection`

Returns selected nodes and focus.

### `graph_get_bounds`

Returns graph bounding rectangle and viewport.

### `graph_find_nodes`

Filters by:

- type;
- name;
- parameter;
- output connectivity;
- warning code;
- graph region;
- selected state.

### `graph_trace_dependencies`

Traverses upstream or downstream dependencies.

### `graph_explain_path`

Returns the transformation path from one node or source to an output.

### `graph_diff`

Compares current graph against snapshot, file, or revision.

### `graph_get_statistics`

Returns:

- node type distribution;
- longest dependency path;
- fan-in and fan-out;
- unused nodes;
- repeated substructures;
- render cost estimates;
- graph readability metrics.

---

## 11.4 Node catalog tools

### `catalog_list_categories`

Categories may include:

- material;
- simple;
- pattern;
- noise;
- filter;
- transform;
- workflow;
- miscellaneous;
- 3D;
- custom;
- library;
- paint brush.

### `catalog_search_nodes`

Searches name, aliases, description, tags, port types, and parameter names.

### `catalog_get_node_type`

Returns a complete typed descriptor:

- stable `typeId`;
- upstream ID;
- display name;
- category;
- description;
- inputs;
- outputs;
- parameters;
- defaults;
- constraints;
- compatibility;
- examples;
- documentation reference;
- safety classification;
- performance notes.

### `catalog_get_compatible_nodes`

Given an output port, returns node inputs that can accept it.

### `catalog_get_conversion_paths`

Finds conversion chains between port types or material concepts.

### `catalog_refresh`

Rebuilds catalog from installed libraries and custom nodes.

### `catalog_export`

Exports a machine-readable catalog for tests or third-party clients.

### `catalog_get_version`

Returns hash and upstream compatibility.

---

## 11.5 Atomic node editing tools

### `node_create`

Creates a node using a stable `typeId`, position, initial values, and optional client-generated temporary ID.

### `node_get`

Returns complete node state.

### `node_update`

Updates allowed common properties.

### `node_delete`

Supports cascade options:

- reject if connected;
- disconnect then delete;
- reconnect compatible single-input chain where possible.

### `node_duplicate`

Supports preserving incoming or outgoing connections where safe.

### `node_move`

Moves one or more nodes.

### `node_resize`

For comments, subgraphs, and resizable nodes.

### `node_rename`

Changes label without changing stable ID.

### `node_set_minimized`

### `node_set_seed`

### `node_randomize_seed`

### `node_set_parameter`

Validates type, range, enum, and expression policy.

### `node_set_parameters`

Batch parameter update.

### `node_reset_parameter`

### `node_set_expression`

Expression parsing and safety validation required.

### `node_get_generated_shader`

Read-only by default. Returns generated shader text and source mapping if supported.

### `node_regenerate`

Forces invalidation and regeneration.

### `node_select`

### `node_focus`

Moves graph viewport to node.

---

## 11.6 Connection and port tools

### `port_get`

### `port_list_connections`

### `connection_create`

Checks:

- source and target exist;
- direction is correct;
- data types are compatible;
- cardinality is valid;
- connection is not duplicate;
- cycle policy.

### `connection_delete`

### `connection_replace`

Atomically replaces an input source.

### `connection_insert_node`

Creates and inserts a node between two connected ports.

### `connection_reroute`

Creates or updates reroute nodes.

### `connection_validate`

Explains compatibility without mutation.

### `connection_find_open_inputs`

### `connection_find_output_consumers`

---

## 11.7 Graph transaction and patch tools

### `graph_plan_patch`

Dry-run helper that validates and estimates a patch without applying it.

Returns:

- normalized operations;
- warnings;
- expected revision;
- affected outputs;
- estimated render invalidation;
- permission requirements.

### `graph_apply_patch`

Primary production editing tool.

Required behavior:

1. check capability and permission;
2. verify project revision;
3. validate schema;
4. resolve temporary IDs;
5. create pre-transaction snapshot;
6. apply inside Material Maker undo transaction;
7. run structural validation;
8. commit or roll back;
9. emit graph-changed event;
10. return revision and diff.

### `graph_undo`

Undo one or more MaterialPilot transactions.

### `graph_redo`

### `graph_list_transactions`

### `graph_get_transaction`

### `graph_rollback_transaction`

### `graph_compact_history`

Approval-gated.

---

## 11.8 Layout and documentation tools

### `layout_auto`

Strategies:

- left-to-right;
- output-centered;
- layered DAG;
- compact;
- preserve groups;
- minimize crossing;
- align by semantic stage.

### `layout_align`

### `layout_distribute`

### `layout_pack_selection`

### `layout_create_stage_columns`

Creates visual stages such as:

```text
Sources -> Structure -> Detail -> Color -> Surface -> Output
```

### `comment_create`

Material Maker supports comment nodes for graph documentation.[^mm-comment]

### `comment_update`

### `comment_delete`

### `comment_document_selection`

Creates a generated comment explaining selected nodes.

### `graph_name_semantic_stages`

Adds labels and comments without changing output.

### `graph_create_readme`

Creates a Markdown explanation outside the project.

---

## 11.9 Subgraph, group, and reusable component tools

### `subgraph_create_from_selection`

### `subgraph_open`

### `subgraph_close`

### `subgraph_expose_input`

### `subgraph_expose_output`

### `subgraph_set_parameter`

### `subgraph_ungroup`

### `subgraph_save_to_library`

### `subgraph_instantiate`

### `subgraph_get_interface`

### `subgraph_validate_interface`

These tools require a compatibility adapter because upstream representation may change.

---

## 11.10 Remote controls and artist parameters

Material Maker has remote parameter concepts and UI links between controls and source parameters in release 1.7.[^mm-release]

### `remote_create_control`

Creates an artist-facing parameter.

Types:

- slider;
- integer;
- checkbox;
- color;
- enum;
- vector;
- seed;
- gradient where supported.

### `remote_bind_parameter`

### `remote_unbind_parameter`

### `remote_get_bindings`

### `remote_set_value`

### `remote_group_controls`

### `remote_rename_control`

### `remote_set_range`

### `remote_generate_controls`

Analyzes selected graph and proposes high-value controls.

### `remote_validate_controls`

Detects:

- dead bindings;
- duplicate controls;
- unsafe ranges;
- unclear names;
- controls with no visible effect.

---

## 11.11 Material output and PBR tools

### `material_list_outputs`

### `material_get_output`

### `material_create_output`

### `material_configure_output`

Supports:

- texture resolution;
- output channel options;
- displacement preview;
- export targets;
- file naming.

### `material_connect_channel`

Channels:

- albedo;
- metallic;
- roughness;
- emission;
- normal;
- depth/height;
- ambient occlusion where supported.

Material Maker describes these PBR channels and can paint them as well.[^mm-intro]

### `material_disconnect_channel`

### `material_get_channel_lineage`

### `material_validate_pbr`

Checks:

- required channels;
- normal map format;
- metallic/roughness type;
- ORM packing;
- range and uniformity;
- channel source consistency;
- displacement configuration.

Material Maker's normal-node documentation warns that its internal normal format differs from standard OpenGL and DirectX maps, so validation must understand the intended output path.[^mm-normal]

### `material_create_standard_output`

Creates a valid baseline PBR output.

### `material_convert_normal_format`

### `material_pack_orm`

### `material_unpack_orm`

### `material_generate_variations`

Material Maker includes Variations and Controlled Variations nodes.[^mm-variations][^mm-controlled-variations]

### `material_compare_variations`

Renders contact sheets and reports parameter differences.

---

## 11.12 Preview and inspection tools

### `preview_get_configuration`

### `preview_set_resolution`

### `preview_render_2d`

Returns an MCP image resource or artifact URI.

### `preview_render_node_output`

Renders a specific node output.

### `preview_render_material_channels`

Returns one or more channel images.

### `preview_render_3d`

Parameters:

- model;
- environment;
- camera;
- rotation;
- UV scale;
- tessellation;
- tonemap;
- resolution.

### `preview_list_models`

### `preview_set_model`

### `preview_import_model`

Workspace-restricted.

### `preview_configure_model`

### `preview_list_environments`

### `preview_set_environment`

### `preview_configure_environment`

### `preview_capture_turntable`

Long-running job producing frames or video where supported.

### `preview_get_histogram`

Material Maker has a histogram panel for the selected texture.[^mm-overview]

### `preview_analyze_edges`

Deterministic seamlessness heuristic.

### `preview_analyze_channels`

Checks:

- empty image;
- clipping;
- low variance;
- alpha usage;
- roughness range;
- normal direction;
- resolution;
- edge mismatch.

### `preview_compare`

Creates side-by-side or difference images across revisions or variations.

---

## 11.13 Mesh-map tools

The 3D preview can generate mesh normal, inverse UV, curvature, ambient occlusion, and thickness maps for custom meshes.[^mm-preview3d]

### `meshmap_list_supported`

### `meshmap_generate_normal`

### `meshmap_generate_inverse_uv`

### `meshmap_generate_curvature`

### `meshmap_generate_ambient_occlusion`

### `meshmap_generate_thickness`

### `meshmap_generate_all`

### `meshmap_get_status`

### `meshmap_save`

### `meshmap_validate`

These are long-running, cancellable jobs.

---

## 11.14 Export tools

### `export_list_targets`

At minimum:

- Blender;
- Godot;
- Unity;
- Unreal;
- raw textures;
- quick export.

Material Maker's CLI documents these target engines.[^mm-cli]

### `export_get_target_schema`

Returns required settings and produced artifacts.

### `export_configure_target`

### `export_validate`

Preflight checks:

- destination allowed;
- overwrite policy;
- required outputs;
- file name template;
- resolution;
- normal convention;
- target compatibility.

### `export_material`

### `export_quick`

### `export_batch`

### `export_get_job`

### `export_cancel_job`

### `export_get_manifest`

### `export_verify_artifacts`

Checks files exist, sizes are nonzero, resolutions match, and expected naming is present.

### `export_open_directory`

Optional local-only convenience, approval-gated.

### `export_create_package`

Creates:

```text
material.ptex
textures/
preview/
manifest.json
README.md
license metadata
```

### `export_compare_targets`

Shows target-specific differences.

The export node can configure resolution, format, and filename templates, including PNG, JPG, WebP, or EXR.[^mm-export-node]

---

## 11.15 Library and asset tools

Material Maker can download materials, brushes, environments, and custom nodes from its website.[^mm-sharing]

Production policy:

- browsing and inspection may be enabled;
- downloads require network permission;
- uploads are disabled by default;
- third-party asset licenses must be surfaced.

### `library_list_local`

### `library_search_local`

### `library_get_item`

### `library_add_selection`

### `library_remove_item`

### `library_create_collection`

### `library_list_remote`

### `library_search_remote`

### `library_download_item`

### `library_inspect_license`

### `library_install_item`

### `library_update_item`

### `library_upload_item`

Deferred, approval-gated, and not enabled in the default release.

### `library_export_item`

### `library_validate_item`

---

## 11.16 Custom node and shader tools

Material Maker supports new nodes created from grouped existing nodes or custom shader code.[^godot-showcase][^mm-shader-nodes]

Security classification:

- grouped-node creation: medium risk;
- expression editing: medium risk;
- custom shader code: high risk;
- file-backed code or external scripts: very high risk.

### `custom_node_create_from_selection`

### `custom_node_get_definition`

### `custom_node_validate_definition`

### `custom_node_update_metadata`

### `custom_node_set_interface`

### `custom_node_save_to_library`

### `custom_node_export_definition`

### `shader_node_create`

Disabled unless `customCodePolicy` permits it.

### `shader_node_get_code`

### `shader_node_update_code`

### `shader_node_validate_code`

Validation should include:

- syntax parse;
- forbidden directives or APIs;
- resource limits;
- generated shader compilation;
- timeout;
- output contract;
- diagnostics with line mapping.

### `shader_node_compile`

### `shader_node_get_diagnostics`

### `shader_node_generate_preview`

Custom code must never silently access arbitrary files or network services.

---

## 11.17 Diagnostics and performance tools

### `diagnostics_get_recent`

### `diagnostics_get_by_entity`

### `diagnostics_clear`

### `performance_get_graph_metrics`

### `performance_get_node_metrics`

### `performance_capture_profile`

### `performance_find_hotspots`

### `performance_estimate_patch_cost`

### `performance_compare_revisions`

### `graph_find_redundant_nodes`

### `graph_find_duplicate_subgraphs`

### `graph_find_unreachable_nodes`

### `graph_find_expensive_chains`

### `graph_optimize_safe`

Only transformations proven output-equivalent should be automatic.

### `graph_optimize_propose`

Returns suggested changes with risk and expected benefit.

---

## 11.18 Painting project tools

Painting should be a separate capability tier because strokes and layer operations are more stateful and difficult to reverse than graph edits.

Material Maker painting projects support brushes, brush parameters, layers, procedural layers, mask layers, and PBR channel painting.[^mm-paint][^mm-layers][^mm-first-steps]

### Read-only painting tools

- `paint_get_project`
- `paint_get_model`
- `paint_get_layers`
- `paint_get_layer`
- `paint_get_active_layer`
- `paint_get_brush`
- `paint_list_brushes`
- `paint_get_brush_parameters`
- `paint_get_mask`
- `paint_render_preview`
- `paint_get_channel_status`

### Layer tools

- `paint_layer_create`
- `paint_layer_duplicate`
- `paint_layer_delete`
- `paint_layer_reorder`
- `paint_layer_rename`
- `paint_layer_set_visibility`
- `paint_layer_set_opacity`
- `paint_layer_set_blend_mode`
- `paint_layer_create_group`
- `paint_layer_create_mask`
- `paint_layer_create_procedural`
- `paint_layer_set_active`

### Brush tools

- `paint_brush_select`
- `paint_brush_set_parameter`
- `paint_brush_create_from_graph`
- `paint_brush_save_to_library`
- `paint_brush_validate`

### Stroke tools

- `paint_stroke_preview`
- `paint_stroke_apply`
- `paint_stroke_undo`
- `paint_fill`
- `paint_apply_procedural_layer`

Restrictions:

- direct stroke generation should remain experimental;
- every stroke stores sufficient undo data;
- maximum stroke count and affected pixel area are limited;
- model-space and UV-space coordinates must be explicit;
- preview-before-apply should be the default.

### Painting export tools

- `paint_export_textures`
- `paint_export_project_package`
- `paint_validate_channels`

---

## 11.19 High-level workflow tools

Atomic tools provide control. Workflow tools provide usability.

### `workflow_create_material`

Input:

```json
{
  "specification": {
    "name": "Wet Cracked Stone",
    "style": ["realistic", "aged"],
    "features": ["cracks", "wet patches", "mineral variation"],
    "channels": ["albedo", "roughness", "normal", "height", "ao"],
    "tileable": true,
    "controls": ["crack_density", "wetness", "stone_scale"],
    "target": "Blender",
    "resolution": 2048
  },
  "mode": "assisted"
}
```

Workflow:

1. inspect catalog;
2. create material plan;
3. dry-run patch;
4. request approval where required;
5. apply transaction;
6. render previews;
7. validate;
8. attempt bounded repair;
9. expose controls;
10. save and optionally export.

### `workflow_modify_material`

Adds or changes a feature while preserving unrelated graph areas.

### `workflow_repair_material`

Uses deterministic diagnostics and agent planning.

### `workflow_explain_material`

Produces a stage-based explanation and annotated graph.

### `workflow_create_variations`

### `workflow_prepare_for_engine`

### `workflow_clean_and_document_graph`

### `workflow_convert_reference_to_plan`

Produces a plan, not direct image matching in the first stable release.

### `workflow_batch_validate_library`

### `workflow_batch_export_library`

### `workflow_create_painting_setup`

Creates layers, brushes, and project configuration but does not automatically paint by default.

---

## 12. MCP resources

Resources should expose state and artifacts without forcing the model to invoke action tools for every read.

Recommended URI scheme:

```text
materialmaker://
```

### 12.1 Static resources

```text
materialmaker://server/about
materialmaker://server/capabilities
materialmaker://server/policy
materialmaker://catalog/version
materialmaker://catalog/categories
materialmaker://docs/tool-guidance
materialmaker://docs/graph-patch
materialmaker://docs/security
```

### 12.2 Application resources

```text
materialmaker://instances
materialmaker://instance/{instanceId}/status
materialmaker://instance/{instanceId}/diagnostics
```

### 12.3 Project resources

```text
materialmaker://projects
materialmaker://project/{projectId}/manifest
materialmaker://project/{projectId}/graph
materialmaker://project/{projectId}/hierarchy
materialmaker://project/{projectId}/selection
materialmaker://project/{projectId}/validation
materialmaker://project/{projectId}/transactions
materialmaker://project/{projectId}/export-manifest
```

### 12.4 Node resources

```text
materialmaker://project/{projectId}/node/{nodeId}
materialmaker://catalog/node/{typeId}
materialmaker://project/{projectId}/node/{nodeId}/shader
materialmaker://project/{projectId}/node/{nodeId}/diagnostics
```

### 12.5 Preview resources

```text
materialmaker://project/{projectId}/preview/2d/latest
materialmaker://project/{projectId}/preview/3d/latest
materialmaker://project/{projectId}/preview/channel/{channel}
materialmaker://project/{projectId}/preview/node/{nodeId}/{portIndex}
materialmaker://job/{jobId}/artifact/{artifactId}
```

Use appropriate MIME types:

- `application/json`;
- `text/markdown`;
- `image/png`;
- `image/webp`;
- `text/x-glsl`;
- `application/zip`.

### 12.6 Resource subscriptions

Where supported, notify clients when:

- graph revision changes;
- active project changes;
- preview becomes stale or is regenerated;
- validation report changes;
- export job completes;
- capability manifest changes.

Resources are a first-class MCP mechanism for providing contextual, file-like data.[^mcp-resources]

---

## 13. MCP prompts

Prompts are optional workflow templates discoverable by users and compatible clients.[^mcp-prompts]

Recommended prompts:

### `create_procedural_material`

Arguments:

- description;
- target engine;
- resolution;
- style;
- required controls;
- approval mode.

### `analyze_existing_graph`

Produces:

- graph summary;
- stage map;
- detected outputs;
- issues;
- improvement plan.

### `repair_broken_material`

Guides inspect, validate, dry-run, repair, render, and compare.

### `optimize_graph_without_visual_change`

Requires before/after preview comparison and rollback on meaningful difference.

### `prepare_material_for_blender`

Checks normal convention, ORM expectations, naming, and export output.

### `create_material_variation_set`

Uses seed or controlled-variation mechanisms.

### `document_material_for_team`

Adds comments and generates a Markdown usage guide.

### `create_custom_node_safely`

Only available when custom code is enabled.

### `setup_painting_project`

Creates the model, layers, masks, brush, and export configuration.

---

## 14. Node catalog strategy

A production agent cannot effectively use hundreds of nodes from names alone.

### 14.1 Catalog sources

Generate the catalog from:

1. Material Maker installed node definitions;
2. official documentation;
3. bridge runtime introspection;
4. curated aliases and semantic tags;
5. compatibility tests;
6. user-installed custom libraries.

### 14.2 Catalog descriptor

Each node type should contain:

```json
{
  "typeId": "mm.noise.perlin",
  "nativeId": "...",
  "displayName": "Perlin Noise",
  "category": "noise",
  "description": "...",
  "semanticTags": ["organic", "height", "variation"],
  "inputs": [],
  "outputs": [],
  "parameters": {},
  "examples": [],
  "constraints": [],
  "performance": {
    "relativeCost": "low"
  },
  "compatibility": {
    "minMaterialMakerVersion": "1.7"
  },
  "documentation": {
    "source": "official",
    "path": "..."
  }
}
```

### 14.3 Semantic ontology

Add agent-useful tags that are not limited to UI categories:

```text
macro_structure
micro_detail
mask_generation
edge_wear
distortion
color_mapping
height_to_normal
tiling_control
variation
channel_packing
output
documentation
performance_heavy
experimental
```

### 14.4 Compatibility matrix

Every catalog item records:

- introduced version;
- removed version;
- parameter changes;
- port changes;
- aliases;
- migration function;
- known upstream bugs.

### 14.5 Catalog tests

For each node type:

1. instantiate;
2. serialize;
3. deserialize;
4. set every parameter to valid boundary values;
5. reject invalid values;
6. connect compatible ports;
7. render minimal output where practical;
8. verify no bridge exception.

---

## 15. Validation system

Validation is a separate package and must work without an LLM.

### 15.1 Validation profiles

#### `structural`

- IDs;
- references;
- port direction;
- port compatibility;
- required outputs;
- graph consistency.

#### `standard`

Structural plus:

- disconnected components;
- unreachable nodes;
- invalid parameter ranges;
- unresolved custom-node dependencies;
- project-path issues;
- export configuration.

#### `strict`

Standard plus:

- PBR checks;
- preview image checks;
- graph readability;
- performance warnings;
- naming and documentation recommendations.

#### `release`

Strict plus:

- clean save;
- reproducible export;
- artifact verification;
- package manifest;
- no high-severity diagnostics.

### 15.2 Diagnostic structure

```ts
interface Diagnostic {
  id: string;
  code: string;
  severity: "info" | "warning" | "error" | "fatal";
  message: string;
  projectId: string;
  entity?: {
    type: "node" | "connection" | "parameter" | "output" | "file";
    id: string;
  };
  evidence: Record<string, unknown>;
  suggestedFixes: SuggestedFix[];
  deterministic: boolean;
}
```

### 15.3 Structural checks

- duplicate IDs;
- missing nodes;
- invalid port index;
- type mismatch;
- multiple connections to single-input port;
- prohibited cycles;
- dangling remote binding;
- invalid subgraph interface;
- unsupported node version;
- broken library reference;
- serialization mismatch.

### 15.4 Parameter checks

- invalid type;
- NaN or infinity;
- out-of-range values;
- malformed gradient;
- invalid curve;
- unsupported enum;
- invalid expression;
- inaccessible file path;
- seed policy violation.

### 15.5 PBR checks

- missing albedo or output;
- wrong normal path;
- overly uniform roughness;
- metallic values on clearly dielectric material specifications;
- clipped height;
- accidental alpha;
- missing ORM components;
- output resolution mismatch;
- inconsistent channel tileability;
- normal and height source disagreement.

These should be warnings unless objectively invalid.

### 15.6 Preview checks

- uniform image;
- all-black or all-white image;
- edge mismatch;
- histogram clipping;
- missing alpha;
- normal average strongly deviating from expected;
- unexpected resolution;
- export image unreadable;
- difference threshold after claimed "output-preserving" optimization.

### 15.7 Graph-quality checks

- unlabelled complex stages;
- excessive wire crossings;
- nodes outside main bounds;
- duplicate branches;
- dead nodes;
- extreme fan-out;
- hidden dependency through remote controls;
- output-unrelated selection;
- expensive nodes repeated unnecessarily.

### 15.8 Repair model

Suggested fixes are typed patches. Deterministic fixes can be marked safe:

```json
{
  "fixId": "fix_...",
  "risk": "safe",
  "description": "Remove unreachable node",
  "patch": {}
}
```

Artistic fixes remain proposals.

---

## 16. Transaction, undo, and recovery model

### 16.1 Transaction lifecycle

```text
CREATED
  -> VALIDATED
  -> SNAPSHOT_CREATED
  -> APPLYING
  -> POST_VALIDATING
  -> COMMITTED

Failure path:
APPLYING or POST_VALIDATING
  -> ROLLING_BACK
  -> ROLLED_BACK
```

### 16.2 Transaction record

Include:

- ID;
- label;
- actor;
- timestamp;
- pre-revision;
- post-revision;
- normalized operations;
- warnings;
- validation before and after;
- snapshot ID;
- changed entities;
- generated artifacts;
- duration;
- rollback state.

### 16.3 Native undo integration

MaterialPilot operations should appear as meaningful entries in Material Maker's undo history:

```text
MaterialPilot: Create wet-stone base graph
MaterialPilot: Add exposed wetness control
MaterialPilot: Repair normal output
```

### 16.4 Crash recovery

Persist a lightweight transaction journal before mutation.

On startup:

1. detect incomplete transaction;
2. compare project hash;
3. offer restore or discard;
4. never silently replay destructive operations.

### 16.5 Autosnapshot policy

Defaults:

- snapshot before every graph patch;
- retain last 20 per project;
- retain named snapshots indefinitely;
- disk snapshots compressed;
- never snapshot outside workspace roots.

---

## 17. Security and trust model

MCP gives models access to external systems, so user consent, privacy, and action control are central protocol principles.[^mcp-spec]

### 17.1 Threats

- unauthorized local process connects to bridge;
- malicious project comments attempt prompt injection;
- malicious custom node or shader content;
- path traversal during open/save/export;
- symlink escape;
- overwrite of user assets;
- denial of service through huge graphs or renders;
- infinite or expensive shader compilation;
- resource exfiltration through remote MCP;
- malicious downloaded community assets;
- unsafe generated filenames;
- arbitrary process execution;
- bridge exposed beyond loopback;
- replay of old approval token;
- stale revision overwrites human edits.

### 17.2 Permission modes

#### Observe

- read project and catalog;
- render existing previews if allowed;
- no mutations;
- no exports.

#### Assisted

- read freely;
- propose dry-run patches;
- user approval required for transaction;
- save/export approval based on policy;
- default mode.

#### Workspace autonomous

- mutate approved projects inside roots;
- no root changes;
- no custom code by default;
- no network downloads;
- no overwrite unless explicitly configured.

#### Developer

- custom nodes and shaders;
- advanced diagnostics;
- unsafe features individually enabled;
- prominent warning.

### 17.3 Approval classes

```text
A0: Read-only
A1: Reversible in-memory edit
A2: Project file write
A3: Export file creation
A4: Overwrite/delete
A5: Network download/upload
A6: Generated code or shader execution
A7: Workspace or security policy change
```

### 17.4 Authentication

Local bridge:

- random 256-bit token;
- runtime file readable only by current user;
- expires on application exit;
- handshake nonce;
- loopback-only listener;
- optional process identity checks where supported.

Streamable HTTP MCP:

- bearer token or OAuth;
- TLS;
- explicit allowed origins;
- no anonymous write tools;
- audit logging;
- rate limits.

### 17.5 Filesystem sandbox

Canonicalize paths before policy checks.

Policy:

- configured read roots;
- configured write roots;
- separate export roots;
- reject device paths;
- reject UNC paths unless explicitly allowed;
- resolve symlinks;
- reject parent traversal;
- safe file extensions;
- size limits;
- overwrite policy.

### 17.6 Prompt injection resistance

Treat all project text, node comments, asset metadata, and remote descriptions as untrusted data.

- label resource content as untrusted;
- never convert comments into server instructions;
- keep tool instructions static and trusted;
- do not allow project content to broaden permissions;
- surface suspicious imperative text;
- require approval for external links or downloads.

### 17.7 Custom shader sandbox

- disabled by default;
- parse and compile in constrained process where possible;
- timeout;
- memory limits;
- no external command execution;
- no arbitrary filesystem access;
- deny unsupported directives;
- preserve source and diagnostics;
- require A6 approval.

### 17.8 Audit log

Record:

- session;
- client;
- tool;
- arguments with sensitive-field redaction;
- policy decision;
- transaction;
- affected paths;
- result;
- duration;
- correlation ID.

Audit logs must not store exported textures or full project data by default.

---

## 18. Reliability and performance

### 18.1 Service-level objectives

For a stable local release:

- 99.9% successful handshake rate in compatibility tests;
- no corrupted project across the transaction suite;
- read tools under 250 ms for normal projects;
- atomic node edit under 500 ms excluding rendering;
- tool cancellation acknowledged under 500 ms;
- export errors always return structured diagnostics;
- no stdout protocol corruption;
- crash recovery succeeds for all simulated interrupted transactions.

### 18.2 Limits

Configurable defaults:

```text
max nodes returned per page: 200
max patch operations: 500
max graph snapshot JSON: 8 MB
max preview resolution: 4096
max concurrent render jobs: 1
max concurrent non-render jobs: 4
max batch files: 100
max custom shader compile time: 10 seconds
max transaction duration before warning: 30 seconds
```

### 18.3 Caching

Cache:

- node catalog;
- node descriptors;
- graph canonical snapshot by revision;
- preview artifacts by graph hash and configuration;
- validation reports by revision and profile;
- export manifests;
- documentation summaries.

Never reuse preview across incompatible versions or environment settings.

### 18.4 Backpressure

The bridge must reject excessive jobs with `RESOURCE_BUSY` instead of freezing Material Maker.

### 18.5 Timeouts

Different timeouts by operation type:

- read: 5 seconds;
- graph edit: 15 seconds;
- preview: 60 seconds;
- mesh maps: configurable up to several minutes;
- batch export: job-based with progress.

### 18.6 Graceful degradation

If live preview fails:

- graph editing remains available;
- preview tool returns diagnostic;
- export may use headless CLI fallback where safe.

If bridge connection fails:

- server exposes health and offline `.ptex` tools only;
- mutating live tools are removed dynamically.

---

## 19. Observability

### 19.1 Structured logs

Fields:

```text
timestamp
level
component
event
session_id
instance_id
project_id
transaction_id
tool_name
request_id
correlation_id
duration_ms
error_code
```

### 19.2 Metrics

Local opt-in metrics:

- calls by tool;
- latency percentiles;
- failure rate;
- rollback rate;
- render duration;
- export duration;
- graph size;
- catalog refresh duration;
- bridge reconnect count.

No project content should be sent externally without explicit consent.

### 19.3 Diagnostics bundle

CLI command:

```bash
materialpilot diagnostics collect
```

Produces a redacted archive:

- versions;
- configuration;
- recent logs;
- capability manifest;
- crash trace;
- optional project metadata, not project content;
- test connection report.

### 19.4 Health commands

```bash
materialpilot doctor
materialpilot bridge status
materialpilot catalog verify
materialpilot mcp inspect
materialpilot project lint path/to/file.ptex
```

---

## 20. Testing strategy

## 20.1 Test pyramid

```text
Large number:
- domain unit tests
- schema tests
- validator tests
- security policy tests
- serializer tests

Medium number:
- bridge adapter tests
- MCP contract tests
- catalog compatibility tests
- headless Material Maker integration tests

Small number:
- packaged cross-platform end-to-end tests
- real-agent scenario tests
- visual regression tests
```

### 20.2 Unit tests

Test:

- every schema;
- every error code;
- ID generation;
- canonical graph hashing;
- path policies;
- permission decisions;
- patch normalization;
- idempotency;
- optimistic concurrency;
- graph algorithms;
- port compatibility;
- diagnostic generation.

### 20.3 Property-based tests

Generate random valid and invalid graphs.

Properties:

- serialization round-trip preserves canonical graph;
- a rolled-back patch restores graph hash;
- duplicate idempotency key does not duplicate mutation;
- invalid connection never commits;
- safe optimizer preserves preview within threshold;
- path policy never permits escaped path.

### 20.4 Fuzz tests

Fuzz:

- bridge JSON-RPC payloads;
- graph patch schemas;
- `.ptex` parser;
- `.mmpp` parser;
- expressions;
- gradients and curves;
- filenames;
- custom node definitions.

### 20.5 Golden fixtures

Minimum fixture set:

```text
empty-material.ptex
simple-noise.ptex
standard-pbr.ptex
displacement-material.ptex
remote-controls.ptex
subgraphs.ptex
custom-node.ptex
variations.ptex
complex-250-node.ptex
invalid-dangling-connection.ptex
invalid-port-type.ptex
invalid-remote-binding.ptex
painting-basic.mmpp
painting-layers.mmpp
painting-procedural.mmpp
```

### 20.6 Bridge contract tests

For each bridge method:

1. valid request;
2. missing required field;
3. invalid type;
4. stale revision;
5. permission denied;
6. cancellation;
7. timeout;
8. native exception;
9. idempotent retry;
10. event emission.

### 20.7 MCP conformance tests

- initialization;
- tool list;
- resource list;
- prompt list;
- tool call;
- progress;
- cancellation;
- errors;
- list changed;
- STDIO log safety;
- Streamable HTTP authentication.

### 20.8 End-to-end scenarios

#### Scenario A: Create material

- launch Material Maker;
- connect MCP;
- create project;
- apply known graph patch;
- render preview;
- validate;
- save;
- export Blender target;
- verify files;
- reopen and compare graph hash.

#### Scenario B: Human-agent conflict

- inspect revision 10;
- human moves a node to revision 11;
- agent submits expected revision 10;
- receive conflict;
- re-read and rebase patch.

#### Scenario C: Failure rollback

- patch creates valid nodes then invalid connection;
- transaction fails;
- graph hash equals original;
- undo history contains no partial transaction.

#### Scenario D: Custom node security

- generated shader violates policy;
- request rejected;
- no code compiled;
- audit entry created.

#### Scenario E: Painting layer edit

- create layer;
- update properties;
- save;
- reopen;
- verify layer order and data.

### 20.9 Visual regression tests

Use fixed:

- Material Maker version;
- Godot renderer;
- GPU or software rendering environment where practical;
- preview model;
- environment;
- camera;
- seed;
- resolution.

Compare with perceptual threshold rather than exact PNG bytes where renderer variation exists.

### 20.10 Compatibility matrix

Test release branches against:

| Material Maker | Godot | Windows | Linux | macOS |
|---|---|---:|---:|---:|
| 1.7 | 4.5.1 | required | required | required |
| next stable | upstream | preview | preview | preview |
| master | upstream | nightly | nightly | nightly |

Support policy:

- current stable;
- previous stable for six months where practical;
- upstream master on best-effort nightly tests.

---

## 21. CI/CD and release engineering

### 21.1 CI jobs

On every pull request:

- formatting;
- lint;
- type check;
- unit tests;
- schema compatibility;
- security policy tests;
- dependency audit;
- license check;
- build MCP packages;
- bridge static tests;
- selected headless integration tests.

Nightly:

- build Material Maker integration on all platforms;
- run compatibility suite;
- run visual regression subset;
- validate node catalog against upstream;
- fuzz parsers;
- test installer.

Release:

- full matrix;
- package artifacts;
- generate checksums;
- generate SBOM;
- sign artifacts where available;
- publish npm packages;
- publish GitHub release;
- build docs;
- attach compatibility report.

### 21.2 Versioning

Use semantic versioning for MaterialPilot.

Also publish compatibility metadata:

```json
{
  "materialpilot": "1.2.0",
  "bridgeProtocol": "1.0",
  "mcpSpecTested": "2025-11-25",
  "materialMaker": ["1.7"],
  "godot": ["4.5.1"]
}
```

### 21.3 Schema evolution

- additive fields are backward compatible;
- removed or renamed fields require a new major schema version;
- tools keep stable names where possible;
- deprecated tools remain for at least one minor cycle;
- bridge protocol negotiates versions.

### 21.4 Distribution

Recommended options:

#### Windows

- portable ZIP;
- installer;
- Scoop manifest;
- Chocolatey package later.

#### macOS

- signed app bundle where possible;
- Homebrew cask later.

#### Linux

- tarball;
- AppImage or Flatpak extension;
- package manager integration later.

MCP server:

- npm package;
- single executable through `pkg` or similar only if reliable;
- Docker image for remote/headless service, not for native UI bridge.

### 21.5 Reproducible builds

- lock dependencies;
- pin Node and pnpm;
- pin Godot;
- record upstream Material Maker commit;
- generate checksums;
- publish build provenance.

---

## 22. Installation and onboarding

### 22.1 Desired user experience

```text
1. Install MaterialPilot-enabled Material Maker build or addon.
2. Install `@materialpilot/mcp-server`.
3. Run `materialpilot doctor`.
4. Add one MCP configuration entry.
5. Launch Material Maker.
6. Ask the client to call `app_get_status`.
```

### 22.2 Codex configuration

Document both CLI and app workflows, using the current Codex MCP configuration mechanism from official documentation.[^codex-mcp]

### 22.3 First-run wizard

Native side panel:

```text
MaterialPilot
Status: Connected

Permission mode:
[Observe] [Assisted] [Workspace autonomous]

Workspace:
C:\Users\Sam\MaterialPilotWorkspace

Allowed exports:
C:\Users\Sam\MaterialPilotWorkspace\exports

Custom shader generation:
Disabled

[Run connection test]
```

### 22.4 Sample project

Ship a project that demonstrates:

- noise and pattern nodes;
- PBR output;
- remote controls;
- variations;
- comments;
- validation issue;
- export target.

### 22.5 Troubleshooting

Documentation must cover:

- bridge not found;
- port blocked;
- wrong Material Maker version;
- Godot renderer error;
- MCP STDIO logging issue;
- project outside root;
- stale revision;
- export target failure;
- custom node missing;
- preview timeout.

---

## 23. Documentation plan

### User documentation

- installation;
- Codex setup;
- Claude Code setup;
- permission modes;
- first material;
- modifying a graph;
- validating;
- exporting;
- painting workflows;
- troubleshooting.

### Tool reference

Generated from schemas:

- purpose;
- arguments;
- return value;
- safety class;
- examples;
- errors;
- availability conditions.

### Architecture documentation

- system context;
- native bridge;
- domain model;
- transaction model;
- event model;
- security;
- compatibility.

### Contributor documentation

- build from source;
- run tests;
- add bridge method;
- add MCP tool;
- add node descriptor;
- add validation rule;
- update compatibility adapter;
- release process.

### Design documents

Maintain ADRs for major choices.

### Example gallery

Each example includes:

- prompt;
- before screenshot;
- after screenshot;
- graph;
- exported maps;
- transaction log;
- validation report;
- limitations.

---

## 24. Development roadmap

The roadmap uses capability gates rather than rushed calendar estimates.

## Phase 0: Discovery and upstream mapping

Deliverables:

- build Material Maker 1.7 from source;
- map project, graph, node factory, serialization, undo, preview, export, painting, and library code paths;
- identify stable extension points;
- document `.ptex` and `.mmpp` structures;
- create initial compatibility ADR;
- open an upstream discussion before large invasive changes.

Exit criteria:

- one node can be introspected and created through a minimal native call;
- one project can be read, saved, and reopened without data loss;
- export can be triggered programmatically.

## Phase 1: Domain SDK and offline tooling

Deliverables:

- TypeScript domain package;
- schemas;
- `.ptex` parser and serializer;
- graph validator;
- node catalog extractor;
- CLI linter;
- golden fixtures.

Exit criteria:

- round-trip fixture suite passes;
- malformed projects fail safely;
- canonical graph diff works.

## Phase 2: Read-only native bridge

Deliverables:

- authenticated local bridge;
- application status;
- project list;
- active project;
- graph snapshot;
- node catalog;
- diagnostics;
- event stream.

Exit criteria:

- no mutation methods;
- bridge survives project open/close/reload;
- 24-hour soak test without disconnect or leak;
- Codex can inspect and explain a graph.

## Phase 3: Safe atomic graph editing

Deliverables:

- node create/delete/update;
- connection create/delete;
- parameter edits;
- optimistic concurrency;
- transaction journal;
- native undo;
- idempotency.

Exit criteria:

- rollback suite passes;
- stale revisions never overwrite human edits;
- all supported core nodes pass catalog contract tests.

## Phase 4: Graph patches and high-level workflows

Deliverables:

- dry-run;
- `graph_apply_patch`;
- temporary ID resolution;
- layout engine;
- documentation tools;
- material creation workflow;
- repair workflow.

Exit criteria:

- complex fixture generated from one patch;
- failure at any operation leaves graph unchanged;
- agent can create a standard material and repair a deliberate defect.

## Phase 5: Preview, validation, and visual comparison

Deliverables:

- 2D preview;
- node-output preview;
- 3D preview;
- histogram;
- channel analysis;
- edge tileability heuristic;
- before/after comparison;
- preview resources.

Exit criteria:

- preview artifacts are addressable as MCP resources;
- cache invalidates correctly;
- output-preserving optimizer is checked visually.

## Phase 6: Export productionization

Deliverables:

- target discovery;
- target configuration;
- raw and target exports;
- job progress;
- cancellation;
- manifests;
- artifact verification;
- export package.

Exit criteria:

- Blender, Godot, Unity, and Unreal target tests pass where environments permit;
- clean-room test can install, generate, export, and reopen.

## Phase 7: Full node catalog and custom nodes

Deliverables:

- catalog for upstream base library;
- compatibility aliases;
- grouped custom nodes;
- custom shader read;
- policy-gated custom shader write;
- compiler diagnostics.

Exit criteria:

- every supported node instantiates in automated tests;
- generated code cannot escape policy boundaries;
- node catalog regeneration is deterministic.

## Phase 8: Remote controls, subgraphs, libraries, and variations

Deliverables:

- remote-control APIs;
- subgraph APIs;
- local library;
- remote library browsing and safe download;
- variations;
- controlled variations;
- licensing metadata.

Exit criteria:

- reusable material component can be created, saved, reloaded, and instantiated;
- downloaded asset origin and license are visible.

## Phase 9: Painting read and layer control

Deliverables:

- painting project inspection;
- model and layers;
- masks;
- brushes;
- parameters;
- procedural layers;
- safe layer operations.

Exit criteria:

- layer hierarchy round-trip;
- project save/reopen;
- no stroke automation yet required.

## Phase 10: Experimental stroke automation

Deliverables:

- stroke preview;
- stroke application;
- coordinate systems;
- bounded affected region;
- robust undo;
- performance limits.

Exit criteria:

- experimental flag;
- no unrecoverable texture mutation;
- clear preview and user approval.

## Phase 11: Remote and multi-user deployment

Deliverables:

- Streamable HTTP MCP;
- OAuth;
- TLS;
- user/session isolation;
- remote bridge relay design;
- enterprise policy.

Exit criteria:

- external security review;
- local mode remains default;
- no public bridge exposure.

## Phase 12: Stable 1.0 release

Exit criteria are listed in Section 29.

---

## 25. Implementation epics and acceptance criteria

### Epic A: Bridge foundation

Acceptance criteria:

- authenticated loopback connection;
- clean reconnect;
- capability manifest;
- structured errors;
- events;
- no UI freeze during requests.

### Epic B: Project lifecycle

Acceptance criteria:

- create, open, activate, save, save-as, close;
- dirty conflict behavior;
- workspace policy;
- revisions;
- snapshots.

### Epic C: Graph model

Acceptance criteria:

- complete graph snapshot;
- stable IDs;
- canonical hash;
- hierarchy;
- selection;
- dependency tracing.

### Epic D: Node catalog

Acceptance criteria:

- all base nodes discoverable;
- typed ports and parameters;
- version metadata;
- semantic tags;
- searchable;
- contract tests.

### Epic E: Transactions

Acceptance criteria:

- atomic patch;
- undo;
- rollback;
- idempotent retry;
- stale revision conflict;
- crash journal.

### Epic F: Preview

Acceptance criteria:

- 2D and 3D captures;
- channel capture;
- image resources;
- cache;
- cancellation;
- deterministic configuration.

### Epic G: Export

Acceptance criteria:

- target list;
- preflight;
- progress;
- manifest;
- verification;
- batch;
- cancellation.

### Epic H: Validation

Acceptance criteria:

- profiles;
- diagnostics;
- typed fixes;
- project resource;
- before/after comparison.

### Epic I: Advanced graph features

Acceptance criteria:

- comments;
- layout;
- subgraphs;
- remote controls;
- variations;
- custom node definitions.

### Epic J: Painting

Acceptance criteria:

- read model;
- layers;
- masks;
- brushes;
- procedural layers;
- exports;
- experimental strokes.

---

## 26. Codex-centered development workflow

The project is an excellent test of a strong coding agent, but the repository must make agent work reviewable and reproducible.

### 26.1 Root `AGENTS.md`

Include:

- project purpose;
- architecture boundaries;
- supported versions;
- commands;
- testing requirements;
- code style;
- security rules;
- no direct stdout logging in STDIO server;
- no tool added without schema, test, docs, and threat classification;
- no native bridge mutation without transaction support;
- no network access added silently;
- no new dependency without justification.

### 26.2 Module-level `AGENTS.md`

Add narrower instructions for:

- GDScript bridge;
- MCP server;
- domain schemas;
- security;
- tests;
- docs.

### 26.3 Agent task size

Prefer issues that can be validated independently:

```text
Implement graph snapshot schema and canonical hashing
Implement authenticated bridge handshake
Implement read-only project listing
Implement port compatibility validator
Implement graph patch dry-run
```

Avoid:

```text
Build the entire MCP server
```

### 26.4 Worktrees

Use separate worktrees or branches for:

- bridge;
- domain;
- MCP tools;
- validator;
- packaging;
- documentation.

### 26.5 Mandatory agent loop

For each task:

1. read relevant ADRs;
2. inspect current implementation;
3. write or update tests;
4. implement;
5. run targeted tests;
6. run affected integration suite;
7. update docs and changelog;
8. produce concise risk summary;
9. request human review.

### 26.6 Agent-generated architecture changes

Codex may propose ADRs, but a human should approve changes to:

- transport;
- authentication;
- filesystem policy;
- custom-code policy;
- schema breaking changes;
- compatibility support;
- public tool semantics.

### 26.7 Proof of agent contribution

Maintain:

```text
docs/development/codex-log.md
```

Record:

- task;
- Codex session;
- branch;
- tests;
- human changes;
- lessons;
- rejected approach.

This is useful for hackathon evidence and for explaining the project in interviews.

---

## 27. Upstream strategy

### 27.1 Avoid a permanent hard fork where possible

Preferred sequence:

1. build experimental fork;
2. isolate MaterialPilot code under an addon/module boundary;
3. identify generic upstream hooks;
4. propose small upstream changes;
5. maintain adapters for released versions.

### 27.2 Good upstream contributions

Potential generic contributions:

- stable graph entity IDs;
- programmatic project/graph interface;
- safe preview capture API;
- structured node catalog export;
- transaction hooks;
- headless validation;
- bridge-friendly event signals;
- CLI improvements;
- test utilities.

### 27.3 Changes that should remain MaterialPilot-specific

- MCP protocol;
- agent instructions;
- permission policies;
- audit logs;
- prompt templates;
- remote deployment;
- model-oriented semantic catalog.

### 27.4 Compatibility adapter design

```text
MaterialMakerAdapter
├── Adapter_1_7
├── Adapter_1_8
└── Adapter_Master
```

Public domain tools call the interface, not upstream internals.

---

## 28. Major risks and mitigation

| Risk | Impact | Mitigation |
|---|---:|---|
| Upstream internals are unstable | High | Versioned adapters, pin releases, compatibility tests |
| Node definitions are too dynamic | High | Runtime catalog introspection plus generated fixtures |
| Full graph snapshots are too large | Medium | Pagination, summaries, compression, resource URIs |
| Preview blocks UI | High | Background jobs, cancellation, one render at a time |
| Agent makes artistically poor graph | Medium | Editable result, preview loop, deterministic checks, human approval |
| Agent creates invalid graph | High | typed schemas, dry-run, transactions, post-validation |
| Generated shader is unsafe or expensive | High | disabled default, policy, compile timeout, sandbox |
| Painting operations are destructive | High | defer strokes, preview, bounded regions, undo snapshots |
| Remote assets contain malicious metadata | High | untrusted labels, license inspection, restricted install |
| Export overwrites files | High | preflight, root policy, overwrite approval |
| MCP client support differs | Medium | conformance tests against Codex and multiple clients |
| Native bridge cannot be packaged cleanly | High | addon plus maintained prebuilt release |
| Cross-platform rendering differs | Medium | perceptual visual tests and platform baselines |
| Project scope becomes endless | High | capability gates and stable-release definition |

---

## 29. Production-ready 1.0 definition

MaterialPilot is not "production ready" merely because a prompt can produce a graph.

Version 1.0 requires all of the following.

### Protocol

- MCP initialization, tools, resources, prompts, progress, cancellation, and logging work;
- STDIO and local Streamable HTTP pass conformance tests;
- no protocol data is mixed with logs.

### Compatibility

- Material Maker 1.7 fully supported;
- supported Godot version documented;
- compatibility adapter and manifest;
- clean behavior on unsupported version.

### Project safety

- workspace root restrictions;
- optimistic concurrency;
- transaction rollback;
- native undo;
- crash journal;
- idempotency;
- snapshot restore.

### Graph support

- all official base node types readable;
- at least 95% of base nodes writable through catalog-driven generic tools;
- connections and parameters validated;
- comments, layout, remote controls, subgraphs, and variations supported;
- unsupported edge cases clearly reported.

### Preview and validation

- 2D and 3D preview resources;
- channel rendering;
- structural and standard validation;
- deterministic export checks;
- visual comparison for output-preserving operations.

### Export

- Blender, Godot, Unity, Unreal, and raw export paths;
- progress and cancellation;
- manifest;
- artifact verification;
- overwrite policy.

### Painting

For 1.0, choose one of two honest positions:

1. painting inspection and layer management are stable, while strokes remain experimental; or
2. painting is explicitly outside 1.0 and planned for 1.1.

Do not label unsafe stroke automation stable.

### Security

- threat model reviewed;
- loopback only by default;
- authentication;
- approval classes;
- custom code disabled by default;
- audit log;
- dependency and secret scanning;
- security policy and responsible disclosure.

### Quality

- unit, property, fuzz, integration, end-to-end, and compatibility tests;
- clean-install test on Windows, Linux, and macOS;
- no known data-loss defect;
- documented recovery path;
- release SBOM and checksums.

### User experience

- installer or clear package;
- first-run wizard;
- `materialpilot doctor`;
- examples;
- complete tool reference;
- troubleshooting;
- clear permission UI.

### Maintenance

- semantic versioning;
- deprecation policy;
- upstream tracking;
- automated node catalog compatibility tests;
- documented release process.

---

## 30. Resume and portfolio value

A finished repository can demonstrate several job-relevant skills at once:

- production TypeScript;
- protocol design;
- MCP integration;
- JSON-RPC;
- Godot and GDScript;
- plugin and application architecture;
- graph algorithms;
- serialization;
- secure local IPC;
- optimistic concurrency;
- transaction systems;
- testing and CI/CD;
- cross-platform packaging;
- open-source maintenance;
- AI-agent tool design;
- creative software workflows.

Suggested resume bullet:

> Built MaterialPilot, a production-grade Model Context Protocol integration for Material Maker that enables AI agents to inspect and atomically edit procedural material graphs, render previews, validate PBR outputs, manage undoable transactions, and export engine-ready assets through a versioned TypeScript and Godot architecture.

Stronger quantified bullet after tests exist:

> Designed and open-sourced a cross-platform MCP integration covering X Material Maker node types and Y structured tools, with revision-safe graph transactions, automated rollback, visual validation, and compatibility testing across Windows, Linux, and macOS.

Portfolio evidence to include:

- architecture diagram;
- tool explorer;
- transaction replay;
- graph diff;
- generated material gallery;
- validation examples;
- benchmark results;
- test matrix;
- release artifacts;
- upstream contributions;
- design decisions.

---

## 31. Recommended first implementation sequence

Even without a time limit, order matters.

### Step 1: Build and map upstream

Do not start by creating 100 MCP tool definitions.

Produce:

- upstream code map;
- project lifecycle map;
- graph mutation map;
- undo map;
- preview map;
- export map;
- serialization samples.

### Step 2: Create the domain model

Lock:

- IDs;
- revisions;
- graph snapshot;
- node descriptor;
- graph patch;
- diagnostics;
- transaction;
- job;
- artifacts.

### Step 3: Build read-only bridge

Make Codex a reliable observer first.

### Step 4: Build one perfect transaction

Support:

- create node;
- set parameter;
- connect;
- validate;
- rollback;
- undo.

### Step 5: Generalize through catalog

Do not hand-code one tool per node. Use descriptors and generic parameter schemas.

### Step 6: Add previews as resources

A creative agent without visual feedback is operating half-blind.

### Step 7: Add export and verification

Export is part of the finished job, not an afterthought.

### Step 8: Expand advanced graph features

Remote controls, subgraphs, comments, layout, variations.

### Step 9: Add high-risk surfaces last

Custom shader generation, remote asset installation, and painting strokes.

---

## 32. Initial issue backlog

### Foundation

- [ ] Create monorepo and package boundaries
- [ ] Add root and module `AGENTS.md`
- [ ] Add CI baseline
- [ ] Add ADR template
- [ ] Add threat-model template
- [ ] Add release and compatibility manifest

### Upstream mapping

- [ ] Document Material Maker project lifecycle
- [ ] Document graph serialization
- [ ] Document node factory
- [ ] Document parameter mutation
- [ ] Document connection mutation
- [ ] Document undo/redo hooks
- [ ] Document preview capture
- [ ] Document export pipeline
- [ ] Document painting layer model

### Domain

- [ ] Define IDs and revision model
- [ ] Define node, port, parameter schemas
- [ ] Define graph snapshot
- [ ] Define graph patch
- [ ] Define diagnostics
- [ ] Define jobs and artifacts
- [ ] Define capability manifest
- [ ] Define bridge RPC errors

### Bridge

- [ ] Implement authenticated handshake
- [ ] Implement capability discovery
- [ ] Implement project events
- [ ] Implement graph snapshot
- [ ] Implement catalog extraction
- [ ] Implement transaction journal
- [ ] Implement mutation adapters
- [ ] Implement preview adapter
- [ ] Implement export adapter
- [ ] Implement diagnostics adapter

### MCP

- [ ] Implement STDIO server
- [ ] Implement tools registry
- [ ] Implement resources
- [ ] Implement prompts
- [ ] Implement progress
- [ ] Implement cancellation
- [ ] Implement dynamic tool lists
- [ ] Implement policy middleware
- [ ] Implement audit log
- [ ] Implement Streamable HTTP

### Validation

- [ ] Structural rules
- [ ] Parameter rules
- [ ] PBR rules
- [ ] preview checks
- [ ] export verification
- [ ] graph-quality checks
- [ ] safe fix patches

### Quality

- [ ] Fixture suite
- [ ] property tests
- [ ] fuzz parsers
- [ ] bridge contract tests
- [ ] MCP conformance
- [ ] visual regression
- [ ] packaged E2E
- [ ] soak tests

### Packaging

- [ ] Windows package
- [ ] Linux package
- [ ] macOS package
- [ ] npm publish
- [ ] checksum and SBOM
- [ ] `materialpilot doctor`
- [ ] first-run wizard
- [ ] docs website

---

## 33. Final recommendation

Build MaterialPilot as an integration platform, not a prompt wrapper.

The most important technical differentiators should be:

1. **Complete observation model**  
   The agent can understand the real project and node catalog.

2. **Versioned generic graph operations**  
   Most nodes work through descriptors rather than hand-coded special cases.

3. **Atomic, revision-safe transactions**  
   The agent cannot quietly damage a project with half-applied work.

4. **Preview resources and deterministic validation**  
   The agent receives evidence, not only success messages.

5. **Production export and artifact verification**  
   The workflow ends with usable, checked output.

6. **Local security and explicit permissions**  
   Powerful agent control does not require blind trust.

7. **Compatibility engineering**  
   The project can survive future Material Maker releases.

8. **Deep documentation and tests**  
   The repository itself demonstrates engineering maturity.

The flagship demo can remain visually simple:

> Ask Codex to create a complex material, watch it build a real editable graph, inspect a rendered preview, find a structural or PBR defect, repair the graph transactionally, expose artist controls, and export verified assets.

The engineering underneath that demo is what will make the repository exceptional.

---

## 34. References

[^mm-repo]: RodZill4, **Material Maker repository**, GitHub. The README describes Material Maker as a Godot-based procedural texture and painting application whose UI uses `GraphEdit` and interconnected nodes. https://github.com/RodZill4/material-maker

[^mm-release]: RodZill4, **Material Maker 1.7 release notes**, GitHub, released July 14, 2026. The release identifies Material Maker 1.7 as based on Godot 4.5.1 and lists graph, remote parameter, layout, export, and UI improvements. https://github.com/RodZill4/material-maker/releases/tag/1.7

[^mm-docs]: Material Maker, **User Manual**. https://rodzill4.github.io/material-maker/doc/

[^mm-cli]: Material Maker, **Command line arguments**. Documents opening `.ptex` files and exporting materials to Blender, Godot, Unity, or Unreal. https://rodzill4.github.io/material-maker/doc/command_line.html

[^mm-export]: Material Maker, **Exporting Materials**. https://rodzill4.github.io/material-maker/doc/export.html

[^mm-material-node]: Material Maker, **Material node**. Documents channel exports and ORM packing. https://rodzill4.github.io/material-maker/doc/node_miscellaneous_material.html

[^mm-overview]: Material Maker, **User interface overview**. Describes project types and panels. https://rodzill4.github.io/material-maker/doc/user_interface_overview.html

[^mm-preview3d]: Material Maker, **3D Preview panel**. Describes models, environments, UV scale, tessellation, and mesh-map generation. https://rodzill4.github.io/material-maker/doc/user_interface_3d_preview_panel.html

[^godot-showcase]: Godot Engine, **Godot Showcase: Material Maker**, October 14, 2025. Discusses shader generation, almost 250 nodes, custom nodes, exports, asset sharing, and painting. https://godotengine.org/article/godot-showcase-material-maker/

[^mcp-spec]: Model Context Protocol, **Specification 2025-11-25**. Defines JSON-RPC, lifecycle, tools, resources, prompts, progress, cancellation, logging, and security principles. https://modelcontextprotocol.io/specification/2025-11-25

[^codex-mcp]: OpenAI, **Model Context Protocol for Codex**. Documents local STDIO and Streamable HTTP MCP support and shared Codex-host configuration. https://developers.openai.com/codex/mcp

[^mcp-build]: Model Context Protocol, **Build an MCP server**. Includes STDIO logging requirements. https://modelcontextprotocol.io/docs/develop/build-server

[^mcp-architecture]: Model Context Protocol, **Architecture overview**. https://modelcontextprotocol.io/docs/learn/architecture

[^mcp-resources]: Model Context Protocol, **Resources specification**. https://modelcontextprotocol.io/specification/2025-06-18/server/resources

[^mcp-prompts]: Model Context Protocol, **Prompts specification**. https://modelcontextprotocol.io/specification/2025-06-18/server/prompts

[^mm-node-common]: Material Maker, **Common properties of nodes**. Describes supported node input and output data categories. https://rodzill4.github.io/material-maker/doc/nodes_common.html

[^mm-comment]: Material Maker, **Comment node**. https://rodzill4.github.io/material-maker/doc/node_miscellaneous_comment.html

[^mm-intro]: Material Maker, **Introduction**. Describes PBR channels and painting. https://rodzill4.github.io/material-maker/doc/intro.html

[^mm-normal]: Material Maker, **Normal Map node**. Explains Material Maker's internal normal format and output conversion. https://rodzill4.github.io/material-maker/doc/node_filter_normal_map.html

[^mm-variations]: Material Maker, **Variations node**. https://rodzill4.github.io/material-maker/doc/node_miscellaneous_variations.html

[^mm-controlled-variations]: Material Maker, **Controlled Variations node**. https://rodzill4.github.io/material-maker/doc/node_miscellaneous_variations_controlled.html

[^mm-export-node]: Material Maker, **Export node**. Documents format, resolution, and filename parameters. https://rodzill4.github.io/material-maker/doc/node_miscellaneous_export.html

[^mm-sharing]: Material Maker, **Sharing assets**. Describes downloading materials, brushes, environments, and custom nodes. https://rodzill4.github.io/material-maker/doc/user_interface_sharing.html

[^mm-shader-nodes]: Material Maker, **Shader nodes**. Describes node parameters and shader-based node authoring. https://rodzill4.github.io/material-maker/doc/shader_nodes.html

[^mm-paint]: Material Maker, **Paint panel**. https://rodzill4.github.io/material-maker/doc/user_interface_paint_panel.html

[^mm-layers]: Material Maker, **Layers panel**. Describes procedural and mask layers. https://rodzill4.github.io/material-maker/doc/user_interface_layers_panel.html

[^mm-first-steps]: Material Maker, **First steps with the user interface**. Describes layers, brushes, and parameters. https://rodzill4.github.io/material-maker/doc/user_interface_first_steps.html
