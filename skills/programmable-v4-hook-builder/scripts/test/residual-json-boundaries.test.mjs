import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadDeploymentSnapshot } from "../deployment-core.mjs";
import { materializeExample } from "../example-materializer-core.mjs";
import { loadKnowledgeRouting } from "../knowledge-router-core.mjs";
import { extractPublicClaimText } from "../public-claims-core.mjs";
import { parseJsonOutput } from "../cli-runtime.mjs";
import { snapshotLocalDraftPackage } from "../cli-local-draft.mjs";
import { loadTemplateCatalog } from "../template-catalog-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptsDirectory = path.resolve(testDirectory, "..");
const skillRoot = path.resolve(scriptsDirectory, "..");
const secret = "never-echo-this-secret-value";
const duplicateDocuments = Object.freeze([
  `{"schemaVersion":1,"schemaVersion":1,"privateKey":"${secret}"}`,
  `{"schemaVersion":1,"schemaVersion":2,"privateKey":"${secret}"}`,
  `{"schemaVersion":1,"schema\\u0056ersion":2,"privateKey":"${secret}"}`
]);

test("public JSON claim extraction and bundled-command output reject every decoded duplicate-key form", () => {
  for (const source of duplicateDocuments) {
    assert.equal(extractPublicClaimText(source, ".json"), "");
    assert.equal(parseJsonOutput(source), null);
    assert.equal(parseJsonOutput(Buffer.from(source, "utf8")), null);
  }
  assert.equal(parseJsonOutput(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d])), null);
});

test("deployment, knowledge, example and catalog loaders reject duplicate keys before semantics", () => {
  for (const source of duplicateDocuments) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-residual-json-loaders-"));
    try {
      const deploymentPath = path.join(root, "deployment.json");
      fs.writeFileSync(deploymentPath, source);
      assertRejectsDuplicate(() => loadDeploymentSnapshot(deploymentPath));

      fs.mkdirSync(path.join(root, "references"));
      fs.writeFileSync(path.join(root, "references", "knowledge-routing.json"), source);
      assertRejectsDuplicate(() => loadKnowledgeRouting({ skillRoot: root }));

      fs.mkdirSync(path.join(root, "assets", "examples"), { recursive: true });
      fs.writeFileSync(path.join(root, "assets", "examples", "duplicate.json"), source);
      assertRejectsDuplicate(() => materializeExample({ skillRoot: root, exampleId: "duplicate" }));

      const catalogRoot = path.join(root, "catalog");
      fs.mkdirSync(catalogRoot);
      fs.writeFileSync(path.join(catalogRoot, "catalog.json"), source);
      assertRejectsDuplicate(() => loadTemplateCatalog({ catalogDirectory: catalogRoot }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("both review-target CLIs reject duplicate submission keys without output or writes", () => {
  for (const source of duplicateDocuments) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-residual-json-review-"));
    try {
      const initialized = childProcess.spawnSync("git", ["init", "-q", root], { encoding: "utf8", shell: false });
      assert.equal(initialized.status, 0, initialized.stderr);
      const packageRoot = path.join(root, "submissions", "duplicate");
      fs.mkdirSync(packageRoot, { recursive: true });
      fs.writeFileSync(path.join(packageRoot, "submission.json"), source);
      const outputPath = path.join(root, "duplicate-review-target.json");

      const legacy = childProcess.spawnSync(process.execPath, [
        path.join(scriptsDirectory, "build-review-target.mjs"),
        "--repository-root",
        root,
        packageRoot,
        "--write",
        outputPath
      ], { encoding: "utf8", shell: false });
      assert.equal(legacy.status, 2, legacy.stdout || legacy.stderr);
      assert.equal(legacy.stdout, "");
      assert.equal(fs.existsSync(outputPath), false);
      assert.equal(`${legacy.stdout}${legacy.stderr}`.includes(secret), false);

      const current = childProcess.spawnSync(process.execPath, [
        path.join(scriptsDirectory, "cli-review-target.mjs"),
        root,
        "submissions/duplicate"
      ], { encoding: "utf8", shell: false });
      assert.equal(current.status, 2, current.stdout || current.stderr);
      assert.equal(current.stdout, "");
      assert.equal(`${current.stdout}${current.stderr}`.includes(secret), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("local central-draft snapshot rejects duplicate application keys before package semantics", () => {
  for (const source of duplicateDocuments) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-residual-json-draft-"));
    try {
      fs.writeFileSync(path.join(root, "application.json"), source);
      fs.writeFileSync(path.join(root, "PROPOSAL.md"), "# Proposal\nA substantive proposal body that is intentionally never reached.\n");
      fs.writeFileSync(path.join(root, "TEST_PLAN.md"), "# Test plan\nA substantive test plan body that is intentionally never reached.\n");
      fs.writeFileSync(path.join(root, "THREAT_MODEL.md"), "# Threat model\nA substantive threat model body that is intentionally never reached.\n");
      fs.writeFileSync(path.join(root, "compatibility-report.json"), "{}\n");
      fs.writeFileSync(path.join(root, "evidence-index.json"), "{}\n");
      const identity = fs.lstatSync(root);
      assert.throws(
        () => snapshotLocalDraftPackage({
          targetDirectory: root,
          applicationId: "duplicate",
          expectedDirectoryIdentity: { dev: identity.dev, ino: identity.ino }
        }),
        (error) => {
          assert.equal(error?.code, "OUTPUT_DRAFT_INVALID");
          assert.equal(String(error?.message).includes(secret), false);
          return true;
        }
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("schema generator rejects duplicate repository JSON and never rewrites it", () => {
  for (const source of duplicateDocuments) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-residual-json-schema-"));
    try {
      const copiedScripts = path.join(root, "scripts");
      const references = path.join(root, "references");
      fs.mkdirSync(copiedScripts);
      fs.mkdirSync(references);
      for (const name of ["generate-public-pr-application-schema.mjs", "strict-json-core.mjs"]) {
        fs.copyFileSync(path.join(scriptsDirectory, name), path.join(copiedScripts, name));
      }
      const applicationPath = path.join(references, "public-pr-application.schema.json");
      fs.writeFileSync(applicationPath, source);
      fs.copyFileSync(
        path.join(skillRoot, "references", "github-public-source-contract-v1.schema.json"),
        path.join(references, "github-public-source-contract-v1.schema.json")
      );

      const result = childProcess.spawnSync(process.execPath, [
        fs.realpathSync(path.join(copiedScripts, "generate-public-pr-application-schema.mjs")),
        "--check"
      ], { encoding: "utf8", shell: false });
      assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
      assert.equal(fs.readFileSync(applicationPath, "utf8"), source);
      assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

function assertRejectsDuplicate(implementation) {
  assert.throws(implementation, (error) => {
    assert.equal(String(error?.message ?? error).includes(secret), false);
    return true;
  });
}
