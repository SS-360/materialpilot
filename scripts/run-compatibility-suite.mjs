import { access, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const compatibility = JSON.parse(await readFile(resolve(root, "compatibility.json"), "utf8"));

if (!compatibility.materialMaker?.includes("1.7") || !compatibility.godot?.includes("4.7")) {
  throw new Error("compatibility.json must declare the tested Material Maker and Godot versions");
}

await access(resolve(root, "apps/mcp-server/dist/main.js"));
await access(resolve(root, "packages/cli/dist/main.js"));

const node = process.execPath;
for (const [script, args] of [
  ["apps/material-maker-bridge/scripts/validate-addon.mjs", []],
  [
    "packages/cli/dist/main.js",
    ["project", "lint", "fixtures/materials/simple-noise.ptex", "--profile", "strict"]
  ],
  ["packages/cli/dist/main.js", ["catalog", "verify"]]
]) {
  const result = spawnSync(node, [resolve(root, script), ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0)
    throw new Error(`Compatibility command failed: ${script} ${args.join(" ")}`);
}

process.stdout.write(
  `Static compatibility suite passed for Material Maker ${compatibility.materialMaker.join(", ")} / Godot ${compatibility.godot.join(", ")}\n`
);
const localGodot = resolve(
  root,
  ".tools/godot-4.7",
  process.platform === "win32"
    ? "Godot_v4.7-stable_win64_console.exe"
    : "Godot_v4.7-stable_linux.x86_64"
);
const godot = process.env.GODOT_BIN ?? (existsSync(localGodot) ? localGodot : undefined);
if (godot) {
  const result = spawnSync(
    node,
    [resolve(root, "apps/material-maker-bridge/scripts/validate-godot.mjs")],
    { cwd: root, stdio: "inherit", env: { ...process.env, GODOT_BIN: godot } }
  );
  if (result.status !== 0) throw new Error("Godot bridge parse contract failed");

  const materialMaker = process.env.MATERIAL_MAKER_PROJECT;
  if (materialMaker) {
    const nativeResult = spawnSync(
      node,
      [resolve(root, "apps/material-maker-bridge/scripts/validate-material-maker.mjs")],
      {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, GODOT_BIN: godot, MATERIAL_MAKER_PROJECT: materialMaker }
      }
    );
    if (nativeResult.status !== 0) throw new Error("Material Maker native contract failed");
  } else {
    process.stdout.write(
      "Set MATERIAL_MAKER_PROJECT to include the full Material Maker application contract.\n"
    );
  }
} else {
  process.stdout.write(
    "Native Godot contract testing remains a release gate; set GODOT_BIN to run it.\n"
  );
}
