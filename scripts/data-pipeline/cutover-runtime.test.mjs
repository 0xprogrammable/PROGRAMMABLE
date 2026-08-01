import assert from "node:assert/strict";
import test from "node:test";

import {
  CANDIDATE_RUNTIME_ENDPOINT,
  loadCandidateRuntimeIdentity,
} from "./cutover-runtime.mjs";

test("raw runtime is pinned to the reviewed candidate evidence", async () => {
  const identity = await loadCandidateRuntimeIdentity();
  assert.deepEqual(identity, {
    endpoint: "https://indexer.hyperindex.xyz/d7a39a2/v1/graphql",
    endpointId: "d7a39a2",
    mirrorCommit: "7ffd15c2a28c481a2d3632e30b315262c2471b2e",
    redactedIdentity: "envio:production-7f24e63",
  });
  assert.equal(CANDIDATE_RUNTIME_ENDPOINT, identity.endpoint);
  assert.equal(Object.isFrozen(identity), true);
});
