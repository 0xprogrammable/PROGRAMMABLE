import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import {
  CreatorClaimInputError,
  CreatorClaimUnavailableError,
  buildPreparedCreatorClaim,
  getOnchainDeployment,
  parseCreatorClaimRequest,
} from "../../../../../lib/onchain";
import { creatorFeeHookReadAbi } from "../../../../../lib/onchain/abis";
import { readBitqueryExploreModelV1 } from
  "../../../../../lib/market-data/bitquery-explore-model.server";
import {
  ActionRpcProviderError,
  creatorClaimRpcProvider,
} from "../../../../../lib/server/action-rpc-quorum.server";
import {
  errorChainIncludesData,
  safeServerErrorSummary,
} from "../../../../../lib/server/safe-error";
import { computeOfficialV4PoolId } from "../../../../../lib/uniswap/liquidity-launcher-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const NO_FEES_TO_CLAIM_SELECTOR = "0x846d8c5c";
const NATIVE_ETH = "0x0000000000000000000000000000000000000000" as Address;
const CLAIM_RPC_UNAVAILABLE_MESSAGE =
  "Creator claim reads are temporarily unavailable. Try again";

type CreatorClaimTokenIdentity = Readonly<{
  tokenAddress: Address;
  hookAddress: Address;
  poolId: Hex;
  creatorAddress: Address;
  totalSwapFeeBps: number;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  creatorFeeBps: number;
  launcherFeeBps: number;
  transferTaxBps: number;
  lpFeePips: number;
}>;

function canonicalClaimPoolId(
  tokenAddress: Address,
  hookAddress: Address,
) {
  return computeOfficialV4PoolId({
    currency0: NATIVE_ETH,
    currency1: tokenAddress,
    fee: 0,
    tickSpacing: 200,
    hooks: hookAddress,
  });
}

function claimClient(
  deployment: ReturnType<typeof getOnchainDeployment>,
  endpoint: string,
) {
  return createPublicClient({
    chain: deployment.chainId === 1 ? mainnet : sepolia,
    transport: http(endpoint, { retryCount: 1, timeout: 12_000 }),
  });
}

function claimRpcUnavailable() {
  return new CreatorClaimUnavailableError(
    "rpc-unavailable",
    CLAIM_RPC_UNAVAILABLE_MESSAGE,
  );
}

async function currentClaimSnapshot(client: PublicClient) {
  try {
    const blockNumber = await client.getBlockNumber();
    const block = await client.getBlock({ blockNumber });
    if (!block.hash) throw claimRpcUnavailable();
    return { blockNumber, blockHash: block.hash as Hex };
  } catch (error) {
    if (error instanceof CreatorClaimUnavailableError) throw error;
    throw claimRpcUnavailable();
  }
}

async function simulateCreatorClaim(input: {
  client: PublicClient;
  transaction: {
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
  };
  blockNumber: bigint;
}) {
  await input.client.call({
    ...input.transaction,
    blockNumber: input.blockNumber,
  });
  const [estimatedGas, gasPrice, accountBalance] = await Promise.all([
    input.client.estimateGas({
      ...input.transaction,
      blockNumber: input.blockNumber,
    }),
    input.client.getGasPrice(),
    input.client.getBalance({
      address: input.transaction.account,
      blockNumber: input.blockNumber,
    }),
  ]);
  return { estimatedGas, gasPrice, accountBalance };
}

async function readCurrentClaimState(input: {
  client: PublicClient;
  deployment: Extract<ReturnType<typeof getOnchainDeployment>, { status: "ready" }>;
  token: CreatorClaimTokenIdentity;
  blockNumber: bigint;
}) {
  const { client, deployment, token, blockNumber } = input;
  const [hookCode, launcherCode, config, disclosure] = await Promise.all([
    client.getCode({ address: deployment.feeHook, blockNumber }),
    client.getCode({ address: deployment.launcher, blockNumber }),
    client.readContract({
      address: deployment.feeHook,
      abi: creatorFeeHookReadAbi,
      functionName: "poolFeeConfig",
      args: [token.poolId],
      blockNumber,
    }),
    client.readContract({
      address: deployment.feeHook,
      abi: creatorFeeHookReadAbi,
      functionName: "feeDisclosure",
      args: [token.poolId],
      blockNumber,
    }),
  ]);
  if (
    !hookCode ||
    hookCode === "0x" ||
    keccak256(hookCode).toLowerCase() !==
      deployment.feeHookRuntimeCodeHash.toLowerCase() ||
    !launcherCode ||
    launcherCode === "0x" ||
    keccak256(launcherCode).toLowerCase() !==
      deployment.launcherRuntimeCodeHash.toLowerCase()
  ) {
    throw new CreatorClaimUnavailableError(
      "runtime-mismatch",
      "The creator claim release does not match its verified runtime",
    );
  }
  const [creator, registrar, totalSwapFeeBps, registered, claimable] = config;
  const [buyFee, sellFee, creatorFee, launcherFee, transferTax, lpFee] =
    disclosure;
  if (
    !registered ||
    getAddress(creator).toLowerCase() !== token.creatorAddress.toLowerCase() ||
    getAddress(registrar).toLowerCase() !== deployment.launcher.toLowerCase() ||
    Number(totalSwapFeeBps) !== token.totalSwapFeeBps ||
    Number(buyFee) !== token.buySwapFeeBps ||
    Number(sellFee) !== token.sellSwapFeeBps ||
    Number(creatorFee) !== token.creatorFeeBps ||
    Number(launcherFee) !== token.launcherFeeBps ||
    Number(transferTax) !== token.transferTaxBps ||
    Number(lpFee) !== token.lpFeePips
  ) {
    throw new CreatorClaimUnavailableError(
      "identity-mismatch",
      "The current creator fee state does not match the indexed launch",
    );
  }
  return { claimable };
}

async function bitqueryClaimToken(
  request: ReturnType<typeof parseCreatorClaimRequest>,
  deployment: Extract<ReturnType<typeof getOnchainDeployment>, { status: "ready" }>,
  signal?: AbortSignal,
): Promise<CreatorClaimTokenIdentity> {
  let model: Awaited<ReturnType<typeof readBitqueryExploreModelV1>>;
  try {
    if (deployment.chainId !== 1) throw new Error("unsupported chain");
    model = await readBitqueryExploreModelV1({ signal });
  } catch {
    throw new CreatorClaimUnavailableError(
      "registry-unavailable",
      "The verified Programmable launch registry is temporarily unavailable",
    );
  }
  if (model.status !== "ready" || model.snapshot.chainId !== deployment.chainId) {
    throw new CreatorClaimUnavailableError(
      "registry-unavailable",
      "The verified Programmable launch registry is unavailable",
    );
  }
  const token = model.tokens.find(
    (candidate) =>
      candidate.poolId.toLowerCase() === request.poolId.toLowerCase(),
  );
  if (!token) {
    throw new CreatorClaimUnavailableError(
      "unknown-pool",
      "This pool is not a verified Programmable launch",
    );
  }
  const feeValues = [
    token.buyHookFeeBps,
    token.sellHookFeeBps,
    token.creatorFeeBps,
    token.launcherFeeBps,
    token.transferTaxBps,
    token.lpFeePips,
  ];
  if (
    token.launchModel !== "classic" ||
    token.launchStampProvenance !== undefined ||
    token.hookAddress.toLowerCase() !== deployment.feeHook.toLowerCase() ||
    !token.creatorAddress ||
    typeof token.totalSwapFeeBps !== "number" ||
    !Number.isSafeInteger(token.totalSwapFeeBps) ||
    token.totalSwapFeeBps < 0 ||
    canonicalClaimPoolId(
      getAddress(token.tokenAddress),
      getAddress(token.hookAddress),
    ).toLowerCase() !== request.poolId.toLowerCase() ||
    feeValues.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0,
    )
  ) {
    throw new CreatorClaimUnavailableError(
      "noncanonical-hook",
      "The pool does not use the canonical creator fee hook",
    );
  }
  return {
    tokenAddress: getAddress(token.tokenAddress),
    hookAddress: getAddress(token.hookAddress),
    poolId: request.poolId,
    creatorAddress: getAddress(token.creatorAddress),
    totalSwapFeeBps: token.totalSwapFeeBps,
    buySwapFeeBps: token.buyHookFeeBps!,
    sellSwapFeeBps: token.sellHookFeeBps!,
    creatorFeeBps: token.creatorFeeBps!,
    launcherFeeBps: token.launcherFeeBps!,
    transferTaxBps: token.transferTaxBps!,
    lpFeePips: token.lpFeePips!,
  };
}

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
    if (deployment.status !== "ready") {
      throw new CreatorClaimUnavailableError(
        "not-deployed",
        "Creator claims are unavailable until the production contracts are deployed",
      );
    }
    if (claimRequest.chainId !== deployment.chainId) {
      throw new CreatorClaimUnavailableError(
        "wrong-chain",
        `Switch to chain ${deployment.chainId}`,
      );
    }
    const token = await bitqueryClaimToken(
      claimRequest,
      deployment,
      request.signal,
    );
    if (
      token.creatorAddress.toLowerCase() !== claimRequest.account.toLowerCase()
    ) {
      throw new CreatorClaimUnavailableError(
        "not-creator",
        "This account is not the recorded creator for the pool",
      );
    }

    const provider = creatorClaimRpcProvider(deployment);
    const client = claimClient(deployment, provider.endpoint);
    const snapshot = await currentClaimSnapshot(client);
    const state = await readCurrentClaimState({
      client,
      deployment,
      token,
      blockNumber: snapshot.blockNumber,
    });
    const claimable = state.claimable;
    if (claimable <= 0n) {
      throw new CreatorClaimUnavailableError(
        "nothing-to-claim",
        "There are no creator fees to claim for this pool",
      );
    }
    const data = encodeFunctionData({
      abi: creatorFeeHookReadAbi,
      functionName: "claimCreatorFees",
      args: [claimRequest.poolId],
    });
    const value = 0n;
    const transaction = {
      account: claimRequest.account,
      to: deployment.feeHook,
      data,
      value,
    };
    const simulation = await simulateCreatorClaim({
      client,
      transaction,
      blockNumber: snapshot.blockNumber,
    });
    const intent = {
      account: claimRequest.account,
      poolId: claimRequest.poolId,
      tokenAddress: token.tokenAddress,
      hookAddress: deployment.feeHook,
      snapshotClaimableWei: claimable.toString(),
      snapshotClaimableEth: formatUnits(claimable, 18),
      snapshot: {
        chainId: deployment.chainId,
        blockNumber: snapshot.blockNumber.toString(),
        blockHash: snapshot.blockHash,
        confirmations: 0,
      },
      transaction: {
        kind: "claim-creator-fees" as const,
        chainId: deployment.chainId,
        from: claimRequest.account,
        to: deployment.feeHook,
        data,
        value: "0" as const,
      },
    };
    const response = buildPreparedCreatorClaim(intent, {
      estimatedGas: simulation.estimatedGas,
      gasPriceWei: simulation.gasPrice,
      accountBalanceWei: simulation.accountBalance,
    });
    return json(response);
  } catch (error) {
    if (error instanceof CreatorClaimInputError) {
      return json(
        blockedResponse("blocked", error.code, error.message),
        400,
      );
    }
    if (
      error instanceof CreatorClaimUnavailableError ||
      error instanceof ActionRpcProviderError
    ) {
      const unavailable =
        error instanceof ActionRpcProviderError
          ? claimRpcUnavailable()
          : error;
      const retryable =
        unavailable.code === "rpc-unavailable" ||
        unavailable.code === "registry-unavailable";
      return json(
        blockedResponse(
          unavailable.code === "not-deployed" ? "not-deployed" : "blocked",
          unavailable.code,
          unavailable.message,
        ),
        retryable ? 503 : 409,
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
        "The configured RPC could not prepare the creator claim from the current onchain state",
      ),
      502,
    );
  }
}
