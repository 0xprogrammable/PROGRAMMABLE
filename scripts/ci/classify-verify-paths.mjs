import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EMPTY_SCOPE = Object.freeze({
  contracts: false,
  custom_v2: false,
  database: false,
  dependencies: false,
  indexer: false,
  interface: false,
  read_model: false,
});

const CUSTOM_V2_EXACT_PATHS = new Set([
  "config/custom-registry-v2.deployment.prelaunch.json",
  "config/generic-launch-foundation.prelaunch.v1.json",
  "config/generic-launch-foundation.v1.schema.json",
  "config/generic-launch-public.v2.schema.json",
  "lib/custom-launch/registry-public-manifest-v2.ts",
  "lib/data-pipeline/custom-registry-v2-event-manifest.ts",
  "lib/server/custom-launch/registry-manifest-v2.ts",
  "lib/server/projection-target/approval-v3-target.ts",
  "scripts/custom-v2-stage-gate.mjs",
  "scripts/test/custom-v2-stage-gate.test.mjs",
  "scripts/test/custom-v2-production-workflow-contract.test.mjs",
]);

function isCustomV2OnlyPath(path) {
  return CUSTOM_V2_EXACT_PATHS.has(path)
    || /^app\/api\/custom-launch\/(?:generic|registry)\/v2\//u.test(path)
    || /^app\/api\/ops\/custom-launch\/generic-v2-projector\//u.test(path)
    || /^app\/v2\/internal\/projections\/approval-descriptors\//u.test(path)
    || /^app\/custom-launches\//u.test(path)
    || /^components\/generic-launch-directory-v2(?:\.module\.css|\.tsx)$/u.test(path)
    || /^lib\/server\/custom-launch\/generic-launch-[^/]*-v2\.ts$/u.test(path)
    || /^tests\/(?:approval-v3-artifact-projection-target|custom-registry-v2-(?:bindings|public-release)|generic-launch-(?:postgres-v2|projector-v2|read-signer-v2|read-v2|record-v2))\.test\.ts$/u.test(path);
}

export const CONTRACT_RELEASE_TEST_PATHS = Object.freeze([
  "tests/classic-v3-deployment-sequence.test.ts",
  "tests/deep-release-verifier.test.ts",
  "tests/deep-v2-release-verifier.test.ts",
]);

export const DATABASE_RUNTIME_TEST_PATHS = Object.freeze([
  "tests/website-projection-target.test.ts",
]);

export const DATABASE_RUNTIME_SOURCE_PATHS = Object.freeze([
  "lib/server/custom-launch/genesis-canary-public-v1.ts",
  "lib/server/custom-launch/project-read-v2.ts",
  "lib/server/custom-launch/public-readiness.ts",
  "lib/server/custom-launch/registry-public-read-v1.ts",
  "lib/server/custom-launch/registry-public-store-v1.ts",
]);

export const READ_MODEL_CONTRACT_DOC_PATHS = Object.freeze([
  "docs/data-pipeline/PRODUCTION-CUTOVER-OPERATOR.md",
  "docs/operations/read-model-scheduler-cutover.md",
]);

function markAll(scope) {
  for (const key of Object.keys(scope)) {
    scope[key] = true;
  }
}

export function classifyVerifyPaths(paths, { forceAll = false } = {}) {
  const scope = { ...EMPTY_SCOPE };
  if (forceAll) {
    markAll(scope);
    return scope;
  }

  for (const path of paths) {
    if (!path) continue;

    // This closed generation-2 surface has its own production proof and
    // staged health contract. In particular, flipping the versioned Registry
    // deployment binding must not pay Classic, Stock, Explore, or the global
    // market read-model gates.
    if (isCustomV2OnlyPath(path)) {
      scope.custom_v2 = true;
      continue;
    }

    if (
      /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|bun\.lock|tsconfig[^/]*\.json|next\.config\.[^/]+|eslint\.config\.[^/]+|vitest\.config\.[^/]+)$/u.test(
        path,
      ) ||
      /^(?:\.github|config|ops|releases|scripts)\//u.test(path) ||
      /^(?:docs\/(?:operations\/releases|security)|lib\/vendor)\//u.test(
        path,
      ) ||
      /^(?:Dockerfile|docker-compose\.ya?ml)$/u.test(path)
    ) {
      markAll(scope);
      continue;
    }

    if (READ_MODEL_CONTRACT_DOC_PATHS.includes(path)) {
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (
      /^(?:(?:README|AGENTS|CONTRIBUTING|SECURITY|SUPPORT|CODE_OF_CONDUCT)\.md|LICENSE)$/u.test(
        path,
      ) ||
      /^docs\//u.test(path)
    ) {
      continue;
    }

    if (/^(?:contracts\/|foundry\.toml$|remappings\.txt$)/u.test(path)) {
      scope.contracts = true;
      scope.interface = true;
      continue;
    }

    if (/^supabase\//u.test(path)) {
      scope.database = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (
      DATABASE_RUNTIME_TEST_PATHS.includes(path) ||
      DATABASE_RUNTIME_SOURCE_PATHS.includes(path) ||
      /^lib\/server\/projection-target\//u.test(path)
    ) {
      scope.database = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (CONTRACT_RELEASE_TEST_PATHS.includes(path)) {
      scope.contracts = true;
      scope.interface = true;
      continue;
    }

    if (/^indexer\//u.test(path)) {
      scope.indexer = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (path === "lib/data-pipeline/postgres.ts") {
      scope.database = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (/^lib\/onchain\//u.test(path)) {
      scope.contracts = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (
      /^(?:app|assets|components|lib|public|tests)\//u.test(path) ||
      /^(?:next-env\.d\.ts|vercel\.json)$/u.test(path)
    ) {
      scope.interface = true;
      if (
        /^(?:app\/api\/(?:explore|ops)\/|lib\/data-pipeline\/)/u.test(path) ||
        /^lib\/market-data\//u.test(path) ||
        path === "lib/explore-financial-data.ts" ||
        path === "vercel.json"
      ) {
        scope.read_model = true;
      }
      continue;
    }

    // New or unknown surfaces fail safe until they are explicitly classified.
    markAll(scope);
  }

  return scope;
}

function printGithubOutputs(scope) {
  for (const [key, value] of Object.entries(scope)) {
    console.log(`${key}=${value}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const forceAll = process.argv[2] === "--all";
  const paths = forceAll
    ? []
    : readFileSync(process.argv[2], "utf8")
        .split("\n")
        .map((path) => path.trim())
        .filter(Boolean);
  printGithubOutputs(classifyVerifyPaths(paths, { forceAll }));
}
