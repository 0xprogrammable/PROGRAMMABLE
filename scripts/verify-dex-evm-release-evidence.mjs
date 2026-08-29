#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const packageRelative = "packages/dex-evm";
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const gitObjectPattern = /^[0-9a-f]{40}$/u;
const localPathPattern = /^(?:packages|config|deployments|docs|releases|scripts|\.github)\/[A-Za-z0-9._/-]+$/u;
const requireHeadRevisionEvidence = process.env.PROGRAMMABLE_DEX_REQUIRE_HEAD_REVISION_EVIDENCE ?? "0";

const revisionBoundClassification = "NON_PRODUCTION_REVISION_BOUND_FOUNDATIONS_EVIDENCE";
const revisionBoundClaimKeys = [
  "assetProfileConformance",
  "bindingRelease",
  "conformanceReport",
  "deployment",
  "independentAudit",
  "portableProfiles",
  "production",
  "protectedExecution",
  "securityContest",
  "sourceVerification"
];
const revisionBoundSafetyKeys = [
  "coreControlledVaultReleasePath",
  "localForkIsCanonicalDeployment"
];
const expectedRevisionBoundToolchain = {
  node: "v24.14.0",
  foundry: "forge 1.7.1 commit 4072e48705af9d93e3c0f6e29e93b5e9a40caed8",
  solc: "0.8.26+commit.8a97fa7a",
  slither: "0.11.5",
  echidna: "2.3.3"
};
const exactRevisionBoundMetrics = {
  echidnaTestLimit: 50_000,
  portableVectorCases: 221,
  protocolRequirements: 175
};
const minimumRevisionBoundMetrics = {
  echidnaPropertiesPassed: 3,
  foundryTestsPassed: 77,
  sdkTestsPassed: 56
};
const observedRevisionBoundMetricKeys = [
  "echidnaCalls",
  "slitherFindingsTriaged"
];
const expectedRevisionBoundChecks = [
  [
    "protocol-repository-check",
    "make check",
    "locked Protocol repository at commit 334bb26703a4dab18ce0fca8485c6275a879933a"
  ],
  [
    "dex-foundations-verification",
    "PROGRAMMABLE_DEX_REQUIRE_EXACT_TOOLCHAIN=1 FOUNDRY_PROFILE=ci bash scripts/verify-dex-evm.sh",
    "repository root"
  ],
  [
    "echidna-foundations-campaign",
    "PROGRAMMABLE_DEX_ECHIDNA_TEST_LIMIT=50000 PROGRAMMABLE_DEX_ECHIDNA_SEQUENCE_LENGTH=100 PROGRAMMABLE_DEX_ECHIDNA_TIMEOUT_SECONDS=300 PROGRAMMABLE_DEX_ECHIDNA_WORKERS=1 bash scripts/verify-dex-evm-echidna.sh",
    "repository root with ECHIDNA_BIN resolving the exact Echidna 2.3.3 binary"
  ],
  [
    "robinhood-recorded-chain-context-integration",
    "PROGRAMMABLE_DEX_EXPECTED_FORK_BLOCK=109367897 FOUNDRY_PROFILE=ci forge test --root packages/dex-evm --match-path test/integration/RobinhoodTestnetForkFoundations.t.sol -vvv",
    "repository root",
    "Offline local chain-context simulation at recorded chain ID 46630 and block number 109367897; two Forge integration tests.",
    "No live RPC observation, network fork, canonical-network state, finality, deployment, source verification or conformance."
  ]
];
const expectedRevisionBoundPathRoots = [
  ".github/workflows/dex-evm.yml",
  ".github/workflows/robinhood-dex-evidence.yml",
  "README.md",
  "config/networks/robinhood-chain",
  "contracts/scripts/bootstrap-deps.sh",
  "deployments/dex/robinhood",
  "docs/PROJECT-STRUCTURE.md",
  "docs/dex-evm",
  "docs/security/DEX_EVM_PROPERTIES.md",
  "packages/dex-evm",
  "releases/dex-evm/0.1.0-architecture-baseline.1",
  "scripts/bootstrap-dex-evm-deps.sh",
  "scripts/generate-dex-evm-build-artifacts.mjs",
  "scripts/verify-dex-evm-coverage.sh",
  "scripts/verify-dex-evm-echidna.sh",
  "scripts/verify-dex-evm-import-boundary.mjs",
  "scripts/verify-dex-evm-network-records.mjs",
  "scripts/verify-dex-evm-package.mjs",
  "scripts/verify-dex-evm-release-evidence.mjs",
  "scripts/verify-dex-evm-slither-findings.mjs",
  "scripts/verify-dex-evm-slither.sh",
  "scripts/verify-dex-evm.sh",
  "scripts/verify-robinhood-dex-readonly.sh"
];

const protocolIdentity = {
  commit: "334bb26703a4dab18ce0fca8485c6275a879933a",
  tree: "a0c4d7018eb810c35ac11cdd4e066cd92a6ee513",
  specId: "programmable-protocol/0.1.0-draft.1",
  constitutionId: "sha256:2715d9770de7b327c054c413a99f7cbba0933f2eabc9639a53948706237cd301",
  vectorSetDigest: "sha256:d61a757f8d4c14d3e5ab0f92e77ab39bd54e7a91f4cc5d591819c58768481137"
};

const expectedGaps = [
  ["SPEC-GAP-001", "refund-effect-representation", "DEX_EVM_SPEC_REFUND_GRAMMAR_V1"],
  ["SPEC-GAP-002", "scope-capability-commitment", "DEX_EVM_SPEC_CAPABILITY_COMMITMENTS_V1"],
  ["SPEC-GAP-003", "stored-scope-fill-limit-semantics", "DEX_EVM_SPEC_STORED_SCOPE_MINIMUM_CREDITS_V1"],
  ["SPEC-GAP-004", "core-derived-occurrence-id", "DEX_EVM_SPEC_EFFECT_OCCURRENCE_ID_V1"],
  ["SPEC-GAP-005", "asset-move-endpoint-classes", "DEX_EVM_SPEC_ASSET_SOURCE_DESTINATION_CLASSES_V1"],
  ["SPEC-GAP-006", "asynchronous-deficit-provenance", "DEX_EVM_SPEC_ASYNC_DEFICIT_OBSERVABILITY_V1"],
  ["SPEC-GAP-007", "receipt-relation-and-identity", "DEX_EVM_SPEC_RECEIPT_TARGET_DOMAIN_MAPPING_V1"],
  ["SPEC-GAP-008", "identifier-vector-required-profiles", "DEX_EVM_SPEC_IDENTIFIER_PROFILE_METADATA_V1"],
  ["SPEC-GAP-009", "engine-independent-exit-vector-coverage", "DEX_EVM_SPEC_EXIT_PROFILE_VECTORS_V1"],
  ["SPEC-GAP-010", "principal-native-source-binding", "DEX_EVM_SPEC_PRINCIPAL_SOURCE_BINDING_V1"],
  ["SPEC-GAP-011", "portable-scope-id-native-signature-bridge", "DEX_EVM_SPEC_SCOPE_EIP712_BRIDGE_V1"],
  ["SPEC-GAP-012", "return-only-proposal-acquisition-transcript", "DEX_EVM_SPEC_RETURN_ONLY_PROPOSAL_TRANSCRIPT_V1"]
];

const expectedCatalogEntries = [
  ["protocol-lock", "packages/dex-evm/binding/protocol-lock.json", "PRESENT"],
  ["protocol-lock-verification", "packages/dex-evm/binding/reports/protocol-lock-verification.json", "PROTOCOL_REPOSITORY_INTERNAL_CHECK_PASS"],
  ["protocol-gaps", "packages/dex-evm/binding/reports/protocol-gap-report.json", "BLOCKED_BY_SPEC"],
  ["conformance-status", "packages/dex-evm/binding/reports/conformance-status.json", "NO_BINDING_RELEASE_OR_CONFORMANCE_REPORT"],
  ["requirement-traceability", "packages/dex-evm/binding/reports/requirement-traceability.json", "FOUNDATION_ONLY_NON_CONFORMANCE_TRACEABILITY"],
  ["binding-local-profiles", "packages/dex-evm/binding/profiles", "ARCHITECTURE_BASELINE_ONLY"],
  ["generated-foundations-abi", "packages/dex-evm/binding/abi/foundations.generated.json", "GENERATED_DRAFT_FOUNDATIONS_ONLY"],
  ["generated-foundations-build-inventory", "packages/dex-evm/binding/reports/build-artifacts.generated.json", "GENERATED_DRAFT_FOUNDATIONS_ONLY"],
  ["binding-native-foundation-vectors", "packages/dex-evm/binding/vectors/foundations-v1.json", "PRESENT_NATIVE_FOUNDATION_FIXTURES"],
  ["binding-local-asset-foundation-vectors", "packages/dex-evm/binding/vectors/asset-foundations-v1.json", "PRESENT_POINT_IN_TIME_ASSET_FOUNDATION_FIXTURES"],
  ["portable-snapshot-subset", "packages/dex-evm/binding/vectors/portable-snapshot-lock.json", "INCOMPLETE_PORTABLE_EVALUATOR_SUBSET"],
  ["sdk-test-sources", "packages/dex-evm/sdk/test", "TEST_SOURCE_PRESENT_EXECUTION_EVIDENCE_SEPARATE"],
  ["solidity-test-sources", "packages/dex-evm/test", "TEST_SOURCE_PRESENT_EXECUTION_EVIDENCE_SEPARATE"],
  ["robinhood-mainnet-network", "config/networks/robinhood-chain/4663.json", "DATED_READ_ONLY_EVIDENCE"],
  ["robinhood-testnet-network", "config/networks/robinhood-chain/46630.json", "DATED_READ_ONLY_EVIDENCE"],
  ["robinhood-mainnet-deployment", "deployments/dex/robinhood/4663/deployment-status.json", "BLOCKED_BY_SPEC_NOT_DEPLOYED"],
  ["robinhood-testnet-preparation", "deployments/dex/robinhood/46630/preparation-status.json", "PRE_OWNER_GATE_READ_ONLY_PREPARATION_BLOCKED_BY_SPEC"],
  ["security-properties", "docs/security/DEX_EVM_PROPERTIES.md", "DOCUMENTED_NOT_AUDITED"]
];

const expectedAbsentEvidence = [
  "implementation release commit and tree",
  "revision-bound native test report",
  "revision-bound SDK test report",
  "Binding Release",
  "Conformance Report",
  "portable profile claims",
  "independent audit",
  "security contest",
  "owner gate",
  "owner-provided Robinhood or provider Terms acceptance record or click-through acceptance evidence",
  "owner-signed or canonical-network-broadcast transaction",
  "canonical testnet deployment",
  "mainnet deployment",
  "source verification",
  "canonical deployment runtime readback",
  "provider-quorum finality proof",
  "production publication"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function same(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toPosix(candidate) {
  return candidate.split(path.sep).join("/");
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function runGit(args, { encoding = "utf8", allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: repositoryRoot,
        encoding,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error && !allowFailure) {
          const detail = typeof stderr === "string" ? stderr.trim() : stderr.toString("utf8").trim();
          reject(new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`));
          return;
        }
        resolve({
          ok: error === null,
          stdout,
          stderr,
          exitCode: error?.code ?? 0
        });
      }
    );
  });
}

async function gitText(args) {
  return (await runGit(args)).stdout.trim();
}

async function gitBytes(args) {
  return (await runGit(args, { encoding: null })).stdout;
}

async function gitObjectExists(revisionPath) {
  return (await runGit(["cat-file", "-e", revisionPath], { allowFailure: true })).ok;
}

async function sha256GitPath(revision, relative) {
  return sha256Bytes(await gitBytes(["show", `${revision}:${relative}`]));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function unique(values) {
  return [...new Set(values)];
}

async function ensureRepositoryPath(relative, label = relative) {
  assert(typeof relative === "string" && relative.length > 0, `${label}: path must be a nonempty string`);
  assert(!relative.includes("\\") && !path.posix.isAbsolute(relative), `${label}: path must be repository-relative POSIX`);
  const segments = relative.split("/");
  assert(segments.every((segment) => segment && segment !== "." && segment !== ".."), `${label}: path traversal is forbidden`);

  let current = repositoryRoot;
  let info;
  for (const segment of segments) {
    current = path.join(current, segment);
    info = await lstat(current).catch(() => null);
    assert(info !== null, `${label}: referenced path does not exist: ${relative}`);
    assert(!info.isSymbolicLink(), `${label}: symbolic links are forbidden: ${relative}`);
  }
  const canonical = await realpath(current);
  const canonicalRoot = await realpath(repositoryRoot);
  assert(isWithin(canonical, canonicalRoot), `${label}: canonical path escapes the repository: ${relative}`);
  return { absolute: current, info };
}

async function walkFiles(relativeRoot, predicate = () => true) {
  const root = await ensureRepositoryPath(relativeRoot, relativeRoot);
  assert(root.info.isDirectory(), `${relativeRoot}: expected a directory`);
  const files = [];

  async function visit(relativeDirectory) {
    const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
    for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${relativeRoot}: symbolic link is forbidden: ${relative}`);
      if (entry.isDirectory()) await visit(relative);
      if (entry.isFile() && predicate(relative)) files.push(relative);
    }
  }

  await visit(relativeRoot);
  return files.sort();
}

async function readJson(relative) {
  const target = await ensureRepositoryPath(relative, relative);
  assert(target.info.isFile(), `${relative}: expected an ordinary JSON file`);
  try {
    return JSON.parse(await readFile(target.absolute, "utf8"));
  } catch (error) {
    throw new Error(`${relative}: invalid JSON: ${error.message}`);
  }
}

async function sha256File(relative) {
  const target = await ensureRepositoryPath(relative, relative);
  assert(target.info.isFile(), `${relative}: digest target must be an ordinary file`);
  return sha256Bytes(await readFile(target.absolute));
}

function validateSha256Strings(value, label) {
  if (typeof value === "string") {
    if (value.startsWith("sha256:")) assert(sha256Pattern.test(value), `${label}: malformed SHA-256 value ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateSha256Strings(item, `${label}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) validateSha256Strings(item, `${label}.${key}`);
  }
}

async function validateLocalStringReferences(value, label) {
  if (typeof value === "string") {
    if (localPathPattern.test(value)) await ensureRepositoryPath(value, label);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      await validateLocalStringReferences(value[index], `${label}[${index}]`);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) await validateLocalStringReferences(item, `${label}.${key}`);
  }
}

function assertAllFalse(record, keys, label) {
  assert(record !== null && typeof record === "object" && !Array.isArray(record), `${label}: expected an object`);
  same(Object.keys(record).sort(), [...keys].sort(), `${label} keys`);
  for (const key of keys) assert(record[key] === false, `${label}.${key} must be false`);
}

function assertRevisionBoundaries(document, label) {
  assertAllFalse(document.claims, revisionBoundClaimKeys, `${label}.claims`);
  assertAllFalse(document.safetyBoundaries, revisionBoundSafetyKeys, `${label}.safetyBoundaries`);
}

function assertProtocolReference(reference, label, { tree = true, constitution = true, vectors = true } = {}) {
  assert(reference !== null && typeof reference === "object", `${label}: expected Protocol reference object`);
  assert((reference.commit ?? reference.protocolCommit) === protocolIdentity.commit, `${label}: wrong Protocol commit`);
  if (tree) assert((reference.tree ?? reference.protocolTree) === protocolIdentity.tree, `${label}: wrong Protocol tree`);
  assert((reference.protocolSpecId ?? reference.specId) === protocolIdentity.specId, `${label}: wrong Protocol spec ID`);
  if (constitution) {
    assert((reference.constitutionId ?? reference.constitution?.constitutionId) === protocolIdentity.constitutionId, `${label}: wrong Constitution ID`);
  }
  if (vectors) {
    assert((reference.portableVectorSetDigest ?? reference.portableVectorSet?.digest) === protocolIdentity.vectorSetDigest, `${label}: wrong portable vector-set digest`);
  }
  assert(reference.status === "draft", `${label}: Protocol status must remain draft`);
  assert(reference.productionEligible === false, `${label}: productionEligible must be false`);
}

async function validateMarkdownLinks(relative) {
  const target = await ensureRepositoryPath(relative, relative);
  const markdown = await readFile(target.absolute, "utf8");
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;
  for (const match of markdown.matchAll(linkPattern)) {
    let destination = match[1].trim();
    if (destination.startsWith("<")) destination = destination.slice(1, destination.indexOf(">"));
    else destination = destination.split(/\s+/u)[0];
    if (/^(?:https?:|mailto:|#)/u.test(destination)) continue;
    destination = destination.split("#")[0].split("?")[0];
    if (!destination) continue;
    destination = decodeURIComponent(destination);
    assert(!path.isAbsolute(destination), `${relative}: absolute Markdown link is forbidden: ${destination}`);
    const resolved = path.resolve(path.dirname(target.absolute), destination);
    assert(isWithin(resolved, repositoryRoot), `${relative}: Markdown link escapes the repository: ${destination}`);
    await ensureRepositoryPath(toPosix(path.relative(repositoryRoot, resolved)), `${relative} link ${destination}`);
  }
}

async function validateMarkdownLinksAtGitRevision(relative, revision) {
  const markdown = (await gitBytes(["show", `${revision}:${relative}`])).toString("utf8");
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;
  for (const match of markdown.matchAll(linkPattern)) {
    let destination = match[1].trim();
    if (destination.startsWith("<")) destination = destination.slice(1, destination.indexOf(">"));
    else destination = destination.split(/\s+/u)[0];
    if (/^(?:https?:|mailto:|#)/u.test(destination)) continue;
    destination = destination.split("#")[0].split("?")[0];
    if (!destination) continue;
    destination = decodeURIComponent(destination);
    assert(!path.posix.isAbsolute(destination), `${relative}@${revision}: absolute Markdown link is forbidden: ${destination}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), destination));
    assert(resolved !== ".." && !resolved.startsWith("../"), `${relative}@${revision}: Markdown link escapes the repository: ${destination}`);
    assert(await gitObjectExists(`${revision}:${resolved}`), `${relative}@${revision}: Markdown link target is absent: ${destination}`);
  }
}

async function validateProtocolAndGaps(documents) {
  const { protocolLock, lockVerification, gapReport, traceability, conformance, foundations } = documents;
  assert(protocolLock.schemaVersion === "programmable.dex-evm.protocol-lock/v1", "Protocol lock schema mismatch");
  assertProtocolReference(protocolLock, "protocol-lock");
  assert(protocolLock.referencePolicy === "EXACT_COMMIT_ONLY", "Protocol lock must remain exact-commit-only");
  assert(protocolLock.portableVectorSet.caseCount === 221, "Protocol lock portable vector case count must be 221");

  assert(lockVerification.git?.head === protocolIdentity.commit, "Protocol verification HEAD mismatch");
  assert(lockVerification.git?.tree === protocolIdentity.tree, "Protocol verification tree mismatch");
  assert(lockVerification.releaseInventory?.protocolSpecId === protocolIdentity.specId, "Protocol verification spec mismatch");
  assert(lockVerification.releaseInventory?.constitutionId === protocolIdentity.constitutionId, "Protocol verification Constitution mismatch");
  assert(lockVerification.releaseInventory?.portableVectorSetDigest === protocolIdentity.vectorSetDigest, "Protocol verification vector digest mismatch");
  assert(lockVerification.releaseInventory?.status === "draft" && lockVerification.releaseInventory?.productionEligible === false, "Protocol verification must preserve Draft status");
  assert(lockVerification.repositoryCheck?.result === "PASS" && lockVerification.repositoryCheck?.exitCode === 0, "Protocol repository check is not PASS");
  assert(lockVerification.repositoryCheck?.bindingReleases === 0 && lockVerification.repositoryCheck?.conformanceReports === 0, "Locked Protocol inventory unexpectedly contains release claims");

  assert(gapReport.schemaVersion === "programmable.dex-evm.protocol-gap-report/v1", "Gap report schema mismatch");
  assert(gapReport.terminalState === "BLOCKED_BY_SPEC", "Gap report terminal state must be BLOCKED_BY_SPEC");
  assertProtocolReference(gapReport.protocolLock, "gap-report.protocolLock");
  assert(gapReport.issueCount === 12 && gapReport.issues?.length === 12, "Gap report must contain exactly twelve issues");
  same(gapReport.issues.map((issue) => [issue.id, issue.label, issue.bindingLocalIssueIdPreimage]), expectedGaps, "ordered Protocol gaps");
  assert(!JSON.stringify(gapReport).includes("SPEC-GAP-013"), "The umbrella sentinel must not become SPEC-GAP-013");

  const gapIds = expectedGaps.map(([id]) => id);
  const sentinel = gapReport.executionSentinel;
  assert(sentinel?.bindingLocalIssueIdPreimage === "DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR_V1", "Execution sentinel preimage mismatch");
  assert(sentinel?.classification === "UMBRELLA_FAIL_CLOSED_SENTINEL", "Execution sentinel classification mismatch");
  assert(sentinel?.separatePortableGap === false, "Execution sentinel must not be a separate portable gap");
  same(sentinel?.coversIssueIds, gapIds, "execution sentinel coverage");

  assert(Array.isArray(gapReport.releaseGates) && gapReport.releaseGates.length === 1, "Gap report must contain one separate release gate");
  const releaseGate = gapReport.releaseGates[0];
  assert(releaseGate.id === "RELEASE-GATE-001" && releaseGate.label === "protocol-release-eligibility", "Release gate identity mismatch");
  assert(releaseGate.status === "BLOCKED_BY_SPEC", "Release gate must be BLOCKED_BY_SPEC");

  assert(traceability.schemaVersion === "programmable.dex-evm.requirement-traceability-status/v1", "Traceability schema mismatch");
  assert(traceability.terminalState === "BLOCKED_BY_SPEC", "Traceability terminal state mismatch");
  assertProtocolReference(traceability.protocolLock, "traceability.protocolLock");
  assert(traceability.blockedRequirements?.length === 12, "Traceability must contain exactly twelve blockers");
  same(traceability.blockedRequirements.map((item) => [item.id, item.label]), expectedGaps.map(([id, label]) => [id, label]), "ordered traceability blockers");

  for (let index = 0; index < gapReport.issues.length; index += 1) {
    const issue = gapReport.issues[index];
    const traced = traceability.blockedRequirements[index];
    assert(issue.status === "BLOCKED_BY_SPEC" && traced.status === "BLOCKED_BY_SPEC", `${issue.id}: status must be BLOCKED_BY_SPEC`);
    assert(typeof issue.minimalCounterexample === "string" && issue.minimalCounterexample.length > 40, `${issue.id}: missing minimal counterexample`);
    assert(typeof issue.impact === "string" && issue.impact.length > 20, `${issue.id}: missing impact`);
    const requirementIds = unique(issue.requirements.flatMap((requirement) => requirement.requirementIds ?? [])).sort();
    same([...traced.requirementIds].sort(), requirementIds, `${issue.id} requirement traceability`);
    assert(traced.detailPath === "packages/dex-evm/binding/reports/protocol-gap-report.json", `${issue.id}: wrong detail path`);
  }

  const releaseRequirementIds = unique(releaseGate.requirements.flatMap((requirement) => requirement.requirementIds ?? [])).sort();
  same(releaseRequirementIds, ["ARTIFACT-005", "ARTIFACT-006", "ARTIFACT-007", "VER-009", "VER-010", "VER-011"], "release gate requirements");
  assert(traceability.releaseGate?.id === "RELEASE-GATE-001" && traceability.releaseGate?.status === "BLOCKED_BY_SPEC", "Traceability release gate mismatch");
  same([...traceability.releaseGate.requirementIds].sort(), releaseRequirementIds, "traceability release gate requirements");
  assert(traceability.releaseGate.facts?.protocolStatus === "draft", "Release-gate Protocol status must be draft");
  assert(traceability.releaseGate.facts?.protocolProductionEligible === false, "Release-gate production eligibility must be false");
  assert(traceability.releaseGate.facts?.bindingReleasePublished === false, "Release-gate Binding Release claim must be false");
  assert(traceability.releaseGate.facts?.conformanceReportPublished === false, "Release-gate Conformance Report claim must be false");

  assert(conformance.terminalState === "BLOCKED_BY_SPEC", "Conformance status must be BLOCKED_BY_SPEC");
  assertProtocolReference(conformance.protocolLock, "conformance.protocolLock");
  assert(conformance.bindingRelease?.published === false, "Binding Release must remain unpublished");
  assert(conformance.conformanceReport?.published === false && conformance.conformanceReport?.passingClaim === false, "Conformance Report claims must remain false");
  same(conformance.portableProfileClaims, [], "portable profile claims");
  assert(conformance.blockingReport?.ambiguityCount === 12 && conformance.blockingReport?.separateReleaseGateCount === 1, "Conformance blocker counts mismatch");
  assert(conformance.requirementTraceability?.claims175Of175ImplementationCoverage === false, "175/175 coverage must not be claimed");

  assert(foundations.portable_conformance_claim === false && foundations.binding_release_claim === false, "Foundation vectors must not claim portable conformance or a Binding Release");
  assert(foundations.protocol?.commit === protocolIdentity.commit && foundations.protocol?.spec_id === protocolIdentity.specId, "Foundation vector Protocol identity mismatch");
  assert(foundations.protocol?.status === "draft" && foundations.protocol?.production_eligible === false, "Foundation vectors must preserve Draft status");
  assert(foundations.protocol?.protected_execution_status === "BLOCKED_BY_SPEC" && foundations.protocol?.known_blocked_issue_count === 12, "Foundation vector blocker count mismatch");
}

async function validateAssets(documents) {
  const { assetVectors, nativeProfile, erc20Profile, unsupportedAssets } = documents;
  assert(assetVectors.classification === "BINDING_LOCAL_ASSET_FOUNDATIONS_ONLY_NON_CONFORMANCE", "Asset vector classification mismatch");
  assertAllFalse(assetVectors.claims, ["asset_profile_conformance", "evm_013", "lifetime_token_safety", "portable_conformance", "protected_execution"], "asset vector claims");

  const expectedProfiles = {
    native_eth: {
      identifier: "0x11bd3b922fc099e5d10a6fc42d85a4d527d518c38371c61b4a7ae08e69d88b4c",
      preimage: "programmable.dex.evm.asset-profile.native-eth-strict.v1",
      name: "native-eth-strict-v1",
      profileSource: "packages/dex-evm/binding/profiles/asset.native-eth-strict.v1.json",
      soliditySource: "packages/dex-evm/src/profiles/NativeETHProfileV1.sol"
    },
    strict_measured_erc20: {
      identifier: "0x17590f19c39f156c871671beb9d33f04c534d3c73dd6d4d303b1ad156ee1e07a",
      preimage: "programmable.dex.evm.asset-profile.erc20-strict-measured.v1",
      name: "erc20-strict-measured-v1",
      profileSource: "packages/dex-evm/binding/profiles/asset.erc20-strict-measured.v1.json",
      soliditySource: "packages/dex-evm/src/profiles/StrictMeasuredERC20ProfileV1.sol"
    }
  };
  same(Object.keys(assetVectors.profiles), Object.keys(expectedProfiles), "asset profile catalog keys");
  for (const [key, expected] of Object.entries(expectedProfiles)) {
    const catalog = assetVectors.profiles[key];
    const profile = key === "native_eth" ? nativeProfile : erc20Profile;
    assert(catalog.identifier === expected.identifier, `${key}: profile identifier mismatch`);
    assert(catalog.profile_source === expected.profileSource && catalog.solidity_source === expected.soliditySource, `${key}: profile source catalog mismatch`);
    assert(profile.schemaVersion === "programmable.dex-evm.binding-local-profile/v1", `${key}: profile schema mismatch`);
    assert(profile.kind === "ASSET_PROFILE" && profile.name === expected.name, `${key}: profile identity mismatch`);
    assert(profile.identifierPreimage === expected.preimage && profile.identifierDerivation === "keccak256(utf8(identifierPreimage))", `${key}: identifier derivation mismatch`);
    assert(profile.claimStatus === "ARCHITECTURE_BASELINE_ONLY" && profile.protectedExecutionStatus === "BLOCKED_BY_SPEC", `${key}: profile claim boundary mismatch`);
    assert(profile.source?.executableVectors === "packages/dex-evm/binding/vectors/asset-foundations-v1.json", `${key}: executable vector path mismatch`);
    assert(profile.source?.foundryVectorTest === assetVectors.test_source, `${key}: Foundry vector test path mismatch`);
    assert(profile.source?.library === expected.soliditySource, `${key}: Solidity library path mismatch`);
  }

  const boundaries = assetVectors.resource_boundaries;
  assert(boundaries.native_returndata_max_bytes === 256 && boundaries.native_returndata_max_plus_one_bytes === 257, "Native returndata boundary mismatch");
  assert(boundaries.erc20_transfer_returndata_exact_bytes === 32 && boundaries.erc20_transfer_returndata_exact_plus_one_bytes === 33, "ERC-20 returndata boundary mismatch");
  assert(nativeProfile.measurement?.maximumReturnBytes === boundaries.native_returndata_max_bytes, "Native profile/vector maximum mismatch");
  assert(erc20Profile.callPolicy?.requiredReturnBytes === boundaries.erc20_transfer_returndata_exact_bytes, "ERC-20 profile/vector return length mismatch");

  const expectedNativeCases = [
    "native-exact-empty-return",
    "native-max-return-bytes",
    "native-max-plus-one-return-bytes",
    "native-recipient-revert",
    "native-forwarded-credit",
    "native-zero-amount"
  ];
  const expectedErc20Cases = [
    "erc20-exact-pull",
    "erc20-exact-push",
    "erc20-false-return",
    "erc20-empty-return",
    "erc20-exact-plus-one-return-bytes",
    "erc20-fee-undercredit",
    "erc20-overdebit",
    "erc20-zero-amount"
  ];

  function validateCases(cases, declaredCount, expectedIds, label) {
    assert(Array.isArray(cases) && cases.length === declaredCount, `${label}: declared case count mismatch`);
    same(cases.map((item) => item.case_id), expectedIds, `${label} ordered case IDs`);
    assert(new Set(expectedIds).size === cases.length, `${label}: duplicate case ID`);
    for (const item of cases) {
      assert(typeof item.accepted === "boolean", `${label}/${item.case_id}: accepted must be boolean`);
      assert(Number.isFinite(item.amount) && item.amount >= 0, `${label}/${item.case_id}: invalid amount`);
      assert(Number.isInteger(item.return_bytes) && item.return_bytes >= 0, `${label}/${item.case_id}: invalid return length`);
      if (item.accepted) {
        assert(item.expected_error === "", `${label}/${item.case_id}: accepted case has an error`);
        assert(item.committed_source_debit === item.amount && item.committed_destination_credit === item.amount, `${label}/${item.case_id}: accepted accounting mismatch`);
      } else {
        assert(typeof item.expected_error === "string" && item.expected_error.length > 0, `${label}/${item.case_id}: rejected case lacks an error`);
        assert(item.committed_source_debit === 0 && item.committed_destination_credit === 0, `${label}/${item.case_id}: rejected case commits movement`);
      }
    }
  }

  validateCases(assetVectors.native_eth_cases, assetVectors.native_eth_case_count, expectedNativeCases, "native asset vectors");
  validateCases(assetVectors.strict_measured_erc20_cases, assetVectors.strict_measured_erc20_case_count, expectedErc20Cases, "ERC-20 asset vectors");
  assert(unsupportedAssets.schemaVersion === "programmable.dex-evm.unsupported-assets/v1", "Unsupported-assets schema mismatch");
  assert(unsupportedAssets.classification === "EXPLICIT_EXCLUSIONS_NOT_A_PROFILE_CLAIM", "Unsupported-assets classification mismatch");
  assert(unsupportedAssets.protectedExecutionStatus === "BLOCKED_BY_SPEC", "Unsupported-assets protected execution status mismatch");
  assert(unsupportedAssets.categories?.length === 8, "Unsupported-assets catalog must contain eight categories");
  assert(new Set(unsupportedAssets.categories.map((item) => item.category)).size === 8, "Unsupported-assets catalog contains duplicate categories");
}

async function validateGeneratedDigests(documents) {
  const { buildReport, abiBundle, protocolLock } = documents;
  assertAllFalse(buildReport.claims, ["bindingRelease", "conformanceReport", "deployment", "executionAbiFrozen", "productionEligible", "sourceVerified"], "build inventory claims");
  assertAllFalse(abiBundle.claims, ["bindingRelease", "conformanceReport", "deployment", "protectedExecutionAbiFrozen", "productionEligible"], "ABI bundle claims");
  assert(buildReport.terminalState === "BLOCKED_BY_SPEC" && abiBundle.terminalState === "BLOCKED_BY_SPEC", "Generated artifacts must remain BLOCKED_BY_SPEC");
  assert(abiBundle.protectedExecutionAbiFrozen === false, "Protected execution ABI must remain unfrozen");

  const expectedInputs = {
    foundryConfigSha256: await sha256File(`${packageRelative}/foundry.toml`),
    foundationsAbiBundleSha256: await sha256File(`${packageRelative}/binding/abi/foundations.generated.json`),
    protocolLockSha256: await sha256File(`${packageRelative}/binding/protocol-lock.json`),
    remappingsSha256: await sha256File(`${packageRelative}/remappings.txt`)
  };
  for (const [key, expected] of Object.entries(expectedInputs)) {
    assert(buildReport.inputs?.[key] === expected, `Build inventory ${key} is stale`);
  }
  assert(abiBundle.protocolLockSha256 === expectedInputs.protocolLockSha256, "ABI bundle Protocol-lock digest is stale");

  const sourcePaths = buildReport.sources.map((source) => source.path);
  same(sourcePaths, [...sourcePaths].sort(), "build inventory source ordering");
  assert(new Set(sourcePaths).size === sourcePaths.length, "Build inventory contains duplicate sources");
  for (const source of buildReport.sources) {
    assert(source.path.startsWith("src/") && !source.path.includes(".."), `Invalid build source path: ${source.path}`);
    const relative = `${packageRelative}/${source.path}`;
    assert(source.sha256 === await sha256File(relative), `${source.path}: stale source digest`);
  }
  const sourceSetMaterial = buildReport.sources.map((source) => `${source.path}\0${source.sha256}\n`).join("");
  assert(buildReport.inputs.sourceSetSha256 === sha256Bytes(Buffer.from(sourceSetMaterial, "utf8")), "Build inventory source-set digest is stale");

  const abiByIdentity = new Map();
  for (const entry of abiBundle.entries) {
    const identity = `${entry.sourcePath}:${entry.contractName}`;
    assert(!abiByIdentity.has(identity), `Duplicate ABI identity: ${identity}`);
    const expectedAbiHash = sha256Bytes(Buffer.from(canonicalJson(entry.abi), "utf8"));
    assert(entry.abiSha256 === expectedAbiHash, `${identity}: stale ABI digest`);
    abiByIdentity.set(identity, entry.abiSha256);
  }
  for (const contract of buildReport.contracts) {
    const identity = `${contract.sourcePath}:${contract.contractName}`;
    assert(abiByIdentity.get(identity) === contract.abiSha256, `${identity}: ABI digest differs between generated artifacts`);
    for (const field of ["abiSha256", "creationBytecodeSha256", "runtimeBytecodeSha256"]) {
      assert(sha256Pattern.test(contract[field]), `${identity}: malformed ${field}`);
    }
  }
  assert(protocolLock.protocolCommit === protocolIdentity.commit, "Generated digest Protocol lock changed unexpectedly");
}

async function validatePortableSnapshot(documents) {
  const snapshot = documents.portableSnapshot;
  assert(snapshot.classification === "portable-evaluator-input-subset", "Portable snapshot classification mismatch");
  assert(snapshot.protocol_commit === protocolIdentity.commit && snapshot.protocol_spec_id === protocolIdentity.specId, "Portable snapshot Protocol identity mismatch");
  assert(snapshot.complete_portable_vector_set === false && snapshot.portable_conformance_claim === false, "Portable snapshot must remain incomplete and non-conforming");
  const base = `${packageRelative}/binding/vectors/portable/${snapshot.protocol_commit}`;
  const declared = Object.keys(snapshot.files).sort();
  const actual = (await walkFiles(base, (relative) => relative.endsWith(".json")))
    .map((relative) => path.posix.relative(base, relative))
    .sort();
  same(declared, actual, "portable snapshot file catalog");
  for (const relative of declared) {
    assert(relative !== "" && !relative.startsWith("../") && !relative.includes("/../"), `Portable snapshot path escapes: ${relative}`);
    const expected = snapshot.files[relative];
    assert(sha256Pattern.test(expected), `Portable snapshot digest is malformed: ${relative}`);
    assert(await sha256File(`${base}/${relative}`) === expected, `Portable snapshot digest mismatch: ${relative}`);
  }
}

async function validateRevisionBoundReleaseDirectory(relativeDirectory, documents, release, catalog, markdownPath) {
  const releaseName = path.posix.basename(relativeDirectory);
  const releaseId = `dex-evm/${releaseName}`;
  const releaseRecordPath = `${relativeDirectory}/release-record.json`;
  const catalogPath = `${relativeDirectory}/evidence-catalog.json`;
  const checksumPath = `${relativeDirectory}/SHA256SUMS`;
  const implementation = release.implementationRevision;

  same(
    Object.keys(release).sort(),
    [
      "claims",
      "classification",
      "evidenceArtifacts",
      "implementationRevision",
      "productionEligible",
      "protocolLock",
      "releaseId",
      "safetyBoundaries",
      "schemaVersion",
      "terminalState"
    ].sort(),
    `${releaseName} release-record keys`
  );
  assert(release.releaseId === releaseId && catalog.releaseId === releaseId, `${releaseName}: release ID mismatch`);
  assert(release.classification === revisionBoundClassification, `${releaseName}: revision-bound classification mismatch`);
  assert(release.terminalState === "BLOCKED_BY_SPEC" && release.productionEligible === false, `${releaseName}: revision-bound evidence must remain non-production BLOCKED_BY_SPEC`);
  assertProtocolReference(release.protocolLock, `${releaseName}.protocolLock`);
  assertRevisionBoundaries(release, releaseName);

  assert(implementation !== null && typeof implementation === "object" && !Array.isArray(implementation), `${releaseName}: implementationRevision must be an object`);
  same(
    Object.keys(implementation).sort(),
    ["boundPathRoots", "commit", "evidenceSeparation", "relationToEvidenceRevision", "tree"].sort(),
    `${releaseName}.implementationRevision keys`
  );
  assert(gitObjectPattern.test(implementation.commit), `${releaseName}: implementation commit must be a full lowercase Git object ID`);
  assert(gitObjectPattern.test(implementation.tree), `${releaseName}: implementation tree must be a full lowercase Git object ID`);
  assert(implementation.relationToEvidenceRevision === "STRICT_ANCESTOR", `${releaseName}: implementation revision relation must be STRICT_ANCESTOR`);
  assert(
    implementation.evidenceSeparation === "DATA_ONLY_EVIDENCE_COMMIT_WITH_UNCHANGED_BOUND_PATHS",
    `${releaseName}: implementation/evidence separation policy mismatch`
  );
  same(implementation.boundPathRoots, expectedRevisionBoundPathRoots, `${releaseName} bound implementation roots`);

  assert(await gitObjectExists(`${implementation.commit}^{commit}`), `${releaseName}: implementation commit object does not exist`);
  const actualImplementationTree = await gitText(["rev-parse", `${implementation.commit}^{tree}`]);
  assert(actualImplementationTree === implementation.tree, `${releaseName}: implementation tree object mismatch`);
  const currentHead = await gitText(["rev-parse", "HEAD"]);

  const evidenceArtifacts = release.evidenceArtifacts;
  assert(evidenceArtifacts !== null && typeof evidenceArtifacts === "object" && !Array.isArray(evidenceArtifacts), `${releaseName}: evidenceArtifacts must be an object`);
  same(
    Object.keys(evidenceArtifacts).sort(),
    ["checksumManifest", "evidenceCatalog", "releaseNotes", "testReport"].sort(),
    `${releaseName}.evidenceArtifacts keys`
  );
  assert(evidenceArtifacts.evidenceCatalog === catalogPath, `${releaseName}: evidence-catalog path mismatch`);
  assert(evidenceArtifacts.checksumManifest === checksumPath, `${releaseName}: checksum-manifest path mismatch`);
  assert(evidenceArtifacts.releaseNotes === markdownPath, `${releaseName}: release-notes path mismatch`);
  const testReportPath = evidenceArtifacts.testReport;
  assert(typeof testReportPath === "string" && testReportPath.endsWith(".json"), `${releaseName}: test-report path must name a JSON file`);
  assert(testReportPath !== releaseRecordPath && testReportPath !== catalogPath, `${releaseName}: the test report must be separate from release metadata`);
  await ensureRepositoryPath(testReportPath, `${releaseName}.testReport`);

  const evidenceCommit = documents.revisionBoundEvidenceCommitByDirectory.get(relativeDirectory);
  assert(gitObjectPattern.test(evidenceCommit ?? ""), `${releaseName}: pre-scanned evidence commit is missing or malformed`);
  const isNewestRevisionBoundRecord = evidenceCommit === documents.newestRevisionBoundEvidenceCommit;
  const enforceCurrentHead = isNewestRevisionBoundRecord && requireHeadRevisionEvidence === "1";
  const evidenceCommitLine = (await gitText(["rev-list", "--parents", "-n", "1", evidenceCommit])).split(" ");
  assert(evidenceCommitLine.length === 2, `${releaseName}: evidence commit must be a non-merge commit with exactly one parent`);
  const evidenceParent = evidenceCommitLine[1];
  assert(evidenceCommit !== implementation.commit, `${releaseName}: implementation and evidence commits must be separate`);
  const ancestry = await runGit(["merge-base", "--is-ancestor", implementation.commit, evidenceCommit], { allowFailure: true });
  assert(ancestry.ok, `${releaseName}: implementation commit is not an ancestor of evidence commit ${evidenceCommit}`);
  const evidenceAncestry = await runGit(["merge-base", "--is-ancestor", evidenceCommit, currentHead], { allowFailure: true });
  assert(evidenceAncestry.ok, `${releaseName}: evidence commit is not an ancestor of current HEAD ${currentHead}`);

  assert(!await gitObjectExists(`${implementation.commit}:${relativeDirectory}`), `${releaseName}: release metadata already existed at the implementation revision`);
  assert(!await gitObjectExists(`${implementation.commit}:${testReportPath}`), `${releaseName}: test report already existed at the implementation revision`);
  assert(!await gitObjectExists(`${evidenceParent}:${relativeDirectory}`), `${releaseName}: release metadata existed before its evidence commit`);
  assert(!await gitObjectExists(`${evidenceParent}:${testReportPath}`), `${releaseName}: test report existed before its evidence commit`);
  assert(!expectedRevisionBoundPathRoots.some((root) => relativeDirectory === root || relativeDirectory.startsWith(`${root}/`)), `${releaseName}: evidence directory overlaps a bound implementation root`);

  const treeOutput = (await runGit([
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    implementation.commit,
    "--",
    ...implementation.boundPathRoots
  ])).stdout;
  const implementationTreeEntries = treeOutput.split("\0").filter(Boolean).map((entry) => {
    const match = /^(\d{6}) (\S+) ([0-9a-f]{40})\t(.+)$/u.exec(entry);
    assert(match, `${releaseName}: malformed git ls-tree entry`);
    const [, gitMode, gitType, gitBlob, relative] = match;
    assert(gitType === "blob", `${releaseName}: bound implementation path is not a blob: ${relative}`);
    assert(gitMode === "100644" || gitMode === "100755", `${releaseName}: unsupported bound blob mode ${gitMode}: ${relative}`);
    return { gitMode, gitBlob, path: relative };
  }).filter((entry) => !documents.revisionBoundTestReportPaths.includes(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path));
  assert(implementationTreeEntries.length > 0, `${releaseName}: bound implementation tree is empty`);
  assert(new Set(implementationTreeEntries.map((entry) => entry.path)).size === implementationTreeEntries.length, `${releaseName}: duplicate bound implementation path`);
  for (const root of implementation.boundPathRoots) {
    assert(
      implementationTreeEntries.some((entry) => entry.path === root || entry.path.startsWith(`${root}/`)),
      `${releaseName}: bound implementation root is absent at the implementation revision: ${root}`
    );
  }

  const expectedImplementationArtifacts = [];
  for (const entry of implementationTreeEntries) {
    assert(entry.path !== testReportPath, `${releaseName}: the later evidence report cannot be an implementation artifact`);
    assert(!documents.revisionBoundEvidencePaths.includes(entry.path), `${releaseName}: later revision-bound evidence cannot be an implementation artifact`);
    const implementationSha256 = await sha256GitPath(implementation.commit, entry.path);
    assert(await sha256GitPath(evidenceCommit, entry.path) === implementationSha256, `${releaseName}: bound path changed before its evidence commit: ${entry.path}`);
    if (enforceCurrentHead) {
      assert(await sha256GitPath("HEAD", entry.path) === implementationSha256, `${releaseName}: newest record's bound path changed in current HEAD: ${entry.path}`);
      assert(await sha256File(entry.path) === implementationSha256, `${releaseName}: newest record's working-tree path differs from its bound implementation blob: ${entry.path}`);
    }
    expectedImplementationArtifacts.push({
      path: entry.path,
      gitMode: entry.gitMode,
      gitBlob: entry.gitBlob,
      sha256: implementationSha256
    });
  }

  const changedBoundPathsOutput = (await runGit([
    "diff",
    "--name-only",
    "-z",
    implementation.commit,
    enforceCurrentHead ? "HEAD" : evidenceCommit,
    "--",
    ...implementation.boundPathRoots
  ])).stdout;
  const changedBoundPaths = changedBoundPathsOutput.split("\0").filter(Boolean).sort();
  const expectedChangedBoundPaths = [];
  for (const declaredReportPath of documents.revisionBoundTestReportPaths) {
    const isUnderBoundRoot = implementation.boundPathRoots.some((root) => declaredReportPath === root || declaredReportPath.startsWith(`${root}/`));
    const comparisonRevision = enforceCurrentHead ? "HEAD" : evidenceCommit;
    if (
      isUnderBoundRoot
      && await gitObjectExists(`${comparisonRevision}:${declaredReportPath}`)
      && !await gitObjectExists(`${implementation.commit}:${declaredReportPath}`)
    ) {
      expectedChangedBoundPaths.push(declaredReportPath);
    }
  }
  same(changedBoundPaths, expectedChangedBoundPaths.sort(), `${releaseName} post-implementation changes under bound roots`);

  const evidenceCommitChangedPathsOutput = (await runGit([
    "diff",
    "--name-only",
    "-z",
    evidenceParent,
    evidenceCommit
  ])).stdout;
  const evidenceCommitChangedPaths = evidenceCommitChangedPathsOutput.split("\0").filter(Boolean).sort();
  const expectedEvidenceCommitPaths = unique([
    releaseRecordPath,
    catalogPath,
    markdownPath,
    checksumPath,
    testReportPath
  ]).sort();
  same(evidenceCommitChangedPaths, expectedEvidenceCommitPaths, `${releaseName} data-only evidence commit path set`);

  const report = await readJson(testReportPath);
  same(
    Object.keys(report).sort(),
    [
      "checks",
      "claims",
      "classification",
      "implementationRevision",
      "metrics",
      "protocolLock",
      "releaseId",
      "safetyBoundaries",
      "schemaVersion",
      "terminalState",
      "testScope",
      "toolchain"
    ].sort(),
    `${releaseName} test-report keys`
  );
  assert(report.schemaVersion === "programmable.dex-evm.revision-bound-foundations-test-report/v1", `${releaseName}: test-report schema mismatch`);
  assert(report.releaseId === releaseId && report.classification === revisionBoundClassification, `${releaseName}: test-report identity mismatch`);
  assert(report.terminalState === "BLOCKED_BY_SPEC" && report.testScope === "BINDING_LOCAL_FOUNDATIONS_ONLY", `${releaseName}: test-report scope boundary mismatch`);
  same(report.implementationRevision, { commit: implementation.commit, tree: implementation.tree }, `${releaseName} test-report implementation revision`);
  assertProtocolReference(report.protocolLock, `${releaseName}.testReport.protocolLock`);
  assertRevisionBoundaries(report, `${releaseName}.testReport`);
  assert(report.toolchain !== null && typeof report.toolchain === "object" && !Array.isArray(report.toolchain), `${releaseName}: test-report toolchain must be an object`);
  same(Object.keys(report.toolchain).sort(), Object.keys(expectedRevisionBoundToolchain).sort(), `${releaseName} test-report toolchain keys`);
  for (const [tool, expectedVersion] of Object.entries(expectedRevisionBoundToolchain)) {
    assert(report.toolchain[tool] === expectedVersion, `${releaseName}: wrong exact ${tool} toolchain identity`);
  }
  assert(report.metrics !== null && typeof report.metrics === "object" && !Array.isArray(report.metrics), `${releaseName}: test-report metrics must be an object`);
  same(
    Object.keys(report.metrics).sort(),
    [...Object.keys(exactRevisionBoundMetrics), ...Object.keys(minimumRevisionBoundMetrics), ...observedRevisionBoundMetricKeys].sort(),
    `${releaseName} test-report metric keys`
  );
  for (const [metric, expectedValue] of Object.entries(exactRevisionBoundMetrics)) {
    assert(report.metrics[metric] === expectedValue, `${releaseName}: ${metric} must equal ${expectedValue}`);
  }
  for (const [metric, minimumValue] of Object.entries(minimumRevisionBoundMetrics)) {
    assert(Number.isSafeInteger(report.metrics[metric]) && report.metrics[metric] >= minimumValue, `${releaseName}: ${metric} must be at least ${minimumValue}`);
  }
  assert(
    Number.isSafeInteger(report.metrics.echidnaCalls)
      && report.metrics.echidnaCalls >= exactRevisionBoundMetrics.echidnaTestLimit,
    `${releaseName}: echidnaCalls must be an integer at or above the configured test limit`
  );
  assert(Number.isSafeInteger(report.metrics.slitherFindingsTriaged) && report.metrics.slitherFindingsTriaged >= 0, `${releaseName}: slitherFindingsTriaged must be a nonnegative integer`);
  assert(Array.isArray(report.checks) && report.checks.length === expectedRevisionBoundChecks.length, `${releaseName}: test report must contain the exact required checks`);
  assert(new Set(report.checks.map((check) => check.id)).size === report.checks.length, `${releaseName}: duplicate test-report check ID`);
  for (const [index, check] of report.checks.entries()) {
    same(Object.keys(check).sort(), ["command", "doesNotProve", "id", "result", "scope", "workingDirectory"], `${releaseName}.checks[${index}] keys`);
    const [expectedId, expectedCommand, expectedWorkingDirectory, expectedScope, expectedDoesNotProve] = expectedRevisionBoundChecks[index];
    assert(check.id === expectedId, `${releaseName}.checks[${index}]: wrong check ID`);
    assert(check.command === expectedCommand, `${releaseName}/${check.id}: wrong exact command`);
    assert(check.workingDirectory === expectedWorkingDirectory, `${releaseName}/${check.id}: wrong working directory`);
    assert(check.result === "PASS", `${releaseName}/${check.id}: result must be PASS`);
    assert(typeof check.scope === "string" && check.scope.length > 10, `${releaseName}/${check.id}: missing evidence scope`);
    assert(typeof check.doesNotProve === "string" && check.doesNotProve.length > 10, `${releaseName}/${check.id}: missing claim boundary`);
    if (expectedScope !== undefined) {
      assert(check.scope === expectedScope, `${releaseName}/${check.id}: wrong exact evidence scope`);
      assert(check.doesNotProve === expectedDoesNotProve, `${releaseName}/${check.id}: wrong exact claim boundary`);
    }
  }

  same(
    Object.keys(catalog).sort(),
    [
      "boundPathRoots",
      "claims",
      "classification",
      "implementationArtifacts",
      "implementationRevision",
      "releaseId",
      "safetyBoundaries",
      "schemaVersion",
      "terminalState",
      "testReport"
    ].sort(),
    `${releaseName} revision evidence-catalog keys`
  );
  assert(catalog.schemaVersion === "programmable.dex-evm.revision-bound-foundations-evidence-catalog/v1", `${releaseName}: revision evidence-catalog schema mismatch`);
  assert(catalog.classification === revisionBoundClassification && catalog.terminalState === "BLOCKED_BY_SPEC", `${releaseName}: revision evidence-catalog boundary mismatch`);
  same(catalog.implementationRevision, { commit: implementation.commit, tree: implementation.tree }, `${releaseName} catalog implementation revision`);
  same(catalog.boundPathRoots, implementation.boundPathRoots, `${releaseName} catalog bound roots`);
  same(catalog.implementationArtifacts, expectedImplementationArtifacts, `${releaseName} exact implementation artifact catalog`);
  same(
    catalog.testReport,
    {
      path: testReportPath,
      sha256: await sha256File(testReportPath),
      status: "PRESENT_REVISION_BOUND_FOUNDATIONS_TEST_EVIDENCE"
    },
    `${releaseName} catalog test-report binding`
  );
  assertRevisionBoundaries(catalog, `${releaseName}.catalog`);

  const releaseFiles = await walkFiles(relativeDirectory);
  const expectedReleaseFiles = [releaseRecordPath, catalogPath, markdownPath, checksumPath];
  if (testReportPath === relativeDirectory || testReportPath.startsWith(`${relativeDirectory}/`)) expectedReleaseFiles.push(testReportPath);
  same(releaseFiles, expectedReleaseFiles.sort(), `${releaseName} exact release-directory file set`);
  await validateChecksumFile(checksumPath, relativeDirectory);

  const immutableEvidencePaths = unique([...releaseFiles, testReportPath]);
  assert(
    (await runGit(["diff", "--quiet", evidenceCommit, "HEAD", "--", ...immutableEvidencePaths], { allowFailure: true })).ok,
    `${releaseName}: evidence content or modes changed after its evidence commit`
  );
  assert(
    (await runGit(["diff", "--quiet", "HEAD", "--", ...immutableEvidencePaths], { allowFailure: true })).ok,
    `${releaseName}: evidence has unstaged working-tree changes`
  );
  assert(
    (await runGit(["diff", "--cached", "--quiet", "HEAD", "--", ...immutableEvidencePaths], { allowFailure: true })).ok,
    `${releaseName}: evidence has staged index changes`
  );
  for (const evidencePath of immutableEvidencePaths) {
    assert(await gitObjectExists(`${evidenceCommit}:${evidencePath}`), `${releaseName}: evidence path is absent from its evidence commit: ${evidencePath}`);
    const committedEvidenceSha256 = await sha256GitPath(evidenceCommit, evidencePath);
    assert(await sha256GitPath("HEAD", evidencePath) === committedEvidenceSha256, `${releaseName}: evidence path changed after its evidence commit: ${evidencePath}`);
    assert(await sha256File(evidencePath) === committedEvidenceSha256, `${releaseName}: working-tree evidence differs from its evidence commit: ${evidencePath}`);
  }

  if (enforceCurrentHead) await validateMarkdownLinks(markdownPath);
  else await validateMarkdownLinksAtGitRevision(markdownPath, evidenceCommit);
  for (const [document, label] of [[release, releaseRecordPath], [catalog, catalogPath], [report, testReportPath]]) {
    validateSha256Strings(document, label);
  }
  documents.releaseRecords.push(release);
  documents.revisionBoundReleaseRecords.push(release);
}

async function validateReleaseDirectory(relativeDirectory, documents) {
  const releaseName = path.posix.basename(relativeDirectory);
  const releaseRecordPath = `${relativeDirectory}/release-record.json`;
  const catalogPath = `${relativeDirectory}/evidence-catalog.json`;
  const markdownPath = `${relativeDirectory}/RELEASE.md`;
  const release = await readJson(releaseRecordPath);
  const catalog = await readJson(catalogPath);
  await ensureRepositoryPath(markdownPath, markdownPath);

  if (release.schemaVersion === "programmable.dex-evm.revision-bound-foundations-evidence-release/v1") {
    await validateRevisionBoundReleaseDirectory(relativeDirectory, documents, release, catalog, markdownPath);
    return;
  }

  const releaseId = `dex-evm/${releaseName}`;
  assert(release.schemaVersion === "programmable.dex-evm.architecture-baseline-release/v1", `${releaseName}: release schema mismatch`);
  assert(release.releaseId === releaseId && catalog.releaseId === releaseId, `${releaseName}: release ID mismatch`);
  assert(release.classification === "NON_PRODUCTION_ARCHITECTURE_BASELINE" && catalog.classification === release.classification, `${releaseName}: classification mismatch`);
  assert(release.terminalState === "BLOCKED_BY_SPEC" && release.productionEligible === false, `${releaseName}: release must remain non-production BLOCKED_BY_SPEC`);
  assert(release.sourceRevision?.status === "INTENTIONALLY_UNBOUND_ARCHITECTURE_SNAPSHOT", `${releaseName}: source revision boundary mismatch`);
  assert(!Object.hasOwn(release.sourceRevision, "commit") && !Object.hasOwn(release.sourceRevision, "tree"), `${releaseName}: architecture snapshot must not claim a source revision`);
  assertProtocolReference(release.protocolLock, `${releaseName}.protocolLock`);
  assert(release.scope?.implementationClaim === "NONE_SOURCE_REVISION_UNBOUND", `${releaseName}: architecture implementation-claim boundary mismatch`);
  assert(
    release.scope?.domainVaultFundingDisposition === "NO_CORE_RELEASE_PATH_DO_NOT_FUND_OR_DEPLOY_FOR_CUSTODY_OR_CANONICAL_USE",
    `${releaseName}: DomainVault funding/deployment boundary mismatch`
  );

  const expectedReleaseArtifacts = {
    evidenceCatalog: catalogPath,
    generatedFoundationsAbi: "packages/dex-evm/binding/abi/foundations.generated.json",
    generatedFoundationsBuildInventory: "packages/dex-evm/binding/reports/build-artifacts.generated.json",
    bindingNativeFoundationVectors: "packages/dex-evm/binding/vectors/foundations-v1.json",
    bindingLocalAssetFoundationVectors: "packages/dex-evm/binding/vectors/asset-foundations-v1.json",
    conformanceStatus: "packages/dex-evm/binding/reports/conformance-status.json",
    requirementTraceability: "packages/dex-evm/binding/reports/requirement-traceability.json",
    protocolGapReport: "packages/dex-evm/binding/reports/protocol-gap-report.json"
  };
  same(release.releaseArtifacts, expectedReleaseArtifacts, `${releaseName} release artifacts`);
  assert(release.bindingReleasePublished === false && release.conformanceReportPublished === false, `${releaseName}: Binding/Conformance claims must be false`);
  same(release.portableProfileClaims, [], `${releaseName} portable profile claims`);
  assert(release.independentAuditCompleted === false && release.securityContestCompleted === false, `${releaseName}: audit/contest claims must be false`);
  assert(release.deployment?.robinhoodMainnet === "BLOCKED_BY_SPEC_NOT_DEPLOYED", `${releaseName}: mainnet deployment boundary mismatch`);
  assert(release.deployment?.robinhoodTestnet === "PRE_OWNER_GATE_READ_ONLY_PREPARATION_BLOCKED_BY_SPEC_NOT_DEPLOYED", `${releaseName}: testnet deployment boundary mismatch`);
  same(release.prohibitedClaims, ["Binding Release", "Conformance Report", "testnet candidate", "production candidate", "production eligible", "deployed", "audited"], `${releaseName} prohibited claims`);

  assert(catalog.schemaVersion === "programmable.dex-evm.evidence-catalog/v1", `${releaseName}: evidence catalog schema mismatch`);
  same(catalog.entries.map((entry) => [entry.id, entry.path, entry.status]), expectedCatalogEntries, `${releaseName} evidence entries`);
  assert(new Set(catalog.entries.map((entry) => entry.id)).size === catalog.entries.length, `${releaseName}: duplicate evidence entry ID`);
  for (const entry of catalog.entries) {
    assert(typeof entry.proves === "string" && entry.proves.length > 10, `${releaseName}/${entry.id}: missing proves boundary`);
    assert(typeof entry.doesNotProve === "string" && entry.doesNotProve.length > 10, `${releaseName}/${entry.id}: missing does-not-prove boundary`);
    await ensureRepositoryPath(entry.path, `${releaseName}/${entry.id}`);
  }
  same(catalog.absentEvidence, expectedAbsentEvidence, `${releaseName} absent evidence`);
  assert(catalog.placeholderPolicy === "No unresolved placeholder, null/example address, invented digest or missing artifact is counted as evidence.", `${releaseName}: placeholder policy mismatch`);

  await validateMarkdownLinks(markdownPath);
  await validateLocalStringReferences(release, releaseRecordPath);
  await validateLocalStringReferences(catalog, catalogPath);
  validateSha256Strings(release, releaseRecordPath);
  validateSha256Strings(catalog, catalogPath);

  const checksumFiles = await walkFiles(relativeDirectory, (relative) => path.posix.basename(relative) === "SHA256SUMS");
  for (const checksumFile of checksumFiles) await validateChecksumFile(checksumFile, relativeDirectory);
  documents.releaseRecords.push(release);
}

async function validateChecksumFile(relative, releaseDirectory) {
  const target = await ensureRepositoryPath(relative, relative);
  const lines = (await readFile(target.absolute, "utf8")).split(/\r?\n/u).filter((line) => line && !line.startsWith("#"));
  assert(lines.length > 0, `${relative}: checksum manifest is empty`);
  const requiredTargets = (await walkFiles(
    releaseDirectory,
    (candidate) => path.posix.basename(candidate) !== "SHA256SUMS"
  )).sort();
  const seen = new Set();
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/u.exec(line);
    assert(match, `${relative}: malformed checksum line`);
    const declaredPath = match[2];
    assert(!path.posix.isAbsolute(declaredPath), `${relative}: absolute checksum target is forbidden`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), declaredPath));
    assert(resolved === releaseDirectory || resolved.startsWith(`${releaseDirectory}/`), `${relative}: checksum target escapes its release`);
    assert(path.posix.basename(resolved) !== "SHA256SUMS", `${relative}: a checksum manifest must not checksum itself or another checksum manifest`);
    assert(!seen.has(resolved), `${relative}: duplicate checksum target ${declaredPath}`);
    seen.add(resolved);
    assert(await sha256File(resolved) === `sha256:${match[1]}`, `${relative}: checksum mismatch for ${declaredPath}`);
  }
  same([...seen].sort(), requiredTargets, `${relative} exact checksum target set`);
}

async function validateClaimBoundaries(documents) {
  const { mainnetDeployment, testnetPreparation, conformance, traceability, abiBundle, buildReport, assetVectors, portableSnapshot } = documents;
  const termsEvidenceBoundary = "No owner-provided acceptance record or click-through acceptance action is present. Whether access to official documentation, public RPC, testnet or explorer services has legal effect under applicable Terms is not assessed here.";
  for (const [label, record] of [
    ["Mainnet", mainnetDeployment],
    ["Testnet", testnetPreparation]
  ]) {
    assert(!Object.hasOwn(record, "externalTermsAcceptance"), `${label} categorical externalTermsAcceptance claims are forbidden`);
    const terms = record.externalTermsEvidence;
    assert(terms !== null && typeof terms === "object" && !Array.isArray(terms), `${label} externalTermsEvidence must be an object`);
    same(
      Object.keys(terms).sort(),
      ["clickThroughAcceptanceAttempted", "evidenceBoundary", "legalEffectOfReadOnlyAccess", "ownerAcceptanceRecordPresent"],
      `${label} externalTermsEvidence exact keys`
    );
    assert(terms.ownerAcceptanceRecordPresent === false, `${label} ownerAcceptanceRecordPresent must be false`);
    assert(terms.clickThroughAcceptanceAttempted === false, `${label} clickThroughAcceptanceAttempted must be false`);
    assert(terms.legalEffectOfReadOnlyAccess === "NOT_ASSESSED", `${label} legalEffectOfReadOnlyAccess must be NOT_ASSESSED`);
    assert(terms.evidenceBoundary === termsEvidenceBoundary, `${label} Terms evidence boundary mismatch`);
    assert(record.custodySafety?.deployForCustody === false, `${label} custodySafety.deployForCustody must be false`);
    assert(record.custodySafety?.fundCanonicalVaults === false, `${label} custodySafety.fundCanonicalVaults must be false`);
  }
  assert(mainnetDeployment.terminalState === "BLOCKED_BY_SPEC" && mainnetDeployment.classification === "NONE", "Mainnet deployment status boundary mismatch");
  for (const key of [
    "canonicalNetworkDeploymentOccurred",
    "canonicalExplorerSourceVerificationOccurred",
    "canonicalDeploymentRuntimeReadbackOccurred",
  ]) {
    assert(mainnetDeployment[key] === false, `Mainnet ${key} must be false`);
  }
  assertProtocolReference(mainnetDeployment.protocolLock, "mainnet deployment Protocol lock", { tree: false, constitution: false, vectors: false });

  assert(testnetPreparation.preparationState === "PRE_OWNER_GATE_READ_ONLY_PREPARATION" && testnetPreparation.terminalState === "BLOCKED_BY_SPEC" && testnetPreparation.classification === "NONE", "Testnet preparation boundary mismatch");
  for (const key of [
    "ownerGateClaimed",
    "ownerActionRequested",
    "unsignedTransactionPackageCreated",
    "ownerTransactionSigned",
    "canonicalNetworkTransactionBroadcast",
    "canonicalNetworkDeploymentOccurred",
    "canonicalExplorerSourceVerificationOccurred",
    "canonicalDeploymentRuntimeReadbackOccurred"
  ]) {
    assert(testnetPreparation[key] === false, `Testnet ${key} must be false`);
  }
  assertProtocolReference(testnetPreparation.protocolLock, "testnet deployment Protocol lock", { tree: false, constitution: false, vectors: false });
  assert(conformance.bindingRelease.published === false && conformance.conformanceReport.published === false, "Conformance claims changed unexpectedly");
  assert(traceability.coverageBoundary?.claims175Of175ImplementationCoverage === false, "Traceability must not claim complete implementation coverage");
  assert(traceability.coverageBoundary?.claimsConformanceCoverage === false && traceability.coverageBoundary?.claimsTestExecution === false, "Traceability must not claim conformance or execution evidence");
  assert(abiBundle.claims.deployment === false && buildReport.claims.deployment === false, "Generated artifacts must not claim deployment");
  assert(assetVectors.claims.asset_profile_conformance === false && portableSnapshot.portable_conformance_claim === false, "Vector artifacts must not claim conformance");
}

async function main() {
  assert(
    requireHeadRevisionEvidence === "0" || requireHeadRevisionEvidence === "1",
    "PROGRAMMABLE_DEX_REQUIRE_HEAD_REVISION_EVIDENCE must be exactly 0 or 1"
  );
  const releaseRoot = await ensureRepositoryPath("releases/dex-evm", "DEX release root");
  assert(releaseRoot.info.isDirectory(), "releases/dex-evm must be a directory");

  const documents = {
    protocolLock: await readJson(`${packageRelative}/binding/protocol-lock.json`),
    lockVerification: await readJson(`${packageRelative}/binding/reports/protocol-lock-verification.json`),
    gapReport: await readJson(`${packageRelative}/binding/reports/protocol-gap-report.json`),
    traceability: await readJson(`${packageRelative}/binding/reports/requirement-traceability.json`),
    conformance: await readJson(`${packageRelative}/binding/reports/conformance-status.json`),
    foundations: await readJson(`${packageRelative}/binding/vectors/foundations-v1.json`),
    assetVectors: await readJson(`${packageRelative}/binding/vectors/asset-foundations-v1.json`),
    nativeProfile: await readJson(`${packageRelative}/binding/profiles/asset.native-eth-strict.v1.json`),
    erc20Profile: await readJson(`${packageRelative}/binding/profiles/asset.erc20-strict-measured.v1.json`),
    unsupportedAssets: await readJson(`${packageRelative}/binding/profiles/asset.unsupported.v1.json`),
    portableSnapshot: await readJson(`${packageRelative}/binding/vectors/portable-snapshot-lock.json`),
    abiBundle: await readJson(`${packageRelative}/binding/abi/foundations.generated.json`),
    buildReport: await readJson(`${packageRelative}/binding/reports/build-artifacts.generated.json`),
    mainnetNetwork: await readJson("config/networks/robinhood-chain/4663.json"),
    testnetNetwork: await readJson("config/networks/robinhood-chain/46630.json"),
    mainnetDeployment: await readJson("deployments/dex/robinhood/4663/deployment-status.json"),
    testnetPreparation: await readJson("deployments/dex/robinhood/46630/preparation-status.json"),
    releaseRecords: [],
    newestRevisionBoundEvidenceCommit: null,
    revisionBoundEvidenceCommitByDirectory: new Map(),
    revisionBoundReleaseRecords: [],
    revisionBoundEvidencePaths: [],
    revisionBoundTestReportPaths: []
  };

  await validateProtocolAndGaps(documents);
  await validateAssets(documents);
  await validateGeneratedDigests(documents);
  await validatePortableSnapshot(documents);
  await validateClaimBoundaries(documents);

  for (const [label, network] of [["mainnet network", documents.mainnetNetwork], ["testnet network", documents.testnetNetwork]]) {
    assert(network.operatorConfiguration?.publicRpcProductionSuitable === false, `${label}: public RPC must not be classified production-suitable`);
    for (const resource of Object.values(network.bootstrap ?? {})) {
      if (resource !== null && typeof resource === "object" && Object.hasOwn(resource, "digest")) {
        assert(typeof resource.url === "string" && resource.url.startsWith("https://"), `${label}: external digest lacks an HTTPS source`);
        assert(sha256Pattern.test(resource.digest), `${label}: malformed external resource digest`);
        assert(
          resource.digestEvidenceClass === "LOCALLY_COMPUTED_SHA256_SNAPSHOT_OF_OFFICIAL_CDN_BYTES_NOT_AN_OFFICIAL_CHECKSUM",
          `${label}: bootstrap digest must remain a locally computed snapshot, not an official checksum claim`
        );
      }
    }
  }

  const releaseEntries = await readdir(path.join(repositoryRoot, "releases", "dex-evm"), { withFileTypes: true });
  assert(releaseEntries.length > 0, "releases/dex-evm contains no release record");
  const sortedReleaseEntries = releaseEntries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of sortedReleaseEntries) {
    assert(entry.isDirectory() && !entry.isSymbolicLink(), `Unexpected release-root entry: ${entry.name}`);
    const relativeDirectory = `releases/dex-evm/${entry.name}`;
    const release = await readJson(`${relativeDirectory}/release-record.json`);
    if (release.schemaVersion !== "programmable.dex-evm.revision-bound-foundations-evidence-release/v1") continue;
    const testReportPath = release.evidenceArtifacts?.testReport;
    assert(typeof testReportPath === "string", `${entry.name}: revision-bound test-report path is missing`);
    await ensureRepositoryPath(testReportPath, `${entry.name}.testReport`);
    assert(!documents.revisionBoundTestReportPaths.includes(testReportPath), `${entry.name}: revision-bound test-report path is reused by another release`);
    const evidenceCommitCandidates = (await gitText([
      "log",
      "--format=%H",
      "--diff-filter=A",
      "HEAD",
      "--",
      `${relativeDirectory}/release-record.json`
    ])).split("\n").filter(Boolean);
    assert(evidenceCommitCandidates.length === 1, `${entry.name}: release record must have one unique add commit in HEAD history`);
    const evidenceCommit = evidenceCommitCandidates[0];
    assert(gitObjectPattern.test(evidenceCommit), `${entry.name}: discovered evidence commit is malformed`);
    assert(
      ![...documents.revisionBoundEvidenceCommitByDirectory.values()].includes(evidenceCommit),
      `${entry.name}: each revision-bound release must have a distinct data-only evidence commit`
    );
    documents.revisionBoundEvidenceCommitByDirectory.set(relativeDirectory, evidenceCommit);
    documents.revisionBoundTestReportPaths.push(testReportPath);
    documents.revisionBoundEvidencePaths.push(
      `${relativeDirectory}/RELEASE.md`,
      `${relativeDirectory}/SHA256SUMS`,
      `${relativeDirectory}/evidence-catalog.json`,
      `${relativeDirectory}/release-record.json`,
      testReportPath
    );
  }
  documents.revisionBoundTestReportPaths.sort();
  documents.revisionBoundEvidencePaths = unique(documents.revisionBoundEvidencePaths).sort();
  if (requireHeadRevisionEvidence === "1") {
    assert(documents.revisionBoundEvidenceCommitByDirectory.size > 0, "HEAD revision evidence was required, but no revision-bound evidence record exists");
  }
  for (const evidenceCommit of documents.revisionBoundEvidenceCommitByDirectory.values()) {
    if (documents.newestRevisionBoundEvidenceCommit === null) {
      documents.newestRevisionBoundEvidenceCommit = evidenceCommit;
      continue;
    }
    const currentNewestIsAncestor = await runGit(
      ["merge-base", "--is-ancestor", documents.newestRevisionBoundEvidenceCommit, evidenceCommit],
      { allowFailure: true }
    );
    if (currentNewestIsAncestor.ok) {
      documents.newestRevisionBoundEvidenceCommit = evidenceCommit;
      continue;
    }
    const evidenceCommitIsAncestor = await runGit(
      ["merge-base", "--is-ancestor", evidenceCommit, documents.newestRevisionBoundEvidenceCommit],
      { allowFailure: true }
    );
    assert(evidenceCommitIsAncestor.ok, "Revision-bound evidence commits must form one ancestry-ordered history");
  }

  for (const entry of sortedReleaseEntries) {
    assert(entry.isDirectory() && !entry.isSymbolicLink(), `Unexpected release-root entry: ${entry.name}`);
    await validateReleaseDirectory(`releases/dex-evm/${entry.name}`, documents);
  }

  const markdownFiles = [
    ...(await walkFiles("docs/dex-evm", (relative) => relative.endsWith(".md"))),
    "docs/security/DEX_EVM_PROPERTIES.md"
  ];
  for (const markdown of markdownFiles) await validateMarkdownLinks(markdown);

  const referenceJsonRoots = [
    "releases/dex-evm",
    "deployments/dex/robinhood",
    "config/networks/robinhood-chain",
    `${packageRelative}/binding/reports`,
    `${packageRelative}/binding/profiles`
  ];
  const referenceJsonFiles = [];
  for (const root of referenceJsonRoots) {
    referenceJsonFiles.push(...await walkFiles(root, (relative) => relative.endsWith(".json")));
  }
  referenceJsonFiles.push(
    `${packageRelative}/binding/protocol-lock.json`,
    `${packageRelative}/binding/abi/foundations.generated.json`,
    `${packageRelative}/binding/vectors/foundations-v1.json`,
    `${packageRelative}/binding/vectors/asset-foundations-v1.json`,
    `${packageRelative}/binding/vectors/portable-snapshot-lock.json`
  );
  for (const relative of unique(referenceJsonFiles)) {
    const document = await readJson(relative);
    validateSha256Strings(document, relative);
    const revisionBoundSchema = [
      "programmable.dex-evm.revision-bound-foundations-evidence-release/v1",
      "programmable.dex-evm.revision-bound-foundations-evidence-catalog/v1",
      "programmable.dex-evm.revision-bound-foundations-test-report/v1"
    ].includes(document.schemaVersion);
    if (!revisionBoundSchema) await validateLocalStringReferences(document, relative);
  }

  process.stdout.write(
    `DEX release/evidence closure verified: ${documents.releaseRecords.length} record(s) (${documents.revisionBoundReleaseRecords.length} revision-bound record(s)), 18 architecture catalog entries, `
    + `12 ordered gaps plus one non-gap sentinel, 14 asset cases, 11 snapshot checksums, HEAD evidence gate ${requireHeadRevisionEvidence === "1" ? "enabled" : "disabled"}, and no Binding Release, canonical-network deployment, or audit claim.\n`
  );
}

main().catch((error) => {
  process.stderr.write(`DEX release/evidence verification failed: ${error.message}\n`);
  process.exitCode = 1;
});
