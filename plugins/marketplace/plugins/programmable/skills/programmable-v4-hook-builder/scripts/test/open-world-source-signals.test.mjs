import assert from "node:assert/strict";
import test from "node:test";
import { analyzeOpenWorldSecurity } from "../open-world-security-core.mjs";
import {
  buildOpenWorldSourceLayer,
  extractOpenWorldSourceSignals,
  OPEN_WORLD_SOURCE_SIGNAL_IDS
} from "../open-world-source-signals-core.mjs";

test("absence remains unknown and can never become a safe or launch-approved result", () => {
  const input = deepFreeze({
    subject: { id: "empty-hook", revision: "abc123" },
    sources: {
      "src/EmptyHook.sol": "pragma solidity ^0.8.26; contract EmptyHook {}"
    }
  });
  const before = JSON.stringify(input);
  const report = extractOpenWorldSourceSignals(input);

  assert.equal(JSON.stringify(input), before, "extraction must not mutate its input");
  assert.equal(report.launchAuthorization, "NOT_GRANTED");
  assert.deepEqual(report.observedSignalIds, []);
  assert.deepEqual(report.unknownSignalIds, OPEN_WORLD_SOURCE_SIGNAL_IDS);
  assert.ok(report.signals.every(({ state, value }) => state === "unknown" && value === null));
  assert.deepEqual(report.sourceLayer, {});
  assertNoFalse(report);
});

test("Solidity text emits additive indicators for every high-risk source family", () => {
  const report = extractOpenWorldSourceSignals({
    subject: { id: "signal-fixture" },
    sources: [{
      path: "src/SignalFixture.sol",
      content: `
pragma solidity ^0.8.26;

contract SignalFixture is UUPSUpgradeable {
    mapping(bytes32 => bool) public usedNonces;

    modifier onlyPoolManager() {
        require(msg.sender == address(poolManager));
        _;
    }

    function beforeSwap(bytes calldata data) external onlyPoolManager returns (bytes4) {
        require(msg.sender == address(poolManager));
        return this.beforeSwap.selector;
    }

    function legacyOwner() external view returns (address) {
        return tx.origin;
    }

    function execute(address target, bytes calldata data) external {
        target.delegatecall(data);
        target.call(data);
        target.staticcall(data);
    }

    function _authorizeUpgrade(address next) internal {}

    function rescueToken(address token) external {}

    function draw(bytes32 digest, bytes calldata signature) external returns (uint256) {
        require(!usedNonces[digest]);
        usedNonces[digest] = true;
        address signer = ecrecover(digest, 27, digest, digest);
        return uint256(blockhash(block.number - 1)) ^ block.timestamp ^ block.prevrandao ^ uint160(signer);
    }

    function stuck() external pure {
        while (true) {}
    }
}`
    }]
  });

  assert.deepEqual(
    new Set(report.observedSignalIds),
    new Set(OPEN_WORLD_SOURCE_SIGNAL_IDS.filter((id) => id !== "callback.pool-manager-guard-unverified"))
  );
  assert.equal(report.signals.filter(({ state }) => state === "observed").every(({ value }) => value === true), true);
  assert.deepEqual(Object.keys(report.sourceLayer), ["evidenceRefs"]);
  assert.ok(report.sourceLayer.evidenceRefs.length > 0);
  assert.ok(report.automatedFindings.length > 0);
  assert.ok(report.automatedFindings.every(({ status, language, rule, source }) => (
    status === "automated"
    && language === "solidity"
    && rule.scope === "solidity"
    && source.tool === "open-world-source-signals"
    && /^sha256:[0-9a-f]{64}$/u.test(source.reportSha256)
  )));
  assert.deepEqual(report.unmappedObservedSignalIds, []);
  assert.ok(report.signals.every(({ evidenceRefs }) => new Set(evidenceRefs).size === evidenceRefs.length));
  assertNoFalse(report);
});

test("comments and string literals cannot manufacture source evidence", () => {
  const report = extractOpenWorldSourceSignals({
    sources: {
      "src/CommentOnly.sol": `
pragma solidity ^0.8.26;
contract CommentOnly {
    // tx.origin target.delegatecall(data) block.prevrandao rescueToken(); while (true) {}
    string internal constant TEXT = "blockhash(0) ecrecover onlyPoolManager usedNonce";
    /* function beforeSwap() external onlyPoolManager {} */
    function ordinaryHook(bytes calldata) external pure returns (bytes4) {
        return bytes4(0);
    }
}`
    }
  });

  assert.deepEqual(report.observedSignalIds, []);
  assert.ok(report.signals.every(({ state }) => state === "unknown"));
  assert.equal(report.sourceLayer.callbackAuth, undefined);
});

test("open source-language identities stay exact and non-Solidity text never enters Solidity rules", () => {
  const solidityLookalikes = `
function beforeSwap() { target.delegatecall(data); }
while (true) { tx.origin; block.prevrandao; }
`;
  const report = extractOpenWorldSourceSignals({
    sources: [
      { path: "programs/hook/src/lib.rs", language: "rust", content: solidityLookalikes },
      { path: "packages/sdk/src/router.ts", language: "typescript", content: solidityLookalikes },
      { path: "packages/sdk/src/router.js", language: "javascript", content: solidityLookalikes },
      { path: "scripts/check.py", language: "python", content: solidityLookalikes },
      { path: "programs/mismatch/src/lib.rs", language: "solidity", content: solidityLookalikes },
      { path: "services/settler.go", language: "golang", content: solidityLookalikes },
      { path: "contracts/novel.cairo", language: "cairo", content: solidityLookalikes }
    ],
    buildInfo: {
      output: {
        sources: {
          "programs/fake-ast/src/lib.rs": {
            ast: {
              nodeType: "SourceUnit",
              nodes: [{
                nodeType: "FunctionCall",
                expression: { nodeType: "MemberAccess", memberName: "delegatecall" }
              }]
            }
          }
        }
      }
    }
  });

  assert.deepEqual(report.observedSignalIds, []);
  assert.equal(report.stats.scannedSources, 0);
  assert.equal(report.stats.routedToReviewSources, 7);
  assert.equal(report.stats.routedToReviewAsts, 1);
  assert.equal(report.automatedFindings.length, 8);
  assert.deepEqual(report.automatedFindings.map(({ language }) => language), [
    "rust",
    "typescript",
    "javascript",
    "python",
    "solidity",
    "go",
    "cairo",
    "rust"
  ]);
  assert.ok(report.automatedFindings.every(({ status, rule, language }) => status === "partial" && rule.scope === language));
  assert.ok(report.diagnostics.some(({ code }) => code === "SOURCE_LANGUAGE_PATH_MISMATCH"));
  assert.ok(report.diagnostics.filter(({ code }) => code === "SOURCE_SCAN_LANGUAGE_REVIEW_REQUIRED").length === 7);
  assert.deepEqual(report.sourceLayer, {});
});

test("lookalike controls stay conservative: names and ordinary deadlines do not prove safety or randomness", () => {
  const report = extractOpenWorldSourceSignals({
    sources: {
      "src/Lookalikes.sol": `
pragma solidity ^0.8.26;
contract Lookalikes {
    modifier onlyPoolManager() { _; }
    function beforeSwap(bytes calldata) external onlyPoolManager returns (bytes4) {
        return this.beforeSwap.selector;
    }
    function expired(uint256 deadline) external view returns (bool) {
        return block.timestamp > deadline;
    }
    function fixedWork() external pure returns (uint256 total) {
        for (uint256 i; i < 4; ++i) total += i;
    }
}`
    }
  });

  assertSignal(report, "callback.pool-manager-only-guard", "observed");
  assertSignal(report, "callback.pool-manager-guard-unverified", "observed");
  assert.equal(report.sourceLayer.callbackAuth, undefined, "automated names and guards must not become objective source-layer facts");
  assert.ok(report.automatedFindings.some(({ rule }) => rule.id === "callback.pool-manager-only-guard"));
  assert.ok(report.automatedFindings.some(({ rule }) => rule.id === "callback.pool-manager-guard-unverified"));
  assertSignal(report, "randomness.block-timestamp", "unknown");
  assertSignal(report, "loop.unbounded-risk-indicator", "unknown");
});

test("one guarded callback cannot hide another callback whose guard is unverified", () => {
  const report = extractOpenWorldSourceSignals({
    sources: {
      "src/MixedCallbacks.sol": `
pragma solidity ^0.8.26;
contract MixedCallbacks {
    function beforeSwap(bytes calldata) external returns (bytes4) {
        require(msg.sender == address(poolManager));
        return this.beforeSwap.selector;
    }
    function afterSwap(bytes calldata) external returns (bytes4) {
        return this.afterSwap.selector;
    }
}`
    }
  });

  assertSignal(report, "callback.pool-manager-only-guard", "observed");
  assertSignal(report, "callback.pool-manager-guard-unverified", "observed");
  assert.equal(report.sourceLayer.callbackAuth, undefined);
  assert.ok(report.automatedFindings.some(({ rule }) => rule.id === "callback.pool-manager-only-guard"));
  assert.ok(report.automatedFindings.some(({ rule }) => rule.id === "callback.pool-manager-guard-unverified"));
});

test("internal BaseHook implementation functions are not mistaken for public callback entry points", () => {
  const report = extractOpenWorldSourceSignals({
    sources: {
      "src/InternalHook.sol": `
pragma solidity ^0.8.26;
contract InternalHook is BaseHook {
    function _beforeSwap(bytes calldata) internal override returns (bytes4) {
        return this.beforeSwap.selector;
    }
}`
    }
  });

  assertSignal(report, "callback.pool-manager-only-guard", "unknown");
  assertSignal(report, "callback.pool-manager-guard-unverified", "unknown");
  assert.equal(report.sourceLayer.callbackAuth, undefined);
});

test("solc build-info ASTs work without source text and still never infer false", () => {
  const report = extractOpenWorldSourceSignals({
    buildInfo: {
      output: {
        sources: {
          "src/AstOnly.sol": {
            ast: {
              nodeType: "SourceUnit",
              src: "0:0:0",
              nodes: [
                {
                  nodeType: "FunctionDefinition",
                  name: "beforeSwap",
                  visibility: "external",
                  src: "10:20:0",
                  modifiers: [{
                    nodeType: "ModifierInvocation",
                    modifierName: { nodeType: "Identifier", name: "onlyPoolManager" }
                  }]
                },
                {
                  nodeType: "MemberAccess",
                  memberName: "origin",
                  expression: { nodeType: "Identifier", name: "tx" },
                  src: "40:9:0"
                },
                {
                  nodeType: "FunctionCall",
                  expression: {
                    nodeType: "MemberAccess",
                    memberName: "delegatecall",
                    expression: { nodeType: "Identifier", name: "target" }
                  },
                  src: "60:20:0"
                },
                {
                  nodeType: "ForStatement",
                  condition: null,
                  src: "90:10:0"
                }
              ]
            }
          }
        }
      }
    }
  });

  for (const signalId of [
    "callback.pool-manager-only-guard",
    "authorization.tx-origin",
    "external-call.delegatecall",
    "loop.unbounded-risk-indicator"
  ]) {
    assertSignal(report, signalId, "observed");
  }
  assertSignal(report, "external-call.low-level", "unknown");
  assert.equal(report.stats.suppliedSources, 0);
  assert.equal(report.stats.suppliedAsts, 1);
  assert.ok(report.signals.flatMap(({ evidenceRefs }) => evidenceRefs).some((ref) => ref.includes("#ast-")));
  assertNoFalse(report);
});

test("scan limits fail to unknown and never treat skipped source as clean", () => {
  const report = extractOpenWorldSourceSignals({
    sources: {
      "src/TooLarge.sol": "contract TooLarge { function owner() external { tx.origin; } }"
    }
  }, { maxSourceBytes: 1 });

  assert.equal(report.stats.scannedSources, 0);
  assert.ok(report.diagnostics.some(({ code }) => code === "SOURCE_SCAN_LIMIT_REACHED"));
  assertSignal(report, "authorization.tx-origin", "unknown");
  assert.equal(report.launchAuthorization, "NOT_GRANTED");

  const astReport = extractOpenWorldSourceSignals({
    buildInfo: {
      output: {
        sources: {
          "src/LimitedAst.sol": {
            ast: {
              nodeType: "SourceUnit",
              nodes: [{
                nodeType: "MemberAccess",
                memberName: "origin",
                expression: { nodeType: "Identifier", name: "tx" }
              }]
            }
          }
        }
      }
    }
  }, { maxAstNodes: 1 });
  assert.ok(astReport.diagnostics.some(({ code }) => code === "AST_SCAN_LIMIT_REACHED"));
  assertSignal(astReport, "authorization.tx-origin", "unknown");
  assert.equal(astReport.launchAuthorization, "NOT_GRANTED");
});

test("invalid scanner input degrades to unknown instead of throwing or approving", () => {
  const report = extractOpenWorldSourceSignals(null, null);

  assert.ok(report.diagnostics.some(({ code }) => code === "SOURCE_SCAN_INPUT_INVALID"));
  assert.ok(report.signals.every(({ state, value }) => state === "unknown" && value === null));
  assert.equal(report.launchAuthorization, "NOT_GRANTED");
});

test("the bridge carries automated Solidity observations into independent review without granting launch", () => {
  const scan = extractOpenWorldSourceSignals({
    sources: {
      "src/RandomHook.sol": `
pragma solidity ^0.8.26;
contract RandomHook {
    function draw() external view returns (uint256) {
        return block.prevrandao;
    }
}`
    }
  });
  const sourceLayer = buildOpenWorldSourceLayer(scan);
  const envelope = assessedEnvelope({
    id: "random-hook",
    stage: "prototype",
    layers: {
      source: sourceLayer
    }
  });
  envelope.automatedFindings = scan.automatedFindings;
  const report = analyzeOpenWorldSecurity(envelope);

  assert.equal(sourceLayer.randomness, undefined);
  assert.ok(report.findings.some(({ outcome, code }) => outcome === "INDEPENDENT_REVIEW" && code === "AUTOMATED_FINDING_INDEPENDENT_REVIEW_REQUIRED"));
  assert.equal(report.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN" || outcome === "CHANGES_REQUIRED"), false);
  assert.equal(report.route, "INDEPENDENT_REVIEW");
  assert.equal(report.ideaEligibility, "PRESERVED");
  assert.equal(report.implementationAuthorization, "NOT_GRANTED");
  assert.equal(scan.launchAuthorization, "NOT_GRANTED");
});

test("tx.origin, delegatecall and signature markers survive scanner-to-analyzer as provenance-bound review holds", () => {
  const scan = extractOpenWorldSourceSignals({
    sources: {
      "src/HazardBridge.sol": `
pragma solidity ^0.8.26;
contract HazardBridge {
    function actor() external view returns (address) { return tx.origin; }
    function execute(address target, bytes calldata data) external { target.delegatecall(data); }
    function verify(bytes32 digest, bytes calldata signature) external pure returns (address) {
        return ECDSA.recover(digest, signature);
    }
}`
    }
  });
  const envelope = assessedEnvelope({
    id: "hazard-bridge",
    stage: "prototype",
    layers: { source: scan.sourceLayer }
  });
  envelope.automatedFindings = scan.automatedFindings;
  const report = analyzeOpenWorldSecurity(envelope);

  assert.deepEqual(scan.unmappedObservedSignalIds, []);
  for (const ruleId of ["authorization.tx-origin", "external-call.delegatecall", "signature.verification"]) {
    assert.ok(scan.automatedFindings.some(({ rule }) => rule.id === ruleId), `Missing automated finding ${ruleId}`);
  }
  assert.ok(report.findings.every(({ outcome }) => outcome === "INDEPENDENT_REVIEW"));
  const automated = report.findings.filter(({ code }) => code === "AUTOMATED_FINDING_INDEPENDENT_REVIEW_REQUIRED");
  assert.equal(automated.length, scan.automatedFindings.length);
  assert.ok(automated.every(({ sourceTool, confirmationStatus }) => sourceTool === "open-world-source-signals" && confirmationStatus === "automated"));
  assert.ok(report.findings.some(({ code, applicantAttestationIsIndependentEvidence }) => (
    code === "SOURCE_SEMANTIC_COVERAGE_UNPROVEN"
    && applicantAttestationIsIndependentEvidence === false
  )));
  assert.equal(report.eligibility, "IDEA_ELIGIBLE");
  assert.equal(report.implementationAuthorization, "NOT_GRANTED");
});

test("reviewer confirmation of a non-drain scanner observation remains independent review, not a self-waiver", () => {
  const scan = extractOpenWorldSourceSignals({
    sources: {
      "src/ReviewedDelegate.sol": `
pragma solidity ^0.8.26;
contract ReviewedDelegate {
    function execute(address target, bytes calldata data) external { target.delegatecall(data); }
}`
    }
  });
  assert.equal(scan.automatedFindings.length, 1);
  scan.automatedFindings[0].status = "reviewer-confirmed";
  const envelope = assessedEnvelope({
    id: "reviewed-delegate",
    stage: "candidate",
    layers: { source: scan.sourceLayer }
  });
  envelope.automatedFindings = scan.automatedFindings;
  const report = analyzeOpenWorldSecurity(envelope);

  assert.ok(report.findings.some(({ outcome, code, confirmationStatus, objectiveCategory }) => (
    outcome === "INDEPENDENT_REVIEW"
    && code === "AUTOMATED_FINDING_INDEPENDENT_REVIEW_REQUIRED"
    && confirmationStatus === "reviewer-confirmed"
    && objectiveCategory === "authorization"
  )));
  assert.equal(report.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);
  assert.equal(report.route, "INDEPENDENT_REVIEW");
  assert.equal(report.eligibility, "IDEA_ELIGIBLE");
});

test("an explicitly unused default profile stays inactive but a positive hazard cannot hide behind used false", () => {
  const inactive = analyzeOpenWorldSecurity(assessedEnvelope({
    id: "unused-defaults",
    stage: "prototype",
    layers: {
      config: {
        privilegedValue: {
          used: false,
          authorityModel: "none",
          hidden: false,
          canMoveUserBacking: false,
          canMovePlatformLiability: false,
          canRedirectOtherBeneficiaryPayouts: false,
          upgradeableValueLogic: false,
          upgradeCanBypassInvariants: false,
          sweepEnabled: false,
          excessOnlySweep: false,
          userExitBeforeChange: false
        }
      }
    }
  }));
  assert.deepEqual(inactive.findings.map(({ code }) => code), ["SOURCE_SEMANTIC_COVERAGE_UNPROVEN"]);

  const underdeclared = analyzeOpenWorldSecurity(assessedEnvelope({
    id: "underdeclared-hazard",
    stage: "prototype",
    layers: {
      source: {
        privilegedValue: {
          used: false,
          hidden: true
        }
      }
    }
  }));
  assert.ok(underdeclared.findings.some(({ code }) => code === "OPEN_WORLD_PROFILE_USAGE_UNDERDECLARED"));
  assert.ok(underdeclared.findings.some(({ outcome, code }) => outcome === "SAFE_REDESIGN" && code === "PRIVILEGED_CONTROL_HIDDEN"));
});

function assessedEnvelope({ id, stage, layers }) {
  const revisionObjectId = "d".repeat(40);
  const manifestPath = "review/source-closure-manifest.v1.json";
  const reportPath = "review/source-closure-verification.primary.v1.json";
  return {
    schemaVersion: "open-world-security-v1",
    subject: { id, revision: revisionObjectId, stage },
    assessment: {
      state: "source-assessed",
      reasonCode: null,
      evidenceRefs: [manifestPath, reportPath],
      sourceCoverage: {
        primaryRepositoryRef: "primary",
        repositories: [{
          repositoryRef: "primary",
          revisionObjectId,
          treeObjectId: "e".repeat(40),
          sourceClosureMode: "manifest",
          sourcePaths: [],
          sourcePathsSha256: null,
          manifestPath,
          manifestSha256: `sha256:${"a".repeat(64)}`,
          manifestByteLength: 123,
          closureSha256: `sha256:${"b".repeat(64)}`,
          reportPath,
          reportSha256: `sha256:${"c".repeat(64)}`,
          reportByteLength: 456,
          result: "VERIFIED"
        }]
      }
    },
    layers: {
      ...layers,
      source: {
        evidenceRefs: ["src/source-closure"],
        ...(layers.source ?? {})
      }
    }
  };
}

function assertSignal(report, id, state) {
  const signal = report.signals.find((entry) => entry.id === id);
  assert.ok(signal, `Missing signal ${id}`);
  assert.equal(signal.state, state);
  assert.equal(signal.value, state === "observed" ? true : null);
}

function assertNoFalse(value) {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoFalse(entry);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) assertNoFalse(entry);
    return;
  }
  assert.notEqual(value, false, "source extraction must never emit false as a safety conclusion");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}
