const WEBSITE_EXPLORE_INDEX_FLAG =
  "PROGRAMMABLE_WEBSITE_EXPLORE_INDEX_ENABLED" as const;

type WebsiteExploreEnvironment = Readonly<{
  PROGRAMMABLE_WEBSITE_EXPLORE_INDEX_ENABLED?: string;
}>;

/**
 * Temporary website-only boundary while the public Explore experience is
 * rebuilt. The public APIs and provider adapters remain unchanged.
 */
export function websiteExploreIndexEnabledV1(
  environment: WebsiteExploreEnvironment = {
    [WEBSITE_EXPLORE_INDEX_FLAG]: process.env[WEBSITE_EXPLORE_INDEX_FLAG],
  },
) {
  return environment[WEBSITE_EXPLORE_INDEX_FLAG]?.trim().toLowerCase() ===
    "true";
}
