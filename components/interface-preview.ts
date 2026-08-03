"use client";

import { useSyncExternalStore } from "react";

const LOCAL_PREVIEW_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function isInterfacePreviewHost(hostname: string) {
  return LOCAL_PREVIEW_HOSTS.has(hostname);
}

function subscribe() {
  return () => undefined;
}

function getClientSnapshot() {
  return isInterfacePreviewHost(window.location.hostname);
}

function getServerSnapshot() {
  return false;
}

export function useInterfacePreview() {
  return useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
}
