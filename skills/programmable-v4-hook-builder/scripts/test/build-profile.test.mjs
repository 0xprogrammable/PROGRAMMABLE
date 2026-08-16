import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BUILD_PROFILE_LIMITS,
  inspectBuildProfiles,
  listBuildProfiles,
  loadBuildProfileCatalog,
  showBuildProfile
} from "../build-profile-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.resolve(testDirectory, "..", "..", "assets", "build-profiles", "catalog.json");
const cliPath = path.resolve(testDirectory, "..", "build-profile.mjs");

function temporaryRepository(t) {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-build-profile-"));
  t.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  return repository;
}

function write(repository, relativePath, contents = "") {
  const absolute = path.join(repository, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
}

function temporaryCatalog(t, transform) {
  const directory = temporaryRepository(t);
  const destination = path.join(directory, "catalog.json");
  const source = fs.readFileSync(catalogPath, "utf8");
  fs.writeFileSync(destination, transform(source));
  return destination;
}

function profile(result, id, projectRoot = ".") {
  return result.profiles.find((candidate) => candidate.id === id && candidate.projectRoot === projectRoot);
}

test("catalog is closed, ordered, digest-bound, and covers supported build families", () => {
  const listed = listBuildProfiles();
  assert.deepEqual(listed.profiles.map(({ id }) => id), [
    "bun",
    "dotnet",
    "foundry",
    "go",
    "hardhat",
    "javascript-monorepo",
    "npm",
    "pnpm",
    "python",
    "rust",
    "unity",
    "yarn"
  ]);
  assert.match(listed.catalogDigest, /^[0-9a-f]{64}$/u);
  assert.match(listed.catalogSha256, /^[0-9a-f]{64}$/u);
  assert.ok(listed.profiles.every(({ profileDigest }) => /^[0-9a-f]{64}$/u.test(profileDigest)));
  assert.equal(showBuildProfile("unity").commandsExecuted, false);
  assert.equal(showBuildProfile("unity").networkAccessed, false);
});

test("detects mixed Foundry and root-bound pnpm workspace profiles", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "foundry.toml", "[profile.default]\n");
  write(repository, "foundry.lock", "{}\n");
  write(repository, "package.json", '{"packageManager":"pnpm@9.15.0","workspaces":["game"]}\n');
  write(repository, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write(repository, "game/package.json", "{}\n");

  const result = inspectBuildProfiles(repository);
  assert.equal(result.overallStatus, "recognized");
  assert.deepEqual(result.profiles.map(({ id, projectRoot }) => `${id}@${projectRoot}`), [
    "foundry@.",
    "javascript-monorepo@.",
    "pnpm@."
  ]);
  assert.equal(result.commandsExecuted, false);
  assert.equal(result.networkAccessed, false);
  assert.equal(result.eligibility, "unchanged");
});

test("an unfamiliar repository remains eligible and enters review", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "moon.build", "custom\n");
  const result = inspectBuildProfiles(repository);
  assert.equal(result.overallStatus, "needs-review");
  assert.deepEqual(result.profiles, []);
  assert.ok(result.findings.some(({ code }) => code === "UNKNOWN_BUILD_SYSTEM"));
  assert.equal(result.eligibility, "unchanged");
});

test("a manifest without its root-bound lock is reviewable rather than rejected", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "Cargo.toml", "[package]\nname='demo'\n");
  const result = inspectBuildProfiles(repository);
  assert.equal(profile(result, "rust").status, "needs-review");
  assert.ok(result.findings.some(({ code, profileId }) => code === "BUILD_LOCK_NOT_FOUND" && profileId === "rust"));
  assert.equal(result.eligibility, "unchanged");
});

test("never pairs a package manifest with another project root's lock", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "app-a/package.json", "{}\n");
  write(repository, "app-b/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  const result = inspectBuildProfiles(repository);
  assert.equal(profile(result, "npm", "app-a").status, "needs-review");
  assert.equal(profile(result, "pnpm", "app-a"), undefined);
  assert.ok(result.profiles.every(({ locks }) => !locks.includes("app-b/pnpm-lock.yaml")));
});

test("keeps independent JavaScript project roots separate", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "app-a/package.json", '{"packageManager":"pnpm@9.0.0"}\n');
  write(repository, "app-a/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write(repository, "app-b/package.json", '{"packageManager":"yarn@4.6.0"}\n');
  write(repository, "app-b/yarn.lock", "# yarn lockfile\n");
  const result = inspectBuildProfiles(repository);
  assert.equal(profile(result, "pnpm", "app-a").status, "recognized");
  assert.equal(profile(result, "yarn", "app-b").status, "recognized");
  assert.equal(profile(result, "yarn", "app-b").yarnGeneration, "modern");
});

test("Hardhat and monorepo markers without their required package root enter review", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "hardhat.config.ts", "export default {};\n");
  write(repository, "nested/turbo.json", "{}\n");
  const result = inspectBuildProfiles(repository);
  assert.equal(profile(result, "hardhat").status, "needs-review");
  assert.equal(profile(result, "javascript-monorepo", "nested").status, "needs-review");
  assert.ok(result.findings.filter(({ code }) => code === "REQUIRED_BUILD_FILE_NOT_FOUND").length >= 2);
});

test("multiple package-manager locks at one root always require review", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "package.json", "{}\n");
  write(repository, "package-lock.json", '{"lockfileVersion":3}\n');
  write(repository, "yarn.lock", "# yarn lockfile\n");
  const result = inspectBuildProfiles(repository);
  assert.equal(result.overallStatus, "needs-review");
  assert.equal(profile(result, "npm").status, "needs-review");
  assert.equal(profile(result, "yarn").status, "needs-review");
  assert.ok(result.findings.some(({ code }) => code === "PACKAGE_MANAGER_CONFLICT"));
});

test("packageManager selects the manager but never replaces its dependency lock", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "package.json", '{"packageManager":"pnpm@9.12.0"}\n');
  const result = inspectBuildProfiles(repository);
  assert.equal(profile(result, "pnpm").status, "needs-review");
  assert.equal(profile(result, "npm"), undefined);
  assert.ok(result.findings.some(({ code, profileId }) => code === "BUILD_LOCK_NOT_FOUND" && profileId === "pnpm"));
});

test("packageManager and lock mismatches are explicit", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "package.json", '{"packageManager":"npm@10.8.0"}\n');
  write(repository, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  const result = inspectBuildProfiles(repository);
  assert.equal(result.overallStatus, "needs-review");
  assert.ok(result.findings.some(({ code }) => code === "PACKAGE_MANAGER_DECLARATION_MISMATCH"));
  assert.equal(profile(result, "npm").status, "needs-review");
  assert.equal(profile(result, "pnpm").status, "needs-review");
});

test("Yarn suggestions are generation-specific and install-script-safe", async (t) => {
  for (const [generation, version, expected] of [
    ["classic", "1.22.22", ["yarn", "install", "--frozen-lockfile", "--ignore-scripts"]],
    ["modern", "4.6.0", ["yarn", "install", "--immutable", "--mode=skip-build"]]
  ]) {
    await t.test(generation, (child) => {
      const repository = temporaryRepository(child);
      write(repository, "package.json", JSON.stringify({ packageManager: `yarn@${version}` }));
      write(repository, "yarn.lock", "# yarn lockfile\n");
      const match = profile(inspectBuildProfiles(repository), "yarn");
      assert.equal(match.status, "recognized");
      assert.equal(match.yarnGeneration, generation);
      assert.deepEqual(match.suggestedChecks.find(({ id }) => id.includes("install")).argv, expected);
      assert.equal(match.suggestedChecks.filter(({ id }) => id.includes("install")).length, 1);
    });
  }
});

test("unresolved Yarn generation omits install guidance and enters review", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "package.json", "{}\n");
  write(repository, "yarn.lock", "# yarn lockfile\n");
  const result = inspectBuildProfiles(repository);
  const yarn = profile(result, "yarn");
  assert.equal(yarn.status, "needs-review");
  assert.equal(yarn.yarnGeneration, null);
  assert.ok(yarn.suggestedChecks.every(({ id }) => !id.includes("install")));
  assert.ok(result.findings.some(({ code }) => code === "YARN_GENERATION_UNRESOLVED"));
});

test("Unity requires manifest, dependency lock, and a parseable pinned editor version", async (t) => {
  await t.test("missing editor version", (child) => {
    const repository = temporaryRepository(child);
    write(repository, "Packages/manifest.json", "{}\n");
    write(repository, "Packages/packages-lock.json", "{}\n");
    const result = inspectBuildProfiles(repository);
    assert.equal(profile(result, "unity").status, "needs-review");
    assert.ok(result.findings.some(({ code }) => code === "REQUIRED_BUILD_FILE_NOT_FOUND"));
  });
  await t.test("malformed editor version", (child) => {
    const repository = temporaryRepository(child);
    write(repository, "Packages/manifest.json", "{}\n");
    write(repository, "Packages/packages-lock.json", "{}\n");
    write(repository, "ProjectSettings/ProjectVersion.txt", "m_EditorVersion: latest\n");
    const result = inspectBuildProfiles(repository);
    assert.equal(profile(result, "unity").status, "needs-review");
    assert.ok(result.findings.some(({ code }) => code === "UNITY_EDITOR_VERSION_INVALID"));
  });
  await t.test("complete pinned project", (child) => {
    const repository = temporaryRepository(child);
    write(repository, "Packages/manifest.json", "{}\n");
    write(repository, "Packages/packages-lock.json", "{}\n");
    write(repository, "ProjectSettings/ProjectVersion.txt", "m_EditorVersion: 6000.0.32f1\n");
    const result = inspectBuildProfiles(repository);
    assert.equal(profile(result, "unity").status, "recognized");
    assert.deepEqual(profile(result, "unity").pins, [{ id: "unity-editor-version", value: "6000.0.32f1" }]);
  });
});

test("depth cutoffs are visible and prevent a false recognized result", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "foundry.toml", "[profile.default]\n");
  write(repository, "foundry.lock", "{}\n");
  write(repository, "a/b/c/d/e/custom.build", "custom\n");
  const result = inspectBuildProfiles(repository);
  assert.equal(profile(result, "foundry").status, "recognized");
  assert.equal(result.overallStatus, "needs-review");
  assert.ok(result.scan.depthCutoffs > 0);
  assert.equal(result.scan.limitReached, true);
  assert.ok(result.findings.some(({ code }) => code === "SCAN_BOUND_REACHED"));
});

test("entry limit exhaustion is explicit", (t) => {
  const repository = temporaryRepository(t);
  for (let index = 0; index <= BUILD_PROFILE_LIMITS.maximumEntries; index += 1) {
    write(repository, `entry-${String(index).padStart(5, "0")}.txt`, "");
  }
  const result = inspectBuildProfiles(repository);
  assert.equal(result.scan.entryLimitReached, true);
  assert.equal(result.scan.limitReached, true);
  assert.equal(result.scan.entriesInspected, BUILD_PROFILE_LIMITS.maximumEntries);
});

test("symlinks and invisible Unicode names are skipped and disclosed", (t) => {
  const repository = temporaryRepository(t);
  write(repository, "target.txt", "safe\n");
  fs.symlinkSync(path.join(repository, "target.txt"), path.join(repository, "link.txt"));
  write(repository, "bad\u202efile", "hidden\n");
  const result = inspectBuildProfiles(repository);
  assert.equal(result.scan.symlinksSkipped, 1);
  assert.equal(result.scan.unsafeNamesSkipped, 1);
  assert.ok(result.findings.some(({ code }) => code === "SYMLINKS_SKIPPED"));
  assert.ok(result.findings.some(({ code }) => code === "UNSAFE_PATH_SKIPPED"));
});

test("profile and path ordering uses raw UTF-8 bytes deterministically", (t) => {
  const repository = temporaryRepository(t);
  for (const root of ["z", "é"]) {
    write(repository, `${root}/Cargo.toml`, "[package]\nname='demo'\n");
    write(repository, `${root}/Cargo.lock`, "");
  }
  const first = inspectBuildProfiles(repository);
  const second = inspectBuildProfiles(repository);
  assert.deepEqual(first, second);
  const roots = first.profiles.filter(({ id }) => id === "rust").map(({ projectRoot }) => projectRoot);
  assert.deepEqual(roots, [...roots].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))));
});

test("catalog rejects unknown fields, unsafe Unicode, unsafe paths, reordered profiles, and duplicate keys", async (t) => {
  const cases = [
    ["unknown field", (source) => {
      const catalog = JSON.parse(source);
      catalog.unexpected = true;
      return JSON.stringify(catalog);
    }],
    ["unsafe label", (source) => {
      const catalog = JSON.parse(source);
      catalog.profiles[0].label = "Bun\u202eevil";
      return JSON.stringify(catalog);
    }],
    ["unsafe path", (source) => {
      const catalog = JSON.parse(source);
      catalog.profiles[0].detection.rootMarkersAny = ["../outside"];
      return JSON.stringify(catalog);
    }],
    ["reordered profile", (source) => {
      const catalog = JSON.parse(source);
      [catalog.profiles[0], catalog.profiles[1]] = [catalog.profiles[1], catalog.profiles[0]];
      return JSON.stringify(catalog);
    }],
    ["duplicate key", (source) => source.replace('{\n  "schemaVersion": "1.0.0",', '{\n  "schemaVersion": "1.0.0",\n  "schemaVersion": "1.0.0",')]
  ];
  for (const [name, transform] of cases) {
    await t.test(name, (child) => {
      const mutated = temporaryCatalog(child, transform);
      assert.throws(() => loadBuildProfileCatalog(mutated));
    });
  }
});

test("semantic and raw catalog digests distinguish content from formatting", async (t) => {
  const original = loadBuildProfileCatalog();
  await t.test("safe semantic change", (child) => {
    const mutatedPath = temporaryCatalog(child, (source) => {
      const catalog = JSON.parse(source);
      catalog.profiles[0].label = "Bun projects";
      return JSON.stringify(catalog);
    });
    const mutated = loadBuildProfileCatalog(mutatedPath);
    assert.notEqual(mutated.catalogDigest, original.catalogDigest);
    assert.notEqual(mutated.profiles[0].profileDigest, original.profiles[0].profileDigest);
  });
  await t.test("format-only change", (child) => {
    const mutated = loadBuildProfileCatalog(temporaryCatalog(child, (source) => `${source} `));
    assert.equal(mutated.catalogDigest, original.catalogDigest);
    assert.notEqual(mutated.catalogSha256, original.catalogSha256);
  });
});

test("detection never executes project commands or install hooks", (t) => {
  const repository = temporaryRepository(t);
  const marker = path.join(repository, "executed.txt");
  write(repository, "package.json", JSON.stringify({
    packageManager: "npm@10.8.0",
    scripts: { postinstall: `touch ${marker}` }
  }));
  write(repository, "package-lock.json", '{"lockfileVersion":3}\n');
  const result = inspectBuildProfiles(repository);
  assert.equal(result.commandsExecuted, false);
  assert.equal(result.networkAccessed, false);
  assert.equal(fs.existsSync(marker), false);

  const source = fs.readFileSync(path.resolve(testDirectory, "..", "build-profile-core.mjs"), "utf8");
  assert.doesNotMatch(source, /node:child_process|\bfetch\s*\(|\bspawn\s*\(|\bexecFile\s*\(|node:https?|node:net/u);
});

test("CLI emits canonical JSON errors on stdout and nothing on stderr", (t) => {
  const repository = temporaryRepository(t);
  const usage = spawnSync(process.execPath, [cliPath, "invalid"], { encoding: "utf8" });
  assert.equal(usage.status, 2);
  assert.equal(usage.stderr, "");
  assert.equal(JSON.parse(usage.stdout).error.code, "USAGE_ERROR");
  assert.equal(`${JSON.stringify(JSON.parse(usage.stdout))}\n`, usage.stdout);

  const runtime = spawnSync(process.execPath, [cliPath, "show", "not-a-profile"], { encoding: "utf8" });
  assert.equal(runtime.status, 1);
  assert.equal(runtime.stderr, "");
  assert.equal(JSON.parse(runtime.stdout).error.code, "BUILD_PROFILE_FAILED");

  const success = spawnSync(process.execPath, [cliPath, "detect", "--repository-root", repository], { encoding: "utf8" });
  assert.equal(success.status, 0);
  assert.equal(success.stderr, "");
  assert.equal(JSON.parse(success.stdout).commandsExecuted, false);
});
