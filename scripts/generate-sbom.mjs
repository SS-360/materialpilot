import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");

async function workspaceManifests() {
  const paths = ["package.json"];
  for (const parent of ["apps", "packages"]) {
    for (const entry of await readdir(resolve(root, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) paths.push(`${parent}/${entry.name}/package.json`);
    }
  }
  return Promise.all(
    paths.map(async (path) => ({
      path,
      value: JSON.parse(await readFile(resolve(root, path), "utf8"))
    }))
  );
}

export async function generateSbom(output = resolve(root, "artifacts", "materialpilot.cdx.json")) {
  const manifests = await workspaceManifests();
  const components = new Map();
  for (const { value } of manifests) {
    for (const [name, version] of Object.entries({
      ...value.dependencies,
      ...value.devDependencies
    })) {
      if (String(version).startsWith("workspace:")) continue;
      const cleanVersion = String(version).replace(/^[~^]/, "");
      components.set(name, {
        type: "library",
        name,
        version: cleanVersion,
        purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(cleanVersion)}`
      });
    }
  }
  const rootManifest = manifests.find(({ path }) => path === "package.json").value;
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        type: "application",
        name: rootManifest.name,
        version: rootManifest.version,
        licenses: [{ license: { id: rootManifest.license } }]
      }
    },
    components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name))
  };
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const output = await generateSbom(process.argv[2] ? resolve(process.argv[2]) : undefined);
  process.stdout.write(`Wrote CycloneDX SBOM to ${output}\n`);
}
