"use client";

import { useEffect, useState } from "react";
import type { RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";

export function useRobinhoodPresentation(query: string, enabled = true, refresh = 0) {
  const [state, setState] = useState<{
    query: string; items: readonly RobinhoodCoinPresentation[]; loading: boolean;
  }>({ query, items: [], loading: true });

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (disposed || controller || document.visibilityState === "hidden") return;
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
        if (!disposed) setState({ query, items: body.items, loading: false });
      } catch {
        if (!disposed) setState((current) => ({
          query, items: current.query === query ? current.items : [], loading: false,
        }));
      } finally {
        clearTimeout(timeout);
        controller = null;
        if (!disposed) timer = setTimeout(load, 60_000);
      }
    }
    function onVisibility() {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") controller?.abort();
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
  }, [enabled, query, refresh]);

  return state.query === query ? state : { query, items: [], loading: true };
}
