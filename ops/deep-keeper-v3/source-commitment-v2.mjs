import { readFileSync } from "node:fs";
import path from "node:path";

import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
} from "viem";

import {
  DEEP_V3_OPS_V2_CRON_POLICY,
  DEEP_V3_OPS_V2_FORBIDDEN_CRON_PATHS,
  DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS,
  DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES,
  DEEP_V3_OPS_V2_SCRIPT_POLICY,
  DEEP_V3_OPS_V2_SOURCE_PATHS,
} from "./source-files-v2.mjs";

export {
  DEEP_V3_OPS_V2_CRON_POLICY,
  DEEP_V3_OPS_V2_FORBIDDEN_CRON_PATHS,
  DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS,
  DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES,
  DEEP_V3_OPS_V2_SCRIPT_POLICY,
  DEEP_V3_OPS_V2_SOURCE_PATHS,
};

const DOMAIN = keccak256(
  stringToHex("programmable.deep.keeper.ops.v2.source"),
);
const ROOT_DEPENDENCY_GROUPS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);
const SIDE_EFFECT_IMPORT_PATTERN =
  /^\s*import\s*["']([^"']+)["']\s*;?/gm;
const FROM_IMPORT_PATTERN =
  /^\s*(?:import|export)\s+(?:type\s+)?[^;]*?\s+from\s+["']([^"']+)["']\s*;?/gm;
const DYNAMIC_IMPORT_PATTERN =
  /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;

function fileHex(file) {
  const contents = readFileSync(file);
  return `0x${contents.toString("hex")}`;
}

function record(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function withinRoot(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const absolutePath = path.resolve(resolvedRoot, relativePath);
  if (!absolutePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Deep V3 ops v2 source path escaped the root");
  }
  return absolutePath;
}

function readJson(root, relativePath) {
  let parsed;
  try {
    parsed = JSON.parse(
      readFileSync(withinRoot(root, relativePath), "utf8"),
    );
  } catch (error) {
    throw new Error(
      `Deep V3 ops v2 could not read ${relativePath}`,
      { cause: error },
    );
  }
  return record(parsed, relativePath);
}

function externalPackageName(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:")
  ) {
    return null;
  }
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `Deep V3 ops v2 has an invalid external import: ${specifier}`,
      );
    }
    return `${parts[0]}/${parts[1]}`;
  }
  if (!parts[0]) {
    throw new Error(
      `Deep V3 ops v2 has an invalid external import: ${specifier}`,
    );
  }
  return parts[0];
}

function sourceImports(contents) {
  const specifiers = new Set();
  for (const pattern of [
    SIDE_EFFECT_IMPORT_PATTERN,
    FROM_IMPORT_PATTERN,
    DYNAMIC_IMPORT_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    for (const match of contents.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return specifiers;
}

export function inspectDeepV3OpsV2RuntimeDependencies(root) {
  const packages = new Set();
  for (const relativePath of DEEP_V3_OPS_V2_SOURCE_PATHS) {
    const contents = readFileSync(
      withinRoot(root, relativePath),
      "utf8",
    );
    for (const specifier of sourceImports(contents)) {
      const packageName = externalPackageName(specifier);
      if (packageName) packages.add(packageName);
    }
  }
  return [...packages].sort();
}

function dependencyOccurrences(manifest, name) {
  return ROOT_DEPENDENCY_GROUPS.filter((group) => {
    const dependencies = manifest[group];
    return (
      dependencies &&
      typeof dependencies === "object" &&
      !Array.isArray(dependencies) &&
      Object.hasOwn(dependencies, name)
    );
  });
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function lockPackageName(packagePath) {
  const marker = "node_modules/";
  const index = packagePath.lastIndexOf(marker);
  if (index < 0) {
    throw new Error(
      `Deep V3 ops v2 invalid lockfile package path: ${packagePath}`,
    );
  }
  return packagePath.slice(index + marker.length);
}

function parentPackagePath(packagePath) {
  const marker = "/node_modules/";
  const index = packagePath.lastIndexOf(marker);
  return index < 0 ? "" : packagePath.slice(0, index);
}

function findLockPackage(lockPackages, importerPath, name) {
  let current = importerPath;
  while (true) {
    const candidate = current
      ? `${current}/node_modules/${name}`
      : `node_modules/${name}`;
    if (Object.hasOwn(lockPackages, candidate)) {
      return candidate;
    }
    if (!current) break;
    current = parentPackagePath(current);
  }
  return null;
}

function resolveLockPackage(lockPackages, importerPath, name) {
  const resolved = findLockPackage(lockPackages, importerPath, name);
  if (resolved) return resolved;
  throw new Error(
    `Deep V3 ops v2 dependency ${name} is missing from the resolved closure of ${importerPath}`,
  );
}

function dependencyMap(entry, field, label) {
  if (entry[field] === undefined) return {};
  return record(entry[field], `${label} ${field}`);
}

function dependencyEdges(lockPackages, packagePath, entry) {
  const specs = new Map();
  for (const [kind, field] of [
    ["dependency", "dependencies"],
    ["optional", "optionalDependencies"],
  ]) {
    const dependencies = dependencyMap(
      entry,
      field,
      packagePath,
    );
    for (const [name, range] of Object.entries(dependencies)) {
      const normalizedRange = requiredString(
        range,
        `${packagePath} ${field} ${name}`,
      );
      const prior = specs.get(name);
      if (prior) {
        throw new Error(
          `Deep V3 ops v2 dependency edge is ambiguous: ${packagePath}/${name}`,
        );
      }
      specs.set(name, { kind, range: normalizedRange });
    }
  }

  const peers = dependencyMap(
    entry,
    "peerDependencies",
    packagePath,
  );
  const peerMeta = dependencyMap(
    entry,
    "peerDependenciesMeta",
    packagePath,
  );
  for (const [name, range] of Object.entries(peers)) {
    const metadata = peerMeta[name];
    const optional =
      metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      metadata.optional === true;
    const peerPath = findLockPackage(
      lockPackages,
      packagePath,
      name,
    );
    if (optional && !peerPath) continue;
    if (!peerPath) {
      throw new Error(
        `Deep V3 ops v2 required peer ${name} is missing from ${packagePath}`,
      );
    }
    if (specs.has(name)) {
      throw new Error(
        `Deep V3 ops v2 peer constraint is ambiguous: ${packagePath}/${name}`,
      );
    }
    specs.set(name, {
      kind: optional ? "optional-peer" : "peer",
      range: requiredString(
        range,
        `${packagePath} peerDependencies ${name}`,
      ),
      path: peerPath,
    });
  }

  return [...specs.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, spec]) =>
      Object.freeze({
        kind: spec.kind,
        name,
        range: spec.range,
        path:
          spec.path ??
          resolveLockPackage(lockPackages, packagePath, name),
      }),
    );
}

function lockedNode(lockPackages, packagePath) {
  const entry = record(
    lockPackages[packagePath],
    `package-lock.json ${packagePath}`,
  );
  if (entry.link === true) {
    throw new Error(
      `Deep V3 ops v2 dependency closure cannot contain a link: ${packagePath}`,
    );
  }
  return Object.freeze({
    path: packagePath,
    name: lockPackageName(packagePath),
    version: requiredString(
      entry.version,
      `${packagePath} version`,
    ),
    resolved: requiredString(
      entry.resolved,
      `${packagePath} resolved`,
    ),
    integrity: requiredString(
      entry.integrity,
      `${packagePath} integrity`,
    ),
    edges: Object.freeze(
      dependencyEdges(lockPackages, packagePath, entry),
    ),
  });
}

function resolvedDependencyClosure(lockPackages, seedPaths) {
  const nodes = new Map();
  const visiting = new Set();

  function visit(packagePath) {
    if (visiting.has(packagePath)) {
      throw new Error(
        `Deep V3 ops v2 dependency closure contains a cycle at ${packagePath}`,
      );
    }
    if (nodes.has(packagePath)) return;
    visiting.add(packagePath);
    const node = lockedNode(lockPackages, packagePath);
    for (const edge of node.edges) visit(edge.path);
    visiting.delete(packagePath);
    nodes.set(packagePath, node);
  }

  for (const seedPath of [...seedPaths].sort()) visit(seedPath);
  return [...nodes.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

export function buildDeepV3OpsV2DependencyProjection(root) {
  const expectedDependencies = [
    ...DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES,
  ].sort();
  const observedDependencies =
    inspectDeepV3OpsV2RuntimeDependencies(root);
  if (
    JSON.stringify(observedDependencies) !==
    JSON.stringify(expectedDependencies)
  ) {
    throw new Error(
      `Deep V3 ops v2 external dependency drift: ${observedDependencies.join(",")}/${expectedDependencies.join(",")}`,
    );
  }

  const packageJson = readJson(root, "package.json");
  const packageLock = readJson(root, "package-lock.json");
  if (packageLock.lockfileVersion !== 3) {
    throw new Error(
      "Deep V3 ops v2 requires package-lock.json lockfileVersion 3",
    );
  }
  const lockPackages = record(
    packageLock.packages,
    "package-lock.json packages",
  );
  const lockRoot = record(
    lockPackages[""],
    "package-lock.json root package",
  );

  const seeds = expectedDependencies.map((name) => {
    const packageOccurrences = dependencyOccurrences(
      packageJson,
      name,
    );
    const lockOccurrences = dependencyOccurrences(lockRoot, name);
    if (
      packageOccurrences.length !== 1 ||
      packageOccurrences[0] !== "dependencies"
    ) {
      throw new Error(
        `Deep V3 ops v2 dependency ${name} must appear once in package.json dependencies`,
      );
    }
    if (
      lockOccurrences.length !== 1 ||
      lockOccurrences[0] !== "dependencies"
    ) {
      throw new Error(
        `Deep V3 ops v2 dependency ${name} must appear once in the lockfile root dependencies`,
      );
    }
    const rootRange = requiredString(
      packageJson.dependencies[name],
      `package.json ${name} range`,
    );
    const lockRootRange = requiredString(
      lockRoot.dependencies[name],
      `package-lock.json root ${name} range`,
    );
    if (rootRange !== lockRootRange) {
      throw new Error(
        `Deep V3 ops v2 dependency ${name} root range mismatch`,
      );
    }

    const packagePath = `node_modules/${name}`;
    const locked = lockedNode(lockPackages, packagePath);
    if (locked.name !== name) {
      throw new Error(
        `Deep V3 ops v2 dependency ${name} resolved to ${locked.name}`,
      );
    }
    return Object.freeze({
      name,
      rootRange,
      path: packagePath,
    });
  });
  return Object.freeze({
    lockfileVersion: 3,
    seeds: Object.freeze(seeds),
    closure: Object.freeze(
      resolvedDependencyClosure(
        lockPackages,
        seeds.map((seed) => seed.path),
      ),
    ),
  });
}

export function buildDeepV3OpsV2ScriptProjection(root) {
  const packageJson = readJson(root, "package.json");
  const scripts = record(packageJson.scripts, "package.json scripts");
  return Object.entries(DEEP_V3_OPS_V2_SCRIPT_POLICY)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, expectedCommand]) => {
      const command = requiredString(
        scripts[name],
        `package.json script ${name}`,
      );
      if (command !== expectedCommand) {
        throw new Error(
          `Deep V3 ops v2 script drift: ${name}`,
        );
      }
      return Object.freeze({ name, command });
    });
}

export function buildDeepV3OpsV2ScheduleProjection(root) {
  const vercel = readJson(root, "vercel.json");
  if (!Array.isArray(vercel.crons)) {
    throw new Error("vercel.json crons must be an array");
  }
  const current = [];
  for (const entry of vercel.crons) {
    const cron = record(entry, "vercel.json cron");
    if (
      DEEP_V3_OPS_V2_FORBIDDEN_CRON_PATHS.includes(cron.path)
    ) {
      throw new Error(
        `Deep V3 ops v2 legacy writer remains scheduled: ${cron.path}`,
      );
    }
    if (cron.path === DEEP_V3_OPS_V2_CRON_POLICY.path) {
      current.push(cron);
    }
  }
  if (current.length !== 1) {
    throw new Error(
      "Deep V3 ops v2 must have exactly one canonical cron",
    );
  }
  const pathValue = requiredString(
    current[0].path,
    "Deep V3 ops v2 cron path",
  );
  const schedule = requiredString(
    current[0].schedule,
    "Deep V3 ops v2 cron schedule",
  );
  if (
    pathValue !== DEEP_V3_OPS_V2_CRON_POLICY.path ||
    schedule !== DEEP_V3_OPS_V2_CRON_POLICY.schedule
  ) {
    throw new Error("Deep V3 ops v2 cron policy drift");
  }
  return Object.freeze({ path: pathValue, schedule });
}

export function buildDeepV3OpsV2Projection(root) {
  return Object.freeze({
    dependencies: buildDeepV3OpsV2DependencyProjection(root),
    scripts: Object.freeze(
      buildDeepV3OpsV2ScriptProjection(root),
    ),
    schedule: buildDeepV3OpsV2ScheduleProjection(root),
  });
}

function fileCommitment(root, relativePath) {
  const contentHash = keccak256(
    fileHex(withinRoot(root, relativePath)),
  );
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("string relativePath, bytes32 contentHash"),
      [relativePath, contentHash],
    ),
  );
}

function dependencySeedCommitment(seed) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string name, string rootRange, string path",
      ),
      [seed.name, seed.rootRange, seed.path],
    ),
  );
}

function dependencyEdgeCommitment(edge) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string kind, string name, string range, string path",
      ),
      [edge.kind, edge.name, edge.range, edge.path],
    ),
  );
}

function dependencyNodeCommitment(node) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string path, string name, string version, string resolved, string integrity, bytes32[] edgeCommitments",
      ),
      [
        node.path,
        node.name,
        node.version,
        node.resolved,
        node.integrity,
        node.edges.map(dependencyEdgeCommitment),
      ],
    ),
  );
}

function scriptCommitment(script) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("string name, string command"),
      [script.name, script.command],
    ),
  );
}

function scheduleCommitment(schedule) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("string path, string schedule"),
      [schedule.path, schedule.schedule],
    ),
  );
}

export function computeDeepV3OpsV2SourceCommitment(root) {
  const fileCommitments = DEEP_V3_OPS_V2_SOURCE_PATHS.map(
    (relativePath) => fileCommitment(root, relativePath),
  );
  const projection = buildDeepV3OpsV2Projection(root);
  const dependencySeedCommitments = projection.dependencies.seeds.map(
    dependencySeedCommitment,
  );
  const dependencyNodeCommitments =
    projection.dependencies.closure.map(
      dependencyNodeCommitment,
    );
  const scriptCommitments = projection.scripts.map(
    scriptCommitment,
  );
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 domain, uint256 lockfileVersion, bytes32[] fileCommitments, bytes32[] dependencySeedCommitments, bytes32[] dependencyNodeCommitments, bytes32[] scriptCommitments, bytes32 scheduleCommitment",
      ),
      [
        DOMAIN,
        BigInt(projection.dependencies.lockfileVersion),
        fileCommitments,
        dependencySeedCommitments,
        dependencyNodeCommitments,
        scriptCommitments,
        scheduleCommitment(projection.schedule),
      ],
    ),
  );
}
