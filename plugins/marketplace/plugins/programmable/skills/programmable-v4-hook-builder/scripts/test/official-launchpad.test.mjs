import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectLiveObservations } from "../check-upstream-drift.mjs";
import {
  compareOfficialDeploymentRecords,
  resolveOfficialLaunchProfile,
  staleCcaV11Address,
  validateOfficialLaunchpadReference
} from "../official-launchpad-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const script = path.join(skillRoot, "scripts", "check-upstream-drift.mjs");
const referencePath = path.join(skillRoot, "references", "official-launchpad-deployments.json");
const snapshotPath = path.join(skillRoot, "references", "upstream-sources.json");

test("committed official launchpad profiles pin current versions and remain execution-blocked", () => {
  const reference = readJson(referencePath);
  const validated = validateOfficialLaunchpadReference(reference);

  assert.equal(validated.sourcesById.size, 17);
  assert.equal(validated.recordsById.size, 32);
  assert.equal(validated.profilesById.size, 4);
  for (const profileId of [
    "official-cca-lbp-new-token-ethereum",
    "official-cca-lbp-new-token-base",
    "official-cca-lbp-new-token-unichain",
    "official-cca-lbp-new-token-sepolia"
  ]) {
    const profile = resolveOfficialLaunchProfile(reference, profileId);
    assert.equal(profile.records.auctionFactory.version, "v2.1.0");
    assert.equal(profile.records.liquidityLauncher.version, "v3.0.0");
    assert.equal(profile.records.liquidityStrategy.version, "v3.1.0");
    assert.equal(profile.records.tokenFactory.version, "v2.0.0");
    assert.equal(profile.runtimeVerificationStatus, "unverified");
    if (profile.chain === "Base") {
      assert.equal(profile.sourceConflictStatus, "no-recorded-source-conflict");
      assert.equal(profile.executionStatus, "blocked-pending-runtime-and-interface-verification");
    } else {
      assert.equal(profile.sourceConflictStatus, "blocked-official-source-conflict");
      assert.equal(profile.executionStatus, "blocked-official-source-conflict");
    }
  }
});

test("prompt addresses and the stale CCA v1.1 default fail closed", () => {
  const reference = readJson(referencePath);
  assert.throws(
    () => resolveOfficialLaunchProfile(reference, "official-cca-lbp-new-token-ethereum", {
      addresses: { auctionFactory: reference.records[1].address }
    }),
    /prompt-supplied deployment addresses are forbidden/
  );

  const stale = structuredClone(reference);
  const cca = stale.records.find((record) => record.contract === "ContinuousClearingAuctionFactory");
  cca.address = staleCcaV11Address;
  assert.throws(
    () => validateOfficialLaunchpadReference(stale),
    /stale CCA v1\.1 address is forbidden/
  );

  const wrongRelease = structuredClone(reference);
  wrongRelease.records.find((record) => record.contract === "LiquidityLauncher").releaseCommit = "a".repeat(40);
  assert.throws(
    () => validateOfficialLaunchpadReference(wrongRelease),
    /pinned LiquidityLauncher v3\.0\.0 deployment commit/
  );

  assert.throws(
    () => resolveOfficialLaunchProfile(reference, "unknown-profile"),
    /unknown official launch profile/
  );
});

test("official deployment field drift is exact, complete and stably sorted", () => {
  const reference = readJson(referencePath);
  const observed = reference.records.map(feedRecord);
  assert.deepEqual(compareOfficialDeploymentRecords(reference, observed), []);

  const targetId = "liquidity-launchpad-continuousclearingauctionfactory-ethereum";
  const changed = observed.map((record) => record.id === targetId
    ? { ...record, address: staleCcaV11Address, sourceRef: "v1.1.0", status: "deprecated" }
    : record);
  changed.splice(changed.findIndex((record) => record.id === "permit2-permit2-sepolia"), 1);

  assert.deepEqual(
    compareOfficialDeploymentRecords(reference, changed).map((finding) => finding.code),
    [
      "official-deployment-address-drift",
      "official-deployment-source-ref-drift",
      "official-deployment-status-drift",
      "official-deployment-record-missing"
    ]
  );
});

test("default offline gate is deterministic and performs no network requests", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-official-launchpad-"));
  try {
    const snapshot = readJson(snapshotPath);
    const reference = readJson(referencePath);
    const observationsPath = writeJson(fixture, "observations.json", {
      repositories: collectTrackedRepositories(snapshot).map((source) => ({
        repository: source.repository,
        defaultBranch: source.defaultBranch,
        ref: source.trackedRef,
        commit: source.commit,
        archived: source.archived,
        license: Object.hasOwn(source, "license") ? source.license : null
      })),
      feeds: snapshot.observedOfficialFeeds.map((feed) => ({ url: feed.url, sha256: feed.sha256 })),
      deploymentRecords: reference.records.map(feedRecord),
      sourceArtifacts: reference.sources
        .filter((source) => source.authorityKind !== "official-deployment-feed")
        .map((source) => ({ url: source.immutableUrl, sha256: source.contentSha256 }))
    });
    const environment = {
      NO_PROXY: "*",
      HTTPS_PROXY: "http://127.0.0.1:1",
      HTTP_PROXY: "http://127.0.0.1:1"
    };
    const first = run(["--observations", observationsPath, "--json"], environment);
    const second = run(["--observations", observationsPath, "--json"], environment);

    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stderr, "");
    assert.equal(first.stdout, second.stdout);
    const result = JSON.parse(first.stdout);
    assert.equal(result.status, "clean");
    assert.equal(result.compared.deploymentRecords, 32);
    assert.equal(result.compared.officialSourceArtifacts, 16);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("a deployment reference that does not match the upstream pin is rejected", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-official-launchpad-tampered-"));
  try {
    const reference = readJson(referencePath);
    reference.records[0].address = "0x0000000000000000000000000000000000000001";
    const tamperedPath = writeJson(fixture, "reference.json", reference);
    const result = run(["--deployment-reference", tamperedPath, "--observations", tamperedPath]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /deployment reference SHA-256 mismatch/);
    assert.equal(result.stdout, "");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("live requests reject redirects and have a bounded abort timeout", async () => {
  let requestOptions;
  const neverCompletes = (_url, options) => {
    requestOptions = options;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  };

  await assert.rejects(
    collectLiveObservations(minimalSnapshot(), neverCompletes, { timeoutMs: 20 }),
    /request timed out after 20ms/
  );
  assert.equal(requestOptions.redirect, "error");
  assert.equal(requestOptions.headers["Accept-Encoding"], "identity");
  assert.equal(requestOptions.signal.aborted, true);
});

function feedRecord(record) {
  return Object.fromEntries([
    "id",
    "protocol",
    "contract",
    "chain",
    "chainId",
    "address",
    "tier",
    "sourceRepo",
    "sourceRef",
    "sourceCodeUrl",
    "env",
    "status"
  ].map((field) => [field, record[field]]));
}

function collectTrackedRepositories(value, output = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectTrackedRepositories(entry, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (Object.hasOwn(value, "trackedRef")) output.push(value);
  for (const child of Object.values(value)) collectTrackedRepositories(child, output);
  return output;
}

function minimalSnapshot() {
  return {
    schemaVersion: 2,
    snapshotDate: "2026-08-01",
    driftPolicy: {
      organization: "Uniswap",
      repositoryNamePatterns: ["^v4-"],
      ignoreArchivedRepositories: true
    },
    observedOfficialFeeds: []
  };
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function writeJson(directory, name, value) {
  const target = path.join(directory, name);
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

function run(args, environment = {}) {
  return childProcess.spawnSync(process.execPath, [script, ...args], {
    cwd: skillRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    shell: false
  });
}
