import { NextResponse } from "next/server";

import { bitqueryMarketDataConfigured } from "../../../../lib/market-data/bitquery.server";
import { getProductionGmgnAccountGateStatusV1 } from
  "../../../../lib/market-data/gmgn-account-gate.server";
import { gmgnMarketDataConfiguredV1 } from
  "../../../../lib/market-data/gmgn.server";
import { gmgnEffectiveRequestsPerSecondV1 } from
  "../../../../lib/market-data/gmgn-runtime-config.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gmgnConfigured = gmgnMarketDataConfiguredV1();
  const gmgnRequestsPerSecond = gmgnEffectiveRequestsPerSecondV1();
  const gmgnAccountGate = await getProductionGmgnAccountGateStatusV1();
  const bitqueryConfigured = bitqueryMarketDataConfigured();
  const providers = [
    {
      name: "gmgn",
      role: "primary-token-market",
      configured: gmgnConfigured,
      requestsPerSecond: gmgnRequestsPerSecond,
      accountGateMode: gmgnAccountGate.mode,
    },
    {
      name: "bitquery",
      role: "exact-pool-chart-fallback",
      configured: bitqueryConfigured,
    },
    {
      name: "dexscreener",
      role: "batch-fail-soft-fallback",
      configured: true,
    },
  ] as const;
  const gmgnAccountGateReady = gmgnAccountGate.mode === "multiflight-v1" ||
    (gmgnAccountGate.mode === "legacy-singleflight-v1" &&
      gmgnRequestsPerSecond < 20);
  const providerStackReady = gmgnConfigured && bitqueryConfigured &&
    gmgnAccountGateReady;

  return NextResponse.json(
    {
      status: providerStackReady ? "ready" : "degraded",
      provider: {
        name: providers[0].name,
        configured: providers[0].configured,
      },
      providers,
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": providerStackReady
          ? "public, max-age=0, s-maxage=30"
          : "no-store",
      },
    },
  );
}
