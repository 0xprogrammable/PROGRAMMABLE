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
  type ExploreReadModel,
} from "@/lib/onchain";
import { readBitqueryExploreModelV1 } from
  "@/lib/market-data/bitquery-explore-model.server";
import { safeServerErrorSummary } from "@/lib/server/safe-error";
import { stockPairedActionRpcProvider } from "@/lib/server/action-rpc-quorum.server";
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
  getConfiguredStockPairedReleaseByHookAndVersion,
} from "@/lib/stock-paired-release";
import type { LauncherToken } from "@/lib/tokens";
import {
  readBitqueryStockPairedProfile,
  safeBitqueryProfileError,
} from "@/lib/market-data/bitquery-profile.server";
import { ClassicTradeInputError } from "@/lib/trade/classic";
import {
  prepareStockPairedRewardConversion,
  resolveStockPairedTradeDeployment,
  StockPairedTradeUnavailableError,
  type StockPairedTradeRuntimeClient,
} from "@/lib/trade/stock-paired";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const ZERO_HASH = `0x${"0".repeat(64)}`;
const CONVERSION_SLIPPAGE_BPS = 100;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function actionClient() {
  const provider = stockPairedActionRpcProvider();
  return createPublicClient({
    chain: mainnet,
    batch: { multicall: true },
    transport: http(provider.endpoint, { retryCount: 2, timeout: 12_000 }),
  });
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
  const release = getConfiguredStockPairedReleaseByHookAndVersion(
    token.hookAddress,
    token.launchModelVersion,
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

async function readStockActionReward(
  account: Address,
  token: LauncherToken,
): Promise<{
  reward: NonNullable<Awaited<ReturnType<typeof readVaultReward>>>;
  rpcClient: PublicClient;
}> {
  if (
    token.launchModel !== "stock-paired" ||
    !token.rewardVaultAddress ||
    !token.quoteAssetAddress
  ) {
    throw new Error("The Stock-Paired reward identity is invalid");
  }
  const release = getConfiguredStockPairedReleaseByHookAndVersion(
    token.hookAddress,
    token.launchModelVersion,
  );
  if (!release) {
    throw new Error("The Stock-Paired release is not configured");
  }
  const rpcClient = actionClient();
  const blockNumber = await rpcClient.getBlockNumber();
  await Promise.all([
    assertRuntime(
      rpcClient,
      release.addresses.feeHook,
      release.runtimeCodeHashes.feeHook,
      blockNumber,
      `${release.internalContractRelease} hook`,
    ),
    assertRuntime(
      rpcClient,
      release.addresses.feeSplitVaultFactory,
      release.runtimeCodeHashes.feeSplitVaultFactory,
      blockNumber,
      `${release.internalContractRelease} reward-vault factory`,
    ),
  ]);
  const reward = await readVaultReward(
    rpcClient,
    token,
    account,
    blockNumber,
  );
  if (!reward) {
    throw new Error("This wallet is not a current reward beneficiary");
  }
  return { reward, rpcClient };
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => key !== "account") ||
    search.getAll("account").length !== 1
  ) {
    return json({ error: "Unsupported query parameters" }, 400);
  }
  const accountInput = search.get("account")?.trim();
  if (!accountInput || !isAddress(accountInput)) {
    return json({ error: "Enter a valid Ethereum account address" }, 400);
  }
  try {
    const account = getAddress(accountInput);
    return NextResponse.json(await readBitqueryStockPairedProfile(account), {
      headers: {
        "Cache-Control": "private, max-age=0, s-maxage=15",
        "X-Programmable-Read-Source": "bitquery",
      },
    });
  } catch (error) {
    console.error(
      "Bitquery Stock-Paired profile read failed",
      safeBitqueryProfileError(error),
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
    const registry: ExploreReadModel = await readBitqueryExploreModelV1({
      signal: request.signal,
    });
    const token = registry.tokens.find(
      (candidate) =>
        candidate.launchModel === "stock-paired" &&
        candidate.rewardVaultAddress?.toLowerCase() ===
          vaultAddress.toLowerCase(),
    );
    if (!token) {
      return json(
        { error: "This wallet is not a beneficiary of that reward vault" },
        403,
      );
    }
    const { reward, rpcClient } = await readStockActionReward(
      account,
      token,
    );
    if (isClaim && BigInt(reward.claimableRaw) === 0n) {
      return json({ error: "No Stock-Paired rewards are claimable" }, 409);
    }
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
        rpcClient,
        transactionHash: claimTransactionHash,
        account,
        vaultAddress,
        quoteAsset: reward.quoteAsset,
        minimumAmount: amountIn,
      });
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
      const verifiedConversion = await prepareStockPairedRewardConversion(
        tradeRuntimeClient(rpcClient),
        deployment,
        conversionRequest,
      );
      return json({
        ...verifiedConversion,
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
    await rpcClient.call(requestForRpc);
    const [estimatedGas, gasPrice, balance] = await Promise.all([
      rpcClient.estimateGas(requestForRpc),
      rpcClient.getGasPrice(),
      rpcClient.getBalance({ address: account }),
    ]);
    const gasLimit =
      ((estimatedGas * 120n) +
        99n) /
      100n;
    if (gasLimit <= 0n) {
      throw new Error("The reward transaction gas estimate is invalid");
    }
    if (gasPrice <= 0n || balance < gasLimit * gasPrice) {
      return json(
        { error: "This wallet needs more ETH for the network fee" },
        409,
      );
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
    if (error instanceof StockPairedClaimReceiptError) {
      if (error.code === "pending") {
        return json(
          {
            status: "pending",
            code: "stock-paired-claim-receipt-pending",
            error: error.message,
          },
          409,
        );
      }
      if (error.code === "unavailable") {
        return json(
          {
            code: "stock-paired-claim-receipt-unavailable",
            error: error.message,
          },
          503,
        );
      }
      return json(
        {
          code: "stock-paired-claim-receipt-invalid",
          error: error.message,
        },
        409,
      );
    }
    if (error instanceof StockPairedTradeUnavailableError) {
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
