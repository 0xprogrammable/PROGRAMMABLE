import crypto from "node:crypto";
import { isObject } from "./open-world-source-signals-contract.mjs";

export function collectSourceRecords(input, diagnostics) {
  const records = new Map();
  const add = (path, content, origin, declaredLanguage = null, declaredMediaType = null) => {
    if (typeof path !== "string" || path.length === 0 || typeof content !== "string") {
      diagnostics.push({ code: "SOURCE_RECORD_INVALID", path: String(path ?? "$source"), message: "A source record needs a non-empty path and string content." });
      return;
    }
    const inferredLanguage = sourceLanguageForPath(path);
    const declared = normalizeDeclaredLanguage(declaredLanguage, declaredMediaType);
    const language = declared ?? inferredLanguage ?? "other";
    const mediaType = typeof declaredMediaType === "string" && declaredMediaType.trim().length > 0
      ? declaredMediaType
      : mediaTypeForLanguage(language);
    const solidityScannerEligible = language === "solidity" && inferredLanguage === "solidity";
    if (declared !== null && inferredLanguage !== null && declared !== inferredLanguage) {
      diagnostics.push({
        code: "SOURCE_LANGUAGE_PATH_MISMATCH",
        path,
        message: "Declared language and repository-path extension disagree; no language-specific rule may treat this mismatch as confirmed source evidence.",
        declaredLanguage: declared,
        pathLanguage: inferredLanguage
      });
    }
    const existing = records.get(path);
    if (existing && existing.content !== content) {
      diagnostics.push({ code: "SOURCE_CONTENT_CONFLICT", path, message: "Different supplied inputs contain different content for the same source path; the first copy was retained and no absence conclusion is drawn." });
      return;
    }
    if (existing && (existing.language !== language || existing.mediaType !== mediaType)) {
      diagnostics.push({ code: "SOURCE_LANGUAGE_CONFLICT", path, message: "Supplied inputs disagree about source language or media type; the first declaration was retained and language-specific scanning remains conservative." });
      return;
    }
    if (!existing) records.set(path, {
      path,
      content,
      origin,
      language,
      pathLanguage: inferredLanguage,
      mediaType,
      solidityScannerEligible,
      artifactSha256: sha256Text(content),
      scanState: "pending"
    });
  };

  if (Array.isArray(input.sources)) {
    for (const source of input.sources) add(source?.path, source?.content, "sources-array", source?.language, source?.mediaType);
  } else if (isObject(input.sources)) {
    for (const [path, value] of Object.entries(input.sources)) {
      add(path, typeof value === "string" ? value : value?.content, "sources-object", typeof value === "string" ? null : value?.language, typeof value === "string" ? null : value?.mediaType);
    }
  } else if (input.sources !== undefined) {
    diagnostics.push({ code: "SOURCES_INPUT_INVALID", path: "$.sources", message: "sources must be an array or path-keyed object; extraction continued with unknown results." });
  }

  for (const [index, buildInfo] of buildInfoList(input).entries()) {
    if (!isObject(buildInfo)) {
      diagnostics.push({ code: "BUILD_INFO_INVALID", path: `$.buildInfos[${index}]`, message: "A build-info entry must be an object." });
      continue;
    }
    for (const [path, value] of Object.entries(buildInfo.input?.sources ?? {})) add(path, value?.content, `build-info-${index}`, "solidity", "text/x-solidity");
  }
  return records;
}

export function collectAstRecords(input, diagnostics) {
  const records = [];
  for (const [index, buildInfo] of buildInfoList(input).entries()) {
    if (!isObject(buildInfo)) continue;
    for (const [path, value] of Object.entries(buildInfo.output?.sources ?? {})) {
      if (isObject(value?.ast)) records.push({
        path,
        ast: value.ast,
        buildInfoIndex: index,
        language: sourceLanguageForPath(path) ?? "other",
        mediaType: "application/vnd.solc.ast+json",
        solidityScannerEligible: sourceLanguageForPath(path) === "solidity",
        artifactRef: `${path}#solc-ast`,
        artifactSha256: sha256Text(JSON.stringify(value.ast)),
        scanState: "pending"
      });
      else if (value?.ast !== undefined) diagnostics.push({ code: "BUILD_INFO_AST_INVALID", path, message: "The supplied AST is not an object and was ignored." });
    }
  }
  return records;
}

export function buildInfoList(input) {
  return [
    ...(input.buildInfo === undefined ? [] : [input.buildInfo]),
    ...(Array.isArray(input.buildInfos) ? input.buildInfos : input.buildInfos === undefined ? [] : [input.buildInfos])
  ];
}

export function sourceLanguageForPath(sourcePath) {
  const lowerPath = sourcePath.toLowerCase();
  if (lowerPath.endsWith(".sol")) return "solidity";
  if (lowerPath.endsWith(".rs")) return "rust";
  if (/\.(?:ts|tsx|mts|cts)$/u.test(lowerPath)) return "typescript";
  if (/\.(?:js|jsx|mjs|cjs)$/u.test(lowerPath)) return "javascript";
  if (/\.(?:py|pyi|pyw)$/u.test(lowerPath)) return "python";
  if (lowerPath.endsWith(".go")) return "go";
  if (lowerPath.endsWith(".cairo")) return "cairo";
  if (lowerPath.endsWith(".move")) return "move";
  if (lowerPath.endsWith(".vy")) return "vyper";
  if (/\.(?:cc|cpp|cxx|hpp)$/u.test(lowerPath)) return "cpp";
  if (lowerPath.endsWith(".c")) return "c";
  if (lowerPath.endsWith(".java")) return "java";
  if (/\.(?:kt|kts)$/u.test(lowerPath)) return "kotlin";
  if (lowerPath.endsWith(".swift")) return "swift";
  return null;
}

export function normalizeDeclaredLanguage(language, mediaType) {
  if (typeof language === "string" && language.trim().length > 0) {
    const normalized = language.trim().toLowerCase();
    if (["sol", "solidity"].includes(normalized)) return "solidity";
    if (["rs", "rust"].includes(normalized)) return "rust";
    if (["ts", "tsx", "typescript"].includes(normalized)) return "typescript";
    if (["js", "jsx", "javascript"].includes(normalized)) return "javascript";
    if (["py", "python", "python3"].includes(normalized)) return "python";
    if (["golang", "go"].includes(normalized)) return "go";
    if (["c++", "cplusplus", "cpp"].includes(normalized)) return "cpp";
    if (["c#", "csharp"].includes(normalized)) return "csharp";
    if (/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(normalized)) return normalized;
    return "other";
  }
  if (typeof mediaType === "string") {
    const normalizedMediaType = mediaType.trim().toLowerCase().split(";", 1)[0];
    if (["text/x-solidity", "application/x-solidity"].includes(normalizedMediaType)) return "solidity";
    if (["text/rust", "text/x-rust"].includes(normalizedMediaType)) return "rust";
    if (["text/typescript", "application/typescript"].includes(normalizedMediaType)) return "typescript";
    if (["text/javascript", "application/javascript"].includes(normalizedMediaType)) return "javascript";
    if (["text/x-python", "application/x-python"].includes(normalizedMediaType)) return "python";
    if (["text/x-go", "application/x-go"].includes(normalizedMediaType)) return "go";
  }
  return null;
}

export function mediaTypeForLanguage(language) {
  if (language === "solidity") return "text/x-solidity";
  if (language === "rust") return "text/x-rust";
  if (language === "typescript") return "text/typescript";
  if (language === "javascript") return "text/javascript";
  if (language === "python") return "text/x-python";
  if (language === "go") return "text/x-go";
  return "text/plain";
}

export function sha256Text(value) {
  return `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}
