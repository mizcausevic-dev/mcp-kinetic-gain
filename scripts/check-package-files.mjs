import { readFileSync } from "node:fs";

const inventoryPath = process.argv[2];
if (!inventoryPath) {
  throw new Error("Pass the npm pack JSON inventory path.");
}

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
if (!Array.isArray(inventory) || inventory.length !== 1) {
  throw new Error("Expected exactly one npm package in the inventory.");
}

const [packed] = inventory;
if (packed.name !== manifest.name || packed.version !== manifest.version || !Array.isArray(packed.files)) {
  throw new Error("Packed package identity or file list does not match the manifest.");
}

const paths = packed.files.map((file) => file.path);
const includedRootFiles = new Set(["README.md", "LICENSE", "package.json"]);
const pilotFile = /^dist\/(?:secure-http|secure-gate|broker-bridge|external-revocation)(?:\.|\/)/;
if (!paths.includes("dist/server.js") || !paths.includes("dist/server.d.ts")) {
  throw new Error("The public stdio entry point is missing from the package.");
}
for (const path of paths) {
  if (typeof path !== "string" || (!path.startsWith("dist/") && !includedRootFiles.has(path))) {
    throw new Error(`Unexpected package file: ${String(path)}`);
  }
  if (pilotFile.test(path)) {
    throw new Error(`Source-only pilot leaked into the package: ${path}`);
  }
}
console.log(`Verified ${paths.length} package files; source-only pilot excluded.`);
