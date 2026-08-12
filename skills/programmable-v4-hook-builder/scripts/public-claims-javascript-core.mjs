import {
  completePublicClaimAnalysis,
  incompletePublicClaimAnalysis
} from "./public-claims-analysis-primitives.mjs";

import {
  canStartStaticJavascriptExpression,
  isStaticJsxStringExpression,
  parseStaticJavascriptConditional,
  staticJavascriptExpressionEndsAtBoundary,
  staticJsxTokensAreAdjacent
} from "./public-claims-javascript-evaluator.mjs";

import {
  MAX_STATIC_JAVASCRIPT_STRING_LENGTH,
  STATIC_JAVASCRIPT_ANALYSIS_FAILED,
  staticJavascriptAnalysisIssue
} from "./public-claims-javascript-primitives.mjs";

import {
  decodeJavascriptEscape,
  tokenizeStaticJavascript
} from "./public-claims-javascript-tokenizer.mjs";

export function analyzeJavascriptPublicText(source) {
  try {
    return analyzeJavascriptPublicTextUnchecked(source);
  } catch {
    return incompletePublicClaimAnalysis("", [STATIC_JAVASCRIPT_ANALYSIS_FAILED]);
  }
}

export function analyzeJavascriptPublicTextUnchecked(source) {
  const publicTokens = [];
  let visibleCode = "";
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (current === "/" && next === "/") {
      const newline = source.indexOf("\n", index + 2);
      const end = newline === -1 ? source.length : newline;
      visibleCode += " ".repeat(end - index);
      index = end;
      continue;
    }
    if (current === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      const end = close === -1 ? source.length : close + 2;
      visibleCode += " ".repeat(end - index);
      index = end;
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      const start = index;
      const quote = current;
      let literal = "";
      index += 1;
      while (index < source.length) {
        const character = source[index];
        if (character === "\\") {
          const decoded = decodeJavascriptEscape(source, index);
          literal += decoded.value;
          index = decoded.nextIndex;
          continue;
        }
        if (character === quote) {
          index += 1;
          break;
        }
        literal += character;
        index += 1;
      }
      publicTokens.push({ end: index, index: start, kind: "literal", text: literal });
      visibleCode += " ".repeat(index - start);
      continue;
    }
    visibleCode += current;
    index += 1;
  }
  for (const match of visibleCode.matchAll(/(?:>|\})([^<>{}]+)(?=[<{])/gu)) {
    const start = match.index + 1;
    publicTokens.push({ end: start + match[1].length, index: start, kind: "jsx-text", text: match[1] });
  }
  const compositionAnalysis = extractStaticJavascriptCompositions(source);
  const ordered = publicTokens
    .filter((token) => !staticJavascriptTokenIsInactive(token, compositionAnalysis.inactiveRanges))
    .filter(({ text }) => text.length > 0)
    .sort((left, right) => left.index - right.index);
  for (const token of ordered) {
    if (token.kind === "literal" && isStaticJsxStringExpression(visibleCode, token.index, token.end)) {
      token.kind = "jsx-static-string";
    }
  }
  let extracted = "";
  let previous = null;
  for (const token of ordered) {
    if (previous) extracted += staticJsxTokensAreAdjacent(visibleCode, previous, token) ? "" : "\n";
    extracted += token.text;
    previous = token;
  }
  const text = [extracted, ...compositionAnalysis.values].filter(Boolean).join("\n");
  return compositionAnalysis.analysisComplete
    ? completePublicClaimAnalysis(text)
    : incompletePublicClaimAnalysis(text, compositionAnalysis.analysisIssues);
}

export function staticJavascriptTokenIsInactive(token, inactiveRanges) {
  return inactiveRanges.some((range) => token.index >= range.start && token.end <= range.end);
}

/**
 * Reconstruct only a deliberately small, non-executable JavaScript grammar:
 * string/template literals, parentheses, literal-only `+`, and literal arrays
 * followed by `.join()` with a static separator. No identifier, property read,
 * function call, coercion, getter, or candidate code is evaluated.
 */
export function extractStaticJavascriptCompositions(source) {
  try {
    const lexical = tokenizeStaticJavascript(source);
    const findings = new Set();
    const inactiveRanges = [];
    for (let index = 0; index < lexical.tokens.length; index += 1) {
      if (!canStartStaticJavascriptExpression(lexical.tokens, index)) continue;
      const parsed = parseStaticJavascriptConditional(lexical.tokens, index, 0);
      const endsAtBoundary = parsed !== null
        && staticJavascriptExpressionEndsAtBoundary(lexical.tokens, parsed.next);
      if (
        parsed?.node?.kind === "string"
        && parsed.node.composed
        && endsAtBoundary
        && parsed.node.value.length <= MAX_STATIC_JAVASCRIPT_STRING_LENGTH
      ) {
        findings.add(parsed.node.value);
      }
      if (parsed?.node?.exactBooleanConditional === true) {
        inactiveRanges.push(...(parsed.node.inactiveRanges ?? []));
        index = parsed.next - 1;
      }
    }
    return {
      analysisComplete: true,
      analysisIssues: [],
      inactiveRanges,
      values: [...findings].filter((value) => value.length > 0)
    };
  } catch (error) {
    return {
      analysisComplete: false,
      analysisIssues: [staticJavascriptAnalysisIssue(error)],
      inactiveRanges: [],
      values: []
    };
  }
}
