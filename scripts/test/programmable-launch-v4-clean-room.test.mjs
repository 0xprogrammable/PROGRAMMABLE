import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  assertReleaseMatchesReviewedCoordinate,
  buildCleanRoomEvidence,
  buildCleanRoomRecoveryReceipt,
  canonicalJsonBytes,
  prepareCleanRoom,
  requireReviewedReleaseCoordinateReady,
  validateCleanRoomEvidence,
  validateCleanRoomRecoveryReceipt,
  validateCleanRoomImage,
  validateReleaseFiles,
  validateReviewedReleaseCoordinate,
} from "../programmable-launch-v4-clean-room.mjs";
import {
  validCleanRoomTranscript,
} from "./fixtures/programmable-launch-v4-clean-room.mjs";
import {
  withIsolatedProtectedCheckout,
} from "./fixtures/isolated-protected-checkout.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const bindingPath = "docs/operations/releases/custom-launch-v4/cli-release-binding.json";
const coordinatePath =
  "docs/operations/releases/custom-launch-v4/clean-room-release-coordinate.json";
const runnerPath = "scripts/programmable-launch-v4-clean-room.mjs";

function hexSha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function prettyCanonical(value) {
  const sort = (entry) => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (entry === null || typeof entry !== "object") return entry;
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, sort(entry[key])]));
  };
  return Buffer.from(`${JSON.stringify(sort(value), null, 2)}\n`, "utf8");
}

function blockedCoordinateBaseline(value) {
  const coordinate = structuredClone(value);
  coordinate.releaseReady = false;
  coordinate.source.commitSha = null;
  coordinate.source.treeSha = null;
  coordinate.releaseBinding.sha256 = null;
  coordinate.machineContractBinding.sha256 = null;
  coordinate.manifestSha256 = null;
  coordinate.assets = coordinate.assets.map((asset) => ({ ...asset, sha256: null }));
  coordinate.blockers = [
    "releaseBindingReady",
    "releaseSourceCoordinate",
    "releaseManifestDigest",
    "releaseAssetDigests",
    "machineContractBindingDigest",
  ];
  return coordinate;
}

function awaitingCliCoordinate(value, bindingSha256) {
  const coordinate = blockedCoordinateBaseline(value);
  coordinate.releaseBinding.sha256 = bindingSha256;
  coordinate.machineContractBinding.sha256 = bindingSha256;
  coordinate.blockers = [
    "releaseSourceCoordinate",
    "releaseManifestDigest",
    "releaseAssetDigests",
  ];
  return coordinate;
}

function releaseFiles() {
  const tarballName = "programmable-launch-4.0.0.tgz";
  const checksumName = `${tarballName}.sha256`;
  const sbomName = "programmable-launch-4.0.0.cdx.json";
  const manifestName = "programmable-launch-4.0.0.release.json";
  const tarball = Buffer.from("synthetic-tarball-for-pure-release-contract-test", "utf8");
  const checksum = Buffer.from(`${hexSha(tarball)}  ${tarballName}\n`, "utf8");
  const sbom = prettyCanonical({
    bomFormat: "CycloneDX",
    metadata: { component: { name: "@programmable/launch", version: "4.0.0" } },
    specVersion: "1.6",
    version: 1,
  });
  const payloads = [
    [tarballName, "application/gzip", tarball],
    [checksumName, "text/plain", checksum],
    [sbomName, "application/vnd.cyclonedx+json", sbom],
  ].map(([name, mediaType, bytes]) => ({
    name, mediaType, bytes: bytes.length, sha256: hexSha(bytes),
  })).sort((left, right) => left.name.localeCompare(right.name));
  const manifest = prettyCanonical({
    schemaVersion: "programmable.launch-cli-release-assets.v2",
    repository: "programmablehq/programmable",
    source: {
      ref: "refs/heads/production",
      commitSha: "1".repeat(40),
      treeSha: "2".repeat(40),
    },
    package: {
      name: "@programmable/launch",
      version: "4.0.0",
      tag: "programmable-launch-v4.0.0",
    },
    toolchain: { node: "24.14.0", npm: "11.16.0" },
    machineContractBinding: {
      schemaVersion: "programmable.launch-cli-v4-release-binding.v1",
      path: "docs/operations/releases/custom-launch-v4/cli-release-binding.json",
      sha256: `sha256:${"3".repeat(64)}`,
    },
    assets: payloads,
  });
  return {
    [tarballName]: tarball,
    [checksumName]: checksum,
    [sbomName]: sbom,
    [manifestName]: manifest,
  };
}

function completeTranscript() {
  const input = validCleanRoomTranscript();
  input.recovery = buildCleanRoomRecoveryReceipt(input);
  return input;
}

test("V4 clean-room evidence proves exact idempotent wallet handoff without sensitive bytes", () => {
  const input = completeTranscript();
  const evidence = buildCleanRoomEvidence(input);
  assert.equal(validateCleanRoomEvidence(evidence), evidence);
  assert.equal(evidence.request.chainId, "4663");
  assert.equal(evidence.walletHandoff.status, "wallet_action_required");
  assert.equal(evidence.replay.sameLaunchId, true);
  assert.equal(evidence.replay.sameRequestDigest, true);
  assert.deepEqual(Object.values(evidence.safety), [false, false, false, false, false, false]);
  const serialized = canonicalJsonBytes(evidence).toString("utf8");
  assert.equal(serialized.includes(input.apiKey), false);
  assert.equal(serialized.includes(input.firstSubmit.idempotencyKey), false);
  assert.equal(serialized.includes(input.status.resource.walletTransaction.calldata), false);
  assert.equal(serialized.includes(input.firstSubmit.journalPath), false);
  assert.equal(serialized.endsWith("\n"), true);
});

test("V4 clean-room transcript rejects chain, trust-root, profile, transaction, and replay drift", () => {
  const mutations = [
    (value) => { value.request.chainId = "1"; },
    (value) => { value.remote.capabilities.chain.id = "1"; },
    (value) => { value.remote.preflight.persisted = true; },
    (value) => { value.remote.preflight.walletBroadcastByService = true; },
    (value) => { value.firstSubmit.resource.launchId = "00000000-0000-4000-8000-000000000001"; },
    (value) => { value.replaySubmit.resource.requestHash = `sha256:${"f".repeat(64)}`; },
    (value) => { value.status.resource.status = "awaiting_wallet_signature"; },
    (value) => { value.status.resource.chainDeploymentDescriptorDigest = `0x${"f".repeat(64)}`; },
    (value) => { value.status.resource.profile.profileDigest = `sha256:${"f".repeat(64)}`; },
    (value) => { value.status.resource.walletTransaction.chainId = "1"; },
    (value) => { value.status.resource.walletTransaction.to = "0x1111111111111111111111111111111111111111"; },
    (value) => { value.status.resource.walletTransaction.valueWei = "1"; },
    (value) => { value.status.resource.walletTransaction.walletSignature = "0x1234"; },
    (value) => { value.status.resource.walletTransaction.transactionHash = `0x${"a".repeat(64)}`; },
    (value) => { value.status.resource.onchain = { transactionHash: `0x${"a".repeat(64)}` }; },
    (value) => { value.request.funding.valueWei = "1"; },
    (value) => { value.request.liquidityModel.targetIds.push("token"); },
    (value) => { value.remote.capabilities.safety.walletSignatureProduced = true; },
    (value) => { value.remote.capabilities.safety.transactionBroadcast = true; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const input = validCleanRoomTranscript();
    input.recovery = buildCleanRoomRecoveryReceipt(input);
    mutate(input);
    assert.throws(() => buildCleanRoomEvidence(input), /[A-Z][A-Z0-9_]+/u,
      `mutation ${index} escaped`);
  }
});

test("canonical redacted evidence rejects extra fields, unsafe booleans, and digest drift", () => {
  const evidence = buildCleanRoomEvidence(completeTranscript());
  const mutations = [
    (value) => { value.secret = "unexpected"; },
    (value) => { value.safety.walletSignatureObserved = true; },
    (value) => { value.safety.transactionBroadcastObserved = true; },
    (value) => { value.walletHandoff.status = "finalized"; },
    (value) => { value.request.chainId = "1"; },
    (value) => { value.replay.sameLaunchId = false; },
    (value) => { value.evidenceDigest = `sha256:${"0".repeat(64)}`; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(evidence);
    mutate(changed);
    assert.throws(() => validateCleanRoomEvidence(changed), /[A-Z][A-Z0-9_]+/u);
  }
});

test("V4 release contract binds canonical manifest, checksum, assets, and production source", () => {
  const files = releaseFiles();
  const release = validateReleaseFiles(files);
  assert.equal(release.tag, "programmable-launch-v4.0.0");
  assert.equal(release.source.ref, "refs/heads/production");
  assert.equal(release.assets.length, 4);

  const badChecksum = { ...files };
  badChecksum["programmable-launch-4.0.0.tgz.sha256"] = Buffer.from(`${"0".repeat(64)}  programmable-launch-4.0.0.tgz\n`);
  assert.throws(() => validateReleaseFiles(badChecksum), /RELEASE_/u);

  const badManifest = { ...files };
  const parsed = JSON.parse(badManifest["programmable-launch-4.0.0.release.json"]);
  parsed.source.ref = "refs/heads/main";
  badManifest["programmable-launch-4.0.0.release.json"] = prettyCanonical(parsed);
  assert.throws(() => validateReleaseFiles(badManifest), /RELEASE_SOURCE_REF_INVALID/u);

  const extra = { ...files, "unattested.txt": Buffer.from("no") };
  assert.throws(() => validateReleaseFiles(extra), /RELEASE_FILES_SHAPE_INVALID/u);
});

test("reviewed release coordinate preserves the blocked baseline and binds every released byte", () => {
  const coordinateSchema = JSON.parse(readFileSync(new URL(
    "../../docs/operations/releases/custom-launch-v4/clean-room-release-coordinate.schema.json",
    import.meta.url,
  ), "utf8"));
  const validateCoordinateSchema = new Ajv2020({ strict: true }).compile(coordinateSchema);
  const committed = JSON.parse(readFileSync(new URL(
    "../../docs/operations/releases/custom-launch-v4/clean-room-release-coordinate.json",
    import.meta.url,
  ), "utf8"));
  assert.equal(validateCoordinateSchema(committed), true, JSON.stringify(validateCoordinateSchema.errors));
  if (committed.releaseReady) {
    const bindingBytes = readFileSync(path.join(repositoryRoot, bindingPath));
    validateReviewedReleaseCoordinate(committed, {
      releaseReady: JSON.parse(bindingBytes).releaseReady,
      bindingSha256: `sha256:${hexSha(bindingBytes)}`,
    });
  }
  const blocked = blockedCoordinateBaseline(committed);
  assert.equal(validateCoordinateSchema(blocked), true, JSON.stringify(validateCoordinateSchema.errors));
  assert.equal(validateReviewedReleaseCoordinate(blocked, {
    releaseReady: false,
    bindingSha256: `sha256:${"f".repeat(64)}`,
  }), blocked);
  assert.equal(blocked.releaseReady, false);
  assert.deepEqual(blocked.blockers, [
    "releaseBindingReady",
    "releaseSourceCoordinate",
    "releaseManifestDigest",
    "releaseAssetDigests",
    "machineContractBindingDigest",
  ]);

  const release = validateReleaseFiles(releaseFiles());
  const bindingSha256 = release.machineContractBinding.sha256;
  const coordinate = {
    $schema: "./clean-room-release-coordinate.schema.json",
    schemaVersion: "programmable.launch-v4-clean-room-release-coordinate.v1",
    releaseReady: true,
    repository: release.repository,
    tag: release.tag,
    version: release.version,
    source: structuredClone(release.source),
    releaseBinding: {
      path: release.machineContractBinding.path,
      sha256: bindingSha256,
    },
    machineContractBinding: structuredClone(release.machineContractBinding),
    manifestSha256: release.assets.find(({ name }) => name.endsWith(".release.json")).sha256,
    assets: release.assets.map(({ name, sha256 }) => ({ name, sha256 })),
    blockers: [],
  };
  validateReviewedReleaseCoordinate(coordinate, { releaseReady: true, bindingSha256 });
  assert.equal(assertReleaseMatchesReviewedCoordinate(release, coordinate), release);

  for (const mutate of [
    (value) => { value.source.commitSha = "9".repeat(40); },
    (value) => { value.source.treeSha = "8".repeat(40); },
    (value) => { value.manifestSha256 = `sha256:${"7".repeat(64)}`; },
    (value) => { value.assets[0].sha256 = `sha256:${"6".repeat(64)}`; },
    (value) => { value.machineContractBinding.sha256 = `sha256:${"5".repeat(64)}`; },
  ]) {
    const changed = structuredClone(coordinate);
    mutate(changed);
    assert.throws(
      () => assertReleaseMatchesReviewedCoordinate(release, changed),
      /RELEASE_REVIEWED_/u,
    );
  }
});

test("first-submit recovery is canonical, redacted, producer-bound, and tamper evident", () => {
  const input = validCleanRoomTranscript();
  const recovery = buildCleanRoomRecoveryReceipt(input);
  assert.equal(validateCleanRoomRecoveryReceipt(recovery), recovery);
  assert.equal(recovery.producer.sourceSha, input.producer.sourceSha);
  assert.equal(recovery.submission.launchId, input.firstSubmit.resource.launchId);
  const serialized = canonicalJsonBytes(recovery).toString("utf8");
  assert.equal(serialized.includes(input.apiKey), false);
  assert.equal(serialized.includes(input.firstSubmit.idempotencyKey), false);
  assert.equal(serialized.includes(input.status.resource.walletTransaction.calldata), false);
  for (const mutate of [
    (value) => { value.producer.sourceSha = "f".repeat(40); },
    (value) => { value.producer.runAttempt = "2"; },
    (value) => { value.safety.transactionCalldataRecorded = true; },
    (value) => { value.release.manifestSha256 = `sha256:${"0".repeat(64)}`; },
    (value) => { value.recoveryDigest = `sha256:${"0".repeat(64)}`; },
  ]) {
    const changed = structuredClone(recovery);
    mutate(changed);
    assert.throws(() => validateCleanRoomRecoveryReceipt(changed), /[A-Z][A-Z0-9_]+/u);
  }
});

test("recovery refuses any signed, submitted, failed, or onchain first-submit state", () => {
  const mutations = [
    (value) => { value.firstSubmit.resource.status = "submitted"; },
    (value) => { value.firstSubmit.resource.status = "sequencer_soft_confirmed"; },
    (value) => { value.firstSubmit.resource.status = "ethereum_posted"; },
    (value) => { value.firstSubmit.resource.status = "finalized"; },
    (value) => { value.firstSubmit.resource.status = "failed"; },
    (value) => { value.firstSubmit.resource.status = "authorized"; },
    (value) => { value.firstSubmit.resource.onchain = { transactionHash: `0x${"1".repeat(64)}` }; },
    (value) => { value.firstSubmit.resource.failure = { code: "BROADCAST_FAILED" }; },
    (value) => { value.firstSubmit.resource.walletSignature = "0x1234"; },
    (value) => { value.firstSubmit.resource.signedTransaction = "0x1234"; },
    (value) => { value.firstSubmit.resource.rawTransaction = "0x1234"; },
    (value) => { value.firstSubmit.resource.transactionHash = `0x${"2".repeat(64)}`; },
    (value) => { value.firstSubmit.resource.walletTransaction.walletSignature = "0x1234"; },
    (value) => { value.firstSubmit.resource.walletTransaction.signature = "0x1234"; },
    (value) => { value.firstSubmit.resource.walletTransaction.signedTransaction = "0x1234"; },
    (value) => { value.firstSubmit.resource.walletTransaction.rawTransaction = "0x1234"; },
    (value) => {
      value.firstSubmit.resource.walletTransaction.transactionHash = `0x${"3".repeat(64)}`;
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const input = validCleanRoomTranscript();
    mutate(input);
    assert.throws(
      () => buildCleanRoomRecoveryReceipt(input),
      /RECOVERY_RESOURCE_INVALID/u,
      `unsafe recovery mutation ${index} escaped`,
    );
  }
});

test("V4 clean-room image gate admits decoded PNG/single-frame GIF and rejects JPEG, WebP, animation", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const singleFrameGif = Buffer.from(
    "47494638396101000100800000000000ffffff2c00000000010001000002024401003b",
    "hex",
  );
  const secondGifFrame = Buffer.from("2c0000000001000100000202440100", "hex");
  const animatedGif = Buffer.concat([
    singleFrameGif.subarray(0, -1),
    secondGifFrame,
    Buffer.from([0x3b]),
  ]);
  const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
  const webp = Buffer.from("524946461600000057454250565038580a0000000000000000000000000000", "hex");

  assert.deepEqual(validateCleanRoomImage(png), {
    mediaType: "image/png", width: 1, height: 1, frameCount: 1,
  });
  assert.deepEqual(validateCleanRoomImage(singleFrameGif), {
    mediaType: "image/gif", width: 1, height: 1, frameCount: 1,
  });
  for (const bytes of [jpeg, webp, animatedGif]) {
    assert.throws(() => validateCleanRoomImage(bytes), /PROJECT_IMAGE_V4_DECODE_INVALID/u);
  }
});

test("prepare stage refuses to coexist with the production API credential", async () => {
  const previous = process.env.PROGRAMMABLE_API_KEY;
  process.env.PROGRAMMABLE_API_KEY = "TEST_CREDENTIAL_SENTINEL_NEVER_USE_DURING_PREPARE";
  try {
    await assert.rejects(
      prepareCleanRoom({}),
      /PREPARE_REFUSES_PROGRAMMABLE_API_KEY/u,
    );
  } finally {
    if (previous === undefined) delete process.env.PROGRAMMABLE_API_KEY;
    else process.env.PROGRAMMABLE_API_KEY = previous;
  }
});

test("reviewed release readiness distinguishes a blocked binding from an unpublished CLI", () => {
  const committedCoordinate = JSON.parse(readFileSync(new URL(
    "../../docs/operations/releases/custom-launch-v4/clean-room-release-coordinate.json",
    import.meta.url,
  ), "utf8"));
  const coordinate = blockedCoordinateBaseline(committedCoordinate);
  const bindingSha256 = `sha256:${"f".repeat(64)}`;
  const blockedBinding = { releaseReady: false, bindingSha256 };
  assert.equal(validateReviewedReleaseCoordinate(coordinate, blockedBinding), coordinate);
  assert.throws(
    () => requireReviewedReleaseCoordinateReady(coordinate, blockedBinding),
    (error) => {
      assert.equal(error?.code, "V4_RELEASE_BINDING_NOT_READY");
      assert.equal(error.cause, undefined);
      return true;
    },
  );

  const awaitingCliRelease = awaitingCliCoordinate(committedCoordinate, bindingSha256);
  const readyBinding = { releaseReady: true, bindingSha256 };
  assert.equal(
    validateReviewedReleaseCoordinate(awaitingCliRelease, readyBinding),
    awaitingCliRelease,
  );
  assert.throws(
    () => requireReviewedReleaseCoordinateReady(awaitingCliRelease, readyBinding),
    (error) => {
      assert.equal(error?.code, "REVIEWED_RELEASE_COORDINATE_BLOCKED");
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test("prepare stage enforces the real binding-to-coordinate readiness wiring", async () => {
  let expectedCode;
  await withIsolatedProtectedCheckout({
    repositoryRoot,
    materialize: async ({ isolatedRoot }) => {
      const bindingBytes = await readFile(path.join(isolatedRoot, bindingPath));
      const binding = JSON.parse(bindingBytes.toString("utf8"));
      const coordinate = JSON.parse(await readFile(
        path.join(isolatedRoot, coordinatePath),
        "utf8",
      ));
      const bindingSha256 = `sha256:${hexSha(bindingBytes)}`;
      const blockedCoordinate = binding.releaseReady
        ? awaitingCliCoordinate(coordinate, bindingSha256)
        : blockedCoordinateBaseline(coordinate);
      expectedCode = binding.releaseReady
        ? "REVIEWED_RELEASE_COORDINATE_BLOCKED"
        : "V4_RELEASE_BINDING_NOT_READY";
      await cp(path.join(repositoryRoot, runnerPath), path.join(isolatedRoot, runnerPath));
      await writeFile(path.join(isolatedRoot, coordinatePath), prettyCanonical(blockedCoordinate));
      return [runnerPath, coordinatePath];
    },
  }, async ({ isolatedRoot, revision }) => {
    const runner = await import(
      `${pathToFileURL(path.join(isolatedRoot, runnerPath)).href}?fixture=${revision}`
    );
    await assert.rejects(
      runner.prepareCleanRoom({}),
      (error) => {
        assert.equal(error?.code, expectedCode);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  });
});
