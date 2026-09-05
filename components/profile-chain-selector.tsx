"use client";

import { useId } from "react";
import { VIEW_CHAIN_OPTIONS, type ViewChainId } from "@/lib/view-chain";
import styles from "./profile-chain-selector.module.css";

export function ProfileChainSelector({ value, onChange }: {
  value: ViewChainId;
  onChange?: (chain: ViewChainId) => void;
}) {
  const name = useId();
  return <fieldset className={styles.selector} disabled={!onChange}>
    <legend className="sr-only">Profile chain</legend>
    {VIEW_CHAIN_OPTIONS.map((chain) => <label key={chain.id} className={styles.option} title={chain.label}>
      <input className="sr-only" type="radio" name={name} value={chain.id}
        aria-label={chain.label} checked={value === chain.id}
        onChange={() => onChange?.(chain.id)} />
      {chain.id === 1 ? <svg className={styles.mark} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M12 2 5.5 12.2 12 9.25l6.5 2.95L12 2Z" fill="currentColor" />
        <path d="m5.5 13.35 6.5 3.7 6.5-3.7L12 22 5.5 13.35Z" fill="currentColor" />
        <path d="m12 9.25-6.5 2.95L12 15.9l6.5-3.7L12 9.25Z" fill="currentColor" />
      </svg> : <span className={styles.robinhood} aria-hidden="true" />}
    </label>)}
  </fieldset>;
}
