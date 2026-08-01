import assert from "node:assert/strict";
import test from "node:test";

import {
  CANDIDATE_RUNTIME_ENDPOINT,
  candidateGenesisAnchorBlock,
  loadCandidateRuntimeIdentity,
  withCandidateRuntimeLease,
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

test("candidate genesis is the predecessor of the earliest reviewed source", () => {
  assert.equal(candidateGenesisAnchorBlock({
    releases: [
      { sourceBindings: [{ inclusiveStartBlock: "25639538" }] },
      {
        sourceBindings: [
          { inclusiveStartBlock: "25624131" },
          { inclusiveStartBlock: "25624130" },
        ],
      },
    ],
  }), "25624129");
  assert.throws(
    () => candidateGenesisAnchorBlock({ releases: [] }),
    /start blocks are unavailable/u,
  );
});

test("raw backfill leases one bounded projector cycle at a time", async () => {
  let generation = 0;
  const operations = [];
  const releases = [];
  const lease = {
    async tryAcquire() {
      generation += 1;
      return {
        status: "acquired",
        fence: {
          holderId: `projector-runtime-00000000-0000-4000-8000-${String(generation).padStart(12, "0")}`,
          generation: String(generation),
          tokenHash: `0x${String(generation).padStart(64, "0")}`,
        },
      };
    },
    async release(fence) {
      releases.push(fence.generation);
      return true;
    },
  };

  for (let index = 0; index < 3; index += 1) {
    await withCandidateRuntimeLease({
      lease,
      operation: async (fence) => {
        operations.push(fence.generation);
      },
    });
  }

  assert.deepEqual(operations, ["1", "2", "3"]);
  assert.deepEqual(releases, ["1", "2", "3"]);
});

test("raw backfill releases a lease when a cycle fails", async () => {
  let released = false;
  const lease = {
    async tryAcquire() {
      return {
        status: "acquired",
        fence: {
          holderId: "projector-runtime-00000000-0000-4000-8000-000000000001",
          generation: "1",
          tokenHash: `0x${"11".repeat(32)}`,
        },
      };
    },
    async release() {
      released = true;
      return true;
    },
  };

  await assert.rejects(
    withCandidateRuntimeLease({
      lease,
      operation: async () => {
        throw new Error("cycle failed");
      },
    }),
    /cycle failed/u,
  );
  assert.equal(released, true);
});
