import {
  completePublicClaimAnalysis,
  mergePublicClaimAnalyses
} from "./public-claims-analysis-primitives.mjs";

import {
  extractHtmlPublicParts,
  extractJsonPublicText,
  extractMarkdownPublicText,
  extractYamlPublicText
} from "./public-claims-format-extractors.mjs";

import { analyzeJavascriptPublicText } from "./public-claims-javascript-core.mjs";

export function analyzePublicClaimSource(source, extension) {
  if (typeof source !== "string" || source.length === 0) return completePublicClaimAnalysis("");
  const normalizedExtension = String(extension ?? "").toLowerCase();
  if (normalizedExtension === ".json") return completePublicClaimAnalysis(extractJsonPublicText(source));
  if ([".yaml", ".yml"].includes(normalizedExtension)) return completePublicClaimAnalysis(extractYamlPublicText(source));
  if ([".md", ".mdx", ".markdown"].includes(normalizedExtension)) return completePublicClaimAnalysis(extractMarkdownPublicText(source));
  if ([".html", ".htm"].includes(normalizedExtension)) return completePublicClaimAnalysis(extractHtmlPublicParts(source).text);
  if ([".vue", ".svelte"].includes(normalizedExtension)) {
    const html = extractHtmlPublicParts(source);
    const scriptAnalyses = html.scriptBodies.map((scriptBody) => analyzeJavascriptPublicText(scriptBody));
    return mergePublicClaimAnalyses(completePublicClaimAnalysis(html.text), ...scriptAnalyses);
  }
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"].includes(normalizedExtension)) {
    return analyzeJavascriptPublicText(source);
  }
  return completePublicClaimAnalysis(source);
}

export function extractPublicClaimText(source, extension) {
  return analyzePublicClaimSource(source, extension).text;
}
