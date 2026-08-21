import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import styles from "./token-experience.module.css";

export function TokenDetailShell() {
  return (
    <div className={`${styles.page} page-width`}>
      <Link className={styles.back} href="/explore">
        <ArrowLeft aria-hidden="true" size={16} />
        Explore
      </Link>
      <div className={styles.loadingState} role="status" aria-live="polite">
        Loading
      </div>
    </div>
  );
}
