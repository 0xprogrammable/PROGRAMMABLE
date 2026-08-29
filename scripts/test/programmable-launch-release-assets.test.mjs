import assert from "node:assert/strict";
import test from "node:test";

import {
  RELEASE_ASSET_SCHEMA,
  RELEASE_REPOSITORY,
  buildReleaseManifest,
  canonicalJson,
  normalizeCycloneDx,
  releaseNames,
} from "../programmable-launch-release-assets.mjs";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const DIGESTS = ["a", "b", "c"].map((value) => value.repeat(64));

test("release names derive only from an exact semantic version", () => {
  assert.deepEqual(releaseNames("3.4.0"), {
    tag: "programmable-launch-v3.4.0",
    tarball: "programmable-launch-3.4.0.tgz",
    checksum: "programmable-launch-3.4.0.tgz.sha256",
    sbom: "programmable-launch-3.4.0.cdx.json",
    manifest: "programmable-launch-3.4.0.release.json",
  });
  assert.throws(() => releaseNames("latest"), /package version is invalid/u);
});

test("CycloneDX normalization removes only nondeterministic identity", () => {
  const input = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: "urn:uuid:random",
    metadata: {
      timestamp: "2026-08-27T00:00:00.000Z",
      tools: [{ name: "cli", vendor: "npm", version: "11.16.0" }],
    },
    components: [{ name: "dependency" }],
  };
  const normalized = normalizeCycloneDx(input);
  assert.equal(Object.hasOwn(normalized, "serialNumber"), false);
  assert.equal(Object.hasOwn(normalized.metadata, "timestamp"), false);
  assert.deepEqual(normalized.metadata.tools, input.metadata.tools);
  assert.equal(input.serialNumber, "urn:uuid:random");
});

test("release manifest binds source, exact toolchain, and all payload bytes", () => {
  const names = releaseNames("3.4.0");
  const manifest = buildReleaseManifest({
    version: "3.4.0",
    ref: "refs/heads/production",
    commitSha: COMMIT,
    treeSha: TREE,
    assets: [
      { name: names.sbom, mediaType: "application/vnd.cyclonedx+json", bytes: 30, sha256: DIGESTS[2] },
      { name: names.tarball, mediaType: "application/gzip", bytes: 10, sha256: DIGESTS[0] },
      { name: names.checksum, mediaType: "text/plain", bytes: 20, sha256: DIGESTS[1] },
    ],
  });
  assert.equal(manifest.schemaVersion, RELEASE_ASSET_SCHEMA);
  assert.equal(manifest.repository, RELEASE_REPOSITORY);
  assert.equal(manifest.repository, "programmablehq/programmable");
  assert.equal(manifest.source.commitSha, COMMIT);
  assert.equal(manifest.source.treeSha, TREE);
  assert.equal(manifest.toolchain.node, "24.14.0");
  assert.equal(manifest.toolchain.npm, "11.16.0");
  assert.deepEqual(manifest.assets.map(({ name }) => name), [
    names.sbom,
    names.tarball,
    names.checksum,
  ].sort());
});

test("canonical JSON is independent of object insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, nested: { b: 2, a: 1 } }),
    canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }),
  );
});

test("manifest rejects omissions, substitutions, and duplicate payload names", () => {
  const names = releaseNames("3.4.0");
  const base = {
    version: "3.4.0",
    ref: "refs/heads/production",
    commitSha: COMMIT,
    treeSha: TREE,
  };
  assert.throws(
    () => buildReleaseManifest({ ...base, assets: [] }),
    /exactly three/u,
  );
  assert.throws(
    () => buildReleaseManifest({
      ...base,
      assets: [
        { name: names.tarball, mediaType: "application/gzip", bytes: 1, sha256: DIGESTS[0] },
        { name: names.tarball, mediaType: "application/gzip", bytes: 1, sha256: DIGESTS[1] },
        { name: names.sbom, mediaType: "application/json", bytes: 1, sha256: DIGESTS[2] },
      ],
    }),
    /asset names are not exact/u,
  );
});
