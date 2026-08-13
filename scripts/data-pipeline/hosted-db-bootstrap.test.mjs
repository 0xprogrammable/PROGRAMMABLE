import assert from "node:assert/strict";
import test from "node:test";

import { createBootstrapPlan } from "./hosted-db-bootstrap-runtime.mjs";

test("historical candidate bootstrap is retired before environment access", async () => {
  const environment = new Proxy({}, {
    get() {
      throw new Error("retired bootstrap read environment");
    },
  });

  await assert.rejects(
    createBootstrapPlan({
      repositoryCommit: "a".repeat(40),
      environment,
      createdAt: "2026-08-13T00:00:00.000Z",
    }),
    /historical candidate bootstrap is retired/u,
  );
});

test("historical candidate bootstrap never accepts the current production release", async () => {
  await assert.rejects(
    createBootstrapPlan({
      repositoryCommit: "b".repeat(40),
      environment: {},
    }),
    /canonical read-model release procedure/u,
  );
});
