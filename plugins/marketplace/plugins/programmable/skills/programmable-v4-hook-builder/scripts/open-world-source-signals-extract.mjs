import {
  CALLBACK_NAMES,
  DEFAULT_MAX_AST_NODES,
  DEFAULT_MAX_SOURCE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  OPEN_WORLD_SOURCE_SIGNAL_IDS,
  OPEN_WORLD_SOURCE_SIGNAL_VERSION,
  SIGNAL_METADATA,
  compareEvidence,
  isObject,
  mappedSignalIds,
  normalizeSubject,
  positiveLimit
} from "./open-world-source-signals-contract.mjs";
import {
  collectAstRecords,
  collectSourceRecords
} from "./open-world-source-signals-inputs.mjs";
import {
  addAstEvidence,
  hasFixedLiteralAstBound,
  hasRandomnessAstContext,
  identifierName,
  isDefinitelyUnboundedAstLoop,
  modifierName,
  namePath,
  scanSolidityText
} from "./open-world-source-signals-solidity.mjs";
import {
  buildAutomatedSourceFindings,
  buildOpenWorldSourceLayer
} from "./open-world-source-signals-report.mjs";

function scanSolidityAst(astRecord, sourceRecord, addEvidence, maxNodes) {
  return walkAst(astRecord.ast, (node, ancestors) => {
    const nodeType = node.nodeType;
    if (nodeType === "FunctionDefinition" && CALLBACK_NAMES.has(node.name) && [undefined, "external", "public"].includes(node.visibility)) {
      const modifierNames = (node.modifiers ?? []).map(modifierName).filter(Boolean);
      if (modifierNames.some((name) => /onlyPoolManager/i.test(name))) {
        addAstEvidence("callback.pool-manager-only-guard", astRecord, sourceRecord, node, `solc-ast-onlyPoolManager:${node.name}`, "medium", addEvidence);
      }
      if (!sourceRecord && !modifierNames.some((name) => /onlyPoolManager/i.test(name))) {
        addAstEvidence("callback.pool-manager-guard-unverified", astRecord, sourceRecord, node, `solc-ast-callback-guard-unverified:${node.name}`, "low", addEvidence);
      }
    }
    if (nodeType === "MemberAccess" && node.memberName === "origin" && identifierName(node.expression) === "tx") {
      addAstEvidence("authorization.tx-origin", astRecord, sourceRecord, node, "solc-ast-tx.origin", "high", addEvidence);
    }
    if (nodeType === "MemberAccess" && ["timestamp", "prevrandao"].includes(node.memberName) && identifierName(node.expression) === "block" && (node.memberName !== "timestamp" || hasRandomnessAstContext(ancestors))) {
      addAstEvidence(
        node.memberName === "timestamp" ? "randomness.block-timestamp" : "randomness.prevrandao",
        astRecord,
        sourceRecord,
        node,
        `solc-ast-block.${node.memberName}`,
        node.memberName === "timestamp" ? "medium" : "high",
        addEvidence
      );
    }
    if (nodeType === "FunctionCall") {
      const memberName = node.expression?.memberName;
      const calledName = memberName ?? identifierName(node.expression);
      if (memberName === "delegatecall") addAstEvidence("external-call.delegatecall", astRecord, sourceRecord, node, "solc-ast-delegatecall", "high", addEvidence);
      if (["call", "staticcall", "callcode"].includes(memberName)) addAstEvidence("external-call.low-level", astRecord, sourceRecord, node, "solc-ast-low-level-call", "high", addEvidence);
      if (calledName === "blockhash") addAstEvidence("randomness.blockhash", astRecord, sourceRecord, node, "solc-ast-blockhash", "high", addEvidence);
      if (["ecrecover", "recover", "tryRecover", "isValidSignature", "_hashTypedDataV4"].includes(calledName)) {
        addAstEvidence("signature.verification", astRecord, sourceRecord, node, "solc-ast-signature-verification", "medium", addEvidence);
      }
    }
    if (nodeType === "ContractDefinition") {
      const baseNames = (node.baseContracts ?? []).map((base) => namePath(base.baseName)).filter(Boolean);
      if (baseNames.some((name) => /(?:UUPSUpgradeable|ERC1967|TransparentUpgradeableProxy|ProxyAdmin|UpgradeableBeacon)/.test(name))) {
        addAstEvidence("upgrade.proxy-indicator", astRecord, sourceRecord, node, "solc-ast-upgrade-base", "medium", addEvidence);
      }
    }
    if (nodeType === "FunctionDefinition") {
      if (/^(?:upgradeToAndCall|upgradeTo|_authorizeUpgrade|proxiableUUID)$/i.test(node.name ?? "")) {
        addAstEvidence("upgrade.proxy-indicator", astRecord, sourceRecord, node, "solc-ast-upgrade-function", "medium", addEvidence);
      }
      if (/^(?:rescueTokens?|rescueERC20|sweepTokens?|recoverERC20|recoverTokens?|withdrawStuckTokens?|salvage)$/i.test(node.name ?? "")) {
        addAstEvidence("privilege.rescue-or-sweep", astRecord, sourceRecord, node, "solc-ast-rescue-function", "medium", addEvidence);
      }
    }
    if (["Identifier", "VariableDeclaration"].includes(nodeType) && /^(?:nonces?|usedNonces?|usedDigests?|usedMessages?|consumedDigests?|consumedMessages?)$/i.test(node.name ?? "")) {
      addAstEvidence("replay.nonce-or-consumption", astRecord, sourceRecord, node, "solc-ast-replay-marker", "low", addEvidence);
    }
    if (["WhileStatement", "DoWhileStatement", "ForStatement"].includes(nodeType) && !hasFixedLiteralAstBound(node)) {
      const definite = isDefinitelyUnboundedAstLoop(node);
      addAstEvidence("loop.unbounded-risk-indicator", astRecord, sourceRecord, node, definite ? "solc-ast-definite-unbounded-loop" : "solc-ast-runtime-bound-loop", definite ? "high" : "low", addEvidence);
    }

  }, maxNodes);
}

function walkAst(root, visit, maxNodes) {
  const seen = new WeakSet();
  const stack = [{ value: root, ancestors: [] }];
  let nodes = 0;
  let truncated = false;
  while (stack.length > 0) {
    const { value, ancestors } = stack.pop();
    if (Array.isArray(value)) {
      if (seen.has(value)) continue;
      seen.add(value);
      for (let index = value.length - 1; index >= 0; index -= 1) stack.push({ value: value[index], ancestors });
      continue;
    }
    if (!isObject(value) || seen.has(value)) continue;
    if (nodes >= maxNodes) {
      truncated = true;
      break;
    }
    seen.add(value);
    nodes += 1;
    visit(value, ancestors);
    const nextAncestors = [...ancestors, value];
    const children = Object.values(value).filter((entry) => isObject(entry) || Array.isArray(entry));
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ value: children[index], ancestors: nextAncestors });
  }
  return { nodes, truncated };
}

export function extractOpenWorldSourceSignals(input = {}, options = {}) {
  const diagnostics = [];
  const normalizedInput = isObject(input) ? input : {};
  const normalizedOptions = isObject(options) ? options : {};
  if (!isObject(input)) {
    diagnostics.push({
      code: "SOURCE_SCAN_INPUT_INVALID",
      path: "$",
      message: "The scanner input must be an object; extraction continued with every signal unknown."
    });
  }
  const evidenceBySignal = new Map(OPEN_WORLD_SOURCE_SIGNAL_IDS.map((id) => [id, []]));
  const sourceRecords = collectSourceRecords(normalizedInput, diagnostics);
  const astRecords = collectAstRecords(normalizedInput, diagnostics);
  const maxSourceBytes = positiveLimit(normalizedOptions.maxSourceBytes, DEFAULT_MAX_SOURCE_BYTES);
  const maxTotalBytes = positiveLimit(normalizedOptions.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES);
  const maxAstNodes = positiveLimit(normalizedOptions.maxAstNodes, DEFAULT_MAX_AST_NODES);
  let scannedBytes = 0;
  let scannedSources = 0;
  let routedToReviewSources = 0;
  let scannedAsts = 0;
  let routedToReviewAsts = 0;
  let scannedAstNodes = 0;

  const addEvidence = (signalId, evidence) => {
    if (!evidenceBySignal.has(signalId)) return;
    const existing = evidenceBySignal.get(signalId);
    const identity = `${evidence.path}:${evidence.line ?? "ast"}:${evidence.matcher}`;
    if (existing.some((entry) => entry.identity === identity)) return;
    existing.push({ ...evidence, identity });
  };

  for (const source of sourceRecords.values()) {
    if (!source.solidityScannerEligible) {
      source.scanState = "language-review-required";
      routedToReviewSources += 1;
      diagnostics.push({
        code: "SOURCE_SCAN_LANGUAGE_REVIEW_REQUIRED",
        path: source.path,
        message: "No matching language-specific scanner is available for this source path and declared language; Solidity rules were not applied and independent review remains required.",
        language: source.language,
        mediaType: source.mediaType
      });
      continue;
    }
    const sourceBytes = Buffer.byteLength(source.content, "utf8");
    if (sourceBytes > maxSourceBytes || scannedBytes + sourceBytes > maxTotalBytes) {
      source.scanState = "resource-review-required";
      routedToReviewSources += 1;
      diagnostics.push({
        code: "SOURCE_SCAN_LIMIT_REACHED",
        path: source.path,
        message: "The source was not scanned because a configured byte limit was reached; every unobserved signal remains unknown."
      });
      continue;
    }
    scannedBytes += sourceBytes;
    scannedSources += 1;
    source.scanState = "scanned-solidity-text";
    scanSolidityText(source, addEvidence);
  }

  for (const astRecord of astRecords) {
    if (!astRecord.solidityScannerEligible) {
      astRecord.scanState = "language-review-required";
      routedToReviewAsts += 1;
      diagnostics.push({
        code: "AST_SCAN_LANGUAGE_REVIEW_REQUIRED",
        path: astRecord.path,
        message: "A solc-shaped AST outside a matching .sol path was not treated as Solidity evidence; independent review remains required."
      });
      continue;
    }
    const remainingAstNodes = maxAstNodes - scannedAstNodes;
    if (remainingAstNodes <= 0) {
      astRecord.scanState = "resource-review-required";
      routedToReviewAsts += 1;
      diagnostics.push({
        code: "AST_SCAN_LIMIT_REACHED",
        path: astRecord.path,
        message: "The AST was not scanned because the configured node limit was reached; every unobserved signal remains unknown."
      });
      continue;
    }
    const astScan = scanSolidityAst(astRecord, sourceRecords.get(astRecord.path), addEvidence, remainingAstNodes);
    astRecord.scanState = astScan.truncated ? "resource-review-required" : "scanned-solidity-ast";
    scannedAsts += 1;
    scannedAstNodes += astScan.nodes;
    if (astScan.truncated) {
      routedToReviewAsts += 1;
      diagnostics.push({
        code: "AST_SCAN_LIMIT_REACHED",
        path: astRecord.path,
        message: "AST extraction stopped at the configured node limit; every unobserved signal remains unknown."
      });
    }
  }

  const signals = OPEN_WORLD_SOURCE_SIGNAL_IDS.map((id) => {
    const evidence = evidenceBySignal.get(id)
      .map(({ identity: _identity, ...entry }) => entry)
      .sort(compareEvidence);
    const metadata = SIGNAL_METADATA[id];
    return evidence.length > 0
      ? {
          id,
          state: "observed",
          value: true,
          polarity: metadata.polarity,
          description: metadata.description,
          evidenceRefs: evidence.map(({ ref }) => ref),
          evidence
        }
      : {
          id,
          state: "unknown",
          value: null,
          polarity: metadata.polarity,
          description: metadata.description,
          evidenceRefs: [],
          evidence: []
        };
  });
  const sourceLayer = buildOpenWorldSourceLayer(signals);
  const automatedFindings = buildAutomatedSourceFindings(signals, sourceRecords, astRecords);

  return {
    version: OPEN_WORLD_SOURCE_SIGNAL_VERSION,
    subject: normalizeSubject(normalizedInput.subject),
    mode: "READ_ONLY_SOURCE_SIGNAL_EXTRACTION",
    launchAuthorization: "NOT_GRANTED",
    monotonicity: "Only observed true or unknown signals are emitted. Missing text, AST nodes or regex matches never prove false, safe or not-applicable.",
    signals,
    automatedFindings,
    observedSignalIds: signals.filter(({ state }) => state === "observed").map(({ id }) => id),
    unknownSignalIds: signals.filter(({ state }) => state === "unknown").map(({ id }) => id),
    sourceLayer,
    unmappedObservedSignalIds: signals
      .filter(({ state, id }) => state === "observed" && !mappedSignalIds().has(id))
      .map(({ id }) => id),
    diagnostics,
    stats: {
      suppliedSources: sourceRecords.size,
      scannedSources,
      routedToReviewSources,
      scannedBytes,
      suppliedAsts: astRecords.length,
      scannedAsts,
      routedToReviewAsts,
      scannedAstNodes
    },
    sourceLanguages: [...sourceRecords.values()]
      .map(({ path, language, mediaType, scanState }) => ({ path, language, mediaType, scanState }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    limitations: [
      "Indicators are not semantic proof and can be incomplete or context dependent.",
      "A positive guard indicator proves only the observed callback evidence, not every reachable callback or deployed bytecode path.",
      "Loop indicators require manual bound analysis; a heuristic match is not itself proof of an exploitable unbounded loop.",
      "Compile settings, linked libraries, deployed bytecode, configuration, runtime state and independent review remain separate evidence."
    ]
  };
}

/**
 * Return the additive source layer that can be inserted under
 * `layers.source` in open-world-security-v1. It contains evidence references
 * only. Heuristic conclusions travel separately as provenance-bound
 * `automatedFindings`, so they cannot become objective source-layer facts.
 */
