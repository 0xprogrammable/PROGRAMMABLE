import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { verifyRouterV2SharedLifecycleV3Vendor } from
  "../verify-router-v2-shared-lifecycle-v3-vendor.mjs";

const VENDOR_ROOT = "lib/vendor/router-v2-shared-lifecycle-v3";

describe("Router V2 shared lifecycle V3 vendored Authority integrity", () => {
  it("accepts the exact source-only DENY release", async () => {
    const result = await verifyRouterV2SharedLifecycleV3Vendor();
    assert.deepEqual(result, {
      authorityCommit: "a017d750fc3ad0805614487a7387c7e195b65bd0",
      authorityTree: "e54f9835068973befd79203aad98aee82552996c",
      contractCommit: "ea0e4424b886a0c1ae928fc73d62bd8e907b44cd",
      contractTree: "8c5e0822d7ff256cad3d9e0350c980473d36aecc",
      sourceManifestSha256:
        "fc5744aafd501601d828f026f46a05c00f310ef367f7fad547c05ad64710aa13",
      bundleSha256:
        "7ccb8b73a2c35a803b31c8c4cca25e84b4c138ee5f61510eb182064a041a1886",
      files: 33,
      admittedSchemas: 6,
      hardDenySchemas: 17,
      activationState: "DENY",
    });
  });

  it("rejects one-byte bundle, schema, and source-manifest drift", async () => {
    for (const target of [
      "artifacts/router-v2-shared-lifecycle-v3/"
        + "router-v2-shared-lifecycle-portable.v3.mjs",
      "schemas/router-v2-launch-grant.v3.schema.json",
      "artifact-manifest.v3.json",
    ]) {
      const root = await copyVendor();
      const path = join(root, VENDOR_ROOT, target);
      await writeFile(path, "{}\n", "utf8");
      await assert.rejects(
        () => verifyRouterV2SharedLifecycleV3Vendor({ root }),
        /drifted/u,
      );
    }
  });

  it("rejects an unbound artifact beside the exact inventory", async () => {
    const root = await copyVendor();
    const extra = join(root, VENDOR_ROOT, "artifacts", "stale.json");
    await writeFile(extra, "{}\n", "utf8");
    await assert.rejects(
      () => verifyRouterV2SharedLifecycleV3Vendor({ root }),
      /inventory drifted/u,
    );
  });

  it("rejects a locally rebound admitted artifact", async () => {
    const root = await copyVendor();
    const sourcePath =
      "artifacts/router-v2-shared-lifecycle-v3/shared-lifecycle-abi.v3.json";
    const artifactPath = join(root, VENDOR_ROOT, sourcePath);
    const replacement = "{}\n";
    await writeFile(artifactPath, replacement, "utf8");
    const manifestPath = join(root, VENDOR_ROOT, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const binding = manifest.files.find((file) => file.sourcePath === sourcePath);
    binding.bytes = Buffer.byteLength(replacement);
    binding.sha256 = createHash("sha256").update(replacement).digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => verifyRouterV2SharedLifecycleV3Vendor({ root }),
      /does not match source manifest/u,
    );
  });
});

async function copyVendor() {
  const root = await mkdtemp(join(tmpdir(), "router-v3-vendor-"));
  await cp(VENDOR_ROOT, join(root, VENDOR_ROOT), { recursive: true });
  return root;
}
