import { describe, expect, it } from "vitest";

import {
  LIVE_DATA_REFRESH_INTERVAL_MS,
  shouldRefreshLiveData,
} from "../components/use-live-data-refresh";

describe("live data refresh policy", () => {
  it("refreshes visible data every five seconds", () => {
    expect(LIVE_DATA_REFRESH_INTERVAL_MS).toBe(5_000);
    expect(
      shouldRefreshLiveData({
        visibilityState: "visible",
        lastRefreshAt: 1_000,
        now: 6_000,
      }),
    ).toBe(true);
  });

  it("does not refresh hidden tabs or early intervals", () => {
    expect(
      shouldRefreshLiveData({
        visibilityState: "hidden",
        lastRefreshAt: 1_000,
        now: 60_000,
      }),
    ).toBe(false);
    expect(
      shouldRefreshLiveData({
        visibilityState: "visible",
        lastRefreshAt: 1_000,
        now: 5_999,
      }),
    ).toBe(false);
  });
});
