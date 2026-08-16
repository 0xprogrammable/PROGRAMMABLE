import { builtinModules } from "node:module";
import {
  isCanonicalNpmPackageName,
  isExactDeclaredPackageSpecifier
} from "./package-dependency-contract.mjs";
import { UnsupportedClosureError } from "./review-target-errors.mjs";
import { isCanonicalReviewTargetPath } from "./review-target-contract.mjs";

export const javascriptSourceExtension = /\.(?:[cm]?[jt]sx?)$/i;
export const javascriptResolutionExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts", ".json"];
const MAX_JAVASCRIPT_TOKENS = 100_000;
const MAX_JAVASCRIPT_TEMPLATE_DEPTH = 64;
const nodeBuiltinSpecifiers = new Set(builtinModules.flatMap((specifier) => (
  specifier.startsWith("node:") ? [specifier, specifier.slice(5)] : [specifier, `node:${specifier}`]
)));

function isNodeBuiltinSpecifier(specifier) {
  // The node: protocol is runtime-owned and can never resolve to an npm
  // package. Accept it independently of the validator host's Node release so
  // a newer pinned companion runtime cannot be misclassified by an older
  // central validator. Unsupported future built-ins still fail in the exact
  // companion build/test workflow.
  return specifier.startsWith("node:") || nodeBuiltinSpecifiers.has(specifier);
}

export function extractJavaScriptDependencies(source, importer, declaredPackages) {
  const tokens = tokenizeJavaScript(source, importer);
  const dependencies = [];
  const declaredPackageNames = new Set(declaredPackages);
  rejectUnsupportedRuntimeLoaders(tokens, importer);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;

    if (token.value === "import" && tokens[index - 1]?.value !== ".") {
      const next = tokens[index + 1];
      if (next?.value === ".") {
        if (
          tokens[index + 2]?.value === "meta"
          && tokens[index + 3]?.value === "."
          && /^glob(?:Eager)?$/.test(tokens[index + 4]?.value ?? "")
          && tokens[index + 5]?.value === "("
        ) {
          throw new UnsupportedClosureError(
            "JAVASCRIPT_IMPORT_META_GLOB_UNPROVEN",
            `unsupported local JavaScript dependency syntax import.meta.${tokens[index + 4].value}: ${importer}`
          );
        }
        continue;
      }
      if (next?.value === "(") {
        const call = readLiteralDependencyCall(
          tokens,
          index + 1,
          "dynamic import",
          importer,
          { allowAdditionalArguments: true }
        );
        addSpecifier(call.specifier, "javascript-dynamic-import");
        index = call.endIndex;
        continue;
      }
      if (next?.type === "string") {
        addSpecifier(readModuleSpecifier(next, importer), "javascript-import");
        index += 1;
        continue;
      }

      const declaration = readStaticImport(tokens, index, importer);
      if (declaration) {
        addSpecifier(declaration.specifier, "javascript-import");
        index = declaration.endIndex;
        continue;
      }
      continue;
    }

    if (token.value === "export" && tokens[index - 1]?.value !== ".") {
      const declaration = readStaticReExport(tokens, index, importer);
      if (declaration) {
        if (declaration.specifier !== null) addSpecifier(declaration.specifier, "javascript-re-export");
        index = declaration.endIndex;
      }
      continue;
    }

    if (token.value === "require") {
      const next = tokens[index + 1];
      if (next?.value === "(") {
        const call = readLiteralDependencyCall(tokens, index + 1, "require", importer);
        addSpecifier(call.specifier, "javascript-require");
        index = call.endIndex;
        continue;
      }
      if (next?.value === ".") {
        const method = tokens[index + 2];
        if (method?.value === "resolve" && tokens[index + 3]?.value === "(") {
          const call = readLiteralDependencyCall(tokens, index + 3, "require.resolve", importer);
          addSpecifier(call.specifier, "javascript-require-resolve");
          index = call.endIndex;
          continue;
        }
        if (tokens[index + 3]?.value === "(") {
          throw new UnsupportedClosureError(
            "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
            `unsupported local JavaScript dependency syntax require.${String(method?.value)}: ${importer}`
          );
        }
        continue;
      }
      throw new UnsupportedClosureError(
        "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
        `unsupported indirect require reference: ${importer}`
      );
    }
  }

  return dependencies;

  function addSpecifier(specifier, kind) {
    if (unsupportedLocalJavaScriptAlias(specifier)) {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_ALIAS_RESOLUTION_UNPROVEN",
        `unsupported local JavaScript import alias: ${specifier}`
      );
    }
    if (
      !isLocalJavaScriptSpecifier(specifier)
      && !isNodeBuiltinSpecifier(specifier)
      && ![...declaredPackageNames].some((packageName) => isExactDeclaredPackageSpecifier(specifier, packageName))
    ) {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_PACKAGE_DEPENDENCY_UNBOUND",
        `bare JavaScript import is not bound by an exact package dependency: ${specifier}`
      );
    }
    dependencies.push({ specifier, kind });
  }
}

export function analyzeJavaScriptModuleDependencies(source, importer, declaredPackages = []) {
  if (typeof source !== "string" || !isCanonicalReviewTargetPath(importer)) {
    throw new Error("JavaScript closure analysis input is invalid");
  }
  const packageNames = [...declaredPackages];
  if (packageNames.some((entry) => !isCanonicalNpmPackageName(entry))) {
    throw new Error("JavaScript closure analysis package input is invalid");
  }
  return extractJavaScriptDependencies(source, importer, packageNames)
    .map((entry) => Object.freeze({ ...entry }));
}

export function assertNoUnboundBrowserRuntimeLoaders(source, importer) {
  if (typeof source !== "string" || !isCanonicalReviewTargetPath(importer)) {
    throw new Error("JavaScript runtime-closure analysis input is invalid");
  }
  const tokens = tokenizeJavaScript(source, importer);
  const unsupportedIdentifiers = new Map([
    ["DOMParser", "runtime DOM parsing"],
    ["SharedWorker", "Worker construction"],
    ["WebAssembly", "WebAssembly loading"],
    ["Worker", "Worker construction"],
    ["createContextualFragment", "dynamic DOM markup injection"],
    ["createElement", "dynamic DOM element construction"],
    ["importScripts", "worker importScripts"],
    ["innerHTML", "dynamic DOM markup injection"],
    ["insertAdjacentHTML", "dynamic DOM markup injection"],
    ["outerHTML", "dynamic DOM markup injection"],
    ["serviceWorker", "service-worker registration"]
  ]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;
    const next = tokens[index + 1]?.value;
    const afterNext = tokens[index + 2]?.value;
    const label = unsupportedIdentifiers.get(token.value);
    if (label !== undefined) unsupportedBrowserLoader(label, importer);
    if (token.value === "fetch") {
      unsupportedBrowserLoader("fetch-based runtime loading", importer);
    }
    if (
      (token.value === "src" || token.value === "href")
      && tokens[index - 1]?.value === "."
      && next === "="
    ) unsupportedBrowserLoader("dynamic DOM resource assignment", importer);
    if (token.value === "setAttribute" && next === "(") {
      unsupportedBrowserLoader("dynamic DOM attribute assignment", importer);
    }
    if (
      token.value === "document"
      && next === "."
      && (afterNext === "write" || afterNext === "writeln")
      && tokens[index + 3]?.value === "("
    ) unsupportedBrowserLoader("document markup injection", importer);
  }
}

function unsupportedBrowserLoader(label, importer) {
  throw new UnsupportedClosureError(
    "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
    `${label} is outside the static JavaScript closure method: ${importer}`
  );
}

function rejectUnsupportedRuntimeLoaders(tokens, importer) {
  const runtimeLoaders = new Set([
    "createRequire",
    "getBuiltinModule",
    "_load",
    "__webpack_require__",
    "__non_webpack_require__"
  ]);
  const dynamicEvaluators = new Set(["eval", "Function"]);
  const computedLoaderProperties = new Set([
    "require",
    "import",
    "createRequire",
    "_load",
    "eval",
    "Function",
    "constructor"
  ]);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "identifier" && runtimeLoaders.has(token.value)) {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
        `unsupported runtime JavaScript loader ${token.value}: ${importer}`
      );
    }
    if (token.type === "identifier" && dynamicEvaluators.has(token.value)) {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
        `unsupported dynamic JavaScript evaluation ${token.value}: ${importer}`
      );
    }
    if (token.value === "[") {
      const property = constantComputedProperty(tokens, index, importer);
      if (property && computedLoaderProperties.has(property.value)) {
        throw new UnsupportedClosureError(
          "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
          `unsupported computed JavaScript loader property ${property.value}: ${importer}`
        );
      }
    }
  }
}

function constantComputedProperty(tokens, openingIndex, importer) {
  let cursor = openingIndex + 1;
  let value = "";
  let sawString = false;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token.value === "]") {
      return sawString ? { value, endIndex: cursor } : null;
    }
    if (token.type !== "string") return null;
    if (token.hasEscape) {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
        `unsupported escaped computed JavaScript property: ${importer}`
      );
    }
    value += token.value;
    sawString = true;
    cursor += 1;
    if (tokens[cursor]?.value === "]") continue;
    if (tokens[cursor]?.value !== "+") return null;
    cursor += 1;
  }
  return null;
}

function readStaticImport(tokens, importIndex, importer) {
  let cursor = importIndex + 1;
  if (tokens[cursor]?.value === "type" && tokens[cursor + 1]?.value !== "from") cursor += 1;

  if (tokens[cursor]?.type === "identifier") {
    cursor += 1;
    if (tokens[cursor]?.value === "=") return null;
    if (tokens[cursor]?.value === ",") cursor += 1;
  }

  if (tokens[cursor]?.value === "*") {
    cursor += 1;
    if (tokens[cursor]?.value !== "as" || tokens[cursor + 1]?.type !== "identifier") {
      throw new UnsupportedClosureError(
        "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
        `unsupported static JavaScript import syntax: ${importer}`
      );
    }
    cursor += 2;
  } else if (tokens[cursor]?.value === "{") {
    cursor = closingTokenIndex(tokens, cursor, "{", "}", importer) + 1;
  }

  if (tokens[cursor]?.value !== "from" || tokens[cursor + 1]?.type !== "string") {
    throw new UnsupportedClosureError(
      "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
      `unsupported static JavaScript import syntax: ${importer}`
    );
  }
  return {
    specifier: readModuleSpecifier(tokens[cursor + 1], importer),
    endIndex: cursor + 1
  };
}

function readStaticReExport(tokens, exportIndex, importer) {
  let cursor = exportIndex + 1;
  if (tokens[cursor]?.value === "type") cursor += 1;
  if (tokens[cursor]?.value === "*") {
    cursor += 1;
    if (tokens[cursor]?.value === "as") {
      if (tokens[cursor + 1]?.type !== "identifier") {
        throw new UnsupportedClosureError(
          "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
          `unsupported static JavaScript re-export syntax: ${importer}`
        );
      }
      cursor += 2;
    }
  } else if (tokens[cursor]?.value === "{") {
    cursor = closingTokenIndex(tokens, cursor, "{", "}", importer) + 1;
  } else {
    return null;
  }
  if (tokens[cursor]?.value !== "from") {
    return {
      specifier: null,
      endIndex: cursor - 1
    };
  }
  if (tokens[cursor + 1]?.type !== "string") {
    throw new UnsupportedClosureError(
      "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
      `static JavaScript re-export must use one string literal: ${importer}`
    );
  }
  return {
    specifier: readModuleSpecifier(tokens[cursor + 1], importer),
    endIndex: cursor + 1
  };
}

function closingTokenIndex(tokens, openingIndex, opening, closing, importer) {
  let depth = 0;
  for (let index = openingIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === opening) depth += 1;
    if (tokens[index].value === closing) {
      depth -= 1;
      if (depth === 0) return index;
    }
    if (tokens[index].value === ";" && depth > 0) break;
  }
  throw new Error(`unterminated static JavaScript module declaration: ${importer}`);
}

function readLiteralDependencyCall(
  tokens,
  openingIndex,
  label,
  importer,
  { allowAdditionalArguments = false } = {}
) {
  const argument = tokens[openingIndex + 1];
  if (argument?.type !== "string") {
    throw new UnsupportedClosureError(
      label === "dynamic import"
        ? "JAVASCRIPT_DYNAMIC_IMPORT_UNPROVEN"
        : "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
      `${label} must use one string literal: ${importer}`
    );
  }
  let cursor = openingIndex + 2;
  if (tokens[cursor]?.value !== ")") {
    if (!allowAdditionalArguments || tokens[cursor]?.value !== ",") {
      throw new UnsupportedClosureError(
        label === "dynamic import"
          ? "JAVASCRIPT_DYNAMIC_IMPORT_UNPROVEN"
          : "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
        `${label} must use one string literal: ${importer}`
      );
    }
    cursor += 1;
    if (tokens[cursor]?.value !== ")") {
      let depth = 1;
      for (; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor].value === "(") depth += 1;
        if (tokens[cursor].value === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) throw new Error(`unterminated ${label} call: ${importer}`);
    }
  }
  return {
    specifier: readModuleSpecifier(argument, importer),
    endIndex: openingIndex + 1
  };
}

function readModuleSpecifier(token, importer) {
  if (token.hasEscape) {
    throw new UnsupportedClosureError(
      "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
      `JavaScript module specifier may not contain escapes: ${importer}`
    );
  }
  if (token.value.length === 0) throw new Error(`JavaScript module specifier may not be empty: ${importer}`);
  return token.value;
}

function unsupportedLocalJavaScriptAlias(specifier) {
  return specifier.startsWith("/")
    || specifier.startsWith("file:")
    || /^(?:@\/|~\/|#|src\/|app\/|components\/|models\/|submissions\/|scripts\/)/.test(specifier);
}

export function isLocalJavaScriptSpecifier(specifier) {
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
}

function tokenizeJavaScript(source, importer) {
  const tokens = [];
  let index = 0;
  let templateDepth = 0;

  if (source.startsWith("#!")) {
    const lineEnd = source.indexOf("\n");
    index = lineEnd === -1 ? source.length : lineEnd + 1;
  }
  scanCode(false);
  return tokens;

  function scanCode(stopAtTemplateExpression) {
    let braceDepth = 0;
    while (index < source.length) {
      const current = source[index];
      const next = source[index + 1];
      if (/\s/.test(current)) {
        index += 1;
        continue;
      }
      if (current === "/" && next === "/") {
        index += 2;
        while (index < source.length && source[index] !== "\n") index += 1;
        continue;
      }
      if (current === "/" && next === "*") {
        index += 2;
        const closing = source.indexOf("*/", index);
        if (closing === -1) throw new Error(`unterminated JavaScript block comment: ${importer}`);
        index = closing + 2;
        continue;
      }
      if (current === "'" || current === '"') {
        pushToken(readJavaScriptString(current));
        continue;
      }
      if (current === "`") {
        scanTemplate();
        pushToken({ type: "literal", value: "template-literal" });
        continue;
      }
      if (current === "/" && canStartRegularExpression(tokens.at(-1))) {
        skipRegularExpression();
        pushToken({ type: "literal", value: "regular-expression" });
        continue;
      }
      if (isJavaScriptIdentifierStart(current)) {
        const start = index;
        index += 1;
        while (index < source.length && isJavaScriptIdentifierPart(source[index])) index += 1;
        pushToken({ type: "identifier", value: source.slice(start, index) });
        continue;
      }
      if (current === "\\" && source[index + 1] === "u") {
        throw new UnsupportedClosureError(
          "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
          `escaped JavaScript identifiers are not supported: ${importer}`
        );
      }
      const twoCharacterPunctuator = source.slice(index, index + 2);
      if (twoCharacterPunctuator === "++" || twoCharacterPunctuator === "--") {
        pushToken({ type: "punctuator", value: twoCharacterPunctuator });
        index += 2;
        continue;
      }
      if (stopAtTemplateExpression && current === "}" && braceDepth === 0) {
        index += 1;
        return;
      }
      if (stopAtTemplateExpression && current === "{") braceDepth += 1;
      if (stopAtTemplateExpression && current === "}") braceDepth -= 1;
      pushToken({ type: "punctuator", value: current });
      index += 1;
    }
    if (stopAtTemplateExpression) throw new Error(`unterminated JavaScript template expression: ${importer}`);
  }

  function readJavaScriptString(quote) {
    index += 1;
    let value = "";
    let hasEscape = false;
    while (index < source.length) {
      const current = source[index];
      if (current === quote) {
        index += 1;
        return { type: "string", value, hasEscape };
      }
      if (current === "\n" || current === "\r") {
        throw new Error(`unterminated JavaScript string literal: ${importer}`);
      }
      if (current === "\\") {
        hasEscape = true;
        value += current;
        index += 1;
        if (index >= source.length) break;
        value += source[index];
        index += 1;
        continue;
      }
      value += current;
      index += 1;
    }
    throw new Error(`unterminated JavaScript string literal: ${importer}`);
  }

  function scanTemplate() {
    templateDepth += 1;
    if (templateDepth > MAX_JAVASCRIPT_TEMPLATE_DEPTH) {
      throw new Error(`JavaScript source exceeds ${MAX_JAVASCRIPT_TEMPLATE_DEPTH} nested template literals: ${importer}`);
    }
    try {
      index += 1;
      while (index < source.length) {
        const current = source[index];
        const next = source[index + 1];
        if (current === "\\") {
          index += 2;
          continue;
        }
        if (current === "`") {
          index += 1;
          return;
        }
        if (current === "$" && next === "{") {
          index += 2;
          scanCode(true);
          continue;
        }
        index += 1;
      }
      throw new Error(`unterminated JavaScript template literal: ${importer}`);
    } finally {
      templateDepth -= 1;
    }
  }

  function skipRegularExpression() {
    index += 1;
    let inClass = false;
    while (index < source.length) {
      const current = source[index];
      if (current === "\\") {
        index += 2;
        continue;
      }
      if (current === "[") inClass = true;
      if (current === "]") inClass = false;
      if (current === "/" && !inClass) {
        index += 1;
        while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
        return;
      }
      if (current === "\n" || current === "\r") break;
      index += 1;
    }
    throw new Error(`unterminated JavaScript regular expression: ${importer}`);
  }

  function pushToken(token) {
    if (tokens.length >= MAX_JAVASCRIPT_TOKENS) {
      throw new Error(`JavaScript source exceeds ${MAX_JAVASCRIPT_TOKENS} lexical tokens: ${importer}`);
    }
    tokens.push(token);
  }
}

function canStartRegularExpression(previous) {
  if (!previous) return true;
  if (previous.type === "identifier") {
    return new Set(["await", "case", "delete", "do", "else", "in", "instanceof", "new", "of", "return", "throw", "typeof", "void", "yield"]).has(previous.value);
  }
  if (previous.value === "++" || previous.value === "--") return false;
  return new Set(["(", "[", "{", ",", ":", ";", "=", "!", "?", "&", "|", "+", "-", "*", "%", "^", "~", "<", ">"]).has(previous.value);
}

function isJavaScriptIdentifierStart(value) {
  return /[A-Za-z_$]/.test(value);
}

function isJavaScriptIdentifierPart(value) {
  return /[A-Za-z0-9_$]/.test(value);
}
