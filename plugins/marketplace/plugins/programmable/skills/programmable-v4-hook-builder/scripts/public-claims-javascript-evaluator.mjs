import {
  MAX_STATIC_JAVASCRIPT_DEPTH,
  MAX_STATIC_JAVASCRIPT_STRING_LENGTH,
  REGULAR_EXPRESSION_START_KEYWORDS,
  REGULAR_EXPRESSION_START_PUNCTUATORS,
  STATIC_EXPRESSION_END_PUNCTUATORS,
  STATIC_EXPRESSION_START_KEYWORDS,
  STATIC_EXPRESSION_START_PUNCTUATORS,
  staticJavascriptResourceLimit
} from "./public-claims-javascript-primitives.mjs";

export function evaluateExactStaticJavascriptExpression(tokens, depth) {
  if (tokens.length === 0) return null;
  if (depth > MAX_STATIC_JAVASCRIPT_DEPTH) throw staticJavascriptResourceLimit("static JavaScript expression nesting is too deep");
  const parsed = parseStaticJavascriptConditional(tokens, 0, depth);
  return parsed?.next === tokens.length && parsed.node.kind === "string" ? parsed.node.value : null;
}

export function parseStaticJavascriptConditional(tokens, start, depth) {
  if (depth > MAX_STATIC_JAVASCRIPT_DEPTH) throw staticJavascriptResourceLimit("static JavaScript expression nesting is too deep");
  const condition = parseStaticJavascriptAddition(tokens, start, depth + 1);
  if (condition === null || tokens[condition.next]?.value !== "?") return condition;
  if (condition.node.kind !== "boolean") return null;
  const consequentStart = condition.next + 1;
  const consequent = parseStaticJavascriptConditional(tokens, consequentStart, depth + 1);
  if (consequent === null || tokens[consequent.next]?.value !== ":") return null;
  const alternateStart = consequent.next + 1;
  const alternate = parseStaticJavascriptConditional(tokens, alternateStart, depth + 1);
  if (alternate === null) return null;
  const selected = condition.node.value ? consequent.node : alternate.node;
  const inactiveRange = condition.node.value
    ? staticJavascriptTokenRange(tokens, alternateStart, alternate.next)
    : staticJavascriptTokenRange(tokens, consequentStart, consequent.next);
  return {
    node: {
      ...selected,
      exactBooleanConditional: true,
      inactiveRanges: [
        ...(condition.node.inactiveRanges ?? []),
        ...(selected.inactiveRanges ?? []),
        ...(inactiveRange === null ? [] : [inactiveRange])
      ]
    },
    next: alternate.next
  };
}

export function staticJavascriptTokenRange(tokens, start, end) {
  if (start >= end || tokens[start]?.start === undefined || tokens[end - 1]?.end === undefined) return null;
  return { end: tokens[end - 1].end, start: tokens[start].start };
}

export function parseStaticJavascriptAddition(tokens, start, depth) {
  if (depth > MAX_STATIC_JAVASCRIPT_DEPTH) throw staticJavascriptResourceLimit("static JavaScript expression nesting is too deep");
  let parsed = parseStaticJavascriptPostfix(tokens, start, depth + 1);
  if (parsed === null) return null;
  while (tokens[parsed.next]?.value === "+") {
    const right = parseStaticJavascriptPostfix(tokens, parsed.next + 1, depth + 1);
    if (right === null || parsed.node.kind !== "string" || right.node.kind !== "string") return null;
    const value = parsed.node.value + right.node.value;
    if (value.length > MAX_STATIC_JAVASCRIPT_STRING_LENGTH) throw staticJavascriptResourceLimit("static JavaScript composition is too large");
    parsed = {
      node: {
        kind: "string",
        value,
        composed: true,
        exactBooleanConditional: parsed.node.exactBooleanConditional === true || right.node.exactBooleanConditional === true,
        inactiveRanges: [...(parsed.node.inactiveRanges ?? []), ...(right.node.inactiveRanges ?? [])]
      },
      next: right.next
    };
  }
  return parsed;
}

export function parseStaticJavascriptPostfix(tokens, start, depth) {
  let parsed = parseStaticJavascriptPrimary(tokens, start, depth + 1);
  if (parsed === null) return null;
  if (
    parsed.node.kind === "array"
    && tokens[parsed.next]?.value === "."
    && tokens[parsed.next + 1]?.type === "identifier"
    && tokens[parsed.next + 1].value === "join"
    && tokens[parsed.next + 2]?.value === "("
  ) {
    let cursor = parsed.next + 3;
    let separator = ",";
    let separatorNode = null;
    if (tokens[cursor]?.value !== ")") {
      const separatorResult = parseStaticJavascriptConditional(tokens, cursor, depth + 1);
      if (separatorResult === null || separatorResult.node.kind !== "string") return null;
      separator = separatorResult.node.value;
      separatorNode = separatorResult.node;
      cursor = separatorResult.next;
    }
    if (tokens[cursor]?.value !== ")") return null;
    const value = joinStaticJavascriptStrings(parsed.node.items, separator);
    parsed = {
      node: {
        kind: "string",
        value,
        composed: true,
        exactBooleanConditional: parsed.node.exactBooleanConditional === true || separatorNode?.exactBooleanConditional === true,
        inactiveRanges: [...(parsed.node.inactiveRanges ?? []), ...(separatorNode?.inactiveRanges ?? [])]
      },
      next: cursor + 1
    };
  }
  return parsed;
}

export function joinStaticJavascriptStrings(items, separator) {
  let resultLength = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (index > 0) {
      if (separator.length > MAX_STATIC_JAVASCRIPT_STRING_LENGTH - resultLength) {
        throw staticJavascriptResourceLimit("static JavaScript join result is too large");
      }
      resultLength += separator.length;
    }
    if (items[index].length > MAX_STATIC_JAVASCRIPT_STRING_LENGTH - resultLength) {
      throw staticJavascriptResourceLimit("static JavaScript join result is too large");
    }
    resultLength += items[index].length;
  }
  return items.join(separator);
}

export function parseStaticJavascriptPrimary(tokens, start, depth) {
  if (depth > MAX_STATIC_JAVASCRIPT_DEPTH) throw staticJavascriptResourceLimit("static JavaScript expression nesting is too deep");
  const token = tokens[start];
  if (token?.type === "string") {
    return { node: { kind: "string", value: token.value, composed: token.composed === true, inactiveRanges: [] }, next: start + 1 };
  }
  if (token?.type === "identifier" && (token.value === "true" || token.value === "false")) {
    return { node: { kind: "boolean", value: token.value === "true", inactiveRanges: [] }, next: start + 1 };
  }
  if (token?.value === "(") {
    const nested = parseStaticJavascriptConditional(tokens, start + 1, depth + 1);
    if (nested === null || tokens[nested.next]?.value !== ")") return null;
    return { node: nested.node, next: nested.next + 1 };
  }
  if (token?.value !== "[") return null;
  const items = [];
  let exactBooleanConditional = false;
  const inactiveRanges = [];
  let cursor = start + 1;
  if (tokens[cursor]?.value === "]") return { node: { kind: "array", items, exactBooleanConditional, inactiveRanges }, next: cursor + 1 };
  while (cursor < tokens.length) {
    const item = parseStaticJavascriptConditional(tokens, cursor, depth + 1);
    if (item === null || item.node.kind !== "string") return null;
    items.push(item.node.value);
    exactBooleanConditional ||= item.node.exactBooleanConditional === true;
    inactiveRanges.push(...(item.node.inactiveRanges ?? []));
    cursor = item.next;
    if (tokens[cursor]?.value === "]") return { node: { kind: "array", items, exactBooleanConditional, inactiveRanges }, next: cursor + 1 };
    if (tokens[cursor]?.value !== ",") return null;
    cursor += 1;
    if (tokens[cursor]?.value === "]") return { node: { kind: "array", items, exactBooleanConditional, inactiveRanges }, next: cursor + 1 };
  }
  return null;
}

export function canStartStaticJavascriptExpression(tokens, index) {
  const token = tokens[index];
  const isBooleanLiteral = token?.type === "identifier" && (token.value === "true" || token.value === "false");
  if (token?.type !== "string" && token?.value !== "[" && token?.value !== "(" && !isBooleanLiteral) return false;
  if (index === 0) return true;
  const previous = tokens[index - 1];
  if (previous.type === "identifier") return STATIC_EXPRESSION_START_KEYWORDS.has(previous.value);
  return STATIC_EXPRESSION_START_PUNCTUATORS.has(previous.value);
}

export function staticJavascriptExpressionEndsAtBoundary(tokens, index) {
  if (index === tokens.length) return true;
  return STATIC_EXPRESSION_END_PUNCTUATORS.has(tokens[index].value);
}

export function canStartStaticRegularExpression(previous) {
  if (!previous) return true;
  if (previous.type === "identifier") return REGULAR_EXPRESSION_START_KEYWORDS.has(previous.value);
  if (previous.value === "++" || previous.value === "--") return false;
  return REGULAR_EXPRESSION_START_PUNCTUATORS.has(previous.value);
}

export function isStaticJsxStringExpression(visibleCode, start, end) {
  let before = start - 1;
  while (before >= 0 && /\s/u.test(visibleCode[before])) before -= 1;
  let after = end;
  while (after < visibleCode.length && /\s/u.test(visibleCode[after])) after += 1;
  return visibleCode[before] === "{" && visibleCode[after] === "}";
}

export function staticJsxTokensAreAdjacent(visibleCode, left, right) {
  const jsxKinds = new Set(["jsx-static-string", "jsx-text"]);
  if (!jsxKinds.has(left.kind) || !jsxKinds.has(right.kind)) return false;
  const boundary = visibleCode.slice(left.end, right.index).replace(/\s/gu, "");
  if (left.kind === "jsx-text" && right.kind === "jsx-static-string") return boundary === "{";
  if (left.kind === "jsx-static-string" && right.kind === "jsx-text") return boundary === "}";
  return left.kind === "jsx-static-string" && right.kind === "jsx-static-string" && boundary === "}{";
}
