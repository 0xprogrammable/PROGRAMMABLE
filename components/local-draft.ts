"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  createEmptyDraft,
  LAUNCH_DRAFT_STORAGE_KEY,
  type LaunchDraft,
} from "@/lib/launch";

const draftEvent = "launcher:draft-change";
const emptyDraftSnapshot = "__launcher_empty_draft__";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(draftEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(draftEvent, onStoreChange);
  };
}

function getSnapshot() {
  return (
    window.localStorage.getItem(LAUNCH_DRAFT_STORAGE_KEY) ??
    emptyDraftSnapshot
  );
}

function getServerSnapshot() {
  return null;
}

export function useLocalDraft() {
  const stored = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  return useMemo(() => {
    if (stored === null) return undefined;
    if (stored === emptyDraftSnapshot) return null;
    try {
      const parsed = JSON.parse(stored) as Partial<LaunchDraft>;
      if (parsed.version !== 1) return null;
      return { ...createEmptyDraft(), ...parsed };
    } catch {
      return null;
    }
  }, [stored]);
}

export function saveLocalDraft(draft: LaunchDraft) {
  window.localStorage.setItem(
    LAUNCH_DRAFT_STORAGE_KEY,
    JSON.stringify(draft),
  );
  window.dispatchEvent(new Event(draftEvent));
}
