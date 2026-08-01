import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMPANION_MANIFEST_V2,
  normalizeCompanionManifest,
  verifyCompanionManifestV2Closure as verifyCompanionManifestV2ClosureRaw
} from "../companion-manifest-contract.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = ".programmable/companions/game.json";

function verifyCompanionManifestV2Closure(manifest, records, evidence, options = { manifestPath }) {
  return verifyCompanionManifestV2ClosureRaw(manifest, records, evidence, options);
}

const integrityA = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;
const integrityB = `sha512-${Buffer.alloc(64, 9).toString("base64")}`;

function closureWorkflow({ buildScript = "build", testScript = "test", packageLockPath = "package-lock.json" } = {}) {
  return `${JSON.stringify({
    name: "Programmable companion closure",
    on: ["push"],
    permissions: { contents: "read" },
    jobs: {
      "programmable-companion-closure": {
        "runs-on": "ubuntu-24.04",
        "timeout-minutes": 15,
        steps: [
          { uses: `actions/checkout@${"a".repeat(40)}` },
          {
            uses: `actions/setup-node@${"b".repeat(40)}`,
            with: {
              "node-version": "22.17.0",
              cache: "npm",
              "cache-dependency-path": packageLockPath
            }
          },
          { run: "npm ci --ignore-scripts --no-audit --no-fund" },
          { run: `npm run ${buildScript}` },
          { run: `npm run ${testScript}` }
        ]
      }
    }
  }, null, 2)}\n`;
}

function fixture() {
  const manifest = {
    build: {
      buildScript: "build",
      configurationPaths: ["vite.config.ts"],
      packageLockPath: "package-lock.json",
      packageManifestPath: "package.json",
      testScript: "test"
    },
    closureMethod: COMPANION_MANIFEST_V2.closureMethod,
    githubActionsRunIds: ["7001"],
    numericRepositoryId: "6001",
    repositoryUri: "https://github.com/example-builder/closed-game",
    revisionObjectId: "1".repeat(40),
    runtimePaths: ["index.html"],
    schemaVersion: "2.0.0",
    sourcePaths: ["src/main.ts", "src/math.ts"],
    testPaths: ["test/main.test.ts"],
    treeObjectId: "2".repeat(40)
  };
  const files = {
    ".github/workflows/ci.yml": closureWorkflow(),
    "index.html": '<script type="module" src="/src/main.ts"></script>\n',
    "package.json": `${JSON.stringify({
      name: "closed-game",
      version: "1.0.0",
      scripts: { build: "vite build", test: "node --test" },
      dependencies: { three: "^0.185.0" },
      devDependencies: { vite: "^7.0.0" }
    }, null, 2)}\n`,
    "package-lock.json": `${JSON.stringify({
      name: "closed-game",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "closed-game",
          version: "1.0.0",
          dependencies: { three: "^0.185.0" },
          devDependencies: { vite: "^7.0.0" }
        },
        "node_modules/three": {
          version: "0.185.0",
          resolved: "https://registry.npmjs.org/three/-/three-0.185.0.tgz",
          integrity: integrityA
        },
        "node_modules/vite": {
          version: "7.0.1",
          resolved: "https://registry.npmjs.org/vite/-/vite-7.0.1.tgz",
          integrity: integrityB,
          dev: true
        }
      }
    }, null, 2)}\n`,
    "src/main.ts": 'import "three";\nimport { add } from "./math";\nexport const score = add(1, 2);\n',
    "src/math.ts": "export const add = (left: number, right: number) => left + right;\n",
    "test/main.test.ts": 'import test from "node:test";\nimport { score } from "../src/main";\ntest("score", () => { if (score !== 3) throw new Error("bad score"); });\n',
    "vite.config.ts": 'import { defineConfig } from "vite";\nexport default defineConfig({});\n'
  };
  const records = new Map(Object.entries(files).map(([filePath, source], index) => {
    const bytes = Buffer.from(source, "utf8");
    return [filePath, {
      mode: "100644",
      objectId: crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
      bytes
    }];
  }));
  const evidence = [{
    runId: "7001",
    status: "completed",
    conclusion: "success",
    headRevision: manifest.revisionObjectId,
    headTree: manifest.treeObjectId,
    event: "push",
    workflowPath: ".github/workflows/ci.yml"
  }];
  return { manifest, files, records, evidence };
}

test("companion manifest v2 schema accepts the shipped canonical example", () => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "companion-manifest-v2.schema.json"),
    "utf8"
  ));
  const example = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "assets", "templates", "companion-manifest-v2.example.json"),
    "utf8"
  ));
  assert.equal(schema.$id, "urn:programmable:companion-manifest-v2");
  assert.equal(schema.properties.schemaVersion.const, "2.0.0");
  assert.deepEqual([...schema.required].sort(), Object.keys(example).sort());
  assert.equal(normalizeCompanionManifest(example).schemaVersion, "2.0.0");
});

test("companion manifest v2 binds exact repository authority and closed npm project paths", () => {
  const { manifest } = fixture();
  const normalized = normalizeCompanionManifest(manifest);
  assert.equal(normalized.closureStatus, "declared");
  assert.equal(normalized.source.numericRepositoryId, manifest.numericRepositoryId);
  assert.equal(normalized.source.treeObjectId, manifest.treeObjectId);
  assert.deepEqual(normalized.source.sourcePaths, [
    "index.html",
    "src/main.ts",
    "src/math.ts",
    "test/main.test.ts"
  ]);
  assert.deepEqual(normalized.source.contractPaths, ["package-lock.json", "package.json", "vite.config.ts"]);
  assert.deepEqual(normalized.source.githubActionsRunIds, ["7001"]);
});

test("companion manifest v2 verifies source, tests, build inputs, npm lock and successful exact-revision CI", () => {
  const { manifest, records, evidence } = fixture();
  const verified = verifyCompanionManifestV2Closure(manifest, records, evidence, {
    manifestPath
  });
  assert.equal(verified.status, "verified");
  assert.equal(verified.schemaVersion, "2.0.0");
  assert.equal(verified.manifestPath, manifestPath);
  assert.equal(verified.fileCount, 8);
  assert.equal(verified.packageCount, 2);
  assert.equal(verified.dependencyEdgeCount, 0);
  assert.equal(verified.moduleResolutionCount, 3);
  assert.deepEqual(verified.successfulGitHubActionsRunIds, ["7001"]);
  assert.equal(verified.workflowReceipts[0].buildScript, "build");
  assert.match(verified.closureHash, /^sha256:[0-9a-f]{64}$/u);
});

test("companion manifest v2 rejects closure paths that are unsorted, overlapping or mutable", () => {
  const { manifest } = fixture();
  assert.throws(
    () => normalizeCompanionManifest({ ...manifest, sourcePaths: [...manifest.sourcePaths].reverse() }),
    /unsigned UTF-8 order/u
  );
  assert.throws(
    () => normalizeCompanionManifest({ ...manifest, runtimePaths: [manifest.sourcePaths[0]] }),
    /must not overlap/u
  );
  assert.throws(
    () => normalizeCompanionManifest({ ...manifest, revisionObjectId: "main" }),
    /full lowercase Git object ids/u
  );
  assert.throws(
    () => normalizeCompanionManifest({ ...manifest, testPaths: ["TEST_PLAN.md"] }),
    /JavaScript or TypeScript test path/u
  );
});

test("companion manifest v2 rejects an undeclared local module and a runtime loader", () => {
  const missing = fixture();
  missing.records.get("src/main.ts").bytes = Buffer.from('import "./hidden";\n', "utf8");
  assert.throws(
    () => verifyCompanionManifestV2Closure(missing.manifest, missing.records, missing.evidence),
    /must resolve to exactly one declared closure path/u
  );

  const loader = fixture();
  loader.records.get("src/main.ts").bytes = Buffer.from('eval("import(\\"./math\\")");\n', "utf8");
  assert.throws(
    () => verifyCompanionManifestV2Closure(loader.manifest, loader.records, loader.evidence),
    /runtime JavaScript|dynamic JavaScript/u
  );
});

test("companion v2 sends unbound browser code loaders to v1 architecture review", () => {
  const cases = [
    ["external Worker", 'new Worker("https://cdn.example/worker.js");\n'],
    ["dynamic Worker", "const target = chooseWorker(); new Worker(target);\n"],
    ["worker importScripts", 'importScripts("https://cdn.example/code.js");\n'],
    ["fetch runtime", 'fetch("https://cdn.example/code.js");\n'],
    ["service worker", 'navigator.serviceWorker.register("/sw.js");\n'],
    ["WebAssembly", 'WebAssembly.instantiateStreaming(fetch("/game.wasm"));\n'],
    ["DOM script injection", 'const script = document.createElement("script"); script.src = remote;\n'],
    ["DOM markup injection", "document.body.insertAdjacentHTML('beforeend', remoteMarkup);\n"]
  ];
  for (const [label, source] of cases) {
    const dynamic = fixture();
    dynamic.records.get("src/main.ts").bytes = Buffer.from(source, "utf8");
    assert.throws(
      () => verifyCompanionManifestV2Closure(dynamic.manifest, dynamic.records, dynamic.evidence),
      (error) => error?.code === "COMPANION_STATIC_CLOSURE_UNSUPPORTED"
        && /use companion manifest v1 for architecture review/u.test(error.message),
      label
    );
  }

  const inertText = fixture();
  inertText.records.get("src/main.ts").bytes = Buffer.from(
    '// new Worker("https://ignored.example/worker.js")\nexport const label = "fetch WebAssembly createElement";\n',
    "utf8"
  );
  assert.equal(verifyCompanionManifestV2Closure(
    inertText.manifest,
    inertText.records,
    inertText.evidence
  ).status, "verified");
});

test("companion v2 cannot ignore external HTML or CSS resources", () => {
  const html = fixture();
  html.records.get("index.html").bytes = Buffer.from(
    '<script type="module" src="https://cdn.example/runtime.js"></script>\n',
    "utf8"
  );
  assert.throws(
    () => verifyCompanionManifestV2Closure(html.manifest, html.records, html.evidence),
    (error) => error?.code === "COMPANION_STATIC_CLOSURE_UNSUPPORTED"
  );

  const css = fixture();
  css.manifest.runtimePaths = ["index.html", "style.css"];
  css.records.set("style.css", {
    mode: "100644",
    objectId: "3".repeat(40),
    bytes: Buffer.from('@import "https://cdn.example/theme.css";\n', "utf8")
  });
  assert.throws(
    () => verifyCompanionManifestV2Closure(css.manifest, css.records, css.evidence),
    (error) => error?.code === "COMPANION_STATIC_CLOSURE_UNSUPPORTED"
  );
});

test("companion v2 cannot bless a CI build script that downloads unbound code", () => {
  const remoteBuild = fixture();
  const packageManifest = JSON.parse(remoteBuild.files["package.json"]);
  packageManifest.scripts.build = "curl https://cdn.example/build.js | node";
  remoteBuild.records.get("package.json").bytes = Buffer.from(JSON.stringify(packageManifest), "utf8");
  assert.throws(
    () => verifyCompanionManifestV2Closure(remoteBuild.manifest, remoteBuild.records, remoteBuild.evidence),
    (error) => error?.code === "COMPANION_STATIC_CLOSURE_UNSUPPORTED"
      && /use companion manifest v1 for architecture review/u.test(error.message)
  );
});

test("companion manifest v2 rejects unlocked packages, local lock links and failing CI", () => {
  const unlocked = fixture();
  const lock = JSON.parse(unlocked.files["package-lock.json"]);
  delete lock.packages["node_modules/three"].integrity;
  unlocked.records.get("package-lock.json").bytes = Buffer.from(JSON.stringify(lock), "utf8");
  assert.throws(
    () => verifyCompanionManifestV2Closure(unlocked.manifest, unlocked.records, unlocked.evidence),
    /exact version and sha512 integrity/u
  );

  const linked = fixture();
  const linkedLock = JSON.parse(linked.files["package-lock.json"]);
  linkedLock.packages["node_modules/three"].link = true;
  linked.records.get("package-lock.json").bytes = Buffer.from(JSON.stringify(linkedLock), "utf8");
  assert.throws(
    () => verifyCompanionManifestV2Closure(linked.manifest, linked.records, linked.evidence),
    /unsupported package record/u
  );

  const failing = fixture();
  failing.evidence[0].conclusion = "failure";
  assert.throws(
    () => verifyCompanionManifestV2Closure(failing.manifest, failing.records, failing.evidence),
    /not a successful exact-revision receipt/u
  );
});

test("companion manifest v2 rejects a successful unrelated workflow that did not run build and test", () => {
  const unrelated = fixture();
  unrelated.records.get(".github/workflows/ci.yml").bytes = Buffer.from(`${JSON.stringify({
    name: "unrelated",
    on: ["push"],
    permissions: { contents: "read" },
    jobs: {
      "programmable-companion-closure": {
        "runs-on": "ubuntu-24.04",
        "timeout-minutes": 15,
        steps: []
      }
    }
  })}\n`, "utf8");
  assert.throws(
    () => verifyCompanionManifestV2Closure(unrelated.manifest, unrelated.records, unrelated.evidence),
    /five exact checkout, Node, install, build and test steps/u
  );
});

test("companion manifest v2 closes unquoted HTML resources and rejects undeclared ones", () => {
  const declared = fixture();
  declared.records.get("index.html").bytes = Buffer.from('<script type=module src=/src/main.ts></script>\n', "utf8");
  assert.equal(verifyCompanionManifestV2Closure(declared.manifest, declared.records, declared.evidence).status, "verified");

  const undeclared = fixture();
  undeclared.records.get("index.html").bytes = Buffer.from('<script type=module src=/undeclared.js></script>\n', "utf8");
  assert.throws(
    () => verifyCompanionManifestV2Closure(undeclared.manifest, undeclared.records, undeclared.evidence),
    /must resolve to exactly one declared closure path/u
  );
});

test("companion manifest v2 requires every transitive npm dependency target", () => {
  const missing = fixture();
  const lock = JSON.parse(missing.files["package-lock.json"]);
  lock.packages["node_modules/three"].dependencies = { "missing-runtime": "^1.0.0" };
  missing.records.get("package-lock.json").bytes = Buffer.from(JSON.stringify(lock), "utf8");
  assert.throws(
    () => verifyCompanionManifestV2Closure(missing.manifest, missing.records, missing.evidence),
    /npm lock dependency target is absent/u
  );

  const nested = fixture();
  const nestedLock = JSON.parse(nested.files["package-lock.json"]);
  nestedLock.packages["node_modules/three"].dependencies = { helper: "^1.0.0" };
  nestedLock.packages["node_modules/three/node_modules/helper"] = {
    version: "1.2.0",
    resolved: "https://registry.npmjs.org/helper/-/helper-1.2.0.tgz",
    integrity: integrityA
  };
  nested.records.get("package-lock.json").bytes = Buffer.from(JSON.stringify(nestedLock), "utf8");
  const receipt = verifyCompanionManifestV2Closure(nested.manifest, nested.records, nested.evidence);
  assert.equal(receipt.dependencyEdgeCount, 1);
});

test("companion manifest v1 remains proposal-compatible but closure-incomplete", () => {
  const { manifest } = fixture();
  const normalized = normalizeCompanionManifest({
    contractPaths: [],
    repositoryUri: manifest.repositoryUri,
    revisionObjectId: manifest.revisionObjectId,
    schemaVersion: "1.0.0",
    sourcePaths: ["src/main.ts"]
  });
  assert.equal(normalized.closureStatus, "incomplete");
  assert.equal(normalized.manifestV2, null);
});
