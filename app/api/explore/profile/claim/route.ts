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
  getCreatorClaimOnchainDeployments,
  getWebsiteReadOnchainDeployment,
  parseCreatorClaimRequest,
} from "../../../../../lib/onchain";
import { creatorFeeHookReadAbi } from "../../../../../lib/onchain/abis";
import {
  ActionRpcIdentityError,
  readCreatorClaimIdentityFromRpc,
  type CreatorClaimTokenIdentity,
} from "../../../../../lib/server/action-rpc-identity.server";
import {
  OperationalRpcUnavailableError,
  withOperationalRpcFailover,
} from "../../../../../lib/onchain/operational-rpc-failover.server";
import {
  errorChainIncludesData,
  safeServerErrorSummary,
} from "../../../../../lib/server/safe-error";
import {
  readFinalizedRouterCustomExploreEntriesV1,
} from "../../../../../lib/alchemy/router-custom-public.server";
import {
  encodeRouterCustomCreatorClaimV1,
  readRouterCustomCreatorClaimStateV1,
  requireRouterCustomCreatorClaimEntryV1,
  RouterCustomCreatorClaimError,
} from "../../../../../lib/profile/router-custom-creator-claim.server";
import {
  routerCustomCreatorClaimCapabilityForPoolV1,
} from "../../../../../lib/profile/router-custom-creator-claim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const NO_FEES_TO_CLAIM_SELECTOR = "0x846d8c5c";
const CLAIM_RPC_UNAVAILABLE_MESSAGE =
  "Creator claim reads are temporarily unavailable. Try again";

function claimClient(
  deployment: ReturnType<typeof getWebsiteReadOnchainDeployment>,
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
  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  if (!block.hash) {
    throw new CreatorClaimUnavailableError(
      "runtime-mismatch",
      "The creator claim snapshot has no block hash",
    );
  }
  return { blockNumber, blockHash: block.hash as Hex };
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
  token: CreatorClaimTokenIdentity;
  blockNumber: bigint;
}) {
  const { client, token, blockNumber } = input;
  const [hookCode, launcherCode, config, disclosure] = await Promise.all([
    client.getCode({ address: token.hookAddress, blockNumber }),
    client.getCode({ address: token.launcherAddress, blockNumber }),
    client.readContract({
      address: token.hookAddress,
      abi: creatorFeeHookReadAbi,
      functionName: "poolFeeConfig",
      args: [token.poolId],
      blockNumber,
    }),
    token.releaseVersion === "classic-v2"
      ? client.readContract({
        address: token.hookAddress,
        abi: creatorFeeHookReadAbi,
        functionName: "feeDisclosure",
        args: [token.poolId],
        blockNumber,
      })
      : Promise.resolve(null),
  ]);
  if (
    !hookCode ||
    hookCode === "0x" ||
    keccak256(hookCode).toLowerCase() !==
      token.hookRuntimeCodeHash.toLowerCase() ||
    !launcherCode ||
    launcherCode === "0x" ||
    keccak256(launcherCode).toLowerCase() !==
      token.launcherRuntimeCodeHash.toLowerCase()
  ) {
    throw new CreatorClaimUnavailableError(
      "runtime-mismatch",
      "The creator claim release does not match its verified runtime",
    );
  }
  const [creator, registrar, totalSwapFeeBps, registered, claimable] = config;
  if (
    !registered ||
    getAddress(creator).toLowerCase() !== token.creatorAddress.toLowerCase() ||
    getAddress(registrar).toLowerCase() !==
      token.launcherAddress.toLowerCase() ||
    Number(totalSwapFeeBps) !== token.totalSwapFeeBps ||
    disclosure?.some(
      (value) => !Number.isSafeInteger(Number(value)) || Number(value) < 0,
    )
  ) {
    throw new CreatorClaimUnavailableError(
      "identity-mismatch",
      "The current creator fee state does not match the requested launch",
    );
  }
  return { claimable };
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
    let deployment: ReturnType<typeof getWebsiteReadOnchainDeployment>;
    try {
      deployment = getWebsiteReadOnchainDeployment();
    } catch {
      throw claimRpcUnavailable();
    }
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
    const reviewedCustomCapability =
      routerCustomCreatorClaimCapabilityForPoolV1(
        claimRequest.chainId,
        claimRequest.poolId,
      );
    let reviewedCustomEntry: ReturnType<
      typeof requireRouterCustomCreatorClaimEntryV1
    > | null = null;
    if (reviewedCustomCapability) {
      try {
        const entries = await readFinalizedRouterCustomExploreEntriesV1({
          signal: request.signal,
          deadlineMs: Date.now() + 7_500,
        });
        reviewedCustomEntry = requireRouterCustomCreatorClaimEntryV1({
          entries,
          chainId: claimRequest.chainId,
          poolId: claimRequest.poolId,
        });
      } catch (error) {
        if (error instanceof RouterCustomCreatorClaimError) {
          throw new CreatorClaimUnavailableError(error.code, error.message);
        }
        throw claimRpcUnavailable();
      }
    }
    let releases: ReturnType<typeof getCreatorClaimOnchainDeployments> = [];
    if (!reviewedCustomEntry) {
      try {
        releases = getCreatorClaimOnchainDeployments(deployment);
      } catch {
        throw new CreatorClaimUnavailableError(
          "runtime-mismatch",
          "The creator claim releases do not match their manifests",
        );
      }
    }
    const response = await withOperationalRpcFailover(
      deployment,
      async (selected) => {
        const client = claimClient(deployment, selected.rpcUrl);
        const snapshot = await currentClaimSnapshot(client);
        let tokenAddress: Address;
        let hookAddress: Address;
        let creatorAddress: Address;
        let claimable: bigint;
        let data: Hex;
        if (reviewedCustomEntry) {
          try {
            const state = await readRouterCustomCreatorClaimStateV1({
              client,
              entry: reviewedCustomEntry.entry,
              blockNumber: snapshot.blockNumber,
            });
            tokenAddress = state.capability.tokenAddress;
            hookAddress = state.capability.hookAddress;
            creatorAddress = state.capability.creatorAddress;
            claimable = state.claimable;
            data = encodeRouterCustomCreatorClaimV1(state.capability);
          } catch (error) {
            if (error instanceof RouterCustomCreatorClaimError) {
              throw new CreatorClaimUnavailableError(error.code, error.message);
            }
            throw error;
          }
        } else {
          const token = await readCreatorClaimIdentityFromRpc({
            client,
            releases,
            poolId: claimRequest.poolId,
            blockNumber: snapshot.blockNumber,
          });
          const state = await readCurrentClaimState({
            client,
            token,
            blockNumber: snapshot.blockNumber,
          });
          tokenAddress = token.tokenAddress;
          hookAddress = token.hookAddress;
          creatorAddress = token.creatorAddress;
          claimable = state.claimable;
          data = encodeFunctionData({
            abi: creatorFeeHookReadAbi,
            functionName: "claimCreatorFees",
            args: [claimRequest.poolId],
          });
        }
        if (creatorAddress.toLowerCase() !== claimRequest.account.toLowerCase()) {
          throw new CreatorClaimUnavailableError(
            "not-creator",
            "This account is not the recorded creator for the pool",
          );
        }
        if (claimable <= 0n) {
          throw new CreatorClaimUnavailableError(
            "nothing-to-claim",
            "There are no creator fees to claim for this pool",
          );
        }
        const value = 0n;
        const transaction = {
          account: claimRequest.account,
          to: hookAddress,
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
          tokenAddress,
          hookAddress,
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
            to: hookAddress,
            data,
            value: "0" as const,
          },
        };
        return buildPreparedCreatorClaim(intent, {
          estimatedGas: simulation.estimatedGas,
          gasPriceWei: simulation.gasPrice,
          accountBalanceWei: simulation.accountBalance,
        });
      },
    );
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
      error instanceof ActionRpcIdentityError ||
      error instanceof OperationalRpcUnavailableError
    ) {
      const unavailable =
        error instanceof OperationalRpcUnavailableError
          ? claimRpcUnavailable()
          : error instanceof ActionRpcIdentityError
            ? new CreatorClaimUnavailableError(error.code, error.message)
            : error;
      const retryable = unavailable.code === "rpc-unavailable";
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
