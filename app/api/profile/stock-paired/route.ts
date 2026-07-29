import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import {
  getOnchainDeployment,
  readExploreModel,
} from "@/lib/onchain";
import { safeServerErrorSummary } from "@/lib/server/safe-error";
import {
  StockPairedClaimReceiptError,
  verifyStockPairedClaimReceipt,
} from "@/lib/server/stock-paired-claim-receipt";
import {
  getStockPairedQuoteAssetForRelease,
  stockFeeSplitVaultAbi,
  stockFeeSplitVaultFactoryAbi,
  stockPairedHookAbi,
} from "@/lib/stock-paired";
import {
  getConfiguredStockPairedReleaseByHook,
  getConfiguredStockPairedReleases,
} from "@/lib/stock-paired-release";
import type { LauncherToken } from "@/lib/tokens";
import { ClassicTradeInputError } from "@/lib/trade/classic";
import {
  prepareStockPairedRewardConversion,
  quoteStockPairedQuoteAssetToEth,
  resolveStockPairedTradeDeployment,
  StockPairedTradeUnavailableError,
  type StockPairedTradeRuntimeClient,
} from "@/lib/trade/stock-paired";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const ZERO_HASH = `0x${"0".repeat(64)}`;
const CONVERSION_SLIPPAGE_BPS = 100;
const MAX_RPC_QUOTE_DIFFERENCE_BPS = 300n;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function rpcEndpoints() {
  const primary =
    process.env.ETHEREUM_RPC_URL ??
    "https://ethereum-rpc.publicnode.com";
  const secondary =
    process.env.ETHEREUM_RPC_URL_B ??
    process.env.ETHEREUM_RPC_URL_SECONDARY ??
    (primary === "https://ethereum-rpc.publicnode.com"
      ? "https://rpc.mevblocker.io"
      : "https://ethereum-rpc.publicnode.com");
  if (primary === secondary) {
    throw new Error("Stock-Paired rewards require two independent RPCs");
  }
  return [primary, secondary] as const;
}

function clients() {
  return rpcEndpoints().map((endpoint) =>
    createPublicClient({
      chain: mainnet,
      batch: { multicall: true },
      transport: http(endpoint, { retryCount: 1, timeout: 12_000 }),
    }),
  );
}

function tradeRuntimeClient(
  client: PublicClient,
): StockPairedTradeRuntimeClient {
  return {
    getChainId: () => client.getChainId(),
    async getBlock() {
      const block = await client.getBlock({ blockTag: "latest" });
      return { timestamp: block.timestamp };
    },
    getBalance: ({ address }) =>
      client.getBalance({ address, blockTag: "latest" }),
    getGasPrice: () => client.getGasPrice(),
    getCode: ({ address, blockNumber }) =>
      client.getCode({
        address,
        ...(blockNumber === undefined
          ? { blockTag: "latest" as const }
          : { blockNumber }),
      }),
    estimateGas: (args) => client.estimateGas(args),
    async call(args) {
      const result = await client.call(args);
      return { data: result.data };
    },
  };
}

function quoteDifferenceIsSafe(left: bigint, right: bigint) {
  const high = left > right ? left : right;
  const low = left > right ? right : left;
  return (
    low > 0n &&
    (high - low) * 10_000n <=
      low * MAX_RPC_QUOTE_DIFFERENCE_BPS
  );
}

function conservativeRewardConversion<T extends {
  quote: { amountOut: string; usdAmountOut: string };
  transaction: { kind: string };
}>(left: T, right: T) {
  if (left.transaction.kind !== right.transaction.kind) {
    throw new StockPairedTradeUnavailableError(
      "Independent RPCs disagree on the required conversion step",
    );
  }
  const leftEth = BigInt(left.quote.amountOut);
  const rightEth = BigInt(right.quote.amountOut);
  const leftUsd = BigInt(left.quote.usdAmountOut);
  const rightUsd = BigInt(right.quote.usdAmountOut);
  if (
    !quoteDifferenceIsSafe(leftEth, rightEth) ||
    !quoteDifferenceIsSafe(leftUsd, rightUsd)
  ) {
    throw new StockPairedTradeUnavailableError(
      "Independent RPC conversion quotes differ too much",
    );
  }
  return leftEth <= rightEth ? left : right;
}

async function assertRuntime(
  client: PublicClient,
  address: Address,
  expectedHash: Hex,
  blockNumber: bigint,
  label: string,
) {
  const code = await client.getCode({ address, blockNumber });
  if (
    !code ||
    code === "0x" ||
    keccak256(code).toLowerCase() !== expectedHash.toLowerCase()
  ) {
    throw new Error(`${label} runtime does not match the verified release`);
  }
}

function entitlement(
  totalReceived: bigint,
  beneficiaries: readonly {
    beneficiary: Address;
    shareBps: number;
  }[],
  account: Address,
) {
  const index = beneficiaries.findIndex(
    (item) => item.beneficiary.toLowerCase() === account.toLowerCase(),
  );
  if (index < 0) return 0n;
  if (index !== beneficiaries.length - 1) {
    return (
      (totalReceived * BigInt(beneficiaries[index].shareBps)) /
      10_000n
    );
  }
  return beneficiaries.slice(0, -1).reduce(
    (remaining, item) =>
      remaining -
      (totalReceived * BigInt(item.shareBps)) / 10_000n,
    totalReceived,
  );
}

async function readVaultReward(
  client: PublicClient,
  token: LauncherToken,
  account: Address,
  snapshotBlock: bigint,
) {
  if (
    token.launchModel !== "stock-paired" ||
    !token.rewardVaultAddress ||
    !token.quoteAssetAddress ||
    !token.creatorAddress ||
    !token.launchTransactionHash
  ) {
    return null;
  }
  const release = getConfiguredStockPairedReleaseByHook(
    token.hookAddress,
  );
  const quote = release
    ? getStockPairedQuoteAssetForRelease(
        release,
        token.quoteAssetAddress,
      )
    : null;
  if (!release || !quote) return null;
  const vault = getAddress(token.rewardVaultAddress);
  const [
    vaultCode,
    factoryVault,
    feeHook,
    poolId,
    quoteAsset,
    configurationHash,
    beneficiaryCount,
    accountShare,
    payoutAddress,
    claimed,
    totalReceived,
    poolFeeConfig,
  ] = await Promise.all([
    client.getCode({ address: vault, blockNumber: snapshotBlock }),
    client.readContract({
      address: release.addresses.feeSplitVaultFactory,
      abi: stockFeeSplitVaultFactoryAbi,
      functionName: "isFactoryVault",
      args: [vault],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "feeHook",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "poolId",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "quoteAsset",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "configurationHash",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "beneficiaryCount",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "shareBpsOf",
      args: [account],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "payoutAddressOf",
      args: [account],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "claimedBy",
      args: [account],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "totalCreatorFeesReceived",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.addresses.feeHook,
      abi: stockPairedHookAbi,
      functionName: "poolFeeConfig",
      args: [token.poolId],
      blockNumber: snapshotBlock,
    }),
  ]);
  if (accountShare === 0) return null;
  if (
    !vaultCode ||
    vaultCode === "0x" ||
    !factoryVault ||
    getAddress(feeHook).toLowerCase() !==
      release.addresses.feeHook.toLowerCase() ||
    poolId.toLowerCase() !== token.poolId.toLowerCase() ||
    getAddress(quoteAsset).toLowerCase() !== quote.address.toLowerCase() ||
    configurationHash.toLowerCase() === ZERO_HASH ||
    beneficiaryCount < 1n ||
    beneficiaryCount > 8n
  ) {
    throw new Error(
      `Stock-Paired reward provenance mismatch for ${token.tokenAddress}`,
    );
  }
  const [
    configuredQuote,
    configuredToken,
    configuredVault,
    registrar,
    ,
    registered,
    creatorFeesAccrued,
  ] = poolFeeConfig;
  if (
    !registered ||
    getAddress(configuredQuote).toLowerCase() !==
      quote.address.toLowerCase() ||
    getAddress(configuredToken).toLowerCase() !==
      token.tokenAddress.toLowerCase() ||
    getAddress(configuredVault).toLowerCase() !== vault.toLowerCase() ||
    getAddress(registrar).toLowerCase() !==
      release.addresses.launcher.toLowerCase()
  ) {
    throw new Error(
      `Stock-Paired hook provenance mismatch for ${token.tokenAddress}`,
    );
  }

  const beneficiaryAddresses = await Promise.all(
    Array.from({ length: Number(beneficiaryCount) }, (_, index) =>
      client.readContract({
        address: vault,
        abi: stockFeeSplitVaultAbi,
        functionName: "beneficiaryAt",
        args: [BigInt(index)],
        blockNumber: snapshotBlock,
      }),
    ),
  );
  const beneficiaries = await Promise.all(
    beneficiaryAddresses.map(async (beneficiary) => {
      const normalized = getAddress(beneficiary);
      const [shareBps, payout] = await Promise.all([
        client.readContract({
          address: vault,
          abi: stockFeeSplitVaultAbi,
          functionName: "shareBpsOf",
          args: [normalized],
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: vault,
          abi: stockFeeSplitVaultAbi,
          functionName: "payoutAddressOf",
          args: [normalized],
          blockNumber: snapshotBlock,
        }),
      ]);
      return {
        beneficiary: normalized,
        payoutAddress: getAddress(payout),
        shareBps: Number(shareBps),
      };
    }),
  );
  if (
    new Set(
      beneficiaries.map((item) => item.beneficiary.toLowerCase()),
    ).size !== beneficiaries.length ||
    beneficiaries.some(
      (item) => item.shareBps <= 0 || item.shareBps > 10_000,
    ) ||
    beneficiaries.reduce((sum, item) => sum + item.shareBps, 0) !==
      10_000 ||
    !beneficiaries.some(
      (item) =>
        item.beneficiary.toLowerCase() === account.toLowerCase() &&
        item.shareBps === Number(accountShare),
    )
  ) {
    throw new Error(
      `Invalid Stock-Paired reward split for ${token.tokenAddress}`,
    );
  }
  const prospectiveTotalReceived =
    totalReceived + creatorFeesAccrued;
  const accountEntitlement = entitlement(
    prospectiveTotalReceived,
    beneficiaries,
    account,
  );
  const claimable =
    accountEntitlement > claimed ? accountEntitlement - claimed : 0n;

  return {
    model: "stock-paired" as const,
    tokenAddress: getAddress(token.tokenAddress),
    tokenName: token.name,
    tokenSymbol: token.symbol,
    ...(token.imageUrl ? { imageUrl: token.imageUrl } : {}),
    hookAddress: release.addresses.feeHook,
    poolId: token.poolId,
    vaultAddress: vault,
    quoteAsset: quote.address,
    quoteAssetSymbol: quote.symbol,
    beneficiary: account,
    payoutAddress: getAddress(payoutAddress),
    shareBps: Number(accountShare),
    claimableRaw: claimable.toString(),
    claimable: formatUnits(claimable, 18),
    claimedRaw: claimed.toString(),
    claimed: formatUnits(claimed, 18),
    generatedRaw: accountEntitlement.toString(),
    generated: formatUnits(accountEntitlement, 18),
    creatorFeesPendingRaw: creatorFeesAccrued.toString(),
    beneficiaries,
    buySwapFeeBps: 100,
    sellSwapFeeBps: 100,
    programmableFeeBps: 10,
    launchTransactionHash: token.launchTransactionHash,
  };
}

async function addRewardEstimate(
  rpcClients: readonly PublicClient[],
  reward: NonNullable<Awaited<ReturnType<typeof readVaultReward>>>,
  account: Address,
) {
  if (BigInt(reward.claimableRaw) === 0n) return reward;
  const quotes = await Promise.allSettled(
    rpcClients.map((client) =>
      quoteStockPairedQuoteAssetToEth(tradeRuntimeClient(client), {
        quoteAsset: reward.quoteAsset,
        owner: account,
        amountIn: BigInt(reward.claimableRaw),
      }),
    ),
  );
  if (quotes.some((result) => result.status === "rejected")) {
    return reward;
  }
  const [left, right] = quotes.map(
    (result) =>
      (
        result as PromiseFulfilledResult<
          Awaited<ReturnType<typeof quoteStockPairedQuoteAssetToEth>>
        >
      ).value,
  );
  if (
    !quoteDifferenceIsSafe(left.amountOut, right.amountOut) ||
    !quoteDifferenceIsSafe(left.usdAmountOut, right.usdAmountOut)
  ) {
    return reward;
  }
  const estimatedEthRaw =
    left.amountOut <= right.amountOut
      ? left.amountOut
      : right.amountOut;
  const estimatedUsdRaw =
    left.usdAmountOut <= right.usdAmountOut
      ? left.usdAmountOut
      : right.usdAmountOut;
  return {
    ...reward,
    estimatedEthRaw: estimatedEthRaw.toString(),
    estimatedEth: formatUnits(estimatedEthRaw, 18),
    estimatedUsdRaw: estimatedUsdRaw.toString(),
    estimatedUsd: formatUnits(estimatedUsdRaw, 6),
  };
}

async function readRewards(
  account: Address,
  includeEstimates = true,
) {
  const releases = getConfiguredStockPairedReleases();
  if (releases.length === 0) {
    return {
      status: "not-deployed" as const,
      account,
      chainId: 1 as const,
      rewards: [],
    };
  }
  const deployment = getOnchainDeployment("production");
  const model = await readExploreModel(deployment);
  if (model.status !== "ready") {
    throw new Error("The verified launch registry is unavailable");
  }
  const snapshotBlock = BigInt(model.snapshot.blockNumber);
  const rpcClients = clients();
  await Promise.all(
    rpcClients.flatMap((client) =>
      releases.flatMap((release) => [
        assertRuntime(
          client,
          release.addresses.feeHook,
          release.runtimeCodeHashes.feeHook,
          snapshotBlock,
          `${release.internalContractRelease} hook`,
        ),
        assertRuntime(
          client,
          release.addresses.feeSplitVaultFactory,
          release.runtimeCodeHashes.feeSplitVaultFactory,
          snapshotBlock,
          `${release.internalContractRelease} reward-vault factory`,
        ),
      ]),
    ),
  );
  const stockTokens = model.tokens.filter(
    (token) => token.launchModel === "stock-paired",
  );
  const rewardSets = await Promise.all(
    rpcClients.map(async (client) =>
      (
        await Promise.all(
          stockTokens.map((token) =>
            readVaultReward(client, token, account, snapshotBlock),
          ),
        )
      ).filter((reward): reward is NonNullable<typeof reward> =>
        Boolean(reward),
      ),
    ),
  );
  const fingerprint = JSON.stringify(rewardSets[0]);
  if (
    rewardSets.some(
      (candidate) => JSON.stringify(candidate) !== fingerprint,
    )
  ) {
    throw new Error(
      "Independent RPCs disagree on Stock-Paired rewards",
    );
  }
  const rewards = includeEstimates
    ? await Promise.all(
        rewardSets[0].map((reward) =>
          addRewardEstimate(rpcClients, reward, account),
        ),
      )
    : rewardSets[0];
  return {
    status: "ready" as const,
    account,
    chainId: 1 as const,
    snapshotBlock: snapshotBlock.toString(),
    rewards,
  };
}

export async function GET(request: NextRequest) {
  const accountInput = request.nextUrl.searchParams.get("account")?.trim();
  if (!accountInput || !isAddress(accountInput)) {
    return json({ error: "Enter a valid Ethereum account address" }, 400);
  }
  try {
    return json(await readRewards(getAddress(accountInput)));
  } catch (error) {
    console.error(
      "Stock-Paired profile read failed",
      safeServerErrorSummary(error),
    );
    return json(
      { error: "Stock-Paired rewards are temporarily unavailable" },
      503,
    );
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(
    request.headers.get("content-length") ?? "0",
  );
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    return json({ error: "The reward request is too large" }, 413);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) {
      return json({ error: "The reward request is too large" }, 413);
    }
    body = JSON.parse(text);
  } catch {
    return json({ error: "Send a valid reward request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "The reward request is missing" }, 400);
  }
  const input = body as Record<string, unknown>;
  const allowed = new Set([
    "action",
    "account",
    "vaultAddress",
    "newPayoutAddress",
    "claimTransactionHash",
    "amountIn",
    "slippageBps",
    "deadline",
    "chainId",
  ]);
  const unsupported = Object.keys(input).find((key) => !allowed.has(key));
  const isClaim = input.action === "claim";
  const isPayoutUpdate = input.action === "update-payout";
  const isConversion = input.action === "convert-to-eth";
  if (
    unsupported ||
    (!isClaim && !isPayoutUpdate && !isConversion) ||
    input.chainId !== 1 ||
    typeof input.account !== "string" ||
    !isAddress(input.account) ||
    typeof input.vaultAddress !== "string" ||
    !isAddress(input.vaultAddress) ||
    (isPayoutUpdate &&
      (typeof input.newPayoutAddress !== "string" ||
        !isAddress(input.newPayoutAddress) ||
        /^0x0{40}$/i.test(input.newPayoutAddress))) ||
    (!isPayoutUpdate && input.newPayoutAddress !== undefined) ||
    (isConversion &&
      (typeof input.claimTransactionHash !== "string" ||
        !isHex(input.claimTransactionHash, { strict: true }) ||
        input.claimTransactionHash.length !== 66 ||
        typeof input.amountIn !== "string" ||
        !/^[1-9]\d{0,77}$/.test(input.amountIn) ||
        input.slippageBps !== CONVERSION_SLIPPAGE_BPS ||
        typeof input.deadline !== "string" ||
        !/^[1-9]\d{0,77}$/.test(input.deadline))) ||
    (!isConversion &&
      (input.claimTransactionHash !== undefined ||
        input.amountIn !== undefined ||
        input.slippageBps !== undefined ||
        input.deadline !== undefined))
  ) {
    return json({ error: "The reward request is invalid" }, 400);
  }

  try {
    const account = getAddress(input.account);
    const vaultAddress = getAddress(input.vaultAddress);
    const profile = await readRewards(account, false);
    if (profile.status !== "ready") {
      return json({ error: "Stock-Paired rewards are not deployed" }, 409);
    }
    const reward = profile.rewards.find(
      (candidate) =>
        candidate.vaultAddress.toLowerCase() ===
        vaultAddress.toLowerCase(),
    );
    if (!reward) {
      return json(
        { error: "This wallet is not a beneficiary of that reward vault" },
        403,
      );
    }
    if (isClaim && BigInt(reward.claimableRaw) === 0n) {
      return json({ error: "No Stock-Paired rewards are claimable" }, 409);
    }
    const rpcClients = clients();
    if (isConversion) {
      if (
        reward.payoutAddress.toLowerCase() !== account.toLowerCase()
      ) {
        return json(
          {
            error:
              "Claim as ETH requires the payout address to be this wallet",
          },
          409,
        );
      }
      const amountIn = BigInt(input.amountIn as string);
      const claimTransactionHash = input.claimTransactionHash as Hex;
      const claimedAmount = await verifyStockPairedClaimReceipt({
        rpcClients,
        transactionHash: claimTransactionHash,
        account,
        vaultAddress,
        quoteAsset: reward.quoteAsset,
        minimumAmount: amountIn,
      });
      const registry = await readExploreModel(
        getOnchainDeployment("production"),
      );
      const { deployment, verifiedToken } =
        resolveStockPairedTradeDeployment(
          1,
          registry,
          reward.tokenAddress,
        );
      if (
        verifiedToken.rewardVaultAddress?.toLowerCase() !==
          vaultAddress.toLowerCase() ||
        deployment.quoteAsset.toLowerCase() !==
          reward.quoteAsset.toLowerCase() ||
        deployment.poolId.toLowerCase() !== reward.poolId.toLowerCase()
      ) {
        throw new StockPairedTradeUnavailableError(
          "The reward does not match its verified Stock-Paired launch",
        );
      }
      const conversionRequest = {
        chainId: 1 as const,
        owner: account,
        amountIn: claimedAmount,
        slippageBps: CONVERSION_SLIPPAGE_BPS,
        deadline: BigInt(input.deadline as string),
      };
      const preparations = await Promise.allSettled(
        rpcClients.map((client) =>
          prepareStockPairedRewardConversion(
            tradeRuntimeClient(client),
            deployment,
            conversionRequest,
          ),
        ),
      );
      const inputFailure = preparations.find(
        (
          result,
        ): result is PromiseRejectedResult =>
          result.status === "rejected" &&
          result.reason instanceof ClassicTradeInputError,
      );
      if (inputFailure) throw inputFailure.reason;
      if (preparations.some((result) => result.status === "rejected")) {
        throw new StockPairedTradeUnavailableError(
          "The conversion could not be verified across both independent RPCs",
        );
      }
      const [left, right] = preparations.map(
        (result) =>
          (
            result as PromiseFulfilledResult<
              Awaited<
                ReturnType<typeof prepareStockPairedRewardConversion>
              >
            >
          ).value,
      );
      return json({
        ...conservativeRewardConversion(left, right),
        action: "convert-to-eth",
        vaultAddress,
        claimTransactionHash,
        claimedAmount: claimedAmount.toString(),
      });
    }

    const data =
      isClaim
        ? encodeFunctionData({
            abi: stockFeeSplitVaultAbi,
            functionName: "claim",
          })
        : encodeFunctionData({
            abi: stockFeeSplitVaultAbi,
            functionName: "setPayoutAddress",
            args: [getAddress(input.newPayoutAddress as string)],
          });
    const requestForRpc = {
      account,
      to: vaultAddress,
      data,
      value: 0n,
    };
    await Promise.all(
      rpcClients.map((client) => client.call(requestForRpc)),
    );
    const estimates = await Promise.all(
      rpcClients.map((client) => client.estimateGas(requestForRpc)),
    );
    const gasLimit =
      ((estimates.reduce(
        (largest, candidate) =>
          candidate > largest ? candidate : largest,
        0n,
      ) *
        120n) +
        99n) /
      100n;
    if (gasLimit <= 0n) {
      throw new Error("The reward transaction gas estimate is invalid");
    }
    return json({
      status: "ready",
      account,
      vaultAddress,
      action: input.action,
      transaction: {
        kind:
          isClaim
            ? "claim-stock-paired-rewards"
            : "update-stock-paired-payout",
        chainId: 1,
        from: account,
        to: vaultAddress,
        data,
        value: "0",
        gasLimit: gasLimit.toString(),
      },
    });
  } catch (error) {
    if (error instanceof ClassicTradeInputError) {
      return json({ error: error.message }, 400);
    }
    if (
      error instanceof StockPairedClaimReceiptError ||
      error instanceof StockPairedTradeUnavailableError
    ) {
      return json({ error: error.message }, 409);
    }
    console.error(
      "Stock-Paired reward preparation failed",
      safeServerErrorSummary(error),
    );
    return json(
      {
        error:
          "The Stock-Paired reward action could not be prepared from the current onchain state",
      },
      503,
    );
  }
}
