"use client";

import Image from "next/image";
import { useState } from "react";
import { safePublicImageUrl } from "@/lib/safe-public-image-url";
import { getTokenCardImageSource } from "@/lib/token-image";
import styles from "./robinhood-coin-artwork.module.css";

export function RobinhoodCoinArtwork({ imageUrl, name, symbol, className = "" }: {
  imageUrl?: string | null;
  name: string | null;
  symbol: string | null;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const safeSource = safePublicImageUrl(imageUrl);
  const source = safeSource ? getTokenCardImageSource(safeSource) : null;
  const initials = (symbol?.trim() || name?.trim() || "?").replace(/^\$/, "").slice(0, 3);
  return <div className={`${styles.artwork} ${className}`} aria-hidden="true">
    {source && source !== failedSource ? <Image
      src={source} alt="" width={600} height={600} unoptimized
      onError={() => setFailedSource(source)}
    /> : <span>{initials}</span>}
  </div>;
}
