"use client";

import { Check, CircleAlert, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DocsExternalLink } from "@/components/docs-external-link";
import styles from "@/components/docs-experience.module.css";

type CopyState = "idle" | "copied" | "error";

export function getDocsAddressCopyStatus(
  label: string,
  state: CopyState,
): string {
  if (state === "copied") return `${label} address copied`;
  if (state === "error") return `Could not copy ${label} address`;
  return "";
}

export function DocsAddress({
  address,
  label,
}: {
  address: string;
  label: string;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  async function copyAddress() {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
      resetTimerRef.current = window.setTimeout(
        () => setCopyState("idle"),
        1600,
      );
    } catch {
      setCopyState("error");
      resetTimerRef.current = window.setTimeout(
        () => setCopyState("idle"),
        2400,
      );
    }
  }

  const status = getDocsAddressCopyStatus(label, copyState);

  return (
    <span className={styles.addressRow}>
      <DocsExternalLink
        href={`https://etherscan.io/address/${address}#code`}
        variant="address"
      >
        {address}
      </DocsExternalLink>
      <button
        aria-label={`Copy ${label} address`}
        className={styles.addressCopyButton}
        data-state={copyState}
        onClick={copyAddress}
        title={
          copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy failed"
              : "Copy address"
        }
        type="button"
      >
        <span className={styles.addressCopyIcons} aria-hidden="true">
          <Copy className={styles.addressCopyIdleIcon} strokeWidth={1.8} />
          <Check className={styles.addressCopySuccessIcon} strokeWidth={2} />
          <CircleAlert
            className={styles.addressCopyErrorIcon}
            strokeWidth={1.8}
          />
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
    </span>
  );
}
