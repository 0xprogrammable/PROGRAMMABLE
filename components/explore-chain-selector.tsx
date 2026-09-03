"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  useViewChain,
  type ViewChainId,
} from "@/components/view-chain";
import {
  isRobinhoodExploreAvailableResponse,
  resolveExploreChainId,
} from "@/lib/explore-chain";
import styles from "@/components/explore-chain-selector.module.css";

type ExploreChainOption = Readonly<{
  id: number;
  label: string;
  mark: "ethereum" | "robinhood" | "base";
  viewChainId?: ViewChainId;
  available: boolean;
}>;

const EXPLORE_CHAIN_OPTIONS = [
  {
    id: 1,
    label: "Ethereum",
    mark: "ethereum",
    viewChainId: 1,
    available: true,
  },
  {
    id: 4663,
    label: "Robinhood",
    mark: "robinhood",
    viewChainId: 4663,
    available: false,
  },
  {
    id: 8453,
    label: "Base",
    mark: "base",
    available: false,
  },
] as const satisfies readonly ExploreChainOption[];

function ExploreChainMark({ mark }: Readonly<{ mark: ExploreChainOption["mark"] }>) {
  if (mark === "ethereum") {
    return (
      <svg
        className={styles.ethereumMark}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12 2 5.5 12.2 12 9.25l6.5 2.95L12 2Z" fill="currentColor" />
        <path
          d="m5.5 13.35 6.5 3.7 6.5-3.7L12 22 5.5 13.35Z"
          fill="currentColor"
        />
        <path
          d="m12 9.25-6.5 2.95L12 15.9l6.5-3.7L12 9.25Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <span
      className={mark === "robinhood" ? styles.robinhoodMark : styles.baseMark}
      aria-hidden="true"
    />
  );
}

export function ExploreChainSelector() {
  const { hydrated, viewChainId, setViewChainId } = useViewChain();
  const [open, setOpen] = useState(false);
  const [robinhoodAvailable, setRobinhoodAvailable] = useState(false);
  const exploreChainOptions = EXPLORE_CHAIN_OPTIONS.map((option) =>
    option.id === 4663
      ? { ...option, available: robinhoodAvailable }
      : option
  ) satisfies readonly ExploreChainOption[];
  const selectedViewChainId = resolveExploreChainId(viewChainId);
  const selectedIndex = Math.max(
    0,
    exploreChainOptions.findIndex(
      (option) => option.id === selectedViewChainId,
    ),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = exploreChainOptions[selectedIndex]!;

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    void fetch("/api/explore?chain=4663&limit=1&page=1&q=&sort=newest", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return false;
      return isRobinhoodExploreAvailableResponse(await response.json());
    }).then(setRobinhoodAvailable).catch(() => setRobinhoodAvailable(false));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  function openListbox(index = selectedIndex) {
    setActiveIndex(index);
    setOpen(true);
  }

  function closeListbox(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function selectChain(option: ExploreChainOption) {
    if (!option.available || option.viewChainId === undefined) return;
    setViewChainId(option.viewChainId);
    closeListbox();
  }

  function handleOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index + 1) % exploreChainOptions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (index - 1 + exploreChainOptions.length) %
          exploreChainOptions.length,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(exploreChainOptions.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeListbox();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = exploreChainOptions[index];
      if (option) selectChain(option);
    }
  }

  return (
    <div
      className={styles.selector}
      data-open={open ? "true" : "false"}
      ref={rootRef}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        aria-busy={!hydrated || undefined}
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Explore chain: ${selected.label}`}
        onClick={() => {
          if (open) closeListbox(false);
          else openListbox();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openListbox(selectedIndex);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openListbox(exploreChainOptions.length - 1);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeListbox();
          }
        }}
      >
        <ExploreChainMark mark={selected.mark} />
        <span>{selected.label}</span>
        <ChevronDown className={styles.chevron} aria-hidden="true" size={15} />
      </button>

      {open ? (
        <div
          className={styles.menu}
          id={panelId}
          role="listbox"
          aria-label="Explore chains"
        >
          {exploreChainOptions.map((option, index) => {
            const current = option.id === selectedViewChainId;
            return (
              <button
                key={option.id}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                className={`${styles.option} ${
                  current ? styles.optionCurrent : ""
                }`}
                type="button"
                role="option"
                aria-selected={current}
                aria-disabled={!option.available || undefined}
                data-active={activeIndex === index ? "true" : "false"}
                tabIndex={activeIndex === index ? 0 : -1}
                onClick={() => selectChain(option)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <ExploreChainMark mark={option.mark} />
                <span className={styles.optionCopy}>
                  <span>{option.label}</span>
                  {!option.available ? (
                    <span className={styles.optionStatus}>Coming soon</span>
                  ) : null}
                </span>
                {current ? (
                  <Check className={styles.check} aria-hidden="true" size={16} />
                ) : (
                  <span className={styles.checkPlaceholder} aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
