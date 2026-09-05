"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { useViewChain, type ViewChainId } from "@/components/view-chain";
import { resolveExploreChainId } from "@/lib/explore-chain";
import styles from "@/components/explore-chain-selector.module.css";

type ExploreChainOption = Readonly<{
  id: number;
  label: string;
  mark: "ethereum" | "robinhood";
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
    available: true,
  },
] as const satisfies readonly ExploreChainOption[];

function ExploreChainMark({
  mark,
}: Readonly<{ mark: ExploreChainOption["mark"] }>) {
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

  return <span className={styles.robinhoodMark} aria-hidden="true" />;
}

export function ExploreChainSelector() {
  const { hydrated, viewChainId, setViewChainId } = useViewChain();
  const [open, setOpen] = useState(false);
  const exploreChainOptions = EXPLORE_CHAIN_OPTIONS;
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
  const alternateOptions = exploreChainOptions.filter(
    (option) => option.id !== selected.id,
  );

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
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  function openListbox(index = 0) {
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
    const main = rootRef.current?.closest("main");
    setViewChainId(option.viewChainId);
    closeListbox(false);
    window.requestAnimationFrame(() => {
      const trigger = triggerRef.current ?? main?.querySelector<HTMLButtonElement>(`button[aria-label="Explore chain: ${option.label}"]`);
      trigger?.focus();
    });
  }

  function handleOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index + 1) % alternateOptions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (index - 1 + alternateOptions.length) % alternateOptions.length,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(alternateOptions.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeListbox();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = alternateOptions[index];
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
            openListbox();
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openListbox(alternateOptions.length - 1);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeListbox();
          }
        }}
      >
        <ExploreChainMark mark={selected.mark} />
      </button>

      {open ? (
        <div
          className={styles.menu}
          id={panelId}
          role="listbox"
          aria-label="Explore chains"
        >
          {alternateOptions.map((option, index) => (
            <button
              key={option.id}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              className={styles.option}
              type="button"
              role="option"
              aria-selected={false}
              aria-disabled={!option.available || undefined}
              aria-label={
                option.available
                  ? `Switch Explore to ${option.label}`
                  : `${option.label} coming soon`
              }
              title={
                option.available
                  ? option.label
                  : `${option.label} · Coming soon`
              }
              data-active={activeIndex === index ? "true" : "false"}
              tabIndex={activeIndex === index ? 0 : -1}
              onClick={() => selectChain(option)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
            >
              <ExploreChainMark mark={option.mark} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
