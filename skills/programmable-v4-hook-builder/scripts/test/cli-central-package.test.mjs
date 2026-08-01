import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCentralApplicationPackage } from "../cli-central-package.mjs";
import { materializeExample } from "../example-materializer-core.mjs";
import { analyzeSubmission } from "../submission-core.mjs";
import { validatePublicApplicationPackageFiles } from "../../../../scripts/verify-public-hook-application-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const submissionSchema = JSON.parse(
  fs.readFileSync(path.join(skillRoot, "references", "submission.schema.json"), "utf8")
);

test("official analyzer output cannot legitimately generate public prototype-ready before maintainer gates", () => {
  const submission = materializeExample({
    skillRoot,
    exampleId: "dynamic-lp-fee"
  });
  const localReport = analyzeSubmission(submission, { schema: submissionSchema });
  assert.equal(localReport.decision, "PROTOTYPE_READY", JSON.stringify(localReport.findings));
  assert.ok(localReport.requiredGates.some(({ id, stage }) => (
    id === "human-economic-and-security-review" && stage === "candidate"
  )));

  const central = buildFixture(localReport, {
    completedGateIds: localReport.requiredGates
      .filter(({ stage }) => stage === "prototype")
      .map(({ id }) => id)
  });
  const validated = validateCentral(central);

  assert.equal(validated.compatibility.result, "architecture-review-required");
  assert.notEqual(validated.compatibility.result, "prototype-ready");
  assert.ok(validated.compatibility.findings.some(({ path: findingPath }) => (
    findingPath === "$.requiredGates.candidate.human-economic-and-security-review"
  )));
});

test("a manual candidate gate survives central projection as architecture review", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    findings: [],
    requiredGates: [
      { id: "static-analysis", stage: "prototype", reason: "Static analysis is required." },
      {
        id: "human-economic-and-security-review",
        stage: "candidate",
        reason: "Automation cannot accept its own output."
      }
    ]
  };
  const central = buildFixture(localReport, {
    completedGateIds: ["static-analysis"]
  });
  const validated = validateCentral(central);

  assert.equal(validated.compatibility.result, "architecture-review-required");
  assert.deepEqual(
    validated.compatibility.findings.map(({ code, path }) => ({ code, path })),
    [{
      code: "REQUIRED_REVIEW_GATE",
      path: "$.requiredGates.candidate.human-economic-and-security-review"
    }]
  );
  assert.equal(validated.evidenceIndex.evidence[0].status, "blocked");
});

test("unknown language proposals survive central projection as architecture review", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    findings: [{
      severity: "warning",
      code: "DECLARED_FILE_TOOLING_REVIEW_REQUIRED",
      path: "$.implementation.sourcePaths[1]",
      message: "service/settlement.py is byte-bound but has no deterministic dependency scanner.",
      remediation: "Add a pinned language scanner or an attributable manual review for the exact file."
    }],
    requiredGates: [{
      id: "declared-file-tooling-or-manual-review",
      stage: "candidate",
      reason: "The declared Python source needs supported tooling or attributable manual review."
    }]
  };
  const central = buildFixture(localReport, { stage: "proposal" });
  const validated = validateCentral(central);

  assert.equal(validated.compatibility.result, "architecture-review-required");
  assert.deepEqual(
    validated.compatibility.findings.map(({ code }) => code),
    ["DECLARED_FILE_TOOLING_REVIEW_REQUIRED", "REQUIRED_REVIEW_GATE"]
  );
  assert.equal(validated.evidenceIndex.evidence[0].status, "blocked");
});

test("a proposal companion remains visible as explicit closure architecture review", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    closure: { status: "complete", diagnostics: [] },
    findings: [],
    requiredGates: []
  };
  const reviewTarget = {
    closure: {
      status: "incomplete",
      diagnostics: [{
        code: "COMPANION_CLOSURE_REVIEW_REQUIRED",
        detail: "The exact companion revision is bound, but its semantic dependency and build closure is not proven.",
        path: ".programmable/companions/game-server.json"
      }]
    }
  };
  const central = buildFixture(localReport, { stage: "proposal", reviewTarget });
  const validated = validateCentral(central);

  assert.equal(validated.compatibility.result, "architecture-review-required");
  assert.ok(validated.compatibility.findings.some(({ code }) => code === "COMPANION_CLOSURE_REVIEW_REQUIRED"));
  assert.ok(validated.compatibility.findings.some(({ path }) => path.includes("review-target-closure-architecture-review")));
});

test("a non-Mainnet application projects to architecture review rather than changes required", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    findings: [{
      severity: "warning",
      code: "PROGRAMMABLE_PLATFORM_CHAIN_NOT_CURRENTLY_INTEGRATED",
      path: "$.target.chainId",
      message: "Base is application-eligible, but the current Programmable launch runtime is Ethereum Mainnet-only.",
      remediation: "Continue review without a launch claim and wait for a maintainer-owned chain integration release."
    }],
    requiredGates: [{
      id: "programmable-platform-target-chain-integration",
      stage: "release",
      reason: "The exact target chain must be integrated and released before launch."
    }]
  };
  const central = buildFixture(localReport);
  const validated = validateCentral(central);

  assert.equal(validated.compatibility.result, "architecture-review-required");
  assert.equal(validated.compatibility.result === "changes-required", false);
  assert.ok(validated.compatibility.findings.some(({ code }) => code === "PROGRAMMABLE_PLATFORM_CHAIN_NOT_CURRENTLY_INTEGRATED"));
  assert.equal(validated.evidenceIndex.evidence[0].status, "blocked");
});

function buildFixture(localReport, { completedGateIds = [], reviewTarget = null, stage = "prototype" } = {}) {
  const applicationId = "central-model";
  const packagePath = `submissions/${applicationId}`;
  const gateStatusPath = `${packagePath}/evidence/gate-status.json`;
  const compatibilityPath = `${packagePath}/compatibility-report.json`;
  const revisionObjectId = "a".repeat(40);
  const treeObjectId = "b".repeat(40);
  const source = {
    schemaVersion: "1.0.0",
    primary: {
      repositoryUri: "https://github.com/example/central-model",
      numericRepositoryId: "123456789",
      revisionObjectId,
      treeObjectId,
      sourcePaths: [compatibilityPath, gateStatusPath].sort(),
      contractPaths: [],
      githubActionsRunIds: []
    },
    companions: []
  };
  const headFiles = new Map([
    [`${packagePath}/PROPOSAL.md`, markdown("Proposal")],
    [`${packagePath}/TEST_PLAN.md`, markdown("Test plan")],
    [`${packagePath}/THREAT_MODEL.md`, markdown("Threat model")],
    [compatibilityPath, jsonBytes(localReport)],
    [gateStatusPath, jsonBytes({
      schemaVersion: 1,
      gates: completedGateIds.map((id) => ({ id, status: "completed", evidence: [] }))
    })]
  ]);
  return buildCentralApplicationPackage({
    packagePath,
    applicationRevision: 1,
    builderIdentity: {
      githubUserId: "9007199254740993",
      githubLogin: "example-builder",
      profileUrl: "https://github.com/example-builder"
    },
    submission: {
      stage,
      model: {
        id: applicationId,
        name: "Central Model",
        summary: "A deterministic central compatibility projection fixture."
      },
      builder: { github: "example-builder", contact: "@example-builder" },
      implementation: { gateStatusPath }
    },
    source,
    packageResult: { preflightDecision: localReport.decision },
    reviewTarget,
    headFiles
  });
}

function validateCentral(central) {
  const packageFiles = new Map(
    central.files.map(({ path, content }) => [path, Buffer.from(content, "utf8")])
  );
  return validatePublicApplicationPackageFiles({
    applicationId: "central-model",
    packageFiles
  });
}

function markdown(title) {
  return Buffer.from(`# ${title}\nThis exact-revision fixture contains a substantive bounded review body for validation.\n`);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}
