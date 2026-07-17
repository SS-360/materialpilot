import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { generateSbom } from "./generate-sbom.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const artifacts = resolve(root, "artifacts");
const name = `materialpilot-${manifest.version}`;
const stage = resolve(artifacts, name);
if (!stage.startsWith(`${artifacts}\\`) && !stage.startsWith(`${artifacts}/`)) {
  throw new Error("Refusing to package outside the artifacts directory");
}

for (const required of ["apps/mcp-server/dist/main.js", "packages/cli/dist/main.js"]) {
  await readFile(resolve(root, required));
}

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

async function resolvePnpmCli() {
  if (process.env.npm_execpath?.match(/pnpm\.(?:c|m)?js$/i)) return process.env.npm_execpath;
  if (process.platform !== "win32") return null;
  const located = spawnSync("where.exe", ["pnpm.cmd"], { encoding: "utf8" });
  const wrapper = located.stdout?.split(/\r?\n/u).find(Boolean);
  if (!wrapper) throw new Error("Unable to locate pnpm.cmd");
  const contents = await readFile(wrapper, "utf8");
  const match = contents.match(/"([^"]*pnpm\.mjs)"/iu);
  if (!match?.[1]) throw new Error(`Unable to locate pnpm JavaScript entry point from ${wrapper}`);
  return resolve(match[1].replace(/%~dp0/giu, `${dirname(wrapper)}\\`));
}

const pnpmCli = await resolvePnpmCli();
for (const [filter, destination] of [
  ["@materialpilot/mcp-server", "server"],
  ["@materialpilot/cli", "cli"]
]) {
  const target = resolve(stage, destination);
  const args = ["--filter", filter, "deploy", target, "--prod"];
  const result = pnpmCli
    ? spawnSync(process.execPath, [pnpmCli, ...args], {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, CI: "true" }
      })
    : spawnSync("pnpm", args, {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, CI: "true" }
      });
  if (result.status !== 0) {
    throw new Error(
      `pnpm deploy failed for ${filter}: ${result.error?.message ?? `exit ${result.status}`}`
    );
  }
  const deployedManifest = JSON.parse(await readFile(resolve(target, "package.json"), "utf8"));
  if (deployedManifest.name !== filter) throw new Error(`Deploy target is not ${filter}`);
  await readFile(resolve(target, "dist/main.js"));
}

await cp(
  resolve(root, "apps/material-maker-bridge/addon/materialpilot"),
  resolve(stage, "addons/materialpilot"),
  {
    recursive: true
  }
);
for (const path of ["README.md", "LICENSE", "NOTICE", "SECURITY.md", "compatibility.json"]) {
  await cp(resolve(root, path), resolve(stage, path));
}
await cp(resolve(root, "docs"), resolve(stage, "docs"), { recursive: true });
await generateSbom(resolve(stage, "materialpilot.cdx.json"));

const archive = resolve(artifacts, `${name}.tgz`);
await rm(archive, { force: true });
const tar = spawnSync("tar", ["-czf", archive, "-C", artifacts, name], {
  cwd: root,
  stdio: "inherit"
});
if (tar.status !== 0) throw new Error("tar could not create the release archive");

const digest = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
const checksum = `${digest}  ${relative(artifacts, archive).replaceAll("\\", "/")}\n`;
await writeFile(resolve(artifacts, "SHA256SUMS"), checksum, "utf8");
process.stdout.write(`Packaged ${archive}\n${checksum}`);
