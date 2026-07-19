import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const required = [
  "addon/materialpilot/plugin.cfg",
  "addon/materialpilot/plugin.gd",
  "addon/materialpilot/bridge/bridge_server.gd",
  "addon/materialpilot/bridge/bridge_error.gd",
  "addon/materialpilot/adapters/material_maker_adapter.gd"
];
for (const relative of required) await access(join(root, relative));
const server = await readFile(join(root, "addon/materialpilot/bridge/bridge_server.gd"), "utf8");
for (const marker of [
  "127.0.0.1",
  "bridge.initialize",
  "MAX_PAYLOAD_BYTES",
  "BRIDGE_NOT_AUTHENTICATED"
]) {
  if (!server.includes(marker))
    throw new Error(`Native bridge is missing safety marker: ${marker}`);
}
const adapter = await readFile(
  join(root, "addon/materialpilot/adapters/material_maker_adapter.gd"),
  "utf8"
);
for (const marker of [
  "expectedRevision",
  "idempotencyKey",
  "undoredo_create_step",
  "await _restore_graph(graph, before)",
  'get_node_or_null("/root/mm_loader")',
  "_stable_native_id",
  "do_disconnect_node",
  "_has_rendering_device",
  "Blender channel render failed",
  "_cleanup_files",
  '"preview.material3d": graph != null and _main_window() != null and rendering_available',
  '"export.write": editable and rendering_available'
]) {
  if (!adapter.includes(marker))
    throw new Error(`Native adapter is missing transaction marker: ${marker}`);
}
