#!/usr/bin/env node
import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { BridgeClient, readRuntimeEndpoint } from "@materialpilot/bridge-protocol";
import { createEntityId, type ValidationReport } from "@materialpilot/domain";
import { extractMmgCatalog, NodeCatalog } from "@materialpilot/node-catalog";
import { parsePtex, ptexToSnapshot } from "@materialpilot/ptex";
import { validateGraph, type RunnableValidationProfile } from "@materialpilot/validator";

const version = "0.1.0";
const minimumNodeVersion = [22, 13, 0] as const;

export function isSupportedNodeVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) return false;
  const actual = match.slice(1, 4).map(Number);
  for (let index = 0; index < minimumNodeVersion.length; index += 1) {
    const component = actual[index];
    const minimum = minimumNodeVersion[index];
    if (component === undefined || minimum === undefined) return false;
    if (component > minimum) return true;
    if (component < minimum) return false;
  }
  return true;
}

export function lintPtexText(
  text: string,
  profile: RunnableValidationProfile = "standard"
): ValidationReport {
  const project = parsePtex(text);
  const snapshot = ptexToSnapshot(project, createEntityId("project"));
  return validateGraph(snapshot, profile);
}

function defaultRuntimeFile(): string {
  return process.env.MATERIALPILOT_RUNTIME_FILE ?? join(homedir(), ".materialpilot", "bridge.json");
}

async function doctor(json: boolean): Promise<number> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push({
    name: "Node.js",
    ok: isSupportedNodeVersion(process.versions.node),
    detail: process.versions.node
  });
  checks.push({ name: "Platform", ok: true, detail: `${process.platform} ${process.arch}` });
  try {
    await access(process.cwd(), constants.R_OK | constants.W_OK);
    checks.push({ name: "Workspace", ok: true, detail: process.cwd() });
  } catch {
    checks.push({
      name: "Workspace",
      ok: false,
      detail: `${process.cwd()} is not readable and writable`
    });
  }
  try {
    const endpoint = await readRuntimeEndpoint(defaultRuntimeFile());
    checks.push({
      name: "Bridge discovery",
      ok: true,
      detail: `${endpoint.instanceId} at ${endpoint.url}`
    });
  } catch (error) {
    checks.push({
      name: "Bridge discovery",
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ version, checks }, null, 2)}\n`);
  } else {
    process.stdout.write(`MaterialPilot ${version}\n`);
    for (const check of checks)
      process.stdout.write(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}\n`);
  }
  return checks.every((check) => check.ok || check.name === "Bridge discovery") ? 0 : 1;
}

export function createProgram(): Command {
  const program = new Command()
    .name("materialpilot")
    .description("MaterialPilot developer and diagnostics CLI")
    .version(version);

  program
    .command("doctor")
    .description("Check the local runtime and bridge discovery configuration")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      process.exitCode = await doctor(options.json ?? false);
    });

  const project = program.command("project").description("Offline project utilities");
  project
    .command("lint")
    .argument("<path>", "Path to a .ptex project")
    .option("--profile <profile>", "structural, standard, strict, or release", "standard")
    .option("--json", "Emit the complete validation report")
    .action(async (path: string, options: { profile: string; json?: boolean }) => {
      const profile = options.profile as RunnableValidationProfile;
      if (!["structural", "standard", "strict", "release"].includes(profile)) {
        throw new Error(`Unknown validation profile: ${profile}`);
      }
      const report = lintPtexText(await readFile(resolve(path), "utf8"), profile);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(
          `${report.valid ? "VALID" : "INVALID"} ${path} at revision ${report.revision}\n`
        );
        for (const entry of report.diagnostics) {
          process.stdout.write(`${entry.severity.toUpperCase()} ${entry.code}: ${entry.message}\n`);
        }
      }
      if (!report.valid) process.exitCode = 2;
    });

  const catalog = program.command("catalog").description("Node catalog utilities");
  catalog
    .command("extract")
    .argument("<node-directory>", "Material Maker node definition directory")
    .requiredOption("-o, --output <path>", "Destination JSON file")
    .action(async (directory: string, options: { output: string }) => {
      const extracted = await extractMmgCatalog(resolve(directory));
      const output = resolve(options.output);
      await access(dirname(output), constants.W_OK);
      await writeFile(output, `${JSON.stringify({ descriptors: extracted }, null, 2)}\n`, "utf8");
      process.stdout.write(`Extracted ${extracted.length} node descriptors to ${output}\n`);
    });
  catalog.command("verify").action(() => {
    const current = new NodeCatalog();
    process.stdout.write(
      `Catalog ${current.version}: ${current.list().length} descriptors in ${current.categories().length} categories\n`
    );
  });

  const bridge = program.command("bridge").description("Native bridge diagnostics");
  bridge
    .command("status")
    .option("--runtime-file <path>", "Bridge discovery record", defaultRuntimeFile())
    .action(async (options: { runtimeFile: string }) => {
      const endpoint = await readRuntimeEndpoint(options.runtimeFile);
      const { client, capabilities } = await BridgeClient.connect(endpoint);
      try {
        const ping = await client.request("app.ping");
        process.stdout.write(
          `${JSON.stringify({ connected: true, capabilities, ping }, null, 2)}\n`
        );
      } finally {
        client.close();
      }
    });

  return program;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  createProgram()
    .parseAsync()
    .catch((error: unknown) => {
      process.stderr.write(
        `materialpilot: ${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    });
}
