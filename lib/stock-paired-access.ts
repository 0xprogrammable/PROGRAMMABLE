const STOCK_PAIRED_DEV_ACCOUNTS = new Set([
  "0x2bb333d48dfaf1596d9036671d2e43168994249e",
]);

export function isStockPairedDevAccount(
  account: string | null | undefined,
) {
  return Boolean(
    account &&
      /^0x[a-fA-F0-9]{40}$/.test(account) &&
      STOCK_PAIRED_DEV_ACCOUNTS.has(account.toLowerCase()),
  );
}

export function isStockPairedLocalPreviewEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_STOCK_PAIRED_UI_PREVIEW === "true"
  );
}
