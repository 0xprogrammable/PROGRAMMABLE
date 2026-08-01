import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  MAINTAINED_LEGACY_PACKAGE_TIMEOUT_MS,
  MAXIMUM_MAINTAINED_LEGACY_PACKAGES,
  PUBLIC_APPLICATION_FILES,
  PublicIntakeError,
  inspectMaintainedSubmissions,
  verifyMaintainedSubmissions
} from "../verify-public-hook-application-core.mjs";

test("the trusted post-merge command accepts 129 closed application directories", (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  for (let index = 0; index < 129; index += 1) {
    writeClosedApplication(repositoryRoot, `application-${String(index).padStart(3, "0")}`);
  }

  const result = childProcess.spawnSync(
    process.execPath,
    [
      path.resolve("scripts/verify-public-hook-application.mjs"),
      "--verify-maintained",
      "--repository-root",
      repositoryRoot
    ],
    { encoding: "utf8", shell: false }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    result: "valid-maintained-submissions",
    applicationCount: 129,
    legacyPackageCount: 0,
    validatedLegacyPackages: []
  });
});

test("application growth does not consume the bounded legacy validation budget", async (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  for (let index = 0; index < 129; index += 1) {
    writeClosedApplication(repositoryRoot, `application-${String(index).padStart(3, "0")}`);
  }
  for (let index = 0; index < MAXIMUM_MAINTAINED_LEGACY_PACKAGES; index += 1) {
    writeLegacyPackage(repositoryRoot, `legacy-${String(index).padStart(3, "0")}`);
  }

  const validated = [];
  const report = await verifyMaintainedSubmissions({
    repositoryRoot,
    validateLegacyPackage: async ({ packageName, packageRoot }) => {
      assert.equal(packageRoot, path.join(repositoryRoot, "submissions", packageName));
      validated.push(packageName);
    }
  });

  assert.equal(MAINTAINED_LEGACY_PACKAGE_TIMEOUT_MS, 120_000);
  assert.equal(report.applicationCount, 129);
  assert.equal(report.legacyPackageCount, MAXIMUM_MAINTAINED_LEGACY_PACKAGES);
  assert.deepEqual(report.validatedLegacyPackages, validated);
  assert.deepEqual(
    validated,
    Array.from(
      { length: MAXIMUM_MAINTAINED_LEGACY_PACKAGES },
      (_, index) => `legacy-${String(index).padStart(3, "0")}`
    )
  );
});

test("too many legacy packages fail before any package validator is invoked", async (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  for (let index = 0; index <= MAXIMUM_MAINTAINED_LEGACY_PACKAGES; index += 1) {
    writeLegacyPackage(repositoryRoot, `legacy-${String(index).padStart(3, "0")}`);
  }
  let validations = 0;

  await assert.rejects(
    () => verifyMaintainedSubmissions({
      repositoryRoot,
      validateLegacyPackage: async () => {
        validations += 1;
      }
    }),
    hasCode("MAINTAINED_LEGACY_PACKAGE_LIMIT_EXCEEDED")
  );
  assert.equal(validations, 0);
});

test("maintained applications remain closed regular-file packages", (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  writeClosedApplication(repositoryRoot, "extra-file");
  fs.writeFileSync(
    path.join(repositoryRoot, "submissions", "extra-file", "postinstall.js"),
    "throw new Error('must remain inert');\n"
  );
  assert.throws(
    () => inspectMaintainedSubmissions({ repositoryRoot }),
    hasCode("MAINTAINED_APPLICATION_PACKAGE_NOT_CLOSED")
  );
});

test("maintained application symlinks cannot bypass the closed-package inventory", (t) => {
  const repositoryRoot = createRepositoryFixture(t);
  writeClosedApplication(repositoryRoot, "linked-manifest");
  const packageRoot = path.join(repositoryRoot, "submissions", "linked-manifest");
  fs.unlinkSync(path.join(packageRoot, "application.json"));
  fs.symlinkSync("PROPOSAL.md", path.join(packageRoot, "application.json"));
  assert.throws(
    () => inspectMaintainedSubmissions({ repositoryRoot }),
    hasCode("MAINTAINED_APPLICATION_FILE_INVALID")
  );
});

function createRepositoryFixture(t) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maintained-submissions-test-"));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  const submissionRoot = path.join(repositoryRoot, "submissions");
  fs.mkdirSync(submissionRoot);
  fs.writeFileSync(path.join(submissionRoot, "README.md"), "trusted maintained intake\n");
  return repositoryRoot;
}

function writeClosedApplication(repositoryRoot, applicationId) {
  const packageRoot = path.join(repositoryRoot, "submissions", applicationId);
  fs.mkdirSync(packageRoot);
  for (const fileName of PUBLIC_APPLICATION_FILES) {
    fs.writeFileSync(path.join(packageRoot, fileName), `${fileName} fixture\n`);
  }
}

function writeLegacyPackage(repositoryRoot, packageName) {
  const packageRoot = path.join(repositoryRoot, "submissions", packageName);
  fs.mkdirSync(packageRoot);
  fs.writeFileSync(path.join(packageRoot, "submission.json"), "{}\n");
}

function hasCode(code) {
  return (error) => error instanceof PublicIntakeError && error.code === code;
}
