export type StockPairedPublicLaunchRelease = {
  internalContractRelease: string;
  chainId: number;
};

export const STOCK_PAIRED_NEW_LAUNCHES_ENABLED = false;

export function isStockPairedDevAccount(
  account: string | null | undefined,
) {
  void account;
  return STOCK_PAIRED_NEW_LAUNCHES_ENABLED;
}

export function isStockPairedPublicLaunchEnabled(
  environment: "production" | "rehearsal",
  release: StockPairedPublicLaunchRelease | null,
) {
  void environment;
  void release;
  return STOCK_PAIRED_NEW_LAUNCHES_ENABLED;
}

export function isStockPairedLocalPreviewEnabled() {
  return STOCK_PAIRED_NEW_LAUNCHES_ENABLED;
}
