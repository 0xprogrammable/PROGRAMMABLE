"use client";

import { useEffect, useRef, useState } from "react";

export const LIVE_DATA_REFRESH_INTERVAL_MS = 5_000;

export function shouldRefreshLiveData(input: {
  visibilityState: DocumentVisibilityState;
  lastRefreshAt: number;
  now: number;
  intervalMs?: number;
}) {
  const intervalMs = input.intervalMs ?? LIVE_DATA_REFRESH_INTERVAL_MS;
  return (
    input.visibilityState === "visible" &&
    Number.isSafeInteger(intervalMs) &&
    intervalMs >= 1_000 &&
    input.now - input.lastRefreshAt >= intervalMs
  );
}

export function useLiveDataRefresh(
  input: Readonly<{
    enabled?: boolean;
    intervalMs?: number;
  }> = {},
) {
  const enabled = input.enabled ?? true;
  const intervalMs = input.intervalMs ?? LIVE_DATA_REFRESH_INTERVAL_MS;
  const [refreshKey, setRefreshKey] = useState(0);
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    lastRefreshAt.current = Date.now();

    function refreshIfDue() {
      const now = Date.now();
      if (
        !shouldRefreshLiveData({
          visibilityState: document.visibilityState,
          lastRefreshAt: lastRefreshAt.current,
          now,
          intervalMs,
        })
      ) {
        return;
      }
      lastRefreshAt.current = now;
      setRefreshKey((value) => value + 1);
    }

    const interval = window.setInterval(refreshIfDue, intervalMs);
    document.addEventListener("visibilitychange", refreshIfDue);
    window.addEventListener("focus", refreshIfDue);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfDue);
      window.removeEventListener("focus", refreshIfDue);
    };
  }, [enabled, intervalMs]);

  return refreshKey;
}
