import assert from "node:assert/strict";
import test from "node:test";

import { runConfiguredCandidateRawBackfill } from "./cutover-runtime.mjs";

test("historical candidate raw backfill is retired before environment access", async () => {
  const environment = new Proxy({}, {
    get() {
      throw new Error("retired cutover read environment");
    },
  });

  await assert.rejects(
    runConfiguredCandidateRawBackfill({ environment }),
    /historical candidate cutover is retired/u,
  );
});
