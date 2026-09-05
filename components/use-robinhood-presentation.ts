"use client";

import { useEffect, useState } from "react";
import { mergeRobinhoodPresentations, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";

export function useRobinhoodPresentation(query: string, enabled = true) {
  const [state, setState] = useState<{
    query: string; items: readonly RobinhoodCoinPresentation[]; loading: boolean; delayed: boolean;
  }>({ query, items: [], loading: true, delayed: false });

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isVisible = () => document.visibilityState !== "hidden";
    async function load() {
      if (disposed || controller || !isVisible()) return;
      controller = new AbortController();
      const active = controller;
      const timeout = setTimeout(() => active.abort(), 10_000);
      try {
        const response = await fetch(`/api/explore/robinhood/presentation?${query}`, {
          signal: active.signal, headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error("Presentation unavailable");
        const body = await response.json();
        if (!Array.isArray(body.items) || body.items.length > 50) throw new Error("Invalid presentation");
        if (!disposed) setState((current) => ({
          query, ...mergeRobinhoodPresentations(current.query === query ? current.items : [], body.items), loading: false,
        }));
      } catch {
        if (!disposed && active.signal.reason !== "hidden") setState((current) => ({
          query, ...mergeRobinhoodPresentations(current.query === query ? current.items : [], null), loading: false,
        }));
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

  // The list keeps its previous rows until the next response; keep their matching artwork and values too.
  return state.query === query ? state : { ...state, query, loading: true, delayed: false };
}
