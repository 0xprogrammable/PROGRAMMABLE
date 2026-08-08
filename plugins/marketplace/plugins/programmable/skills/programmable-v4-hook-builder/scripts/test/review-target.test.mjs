import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeRepositoryClosure,
  buildReviewTarget,
  validateDependencyLock
} from "../review-target-core.mjs";

test("review target binds arbitrary project bytes without requiring Foundry", () => {
  const fixture = createArbitraryProjectFixture();
  try {
    const target = buildReviewTarget(fixture);
    const paths = new Set(target.files.map(({ path: filePath }) => filePath));
    for (const expectedPath of [
      "submissions/fixture/game/scene.ts",
      "submissions/fixture/game/style.css",
      "submissions/fixture/game/reward.glsl",
      "submissions/fixture/service/main.py",
      "submissions/fixture/engine/src/lib.rs",
      "submissions/fixture/assets/sprite.bin",
      "submissions/fixture/project-surface.schema.json",
      "submissions/fixture/project-surface-evidence.md"
    ]) assert.ok(paths.has(expectedPath), `${expectedPath} must be byte-bound`);
    assert.equal(paths.has("foundry.toml"), false);
    assert.equal(paths.has("remappings.txt"), false);
    const binary = target.files.find(({ path: filePath }) => filePath.endsWith("sprite.bin"));
    assert.equal(binary.bytes, 6);
    assert.equal(binary.sha256, "dada95bc5c7e873bf2f9500ed5a0b3d969fd4ef92e556fc0cefcc030eb1d6592");
  } finally {
    fixture.cleanup();
  }
});

test("unknown-language proposals stay byte-bound with an explicit incomplete semantic closure", () => {
  const fixture = createArbitraryProjectFixture();
  fixture.submission.stage = "proposal";
  try {
    const closure = analyzeRepositoryClosure(fixture);
    assert.equal(closure.status, "incomplete");
    assert.ok(closure.diagnostics.some(({ code, path: diagnosticPath }) => (
      code === "DECLARED_FILE_SEMANTIC_CLOSURE_UNAVAILABLE"
      && diagnosticPath.endsWith("service/main.py")
    )));
  } finally {
    fixture.cleanup();
  }
});

test("proposal closure records aliases, import.meta.glob and runtime loaders while prototypes stay fail closed", async (t) => {
  const cases = [
    {
      name: "at alias",
      source: 'import value from "@/game/value"; export { value };\n',
      code: "JAVASCRIPT_ALIAS_RESOLUTION_UNPROVEN"
    },
    ...[
      ["tilde alias", "~/game/value"],
      ["hash alias", "#game/value"],
      ["src root", "src/game/value"],
      ["app root", "app/game/value"],
      ["components root", "components/game/value"]
    ].map(([name, specifier]) => ({
      name,
      source: `import value from ${JSON.stringify(specifier)}; export { value };\n`,
      code: "JAVASCRIPT_ALIAS_RESOLUTION_UNPROVEN"
    })),
    {
      name: "import meta glob",
      source: 'export const levels = import.meta.glob("./levels/*.ts");\n',
      code: "JAVASCRIPT_IMPORT_META_GLOB_UNPROVEN"
    },
    {
      name: "dynamic import",
      source: 'export const load = (name) => import(`./levels/${name}.ts`);\n',
      code: "JAVASCRIPT_DYNAMIC_IMPORT_UNPROVEN"
    },
    {
      name: "runtime loader",
      source: 'export const load = (name) => require(name);\n',
      code: "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN"
    }
  ];
  for (const fixtureCase of cases) await t.test(fixtureCase.name, () => {
    const fixture = createFixture({
      source: "contract Hook {}",
      appSourcePaths: ["submissions/fixture/app/entry.ts"],
      additionalFiles: { "submissions/fixture/app/entry.ts": fixtureCase.source }
    });
    try {
      fixture.submission.stage = "proposal";
      const proposal = buildReviewTarget(fixture);
      assert.equal(proposal.closure.status, "incomplete");
      assert.ok(proposal.closure.diagnostics.some(({ code }) => code === fixtureCase.code));

      fixture.submission.stage = "prototype";
      assert.throws(() => buildReviewTarget(fixture), UnsupportedClosureErrorPattern(fixtureCase.code));
    } finally {
      fixture.cleanup();
    }
  });
});

test("a Hardhat-style Solidity monorepo proposal without root Foundry follows relative imports but blocks a prototype", () => {
  const localPath = "submissions/fixture/src/Local.sol";
  const fixture = createFixture({
    source: 'import "./Local.sol"; contract Hook is Local {}',
    additionalFiles: { [localPath]: "contract Local {}" }
  });
  fixture.submission.stage = "proposal";
  fs.rmSync(path.join(fixture.repositoryRoot, "foundry.toml"));
  fs.rmSync(path.join(fixture.repositoryRoot, "remappings.txt"));
  try {
    const target = buildReviewTarget(fixture);
    assert.equal(target.closure.status, "incomplete");
    assert.ok(target.closure.diagnostics.some(({ code }) => code === "SOLIDITY_BUILD_PROFILE_REVIEW_REQUIRED"));
    assert.ok(target.files.some(({ path: filePath }) => filePath === localPath));

    fixture.submission.stage = "prototype";
    assert.throws(() => buildReviewTarget(fixture), /review target file does not exist: foundry\.toml/u);
    fixture.submission.stage = "proposal";
    fs.rmSync(path.join(fixture.repositoryRoot, localPath));
    assert.throws(() => buildReviewTarget(fixture), /review target file does not exist: submissions\/fixture\/src\/Local\.sol/u);
  } finally {
    fixture.cleanup();
  }
});

function UnsupportedClosureErrorPattern(code) {
  return (error) => error?.name === "UnsupportedClosureError" && error?.closureCode === code;
}

test("an integration-only Solidity file activates Foundry and enters the exact compiler closure", () => {
  const integrationPath = "submissions/fixture/app/RouterAdapter.sol";
  const fixture = createFixture({
    source: "contract UndeclaredHook {}",
    appSourcePaths: [integrationPath],
    additionalFiles: {
      [integrationPath]: "contract RouterAdapter {}"
    }
  });
  fixture.submission.implementation.sourcePaths = [];

  try {
    const target = buildReviewTarget(fixture);
    const paths = new Set(target.files.map(({ path: filePath }) => filePath));
    assert.equal(paths.has(integrationPath), true);
    assert.equal(paths.has("submissions/fixture/src/Hook.sol"), false);
    assert.equal(paths.has("foundry.toml"), true);
    assert.equal(paths.has("remappings.txt"), true);
  } finally {
    fixture.cleanup();
  }
});

test("declared source and test Git LFS pointers are rejected before dependency scanning", () => {
  const fixture = createArbitraryProjectFixture();
  const pointerPath = path.join(fixture.packageRoot, "service", "main.py");
  fs.writeFileSync(pointerPath, [
    "version https://git-lfs.github.com/spec/v1",
    `oid sha256:${"a".repeat(64)}`,
    "size 12345",
    ""
  ].join("\n"));

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /Git LFS pointer is not materialized source\/test content: submissions\/fixture\/service\/main\.py/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("arbitrary project byte binding rejects traversal, symlinks and oversized files", async (t) => {
  await t.test("traversal", () => {
    const fixture = createArbitraryProjectFixture();
    try {
      fixture.submission.implementation.sourcePaths.push("../outside.py");
      assert.throws(() => buildReviewTarget(fixture), /unsafe repository-relative path/);
    } finally {
      fixture.cleanup();
    }
  });
  await t.test("symlink", () => {
    const fixture = createArbitraryProjectFixture();
    try {
      const link = path.join(fixture.repositoryRoot, "submissions", "fixture", "assets", "linked.bin");
      fs.symlinkSync("sprite.bin", link);
      fixture.submission.implementation.sourcePaths.push("submissions/fixture/assets/linked.bin");
      assert.throws(() => buildReviewTarget(fixture), /review target contains a symbolic link/);
    } finally {
      fixture.cleanup();
    }
  });
  await t.test("oversized binary", () => {
    const fixture = createArbitraryProjectFixture();
    try {
      const oversized = path.join(fixture.repositoryRoot, "submissions", "fixture", "assets", "oversized.bin");
      const descriptor = fs.openSync(oversized, "w");
      fs.ftruncateSync(descriptor, 2_000_001);
      fs.closeSync(descriptor);
      fixture.submission.implementation.sourcePaths.push("submissions/fixture/assets/oversized.bin");
      assert.throws(() => buildReviewTarget(fixture), /review target file exceeds 2000000 bytes/);
    } finally {
      fixture.cleanup();
    }
  });
});

test("review target hashes transitive local TypeScript imports and changes when the dependency changes", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": [
        'import { hiddenValue } from "./hidden";',
        "export const visibleValue = hiddenValue;"
      ].join("\n"),
      "submissions/fixture/app/hidden.ts": 'export const hiddenValue = "reviewed";\n'
    }
  });

  try {
    const first = buildReviewTarget(fixture);
    assert.ok(
      first.files.some(({ path: filePath }) => filePath === "submissions/fixture/app/hidden.ts"),
      "the transitive TypeScript dependency must be inside the hashed review closure"
    );

    fs.writeFileSync(
      path.join(fixture.repositoryRoot, "submissions", "fixture", "app", "hidden.ts"),
      'export const hiddenValue = "substituted";\n'
    );
    const second = buildReviewTarget(fixture);
    assert.notEqual(second.reviewTargetHash, first.reviewTargetHash);
  } finally {
    fixture.cleanup();
  }
});

test("review target v10 excludes its authority records while retaining gate and surface evidence bytes", () => {
  const evidencePath = "submissions/fixture/evidence/test-result.json";
  const gateStatusPath = "submissions/fixture/evidence/gate-status.json";
  const reviewTargetPath = "submissions/fixture/evidence/review-target.json";
  const fixture = createFixture({
    source: "contract Hook {}",
    additionalFiles: {
      [evidencePath]: '{"passed":true}\n'
    }
  });
  fixture.submission.implementation.gateStatusPath = gateStatusPath;
  fixture.submission.implementation.reviewTargetPath = reviewTargetPath;
  const gateStatusFile = path.join(fixture.repositoryRoot, gateStatusPath);
  const reviewTargetFile = path.join(fixture.repositoryRoot, reviewTargetPath);
  fs.mkdirSync(path.dirname(gateStatusFile), { recursive: true });
  const gateStatus = (reviewTargetHash, note = "first") => ({
    reviewTargetHash,
    gates: [{
      id: "test",
      status: "completed",
      evidence: [{ path: evidencePath, reviewTargetHash }],
      note
    }]
  });

  try {
    fs.writeFileSync(
      gateStatusFile,
      `${JSON.stringify(gateStatus(`sha256:${"0".repeat(64)}`), null, 2)}\n`
    );
    const first = buildReviewTarget(fixture);
    assert.equal(first.closureMethod.endsWith("-v10"), true);
    assert.equal(first.files.some(({ path: filePath }) => filePath === gateStatusPath), false);
    assert.equal(first.files.some(({ path: filePath }) => filePath === reviewTargetPath), false);
    assert.equal(first.files.some(({ path: filePath }) => filePath === evidencePath), true);

    fs.writeFileSync(gateStatusFile, `${JSON.stringify(gateStatus(first.reviewTargetHash), null, 2)}\n`);
    fs.writeFileSync(reviewTargetFile, `${JSON.stringify(first, null, 2)}\n`);
    const second = buildReviewTarget(fixture);
    assert.deepEqual(second, first);

    fs.writeFileSync(gateStatusFile, `${JSON.stringify(gateStatus(first.reviewTargetHash, "changed"), null, 2)}\n`);
    fs.appendFileSync(reviewTargetFile, "\n");
    assert.deepEqual(buildReviewTarget(fixture), first);

    fs.writeFileSync(path.join(fixture.repositoryRoot, evidencePath), '{"passed":false}\n');
    assert.notEqual(buildReviewTarget(fixture).reviewTargetHash, first.reviewTargetHash);
  } finally {
    fixture.cleanup();
  }
});

test("review target follows static JavaScript re-exports and literal dynamic imports", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    integrationTestPaths: ["submissions/fixture/test/entry.mjs"],
    additionalFiles: {
      "submissions/fixture/test/entry.mjs": [
        'export { visibleValue } from "../app/reexport.js";',
        'export async function loadLazy() { return import("../app/lazy.js"); }'
      ].join("\n"),
      "submissions/fixture/app/reexport.js": 'export * from "./hidden.js";\n',
      "submissions/fixture/app/hidden.js": "export const visibleValue = 1;\n",
      "submissions/fixture/app/lazy.js": "export const lazyValue = 2;\n"
    }
  });

  try {
    const target = buildReviewTarget(fixture);
    for (const expectedPath of [
      "submissions/fixture/app/reexport.js",
      "submissions/fixture/app/hidden.js",
      "submissions/fixture/app/lazy.js"
    ]) {
      assert.ok(
        target.files.some(({ path: filePath }) => filePath === expectedPath),
        `${expectedPath} must be inside the hashed review closure`
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test("review target follows literal local CommonJS dependencies", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.cjs"],
    additionalFiles: {
      "submissions/fixture/app/entry.cjs": 'module.exports = require("./hidden.cjs");\n',
      "submissions/fixture/app/hidden.cjs": "module.exports = 42;\n"
    }
  });

  try {
    const target = buildReviewTarget(fixture);
    assert.ok(
      target.files.some(({ path: filePath }) => filePath === "submissions/fixture/app/hidden.cjs"),
      "the required local module must be inside the hashed review closure"
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects computed dynamic imports because their closure cannot be proven", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": 'export const load = (name) => import("./" + name);\n'
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /dynamic import must use one string literal: submissions\/fixture\/app\/entry\.ts/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects computed require calls because their closure cannot be proven", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.cjs"],
    additionalFiles: {
      "submissions/fixture/app/entry.cjs": 'module.exports = require("./" + process.env.MODULE);\n'
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /require must use one string literal: submissions\/fixture\/app\/entry\.cjs/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects unresolved local JavaScript imports", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": 'import "./missing";\n'
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /local JavaScript import does not resolve: \.\/missing from submissions\/fixture\/app\/entry\.ts/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects ambiguous extensionless JavaScript imports", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": 'import "./hidden";\n',
      "submissions/fixture/app/hidden.ts": "export const value = 1;\n",
      "submissions/fixture/app/hidden.js": "export const value = 2;\n"
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /local JavaScript import is ambiguous: \.\/hidden from submissions\/fixture\/app\/entry\.ts/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target follows an extensionless TypeScript declaration import", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": 'import type { Hidden } from "./hidden";\n',
      "submissions/fixture/app/hidden.d.ts": "export interface Hidden { readonly value: number }\n"
    }
  });

  try {
    const target = buildReviewTarget(fixture);
    assert.ok(
      target.files.some(({ path: filePath }) => filePath === "submissions/fixture/app/hidden.d.ts"),
      "the declaration dependency must be inside the hashed review closure"
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target maps a NodeNext relative .js specifier to one exact TypeScript source", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": 'import { hidden } from "./hidden.js";\n',
      "submissions/fixture/app/hidden.ts": "export const hidden = 1;\n"
    }
  });

  try {
    const target = buildReviewTarget(fixture);
    assert.ok(
      target.files.some(({ path: filePath }) => filePath === "submissions/fixture/app/hidden.ts"),
      "the mapped TypeScript source must be inside the hashed review closure"
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects a NodeNext .js specifier with exact and mapped source ambiguity", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": 'import { hidden } from "./hidden.js";\n',
      "submissions/fixture/app/hidden.js": "export const hidden = 1;\n",
      "submissions/fixture/app/hidden.ts": "export const hidden = 2;\n"
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /local JavaScript import is ambiguous: \.\/hidden\.js from submissions\/fixture\/app\/entry\.ts/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target ignores the hashbang and follows the first executable import", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.mjs"],
    additionalFiles: {
      "submissions/fixture/app/entry.mjs": [
        '#!/usr/bin/env -S node require("./ignored.cjs")',
        'export { hidden } from "./hidden.mjs";'
      ].join("\n"),
      "submissions/fixture/app/hidden.mjs": "export const hidden = 1;\n"
    }
  });

  try {
    const target = buildReviewTarget(fixture);
    assert.ok(
      target.files.some(({ path: filePath }) => filePath === "submissions/fixture/app/hidden.mjs")
    );
    assert.ok(
      target.files.every(({ path: filePath }) => !filePath.endsWith("ignored.cjs"))
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target follows a literal dynamic import with options", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.mjs"],
    additionalFiles: {
      "submissions/fixture/app/entry.mjs": [
        'export const hidden = import("./hidden.json", { with: { type: "json" } });',
        'export const trailing = import("./trailing.mjs",);'
      ].join("\n"),
      "submissions/fixture/app/hidden.json": '{"hidden":true}\n',
      "submissions/fixture/app/trailing.mjs": "export const trailing = true;\n"
    }
  });

  try {
    const target = buildReviewTarget(fixture);
    for (const expectedPath of [
      "submissions/fixture/app/hidden.json",
      "submissions/fixture/app/trailing.mjs"
    ]) {
      assert.ok(
        target.files.some(({ path: filePath }) => filePath === expectedPath),
        `${expectedPath} must be inside the hashed review closure`
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects unsupported local alias imports instead of omitting them", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": 'import { hidden } from "@/app/hidden";\n',
      "submissions/fixture/app/hidden.ts": "export const hidden = 1;\n"
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /unsupported local JavaScript import alias: @\/app\/hidden/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects bare JavaScript packages that are not bound by the submission", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": 'import { unreviewed } from "unreviewed-package";\n'
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /bare JavaScript import is not bound by an exact package dependency: unreviewed-package/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target permits Node built-ins and exactly declared package roots and subpaths", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    sdkDependencies: [packageDependency("@uniswap/v4-sdk", {
      repository: "https://github.com/Uniswap/sdks.git"
    })],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": [
        'import assert from "node:assert/strict";',
        'import test from "node:test";',
        'import fs from "fs";',
        'import path from "path";',
        'import { Pool } from "@uniswap/v4-sdk/entities/pool";',
        "export const visible = assert.ok && test && fs.readFile && path.resolve && Pool;"
      ].join("\n")
    }
  });

  try {
    assert.doesNotThrow(() => buildReviewTarget(fixture));
  } finally {
    fixture.cleanup();
  }
});

test("review target accepts three and scoped packages with exact generic bindings", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    sdkDependencies: [
      packageDependency("three", { version: "0.185.1", repository: "https://github.com/mrdoob/three.js" }),
      packageDependency("@react-three/fiber", { repository: null, revision: null })
    ],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": [
        'import * as THREE from "three";',
        'import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";',
        'import { Canvas } from "@react-three/fiber/native";',
        "export const visible = [THREE.Scene, GLTFLoader, Canvas];"
      ].join("\n")
    }
  });

  try {
    assert.doesNotThrow(() => buildReviewTarget(fixture));
  } finally {
    fixture.cleanup();
  }
});

test("one package declaration cannot authorize a sibling or traversal specifier", () => {
  for (const specifier of ["three-other", "three/../other", "three//other"]) {
    const fixture = createFixture({
      source: "contract Hook {}",
      appSourcePaths: ["submissions/fixture/app/entry.ts"],
      sdkDependencies: [packageDependency("three", { repository: null, revision: null })],
      additionalFiles: {
        "submissions/fixture/app/entry.ts": `import value from ${JSON.stringify(specifier)};\nexport { value };\n`
      }
    });
    try {
      assert.throws(() => buildReviewTarget(fixture), /exact package dependency|unsupported local JavaScript import alias/u, specifier);
    } finally {
      fixture.cleanup();
    }
  }
});

test("duplicate package declarations fail before they can authorize imports", () => {
  const dependency = packageDependency("three", { repository: null, revision: null });
  const fixture = createFixture({
    source: "contract Hook {}",
    sdkDependencies: [dependency, { ...dependency }]
  });
  try {
    assert.throws(() => buildReviewTarget(fixture), /package dependency is declared more than once: three/u);
  } finally {
    fixture.cleanup();
  }
});

test("Solidity npm imports are marked as local package evidence and stay inside the declared root", () => {
  const dependency = packageDependency("@openzeppelin/contracts", {
    version: "5.6.1",
    repository: "https://github.com/OpenZeppelin/openzeppelin-contracts",
    revision: "4".repeat(40)
  });
  const fixture = createFixture({
    source: 'import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol"; contract Hook {}',
    remappings: "@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/\n",
    sdkDependencies: [dependency],
    additionalFiles: {
      "node_modules/@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol": 'import { IERC20 } from "../IERC20.sol"; library SafeERC20 {}',
      "node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol": "interface IERC20 {}"
    }
  });
  try {
    const target = buildReviewTarget(fixture);
    const records = target.files.filter(({ sourceClass }) => sourceClass === "external-package-local");
    assert.equal(records.length, 2);
    for (const record of records) {
      assert.equal(record.kind, "solidity-package-dependency-import");
      assert.equal(record.packageDependency.packageName, "@openzeppelin/contracts");
      assert.equal(record.packageDependency.version, "5.6.1");
      assert.equal(record.packageDependency.centralSourceVerified, false);
      assert.equal(record.packageDependency.evidenceState, "builder-declared-local-package-bytes");
      assert.equal(record.packageDependency.integrityVerified, false);
    }
  } finally {
    fixture.cleanup();
  }
});

test("undeclared node_modules Solidity roots remain fail closed", () => {
  const fixture = createFixture({
    source: 'import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol"; contract Hook {}',
    remappings: "@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/\n",
    additionalFiles: {
      "node_modules/@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol": "library SafeERC20 {}"
    }
  });
  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /Solidity package import is not bound by an exact package dependency/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects a symlink reached through a JavaScript import", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": 'import "./hidden.ts";\n',
      "submissions/fixture/app/real.ts": "export const hidden = 1;\n"
    }
  });
  fs.symlinkSync("real.ts", path.join(fixture.repositoryRoot, "submissions", "fixture", "app", "hidden.ts"));

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /review target contains a symbolic link: submissions\/fixture\/app\/hidden\.ts/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target ignores dependency-looking text in comments, strings, and regular expressions", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.ts"],
    additionalFiles: {
      "submissions/fixture/app/entry.ts": [
        '// import("./" + hidden)',
        'const text = \'require("./" + hidden)\';',
        'const pattern = /import\\("\\." \\+ hidden\\)/;',
        "export const visible = `${text}:${pattern.source}`;"
      ].join("\n")
    }
  });

  try {
    assert.doesNotThrow(() => buildReviewTarget(fixture));
  } finally {
    fixture.cleanup();
  }
});

test("review target does not hide a dynamic import between division operators", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.js"],
    additionalFiles: {
      "submissions/fixture/app/entry.js": [
        "let value = 1;",
        'export const visible = value++ / import("./hidden.js").then(() => 1) / 2;'
      ].join("\n"),
      "submissions/fixture/app/hidden.js": "export const hidden = 1;\n"
    }
  });

  try {
    const target = buildReviewTarget(fixture);
    assert.ok(
      target.files.some(({ path: filePath }) => filePath === "submissions/fixture/app/hidden.js"),
      "the dynamic import must not be skipped as regular-expression text"
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target does not hide a dynamic import after a template-literal operand", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.mjs"],
    additionalFiles: {
      "submissions/fixture/app/entry.mjs": 'export const visible = `1` / import(".\\/hidden.mjs").then(() => 1) / 2;\n',
      "submissions/fixture/app/hidden.mjs": "export const hidden = 1;\n"
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /JavaScript module specifier may not contain escapes: submissions\/fixture\/app\/entry\.mjs/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target does not hide a dynamic import after a regular-expression operand", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.mjs"],
    additionalFiles: {
      "submissions/fixture/app/entry.mjs": 'export const visible = /1/ / import(".\\/hidden.mjs").then(() => 1) / 2;\n',
      "submissions/fixture/app/hidden.mjs": "export const hidden = 1;\n"
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /JavaScript module specifier may not contain escapes: submissions\/fixture\/app\/entry\.mjs/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target bounds JavaScript lexical work before building the closure", () => {
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.js"],
    additionalFiles: {
      "submissions/fixture/app/entry.js": ";".repeat(100_001)
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /JavaScript source exceeds 100000 lexical tokens: submissions\/fixture\/app\/entry\.js/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target bounds nested JavaScript template expressions", () => {
  let expression = "0";
  for (let depth = 0; depth < 65; depth += 1) expression = `\`value:\${${expression}}\``;
  const fixture = createFixture({
    source: "contract Hook {}",
    appSourcePaths: ["submissions/fixture/app/entry.js"],
    additionalFiles: {
      "submissions/fixture/app/entry.js": `export const visible = ${expression};\n`
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /JavaScript source exceeds 64 nested template literals: submissions\/fixture\/app\/entry\.js/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects runtime module loaders outside the supported static closure", async (t) => {
  const cases = [
    {
      name: "createRequire",
      source: [
        'import { createRequire } from "node:module";',
        'export const hidden = createRequire(import.meta.url)("./hidden.cjs");'
      ].join("\n"),
      error: /unsupported runtime JavaScript loader createRequire/
    },
    {
      name: "computed require property",
      source: 'export const hidden = module["require"]("./hidden.cjs");\n',
      error: /unsupported computed JavaScript loader property require/
    },
    {
      name: "eval",
      source: 'export const hidden = eval("require(\\"./hidden.cjs\\")");\n',
      error: /unsupported dynamic JavaScript evaluation eval/
    },
    {
      name: "Function constructor",
      source: 'export const hidden = new Function("return require(\\"./hidden.cjs\\")")();\n',
      error: /unsupported dynamic JavaScript evaluation Function/
    },
    {
      name: "concatenated computed require property",
      source: 'export const hidden = module["re" + "quire"]("./hidden.cjs");\n',
      error: /unsupported computed JavaScript loader property require/
    },
    {
      name: "concatenated createRequire property",
      source: [
        'const mod = await import("node:module");',
        'export const hidden = mod["create" + "Require"](import.meta.url)("./hidden.cjs");'
      ].join("\n"),
      error: /unsupported computed JavaScript loader property createRequire/
    },
    {
      name: "concatenated eval property",
      source: 'export const hidden = globalThis["ev" + "al"]("import(\\"./hidden.mjs\\")");\n',
      error: /unsupported computed JavaScript loader property eval/
    },
    {
      name: "concatenated Function property",
      source: 'export const hidden = globalThis["Fun" + "ction"]("return import(\\"./hidden.mjs\\")")();\n',
      error: /unsupported computed JavaScript loader property Function/
    }
  ];

  for (const record of cases) {
    await t.test(record.name, () => {
      const fixture = createFixture({
        source: "contract Hook {}",
        appSourcePaths: ["submissions/fixture/app/entry.js"],
        additionalFiles: {
          "submissions/fixture/app/entry.js": record.source,
          "submissions/fixture/app/hidden.cjs": "module.exports = 42;\n"
        }
      });
      try {
        assert.throws(() => buildReviewTarget(fixture), record.error);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test("review target hashes the exact Solidity source selected by a repository remapping", () => {
  const fixture = createFixture({
    source: 'import "@uniswap/v4-core/src/Shadow.sol";\ncontract Hook is Shadow {}',
    remappings: "@uniswap/v4-core/=vendor/reviewed-v4-core/\n",
    additionalFiles: {
      "vendor/reviewed-v4-core/src/Shadow.sol": "contract Shadow {}"
    }
  });

  try {
    const target = buildReviewTarget(fixture);
    assert.ok(
      target.files.some(({ path: filePath }) => filePath === "vendor/reviewed-v4-core/src/Shadow.sol"),
      "the resolved compiler source must be inside the hashed review closure"
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects remappings declared outside the canonical remappings file", () => {
  const fixture = createFixture({
    source: 'import "@uniswap/v4-core/src/Shadow.sol";\ncontract Hook is Shadow {}',
    foundry: '[profile.default]\nremappings = ["@uniswap/v4-core/=vendor/shadow/"]\n',
    remappings: "@uniswap/v4-core/=vendor/reviewed-v4-core/\n",
    additionalFiles: {
      "vendor/reviewed-v4-core/src/Shadow.sol": "contract Shadow {}",
      "vendor/shadow/src/Shadow.sol": "contract Shadow {}"
    }
  });

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /foundry\.toml may not declare remappings/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects a foundry config symlink before reading its target", () => {
  const fixture = createFixture({
    source: "contract Hook {}"
  });
  const foundryPath = path.join(fixture.repositoryRoot, "foundry.toml");
  const symlinkTarget = path.join(fixture.repositoryRoot, "untrusted-foundry.toml");
  fs.writeFileSync(symlinkTarget, '[profile.default]\nremappings = ["@shadow/=vendor/shadow/"]\n');
  fs.rmSync(foundryPath);
  fs.symlinkSync("untrusted-foundry.toml", foundryPath);

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /review target contains a symbolic link: foundry\.toml/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects a remappings symlink before reading its target", () => {
  const fixture = createFixture({
    source: "contract Hook {}"
  });
  const remappingsPath = path.join(fixture.repositoryRoot, "remappings.txt");
  const symlinkTarget = path.join(fixture.repositoryRoot, "untrusted-remappings.txt");
  fs.writeFileSync(symlinkTarget, "not-a-remapping\n");
  fs.rmSync(remappingsPath);
  fs.symlinkSync("untrusted-remappings.txt", remappingsPath);

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /review target contains a symbolic link: remappings\.txt/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects symlinked directories in a resolved import path", () => {
  const fixture = createFixture({
    source: 'import "@uniswap/v4-core/src/Shadow.sol";\ncontract Hook is Shadow {}',
    remappings: "@uniswap/v4-core/=vendor/alias/\n",
    additionalFiles: {
      "vendor/reviewed-v4-core/src/Shadow.sol": "contract Shadow {}"
    }
  });
  fs.symlinkSync("reviewed-v4-core", path.join(fixture.repositoryRoot, "vendor", "alias"));

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /review target contains a symbolic link: vendor\/alias/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target checks the foundry config size before parsing it", () => {
  const fixture = createFixture({
    source: "contract Hook {}"
  });
  fs.writeFileSync(
    path.join(fixture.repositoryRoot, "foundry.toml"),
    `remappings = []\n${"x".repeat(2_000_000)}`
  );

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /review target file exceeds 2000000 bytes: foundry\.toml/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target checks the remappings file size before parsing it", () => {
  const fixture = createFixture({
    source: "contract Hook {}"
  });
  fs.writeFileSync(
    path.join(fixture.repositoryRoot, "remappings.txt"),
    `not-a-remapping\n${"x".repeat(2_000_000)}`
  );

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /review target file exceeds 2000000 bytes: remappings\.txt/
    );
  } finally {
    fixture.cleanup();
  }
});

test("review target rejects a config file changed after its metadata preflight", () => {
  const fixture = createFixture({
    source: "contract Hook {}"
  });
  const foundryPath = path.join(fixture.repositoryRoot, "foundry.toml");
  const canonicalFoundryPath = fs.realpathSync(foundryPath);
  const originalOpen = fs.openSync;
  let changed = false;
  fs.openSync = function openAfterChange(target, ...args) {
    if (!changed && target === canonicalFoundryPath) {
      changed = true;
      fs.appendFileSync(foundryPath, "# changed after lstat\n");
    }
    return originalOpen.call(this, target, ...args);
  };

  try {
    assert.throws(
      () => buildReviewTarget(fixture),
      /review target file changed while it was being validated: foundry\.toml/
    );
  } finally {
    fs.openSync = originalOpen;
    fixture.cleanup();
  }
});

test("dependency lock rejects a remapped checkout that differs from the locked source", () => {
  const fixture = createFixture({
    source: 'import "@uniswap/v4-core/src/Shadow.sol";\ncontract Hook is Shadow {}',
    remappings: "@uniswap/v4-core/=lib/v4-core/\n",
    additionalFiles: {
      "lib/v4-core/src/Shadow.sol": "contract Shadow {}"
    }
  });
  initializeGitRepository(path.join(fixture.repositoryRoot, "lib", "v4-core"));

  try {
    const target = buildReviewTarget(fixture);
    const lock = JSON.parse(
      fs.readFileSync(new URL("../../assets/templates/dependency-lock.example.json", import.meta.url), "utf8")
    );
    const errors = validateDependencyLock(lock, target.externalImports, {
      submission: {
        target: {
          solidityVersion: lock.compiler.solidity,
          evmVersion: lock.compiler.evmVersion,
          dependencyBaseline: lock.baseline
        }
      },
      testedBaselineLock: lock,
      importResolutions: target.importResolutions,
      repositoryRoot: fixture.repositoryRoot
    });

    assert.ok(
      errors.some((message) => /checkout revision differs from the dependency lock/.test(message)),
      JSON.stringify(errors)
    );
    assert.ok(
      errors.some((message) => /checkout tree differs from the dependency lock/.test(message)),
      JSON.stringify(errors)
    );
    assert.ok(
      errors.some((message) => /checkout origin differs from the dependency lock/.test(message)),
      JSON.stringify(errors)
    );
  } finally {
    fixture.cleanup();
  }
});

test("dependency lock accepts an exact builder-pinned model baseline without treating it as reviewed", () => {
  const lock = loadDependencyLock();
  lock.baseline = "model-specific-pinned";

  const errors = validateDependencyLock(lock, [], {
    submission: {
      target: {
        solidityVersion: lock.compiler.solidity,
        evmVersion: lock.compiler.evmVersion,
        dependencyBaseline: lock.baseline
      }
    }
  });

  assert.deepEqual(errors, []);
});

test("dependency lock rejects builder self-attestation of a maintainer-reviewed baseline", () => {
  const lock = loadDependencyLock();
  lock.baseline = "model-specific-reviewed";

  const errors = validateDependencyLock(lock, [], {
    submission: {
      target: {
        solidityVersion: lock.compiler.solidity,
        evmVersion: lock.compiler.evmVersion,
        dependencyBaseline: lock.baseline
      }
    }
  });

  assert.ok(errors.some((message) => message.includes("cannot be self-attested")), JSON.stringify(errors));
});

test("dependency lock rejects invented baseline labels", () => {
  const lock = loadDependencyLock();
  lock.baseline = "builder-says-reviewed";

  const errors = validateDependencyLock(lock, [], {
    submission: {
      target: {
        solidityVersion: lock.compiler.solidity,
        evmVersion: lock.compiler.evmVersion,
        dependencyBaseline: lock.baseline
      }
    }
  });

  assert.ok(errors.some((message) => message.includes("baseline must be")), JSON.stringify(errors));
});

test("dependency lock rejects modified files in an otherwise pinned checkout", () => {
  const fixture = createFixture({
    source: 'import "@uniswap/v4-core/src/Shadow.sol";\ncontract Hook is Shadow {}',
    remappings: "@uniswap/v4-core/=lib/v4-core/\n",
    additionalFiles: {
      "lib/v4-core/src/Shadow.sol": "contract Shadow {}"
    }
  });
  const checkout = path.join(fixture.repositoryRoot, "lib", "v4-core");
  initializeGitRepository(checkout, { remote: "https://github.com/Uniswap/v4-core.git" });

  try {
    const lock = JSON.parse(
      fs.readFileSync(new URL("../../assets/templates/dependency-lock.example.json", import.meta.url), "utf8")
    );
    const dependency = lock.dependencies.find(({ name }) => name === "Uniswap v4 Core");
    dependency.revision = runGit(checkout, ["rev-parse", "HEAD"]);
    dependency.sourceTree = runGit(checkout, ["rev-parse", "HEAD^{tree}"]);
    fs.appendFileSync(path.join(checkout, "src", "Shadow.sol"), "// unreviewed local change\n");

    const target = buildReviewTarget(fixture);
    const errors = validateDependencyLock(lock, target.externalImports, {
      submission: {
        target: {
          solidityVersion: lock.compiler.solidity,
          evmVersion: lock.compiler.evmVersion,
          dependencyBaseline: lock.baseline
        }
      },
      testedBaselineLock: structuredClone(lock),
      importResolutions: target.importResolutions,
      repositoryRoot: fixture.repositoryRoot
    });

    assert.ok(
      errors.some((message) => /checkout contains modified or untracked files/.test(message)),
      JSON.stringify(errors)
    );
  } finally {
    fixture.cleanup();
  }
});

test("dependency validation keeps a repository-local fsmonitor hook inert", () => {
  const fixture = createFixture({
    source: 'import "@uniswap/v4-core/src/Shadow.sol";\ncontract Hook is Shadow {}',
    remappings: "@uniswap/v4-core/=lib/v4-core/\n",
    additionalFiles: {
      "lib/v4-core/src/Shadow.sol": "contract Shadow {}"
    }
  });
  const checkout = path.join(fixture.repositoryRoot, "lib", "v4-core");
  const hookRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-dependency-hooks-"));
  const marker = path.join(hookRoot, "executed");
  initializeGitRepository(checkout, { remote: "https://github.com/Uniswap/v4-core.git" });

  try {
    const target = buildReviewTarget(fixture);
    const lock = loadDependencyLock();
    pinDependencyToCheckout(lock, "Uniswap v4 Core", checkout);
    const testedBaselineLock = structuredClone(lock);
    const hook = createFsmonitorProbe(hookRoot, marker);
    runGit(checkout, ["config", "core.fsmonitor", hook]);

    const errors = validateDependencyLock(lock, target.externalImports, {
      submission: {
        target: {
          solidityVersion: lock.compiler.solidity,
          evmVersion: lock.compiler.evmVersion,
          dependencyBaseline: lock.baseline
        }
      },
      testedBaselineLock,
      importResolutions: target.importResolutions,
      repositoryRoot: fixture.repositoryRoot
    });

    assert.equal(fs.existsSync(marker), false);
    assert.equal(
      errors.some((message) => /checkout contains modified or untracked files/u.test(message)),
      false,
      JSON.stringify(errors)
    );
  } finally {
    fixture.cleanup();
    fs.rmSync(hookRoot, { recursive: true, force: true });
  }
});

test("dependency lock verifies every resolved source is a blob in the exact HEAD tree", () => {
  const fixture = createFixture({
    source: [
      'import "@uniswap/v4-core/src/A.sol";',
      'import "@uniswap/v4-core/src/ZIgnored.sol";',
      "contract Hook is A, ZIgnored {}"
    ].join("\n"),
    remappings: "@uniswap/v4-core/=lib/v4-core/\n",
    additionalFiles: {
      "lib/v4-core/src/A.sol": "contract A {}"
    }
  });
  const checkout = path.join(fixture.repositoryRoot, "lib", "v4-core");
  fs.writeFileSync(path.join(checkout, ".gitignore"), "src/ZIgnored.sol\n");
  initializeGitRepository(checkout, { remote: "https://github.com/Uniswap/v4-core.git" });
  fs.writeFileSync(
    path.join(checkout, "src", "ZIgnored.sol"),
    "pragma solidity 0.8.26;\ncontract ZIgnored {}\n"
  );

  try {
    const target = buildReviewTarget(fixture);
    const lock = loadDependencyLock();
    pinDependencyToCheckout(lock, "Uniswap v4 Core", checkout);
    const errors = validateLockAgainstTarget(lock, target, fixture.repositoryRoot);

    assert.ok(
      errors.some((message) => /resolved source src\/ZIgnored\.sol is not a blob in HEAD/.test(message)),
      JSON.stringify(errors)
    );
  } finally {
    fixture.cleanup();
  }
});

test("dependency lock compares a resolved source with its exact HEAD blob", () => {
  const fixture = createFixture({
    source: 'import "@uniswap/v4-core/src/Shadow.sol";\ncontract Hook is Shadow {}',
    remappings: "@uniswap/v4-core/=lib/v4-core/\n",
    additionalFiles: {
      "lib/v4-core/src/Shadow.sol": "contract Shadow {}"
    }
  });
  const checkout = path.join(fixture.repositoryRoot, "lib", "v4-core");
  initializeGitRepository(checkout, { remote: "https://github.com/Uniswap/v4-core.git" });
  runGit(checkout, ["update-index", "--assume-unchanged", "src/Shadow.sol"]);
  fs.appendFileSync(path.join(checkout, "src", "Shadow.sol"), "// hidden substitution\n");

  try {
    const target = buildReviewTarget(fixture);
    const lock = loadDependencyLock();
    pinDependencyToCheckout(lock, "Uniswap v4 Core", checkout);
    const errors = validateLockAgainstTarget(lock, target, fixture.repositoryRoot);

    assert.ok(
      errors.some((message) => /resolved source src\/Shadow\.sol differs from its HEAD blob/.test(message)),
      JSON.stringify(errors)
    );
  } finally {
    fixture.cleanup();
  }
});

test("dependency lock rejects an ignored transitive dependency source absent from HEAD", () => {
  const fixture = createFixture({
    source: 'import "@uniswap/v4-core/src/Entry.sol";\ncontract Hook is Entry {}',
    remappings: "@uniswap/v4-core/=lib/v4-core/\n",
    additionalFiles: {
      "lib/v4-core/src/Entry.sol": 'import "./Hidden.sol";\ncontract Entry is Hidden {}'
    }
  });
  const checkout = path.join(fixture.repositoryRoot, "lib", "v4-core");
  fs.writeFileSync(path.join(checkout, ".gitignore"), "src/Hidden.sol\n");
  initializeGitRepository(checkout, { remote: "https://github.com/Uniswap/v4-core.git" });
  fs.writeFileSync(
    path.join(checkout, "src", "Hidden.sol"),
    "pragma solidity 0.8.26;\ncontract Hidden {}\n"
  );

  try {
    const target = buildReviewTarget(fixture);
    const lock = loadDependencyLock();
    pinDependencyToCheckout(lock, "Uniswap v4 Core", checkout);
    const errors = validateLockAgainstTarget(lock, target, fixture.repositoryRoot);

    assert.ok(
      errors.some((message) => /resolved source src\/Hidden\.sol is not a blob in HEAD/.test(message)),
      JSON.stringify(errors)
    );
  } finally {
    fixture.cleanup();
  }
});

test("dependency lock compares every transitive dependency source with HEAD", () => {
  const fixture = createFixture({
    source: 'import "@uniswap/v4-core/src/Entry.sol";\ncontract Hook is Entry {}',
    remappings: "@uniswap/v4-core/=lib/v4-core/\n",
    additionalFiles: {
      "lib/v4-core/src/Entry.sol": 'import "./Hidden.sol";\ncontract Entry is Hidden {}',
      "lib/v4-core/src/Hidden.sol": "contract Hidden {}"
    }
  });
  const checkout = path.join(fixture.repositoryRoot, "lib", "v4-core");
  initializeGitRepository(checkout, { remote: "https://github.com/Uniswap/v4-core.git" });
  runGit(checkout, ["update-index", "--assume-unchanged", "src/Hidden.sol"]);
  fs.appendFileSync(path.join(checkout, "src", "Hidden.sol"), "// hidden substitution\n");

  try {
    const target = buildReviewTarget(fixture);
    const lock = loadDependencyLock();
    pinDependencyToCheckout(lock, "Uniswap v4 Core", checkout);
    const errors = validateLockAgainstTarget(lock, target, fixture.repositoryRoot);

    assert.ok(
      errors.some((message) => /resolved source src\/Hidden\.sol differs from its HEAD blob/.test(message)),
      JSON.stringify(errors)
    );
  } finally {
    fixture.cleanup();
  }
});

function createFixture({
  source,
  foundry = "[profile.default]\nsrc = \"src\"\n",
  remappings = "",
  additionalFiles = {},
  appSourcePaths = [],
  integrationTestPaths = [],
  sdkDependencies = []
}) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-review-target-"));
  const packageRoot = path.join(repositoryRoot, "submissions", "fixture");
  fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });

  fs.writeFileSync(path.join(repositoryRoot, "foundry.toml"), foundry);
  fs.writeFileSync(path.join(repositoryRoot, "remappings.txt"), remappings);
  fs.writeFileSync(path.join(packageRoot, "src", "Hook.sol"), `pragma solidity 0.8.26;\n${source}\n`);
  for (const [relativePath, contents] of Object.entries(additionalFiles)) {
    const target = path.join(repositoryRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      relativePath.endsWith(".sol") ? `pragma solidity 0.8.26;\n${contents}\n` : contents
    );
  }
  for (const [name, contents] of Object.entries({
    "submission.json": "{}\n",
    "compatibility-report.json": "{}\n",
    "PROPOSAL.md": "# Proposal\n",
    "THREAT_MODEL.md": "# Threat model\n",
    "TEST_PLAN.md": "# Test plan\n",
    "EVIDENCE.md": "# Evidence\n"
  })) {
    fs.writeFileSync(path.join(packageRoot, name), contents);
  }

  const submission = {
    implementation: {
      sourcePaths: ["submissions/fixture/src/Hook.sol"],
      testPaths: []
    },
    integration: {
      appSourcePaths,
      integrationTestPaths,
      sdkDependencies
    }
  };

  return {
    repositoryRoot,
    packageRoot,
    submission,
    cleanup: () => fs.rmSync(repositoryRoot, { recursive: true, force: true })
  };
}

function packageDependency(packageName, overrides = {}) {
  return {
    packageName,
    version: "1.2.3",
    integrity: `sha512-${Buffer.alloc(64, 9).toString("base64")}`,
    repository: "https://github.com/example/package",
    revision: "1".repeat(40),
    ...overrides
  };
}

function createArbitraryProjectFixture() {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-arbitrary-project-"));
  const packageRoot = path.join(repositoryRoot, "submissions", "fixture");
  for (const directory of [
    packageRoot,
    path.join(packageRoot, "game"),
    path.join(packageRoot, "service"),
    path.join(packageRoot, "engine", "src"),
    path.join(packageRoot, "assets")
  ]) fs.mkdirSync(directory, { recursive: true });

  for (const [name, contents] of Object.entries({
    "submission.json": "{}\n",
    "compatibility-report.json": "{}\n",
    "PROPOSAL.md": "# Arbitrary project\n",
    "THREAT_MODEL.md": "# Threat model\n",
    "TEST_PLAN.md": "# Test plan\n",
    "EVIDENCE.md": "# Evidence\n"
  })) fs.writeFileSync(path.join(packageRoot, name), contents);

  fs.writeFileSync(path.join(packageRoot, "game", "scene.ts"), [
    'import "./style.css";',
    'import shader from "./reward.glsl";',
    "export const scene = { shader };"
  ].join("\n"));
  fs.writeFileSync(path.join(packageRoot, "game", "style.css"), ".reward { color: gold; }\n");
  fs.writeFileSync(path.join(packageRoot, "game", "reward.glsl"), "void main() { gl_FragColor = vec4(1.0); }\n");
  fs.writeFileSync(path.join(packageRoot, "service", "main.py"), "def verify_reward():\n    return True\n");
  fs.writeFileSync(path.join(packageRoot, "service", "test_reward.py"), "def test_reward():\n    assert True\n");
  fs.writeFileSync(path.join(packageRoot, "engine", "src", "lib.rs"), "pub fn settle() -> bool { true }\n");
  fs.writeFileSync(path.join(packageRoot, "assets", "sprite.bin"), Buffer.from([0, 255, 1, 2, 3, 4]));
  fs.writeFileSync(path.join(packageRoot, "project-surface.schema.json"), "{\"type\":\"object\"}\n");
  fs.writeFileSync(path.join(packageRoot, "project-surface-evidence.md"), "# Bound project surface evidence\n");

  const prefix = "submissions/fixture";
  const submission = {
    implementation: {
      sourcePaths: [
        `${prefix}/game/scene.ts`,
        `${prefix}/game/style.css`,
        `${prefix}/game/reward.glsl`,
        `${prefix}/service/main.py`,
        `${prefix}/engine/src/lib.rs`,
        `${prefix}/assets/sprite.bin`
      ],
      testPaths: [`${prefix}/service/test_reward.py`]
    },
    integration: {
      appSourcePaths: [`${prefix}/game/scene.ts`],
      integrationTestPaths: [`${prefix}/service/test_reward.py`],
      sdkDependencies: []
    },
    projectSurfaces: [{
      id: "arbitrary-project",
      sourcePaths: [
        `${prefix}/game/scene.ts`,
        `${prefix}/game/style.css`,
        `${prefix}/game/reward.glsl`,
        `${prefix}/service/main.py`,
        `${prefix}/engine/src/lib.rs`,
        `${prefix}/assets/sprite.bin`
      ],
      testPaths: [`${prefix}/service/test_reward.py`],
      schemaPaths: [`${prefix}/project-surface.schema.json`],
      evidencePaths: [`${prefix}/project-surface-evidence.md`]
    }],
    capabilityExtensions: []
  };

  return {
    repositoryRoot,
    packageRoot,
    submission,
    cleanup: () => fs.rmSync(repositoryRoot, { recursive: true, force: true })
  };
}

function initializeGitRepository(directory, { remote = null } = {}) {
  for (const args of [
    ["init", "--quiet"],
    ["add", "."],
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]
  ]) {
    const result = childProcess.spawnSync("git", args, { cwd: directory, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
  }
  if (remote) {
    const result = childProcess.spawnSync("git", ["remote", "add", "origin", remote], {
      cwd: directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(result.status, 0, result.stderr);
  }
}

function runGit(directory, args) {
  const result = childProcess.spawnSync("git", args, { cwd: directory, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createFsmonitorProbe(hookRoot, marker) {
  const hook = path.join(hookRoot, "fsmonitor-probe");
  fs.writeFileSync(hook, [
    "#!/usr/bin/env node",
    'const fs = require("node:fs");',
    `fs.writeFileSync(${JSON.stringify(marker)}, "executed\\n");`,
    'process.stdout.write("token\\n");',
    ""
  ].join("\n"));
  fs.chmodSync(hook, 0o755);
  return hook;
}

function loadDependencyLock() {
  return JSON.parse(
    fs.readFileSync(new URL("../../assets/templates/dependency-lock.example.json", import.meta.url), "utf8")
  );
}

function pinDependencyToCheckout(lock, name, checkout) {
  const dependency = lock.dependencies.find((entry) => entry.name === name);
  dependency.revision = runGit(checkout, ["rev-parse", "HEAD"]);
  dependency.sourceTree = runGit(checkout, ["rev-parse", "HEAD^{tree}"]);
}

function validateLockAgainstTarget(lock, target, repositoryRoot) {
  return validateDependencyLock(lock, target.externalImports, {
    submission: {
      target: {
        solidityVersion: lock.compiler.solidity,
        evmVersion: lock.compiler.evmVersion,
        dependencyBaseline: lock.baseline
      }
    },
    testedBaselineLock: structuredClone(lock),
    importResolutions: target.importResolutions,
    repositoryRoot
  });
}
