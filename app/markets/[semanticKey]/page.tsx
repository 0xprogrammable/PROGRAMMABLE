import type { Metadata } from "next";

import { PredictionMarketDetail } from "@/components/prediction-market-detail";

export const metadata: Metadata = {
  title: "BTC prediction market · Programmable",
  description: "Trade a fully backed BTC prediction market through Uniswap v4 on Robinhood Chain.",
};

export default async function PredictionMarketPage({
  params,
}: {
  params: Promise<{ semanticKey: string }>;
}) {
  const { semanticKey } = await params;
  return <PredictionMarketDetail semanticKey={semanticKey} />;
}
