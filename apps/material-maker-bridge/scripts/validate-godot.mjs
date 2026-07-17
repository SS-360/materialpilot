import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const godot = process.env.GODOT_BIN ?? process.argv[2];
if (!godot) throw new Error("Set GODOT_BIN to the Godot 4.7 executable.");

const project = join(tmpdir(), `materialpilot-godot-${process.pid}`);
const addon = join(project, "addons", "materialpilot");
const scripts = [
  "res://addons/materialpilot/bridge/bridge_error.gd",
  "res://addons/materialpilot/adapters/material_maker_adapter.gd",
  "res://addons/materialpilot/bridge/bridge_server.gd",
  "res://addons/materialpilot/plugin.gd"
];

function runGodot(args, environment = {}) {
  const result = spawnSync(godot, args, {
    encoding: "utf8",
    env: { ...process.env, ...environment }
  });
  if (result.status !== 0) {
    throw new Error(
      `Godot failed (${args.join(" ")}):\n${result.stdout ?? ""}\n${result.stderr ?? ""}`
    );
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRuntime(path, child, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Godot bridge process exited early (${child.exitCode}):\n${output.value}`);
    }
    try {
      await access(path);
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      await delay(50);
    }
  }
  throw new Error(`Timed out waiting for Godot bridge discovery record:\n${output.value}`);
}

function openWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error(`WebSocket failed to open: ${url}`)), {
      once: true
    });
  });
}

function request(socket, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 5_000);
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

async function runBridgeContract() {
  const runtimeDirectory = join(project, "runtime");
  const runtimeFile = join(runtimeDirectory, "bridge.json");
  await mkdir(runtimeDirectory, { recursive: true });
  const output = { value: "" };
  const child = spawn(godot, ["--headless", "--path", project], {
    env: { ...process.env, MATERIALPILOT_RUNTIME_DIR: runtimeDirectory },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => (output.value += chunk.toString()));
  child.stderr.on("data", (chunk) => (output.value += chunk.toString()));
  try {
    const endpoint = await waitForRuntime(runtimeFile, child, output);
    const socket = await openWebSocket(endpoint.url);
    try {
      const nonce = "0123456789abcdef";
      const initialized = await request(socket, 1, "bridge.initialize", {
        protocolVersion: "1.0",
        token: endpoint.token,
        nonce
      });
      if (initialized.protocolVersion !== "1.0" || initialized.nonce !== nonce) {
        throw new Error("Godot bridge handshake returned an invalid manifest");
      }
      const status = await request(socket, 2, "app.get_status");
      if (status.running !== true || status.connectedProjectCount !== 0) {
        throw new Error("Godot bridge status contract failed");
      }
    } finally {
      socket.close();
    }
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, delay(3_000)]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await Promise.race([exited, delay(1_000)]);
      }
    }
  }
}

try {
  await mkdir(dirname(addon), { recursive: true });
  await cp(join(root, "addon", "materialpilot"), addon, { recursive: true });
  await writeFile(
    join(project, "project.godot"),
    '[application]\nconfig/name="MaterialPilot contract test"\nrun/main_scene="res://main.tscn"\n[autoload]\nMaterialPilotBridge="*res://addons/materialpilot/bridge/bridge_server.gd"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n',
    "utf8"
  );
  await writeFile(join(project, "main.gd"), "extends Node\n", "utf8");
  await writeFile(
    join(project, "main.tscn"),
    '[gd_scene load_steps=2 format=3]\n\n[ext_resource path="res://main.gd" type="Script" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
    "utf8"
  );
  await cp(join(root, "tests", "stable_id_probe.gd"), join(project, "stable_id_probe.gd"));
  runGodot(["--headless", "--editor", "--path", project, "--import", "--quit"]);
  for (const script of scripts) {
    runGodot(["--headless", "--path", project, "--script", script, "--check-only"]);
  }
  runGodot(["--headless", "--path", project, "--script", "res://stable_id_probe.gd"], {
    MATERIALPILOT_RUNTIME_DIR: join(project, "stable-id-runtime")
  });
  await runBridgeContract();
  process.stdout.write(
    `Godot ${process.env.GODOT_VERSION ?? "4.7"} bridge parse, handshake, and status contracts passed.\n`
  );
} finally {
  await rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
