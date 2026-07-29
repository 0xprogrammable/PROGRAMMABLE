export type StockPairedPublicLaunchRelease = {
  internalContractRelease: string;
  chainId: number;
};

export function isStockPairedPublicLaunchEnabled(
  environment: "production" | "rehearsal",
  release: StockPairedPublicLaunchRelease | null,
) {
  return (
    environment === "production" &&
    release?.internalContractRelease === "stock-paired-v2" &&
    release.chainId === 1
  );
}

export function isStockPairedLocalPreviewEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_STOCK_PAIRED_UI_PREVIEW === "true"
  );
}
