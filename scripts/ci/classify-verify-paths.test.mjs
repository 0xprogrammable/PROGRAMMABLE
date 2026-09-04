import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyVerifyPaths,
  CONTRACT_RELEASE_TEST_PATHS,
  DATABASE_RUNTIME_SOURCE_PATHS,
  DATABASE_RUNTIME_TEST_PATHS,
  READ_MODEL_CONTRACT_DOC_PATHS,
  ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS,
} from "./classify-verify-paths.mjs";

const none = {
  contracts: false,
  custom_v2: false,
  database: false,
  dependencies: false,
  indexer: false,
  interface: false,
  read_model: false,
  robinhood_phase_b_evidence: false,
  robinhood_phase_b_evidence_exact: false,
};

test("routes only the exact Robinhood Phase B backend pair through its short-lived evidence gate", () => {
  assert.deepEqual(classifyVerifyPaths(ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS), {
    ...none,
    robinhood_phase_b_evidence: true,
    robinhood_phase_b_evidence_exact: true,
  });
  assert.deepEqual(classifyVerifyPaths([
    ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS[0],
  ]), {
    ...none,
    robinhood_phase_b_evidence: true,
  });
  assert.deepEqual(classifyVerifyPaths([
    ...ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS,
    "README.md",
  ]), {
    ...none,
    robinhood_phase_b_evidence: true,
  });
  assert.deepEqual(classifyVerifyPaths([], { forceAll: true }), {
    ...none,
    contracts: true,
    custom_v2: true,
    database: true,
    dependencies: true,
    indexer: true,
    interface: true,
    read_model: true,
  });
});

test("routes the versioned Custom V2 surface without legacy market lanes", () => {
  for (const path of [
    "config/custom-registry-v2.deployment.prelaunch.json",
    "config/generic-launch-foundation.prelaunch.v1.json",
    "docs/operations/WEBSITE-PROJECTION-DATABASE-BACKEND-HANDOFF-V1.json",
    "app/api/custom-launch/registry/v2/manifest/route.ts",
    "app/api/custom-launch/generic/v2/readiness/route.ts",
    "app/api/ops/custom-launch/generic-v2-projector/route.ts",
    "app/api/ops/custom-launch/generic-v2-signer-probe/route.ts",
    "app/v2/internal/projections/approval-descriptors/[projectionKey]/route.ts",
    "app/custom-launches/page.tsx",
    "components/generic-launch-directory-v2.tsx",
    "lib/server/custom-launch/generic-launch-production-v2.ts",
    "lib/server/custom-launch/generic-launch-read-production-probe-v1.ts",
    "lib/server/custom-launch/registry-manifest-v2.ts",
    "scripts/custom-v2-read-model-contract-v2.mjs",
    "scripts/read-bounded-response.mjs",
    "scripts/reconcile-generic-signer-probe-deployments.mjs",
    "scripts/test/custom-v2-read-model-contract-v2.test.mjs",
    "scripts/test/read-bounded-response.test.mjs",
    "scripts/test/reconcile-generic-signer-probe-deployments.test.mjs",
    "tests/generic-launch-read-v2.test.ts",
    "tests/generic-launch-read-production-probe-v1.test.ts",
  ]) {
    assert.deepEqual(classifyVerifyPaths([path]), {
      ...none,
      custom_v2: true,
    });
  }
});

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

test("classifies an explicit Custom V2 release against the current full tree", () => {
  assert.deepEqual(
    classifyVerifyPaths([], { customV2Release: true }),
    { ...none, custom_v2: true },
  );
  assert.deepEqual(
    classifyVerifyPaths(["components/token-card.tsx"], {
      customV2Release: true,
    }),
    { ...none, custom_v2: true, interface: true },
  );
  assert.throws(
    () => classifyVerifyPaths([], { customV2Release: "true" }),
    /must be boolean/u,
  );
});

test("routes read-model API changes to interface and operations checks", () => {
  for (const path of [
    "app/api/explore/route.ts",
    "lib/market-data/bitquery.server.ts",
    "lib/explore-financial-data.ts",
  ]) {
    assert.deepEqual(classifyVerifyPaths([path]), {
      ...none,
      interface: true,
      read_model: true,
    });
  }
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
    "lib/vendor/unrecognized-release-authority/source-manifest.json",
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
  const robinhoodCommand = packageJson.scripts["contracts:robinhood:owner-envelope:test"];

  assert.deepEqual(contractCommand.split(" && "), [
    "npm run release:custom-launch:v4:backend-bridge:test",
    ...CONTRACT_RELEASE_TEST_PATHS.map((path) => `vitest run ${path}`),
    "npm run contracts:classic-v4:release:test",
    "npm run contracts:classic-v4:launcher-upgrade:test",
    "npm run contracts:robinhood:owner-envelope:test",
  ]);
  for (const path of CONTRACT_RELEASE_TEST_PATHS) {
    assert.match(
      interfaceCommand,
      new RegExp(`--exclude ${path.replaceAll(".", "\\.")}`),
    );
    assert.equal(contractCommand.split(path).length - 1, 1);
  }
  assert.equal(
    robinhoodCommand.split(
      "contracts/scripts/test/robinhood-custom-launch-sourcify-v2.test.mjs",
    ).length - 1,
    1,
  );
  assert.match(
    robinhoodCommand,
    /^node --test .*robinhood-custom-launch-standard-json\.test\.mjs .*robinhood-custom-launch-owner-envelope\.test\.mjs .*robinhood-custom-launch-sourcify-v2\.test\.mjs/u,
  );
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

test("keeps protected jobs fail closed and production pushes path scoped", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");

  assert.match(workflow, /git diff --no-renames --name-only/u);
  assert.match(
    workflow,
    /git show "\$BASE_SHA:scripts\/ci\/classify-verify-paths\.mjs"/u,
  );
  assert.doesNotMatch(workflow, /FORCE_ALL:/u);
  assert.match(workflow, /robinhood_phase_b_evidence: \$\{\{ steps\.scope\.outputs\.robinhood_phase_b_evidence \}\}/u);
  assert.match(workflow, /robinhood_phase_b_evidence_exact: \$\{\{ steps\.scope\.outputs\.robinhood_phase_b_evidence_exact \}\}/u);
  assert.match(workflow, /Reject partial or mixed Robinhood Phase B backend evidence imports/u);
  assert.match(workflow, /Install exact Cosign verifier for Robinhood Phase B backend evidence/u);
  assert.match(workflow, /verify-backend-import/u);
  assert.match(workflow, /4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71/u);
  assert.match(workflow, /git ls-files --stage -- "\$evidence_path"/u);
  assert.match(workflow, /test "\$\(stat -c '%a' "\$evidence_path"\)" = "644"/u);
  assert.match(workflow, /needs\.scope\.outputs\.robinhood_phase_b_evidence_exact != 'true'\n        run: exit 1/u);
  assert.match(
    workflow,
    /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}/u,
  );
  assert.doesNotMatch(workflow, /run: npm run verify\n/u);
  assert.match(
    workflow,
    /name: Verify affected interface\n        if: needs\.scope\.outputs\.interface == 'true'/u,
  );
  assert.equal(workflow.match(/^    if: always\(\)$/gmu)?.length, 6);
  assert.equal(
    workflow.match(/name: Require successful change classification/gmu)?.length,
    5,
  );
  assert.equal(
    workflow.match(/if: needs\.scope\.result != 'success'/gmu)?.length,
    5,
  );

  for (const name of [
    "Credential leak gate",
    "Realtime indexer",
    "Database (PGlite)",
    "Interface",
    "Contracts",
    "Custom V2",
  ]) {
    assert.match(
      workflow,
      new RegExp(`name: ${name.replace(/[()]/gu, "\\$&")}`),
    );
  }
  assert.match(workflow, /name: Verify aggregate/u);
  assert.match(workflow, /name: Bind production Verify proof/u);
  for (const dependency of [
    "scope",
    "secret-scan",
    "indexer",
    "database-pglite",
    "interface",
    "contracts",
    "custom-v2",
  ]) {
    assert.match(workflow, new RegExp(`      - ${dependency}\\n`, "u"));
  }
  assert.match(workflow, /SCOPE_RESULT: \$\{\{ needs\.scope\.result \}\}/u);
  assert.match(workflow, /test "\$result" = success/u);
});
