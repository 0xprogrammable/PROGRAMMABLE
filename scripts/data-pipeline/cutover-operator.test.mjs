import assert from "node:assert/strict";
import test from "node:test";

import { HELP, main, parseArguments } from "./cutover-operator.mjs";

const RETIRED_COMMANDS = Object.freeze([
  "roles-provision",
  "roles-verify",
  "backup-restore",
  "candidate-safety-backup",
  "candidate-restore-plan",
  "candidate-restore-apply",
  "candidate-recovery-plan",
  "candidate-recovery-apply",
  "candidate-runtime-enable-plan",
  "candidate-runtime-enable-apply",
  "raw-backfill",
  "projector-drain",
  "envio-attest",
  "database-plan",
  "database-apply",
  "staged-gates",
  "rollback-plan",
  "rollback-verify",
]);

test("retired operator help exposes no mutation command", () => {
  assert.match(HELP, /Historical candidate cutover retired/u);
  assert.match(HELP, /No mutation command is available/u);
  assert.match(HELP, /read-model-scheduler-cutover\.md/u);
  for (const command of RETIRED_COMMANDS) {
    assert.equal(HELP.includes(`cutover-operator.mjs ${command}`), false);
  }
});

test("every historical cutover command fails before environment access", async () => {
  const environment = new Proxy({}, {
    get() {
      throw new Error("retired cutover read environment");
    },
  });
  for (const command of RETIRED_COMMANDS) {
    await assert.rejects(main([command], environment), /cutover is retired/u);
  }
});

test("operator parser remains strict for malformed arguments", () => {
  assert.deepEqual(parseArguments(["raw-backfill"]), {
    command: "raw-backfill",
    flags: new Map(),
  });
  assert.throws(
    () => parseArguments(["raw-backfill", "--output"]),
    /arguments are invalid/u,
  );
  assert.throws(
    () => parseArguments(["raw-backfill", "--output", "a", "--output", "b"]),
    /arguments are invalid/u,
  );
});
