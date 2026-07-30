export type StockPairedPublicLaunchRelease = {
  internalContractRelease: string;
  chainId: number;
};

export const STOCK_PAIRED_NEW_LAUNCHES_ENABLED = false;

export function isStockPairedPublicLaunchEnabled(
  environment: "production" | "rehearsal",
  release: StockPairedPublicLaunchRelease | null,
) {
  void environment;
  void release;
  // Public launches remain closed until a separate activation change is made
  // after the V3 deployment, runtime, source and lifecycle gates all pass.
  return false;
}

export function isStockPairedLocalPreviewEnabled() {
  return (
    STOCK_PAIRED_NEW_LAUNCHES_ENABLED &&
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_STOCK_PAIRED_UI_PREVIEW === "true"
  );
}
