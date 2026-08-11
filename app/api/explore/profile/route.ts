import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../../lib/alchemy/explore.server";
import {
  AlchemyCreatorProfileIntegrityError,
  readAlchemyCreatorProfile,
} from "../../../../lib/alchemy/profile.server";
import { creatorProfileApiError } from "../../../../lib/profile/onchain-profile";
import { getWebsiteChartOnchainDeployment } from "../../../../lib/onchain/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => key !== "account") ||
    search.getAll("account").length !== 1
  ) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const input = search.get("account")?.trim();
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum account address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const account = getAddress(input);
    const deployment = getWebsiteChartOnchainDeployment("production");
    const model = await readAlchemyExploreModel();
    const profile =
      deployment.status === "ready"
        ? await readAlchemyCreatorProfile({ account, deployment, model })
        : {
            status: "not-deployed" as const,
            account,
            tokens: [],
            pools: [],
            claims: [],
            totals: {
              claimableWei: "0",
              claimableEth: "0",
              generatedWei: "0",
              generatedEth: "0",
              claimedWei: "0",
              claimedEth: "0",
            },
            snapshot: null,
          };
    return NextResponse.json(profile, {
      headers: {
        "Cache-Control": "private, max-age=0, s-maxage=15",
        "X-Programmable-Launch-Source":
          "indexed-read-model+operational-rpc",
        "X-Programmable-Read-Source": "rpc",
        "X-Programmable-Rpc-Provider": "operational-dual",
      },
    });
  } catch (error) {
    console.error(
      "Alchemy creator profile read failed",
      safeAlchemyError(error),
    );
    const integrity = error instanceof AlchemyCreatorProfileIntegrityError;
    return NextResponse.json(
      creatorProfileApiError(integrity ? "integrity" : "temporary"),
      {
        status: integrity ? 409 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
