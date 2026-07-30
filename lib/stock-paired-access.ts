const STOCK_PAIRED_DEV_ACCOUNTS = new Set([
  "0x2bb333d48dfaf1596d9036671d2e43168994249e",
]);

export type StockPairedPublicLaunchRelease = {
  internalContractRelease: string;
  chainId: number;
};

export const STOCK_PAIRED_NEW_LAUNCHES_ENABLED = true;

export function isStockPairedDevAccount(
  account: string | null | undefined,
) {
  return Boolean(
    STOCK_PAIRED_NEW_LAUNCHES_ENABLED &&
      account &&
      /^0x[a-fA-F0-9]{40}$/.test(account) &&
      STOCK_PAIRED_DEV_ACCOUNTS.has(account.toLowerCase()),
  );
}

export function isStockPairedPublicLaunchEnabled(
  environment: "production" | "rehearsal",
  release: StockPairedPublicLaunchRelease | null,
) {
  return Boolean(
    STOCK_PAIRED_NEW_LAUNCHES_ENABLED &&
      environment === "production" &&
      release?.internalContractRelease === "stock-paired-v3" &&
      release.chainId === 1,
  );
}

export function isStockPairedLocalPreviewEnabled() {
  return (
    STOCK_PAIRED_NEW_LAUNCHES_ENABLED &&
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_STOCK_PAIRED_UI_PREVIEW === "true"
  );
}
