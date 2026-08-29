import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildCleanRoomEvidence,
  canonicalJsonBytes,
  prepareCleanRoom,
  validateCleanRoomEvidence,
  validateCleanRoomImage,
  validateReleaseFiles,
} from "../programmable-launch-v4-clean-room.mjs";
import {
  validCleanRoomTranscript,
} from "./fixtures/programmable-launch-v4-clean-room.mjs";

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

test("V4 clean-room evidence proves exact idempotent wallet handoff without sensitive bytes", () => {
  const input = validCleanRoomTranscript();
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
    mutate(input);
    assert.throws(() => buildCleanRoomEvidence(input), /[A-Z][A-Z0-9_]+/u,
      `mutation ${index} escaped`);
  }
});

test("canonical redacted evidence rejects extra fields, unsafe booleans, and digest drift", () => {
  const evidence = buildCleanRoomEvidence(validCleanRoomTranscript());
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
