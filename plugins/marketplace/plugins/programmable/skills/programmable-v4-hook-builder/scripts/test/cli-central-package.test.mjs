import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCentralApplicationPackage } from "../cli-central-package.mjs";
import { materializeExample } from "../example-materializer-core.mjs";
import { analyzeSubmission, canonicalJson } from "../submission-core.mjs";
import { builderTemplateFromPlan } from "../builder-template-contract.mjs";
import { composeTemplate, loadTemplateCatalog } from "../template-catalog-core.mjs";

const trustedHostValidatorUrl = new URL("../../../../scripts/verify-public-hook-application-core.mjs", import.meta.url);
const trustedHostValidator = fs.existsSync(fileURLToPath(trustedHostValidatorUrl))
  ? await import(trustedHostValidatorUrl.href)
  : null;
const validatePublicApplicationPackageFiles = trustedHostValidator?.validatePublicApplicationPackageFiles;
const trustedHostSkipReason = "trusted host validator unavailable outside the canonical repository";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const submissionSchema = JSON.parse(
  fs.readFileSync(path.join(skillRoot, "references", "submission.schema.json"), "utf8")
);
const templateCatalog = loadTemplateCatalog({ skillRoot });

function trustedHostTest(name, implementation) {
  return test(name, { skip: trustedHostValidator ? false : trustedHostSkipReason }, implementation);
}

trustedHostTest("official analyzer output cannot project a pending platform-fee integration as ready", () => {
  const submission = materializeExample({
    skillRoot,
    exampleId: "dynamic-lp-fee"
  });
  const localReport = analyzeSubmission(submission, { schema: submissionSchema });
  assert.equal(localReport.decision, "REDESIGN_REQUIRED", JSON.stringify(localReport.findings));
  assert.ok(localReport.findings.some(({ code }) => code === "PROGRAMMABLE_FEE_INTEGRATION_PENDING"));

  const central = buildFixture(localReport, {
    completedGateIds: localReport.requiredGates
      .filter(({ stage }) => stage === "prototype")
      .map(({ id }) => id)
  });
  const validated = validateCentral(central);

  assert.equal(validated.compatibility.result, "changes-required");
  assert.notEqual(validated.compatibility.result, "prototype-ready");
  assert.ok(validated.compatibility.findings.some(({ code }) => code === "PROGRAMMABLE_FEE_INTEGRATION_PENDING"));
  assert.deepEqual(validated.application.builderTemplate, {
    schemaVersion: "1.0.0",
    source: "manual",
    templateSelection: null
  });
  assert.equal(validated.application.programmableFee.policyVersion, "1.1.0");
  assert.deepEqual(
    {
      roundingPolicy: validated.application.programmableFee.accounting.roundingPolicy,
      remainderScope: validated.application.programmableFee.accounting.remainderScope,
      claimResetsRemainders: validated.application.programmableFee.accounting.claimResetsRemainders,
      minimumGrossQuoteUnits: validated.application.programmableFee.accounting.minimumGrossQuoteUnits,
      fragmentationResistant: validated.application.programmableFee.accounting.fragmentationResistant
    },
    {
      roundingPolicy: "cumulative-independent-platform-project-remainders",
      remainderScope: "canonical-pool-lifetime",
      claimResetsRemainders: false,
      minimumGrossQuoteUnits: 1000,
      fragmentationResistant: true
    }
  );
});

trustedHostTest("a manual candidate gate survives central projection as architecture review", () => {
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
    [
      {
        code: "PROGRAMMABLE_FEE_CONFORMANCE_EVIDENCE_MISSING",
        path: "$.implementation.feeConformanceManifestPath"
      },
      {
        code: "REQUIRED_REVIEW_GATE",
        path: "$.requiredGates.candidate.custom-programmable-fee-review"
      },
      {
        code: "REQUIRED_REVIEW_GATE",
        path: "$.requiredGates.candidate.human-economic-and-security-review"
      }
    ]
  );
  assert.equal(validated.evidenceIndex.evidence[0].status, "blocked");
});

trustedHostTest("unknown language proposals survive central projection as architecture review", () => {
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

trustedHostTest("a proposal companion remains visible as explicit closure architecture review", () => {
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

trustedHostTest("a non-Mainnet application projects to architecture review rather than changes required", () => {
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

test("prototype central projection fails closed when exact source workflow evidence is absent", () => {
  const central = buildFixture({
    decision: "PROTOTYPE_READY",
    findings: [],
    requiredGates: []
  }, {
    githubActionsRunIds: []
  });
  const compatibility = centralJson(central, "compatibility-report.json");

  assert.equal(central.compatibilityResult, "tooling-blocked");
  assert.ok(compatibility.findings.some(({ code }) => code === "SOURCE_WORKFLOW_EVIDENCE_MISSING"));
  assert.ok(compatibility.findings.some(({ path }) => path.includes("source-workflow-evidence")));
});

test("custom fee implementation without the standard receipt stays eligible for human review", () => {
  const central = buildFixture({
    decision: "PROTOTYPE_READY",
    findings: [],
    requiredGates: []
  });
  const compatibility = centralJson(central, "compatibility-report.json");

  assert.equal(central.compatibilityResult, "architecture-review-required");
  assert.notEqual(central.compatibilityResult, "tooling-blocked");
  assert.ok(compatibility.findings.some(({ code }) => code === "PROGRAMMABLE_FEE_CONFORMANCE_EVIDENCE_MISSING"));
  assert.ok(compatibility.findings.some(({ path }) => path.includes("custom-programmable-fee-review")));
});

test("central projection rejects decoded duplicate keys in every committed JSON input before semantics", () => {
  const secret = "central-package-private-key-must-not-echo";
  const cases = [
    {
      relativePath: "submission.json",
      variants: [
        `"standardVersion":"1.6.0","privateKey":"${secret}"`,
        `"standardVersion":"9.9.9","privateKey":"${secret}"`,
        `"standardVersi\\u006fn":"9.9.9","privateKey":"${secret}"`
      ]
    },
    {
      relativePath: "compatibility-report.json",
      variants: [
        `"decision":"PROTOTYPE_READY","privateKey":"${secret}"`,
        `"decision":"REDESIGN_REQUIRED","privateKey":"${secret}"`,
        `"decisi\\u006fn":"REDESIGN_REQUIRED","privateKey":"${secret}"`
      ]
    },
    {
      relativePath: "evidence/gate-status.json",
      variants: [
        `"gates":[],"privateKey":"${secret}"`,
        `"gates":[{"id":"shadow"}],"privateKey":"${secret}"`,
        `"gat\\u0065s":[{"id":"shadow"}],"privateKey":"${secret}"`
      ]
    }
  ];

  for (const { relativePath, variants } of cases) {
    for (const duplicate of variants) {
      assert.throws(
        () => buildFixture({ decision: "PROTOTYPE_READY", findings: [], requiredGates: [] }, {
          mutateHeadFiles(headFiles, packagePath) {
            const target = `${packagePath}/${relativePath}`;
            const source = headFiles.get(target).toString("utf8").trimEnd();
            headFiles.set(target, Buffer.from(`${source.slice(0, -1)},${duplicate}}\n`));
          }
        }),
        (error) => {
          assert.equal(error?.code, "CENTRAL_PACKAGE_INVALID");
          assert.equal(String(error?.message).includes(secret), false);
          return true;
        }
      );
    }
  }
});

trustedHostTest("central projection rejects default-ignorable Unicode but preserves legitimate non-Latin text", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    findings: [],
    requiredGates: [{
      id: "human-economic-and-security-review",
      stage: "candidate",
      reason: "Automation cannot accept its own output."
    }]
  };
  for (const character of ["\u034f", "\ufe0f", "\u{e0001}"]) {
    assert.throws(
      () => buildFixture(localReport, {
        mutateSubmission(submission) {
          submission.model.name = `Central${character}Model`;
        }
      }),
      (error) => error?.code === "CENTRAL_PACKAGE_INVALID"
    );
  }
  const central = buildFixture(localReport, {
    mutateSubmission(submission) {
      submission.model.name = "日本語モデル";
    }
  });
  assert.equal(validateCentral(central).application.title, "日本語モデル");
});

trustedHostTest("central projection preserves the exact catalog selection, packs, custom capabilities and local tags", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    findings: [],
    requiredGates: [{
      id: "human-economic-and-security-review",
      stage: "candidate",
      reason: "Automation cannot accept its own output."
    }]
  };
  const builderTemplate = catalogBuilderTemplate();
  const central = buildFixture(localReport, { builderTemplate });
  assert.deepEqual(validateCentral(central).application.builderTemplate, builderTemplate);
});

function buildFixture(localReport, {
  builderTemplate = manualBuilderTemplate(),
  completedGateIds = [],
  githubActionsRunIds = ["7001"],
  reviewTarget = null,
  stage = "prototype",
  mutateSubmission = null,
  mutateHeadFiles = null
} = {}) {
  const applicationId = "central-model";
  const packagePath = `submissions/${applicationId}`;
  const gateStatusPath = `${packagePath}/evidence/gate-status.json`;
  const compatibilityPath = `${packagePath}/compatibility-report.json`;
  const submissionPath = `${packagePath}/submission.json`;
  const feeSourcePath = "src/ProgrammableFeeHook.sol";
  const feeTestPath = "test/ProgrammableFeeHook.t.sol";
  const revisionObjectId = "a".repeat(40);
  const treeObjectId = "b".repeat(40);
  const source = {
    schemaVersion: "1.0.0",
    primary: {
      repositoryUri: "https://github.com/example/central-model",
      numericRepositoryId: "123456789",
      revisionObjectId,
      treeObjectId,
      sourcePaths: [compatibilityPath, feeSourcePath, feeTestPath, gateStatusPath, submissionPath].sort(),
      contractPaths: [],
      githubActionsRunIds
    },
    companions: []
  };
  const programmableFee = implementedProgrammableFee({ feeSourcePath, feeTestPath });
  const submission = {
    schemaVersion: 1,
    standardVersion: "1.6.0",
    stage,
    model: {
      id: applicationId,
      name: "Central Model",
      summary: "A deterministic central compatibility projection fixture."
    },
    builder: { github: "example-builder", contact: "@example-builder" },
    builderTemplate: structuredClone(builderTemplate),
    implementation: { gateStatusPath },
    programmableFee
  };
  mutateSubmission?.(submission);
  const headFiles = new Map([
    [`${packagePath}/PROPOSAL.md`, markdown("Proposal")],
    [`${packagePath}/TEST_PLAN.md`, markdown("Test plan")],
    [`${packagePath}/THREAT_MODEL.md`, markdown("Threat model")],
    [compatibilityPath, jsonBytes(localReport)],
    [submissionPath, jsonBytes(submission)],
    [gateStatusPath, jsonBytes({
      schemaVersion: 1,
      gates: completedGateIds.map((id) => ({ id, status: "completed", evidence: [] }))
    })]
  ]);
  mutateHeadFiles?.(headFiles, packagePath);
  return buildCentralApplicationPackage({
    packagePath,
    applicationRevision: 1,
    builderIdentity: {
      githubUserId: "9007199254740993",
      githubLogin: "example-builder",
      profileUrl: "https://github.com/example-builder"
    },
    submission,
    source,
    packageResult: { preflightDecision: localReport.decision },
    reviewTarget,
    headFiles
  });
}

function centralJson(central, name) {
  return JSON.parse(central.files.find(({ path: filePath }) => filePath === name).content);
}

function implementedProgrammableFee({ feeSourcePath, feeTestPath }) {
  return {
    policyId: "programmable-volume-fee-v1",
    policyVersion: "1.1.0",
    poolScope: "canonical-launch-pool-key",
    rates: {
      unit: "hundredths-of-bip",
      selectedBuyHundredthsOfBip: 30000,
      selectedSellHundredthsOfBip: 20000,
      minimumEffectiveHundredthsOfBip: 1000,
      effectiveBuyHundredthsOfBip: 30000,
      effectiveSellHundredthsOfBip: 20000,
      platformHundredthsOfBip: 1000,
      projectBuyHundredthsOfBip: 29000,
      projectSellHundredthsOfBip: 19000,
      formula: "per-side:effective=max(selected,1000);platform=1000;project=effective-1000",
      lpFeeExcluded: true
    },
    basis: {
      volume: "gross-quote-side-swap-volume",
      quoteAsset: "canonical-pool-quote-asset"
    },
    ownership: {
      owner: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
      immutable: true,
      claimAuthority: "owner-only",
      claimAvailability: "anytime",
      claimDestinationPolicy: "owner-or-owner-selected-per-claim",
      storedMutableRecipient: false,
      builderCanMutate: false,
      projectCanMutate: false,
      administratorCanMutate: false
    },
    collection: {
      status: "implemented",
      integration: "canonical-pool-hook",
      enforcement: "non-bypassable",
      hookFeeMechanismBinding: "hook.feeMechanism",
      supportedSwapModes: [
        "zeroForOne-exactInput",
        "zeroForOne-exactOutput",
        "oneForZero-exactInput",
        "oneForZero-exactOutput"
      ],
      swapModePaths: {
        zeroForOneExactInput: "after-swap-return-delta",
        zeroForOneExactOutput: "after-swap-return-delta",
        oneForZeroExactInput: "after-swap-return-delta",
        oneForZeroExactOutput: "after-swap-return-delta"
      },
      selfCallPolicy: "same-pool-swap-forbidden"
    },
    accounting: {
      accrualMode: "claimable-liability",
      liabilityKeyDimensions: ["poolId", "currency", "owner"],
      crossPoolNetting: false,
      roundingPolicy: "cumulative-independent-platform-project-remainders",
      remainderScope: "canonical-pool-lifetime",
      claimResetsRemainders: false,
      minimumGrossQuoteUnits: 1000,
      fragmentationResistant: true,
      valueFlowId: "programmable-volume-fee",
      collectionEvent: "ProgrammableFeeAccrued(bytes32,address,uint256)",
      claimEvent: "ProgrammableFeeClaimed(address,address,uint256)"
    },
    evidence: {
      sourcePaths: [feeSourcePath],
      testPaths: [feeTestPath]
    }
  };
}

function manualBuilderTemplate() {
  return {
    schemaVersion: "1.0.0",
    source: "manual",
    templateSelection: null
  };
}

function catalogBuilderTemplate() {
  return builderTemplateFromPlan(composeTemplate({
    catalog: templateCatalog,
    starterId: "blank-custom",
    customCapabilities: [{ id: "gravity-arena", label: "Gravity Arena" }],
    localTags: ["browser-fps"]
  }));
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
