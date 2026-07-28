import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { mainnet, sepolia } from "viem/chains";

import {
  CreatorClaimInputError,
  CreatorClaimUnavailableError,
  buildPreparedCreatorClaim,
  getOnchainDeployment,
  parseCreatorClaimRequest,
  readExploreModel,
  resolveCreatorClaimIntent,
} from "../../../../../lib/onchain";
import {
  errorChainIncludesData,
  safeServerErrorSummary,
} from "../../../../../lib/server/safe-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const NO_FEES_TO_CLAIM_SELECTOR = "0x846d8c5c";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function blockedResponse(
  status: "not-deployed" | "blocked",
  code: string,
  message: string,
) {
  return {
    status,
    error: { code, message },
    claim: null,
    snapshot: null,
    transaction: null,
    gas: null,
    submission: {
      status: "not-submitted" as const,
      transactionHash: null,
      receipt: null,
    },
  };
}

export async function POST(request: NextRequest) {
  const contentLength = Number(
    request.headers.get("content-length") ?? "0",
  );
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    return json(
      blockedResponse(
        "blocked",
        "request-too-large",
        "The claim request is too large",
      ),
      413,
    );
  }

  let input: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) {
      return json(
        blockedResponse(
          "blocked",
          "request-too-large",
          "The claim request is too large",
        ),
        413,
      );
    }
    input = JSON.parse(text);
  } catch {
    return json(
      blockedResponse(
        "blocked",
        "invalid-json",
        "Send a valid JSON claim request",
      ),
      400,
    );
  }

  try {
    const claimRequest = parseCreatorClaimRequest(input);
    const deployment = getOnchainDeployment();
    const model = await readExploreModel(deployment);
    const intent = resolveCreatorClaimIntent(
      claimRequest,
      deployment,
      model,
    );
    const chain = deployment.chainId === 1 ? mainnet : sepolia;
    const client = createPublicClient({
      chain,
      transport: http(deployment.rpcUrl, {
        retryCount: 1,
        timeout: 12_000,
      }),
    });
    const value = 0n;

    await client.call({
      account: intent.account,
      to: intent.transaction.to,
      data: intent.transaction.data,
      value,
    });
    const [estimatedGas, gasPrice, accountBalance] =
      await Promise.all([
        client.estimateGas({
          account: intent.account,
          to: intent.transaction.to,
          data: intent.transaction.data,
          value,
        }),
        client.getGasPrice(),
        client.getBalance({ address: intent.account }),
      ]);
    const response = buildPreparedCreatorClaim(intent, {
      estimatedGas,
      gasPriceWei: gasPrice,
      accountBalanceWei: accountBalance,
    });
    return json(response);
  } catch (error) {
    if (error instanceof CreatorClaimInputError) {
      return json(
        blockedResponse("blocked", error.code, error.message),
        400,
      );
    }
    if (error instanceof CreatorClaimUnavailableError) {
      return json(
        blockedResponse(
          error.code === "not-deployed" ? "not-deployed" : "blocked",
          error.code,
          error.message,
        ),
        409,
      );
    }
    if (
      errorChainIncludesData(error, NO_FEES_TO_CLAIM_SELECTOR)
    ) {
      return json(
        blockedResponse(
          "blocked",
          "nothing-to-claim",
          "There are no creator fees to claim for this pool",
        ),
        409,
      );
    }
    console.error(
      "Creator claim preparation failed",
      safeServerErrorSummary(error),
    );
    return json(
      blockedResponse(
        "blocked",
        "simulation-failed",
        "The creator claim could not be simulated from the current onchain state",
      ),
      502,
    );
  }
}
