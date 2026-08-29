import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { BINDING_VECTORS, PROTOCOL_SNAPSHOT, readJson, sha256File } from "./helpers.js";

interface SnapshotLock {
  readonly classification: string;
  readonly protocol_commit: string;
  readonly protocol_spec_id: string;
  readonly complete_portable_vector_set: boolean;
  readonly portable_conformance_claim: boolean;
  readonly files: Readonly<Record<string, string>>;
}

const EXPECTED_PROTOCOL_COMMIT = "334bb26703a4dab18ce0fca8485c6275a879933a";
const EXPECTED_PROTOCOL_SPEC_ID = "programmable-protocol/0.1.0-draft.1";
const EXPECTED_LOCK_DIGEST = "sha256:d0b3a1dace260a56d37d44b7c2fe03758e7ecdcf6072d2e24c3cb8f9f211b1bf";
const EXPECTED_FILES: Readonly<Record<string, string>> = Object.freeze({
  "examples/batch-auction.json": "sha256:2b1e40437b31274ac7da592a136da6a82cdd9882ef7f15563414378f260821e2",
  "examples/bonding-curve-lifecycle.json": "sha256:820cdb4647798cf0d412d3c8cd426ad1eed6a1524743fb7161e2a463643cf116",
  "examples/conditional-outcome-market.json": "sha256:2b4d6f61409720e41b3502ccafcf392d97176c84e3b3da12756ee643745a2fa6",
  "examples/constant-product-market.json": "sha256:954e3245aebf9e337f5a88fd1f3c811d4f65d75e32c8b8dd1b1ed8b91bcfc8d9",
  "examples/multi-asset-basket.json": "sha256:59a990ddb4bd0c2f4c19feb2b4829ae3ba2ff198dd8d54125443de950b2671ad",
  "examples/nft-bid-pool.json": "sha256:c6aab5576e382815583cae0f1e0b5b358af815012b2099e78ff4388353187f5e",
  "examples/shared-domain-composition.json": "sha256:720edcb90c81ffec78e53d4f18175ef33e85e891f068685a179a34265fb6726c",
  "examples/signed-rfq-jit.json": "sha256:6e2c8c84ca86243202430aa5dc2e07393e1e4adf115c124ba62f2c1efede8ee1",
  "vectors/canonical-identifiers-v1.json": "sha256:650d3bfaa2935328a959b8a6ff620708d7297cf8813d0cc665e47fe342e8aa89",
  "vectors/identifiers-v1.json": "sha256:e2193dbb48d44e8e8de54eadf5e49b80595db595ef1272d7930842b753573044",
  "vectors/protocol-assessment-v1.json": "sha256:3a9e28ed4fdf859406a009b0e5d1f2eb88d44103001015b7ec7c4161561c2d1e",
});

test("portable evaluator input subset is byte locked without a conformance claim", () => {
  const lockPath = resolve(BINDING_VECTORS, "portable-snapshot-lock.json");
  const lock = readJson(lockPath) as SnapshotLock;
  assert.equal(sha256File(lockPath), EXPECTED_LOCK_DIGEST);
  assert.equal(lock.classification, "portable-evaluator-input-subset");
  assert.equal(lock.protocol_commit, EXPECTED_PROTOCOL_COMMIT);
  assert.equal(lock.protocol_spec_id, EXPECTED_PROTOCOL_SPEC_ID);
  assert.equal(lock.complete_portable_vector_set, false);
  assert.equal(lock.portable_conformance_claim, false);
  assert.deepEqual(lock.files, EXPECTED_FILES);
  for (const [relativePath, expectedDigest] of Object.entries(EXPECTED_FILES)) {
    assert.equal(sha256File(resolve(PROTOCOL_SNAPSHOT, relativePath)), expectedDigest, relativePath);
  }
});
