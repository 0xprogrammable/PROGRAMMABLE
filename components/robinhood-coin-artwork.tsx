"use client";

import Image from "next/image";
import { useState } from "react";
import { safePublicImageUrl } from "@/lib/safe-public-image-url";
import { getTokenCardImageSource } from "@/lib/token-image";
import styles from "./robinhood-coin-artwork.module.css";

export function RobinhoodCoinArtwork({ imageUrl, loading = false, className = "" }: {
  imageUrl?: string | null;
  loading?: boolean;
  className?: string;
}) {
  const safeSource = safePublicImageUrl(imageUrl);
  const source = safeSource ? getTokenCardImageSource(safeSource) : null;
  return <ArtworkImage key={source} source={source} loading={loading} className={className} />;
}

function ArtworkImage({ source, loading, className }: {
  source: string | null;
  loading: boolean;
  className: string;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const pending = source ? status === "loading" : loading;

  return <div className={`${styles.artwork} ${className}`} data-loading={pending} aria-hidden="true">
    {source && status !== "failed" ? <Image
      src={source} alt="" width={600} height={600} unoptimized
      className={status === "ready" ? styles.loaded : undefined}
      onLoad={() => setStatus("ready")}
      onError={() => setStatus("failed")}
    /> : null}
  </div>;
}
