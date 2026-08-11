import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyVerifyPaths,
  CONTRACT_RELEASE_TEST_PATHS,
  DATABASE_RUNTIME_SOURCE_PATHS,
  DATABASE_RUNTIME_TEST_PATHS,
  READ_MODEL_CONTRACT_DOC_PATHS,
} from "./classify-verify-paths.mjs";

const none = {
  contracts: false,
  database: false,
  dependencies: false,
  indexer: false,
  interface: false,
  read_model: false,
};

test("keeps documentation changes on the minimal lane", () => {
  assert.deepEqual(classifyVerifyPaths(["docs/guide.md", "README.md"]), none);
});

test("does not let filename prefixes masquerade as documentation", () => {
  for (const path of ["README.md.mjs", "AGENTS.md/runtime.ts"]) {
    assert.deepEqual(
      classifyVerifyPaths([path]),
      classifyVerifyPaths([], { forceAll: true }),
    );
  }
});

test("routes source-bound operations documentation through its contract", () => {
  for (const path of READ_MODEL_CONTRACT_DOC_PATHS) {
    assert.deepEqual(classifyVerifyPaths([path]), {
      ...none,
      interface: true,
      read_model: true,
    });
  }
});

test("routes ordinary website changes only to the interface lane", () => {
  assert.deepEqual(classifyVerifyPaths(["components/token-card.tsx"]), {
    ...none,
    interface: true,
  });
});

test("routes read-model API changes to interface and operations checks", () => {
  assert.deepEqual(classifyVerifyPaths(["app/api/explore/route.ts"]), {
    ...none,
    interface: true,
    read_model: true,
  });
});

test("keeps contract, database, and indexer lanes independent", () => {
  assert.deepEqual(
    classifyVerifyPaths([
      "contracts/src/Router.sol",
      "supabase/migrations/001.sql",
      "indexer/src/index.ts",
    ]),
    {
      ...none,
      contracts: true,
      database: true,
      indexer: true,
      interface: true,
      read_model: true,
    },
  );
});

test("runs all lanes for dependency, workflow, and unknown surfaces", () => {
  for (const path of [
    "package-lock.json",
    ".github/workflows/verify.yml",
    "scripts/ci/classify-verify-paths.mjs",
    "scripts/security/run-gitleaks-ci.sh",
    "scripts/resolve-custom-launch-staging-policy.mjs",
    "config/read-model-operations.v1.json",
    "docs/security/CUSTOM_REGISTRY_EVENT_SET_V1.json",
    "docs/operations/releases/custom-launch-release-record.template.json",
    "lib/vendor/router-v2-shared-lifecycle-v3/source-manifest.json",
    "new-runtime/file.bin",
  ]) {
    assert.deepEqual(
      classifyVerifyPaths([path]),
      classifyVerifyPaths([], { forceAll: true }),
    );
  }
});

test("routes database and indexer changes through interface integration coverage", () => {
  for (const path of ["supabase/migrations/001.sql", "indexer/src/index.ts"]) {
    const result = classifyVerifyPaths([path]);
    assert.equal(result.interface, true);
    assert.equal(result.read_model, true);
  }
});

test("routes artifact-dependent release tests through the contract lane", () => {
  for (const path of CONTRACT_RELEASE_TEST_PATHS) {
    assert.deepEqual(classifyVerifyPaths([path]), {
      ...none,
      contracts: true,
      interface: true,
    });
  }
});

test("routes the PGlite-backed website runtime through the database lane", () => {
  for (const path of [
    ...DATABASE_RUNTIME_TEST_PATHS,
    ...DATABASE_RUNTIME_SOURCE_PATHS,
    "lib/server/projection-target/postgres-store.ts",
  ]) {
    assert.deepEqual(classifyVerifyPaths([path]), {
      ...none,
      database: true,
      interface: true,
      read_model: true,
    });
  }
});

test("partitions every artifact-dependent suite without multi-filter side effects", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const interfaceCommand = packageJson.scripts["test:interface:ci"];
  const contractCommand = packageJson.scripts["test:contract-release:ci"];

  assert.equal(
    contractCommand.split(" && ").length,
    CONTRACT_RELEASE_TEST_PATHS.length,
  );
  for (const path of CONTRACT_RELEASE_TEST_PATHS) {
    assert.match(
      interfaceCommand,
      new RegExp(`--exclude ${path.replaceAll(".", "\\.")}`),
    );
    assert.equal(contractCommand.split(path).length - 1, 1);
  }
});

test("partitions every database runtime suite out of the concurrent interface batch", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const interfaceCommand = packageJson.scripts["test:interface:ci"];
  const databaseCommand = packageJson.scripts["test:database-runtime:ci"];
  const verifyCommand = packageJson.scripts.verify;

  for (const path of DATABASE_RUNTIME_TEST_PATHS) {
    assert.match(
      interfaceCommand,
      new RegExp(`--exclude ${path.replaceAll(".", "\\.")}`),
    );
    assert.equal(databaseCommand.split(path).length - 1, 1);
  }
  assert.match(verifyCommand, /npm run test:database-runtime:ci/u);
});

test("keeps protected jobs fail closed and production pushes complete", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");

  assert.match(workflow, /git diff --no-renames --name-only/u);
  assert.match(workflow, /git show "\$BASE_SHA:scripts\/ci\/classify-verify-paths\.mjs"/u);
  assert.match(workflow, /FORCE_ALL: \$\{\{ github\.event_name == 'push' \}\}/u);
  assert.doesNotMatch(workflow, /run: npm run verify\n/u);
  assert.match(
    workflow,
    /name: Verify affected interface\n        if: needs\.scope\.outputs\.interface == 'true'/u,
  );
  assert.equal(workflow.match(/^    if: always\(\)$/gmu)?.length, 4);
  assert.equal(
    workflow.match(/name: Require successful change classification/gmu)?.length,
    4,
  );
  assert.equal(workflow.match(/if: needs\.scope\.result != 'success'/gmu)?.length, 4);

  for (const name of [
    "Credential leak gate",
    "Realtime indexer",
    "Database (PGlite)",
    "Interface",
    "Contracts",
  ]) {
    assert.match(workflow, new RegExp(`name: ${name.replace(/[()]/gu, "\\$&")}`));
  }
});
