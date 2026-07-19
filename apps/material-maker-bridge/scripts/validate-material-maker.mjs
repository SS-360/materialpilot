import { access, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { inflateSync } from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repository = resolve(root, "../..");
const godot = process.env.GODOT_BIN;
const materialMaker = process.env.MATERIAL_MAKER_PROJECT;
if (!godot || !materialMaker) {
  throw new Error("Set GODOT_BIN and MATERIAL_MAKER_PROJECT for the native application contract.");
}
await access(join(materialMaker, "project.godot"));
const { BridgeClient } = await import(
  pathToFileURL(join(repository, "packages", "bridge-protocol", "dist", "index.js")).href
);
const { ptexToSnapshot } = await import(
  pathToFileURL(join(repository, "packages", "ptex", "dist", "index.js")).href
);

const runtimeDirectory = join(tmpdir(), `materialpilot-material-maker-${process.pid}`);
const runtimeFile = join(runtimeDirectory, "bridge.json");
const userDataDirectory = join(runtimeDirectory, "user-data");
await mkdir(runtimeDirectory, { recursive: true });
await mkdir(userDataDirectory, { recursive: true });
const output = { value: "" };
const applicationArgs =
  process.env.MATERIALPILOT_WINDOWED_TEST === "1"
    ? ["--path", materialMaker, "--position", "-10000,-10000", "--no-splash"]
    : ["--headless", "--path", materialMaker, "--no-splash"];
const child = spawn(godot, applicationArgs, {
  env: {
    ...process.env,
    MATERIALPILOT_RUNTIME_DIR: runtimeDirectory,
    APPDATA: userDataDirectory,
    LOCALAPPDATA: userDataDirectory,
    XDG_DATA_HOME: userDataDirectory
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
child.stdout.on("data", (chunk) => (output.value += chunk.toString()));
child.stderr.on("data", (chunk) => (output.value += chunk.toString()));

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function firstDifference(left, right, path = "$") {
  if (left === right) return null;
  if (typeof left !== typeof right || left === null || right === null) {
    return { path, left, right };
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return { path, left, right };
    }
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (typeof left === "object") {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const difference = firstDifference(left[key], right[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return { path, left, right };
}

function semanticGraph(value) {
  const graph = structuredClone(value);
  delete graph.name;
  return graph;
}

function decodePngPixels(encoded) {
  const png = Buffer.from(encoded, "base64");
  if (png.toString("ascii", 1, 4) !== "PNG") throw new Error("Preview is not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const imageData = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || ![2, 6].includes(data[9])) {
        throw new Error(`Unsupported preview PNG format: depth=${data[8]} color=${data[9]}`);
      }
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  const filtered = inflateSync(Buffer.concat(imageData));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const estimate = a + b - c;
    const distanceA = Math.abs(estimate - a);
    const distanceB = Math.abs(estimate - b);
    const distanceC = Math.abs(estimate - c);
    return distanceA <= distanceB && distanceA <= distanceC ? a : distanceB <= distanceC ? b : c;
  };
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[source++];
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const above = y > 0 ? pixels[previous + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[previous + x - channels] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : filter === 4
                  ? paeth(left, above, upperLeft)
                  : (() => {
                      throw new Error(`Unsupported PNG filter ${filter}`);
                    })();
      pixels[row + x] = (filtered[source++] + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function assertPreviewHasMaterial(encoded, geometry) {
  const { channels, pixels } = decodePngPixels(encoded);
  let colored = 0;
  let missingMagenta = 0;
  for (let offset = 0; offset < pixels.length; offset += channels) {
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const alpha = channels === 4 ? pixels[offset + 3] : 255;
    if (alpha < 32 || (red > 245 && green > 245 && blue > 245)) continue;
    colored += 1;
    if (red > 170 && blue > 170 && green < 120 && red - green > 70 && blue - green > 70) {
      missingMagenta += 1;
    }
  }
  if (colored < 128 || missingMagenta / colored > 0.65) {
    throw new Error(`Native ${geometry} preview is empty or uses the missing-material fallback`);
  }
}

let client;
try {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Material Maker exited early (${child.exitCode}):\n${output.value}`);
    }
    try {
      await access(runtimeFile);
      break;
    } catch {
      await delay(100);
    }
  }
  await readFile(runtimeFile, "utf8");
  ({ client } = await BridgeClient.connectFromRuntimeFile(runtimeFile));

  let status;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    status = await client.request("app.get_status");
    if (status.connectedProjectCount > 0 && status.activeProjectId) break;
    await delay(100);
  }
  if (!status?.activeProjectId) {
    throw new Error(`Material Maker did not initialize an active project:\n${output.value}`);
  }
  let active = await client.request("project.get_active");
  let snapshot = await client.request("graph.get_snapshot", { projectId: active.id });
  if (!Array.isArray(snapshot.serializedGraph?.nodes)) {
    throw new Error("Native graph snapshot did not include serialized nodes");
  }
  const projectsBeforeCreate = await client.request("project.list");
  let invalidCreationRejected = false;
  try {
    await client.request("project.create_material", {
      name: " ",
      idempotencyKey: `invalid-create-${process.pid}`
    });
  } catch (error) {
    invalidCreationRejected = String(error).includes("Project name");
  }
  if (!invalidCreationRejected) {
    throw new Error("Invalid native project creation was not rejected");
  }
  if ((await client.request("project.list")).length !== projectsBeforeCreate.length) {
    throw new Error("Rejected native project creation left a partial project tab");
  }
  const createKey = `native-create-${process.pid}`;
  const created = await client.request("project.create_material", {
    name: "test_cracked_stone",
    idempotencyKey: createKey
  });
  if (
    created.name !== "test_cracked_stone" ||
    created.type !== "material" ||
    created.revision !== 0 ||
    created.dirty !== false ||
    created.active !== true
  ) {
    throw new Error(
      `Native project creation returned an invalid summary: ${JSON.stringify(created)}`
    );
  }
  const replayedCreate = await client.request("project.create_material", {
    name: "test_cracked_stone",
    idempotencyKey: createKey
  });
  if (replayedCreate.id !== created.id) {
    throw new Error("Native project creation idempotency did not replay the created project");
  }
  let conflictingCreateRejected = false;
  try {
    await client.request("project.create_material", {
      name: "different_name",
      idempotencyKey: createKey
    });
  } catch (error) {
    conflictingCreateRejected = String(error).includes("different arguments");
  }
  if (!conflictingCreateRejected) {
    throw new Error("Native project creation accepted conflicting idempotency arguments");
  }
  const projectsAfterCreate = await client.request("project.list");
  if (
    projectsAfterCreate.length !== projectsBeforeCreate.length + 1 ||
    !projectsAfterCreate.some((project) => project.id === created.id && project.active) ||
    !projectsAfterCreate.some((project) => project.id !== created.id && !project.active)
  ) {
    throw new Error("Native project list did not expose the newly created and previous tabs");
  }
  active = await client.request("project.get_active");
  snapshot = await client.request("graph.get_snapshot", { projectId: active.id });
  if (active.id !== created.id || snapshot.serializedGraph.nodes.length !== 1) {
    throw new Error("Native project creation did not activate a clean standard material graph");
  }
  const initialDomain = ptexToSnapshot(snapshot.serializedGraph, active.id, {
    revision: snapshot.revision
  });
  const initialMaterial = initialDomain.nodes.find((node) => node.typeId === "mm.output.material");
  if (!initialMaterial) throw new Error("Native graph did not expose a stable Material node");
  const stableIdPlan = await client.request("graph.apply_patch", {
    patch: {
      patchVersion: "1",
      projectId: active.id,
      expectedRevision: snapshot.revision,
      idempotencyKey: "stable-node-" + process.pid,
      label: "MaterialPilot stable node ID probe",
      dryRun: true,
      validationPolicy: "structural",
      operations: [
        {
          type: "node.set_parameter",
          nodeId: initialMaterial.id,
          parameter: "size",
          value: initialMaterial.parameters.size
        }
      ]
    }
  });
  if (stableIdPlan.status !== "planned") {
    throw new Error("Stable snapshot node IDs were not accepted by the native bridge");
  }
  let nonDeletableRejected = false;
  try {
    await client.request("graph.apply_patch", {
      patch: {
        patchVersion: "1",
        projectId: active.id,
        expectedRevision: snapshot.revision,
        idempotencyKey: "material-delete-" + process.pid,
        label: "MaterialPilot non-deletable output probe",
        dryRun: true,
        validationPolicy: "structural",
        operations: [{ type: "node.delete", nodeId: initialMaterial.id, cascade: "disconnect" }]
      }
    });
  } catch (error) {
    nonDeletableRejected = String(error).includes("NODE_NOT_DELETABLE");
  }
  if (!nonDeletableRejected) {
    throw new Error("Non-deletable Material output was reported as a successful no-op");
  }
  const probeOperations = [
    {
      type: "node.create",
      tempId: "height",
      nodeTypeId: "perlin",
      position: { x: 0, y: 0 },
      parameters: { scale_x: 8, scale_y: 8, iterations: 4, persistence: 0.5 }
    },
    {
      type: "node.create",
      tempId: "albedo",
      nodeTypeId: "colorize",
      position: { x: 260, y: -100 }
    },
    {
      type: "node.create",
      tempId: "normal",
      nodeTypeId: "normal_map2",
      position: { x: 260, y: 140 },
      parameters: { strength: 1 }
    },
    {
      type: "node.create",
      tempId: "stage_comment",
      nodeTypeId: "comment",
      position: { x: -80, y: -180 },
      comment: {
        title: "Surface stage",
        text: "Organized native graph documentation",
        size: { width: 720, height: 520 }
      }
    },
    {
      type: "node.create",
      tempId: "controls",
      nodeTypeId: "remote",
      position: { x: -80, y: 380 },
      remoteControls: [
        {
          name: "surface_scale",
          label: "Surface Scale",
          description: "Controls the native Perlin scale",
          links: [
            { nodeId: "height", parameter: "scale_x" },
            { nodeId: "height", parameter: "scale_y" }
          ]
        }
      ]
    },
    {
      type: "connection.create",
      fromNodeId: "height",
      fromPort: "output",
      toNodeId: "albedo",
      toPort: "input"
    },
    {
      type: "connection.create",
      fromNodeId: "height",
      fromPort: "output",
      toNodeId: "normal",
      toPort: "input"
    },
    {
      type: "connection.create",
      fromNodeId: "albedo",
      fromPort: 0,
      toNodeId: initialMaterial.id,
      toPort: 0
    },
    {
      type: "connection.create",
      fromNodeId: "height",
      fromPort: 0,
      toNodeId: initialMaterial.id,
      toPort: 2
    },
    {
      type: "connection.create",
      fromNodeId: "normal",
      fromPort: 0,
      toNodeId: initialMaterial.id,
      toPort: 4
    },
    {
      type: "connection.create",
      fromNodeId: "height",
      fromPort: 0,
      toNodeId: initialMaterial.id,
      toPort: 5
    },
    {
      type: "connection.create",
      fromNodeId: "height",
      fromPort: 0,
      toNodeId: initialMaterial.id,
      toPort: 6
    }
  ];
  const planned = await client.request("graph.apply_patch", {
    patch: {
      patchVersion: "1",
      projectId: active.id,
      expectedRevision: snapshot.revision,
      idempotencyKey: `native-probe-${process.pid}`,
      label: "MaterialPilot native dry-run probe",
      dryRun: true,
      validationPolicy: "structural",
      operations: probeOperations
    }
  });
  if (planned.status !== "planned" || planned.revision !== snapshot.revision) {
    throw new Error("Native dry-run transaction contract failed");
  }
  const plannedPerlin = planned.serializedGraph.nodes.find((node) => node.type === "perlin");
  const plannedComment = planned.serializedGraph.nodes.find((node) => node.type === "comment");
  const plannedControls = planned.serializedGraph.nodes.find((node) => node.type === "remote");
  if (
    planned.serializedGraph.nodes.length !== snapshot.serializedGraph.nodes.length + 5 ||
    planned.serializedGraph.connections.length !==
      snapshot.serializedGraph.connections.length + 7 ||
    plannedPerlin?.parameters?.scale_x !== 8 ||
    plannedPerlin?.parameters?.scale_y !== 8 ||
    plannedComment?.title !== "Surface stage" ||
    plannedComment?.text !== "Organized native graph documentation" ||
    plannedComment?.size?.x !== 720 ||
    plannedControls?.widgets?.[0]?.name !== "surface_scale" ||
    plannedControls?.widgets?.[0]?.linked_widgets?.length !== 2
  ) {
    throw new Error(
      `Native multi-node patch did not preserve nodes, connections, parameters, comments, and controls: ${JSON.stringify({ nodeDelta: planned.serializedGraph.nodes.length - snapshot.serializedGraph.nodes.length, connectionDelta: planned.serializedGraph.connections.length - snapshot.serializedGraph.connections.length, plannedPerlin, plannedComment, plannedControls })}`
    );
  }
  const plannedDomain = ptexToSnapshot(planned.serializedGraph, active.id, {
    revision: planned.revision
  });
  for (const tempId of ["height", "albedo", "normal", "stage_comment", "controls"]) {
    const nativeName = planned.temporaryNativeIds?.[tempId];
    const node = plannedDomain.nodes.find((candidate) => candidate.nativeId === nativeName);
    if (!node || planned.temporaryIds?.[tempId] !== node.id) {
      throw new Error("Temporary ID mapping did not identify the planned node: " + tempId);
    }
  }
  const after = await client.request("graph.get_snapshot", { projectId: active.id });
  if (after.hash !== snapshot.hash || after.revision !== snapshot.revision) {
    const difference = firstDifference(
      semanticGraph(snapshot.serializedGraph),
      semanticGraph(after.serializedGraph)
    );
    throw new Error(
      `Native dry-run changed the active Material Maker project at ${difference?.path ?? "hash"}: ${JSON.stringify({ difference, beforeHash: snapshot.hash, afterHash: after.hash, beforeRevision: snapshot.revision, afterRevision: after.revision })}`
    );
  }

  const committed = await client.request("graph.apply_patch", {
    patch: {
      patchVersion: "1",
      projectId: active.id,
      expectedRevision: after.revision,
      idempotencyKey: `native-commit-${process.pid}`,
      label: "MaterialPilot native undo/redo probe",
      dryRun: false,
      validationPolicy: "structural",
      operations: probeOperations
    }
  });
  if (committed.status !== "committed" || committed.revision !== after.revision + 1) {
    throw new Error("Native committed transaction contract failed");
  }
  const committedDomain = ptexToSnapshot(committed.serializedGraph, active.id, {
    revision: committed.revision
  });
  const savedPath = join(runtimeDirectory, "native-capability-test.ptex");
  const saved = await client.request("project.save", {
    projectId: active.id,
    path: savedPath,
    expectedRevision: committed.revision,
    idempotencyKey: `native-save-${process.pid}`,
    overwrite: false
  });
  await access(savedPath);
  if (resolve(saved.path) !== resolve(savedPath) || saved.dirty !== false) {
    throw new Error(`Native project save contract failed: ${JSON.stringify(saved)}`);
  }
  for (const geometry of ["sphere", "plane"]) {
    const materialPreview = await client.request("preview.render_material_3d", {
      projectId: active.id,
      geometry,
      resolution: 256
    });
    if (
      materialPreview.mimeType !== "image/png" ||
      materialPreview.width !== 256 ||
      materialPreview.height !== 256 ||
      materialPreview.data.length < 32
    ) {
      throw new Error(`Native ${geometry} material preview contract failed`);
    }
    assertPreviewHasMaterial(materialPreview.data, geometry);
  }
  const exportDirectory = join(runtimeDirectory, "export");
  await mkdir(exportDirectory);
  const exportPrefix = join(exportDirectory, "native-capability-test");
  const artifacts = await client.request("export.blender", {
    projectId: active.id,
    prefix: exportPrefix,
    expectedRevision: committed.revision,
    idempotencyKey: `native-export-${process.pid}`,
    overwrite: false
  });
  if (
    artifacts.length < 5 ||
    artifacts.some(
      (artifact) =>
        typeof artifact.sha256 !== "string" ||
        artifact.sha256.length !== 64 ||
        artifact.sizeBytes <= 0
    )
  ) {
    throw new Error(`Native Blender export verification failed: ${JSON.stringify(artifacts)}`);
  }
  const committedConnection = committedDomain.connections[0];
  const committedNormal = committedDomain.nodes.find(
    (node) => node.typeId === "mm.filter.normal-map"
  );
  if (!committedConnection || !committedNormal) {
    throw new Error("Committed native graph did not expose stable deletion targets");
  }
  const deletionPlan = await client.request("graph.apply_patch", {
    patch: {
      patchVersion: "1",
      projectId: active.id,
      expectedRevision: committed.revision,
      idempotencyKey: "stable-delete-" + process.pid,
      label: "MaterialPilot stable deletion probe",
      dryRun: true,
      validationPolicy: "structural",
      operations: [
        { type: "connection.delete", connectionId: committedConnection.id },
        { type: "node.delete", nodeId: committedNormal.id, cascade: "disconnect" }
      ]
    }
  });
  const deletionDomain = ptexToSnapshot(deletionPlan.serializedGraph, active.id, {
    revision: deletionPlan.revision
  });
  if (
    deletionDomain.connections.some((connection) => connection.id === committedConnection.id) ||
    deletionDomain.nodes.some((node) => node.id === committedNormal.id)
  ) {
    throw new Error("Stable connection or cascading node deletion was absent from dry-run output");
  }
  const previewNode = committedDomain.nodes.find((node) => node.outputs.length > 0);
  if (!previewNode) throw new Error("Committed graph did not expose a previewable node");
  const preview = await client.request("preview.render_node_output", {
    projectId: active.id,
    nodeId: previewNode.id,
    outputPort: previewNode.outputs[0].index,
    resolution: 512
  });
  const previewBytes = Buffer.from(preview.data, "base64");
  if (
    preview.mimeType !== "image/png" ||
    preview.width !== 512 ||
    preview.height !== 512 ||
    typeof preview.data !== "string" ||
    previewBytes.length <= 65_535
  ) {
    throw new Error("Native node-output preview did not cross the default WebSocket buffer");
  }
  const afterDeletionPlan = await client.request("graph.get_snapshot", { projectId: active.id });
  if (
    afterDeletionPlan.hash !== committed.hash ||
    afterDeletionPlan.revision !== committed.revision
  ) {
    throw new Error("Stable deletion dry-run changed the live native graph");
  }

  const undone = await client.request("graph.undo", {
    projectId: active.id,
    expectedRevision: committed.revision
  });
  const undoDifference = firstDifference(
    semanticGraph(snapshot.serializedGraph),
    semanticGraph(undone.serializedGraph)
  );
  if (undoDifference || undone.revision !== committed.revision + 1) {
    throw new Error(`Native undo contract failed: ${JSON.stringify(undoDifference)}`);
  }

  const redone = await client.request("graph.redo", {
    projectId: active.id,
    expectedRevision: undone.revision
  });
  const redoDifference = firstDifference(
    semanticGraph(committed.serializedGraph),
    semanticGraph(redone.serializedGraph)
  );
  if (redoDifference || redone.revision !== undone.revision + 1) {
    throw new Error(`Native redo contract failed: ${JSON.stringify(redoDifference)}`);
  }

  const restored = await client.request("graph.undo", {
    projectId: active.id,
    expectedRevision: redone.revision
  });
  const restoreDifference = firstDifference(
    semanticGraph(snapshot.serializedGraph),
    semanticGraph(restored.serializedGraph)
  );
  if (restoreDifference || restored.revision !== redone.revision + 1) {
    throw new Error(`Native final restore contract failed: ${JSON.stringify(restoreDifference)}`);
  }
  await delay(100);
  if (
    output.value.includes("Unsupported node type") &&
    output.value.includes("undoredo_step_actions")
  ) {
    throw new Error("Native patch emitted an unsupported leaf-node undo diagnostic");
  }
  process.stdout.write(
    `Material Maker ${status.materialMakerVersion} native project creation, patch, rollback, undo, redo, save, 3D preview, and Blender export contracts passed on Godot ${status.godotVersion}.\n`
  );
} catch (error) {
  throw new Error(
    `${error instanceof Error ? error.message : String(error)}\nGodot output:\n${output.value}`
  );
} finally {
  client?.close();
  if (child.exitCode === null) {
    const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
    child.kill();
    await Promise.race([exited, delay(3_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await rm(runtimeDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
