import assert from "node:assert/strict";
import test from "node:test";

import * as facade from "../open-world-v2-core.mjs";
import { isRepositorySchemaBinding } from "../open-world-v2-package-io.mjs";
import {
  OpenWorldV2Error,
  canonicalJson,
  sha256Bytes,
  sha256Utf8,
  utf8ByteLength
} from "../open-world-v2-primitives.mjs";

const publicApi = Object.freeze([
  "OPEN_WORLD_V2_ARTIFACTS",
  "OPEN_WORLD_V2_FEE_CONFORMANCE_ARTIFACTS",
  "OPEN_WORLD_V2_FEE_NOT_APPLICABLE",
  "OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS",
  "OPEN_WORLD_V2_REPORT_VERSION",
  "OPEN_WORLD_V2_REVIEW_PACKAGE_IO_LIMITS",
  "OPEN_WORLD_V2_STANDARD_VERSION",
  "OPEN_WORLD_V2_SUBMISSION_FILE",
  "OPEN_WORLD_V2_SUPPORTING_ARTIFACTS",
  "OpenWorldV2Error",
  "PROGRAMMABLE_FEE_V2",
  "architectureSnapshot",
  "architectureSnapshotSha256",
  "bundledSupportingArtifactDocument",
  "canonicalJson",
  "contentAddressedBinding",
  "createOpenWorldDraftPackage",
  "deriveOpenWorldV2FeeApplicability",
  "isRepositorySchemaBinding",
  "sha256Bytes",
  "sha256Utf8",
  "utf8ByteLength",
  "validateOpenWorldPackage",
  "validateOpenWorldV2Package"
]);

test("the decomposed V2 facade preserves its exact public API", () => {
  assert.deepEqual(Object.keys(facade).sort(), [...publicApi].sort());
});

test("facade utility exports retain identity across responsibility modules", () => {
  assert.equal(facade.OpenWorldV2Error, OpenWorldV2Error);
  assert.equal(facade.canonicalJson, canonicalJson);
  assert.equal(facade.sha256Bytes, sha256Bytes);
  assert.equal(facade.sha256Utf8, sha256Utf8);
  assert.equal(facade.utf8ByteLength, utf8ByteLength);
  assert.equal(facade.isRepositorySchemaBinding, isRepositorySchemaBinding);
});
