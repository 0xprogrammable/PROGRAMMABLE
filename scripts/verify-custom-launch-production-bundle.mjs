import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const PRODUCTION_BUNDLE_ROOTS = [".next/static", ".next/server"];
const DEVELOPMENT_ONLY_MARKERS = [
  "programmable-custom-launch-local-preview-v1",
  "example-labs/approved-module",
  "local-interface-preview",
  "Local seed",
];

function filesUnder(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...filesUnder(path));
    else if (/\.(?:js|json)$/u.test(entry)) files.push(path);
  }
  return files;
}

export function verifyCustomLaunchProductionBundle(root = process.cwd()) {
  const absoluteRoot = resolve(root);
  const bundleRoots = PRODUCTION_BUNDLE_ROOTS
    .map((path) => join(absoluteRoot, path))
    .filter(existsSync);
  if (bundleRoots.length !== PRODUCTION_BUNDLE_ROOTS.length) {
    throw new Error("Production bundle is missing; run next build before scanning local preview isolation");
  }
  const findings = [];
  for (const file of bundleRoots.flatMap(filesUnder)) {
    const source = readFileSync(file, "utf8");
    for (const marker of DEVELOPMENT_ONLY_MARKERS) {
      if (source.includes(marker)) {
        findings.push(`${relative(absoluteRoot, file)} contains ${JSON.stringify(marker)}`);
      }
    }
  }
  if (findings.length > 0) {
    throw new Error(`Development-only Custom Launch preview leaked into production:\n${findings.join("\n")}`);
  }
  return Object.freeze({
    schemaVersion: "programmable.custom-launch-production-bundle-scan.v1",
    scannedRoots: PRODUCTION_BUNDLE_ROOTS,
    forbiddenMarkerCount: DEVELOPMENT_ONLY_MARKERS.length,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(verifyCustomLaunchProductionBundle())}\n`);
}
