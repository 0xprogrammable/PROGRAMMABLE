import fs from "node:fs";
import path from "node:path";
import { analyzePublicClaimSource, findUnsupportedPublicClaims } from "./public-claims-core.mjs";
import { assertInsideRepository } from "./repository-root.mjs";
import { isCanonicalReviewTargetPath } from "./review-target-contract.mjs";
import { MAX_FILE_BYTES } from "./verify-package-contracts.mjs";

export function verifyUnsupportedPublicClaims({
  claimErrors,
  packageEntries,
  packageRoot,
  repositoryRoot,
  submission,
  addToolingBlocker,
  relative
}) {
  function rejectUnsupportedPublicClaims(claimErrors) {
    const publicApplicationDocuments = new Set([
      "submission.json",
      "compatibility-report.json",
      "PROPOSAL.md",
      "THREAT_MODEL.md",
      "TEST_PLAN.md",
      "EVIDENCE.md"
    ]);
    const packageTargets = packageEntries
      .filter((entry) => entry.stat.isFile()
        && entry.stat.size <= MAX_FILE_BYTES
        && publicApplicationDocuments.has(path.relative(packageRoot, entry.path).replaceAll(path.sep, "/")))
      .map((entry) => entry.path);
    const scannedTargets = new Set();
    for (const target of packageTargets) {
      scannedTargets.add(path.resolve(target));
      const analysis = analyzePublicClaimSource(fs.readFileSync(target, "utf8"), path.extname(target));
      rejectIncompletePublicClaimAnalysis(relative(target), analysis);
      for (const finding of findUnsupportedPublicClaims(analysis.text)) {
        claimErrors.push(`${relative(target)} contains an unsupported ${finding} claim`);
      }
    }

    for (const relativePath of declaredPublicClaimPaths(submission)) {
      const extension = path.extname(relativePath).toLowerCase();
      if (!isSupportedPublicClaimPath(relativePath, extension)) continue;
      if (!isCanonicalReviewTargetPath(relativePath)) continue;
      const target = path.resolve(repositoryRoot, relativePath);
      if (scannedTargets.has(target) || isTestLikePublicSourcePath(relativePath)) continue;
      try {
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) continue;
        assertInsideRepository(repositoryRoot, target);
      } catch {
        continue;
      }
      scannedTargets.add(target);
      const analysis = analyzePublicClaimSource(fs.readFileSync(target, "utf8"), extension);
      rejectIncompletePublicClaimAnalysis(relativePath, analysis);
      for (const finding of findUnsupportedPublicClaims(analysis.text)) {
        claimErrors.push(`${relativePath} contains an unsupported ${finding} claim in declared public UI, locale or content text`);
      }
    }
  }

  function rejectIncompletePublicClaimAnalysis(relativePath, analysis) {
    if (analysis.analysisComplete) return;
    const issueCodes = analysis.analysisIssues.length > 0
      ? analysis.analysisIssues.join(", ")
      : "STATIC_JAVASCRIPT_ANALYSIS_FAILED";
    addToolingBlocker(`${relativePath} public claim analysis is incomplete (${issueCodes}); bounded static review could not inspect all composed public copy`);
  }

  function declaredPublicClaimPaths(value) {
    const integration = value?.integration ?? {};
    const routing = integration.routingAndDiscoverability ?? {};
    const reconstruction = integration.dataReconstruction ?? {};
    const handoff = integration.platformHandoff ?? {};
    const testPaths = new Set([
      ...(value?.implementation?.testPaths ?? []),
      ...(integration.integrationTestPaths ?? []),
      ...(routing.testPaths ?? []),
      ...(reconstruction.testPaths ?? []),
      ...(handoff.testPaths ?? []),
      ...(value?.projectSurfaces ?? []).flatMap((surface) => surface?.testPaths ?? []),
      ...(value?.capabilityExtensions ?? []).flatMap((extension) => extension?.testPaths ?? []),
      ...(value?.tokenBehaviorExtensions ?? []).flatMap((extension) => extension?.testPaths ?? [])
    ]);
    const declared = [
      ...(integration.appSourcePaths ?? []),
      ...(handoff.uiSourcePaths ?? []),
      ...(value?.projectSurfaces ?? [])
        .filter(isPublicFacingProjectSurface)
        .flatMap((surface) => surface?.sourcePaths ?? [])
    ];
    return [...new Set(declared)].filter((entry) => !testPaths.has(entry));
  }

  function isPublicFacingProjectSurface(surface) {
    if (["browser", "mobile-client"].includes(surface?.executionBoundary)) return true;
    return new Set(["game-client", "map-client", "mobile-app", "web-app"]).has(surface?.kind);
  }

  function isSupportedPublicClaimPath(relativePath, extension) {
    if (!/[.](?:[cm]?[jt]sx?|html?|vue|svelte|json|ya?ml|mdx?|markdown|txt)$/iu.test(extension)) return false;
    const baseName = path.posix.basename(relativePath).toLowerCase();
    if (/^(?:bun|npm-shrinkwrap|package|package-lock|pnpm-lock|yarn)\.(?:json|lock|ya?ml|lockb)$/u.test(baseName)) return false;
    if (/^(?:babel|eslint|jest|jsconfig|next|nuxt|postcss|prettier|rollup|stylelint|svelte|tailwind|tsconfig|vite|vitest|webpack)(?:\.[^.]+)*\.(?:json|ya?ml|[cm]?[jt]s)$/u.test(baseName)) return false;
    return true;
  }

  function isTestLikePublicSourcePath(value) {
    return /(?:^|\/)(?:__tests__|test|tests|fixtures?|stories)(?:\/|$)|\.(?:test|spec|stories?|story)\.[^.\/]+$/iu.test(value);
  }


  rejectUnsupportedPublicClaims(claimErrors);
}
