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
  readExploreModel,
} from "../../../../../lib/onchain";
import { creatorFeeHookReadAbi } from "../../../../../lib/onchain/abis";
import {
  ActionLookupError,
  lookupActionTokenByPoolId,
  type ActionTokenLookup,
} from "../../../../../lib/data-pipeline/action-lookup";
import { indexedLaunchLookupEnabled } from "../../../../../lib/data-pipeline/route-activation.server";
import {
  errorChainIncludesData,
  safeServerErrorSummary,
} from "../../../../../lib/server/safe-error";
import { creatorClaimRpcProviders } from "../../../../../lib/server/action-rpc-quorum.server";
import { computeOfficialV4PoolId } from "../../../../../lib/uniswap/liquidity-launcher-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const NO_FEES_TO_CLAIM_SELECTOR = "0x846d8c5c";
const NATIVE_ETH = "0x0000000000000000000000000000000000000000" as Address;

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

function maximum(left: bigint, right: bigint) {
  return left > right ? left : right;
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
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

async function sharedVerifiedBlock(clients: readonly PublicClient[]) {
  if (clients.length !== 2) {
    throw new CreatorClaimUnavailableError(
      "rpc-unavailable",
      "Creator claims require two independent Ethereum RPCs",
    );
  }
  const heads = await Promise.all(clients.map((client) => client.getBlockNumber()));
  const blockNumber = minimum(heads[0]!, heads[1]!);
  const blocks = await Promise.all(
    clients.map((client) => client.getBlock({ blockNumber })),
  );
  if (
    !blocks[0]?.hash ||
    !blocks[1]?.hash ||
    blocks[0].hash.toLowerCase() !== blocks[1].hash.toLowerCase()
  ) {
    throw new CreatorClaimUnavailableError(
      "rpc-disagreement",
      "Independent Ethereum RPCs disagree on the current claim state",
    );
  }
  return { blockNumber, blockHash: blocks[0].hash };
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

function indexedClaimToken(
  token: ActionTokenLookup,
  deployment: Extract<ReturnType<typeof getOnchainDeployment>, { status: "ready" }>,
): CreatorClaimTokenIdentity {
  if (
    token.releaseVersion !== "classic-v2" ||
    token.modelVersion !== "classic" ||
    token.hookAddress.toLowerCase() !== deployment.feeHook.toLowerCase() ||
    canonicalClaimPoolId(token.tokenAddress, token.hookAddress).toLowerCase() !==
      token.poolId.toLowerCase() ||
    token.creatorFeeBps === null
  ) {
    throw new CreatorClaimUnavailableError(
      "noncanonical-hook",
      "The pool does not use the canonical creator fee hook",
    );
  }
  return {
    tokenAddress: token.tokenAddress,
    hookAddress: token.hookAddress,
    poolId: token.poolId,
    creatorAddress: token.creatorAddress,
    totalSwapFeeBps: token.totalSwapFeeBps,
    buySwapFeeBps: token.buySwapFeeBps,
    sellSwapFeeBps: token.sellSwapFeeBps,
    creatorFeeBps: token.creatorFeeBps,
    launcherFeeBps: token.launcherFeeBps,
    transferTaxBps: token.transferTaxBps,
    lpFeePips: token.lpFeePips,
  };
}

async function legacyClaimToken(
  request: ReturnType<typeof parseCreatorClaimRequest>,
  deployment: Extract<ReturnType<typeof getOnchainDeployment>, { status: "ready" }>,
): Promise<CreatorClaimTokenIdentity> {
  const model = await readExploreModel(deployment);
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
    const token = indexedLaunchLookupEnabled()
      ? indexedClaimToken(
          await lookupActionTokenByPoolId({
            chainId: deployment.chainId,
            poolId: claimRequest.poolId,
          }),
          deployment,
        )
      : await legacyClaimToken(claimRequest, deployment);
    if (
      token.creatorAddress.toLowerCase() !== claimRequest.account.toLowerCase()
    ) {
      throw new CreatorClaimUnavailableError(
        "not-creator",
        "This account is not the recorded creator for the pool",
      );
    }

    const clients = creatorClaimRpcProviders(deployment).map((provider) =>
      claimClient(deployment, provider.endpoint),
    );
    const snapshot = await sharedVerifiedBlock(clients);
    const states = await Promise.all(
      clients.map((client) =>
        readCurrentClaimState({
          client,
          deployment,
          token,
          blockNumber: snapshot.blockNumber,
        }),
      ),
    );
    if (states[0]!.claimable !== states[1]!.claimable) {
      throw new CreatorClaimUnavailableError(
        "rpc-disagreement",
        "Independent Ethereum RPCs disagree on the current claim balance",
      );
    }
    const claimable = states[0]!.claimable;
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
    const simulations = await Promise.all(
      clients.map(async (client) => {
        const transaction = {
          account: claimRequest.account,
          to: deployment.feeHook,
          data,
          value,
        };
        await client.call(transaction);
        const [estimatedGas, gasPrice, accountBalance] = await Promise.all([
          client.estimateGas(transaction),
          client.getGasPrice(),
          client.getBalance({ address: claimRequest.account }),
        ]);
        return { estimatedGas, gasPrice, accountBalance };
      }),
    );
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
      estimatedGas: maximum(
        simulations[0]!.estimatedGas,
        simulations[1]!.estimatedGas,
      ),
      gasPriceWei: maximum(
        simulations[0]!.gasPrice,
        simulations[1]!.gasPrice,
      ),
      accountBalanceWei: minimum(
        simulations[0]!.accountBalance,
        simulations[1]!.accountBalance,
      ),
    });
    return json(response);
  } catch (error) {
    if (error instanceof ActionLookupError) {
      return json(
        blockedResponse(
          "blocked",
          error.code === "not-found" ? "unknown-pool" : "registry-unavailable",
          error.code === "not-found"
            ? "This pool is not a verified Programmable launch"
            : "The verified Programmable launch registry is unavailable",
        ),
        409,
      );
    }
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
