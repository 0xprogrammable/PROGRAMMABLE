import {
  canStartStaticRegularExpression,
  evaluateExactStaticJavascriptExpression
} from "./public-claims-javascript-evaluator.mjs";

import {
  MAX_STATIC_JAVASCRIPT_DEPTH,
  MAX_STATIC_JAVASCRIPT_STRING_LENGTH,
  MAX_STATIC_JAVASCRIPT_TOKENS,
  staticJavascriptResourceLimit
} from "./public-claims-javascript-primitives.mjs";

export function tokenizeStaticJavascript(source, templateDepth = 0) {
  const tokens = [];
  let index = source.startsWith("#!")
    ? source.indexOf("\n") === -1 ? source.length : source.indexOf("\n") + 1
    : 0;
  let tokenCount = 0;
  let currentTemplateDepth = templateDepth;

  scanCode(false, tokens);
  return { tokens };

  function scanCode(stopAtTemplateExpression, target) {
    let braceDepth = 0;
    while (index < source.length) {
      const current = source[index];
      const next = source[index + 1];
      if (/\s/u.test(current)) {
        index += 1;
        continue;
      }
      if (current === "/" && next === "/") {
        const newline = source.indexOf("\n", index + 2);
        index = newline === -1 ? source.length : newline;
        continue;
      }
      if (current === "/" && next === "*") {
        const close = source.indexOf("*/", index + 2);
        if (close === -1) throw new Error("unterminated JavaScript block comment");
        index = close + 2;
        continue;
      }
      if (current === "'" || current === '"') {
        const start = index;
        const token = readStaticJavascriptString(current);
        pushToken(target, token, start, index);
        continue;
      }
      if (current === "`") {
        const start = index;
        const template = readStaticJavascriptTemplate();
        if (template.static) {
          pushToken(target, { type: "string", value: template.value, composed: template.composed }, start, index);
        } else {
          pushToken(target, { type: "opaque", value: "template-literal" }, start, index);
        }
        continue;
      }
      if (current === "/" && canStartStaticRegularExpression(target.at(-1))) {
        const start = index;
        skipStaticRegularExpression();
        pushToken(target, { type: "opaque", value: "regular-expression" }, start, index);
        continue;
      }
      if (/[A-Za-z_$]/u.test(current)) {
        const start = index;
        index += 1;
        while (/[A-Za-z0-9_$]/u.test(source[index] ?? "")) index += 1;
        pushToken(target, { type: "identifier", value: source.slice(start, index) }, start, index);
        continue;
      }
      const punctuator = ["=>", "++", "--", "&&", "||", "??", "?."].find((value) => source.startsWith(value, index));
      if (punctuator !== undefined) {
        const start = index;
        index += punctuator.length;
        pushToken(target, { type: "punctuator", value: punctuator }, start, index);
        continue;
      }
      if (stopAtTemplateExpression && current === "}" && braceDepth === 0) {
        index += 1;
        return;
      }
      if (stopAtTemplateExpression && current === "{") braceDepth += 1;
      if (stopAtTemplateExpression && current === "}") braceDepth -= 1;
      const start = index;
      index += 1;
      pushToken(target, { type: "punctuator", value: current }, start, index);
    }
    if (stopAtTemplateExpression) throw new Error("unterminated JavaScript template expression");
  }

  function readStaticJavascriptString(quote) {
    index += 1;
    let value = "";
    while (index < source.length) {
      const current = source[index];
      if (current === quote) {
        index += 1;
        return { type: "string", value, composed: false };
      }
      if (current === "\n" || current === "\r") throw new Error("unterminated JavaScript string literal");
      if (current === "\\") {
        const decoded = decodeJavascriptEscape(source, index);
        value += decoded.value;
        index = decoded.nextIndex;
      } else {
        value += current;
        index += 1;
      }
      if (value.length > MAX_STATIC_JAVASCRIPT_STRING_LENGTH) throw staticJavascriptResourceLimit("static JavaScript string is too large");
    }
    throw new Error("unterminated JavaScript string literal");
  }

  function readStaticJavascriptTemplate() {
    currentTemplateDepth += 1;
    if (currentTemplateDepth > MAX_STATIC_JAVASCRIPT_DEPTH) throw staticJavascriptResourceLimit("JavaScript template nesting is too deep");
    try {
      index += 1;
      let value = "";
      let composed = false;
      let staticValue = true;
      while (index < source.length) {
        const current = source[index];
        const next = source[index + 1];
        if (current === "\\") {
          const decoded = decodeJavascriptEscape(source, index);
          value += decoded.value;
          index = decoded.nextIndex;
          if (value.length > MAX_STATIC_JAVASCRIPT_STRING_LENGTH) throw staticJavascriptResourceLimit("static JavaScript template is too large");
          continue;
        }
        if (current === "`") {
          index += 1;
          return { static: staticValue, value, composed };
        }
        if (current === "$" && next === "{") {
          composed = true;
          index += 2;
          const expressionTokens = [];
          scanCode(true, expressionTokens);
          const evaluated = evaluateExactStaticJavascriptExpression(expressionTokens, currentTemplateDepth);
          if (evaluated === null) staticValue = false;
          else if (staticValue) {
            value += evaluated;
            if (value.length > MAX_STATIC_JAVASCRIPT_STRING_LENGTH) throw staticJavascriptResourceLimit("static JavaScript template is too large");
          }
          continue;
        }
        if (staticValue) value += current;
        index += 1;
        if (value.length > MAX_STATIC_JAVASCRIPT_STRING_LENGTH) throw staticJavascriptResourceLimit("static JavaScript template is too large");
      }
      throw new Error("unterminated JavaScript template literal");
    } finally {
      currentTemplateDepth -= 1;
    }
  }

  function skipStaticRegularExpression() {
    index += 1;
    let inClass = false;
    while (index < source.length) {
      const current = source[index];
      if (current === "\\") {
        index += 2;
        continue;
      }
      if (current === "[") inClass = true;
      else if (current === "]") inClass = false;
      else if (current === "/" && !inClass) {
        index += 1;
        while (/[A-Za-z]/u.test(source[index] ?? "")) index += 1;
        return;
      }
      if (current === "\n" || current === "\r") break;
      index += 1;
    }
    throw new Error("unterminated JavaScript regular expression");
  }

  function pushToken(target, token, start, end) {
    tokenCount += 1;
    if (tokenCount > MAX_STATIC_JAVASCRIPT_TOKENS) throw staticJavascriptResourceLimit("JavaScript source has too many lexical tokens");
    target.push({ ...token, end, start });
  }
}

export function decodeJavascriptEscape(source, slashIndex) {
  const escaped = source[slashIndex + 1];
  if (escaped === undefined) return { value: "", nextIndex: source.length };
  if (escaped === "\n" || escaped === "\u2028" || escaped === "\u2029") {
    return { value: "", nextIndex: slashIndex + 2 };
  }
  if (escaped === "\r") {
    return { value: "", nextIndex: source[slashIndex + 2] === "\n" ? slashIndex + 3 : slashIndex + 2 };
  }
  const simple = new Map([["n", "\n"], ["r", "\r"], ["t", "\t"], ["b", "\b"], ["f", "\f"], ["v", "\v"]]);
  if (simple.has(escaped)) return { value: simple.get(escaped), nextIndex: slashIndex + 2 };
  if (escaped === "x") {
    const digits = source.slice(slashIndex + 2, slashIndex + 4);
    if (/^[0-9a-f]{2}$/iu.test(digits)) return { value: String.fromCodePoint(Number.parseInt(digits, 16)), nextIndex: slashIndex + 4 };
  }
  if (escaped === "u" && source[slashIndex + 2] === "{") {
    const close = source.indexOf("}", slashIndex + 3);
    const digits = close === -1 ? "" : source.slice(slashIndex + 3, close);
    if (/^[0-9a-f]{1,6}$/iu.test(digits) && Number.parseInt(digits, 16) <= 0x10ffff) {
      return { value: String.fromCodePoint(Number.parseInt(digits, 16)), nextIndex: close + 1 };
    }
  }
  if (escaped === "u") {
    const digits = source.slice(slashIndex + 2, slashIndex + 6);
    if (/^[0-9a-f]{4}$/iu.test(digits)) return { value: String.fromCodePoint(Number.parseInt(digits, 16)), nextIndex: slashIndex + 6 };
  }
  return { value: escaped, nextIndex: slashIndex + 2 };
}
