import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const verifier = join(
  process.cwd(),
  "scripts/verify-candidate-neutral-production.mjs",
);

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "programmable-neutral-source-"));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source, "utf8");
  }
  return root;
}

function verify(root, ...args) {
  return spawnSync(process.execPath, [verifier, "--root", root, ...args], {
    encoding: "utf8",
  });
}

test("accepts a descriptor-driven production surface", async () => {
  const root = await fixture({
    "app/launch/page.tsx": "export default function Page() { return null; }\n",
    "lib/server/custom-launch/generic-launch-read-v1.ts":
      "export const descriptorDriven = true;\n",
    "package.json": JSON.stringify({ scripts: { build: "next build" } }),
  });
  const result = verify(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CANDIDATE_NEUTRAL_PRODUCTION_SOURCE_VALID/u);
});

test("rejects candidate identities in production source", async () => {
  const projectName = ["Hook", "emon"].join("");
  const root = await fixture({
    "components/launch-console.tsx": `export const identity = "${projectName}";\n`,
  });
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /components\/launch-console\.tsx/u);
});

test("rejects legacy applicant route paths even when their source is generic", async () => {
  const legacySegment = ["manual", "router"].join("-");
  const root = await fixture({
    [`lib/server/custom-launch/${legacySegment}-service.ts`]:
      "export const service = true;\n",
  });
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /forbidden candidate or legacy route path/u);
});

test("rejects a candidate identity in the compiled production bundle", async () => {
  const projectName = ["Sh", "ards"].join("");
  const root = await fixture({
    ".next/server/app/launch/page.js": `export const identity = "${projectName}";\n`,
  });
  const result = verify(root, "--include-build");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /.next\/server\/app\/launch\/page\.js/u);
});

test("rejects applicant cards in source and emitted production bundles", async () => {
  const applicant = ["a", "eon"].join("");
  const secondApplicant = ["based", "bid"].join("");
  const sourceRoot = await fixture({
    "components/launch-console.tsx":
      `export const card = "launch-model-${applicant}";\n`,
  });
  const sourceResult = verify(sourceRoot);
  assert.equal(sourceResult.status, 1);
  assert.match(sourceResult.stderr, /components\/launch-console\.tsx/u);

  const buildRoot = await fixture({
    ".next/static/chunks/launch.js":
      `export const profile = "https://x.com/${secondApplicant}x";\n`,
  });
  const buildResult = verify(buildRoot, "--include-build");
  assert.equal(buildResult.status, 1);
  assert.match(buildResult.stderr, /.next\/static\/chunks\/launch\.js/u);
});

test("rejects retired applicant fee and Registry V1 bindings", async () => {
  const retiredMode = ["custom-registry-v1", "primary-contract"].join("-");
  const oldRegistry = [
    "0x17e18c88bda9bfb73924cdc989c07b070",
    "7e72671",
  ].join("");
  for (const [path, source] of [
    ["lib/custom-launch/route.ts", `export const mode = "${retiredMode}";\n`],
    ["config/release.json", JSON.stringify({ registry: oldRegistry })],
  ]) {
    const root = await fixture({ [path]: source });
    const result = verify(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(path.replaceAll("/", "\\/"), "u"));
  }
});

test("rejects the retired Solidity identity and intake markers", async () => {
  const providerIdentifier = ["AEON", "PROVIDER", "ID"].join("_");
  const intake = ["aeon", "-v1"].join("");
  for (const [path, source] of [
    ["contracts/src/FeePolicy.sol", `bytes32 constant ${providerIdentifier} = 0x00;\n`],
    [".next/server/app/launch.js", `export const intake = "${intake}";\n`],
    [".next/static/chunks/launch.js", `export const asset = "${["based", "bid", "_v1"].join("")}";\n`],
  ]) {
    const root = await fixture({ [path]: source });
    const result = verify(root, ...(path.startsWith(".next/") ? ["--include-build"] : []));
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(path.replaceAll("/", "\\/"), "u"));
  }
});

test("rejects a candidate identity in contract source", async () => {
  const projectName = ["Sh", "ards"].join("");
  const root = await fixture({
    "contracts/src/ApplicantRoute.sol":
      `contract ApplicantRoute { string constant PROJECT = "${projectName}"; }\n`,
  });
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /contracts\/src\/ApplicantRoute\.sol/u);
});

test("rejects a stale candidate exception in root configuration", async () => {
  const projectName = ["Hook", "emon"].join("");
  const root = await fixture({
    ".gitleaks.toml": `description = "${projectName} exception"\n`,
  });
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /.gitleaks\.toml/u);
});

test("rejects an external applicant owner identity in tests", async () => {
  const owner = ["jesse", "stahl"].join("-");
  const root = await fixture({
    "tests/wallet-state.test.ts": `export const owner = "${owner}";\n`,
  });
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tests\/wallet-state\.test\.ts/u);
});
