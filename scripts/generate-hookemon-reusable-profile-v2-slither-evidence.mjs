#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  deriveProductionSourceClosure,
  readJson,
  requireNoScopedHighOrMedium,
  scopeSlitherDetectors,
  sha256
} from "./hookemon-reusable-profile-v2-core.mjs";

const reportPath = process.argv[2];
if (!reportPath) throw new Error("usage: generate-hookemon-reusable-profile-v2-slither-evidence.mjs <raw-report.json>");
const root = process.cwd();
const raw = await readFile(reportPath);
const report = JSON.parse(raw);
if (report.success !== true || !Array.isArray(report.results?.detectors)) throw new Error("invalid Slither report");

const descriptor = await readJson(path.join(root, "spec/router-vnext/hookemon-reusable-profile-v2-reviewed-input.json"));
const productionSourceClosure = await deriveProductionSourceClosure(root, descriptor);
const analyzedFirstPartyPaths = productionSourceClosure.files
  .filter((file) => file.classification === "first-party-production")
  .map((file) => file.path);
const analyzedPathSet = new Set(analyzedFirstPartyPaths);
const scoped = scopeSlitherDetectors(report.results.detectors, analyzedFirstPartyPaths);
const byImpact = (detectors) => Object.fromEntries(
  ["High", "Medium", "Low", "Informational"].map(
    (impact) => [impact, detectors.filter((item) => item.impact === impact).length]
  )
);
requireNoScopedHighOrMedium(scoped);

const lowTriage = scoped.filter((item) => item.impact === "Low").map((item, index) => {
  const mappings = item.elements
    .map((element) => element.source_mapping)
    .filter((mapping) => analyzedPathSet.has(mapping?.filename_relative))
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
    detectorId: item.id,
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

const scopedDetectorIds = scoped.map((detector) => detector.id).sort();
const evidence = {
  schemaVersion: 2,
  product: "Hookemon exact reusable NORMAL_CREATE profile V2",
  status: "STATIC_ANALYSIS_TRIAGED_NOT_AN_AUDIT",
  activationAllowed: false,
  command: `slither . --compile-force-framework foundry --exclude-dependencies --filter-paths 'lib/|test/|dependencies/' --json ${reportPath}`,
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
    derivation: "all first-party-production files in solc metadata source union",
    productionSourceClosureCommitmentSha256: productionSourceClosure.commitmentSha256,
    analyzedFirstPartyPaths,
    scopedDetectorIds,
    scopedDetectorSetCommitmentSha256: sha256(canonicalJson(scopedDetectorIds)),
    detectorInstances: scoped.length,
    byImpact: byImpact(scoped),
    actionableHighFindings: 0,
    actionableMediumFindings: 0,
    untriagedHighOrMediumFindings: 0,
    lowDetectorInstances: lowTriage.length,
    lowTriage
  },
  limitations: [
    "Scope is the complete first-party production closure derived from the seven reviewed compiler artifacts; frozen Shards implementation fixtures remain a separately pinned dependency bundle and are not claimed as covered by this filtered Slither report.",
    "The whole-repository report contains findings outside the exact Hookemon V2 first-party production closure; this evidence makes no claim about those contracts.",
    "Slither output and manual classification are not an independent audit or live deployment evidence.",
    "Low and informational results remain visible; exact scoped High/Medium absence is fail closed."
  ],
  deploymentAddresses: null,
  releaseActivationTransaction: null
};
evidence.contentCommitmentSha256 = sha256(canonicalJson(evidence));
const output = path.join(root, "security/hookemon-reusable-profile-v2-slither-triage.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, canonicalJson(evidence));
process.stdout.write(`${output}\n${evidence.contentCommitmentSha256}\n`);
