import {
  OPEN_WORLD_SOURCE_SIGNAL_VERSION,
  uniqueStrings
} from "./open-world-source-signals-contract.mjs";

export function buildOpenWorldSourceLayer(scanOrSignals) {
  const signals = Array.isArray(scanOrSignals) ? scanOrSignals : scanOrSignals?.signals ?? [];
  const sourceLayer = {};
  const allEvidenceRefs = uniqueStrings(signals.flatMap(({ evidenceRefs = [] }) => evidenceRefs));
  if (allEvidenceRefs.length > 0) sourceLayer.evidenceRefs = allEvidenceRefs;
  return sourceLayer;
}

export function buildAutomatedSourceFindings(signals, sourceRecords, astRecords) {
  const findings = [];
  let findingIndex = 0;
  for (const signal of signals) {
    for (const evidence of signal.evidence ?? []) {
      findingIndex += 1;
      findings.push({
        id: `${signal.id.replace(/\./gu, "-")}-${findingIndex}`,
        rule: {
          id: signal.id,
          scope: "solidity"
        },
        source: {
          tool: "open-world-source-signals",
          toolVersion: OPEN_WORLD_SOURCE_SIGNAL_VERSION,
          reportRef: evidence.artifactRef,
          reportSha256: evidence.artifactSha256
        },
        confidence: evidence.confidence,
        status: "automated",
        language: "solidity",
        repositoryPath: evidence.path,
        category: automatedCategoryForSignal(signal.id),
        message: signal.description,
        evidenceRefs: uniqueStrings([evidence.artifactRef, evidence.ref])
      });
    }
  }
  for (const source of sourceRecords.values()) {
    if (!["language-review-required", "resource-review-required"].includes(source.scanState)) continue;
    findingIndex += 1;
    findings.push({
      id: `source-scan-review-${findingIndex}`,
      rule: {
        id: source.scanState === "language-review-required" ? "source-language-router" : "source-resource-budget",
        scope: source.language
      },
      source: {
        tool: "open-world-source-signals",
        toolVersion: OPEN_WORLD_SOURCE_SIGNAL_VERSION,
        reportRef: source.path,
        reportSha256: source.artifactSha256
      },
      confidence: "low",
      status: "partial",
      language: source.language,
      repositoryPath: source.path,
      category: "other",
      message: source.scanState === "language-review-required"
        ? "No matching language-specific scanner was applied; the source remains pending independent review."
        : "The configured scanner resource budget was reached; the unscanned source remains pending independent review.",
      evidenceRefs: [source.path]
    });
  }
  for (const astRecord of astRecords) {
    if (!["language-review-required", "resource-review-required"].includes(astRecord.scanState)) continue;
    findingIndex += 1;
    findings.push({
      id: `ast-scan-review-${findingIndex}`,
      rule: {
        id: astRecord.scanState === "language-review-required" ? "ast-language-router" : "ast-resource-budget",
        scope: astRecord.language
      },
      source: {
        tool: "open-world-source-signals",
        toolVersion: OPEN_WORLD_SOURCE_SIGNAL_VERSION,
        reportRef: astRecord.artifactRef,
        reportSha256: astRecord.artifactSha256
      },
      confidence: "low",
      status: "partial",
      language: astRecord.language,
      repositoryPath: astRecord.path,
      category: "other",
      message: astRecord.scanState === "language-review-required"
        ? "The AST path did not match its Solidity tool provenance; no Solidity conclusion was promoted."
        : "The configured AST scanner resource budget was reached; the remaining AST stays pending independent review.",
      evidenceRefs: [astRecord.artifactRef]
    });
  }
  return findings;
}

export function automatedCategoryForSignal(signalId) {
  if (signalId.startsWith("callback.") || signalId.startsWith("authorization.") || signalId.startsWith("external-call.")) return "authorization";
  if (signalId.startsWith("loop.")) return "liveness";
  if (signalId.startsWith("privilege.") || signalId.startsWith("upgrade.")) return "authorization";
  if (signalId.startsWith("replay.") || signalId.startsWith("signature.")) return "authorization";
  return "other";
}
