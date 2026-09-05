"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  activeExploreFilterCount, DEFAULT_EXPLORE_FILTERS, LAUNCH_SORT_OPTIONS,
  type RobinhoodExploreFilters,
} from "@/lib/robinhood-explore-filters";
import styles from "./explore-filters.module.css";

export function ExploreFilters({ value = DEFAULT_EXPLORE_FILTERS, onApply, disabled = false }: {
  value?: RobinhoodExploreFilters;
  onApply?: (filters: RobinhoodExploreFilters) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const panelId = useId();
  const count = activeExploreFilterCount(value);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return <div className={styles.root} ref={rootRef}
    onKeyDown={(event) => {
      if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    }}
    onBlurCapture={(event) => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
    }}
  >
    <button className={styles.trigger} ref={triggerRef} type="button" disabled={disabled}
      aria-label={count ? `Filters, ${count} active` : "Filters"}
      aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog"
      title={disabled ? "Filters are unavailable while Ethereum indexing is rebuilt" : undefined}
      data-active={count > 0}
      onClick={() => { if (open) close(); else { setDraft(value); setOpen(true); } }}
    >
      <SlidersHorizontal size={16} aria-hidden="true" />
      <span className={styles.label}>Filters</span>
      {count > 0 ? <span className={styles.count} aria-hidden="true">{count}</span> : null}
    </button>
    {open ? <form className={styles.panel} id={panelId} role="dialog" aria-label="Launch filters"
      onSubmit={(event) => { event.preventDefault(); onApply?.(draft); close(true); }}
    >
      <div className={styles.heading}>
        <h2>Filters</h2>
        <button className={styles.close} type="button" aria-label="Close filters" onClick={() => close(true)}><X size={18} aria-hidden="true" /></button>
      </div>
      <label className={styles.field}>
        <span>Sort by</span>
        <select ref={firstFieldRef} name="sort" value={draft.sort}
          onChange={(event) => setDraft((current) => ({ ...current, sort: event.target.value as RobinhoodExploreFilters["sort"] }))}>
          {LAUNCH_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={() => { onApply?.(DEFAULT_EXPLORE_FILTERS); close(true); }}>Reset</button>
        <button className={styles.apply} type="submit">Apply</button>
      </div>
    </form> : null}
  </div>;
}
