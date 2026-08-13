#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "./hookemon-reusable-profile-v2-core.mjs";

const reportPath = process.argv[2];
if (!reportPath) throw new Error("usage: generate-hookemon-reusable-profile-v2-slither-evidence.mjs <raw-report.json>");
const root = process.cwd();
const raw = await readFile(reportPath);
const report = JSON.parse(raw);
if (report.success !== true || !Array.isArray(report.results?.detectors)) throw new Error("invalid Slither report");

const sourcePattern = /^src\/router_vnext\/(ProgrammableExactHookemonReusableNormalCreateProfileV2|ProgrammableExactHookemonReusablePlanModuleV2|ProgrammableExactHookemonNormalCreateExecutorV2|ProgrammableHookemonLaunchRegistryV1|ProgrammableExactHookemonPostconditionVerifierV1)\.sol$/;
const scoped = report.results.detectors.filter((detector) =>
  detector.elements?.some((element) => sourcePattern.test(element.source_mapping?.filename_relative ?? ""))
);
const byImpact = (detectors) => Object.fromEntries(
  ["High", "Medium", "Low", "Informational"].map((impact) => [impact, detectors.filter((item) => item.impact === impact).length])
);
const untriagedHighOrMedium = scoped.filter((item) => item.impact === "High" || item.impact === "Medium");
if (untriagedHighOrMedium.length !== 0) {
  throw new Error(`scoped High/Medium requires source fix or explicit reviewed triage: ${untriagedHighOrMedium.map((item) => item.check).join(",")}`);
}

const lowTriage = scoped.filter((item) => item.impact === "Low").map((item, index) => {
  const mappings = item.elements
    .map((element) => element.source_mapping)
    .filter((mapping) => sourcePattern.test(mapping?.filename_relative ?? ""))
    .map((mapping) => ({
      path: mapping.filename_relative,
      lines: mapping.lines,
      startingColumn: mapping.starting_column,
      endingColumn: mapping.ending_column
    }));
  let classification;
  let rationale;
  if (item.check === "calls-loop" && item.description.includes("ArchitectureVerifier")) {
    classification = "intentional-bounded-read-only-postcondition-loop";
    rationale = "The exact reviewed graph has nine fixed factory kinds. Every read is post-deployment verification, every mismatch or failed ABI read reverts, and the Profile caps the verifier call gas.";
  } else if (item.check === "calls-loop" && item.description.includes("_buildReservations")) {
    classification = "intentional-fixed-two-part-code-store-loop";
    rationale = "The loop bound is the literal two and each CodeStore part address, runtime hash and nonzero length is bound before reservations are built.";
  } else if (item.check === "timestamp" && item.description.includes("validatePermitV2")) {
    classification = "intentional-permit-expiry-boundary";
    rationale = "The comparison rejects expired short-lived permits. The frozen shared Verifier independently enforces the signed notBefore/deadline window during consumption.";
  } else if (item.check === "timestamp" && item.description.includes("_grantRole")) {
    classification = "false-positive-role-equality";
    rationale = "The detector misclassifies role/address equality as timestamp logic; the function reads no timestamp and only rejects WRITER_ROLE grants to accounts other than immutable LAUNCH_ROUTE.";
  } else {
    throw new Error(`untriaged scoped Low detector: ${item.check}: ${item.description}`);
  }
  return {
    id: `hookemon-v2-low-${String(index + 1).padStart(2, "0")}`,
    check: item.check,
    impact: item.impact,
    confidence: item.confidence,
    description: item.description,
    sourceMappings: mappings,
    classification,
    rationale,
    actionable: false
  };
});

const evidence = {
  schemaVersion: 1,
  product: "Hookemon exact reusable NORMAL_CREATE profile V2",
  status: "STATIC_ANALYSIS_TRIAGED_NOT_AN_AUDIT",
  activationAllowed: false,
  command: "slither . --compile-force-framework foundry --exclude-dependencies --filter-paths 'lib/|test/|dependencies/' --json /tmp/hookemon-v2-slither-final2.json",
  cwd: root,
  tool: { slither: "0.11.5", solc: "0.8.26", foundryProfile: "default" },
  rawReport: {
    committed: false,
    pathAtReview: reportPath,
    sha256: sha256(raw),
    byteLength: raw.length,
    success: report.success,
    detectorInstances: report.results.detectors.length,
    byImpact: byImpact(report.results.detectors)
  },
  scope: {
    sourcePattern: sourcePattern.source,
    detectorInstances: scoped.length,
    byImpact: byImpact(scoped),
    actionableHighFindings: 0,
    actionableMediumFindings: 0,
    untriagedHighOrMediumFindings: 0,
    lowDetectorInstances: lowTriage.length,
    lowTriage
  },
  limitations: [
    "The whole-repository report contains findings in contracts outside the exact Hookemon V2 scope; this evidence makes no claim about those contracts.",
    "Slither output and manual classification are not an independent audit or live deployment evidence.",
    "Low and informational results remain visible; only exact scoped High/Medium absence is a fail-closed release input."
  ],
  deploymentAddresses: null,
  releaseActivationTransaction: null
};
evidence.contentCommitmentSha256 = sha256(canonicalJson(evidence));
const output = path.join(root, "security/hookemon-reusable-profile-v2-slither-triage.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, canonicalJson(evidence));
process.stdout.write(`${output}\n${evidence.contentCommitmentSha256}\n`);
