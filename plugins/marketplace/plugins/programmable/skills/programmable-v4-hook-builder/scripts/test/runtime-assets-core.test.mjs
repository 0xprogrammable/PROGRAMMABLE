import assert from "node:assert/strict";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyRepositoryClosureToReport } from "../closure-report-core.mjs";
import { analyzeRepositoryReview, buildReviewTarget } from "../review-target-core.mjs";
import { isClosedRuntimeAssetReview } from "../runtime-assets-core.mjs";

test("large Three.js runtime assets stay outside strict code closure while exact Git blobs are bound", () => {
  const fixture = createRuntimeAssetFixture();
  try {
    const target = buildReviewTarget(fixture);
    assert.equal(target.closure.status, "complete");
    assert.equal(target.files.some(({ path: filePath }) => filePath === fixture.assetPath), false);
    assert.equal(target.files.some(({ path: filePath }) => filePath === fixture.manifestPath), true);
    assert.equal(target.runtimeAssets.status, "verified");
    assert.equal(target.runtimeAssets.assets[0].bytes, fixture.assetBytes);
    assert.equal(target.runtimeAssets.assets[0].verification, "content-hash-verified");
    assert.equal(isClosedRuntimeAssetReview(target.runtimeAssets), true);
    assert.ok(target.javascriptImportResolutions.some(({ kind, resolvedPath }) => (
      kind === "javascript-import-runtime-asset-reference" && resolvedPath === fixture.assetPath
    )));
  } finally {
    fixture.cleanup();
  }
});

test("a false runtime asset Git blob or clean-content SHA-256 fails closed", async (t) => {
  await t.test("Git blob mismatch", () => {
    const fixture = createRuntimeAssetFixture();
    try {
      updateManifest(fixture, (manifest) => {
        manifest.assets[0].gitBlob = "f".repeat(40);
      });
      assert.throws(() => buildReviewTarget(fixture), /Git blob does not match HEAD/u);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("SHA-256 mismatch", () => {
    const fixture = createRuntimeAssetFixture();
    try {
      updateManifest(fixture, (manifest) => {
        manifest.assets[0].sha256 = `sha256:${"f".repeat(64)}`;
      });
      commitAll(fixture.repositoryRoot, "wrong digest declaration");
      assert.throws(() => buildReviewTarget(fixture), /SHA-256 does not match the exact Git blob bytes/u);
    } finally {
      fixture.cleanup();
    }
  });
});

test("unmaterialized Git LFS and external resources enter review without blocking prototype readiness", () => {
  const fixture = createRuntimeAssetFixture({ lfsPointer: true, external: true });
  try {
    const repositoryReview = analyzeRepositoryReview(fixture);
    assert.equal(repositoryReview.closure.status, "complete");
    assert.equal(repositoryReview.runtimeAssets.status, "review-required");
    assert.deepEqual(
      repositoryReview.runtimeAssets.assets.map(({ verification }) => verification),
      ["git-lfs-pointer-bound", "external-declared"]
    );
    const report = applyRepositoryClosureToReport({
      decision: "PROTOTYPE_READY",
      findings: [],
      requiredGates: []
    }, repositoryReview.closure, {
      stage: "prototype",
      runtimeAssets: repositoryReview.runtimeAssets
    });
    assert.equal(report.decision, "PROTOTYPE_READY");
    assert.ok(report.findings.every(({ severity }) => severity === "warning"));
    assert.ok(report.requiredGates.some(({ id }) => id === "runtime-assets-attributable-review"));
  } finally {
    fixture.cleanup();
  }
});

test("runtime asset traversal, executable blobs and undeclared ?url imports fail closed", async (t) => {
  await t.test("path traversal", () => {
    const fixture = createRuntimeAssetFixture();
    try {
      updateManifest(fixture, (manifest) => {
        manifest.assets[0].repositoryPath = "../world.glb";
      });
      assert.throws(() => buildReviewTarget(fixture), /repository runtime asset binding is incomplete/u);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("executable asset", () => {
    const fixture = createRuntimeAssetFixture();
    try {
      fs.chmodSync(path.join(fixture.repositoryRoot, fixture.assetPath), 0o755);
      commitAll(fixture.repositoryRoot, "mark runtime asset executable");
      const blob = git(fixture.repositoryRoot, ["rev-parse", `HEAD:${fixture.assetPath}`]);
      updateManifest(fixture, (manifest) => {
        manifest.assets[0].gitBlob = blob;
      });
      assert.throws(() => buildReviewTarget(fixture), /non-executable regular blob/u);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("undeclared query import", () => {
    const fixture = createRuntimeAssetFixture();
    try {
      updateManifest(fixture, (manifest) => {
        manifest.assets = [];
      });
      assert.throws(() => buildReviewTarget(fixture), /\?url import is not declared/u);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("missing or moved repository asset", () => {
    const fixture = createRuntimeAssetFixture();
    try {
      updateManifest(fixture, (manifest) => {
        manifest.assets[0].repositoryPath = "submissions/fixture/public/assets/moved.glb";
      });
      assert.throws(() => buildReviewTarget(fixture), /non-executable regular blob in HEAD/u);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("malformed ambiguous LFS pointer", () => {
    const fixture = createRuntimeAssetFixture({ lfsPointer: true });
    try {
      fs.appendFileSync(
        path.join(fixture.repositoryRoot, fixture.assetPath),
        `oid sha256:${"f".repeat(64)}\n`
      );
      commitAll(fixture.repositoryRoot, "malformed ambiguous LFS pointer");
      const blob = git(fixture.repositoryRoot, ["rev-parse", `HEAD:${fixture.assetPath}`]);
      updateManifest(fixture, (manifest) => {
        manifest.assets[0].gitBlob = blob;
      });
      assert.throws(() => buildReviewTarget(fixture), /size does not match its Git blob/u);
    } finally {
      fixture.cleanup();
    }
  });
});

test("renamed executable content cannot bypass source closure through a media declaration", async (t) => {
  const cases = [
    ["WebAssembly", Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])],
    ["JavaScript", Buffer.from("// generated bundle\nexport default function steal() { return window.ethereum; }\n", "utf8")],
    ["JavaScript console", Buffer.from("/* bundle */\nconsole.log(window.ethereum);\n", "utf8")],
    ["HTML", Buffer.from("\uFEFF  <!-- generated --><!doctype html><script>window.location='https://example.invalid'</script>", "utf8")],
    ["shader", Buffer.from("/* generated */\n#version 300 es\nvoid main() {}\n", "utf8")],
    ["native build", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])]
  ];
  for (const [name, assetContent] of cases) {
    await t.test(name, () => {
      const fixture = createRuntimeAssetFixture({
        assetContent,
        assetFileName: `${name.toLowerCase().replaceAll(" ", "-")}.png`,
        assetMime: "image/png"
      });
      try {
        assert.throws(
          () => buildReviewTarget(fixture),
          /executable .* content cannot use the runtime asset channel|executable script, markup or shader content cannot use the runtime asset channel/u
        );
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test("executable suffix polyglots are rejected while benign ambiguity is routed to review", async (t) => {
  await t.test("PNG followed by HTML", () => {
    const fixture = createRuntimeAssetFixture({
      assetContent: Buffer.concat([makePng(), Buffer.from("\n<script>alert(1)</script>\n", "utf8")]),
      assetFileName: "texture.png",
      assetMime: "image/png"
    });
    try {
      assert.throws(() => buildReviewTarget(fixture), /executable script, markup or shader content/u);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("GLB followed by WebAssembly", () => {
    const glb = makeGlb(256);
    const fixture = createRuntimeAssetFixture({
      assetContent: Buffer.concat([glb, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])]),
      assetFileName: "world.glb",
      assetMime: "model/gltf-binary"
    });
    try {
      assert.throws(() => buildReviewTarget(fixture), /executable WebAssembly content/u);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("unsupported but plausible audio stays reviewable", () => {
    const fixture = createRuntimeAssetFixture({
      assetContent: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      assetFileName: "theme.mp3",
      assetMime: "audio/mpeg"
    });
    try {
      const target = buildReviewTarget(fixture);
      assert.equal(target.runtimeAssets.status, "review-required");
      assert.equal(target.runtimeAssets.assets[0].verification, "content-classification-review-required");
      assert.equal(isClosedRuntimeAssetReview(target.runtimeAssets), true);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("XML map data stays reviewable instead of being mislabeled executable", () => {
    const fixture = createRuntimeAssetFixture({
      assetContent: Buffer.from('<?xml version="1.0"?><kml><Placemark /></kml>\n', "utf8"),
      assetFileName: "world.kml",
      assetMime: "application/vnd.google-earth.kml+xml"
    });
    try {
      const target = buildReviewTarget(fixture);
      assert.equal(target.runtimeAssets.status, "review-required");
      assert.equal(target.runtimeAssets.assets[0].verification, "content-classification-review-required");
    } finally {
      fixture.cleanup();
    }
  });
});

test("closed GLB, image, audio and map data formats remain verified runtime assets", async (t) => {
  const cases = [
    ["GLB", "world.glb", "model/gltf-binary", makeGlb(512)],
    ["PNG", "texture.png", "image/png", makePng()],
    ["WAV", "theme.wav", "audio/wav", makeWav()],
    ["JSON map", "level.json", "application/json", Buffer.from('{"features":[],"type":"FeatureCollection"}\n', "utf8")]
  ];
  for (const [name, assetFileName, assetMime, assetContent] of cases) {
    await t.test(name, () => {
      const fixture = createRuntimeAssetFixture({ assetContent, assetFileName, assetMime });
      try {
        const target = buildReviewTarget(fixture);
        assert.equal(target.runtimeAssets.status, "verified");
        assert.equal(target.runtimeAssets.assets[0].verification, "content-hash-verified");
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test("mutable external URLs remain review-required even when a digest is declared", () => {
  const fixture = createRuntimeAssetFixture({ external: true });
  try {
    updateManifest(fixture, (manifest) => {
      manifest.assets[1].externalUri = "https://example.com/releases/latest/map-style.json";
      manifest.assets[1].sha256 = `sha256:${"a".repeat(64)}`;
    });
    const target = buildReviewTarget(fixture);
    const external = target.runtimeAssets.assets.find(({ id }) => id === "map-style");
    assert.equal(external.verification, "external-declared");
    assert.equal(target.runtimeAssets.status, "review-required");
    assert.ok(target.runtimeAssets.diagnostics.some(({ code, assetId }) => (
      code === "RUNTIME_ASSET_EXTERNAL_REVIEW_REQUIRED" && assetId === "map-style"
    )));
  } finally {
    fixture.cleanup();
  }
});

function createRuntimeAssetFixture({
  lfsPointer = false,
  external = false,
  assetContent = makeGlb(2_000_000),
  assetFileName = "world.glb",
  assetMime = "model/gltf-binary"
} = {}) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-runtime-assets-"));
  const packageRoot = path.join(repositoryRoot, "submissions", "fixture");
  const prefix = "submissions/fixture";
  const sourcePath = `${prefix}/app/scene.ts`;
  const assetPath = `${prefix}/public/assets/${assetFileName}`;
  const manifestPath = `${prefix}/runtime-assets.json`;
  fs.mkdirSync(path.join(packageRoot, "app"), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, "public", "assets"), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, "docs", "assets"), { recursive: true });
  fs.writeFileSync(path.join(repositoryRoot, sourcePath), `import worldUrl from "../public/assets/${assetFileName}?url";\nexport { worldUrl };\n`);
  const contentSha = crypto.createHash("sha256").update(assetContent).digest("hex");
  const assetBytes = assetContent.byteLength;
  if (lfsPointer) {
    fs.writeFileSync(path.join(repositoryRoot, assetPath), [
      "version https://git-lfs.github.com/spec/v1",
      `oid sha256:${contentSha}`,
      `size ${assetBytes}`,
      ""
    ].join("\n"));
  } else {
    fs.writeFileSync(path.join(repositoryRoot, assetPath), assetContent);
  }
  fs.writeFileSync(path.join(packageRoot, "docs", "assets", "license.md"), "# Runtime asset license\n\nCC-BY-4.0.\n");
  fs.writeFileSync(path.join(packageRoot, "docs", "assets", "provenance.md"), "# Runtime asset provenance\n\nCreated for this fixture.\n");
  for (const [name, contents] of Object.entries({
    "submission.json": "{}\n",
    "compatibility-report.json": "{}\n",
    "PROPOSAL.md": "# Proposal\n",
    "THREAT_MODEL.md": "# Threat model\n",
    "TEST_PLAN.md": "# Test plan\n",
    "EVIDENCE.md": "# Evidence\n"
  })) fs.writeFileSync(path.join(packageRoot, name), contents);

  initializeGit(repositoryRoot);
  const gitBlob = git(repositoryRoot, ["rev-parse", `HEAD:${assetPath}`]);
  const assets = [repositoryAsset({
    assetPath,
    gitBlob,
    sha256: `sha256:${contentSha}`,
    bytes: assetBytes,
    mime: assetMime
  })];
  if (external) assets.push(externalAsset());
  fs.writeFileSync(path.join(repositoryRoot, manifestPath), `${JSON.stringify({
    $schema: "urn:programmable:runtime-assets:1",
    schemaVersion: 1,
    assets
  }, null, 2)}\n`);
  commitAll(repositoryRoot, "bind runtime asset manifest");

  return {
    repositoryRoot,
    packageRoot,
    sourcePath,
    assetPath,
    assetBytes,
    manifestPath,
    submission: {
      stage: "prototype",
      implementation: {
        sourcePaths: [sourcePath],
        testPaths: [],
        runtimeAssetManifestPath: manifestPath
      },
      integration: {
        appSourcePaths: [sourcePath],
        integrationTestPaths: [],
        sdkDependencies: []
      },
      capabilityExtensions: []
    },
    cleanup: () => fs.rmSync(repositoryRoot, { recursive: true, force: true })
  };
}

function repositoryAsset({ assetPath, gitBlob, sha256, bytes, mime }) {
  return {
    id: "arena-world",
    source: "repository",
    repositoryPath: assetPath,
    externalUri: null,
    gitBlob,
    sha256,
    mime,
    bytes,
    load: {
      phase: "level-on-demand",
      mechanism: "http-fetch",
      reference: "/assets/world.glb",
      integrityEnforced: true,
      failureBehavior: "Keep the level unavailable when its exact world asset cannot be loaded."
    },
    license: {
      status: "declared",
      expression: "CC-BY-4.0",
      evidencePath: "submissions/fixture/docs/assets/license.md",
      url: null
    },
    provenance: {
      kind: "builder-created",
      source: "Created for the exact project revision.",
      creator: "Fixture Builder",
      evidencePath: "submissions/fixture/docs/assets/provenance.md"
    }
  };
}

function makeGlb(totalBytes) {
  assert.equal(totalBytes % 4, 0);
  const json = Buffer.from('{"asset":{"version":"2.0"}}', "utf8");
  const paddedJsonBytes = Math.ceil(json.length / 4) * 4;
  const binaryBytes = totalBytes - 12 - 8 - paddedJsonBytes - 8;
  assert.ok(binaryBytes >= 0);
  const result = Buffer.alloc(totalBytes);
  result.write("glTF", 0, "ascii");
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(totalBytes, 8);
  result.writeUInt32LE(paddedJsonBytes, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  json.copy(result, 20);
  result.fill(0x20, 20 + json.length, 20 + paddedJsonBytes);
  const binaryHeader = 20 + paddedJsonBytes;
  result.writeUInt32LE(binaryBytes, binaryHeader);
  result.writeUInt32LE(0x004e4942, binaryHeader + 4);
  return result;
}

function makePng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
}

function makeWav() {
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8_000, 24);
  wav.writeUInt32LE(16_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(0, 40);
  return wav;
}

function externalAsset() {
  return {
    id: "map-style",
    source: "external",
    repositoryPath: null,
    externalUri: "https://example.com/maps/style.json",
    gitBlob: null,
    sha256: null,
    mime: "application/json",
    bytes: 1024,
    load: {
      phase: "runtime-on-demand",
      mechanism: "map-provider",
      reference: "Provider style endpoint",
      integrityEnforced: null,
      failureBehavior: "Disable the map-backed mode while the provider resource is unavailable."
    },
    license: {
      status: "review-required",
      expression: null,
      evidencePath: null,
      url: "https://example.com/terms"
    },
    provenance: {
      kind: "provider-supplied",
      source: "Example map provider.",
      creator: null,
      evidencePath: null
    }
  };
}

function updateManifest(fixture, mutate) {
  const target = path.join(fixture.repositoryRoot, fixture.manifestPath);
  const manifest = JSON.parse(fs.readFileSync(target, "utf8"));
  mutate(manifest);
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
}

function initializeGit(repositoryRoot) {
  git(repositoryRoot, ["init", "--quiet"]);
  commitAll(repositoryRoot, "initial runtime assets");
}

function commitAll(repositoryRoot, message) {
  git(repositoryRoot, ["add", "."]);
  git(repositoryRoot, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", message]);
}

function git(repositoryRoot, args) {
  const result = childProcess.spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
