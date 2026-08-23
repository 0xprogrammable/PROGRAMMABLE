import Link from "next/link";

import styles from "@/components/explore-mode-switch.module.css";

type ExploreMode = "token" | "prediction";

const exploreModes = [
  { id: "token", href: "/explore", label: "Token" },
  { id: "prediction", href: "/markets", label: "Prediction" },
] as const;

export function ExploreModeSwitch({ active }: { active: ExploreMode }) {
  return (
    <nav className={styles.modeSwitch} aria-label="Explore categories">
      {exploreModes.map((mode) => {
        const current = mode.id === active;

        return (
          <Link
            key={mode.id}
            className={`${styles.modeLink} ${
              current ? styles.modeLinkActive : ""
            }`}
            href={mode.href}
            prefetch={false}
            aria-current={current ? "page" : undefined}
          >
            {mode.label}
          </Link>
        );
      })}
    </nav>
  );
}
