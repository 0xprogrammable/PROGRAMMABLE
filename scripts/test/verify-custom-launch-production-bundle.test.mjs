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

test("accepts a production bundle without retired UI or development-only launch seeds", () => {
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

test("rejects retired UI and local seeds in every production artifact", () => {
  for (const [path, marker] of [
    [".next/static/chunks/retired-custom.js", "programmable.custom-launch-session.v3:"],
    [
      ".next/server/app/retired-custom.rsc",
      "Open a GitHub application, then return when an exact revision has been approved.",
    ],
    [".next/static/chunks/leak.js.map", "programmable-custom-launch-local-preview-v1"],
    [".next/static/chunks/prediction-leak.js.map", "programmable-prediction-v2-local-preview-v1"],
    [".next/server/app/leak.rsc", "Local seed"],
  ]) {
    const root = bundleFixture();
    try {
      writeFileSync(join(root, path), marker, "utf8");
      assert.throws(
        () => verifyCustomLaunchProductionBundle(root),
        /Retired launch UI or development preview leaked into production/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
