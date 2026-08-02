import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  indexedLaunchLookupEnabled,
  indexedPublicIndexerFeedEnabled,
} from "../../lib/data-pipeline/route-activation.server";

describe("independent indexed route activation", () => {
  it.each([
    {
      explore: "false",
      action: "false",
      feed: "false",
      expectedAction: false,
      expectedFeed: false,
    },
    {
      explore: "true",
      action: "false",
      feed: "false",
      expectedAction: false,
      expectedFeed: false,
    },
    {
      explore: "false",
      action: "true",
      feed: "false",
      expectedAction: true,
      expectedFeed: false,
    },
    {
      explore: "true",
      action: "false",
      feed: "true",
      expectedAction: false,
      expectedFeed: true,
    },
    {
      explore: "false",
      action: "true",
      feed: "true",
      expectedAction: true,
      expectedFeed: true,
    },
  ])(
    "keeps Explore=$explore, actions=$action and feed=$feed independent",
    ({ explore, action, feed, expectedAction, expectedFeed }) => {
      const env = {
        INDEXED_EXPLORE_LIST_READS_ENABLED: explore,
        INDEXED_EXPLORE_TOKEN_READS_ENABLED: explore,
        INDEXED_LAUNCH_LOOKUP_ENABLED: action,
        INDEXED_PUBLIC_INDEXER_FEED_READS_ENABLED: feed,
      };

      expect(indexedLaunchLookupEnabled(env)).toBe(expectedAction);
      expect(indexedPublicIndexerFeedEnabled(env)).toBe(expectedFeed);
    },
  );
});
