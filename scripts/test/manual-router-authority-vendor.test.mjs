import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { verifyManualRouterAuthorityVendorV1 } from
  "../verify-manual-router-authority-vendor.mjs";

const FIXTURE_MANIFEST = {
  schemaVersion: "programmable.website-manual-router-vendor.v1",
  adapter: {
    publicExport: "./manual-router",
    commit: "11".repeat(20),
    tree: "22".repeat(20),
  },
  exports: ["verify"],
  closure: [{ path: "src/portable.ts", bytes: 1, sha256: "33".repeat(32) }],
  artifacts: [],
};

describe("manual Router vendored authority integrity", () => {
  it("accepts byte-bound readable source-map artifacts", async () => {
    const fixture = await createFixture();
    await assert.doesNotReject(() => verifyManualRouterAuthorityVendorV1({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
    }));
  });

  it("rejects one-byte bundle, source-map, and artifact mutations", async () => {
    for (const target of [
      "runtime.mjs",
      "runtime.mjs.map",
      "artifacts/schema.json",
    ]) {
      const fixture = await createFixture();
      const path = join(fixture.root, "vendor", target);
      await writeFile(path, `${await readFile(path, "utf8")} `, "utf8");
      await assert.rejects(() => verifyManualRouterAuthorityVendorV1({
        root: fixture.root,
        manifestPath: fixture.manifestPath,
      }), /drifted/u);
    }
  });

  it("rejects eval and dynamic import even when rebound to new bytes", async () => {
    for (const injected of ["eval('x')", "import('./x.mjs')", "new Function('x')"]) {
      const fixture = await createFixture({ bundle: injected });
      await assert.rejects(() => verifyManualRouterAuthorityVendorV1({
        root: fixture.root,
        manifestPath: fixture.manifestPath,
      }), /violates/u);
    }
  });

  it("rejects an unbound stale schema or Golden beside the exact inventory", async () => {
    const fixture = await createFixture();
    await writeFile(
      join(fixture.root, "vendor", "artifacts", "manual-router-authority-golden.v5.json"),
      "{}\n",
      "utf8",
    );
    await assert.rejects(() => verifyManualRouterAuthorityVendorV1({
      root: fixture.root,
      manifestPath: fixture.manifestPath,
    }), /artifact inventory drifted/u);
  });
});

async function createFixture(input = {}) {
  const root = await mkdtemp(join(tmpdir(), "manual-router-vendor-"));
  const manifestPath = "vendor/manifest.json";
  const bundle = input.bundle ?? "export const verify = true;\n";
  const sourceMap = JSON.stringify({
    version: 3,
    sources: ["portable.ts"],
    sourcesContent: ["export const verify = true;"],
    names: [],
    mappings: "",
  });
  const schema = JSON.stringify({ type: "object" });
  const metafile = JSON.stringify({ inputs: {}, outputs: {} });
  const closure = JSON.stringify({
    schemaVersion: "programmable.manual-router-portable-closure.v1",
  });
  const manifest = structuredClone(FIXTURE_MANIFEST);
  manifest.bundle = {
    path: "vendor/runtime.mjs",
    bytes: Buffer.byteLength(bundle),
    sha256: sha256(bundle),
    sourceMapPath: "vendor/runtime.mjs.map",
    sourceMapSha256: sha256(sourceMap),
    metafilePath: "vendor/runtime.metafile.json",
    metafileSha256: sha256(metafile),
    closurePath: "vendor/runtime.closure.json",
    closureSha256: sha256(closure),
  };
  manifest.artifacts = [{
    sourcePath: "schemas/schema.json",
    vendoredPath: "vendor/artifacts/schema.json",
    bytes: Buffer.byteLength(schema),
    sha256: sha256(schema),
  }];
  for (const [path, value] of [
    [manifestPath, `${JSON.stringify(manifest)}\n`],
    [manifest.bundle.path, bundle],
    [manifest.bundle.sourceMapPath, sourceMap],
    [manifest.bundle.metafilePath, metafile],
    [manifest.bundle.closurePath, closure],
    [manifest.artifacts[0].vendoredPath, schema],
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), value, "utf8");
  }
  return { root, manifestPath };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
