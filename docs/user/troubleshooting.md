# Troubleshooting

## Bridge not discovered

Set `MATERIALPILOT_RUNTIME_DIR` in Material Maker and `MATERIALPILOT_RUNTIME_FILE` in the MCP process to the same record. Confirm Material Maker is running and the record is current. Run `materialpilot bridge status`.

## Revision conflict

Another human or agent changed the project after inspection. Read a fresh snapshot and rebase the desired operations. Never simply replace `expectedRevision` without reviewing the new graph.

## Permission denied

The default mode is assisted. Codex can be configured to prompt for write tools; for controlled automation set `MATERIALPILOT_PERMISSION_MODE=workspace-autonomous`. Workspace root, overwrite, network, and custom-code policies remain separate.

## Server starts in offline mode

This is graceful degradation, not a hidden failure. `app_get_status` reports `offlineMode: true`, and live preview/export/painting capabilities are false.

## STDIO protocol corruption

MaterialPilot logs only to stderr. If another wrapper writes banners to stdout, remove that wrapper or redirect its logs before using it as an MCP command.
