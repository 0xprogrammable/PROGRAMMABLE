import { isObject } from "./open-world-source-signals-contract.mjs";

function maskCommentsAndStrings(source) {
  let state = "code";
  let quote = null;
  let escaped = false;
  let output = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "code") {
      if (character === "/" && next === "/") {
        output += "  ";
        index += 1;
        state = "line-comment";
      } else if (character === "/" && next === "*") {
        output += "  ";
        index += 1;
        state = "block-comment";
      } else if (character === "\"" || character === "'") {
        output += " ";
        quote = character;
        escaped = false;
        state = "string";
      } else {
        output += character;
      }
    } else if (state === "line-comment") {
      if (character === "\n") {
        output += "\n";
        state = "code";
      } else {
        output += " ";
      }
    } else if (state === "block-comment") {
      if (character === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "code";
      } else {
        output += character === "\n" ? "\n" : " ";
      }
    } else if (state === "string") {
      if (character === "\n") {
        output += "\n";
      } else {
        output += " ";
      }
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) state = "code";
    }
  }
  return output;
}

export function scanSolidityText(source, addEvidence) {
  const masked = maskCommentsAndStrings(source.content);
  const simplePatterns = [
    ["authorization.tx-origin", /\btx\s*\.\s*origin\b/g, "tx.origin", "high"],
    ["external-call.delegatecall", /\.\s*delegatecall\s*(?:\{|\()/g, "delegatecall", "high"],
    ["external-call.low-level", /\.\s*(?:call|staticcall|callcode)\s*(?:\{|\()/g, "low-level-call", "high"],
    ["upgrade.proxy-indicator", /\b(?:upgradeToAndCall|upgradeTo|_authorizeUpgrade|proxiableUUID|ERC1967Proxy|TransparentUpgradeableProxy|UUPSUpgradeable|ProxyAdmin)\b/g, "upgrade-or-proxy", "medium"],
    ["privilege.rescue-or-sweep", /\b(?:rescueTokens?|rescueERC20|sweepTokens?|recoverERC20|recoverTokens?|withdrawStuckTokens?|salvage)\s*\(/g, "rescue-or-sweep", "medium"],
    ["randomness.blockhash", /\bblockhash\s*\(/g, "blockhash", "high"],
    ["randomness.prevrandao", /\bblock\s*\.\s*prevrandao\b/g, "block.prevrandao", "high"],
    ["signature.verification", /\b(?:ecrecover|SignatureChecker|isValidSignature|EIP712|_hashTypedDataV4)\b|\.\s*(?:recover|tryRecover)\s*\(/g, "signature-verification", "medium"],
    ["replay.nonce-or-consumption", /\b(?:nonces?|usedNonces?|usedDigests?|usedMessages?|consumedDigests?|consumedMessages?|messageConsumed|digestConsumed)\b/g, "nonce-or-consumption", "low"]
  ];
  for (const [signalId, pattern, matcher, confidence] of simplePatterns) {
    for (const match of masked.matchAll(pattern)) addTextEvidence(signalId, source, match.index, matcher, confidence, addEvidence);
  }

  for (const match of masked.matchAll(/\bblock\s*\.\s*timestamp\b/g)) {
    if (hasRandomnessTextContext(masked, match.index)) {
      addTextEvidence("randomness.block-timestamp", source, match.index, "block.timestamp-randomness-context", "medium", addEvidence);
    }
  }

  const callbackPattern = /\bfunction\s+((?:beforeInitialize|afterInitialize|beforeAddLiquidity|afterAddLiquidity|beforeRemoveLiquidity|afterRemoveLiquidity|beforeSwap|afterSwap|beforeDonate|afterDonate|unlockCallback))\s*\([^)]*\)[^{;]{0,1200}\bonlyPoolManager\b/g;
  for (const match of masked.matchAll(callbackPattern)) {
    addTextEvidence(
      "callback.pool-manager-only-guard",
      source,
      match.index,
      `named-onlyPoolManager:${match[1]}`,
      "medium",
      addEvidence
    );
  }
  const callbackFunctionPattern = /\bfunction\s+((?:beforeInitialize|afterInitialize|beforeAddLiquidity|afterAddLiquidity|beforeRemoveLiquidity|afterRemoveLiquidity|beforeSwap|afterSwap|beforeDonate|afterDonate|unlockCallback))\s*\([^)]*\)[^{;]{0,1200}\{/g;
  for (const callbackMatch of masked.matchAll(callbackFunctionPattern)) {
    const start = callbackMatch.index;
    const nextFunction = masked.indexOf("function", start + callbackMatch[0].length);
    const end = Math.min(nextFunction === -1 ? masked.length : nextFunction, start + 5_000);
    const body = masked.slice(start, end);
    const explicitGuard = enforcingPoolManagerGuard(body);
    if (explicitGuard) {
      addTextEvidence("callback.pool-manager-only-guard", source, start + explicitGuard.index, `explicit-pool-manager-guard:${callbackMatch[1]}`, "high", addEvidence);
    } else {
      addTextEvidence("callback.pool-manager-guard-unverified", source, start, `callback-without-direct-guard:${callbackMatch[1]}`, "medium", addEvidence);
    }
  }

  for (const match of masked.matchAll(/\bfor\s*\(\s*;\s*;\s*\)|\bwhile\s*\(\s*true\s*\)/g)) {
    addTextEvidence("loop.unbounded-risk-indicator", source, match.index, "definite-unbounded-loop", "high", addEvidence);
  }
  for (const match of masked.matchAll(/\b(?:for\s*\([^;]*;[^;]*(?:\.\s*length\b|<\s*[_a-zA-Z][_a-zA-Z0-9]*|<=\s*[_a-zA-Z][_a-zA-Z0-9]*)[^;]*;[^)]*\)|while\s*\((?!\s*true\s*\)))/g)) {
    addTextEvidence("loop.unbounded-risk-indicator", source, match.index, "runtime-bound-loop", "low", addEvidence);
  }
}

export function enforcingPoolManagerGuard(body) {
  const sender = "(?:address\\s*\\(\\s*)?msg\\s*\\.\\s*sender\\s*\\)?";
  const manager = "(?:address\\s*\\(\\s*)?(?:[_a-zA-Z][_a-zA-Z0-9]*)?poolManager\\s*\\)?";
  const requireGuard = new RegExp(`\\brequire\\s*\\(\\s*${sender}\\s*==\\s*${manager}(?:\\s*,|\\s*\\))`, "i").exec(body);
  if (requireGuard) return requireGuard;
  return new RegExp(`\\bif\\s*\\(\\s*${sender}\\s*!=\\s*${manager}\\s*\\)\\s*(?:\\{\\s*)?revert\\b`, "i").exec(body);
}

export function hasRandomnessTextContext(maskedSource, offset) {
  const functionStart = maskedSource.lastIndexOf("function", offset);
  const contextStart = functionStart >= 0 ? functionStart : Math.max(0, offset - 500);
  const nextFunction = maskedSource.indexOf("function", offset + 1);
  const contextEnd = Math.min(nextFunction >= 0 ? nextFunction : maskedSource.length, offset + 1_500);
  const context = maskedSource.slice(contextStart, contextEnd);
  return /\b(?:random(?:ness)?|rand|entropy|seed|draw|winner|lottery|raffle|roll|shuffle|chance)\b/i.test(context) ||
    /keccak256\s*\([^)]{0,1000}block\s*\.\s*timestamp|block\s*\.\s*timestamp[^)]{0,1000}keccak256/i.test(context);
}

export function hasRandomnessAstContext(ancestors) {
  const functionNode = [...ancestors].reverse().find(({ nodeType }) => nodeType === "FunctionDefinition");
  return /(?:random|rand|entropy|seed|draw|winner|lottery|raffle|roll|shuffle|chance)/i.test(functionNode?.name ?? "");
}

export function addTextEvidence(signalId, source, index, matcher, confidence, addEvidence) {
  const line = lineAt(source.content, index);
  addEvidence(signalId, {
    ref: `${source.path}#L${line}:${signalId}`,
    path: source.path,
    line,
    matcher,
    confidence,
    origin: source.origin,
    language: source.language,
    mediaType: source.mediaType,
    artifactRef: source.path,
    artifactSha256: source.artifactSha256,
    excerpt: excerptAt(source.content, index)
  });
}

export function addAstEvidence(signalId, astRecord, sourceRecord, node, matcher, confidence, addEvidence) {
  const offset = astOffset(node.src);
  const line = sourceRecord && offset !== null ? lineAt(sourceRecord.content, offset) : null;
  addEvidence(signalId, {
    ref: line === null
      ? `${astRecord.path}#ast-${offset ?? "unknown"}:${signalId}`
      : `${astRecord.path}#L${line}:${signalId}`,
    path: astRecord.path,
    line,
    matcher,
    confidence,
    origin: `solc-build-info-${astRecord.buildInfoIndex}`,
    language: astRecord.language,
    mediaType: astRecord.mediaType,
    artifactRef: astRecord.artifactRef,
    artifactSha256: astRecord.artifactSha256,
    excerpt: sourceRecord && offset !== null ? excerptAt(sourceRecord.content, offset) : null
  });
}

export function isDefinitelyUnboundedAstLoop(node) {
  if (node.nodeType === "ForStatement" && (node.condition === null || node.condition === undefined)) return true;
  if (["WhileStatement", "DoWhileStatement"].includes(node.nodeType)) {
    return node.condition?.nodeType === "Literal" && (node.condition.value === "true" || node.condition.value === true);
  }
  return false;
}

export function hasFixedLiteralAstBound(node) {
  if (node.nodeType !== "ForStatement") return false;
  const condition = node.condition;
  if (condition?.nodeType !== "BinaryOperation" || !["<", "<=", ">", ">="].includes(condition.operator)) return false;
  return condition.leftExpression?.nodeType === "Literal" || condition.rightExpression?.nodeType === "Literal";
}

export function modifierName(modifier) {
  return namePath(modifier?.modifierName);
}

export function namePath(node) {
  if (!isObject(node)) return null;
  return node.namePath ?? node.name ?? node.memberName ?? namePath(node.expression) ?? null;
}

export function identifierName(node) {
  return isObject(node) ? node.name ?? null : null;
}

export function astOffset(src) {
  if (typeof src !== "string") return null;
  const match = /^(\d+):/.exec(src);
  return match ? Number(match[1]) : null;
}

export function lineAt(source, offset) {
  let line = 1;
  for (let index = 0; index < Math.min(offset, source.length); index += 1) if (source[index] === "\n") line += 1;
  return line;
}

export function excerptAt(source, offset) {
  const start = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const nextNewline = source.indexOf("\n", offset);
  const end = nextNewline === -1 ? source.length : nextNewline;
  return source.slice(start, end).trim().replace(/\s+/g, " ").slice(0, 240);
}
