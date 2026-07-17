# MaterialPilot installation and run guide

This guide installs MaterialPilot, adds its native bridge to Material Maker, connects the MCP
server to Codex, verifies the live connection, and creates a first procedural material.

MaterialPilot 0.1.0 is an implementation preview for Material Maker 1.7 running on Godot 4.7.
Live graph inspection, atomic graph edits, revision checks, dry runs, undo, and redo are supported.
Native project create/open/save/close, full material 2D/3D capture, texture export, and painting
writes are not yet available. Bounded PNG rendering of individual live node outputs is available.

## How the pieces fit together

MaterialPilot has three local components:

1. The **MaterialPilot native bridge** runs inside Material Maker and listens only on loopback.
2. The **MaterialPilot MCP server** is started by Codex and connects to that bridge.
3. The optional **MaterialPilot CLI** checks installation and bridge health.

For a live session, start them in this order:

1. Start Material Maker with the native bridge enabled.
2. Open or create a material in Material Maker.
3. Start or restart Codex so it launches the MCP server after the bridge record exists.
4. Verify `app_get_status` reports `bridgeConnected: true` and `offlineMode: false`.

If Codex starts the MCP server before Material Maker, the server intentionally falls back to its
offline reference engine for that process. Restart the Codex client after starting Material Maker
to reconnect natively.

## Requirements

| Component      | Supported version | Required for                                    |
| -------------- | ----------------- | ----------------------------------------------- |
| Node.js        | 22 or newer       | Source and packaged installs                    |
| pnpm           | 11.9.0            | Source install only                             |
| Material Maker | 1.7               | Live Material Maker editing                     |
| Godot          | 4.7 stable        | Running or exporting Material Maker from source |
| Codex          | Current release   | Using MaterialPilot through MCP                 |

Confirm Node and pnpm from PowerShell:

```powershell
node --version
pnpm --version
```

If pnpm is missing and Node 22's Corepack is available:

```powershell
corepack enable
corepack prepare pnpm@11.9.0 --activate
```

## Choose an installation method

Use a source install when developing MaterialPilot. Use the packaged archive when you only need to
run it.

### Option A: build from source

In PowerShell:

```powershell
Set-Location 'D:\Material Maker MCP'
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

The important built entry points are:

- MCP server: `apps\mcp-server\dist\main.js`
- CLI: `packages\cli\dist\main.js`
- Native addon: `apps\material-maker-bridge\addon\materialpilot`

Run the diagnostic CLI:

```powershell
node .\packages\cli\dist\main.js doctor
```

### Option B: use the packaged release

The current workspace contains `artifacts\materialpilot-0.1.0.tgz`. Extract it to a permanent
location. Do not move the extracted directory after adding its server path to Codex.

```powershell
New-Item -ItemType Directory -Force 'D:\MaterialPilot' | Out-Null
tar -xzf 'D:\Material Maker MCP\artifacts\materialpilot-0.1.0.tgz' -C 'D:\MaterialPilot' --strip-components=1
Set-Location 'D:\MaterialPilot'
node .\cli\dist\main.js doctor
```

The packaged entry points are:

- MCP server: `server\dist\main.js`
- CLI: `cli\dist\main.js`
- Native addon: `addons\materialpilot`

The package includes its production Node dependencies, so pnpm is not needed at runtime.

## Install the native addon into Material Maker

The addon must be inside the Material Maker Godot project before Material Maker is run or exported.
Close Material Maker before copying or updating it.

### From this source checkout

Replace the example Material Maker path with your Material Maker 1.7 source project:

```powershell
$materialPilot = 'D:\Material Maker MCP'
$materialMaker = 'D:\path\to\material-maker-1.7'
$target = Join-Path $materialMaker 'addons\materialpilot'
New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item -Path (Join-Path $materialPilot 'apps\material-maker-bridge\addon\materialpilot\*') -Destination $target -Recurse -Force
```

### From the packaged release

```powershell
$materialPilot = 'D:\MaterialPilot'
$materialMaker = 'D:\path\to\material-maker-1.7'
$target = Join-Path $materialMaker 'addons\materialpilot'
New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item -Path (Join-Path $materialPilot 'addons\materialpilot\*') -Destination $target -Recurse -Force
```

Open the Material Maker project in Godot once, then enable **MaterialPilot Native Bridge** under
**Project > Project Settings > Plugins**. Enabling the plugin installs this autoload:

```ini
[autoload]
MaterialPilotBridge="*res://addons/materialpilot/bridge/bridge_server.gd"
```

You can also verify that exact entry exists in Material Maker's `project.godot`.

If you export a Material Maker executable, enable the plugin before exporting so the addon and
autoload are included in the build.

## Start Material Maker

### Run a Material Maker source project

```powershell
$godot = 'C:\path\to\Godot_v4.7-stable_win64.exe'
$materialMaker = 'D:\path\to\material-maker-1.7'
Start-Process -FilePath $godot -ArgumentList '--path', $materialMaker
```

The prepared development checkout in this workspace can be launched with:

```powershell
$repo = 'D:\Material Maker MCP'
$godot = Join-Path $repo '.tools\godot-4.7\Godot_v4.7-stable_win64.exe'
$materialMaker = Join-Path $repo '.upstream-material-maker'
Start-Process -FilePath $godot -ArgumentList '--path', $materialMaker
```

The second command is only applicable when those ignored development directories exist.

### Run an exported Material Maker build

Launch the exported Material Maker application normally. No bridge port needs to be entered
manually. The addon selects an available loopback port in the 39100-39199 range and writes an
authenticated discovery record.

### Confirm bridge discovery

The default discovery record is:

- Windows: `%USERPROFILE%\.materialpilot\bridge.json`
- macOS/Linux: `~/.materialpilot/bridge.json`

On Windows:

```powershell
Test-Path (Join-Path $env:USERPROFILE '.materialpilot\bridge.json')
```

The result should be `True` while Material Maker is running. The file contains an ephemeral local
token. Do not publish, commit, or share it.

Now verify the native bridge from the matching install:

```powershell
# Source install
Set-Location 'D:\Material Maker MCP'
node .\packages\cli\dist\main.js doctor
node .\packages\cli\dist\main.js bridge status

# Packaged install
Set-Location 'D:\MaterialPilot'
node .\cli\dist\main.js doctor
node .\cli\dist\main.js bridge status
```

A healthy live result identifies Material Maker 1.7, Godot 4.7, and the native graph capabilities.

## Add MaterialPilot to Codex

Codex Desktop, the Codex CLI, and the IDE extension share MCP configuration on the same host. The
global configuration file is `~/.codex/config.toml`. A trusted project can also use
`.codex/config.toml`.

STDIO is the recommended transport. Codex starts and stops the server, so do not run
`node ...\main.js` in a separate terminal for normal STDIO use.

### Permission mode

Choose one server-side permission mode:

| Mode                   | Behavior                                                       |
| ---------------------- | -------------------------------------------------------------- |
| `observe`              | Read-only inspection; all mutations require an approval token. |
| `assisted`             | Default; writes require a single-use MaterialPilot token.      |
| `workspace-autonomous` | Allows reversible graph edits; higher-risk classes stay gated. |
| `developer`            | Broader automation; custom code and network remain separate.   |

Use `workspace-autonomous` for the live texture examples in this guide. Use `observe` when you only
want Codex to inspect a project. `assisted` is suitable when the controlling client can provide
MaterialPilot's single-use approval tokens.

### Method 1: Codex Desktop settings

1. Open **Settings** in Codex.
2. Open **MCP servers** and select **Add server**.
3. Choose **STDIO**.
4. Set the command to the full Node executable path, for example
   `C:\Program Files\nodejs\node.exe`.
5. Add the full MCP server entry point as the first argument.
6. Set `MATERIALPILOT_PERMISSION_MODE` to `workspace-autonomous`.
7. Optionally set the working directory to the MaterialPilot install directory.
8. Save and restart Codex.

For this source checkout, the server argument is:

```text
D:\Material Maker MCP\apps\mcp-server\dist\main.js
```

For the packaged release example, it is:

```text
D:\MaterialPilot\server\dist\main.js
```

### Method 2: Codex CLI

From a PowerShell session where `codex` is on `PATH`:

```powershell
codex mcp add materialpilot --env MATERIALPILOT_PERMISSION_MODE=workspace-autonomous -- 'C:\Program Files\nodejs\node.exe' 'D:\Material Maker MCP\apps\mcp-server\dist\main.js'
codex mcp list
```

For a packaged install, replace the final argument with
`D:\MaterialPilot\server\dist\main.js`.

If an entry with that name already exists, either edit it in settings or replace it:

```powershell
codex mcp remove materialpilot
codex mcp add materialpilot --env MATERIALPILOT_PERMISSION_MODE=workspace-autonomous -- 'C:\Program Files\nodejs\node.exe' 'D:\Material Maker MCP\apps\mcp-server\dist\main.js'
```

### Method 3: edit `config.toml`

This is a complete Windows source-checkout configuration:

```toml
[mcp_servers.materialpilot]
enabled = true
command = 'C:\Program Files\nodejs\node.exe'
args = ['D:\Material Maker MCP\apps\mcp-server\dist\main.js']
cwd = 'D:\Material Maker MCP'
startup_timeout_sec = 10
tool_timeout_sec = 60

[mcp_servers.materialpilot.env]
MATERIALPILOT_PERMISSION_MODE = "workspace-autonomous"
```

TOML literal strings use single quotes above so Windows backslashes do not need to be doubled.

For macOS or Linux:

```toml
[mcp_servers.materialpilot]
enabled = true
command = "/usr/local/bin/node"
args = ["/absolute/path/to/MaterialPilot/apps/mcp-server/dist/main.js"]
cwd = "/absolute/path/to/MaterialPilot"
startup_timeout_sec = 10
tool_timeout_sec = 60

[mcp_servers.materialpilot.env]
MATERIALPILOT_PERMISSION_MODE = "workspace-autonomous"
```

The default discovery-record path normally requires no configuration. When it is overridden, point
the MCP server to the exact file:

```toml
[mcp_servers.materialpilot.env]
MATERIALPILOT_RUNTIME_FILE = 'D:\private-runtime\bridge.json'
MATERIALPILOT_PERMISSION_MODE = "workspace-autonomous"
```

Material Maker receives the directory through `MATERIALPILOT_RUNTIME_DIR`; the MCP server receives
the complete file path through `MATERIALPILOT_RUNTIME_FILE`.

Restart Codex after editing the file. In Codex, run `/mcp` to confirm that `materialpilot` is
connected.

The current Codex MCP setup flow is also documented in the
[official Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp.md).

## Verify the MCP session

Start Material Maker first, open a material, restart Codex, and paste this prompt:

```text
Use MaterialPilot's app_get_status and app_get_capabilities tools. Report whether the native
Material Maker bridge is connected, whether offline mode is active, the Material Maker and Godot
versions, the active project ID, and whether graph.read, graph.write, and graph.transactions are
available. Do not change the graph.
```

For live editing, the important status fields are:

```json
{
  "running": true,
  "bridgeConnected": true,
  "offlineMode": false,
  "materialMakerVersion": "1.7",
  "godotVersion": "4.7-stable"
}
```

If `offlineMode` is `true`, do not continue expecting a visible Material Maker change. Follow the
troubleshooting section below and restart Codex after the bridge is available.

## Create the first live texture

MaterialPilot 0.1.0 cannot create or save a native Material Maker project. In Material Maker:

1. Create a new material or open an existing one.
2. Make that material the active tab.
3. Leave Material Maker running.
4. Paste one of the prompts below into Codex.
5. Save manually in Material Maker with **Ctrl+S** after inspecting the result.

### Example 1: dark basalt

This uses the graph shape already verified against the Material Maker 1.7 bridge:

```text
Use MaterialPilot to edit the active live Material Maker material.

First call app_get_status and stop if bridgeConnected is false or offlineMode is true. Inspect the
active project and current graph snapshot. Build a tileable dark basalt material using a Perlin
height source, Colorize for a charcoal-to-gray albedo, and Normal Map for surface detail. Feed the
height into roughness and depth as well. Use output size exponent 10 (1024), normal strength around
1.5, and subtle depth around 0.08.

Use only MaterialPilot catalog nodes. Plan the complete patch first with graph_plan_patch, then
apply it atomically with graph_apply_patch using the inspected expectedRevision and a new
idempotency key. For the Material Maker 1.7 native Material node, use input index 0 for albedo, 2
for roughness, 4 for normal, and 6 for depth if named ports are not resolved. Validate the final
project with the standard profile and report the new revision and any warnings. Do not save,
export, or claim visual success from graph validation alone.
```

### Example 2: warm sandstone

```text
Use MaterialPilot on the active live material. Verify native mode, inspect the revision, and create
a warm sandstone graph using Perlin noise at medium scale, a sand-to-ochre Colorize gradient, and a
low-strength Normal Map. Connect the same height to roughness and shallow depth. Plan first, then
apply one atomic revision-safe patch with a unique idempotency key. Use the native Material input
indices 0 albedo, 2 roughness, 4 normal, and 6 depth if needed. Run standard validation afterward.
Do not save or export.
```

### Example 3: oxidized metal study

```text
Use MaterialPilot on the active live material. Verify the bridge and inspect the graph. Create a
simple oxidized-metal study using Perlin variation, a dark-brown-to-teal Colorize gradient for
albedo, a constant grayscale source for high metallic response, Perlin-driven roughness, and a
moderate Normal Map. Use only nodes present in the MaterialPilot catalog. Dry-run the full patch,
apply it atomically against the current revision, then validate. If a requested port or node is not
available, stop and report the capability instead of inventing one. Do not save or export.
```

### Example 4: emissive lava concept

```text
Use MaterialPilot on the active live material. Verify live native mode and inspect the graph.
Create a lava-rock concept from Perlin noise, with a near-black-to-red-to-orange Colorize gradient,
strong normal detail, and high roughness on the rock. Connect an available color output to emission
only if the native Material port accepts it. Plan and dry-run first, apply one atomic patch using
the current revision and a fresh idempotency key, then validate. Report any unsupported connection
instead of forcing it. Do not save or export.
```

These examples prove graph creation and validation, not rendered appearance. Judge the material in
Material Maker's own 2D and 3D views, adjust parameters there or through another revision-safe MCP
patch, and save from the Material Maker UI.

For pixel evidence from a specific graph output, ask Codex to call
`preview_render_node_output` with the project ID, stable node ID, output name or index, and a
resolution from 16 to 1024. This returns an in-memory PNG and does not write or export a texture
file. Full Material Maker 2D/3D panel capture and automated before/after comparison remain later
preview-phase work.

## Run in offline reference mode

Offline mode is useful for schema, catalog, planning, and transaction tests without Material Maker.
It does not update a visible Material Maker window, and its in-memory state is lost when the MCP
process exits.

Add this environment variable to the MCP configuration:

```toml
[mcp_servers.materialpilot.env]
MATERIALPILOT_OFFLINE = "1"
MATERIALPILOT_PERMISSION_MODE = "workspace-autonomous"
```

Restart Codex. `app_get_status` should now report `offlineMode: true` and
`bridgeConnected: false`.

## Optional authenticated HTTP transport

STDIO is simpler and recommended for a single local Codex client. Use HTTP only when a client
cannot launch the MCP process itself.

In a dedicated PowerShell terminal, generate a secret and start the source server:

```powershell
$env:MATERIALPILOT_HTTP_TOKEN = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
$env:MATERIALPILOT_HTTP_PORT = '39150'
$env:MATERIALPILOT_PERMISSION_MODE = 'workspace-autonomous'
Set-Location 'D:\Material Maker MCP'
node .\apps\mcp-server\dist\main.js
```

For the packaged install, use `D:\MaterialPilot\server\dist\main.js`. The process should report:

```text
MaterialPilot MCP listening on http://127.0.0.1:39150/mcp
```

The bearer token must also be available to the Codex process. Configure the server with:

```powershell
codex mcp add materialpilot-http --url http://127.0.0.1:39150/mcp --bearer-token-env-var MATERIALPILOT_HTTP_TOKEN
```

The HTTP server binds only to `127.0.0.1` and rejects tokens shorter than 32 characters. Do not
publish the token or expose the endpoint through a proxy.

## Environment variable reference

| Variable                        | Process          | Meaning                                                       |
| ------------------------------- | ---------------- | ------------------------------------------------------------- |
| `MATERIALPILOT_PERMISSION_MODE` | MCP server       | `observe`, `assisted`, `workspace-autonomous`, or `developer` |
| `MATERIALPILOT_OFFLINE`         | MCP server       | Set to `1` to force the in-memory backend                     |
| `MATERIALPILOT_RUNTIME_FILE`    | MCP server/CLI   | Full path to the bridge discovery record                      |
| `MATERIALPILOT_RUNTIME_DIR`     | Material Maker   | Directory in which the addon writes `bridge.json`             |
| `MATERIALPILOT_HTTP_PORT`       | MCP server       | Enables Streamable HTTP on the selected loopback port         |
| `MATERIALPILOT_HTTP_TOKEN`      | MCP server/Codex | Bearer token for HTTP; at least 32 characters                 |

## Troubleshooting

### `app_get_status` reports offline mode

- Start Material Maker before Codex launches the MCP server.
- Confirm the MaterialPilot addon is enabled and its autoload exists.
- Confirm the runtime file exists while Material Maker is running.
- Run `node packages\cli\dist\main.js bridge status`.
- Restart Codex after the runtime file appears.
- Check that `MATERIALPILOT_OFFLINE` is not set to `1`.

### The bridge record is missing

- Confirm Material Maker is running from the project or build that contains the addon.
- Confirm Material Maker 1.7 is running on Godot 4.7.
- Check Material Maker/Godot diagnostic output for an addon parse error.
- If using an override, ensure `MATERIALPILOT_RUNTIME_DIR` points to an existing writable directory.

### The record exists but connection fails

The token is ephemeral and the record can be stale after a crash. Close every Material Maker
instance, confirm no instance is still running, remove the stale
`%USERPROFILE%\.materialpilot\bridge.json`, then start one Material Maker instance again. Avoid
running multiple bridged Material Maker instances with the same runtime-record location.

### `/mcp` does not show MaterialPilot

- Run `codex mcp list`.
- Verify the Node executable and MCP server paths are absolute and still exist.
- On Windows, use single-quoted TOML paths or double every backslash in double-quoted paths.
- Rebuild the source checkout if `dist\main.js` does not exist.
- Restart Codex after changing `config.toml`.

### A write returns `PERMISSION_DENIED`

- Use `observe` only for inspection.
- `assisted` requires a valid single-use MaterialPilot approval token for A1 writes.
- For local reversible graph edits, set `MATERIALPILOT_PERMISSION_MODE` to
  `workspace-autonomous` and restart Codex.
- Do not use `developer` merely to bypass an unrelated validation or capability error.

### A write returns `REVISION_CONFLICT`

Material Maker or another client changed the graph after it was inspected. Read a fresh snapshot,
review the difference, plan the patch again, and apply it with the new revision. Never change only
`expectedRevision` without reviewing the new graph.

### A node or port is rejected

Use `catalog_search_nodes` and `catalog_get_node` before patching. MaterialPilot 0.1.0 exposes a
deliberately small stable catalog. Unsupported nodes and ports should be reported, not guessed. For
the tested Material Maker 1.7 Material output, the useful native input indices are 0 albedo, 2
roughness, 4 normal, and 6 depth.

### Running the STDIO server appears to hang

That is normal: the process is waiting for MCP messages on standard input. In normal use Codex
owns that process. Use the diagnostic CLI for a human-readable health check. Wrappers and scripts
must not write banners or logs to standard output because that corrupts the MCP protocol;
MaterialPilot writes diagnostics to standard error.

### Material Maker changed but the project is unsaved

This is expected in 0.1.0. Native save is capability-gated. Inspect the result and save manually
from Material Maker. Graph mutations are registered as native undo/redo steps.

## Update or remove MaterialPilot

For a source update:

1. Close Material Maker.
2. Pull or copy the updated MaterialPilot source.
3. Run `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm check`.
4. Copy the updated addon over `addons\materialpilot`.
5. Start Material Maker, then restart Codex.
6. Run the CLI doctor and MCP status checks again.

To remove the MCP registration:

```powershell
codex mcp remove materialpilot
```

To remove the native addon, first disable **MaterialPilot Native Bridge** in Godot so its autoload is
removed, close the editor, and then remove `addons\materialpilot` from the Material Maker project.

## Security notes

- Both the native bridge and optional HTTP MCP transport bind to loopback only.
- The native bridge uses an ephemeral 256-bit token recorded in the user-private runtime file.
- Keep the runtime file, HTTP bearer token, project files, and local paths out of public logs.
- MaterialPilot uses expected revisions and atomic transactions to avoid overwriting human edits.
- Custom shader writes, community network operations, texture export, and painting mutations remain
  disabled in this preview.

See [Troubleshooting](troubleshooting.md), [First material](first-material.md),
[Implementation status](../development/implementation-status.md), and the repository
[security policy](../../SECURITY.md) for more detail.
