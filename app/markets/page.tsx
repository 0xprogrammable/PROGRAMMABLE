import type { Metadata } from "next";

import { PredictionMarketDirectoryView } from "@/components/prediction-market-directory";

export const metadata: Metadata = {
  title: "Prediction markets · Programmable",
  description: "Trade fully backed BTC prediction markets through Uniswap v4 on Robinhood Chain.",
  alternates: { canonical: "/markets" },
};

export default function PredictionMarketsPage() {
  return <PredictionMarketDirectoryView />;
}
