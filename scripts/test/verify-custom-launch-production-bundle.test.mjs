import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyCustomLaunchProductionBundle } from "../verify-custom-launch-production-bundle.mjs";

function bundleFixture() {
  const root = mkdtempSync(join(tmpdir(), "programmable-custom-launch-bundle-"));
  mkdirSync(join(root, ".next/static/chunks"), { recursive: true });
  mkdirSync(join(root, ".next/server/app"), { recursive: true });
  writeFileSync(join(root, ".next/static/chunks/runtime.js"), "production runtime", "utf8");
  writeFileSync(join(root, ".next/server/app/launch.js"), "production launch", "utf8");
  return root;
}

test("accepts a production bundle without development-only launch seeds", () => {
  const root = bundleFixture();
  try {
    assert.equal(
      verifyCustomLaunchProductionBundle(root).schemaVersion,
      "programmable.custom-launch-production-bundle-scan.v1",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects any production client or server artifact containing a local seed", () => {
  for (const [path, marker] of [
    [".next/static/chunks/leak.js", "programmable-custom-launch-local-preview-v1"],
    [".next/server/app/leak.js", "Local seed"],
  ]) {
    const root = bundleFixture();
    try {
      writeFileSync(join(root, path), marker, "utf8");
      assert.throws(
        () => verifyCustomLaunchProductionBundle(root),
        /Development-only Custom Launch preview leaked into production/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
