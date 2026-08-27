import { ExternalLink } from "lucide-react";

import type { LaunchPartnerAttributionV1 } from
  "@/lib/launch-partner-attribution";
import styles from "@/components/partner-launch-attribution.module.css";

export function PartnerLaunchAttribution({
  attribution,
  className,
  compact = false,
}: Readonly<{
  attribution: LaunchPartnerAttributionV1;
  className?: string;
  compact?: boolean;
}>) {
  const classNames = className
    ? `${styles.attribution} ${className}`
    : styles.attribution;
  const content = (
    <>
      <span>Launched via {attribution.name}</span>
      {attribution.website ? (
        <ExternalLink
          aria-hidden="true"
          size={compact ? 12 : 13}
          strokeWidth={1.8}
        />
      ) : null}
    </>
  );
  if (!attribution.website) {
    return (
      <span
        className={classNames}
        data-compact={compact ? "true" : "false"}
      >
        {content}
      </span>
    );
  }
  return (
    <a
      className={classNames}
      data-compact={compact ? "true" : "false"}
      href={attribution.website}
      rel="noreferrer"
      target="_blank"
      title={`Open ${attribution.name} website`}
    >
      {content}
      <span className={styles.visuallyHidden}>, opens in a new tab</span>
    </a>
  );
}
