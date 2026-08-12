export function completePublicClaimAnalysis(text) {
  return { analysisComplete: true, analysisIssues: [], text };
}

export function incompletePublicClaimAnalysis(text, analysisIssues) {
  return { analysisComplete: false, analysisIssues: [...new Set(analysisIssues)], text };
}

export function mergePublicClaimAnalyses(...analyses) {
  const text = analyses.map((analysis) => analysis.text).filter(Boolean).join("\n");
  const analysisIssues = analyses.flatMap((analysis) => analysis.analysisIssues);
  return analysisIssues.length === 0
    ? completePublicClaimAnalysis(text)
    : incompletePublicClaimAnalysis(text, analysisIssues);
}
