import { ExploreIndexResetView } from "@/components/explore-index-reset-view";
import styles from "@/components/landing-page.module.css";

export function LandingExploreGate() {
  return (
    <div className={styles.exploreGate}>
      <ExploreIndexResetView embedded />
    </div>
  );
}
