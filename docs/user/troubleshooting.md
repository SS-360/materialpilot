# Troubleshooting

## Bridge not discovered

Set `MATERIALPILOT_RUNTIME_DIR` in Material Maker and `MATERIALPILOT_RUNTIME_FILE` in the MCP process to the same record. Confirm Material Maker is running and the record is current. Run `materialpilot bridge status`.

## Revision conflict

Another human or agent changed the project after inspection. Read a fresh snapshot and rebase the desired operations. Never simply replace `expectedRevision` without reviewing the new graph.

## Permission denied

The default mode is assisted. Codex can be configured to prompt for write tools; for controlled automation set `MATERIALPILOT_PERMISSION_MODE=workspace-autonomous`. Workspace root, overwrite, network, and custom-code policies remain separate.

## Server starts in offline mode

This is graceful degradation, not a hidden failure. `app_get_status` reports `offlineMode: true`, and live preview/export/painting capabilities are false.

## Preview shows a purple or magenta missing material

Do not treat a structurally valid graph as visual proof. First confirm `app_get_capabilities` reports
`preview.material3d: true` and `export.write: true`. Those features require a real Godot rendering
device and are deliberately disabled in headless sessions. Close Material Maker, copy the current
`apps/material-maker-bridge/addon/materialpilot` directory over the installed
`addons/materialpilot` directory, restart Material Maker normally, and then restart the MCP client.
The GPU-backed native contract rejects previews dominated by Godot's magenta missing-material
fallback.

## Blender export does not finish

Update both the MCP server and installed native addon. Current releases render only the connected
Material channels through the bridge, stage them under temporary filenames, publish the completed
PNG/EXR files, and return verified sizes and SHA-256 hashes. Older addon builds delegated to the UI
export routine and could wait indefinitely on unrelated background preview work.

## STDIO protocol corruption

MaterialPilot logs only to stderr. If another wrapper writes banners to stdout, remove that wrapper or redirect its logs before using it as an MCP command.
