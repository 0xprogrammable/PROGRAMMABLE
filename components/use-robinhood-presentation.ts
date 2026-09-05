"use client";

import { useEffect, useState } from "react";
import { mergeRobinhoodPresentations, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import {
  readRememberedRobinhoodPresentation,
  rememberRobinhoodPresentation,
  rememberRobinhoodTokenPresentations,
} from "@/components/robinhood-presentation-cache";

export function useRobinhoodPresentation(query: string, enabled = true) {
  const [state, setState] = useState<{
    query: string; items: readonly RobinhoodCoinPresentation[]; loading: boolean; delayed: boolean;
  }>(() => ({
    query,
    ...(enabled ? readRememberedRobinhoodPresentation(query) : null) ?? { items: [], delayed: false },
    loading: true,
  }));

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let items = readRememberedRobinhoodPresentation(query)?.items ?? [];
    const isVisible = () => document.visibilityState !== "hidden";
    async function load() {
      if (disposed || controller || !isVisible()) return;
      controller = new AbortController();
      const active = controller;
      const timeout = setTimeout(() => active.abort(), 10_000);
      try {
        const response = await fetch(`/api/explore/robinhood/presentation?${query}`, {
          signal: active.signal, cache: "no-store", headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error("Presentation unavailable");
        const body = await response.json();
        if (!Array.isArray(body.items) || body.items.length > 50) throw new Error("Invalid presentation");
        if (disposed || active.signal.aborted) return;
        const next = rememberRobinhoodPresentation(query, mergeRobinhoodPresentations(items, body.items));
        items = next.items;
        rememberRobinhoodTokenPresentations(items);
        setState({ query, ...next, loading: false });
      } catch {
        if (!disposed && active.signal.reason !== "hidden") {
          const next = mergeRobinhoodPresentations(items, null);
          items = next.items;
          setState({ query, ...next, loading: false });
        }
      } finally {
        clearTimeout(timeout);
        controller = null;
        if (!disposed && isVisible()) timer = setTimeout(load, active.signal.reason === "hidden" ? 0 : 60_000);
      }
    }
    function onVisibility() {
      clearTimeout(timer);
      if (!isVisible()) controller?.abort("hidden");
      else void load();
    }
    void load();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, query]);

  if (!enabled) return { query, items: [], loading: false, delayed: false };
  // A route or account change can reuse only its own saved presentation.
  return state.query === query ? state : {
    query,
    ...readRememberedRobinhoodPresentation(query) ?? { items: [], delayed: false },
    loading: true,
  };
}
