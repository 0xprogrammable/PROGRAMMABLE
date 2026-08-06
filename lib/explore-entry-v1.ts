import type { CanonicalTokenExploreEntry, LauncherToken } from "./tokens";

export function canonicalTokenExploreEntryV1(
  token: LauncherToken,
): CanonicalTokenExploreEntry {
  return {
    ...token,
    exploreKind: "token",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: token.id,
      modelId: token.launchModel ?? null,
      modelVersion: token.launchModelVersion ?? token.deepReleaseVersion ?? null,
    },
  };
}
