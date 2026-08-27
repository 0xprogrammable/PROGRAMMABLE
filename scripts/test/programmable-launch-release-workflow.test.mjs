import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = new URL(
  "../../.github/workflows/release-programmable-launch.yml",
  import.meta.url,
);
const source = readFileSync(workflowPath, "utf8");

function failures(value) {
  const required = [
    "github.ref == 'refs/heads/production'",
    "environment: production",
    "actions: read",
    "artifact-metadata: write",
    "attestations: write",
    "contents: write",
    "id-token: write",
    "persist-credentials: false",
    "node-version: 24.14.0",
    "npm@11.16.0",
    "pkg.packageManager !== \"npm@11.16.0\"",
    "node scripts/production-verify-proof.mjs resolve",
    "--verification-mode change",
    "digest-mismatch: error",
    "gh attestation verify \"$proof\"",
    "--source-digest \"$GITHUB_SHA\"",
    "node scripts/production-verify-proof.mjs verify",
    "repos/$GITHUB_REPOSITORY/immutable-releases",
    "Protect Programmable Launch CLI release tags",
    "refs/tags/programmable-launch-v*",
    "npm ci --ignore-scripts --no-audit --no-fund",
    "npm test",
    "npm run verify:machine-contracts",
    "npm run pack:dry-run",
    "node scripts/programmable-launch-release-assets.mjs build",
    "actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26",
    "gh release create \"$TAG\"",
    "--target \"$GITHUB_SHA\"",
    "isImmutable",
    "gh release download \"$TAG\"",
    "gh release verify \"$TAG\"",
    "gh release verify-asset \"$TAG\"",
    "node scripts/programmable-launch-release-assets.mjs verify",
  ];
  return required.filter((item) => !value.includes(item));
}

test("CLI release workflow closes source, test, provenance, and immutability gates", () => {
  assert.deepEqual(failures(source), []);
  assert.equal(source.includes("npm publish"), false);
  assert.equal(source.includes("--clobber"), false);
  assert.equal(source.includes("pull_request"), false);
  assert.equal(source.includes("push:\n"), false);
});

test("release workflow contract mutations fail closed", () => {
  const mutations = [
    source.replace("github.ref == 'refs/heads/production'", "true"),
    source.replace("persist-credentials: false", "persist-credentials: true"),
    source.replaceAll("npm@11.16.0", "npm@latest"),
    source.replaceAll("--verification-mode change", "--verification-mode custom-v2-release"),
    source.replace("digest-mismatch: error", "digest-mismatch: warn"),
    source.replaceAll("--source-digest \"$GITHUB_SHA\"", ""),
    source.replace("repos/$GITHUB_REPOSITORY/immutable-releases", "repos/$GITHUB_REPOSITORY"),
    source.replace("Protect Programmable Launch CLI release tags", "missing"),
    source.replace("npm test", "echo skipped"),
    source.replace("node scripts/programmable-launch-release-assets.mjs build", "echo fabricated"),
    source.replace("actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26", "actions/attest@main"),
    source.replace("--target \"$GITHUB_SHA\"", "--target main"),
    source.replace("gh release verify-asset \"$TAG\"", "echo trusted"),
  ];
  for (const [index, mutation] of mutations.entries()) {
    assert.notDeepEqual(failures(mutation), [], `mutation ${index} escaped the gate`);
  }
});
