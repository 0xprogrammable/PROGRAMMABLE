import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EMPTY_SCOPE = Object.freeze({
  contracts: false,
  database: false,
  dependencies: false,
  indexer: false,
  interface: false,
  read_model: false,
});

export const CONTRACT_RELEASE_TEST_PATHS = Object.freeze([
  "tests/classic-v3-deployment-sequence.test.ts",
  "tests/deep-release-verifier.test.ts",
  "tests/deep-v2-release-verifier.test.ts",
]);

export const DATABASE_RUNTIME_TEST_PATHS = Object.freeze([
  "tests/website-projection-target.test.ts",
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

    if (
      /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|bun\.lock|tsconfig[^/]*\.json|next\.config\.[^/]+|eslint\.config\.[^/]+|vitest\.config\.[^/]+)$/u.test(
        path,
      ) ||
      /^(?:\.github|config|ops|releases|scripts)\//u.test(path) ||
      /^(?:docs\/(?:operations\/releases|security)|lib\/vendor)\//u.test(path) ||
      /^(?:Dockerfile|docker-compose\.ya?ml)$/u.test(path)
    ) {
      markAll(scope);
      continue;
    }

    if (
      /^(?:README\.md|AGENTS\.md|CONTRIBUTING\.md|SECURITY\.md|SUPPORT\.md|CODE_OF_CONDUCT\.md|LICENSE|docs\/)/u.test(
        path,
      )
    ) {
      continue;
    }

    if (
      /^(?:contracts\/|foundry\.toml$|remappings\.txt$)/u.test(
        path,
      )
    ) {
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
      continue;
    }

    if (
      /^(?:app|assets|components|lib|public|tests)\//u.test(
        path,
      ) ||
      /^(?:next-env\.d\.ts|vercel\.json)$/u.test(path)
    ) {
      scope.interface = true;
      if (
        /^(?:app\/api\/(?:explore|ops)\/|lib\/data-pipeline\/)/u.test(
          path,
        ) ||
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
