import "server-only";

import { createHash } from "node:crypto";

import {
  encodeFunctionData,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import type {
  DiscoverableLaunchMarketV2,
  DiscoverableMarketTradeCapabilityV1,
} from "../../custom-launch/contract-v2";
import {
  resolveRouterTradeAdapterV1,
  routerTradeAdapterForProjectIdV1,
  type RouterTradeAdapterV1,
} from "../../custom-launch/router-trade-adapter-v1";
import {
  CUSTOM_TRADE_RESPONSE_SCHEMA_V1,
  CustomMarketTradeInputErrorV1,
  CustomMarketTradeUnavailableErrorV1,
  assertCustomTradeDeadlineV1,
  buildCustomMarketSwapTransactionV1,
  buildCustomPermit2ApprovalTransactionV1,
  buildCustomTokenApprovalTransactionV1,
  customAmountOutMinimumV1,
  customTradeDependencyV1,
  customTradePermit2Abi,
  customTradePoolKeyV1,
  customTradeQuoterAbi,
  customTradeSideBindingV1,
  customTradeStateViewAbi,
  customTradeTokenAbi,
  decodeCustomQuoteV1,
  type CustomMarketTradePreparationV1,
  type CustomMarketTradeRequestV1,
} from "../../custom-launch/trade-v1";
import type { PreparedTradeTransaction } from "../../prepared-transaction";
import { readFinalizedRouterCustomExploreEntriesV1 } from
  "../../alchemy/router-custom-public.server";
import { getProductionWebsiteProjectionTargetV1 } from "../projection-target/website-target";
import {
  isCustomLaunchPublicEnabled,
  isCustomLaunchRegistryPublicReadEnabled,
} from "./public-readiness";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const GAS_PRICE_BUFFER_BPS = 12_500n;
const BPS_DENOMINATOR = 10_000n;
const PERMIT2_SAFETY_SECONDS = 600n;

export type CustomMarketTradeRuntimeClientV1 = Readonly<{
  getChainId(): Promise<number>;
  getBlock(): Promise<{ number: bigint; timestamp: bigint }>;
  getBalance(args: { address: Address }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  readContract(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  estimateGas(args: {
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
  }): Promise<bigint>;
  call(args: {
    account?: Address;
    to: Address;
    data: Hex;
    value?: bigint;
  }): Promise<{ data?: Hex }>;
}>;

function asTuple(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new CustomMarketTradeUnavailableErrorV1(`${label} returned invalid data`);
  }
  return value;
}

function uint(value: unknown, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new CustomMarketTradeUnavailableErrorV1(`${label} returned invalid data`);
  }
  return value;
}

function runtimeSha256(code: Hex): `sha256:${string}` {
  const bytes = Buffer.from(code.slice(2), "hex");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function assertRouterAdapterRuntimeV1(
  client: CustomMarketTradeRuntimeClientV1,
  adapter: RouterTradeAdapterV1,
) {
  const targets = [
    {
      label: "FADE token",
      address: getAddress(adapter.tokenAddress),
      runtimeCodeKeccak256: adapter.tokenRuntimeCodeKeccak256,
      runtimeCodeSha256: adapter.tokenRuntimeCodeSha256,
    },
    {
      label: "FADE hook",
      address: getAddress(adapter.hookAddress),
      runtimeCodeKeccak256: adapter.hookRuntimeCodeKeccak256,
      runtimeCodeSha256: adapter.hookRuntimeCodeSha256,
    },
  ] as const;
  const codes = await Promise.all(targets.map(({ address }) =>
    client.getCode({ address })));
  for (let index = 0; index < targets.length; index += 1) {
    const expected = targets[index]!;
    const code = codes[index];
    if (!code || code === "0x"
      || keccak256(code).toLowerCase()
        !== expected.runtimeCodeKeccak256.toLowerCase()
      || runtimeSha256(code) !== expected.runtimeCodeSha256) {
      throw new CustomMarketTradeUnavailableErrorV1(
        `${expected.label} runtime code no longer matches the reviewed Router adapter`,
      );
    }
  }
}

async function assertCapabilityRuntimeV1(
  client: CustomMarketTradeRuntimeClientV1,
  market: DiscoverableLaunchMarketV2,
  capability: DiscoverableMarketTradeCapabilityV1,
) {
  if (market.uniswapV4 === null) {
    throw new CustomMarketTradeUnavailableErrorV1("The Custom market has no verified PoolKey");
  }
  const dependencies = [
    ...capability.dependencies.map((dependency) => ({
      label: dependency.role,
      address: getAddress(dependency.identity.value),
      runtimeCodeKeccak256: dependency.runtimeCodeKeccak256,
      runtimeCodeSha256: dependency.runtimeCodeSha256,
    })),
    {
      label: "uniswap-v4-pool-manager",
      address: getAddress(market.uniswapV4.poolManager.value),
      runtimeCodeKeccak256: market.uniswapV4.poolManagerRuntimeCodeKeccak256,
      runtimeCodeSha256: market.uniswapV4.poolManagerRuntimeCodeSha256,
    },
  ];
  const codes = await Promise.all(dependencies.map(({ address }) =>
    client.getCode({ address })));
  for (let index = 0; index < dependencies.length; index += 1) {
    const expected = dependencies[index]!;
    const code = codes[index];
    if (!code || code === "0x"
      || keccak256(code).toLowerCase() !== expected.runtimeCodeKeccak256.toLowerCase()
      || runtimeSha256(code) !== expected.runtimeCodeSha256) {
      throw new CustomMarketTradeUnavailableErrorV1(
        `${expected.label} runtime code no longer matches the reviewed capability`,
      );
    }
  }
}

async function currentPoolStateV1(
  client: CustomMarketTradeRuntimeClientV1,
  capability: DiscoverableMarketTradeCapabilityV1,
) {
  const stateView = customTradeDependencyV1(capability, "uniswap-v4-state-view");
  const address = getAddress(stateView.identity.value);
  const poolId = capability.poolKey.poolId as Hex;
  const [rawSlot0, rawLiquidity] = await Promise.all([
    client.readContract({
      address,
      abi: customTradeStateViewAbi,
      functionName: "getSlot0",
      args: [poolId],
    }),
    client.readContract({
      address,
      abi: customTradeStateViewAbi,
      functionName: "getLiquidity",
      args: [poolId],
    }),
  ]);
  const slot0 = asTuple(rawSlot0, "StateView slot0");
  const sqrtPriceX96 = uint(slot0[0], "StateView sqrt price");
  const tick = typeof slot0[1] === "number" ? BigInt(slot0[1]) : null;
  const liquidity = uint(rawLiquidity, "StateView liquidity");
  if (sqrtPriceX96 === 0n || liquidity === 0n || tick === null) {
    throw new CustomMarketTradeUnavailableErrorV1(
      "The verified Custom pool has no current tradable state",
    );
  }
  return { sqrtPriceX96, tick, liquidity };
}

async function quoteExactInputV1(
  client: CustomMarketTradeRuntimeClientV1,
  capability: DiscoverableMarketTradeCapabilityV1,
  request: CustomMarketTradeRequestV1,
) {
  const quoter = customTradeDependencyV1(capability, "uniswap-v4-quoter");
  const binding = customTradeSideBindingV1(capability, request.side);
  const result = await client.call({
    account: request.owner,
    to: getAddress(quoter.identity.value),
    data: encodeFunctionData({
      abi: customTradeQuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{
        poolKey: customTradePoolKeyV1(capability),
        zeroForOne: binding.zeroForOne,
        exactAmount: BigInt(request.amountIn),
        hookData: capability.hookDataPolicy.data,
      }],
    }),
  });
  if (!result.data || result.data === "0x") {
    throw new CustomMarketTradeUnavailableErrorV1("The V4Quoter returned no current quote");
  }
  return decodeCustomQuoteV1(result.data);
}

async function erc20InputStateV1(
  client: CustomMarketTradeRuntimeClientV1,
  capability: DiscoverableMarketTradeCapabilityV1,
  owner: Address,
  token: Address,
) {
  const permit2 = customTradeDependencyV1(capability, "uniswap-permit2");
  const router = customTradeDependencyV1(capability, "uniswap-v4-universal-router");
  const [rawBalance, rawTokenAllowance, rawPermit2Allowance] = await Promise.all([
    client.readContract({
      address: token,
      abi: customTradeTokenAbi,
      functionName: "balanceOf",
      args: [owner],
    }),
    client.readContract({
      address: token,
      abi: customTradeTokenAbi,
      functionName: "allowance",
      args: [owner, getAddress(permit2.identity.value)],
    }),
    client.readContract({
      address: getAddress(permit2.identity.value),
      abi: customTradePermit2Abi,
      functionName: "allowance",
      args: [owner, token, getAddress(router.identity.value)],
    }),
  ]);
  const permit2Allowance = asTuple(rawPermit2Allowance, "Permit2 allowance");
  return {
    balance: uint(rawBalance, "ERC20 balance"),
    tokenAllowance: uint(rawTokenAllowance, "ERC20 allowance"),
    permit2Allowance: uint(permit2Allowance[0], "Permit2 allowance"),
    permit2Expiration: uint(permit2Allowance[1], "Permit2 expiration"),
  };
}

function gasReserve(gasLimit: bigint, gasPrice: bigint) {
  if (gasLimit <= 0n || gasPrice <= 0n) {
    throw new CustomMarketTradeUnavailableErrorV1("The current gas estimate is invalid");
  }
  return (gasLimit * gasPrice * GAS_PRICE_BUFFER_BPS + BPS_DENOMINATOR - 1n)
    / BPS_DENOMINATOR;
}

async function simulateTransactionV1(
  client: CustomMarketTradeRuntimeClientV1,
  owner: Address,
  transaction: PreparedTradeTransaction,
) {
  const request = {
    account: owner,
    to: transaction.to,
    data: transaction.data,
    value: BigInt(transaction.value),
  };
  await client.call(request);
  const gas = await client.estimateGas(request);
  if (gas <= 0n) {
    throw new CustomMarketTradeUnavailableErrorV1("The Custom transaction simulation failed");
  }
  return (gas * 120n + 99n) / 100n;
}

export async function prepareCustomMarketTradeV1(input: Readonly<{
  client: CustomMarketTradeRuntimeClientV1;
  request: CustomMarketTradeRequestV1;
}>): Promise<CustomMarketTradePreparationV1> {
  let projectId: `sha256:${string}`;
  let projectChainId: string;
  let projectChainProfileId: string;
  let projectChainProfileHash: `sha256:${string}`;
  let market: DiscoverableLaunchMarketV2 | undefined;
  let routerAdapter: RouterTradeAdapterV1 | null = null;
  const requestedRouterAdapter = routerTradeAdapterForProjectIdV1(
    input.request.projectId,
  );
  if (requestedRouterAdapter !== null) {
    const entries = await readFinalizedRouterCustomExploreEntriesV1({
      signal: AbortSignal.timeout(10_000),
    });
    const matches = entries.flatMap((entry) => {
      const adapter = resolveRouterTradeAdapterV1(entry);
      return adapter === null ? [] : [adapter];
    });
    if (matches.length !== 1
      || matches[0]!.projectId !== input.request.projectId) {
      throw new CustomMarketTradeUnavailableErrorV1(
        "The Router Custom project is not an exact finalized adapter",
      );
    }
    routerAdapter = matches[0]!;
    projectId = routerAdapter.projectId;
    projectChainId = routerAdapter.chainId;
    projectChainProfileId = routerAdapter.chainProfileId;
    projectChainProfileHash = routerAdapter.chainProfileHash;
    market = routerAdapter.market;
  } else {
    if (!isCustomLaunchPublicEnabled()
      || !isCustomLaunchRegistryPublicReadEnabled()) {
      throw new CustomMarketTradeUnavailableErrorV1(
        "Custom launches are not public",
      );
    }
    const target = getProductionWebsiteProjectionTargetV1();
    await target.assertProductionReadiness();
    const project = await target.registryCustomPublicStore
      .findFinalizedCustomLaunchByProjectId({
      projectId: input.request.projectId,
      signal: AbortSignal.timeout(10_000),
    });
    if (project === null) {
      throw new CustomMarketTradeUnavailableErrorV1(
        "The Custom project is not finalized",
      );
    }
    projectId = project.projectId;
    projectChainId = project.chainId;
    projectChainProfileId = project.chainProfileId;
    projectChainProfileHash = project.chainProfileHash;
    market = project.discoverableMarkets.find(({ marketId }) =>
      marketId === input.request.marketId);
  }
  const capability = market?.tradeCapability;
  if (market === undefined || capability === undefined) {
    throw new CustomMarketTradeUnavailableErrorV1(
      "Onsite trading is not enabled by this Custom market",
    );
  }
  if (market.status !== "active" || market.verification.status !== "verified"
    || market.uniswapV4 === null
    || market.marketId !== input.request.marketId
    || projectChainId !== String(input.request.chainId)
    || capability.chainId !== projectChainId
    || capability.chainProfileId !== projectChainProfileId
    || capability.chainProfileHash !== projectChainProfileHash
    || capability.marketId !== market.marketId
    || capability.tradeCapabilityBindingHash
      !== input.request.tradeCapabilityBindingHash
    || capability.recipientPolicy !== "connected-wallet-only"
    || capability.exactness !== "exact-input"
    || capability.quotePolicy.currentStateRequired !== true
    || capability.quotePolicy.executionMode !== "offchain-static-call-only"
    || capability.slippagePolicy.amountOutMinimumRequired !== true
    || capability.deadlinePolicy.deadlineRequired !== true
    || input.request.slippageBps > capability.slippagePolicy.maximumSlippageBps) {
    throw new CustomMarketTradeUnavailableErrorV1(
      "The Custom trade request does not match the verified market capability",
    );
  }
  const actualChainId = await input.client.getChainId();
  if (actualChainId !== input.request.chainId) {
    throw new CustomMarketTradeUnavailableErrorV1("The RPC is on the wrong chain");
  }
  customTradePoolKeyV1(capability);
  await assertCapabilityRuntimeV1(input.client, market, capability);
  if (routerAdapter !== null) {
    await assertRouterAdapterRuntimeV1(input.client, routerAdapter);
  }
  const block = await input.client.getBlock();
  assertCustomTradeDeadlineV1(block.timestamp, BigInt(input.request.deadline), capability);
  const [stateView, quoted, nativeBalance, gasPrice] = await Promise.all([
    currentPoolStateV1(input.client, capability),
    quoteExactInputV1(input.client, capability, input.request),
    input.client.getBalance({ address: input.request.owner }),
    input.client.getGasPrice(),
  ]);
  const binding = customTradeSideBindingV1(capability, input.request.side);
  const amountIn = BigInt(input.request.amountIn);
  const inputCurrency = getAddress(binding.zeroForOne
    ? capability.poolKey.currency0.value
    : capability.poolKey.currency1.value);
  const minimum = customAmountOutMinimumV1(quoted.amountOut, input.request.slippageBps);
  const validUntil = block.timestamp
    + BigInt(capability.quotePolicy.maximumQuoteAgeSeconds);
  const quote = Object.freeze({
    amountIn: amountIn.toString(),
    amountOut: quoted.amountOut.toString(),
    amountOutMinimum: minimum.toString(),
    gasEstimate: quoted.gasEstimate.toString(),
    slippageBps: input.request.slippageBps,
    deadline: input.request.deadline,
    observedAtBlock: block.number.toString(),
    observedAtTimestamp: block.timestamp.toString(),
    validUntil: validUntil.toString(),
    stateView: Object.freeze({
      sqrtPriceX96: stateView.sqrtPriceX96.toString(),
      tick: stateView.tick.toString(),
      liquidity: stateView.liquidity.toString(),
    }),
  });
  const base = {
    schemaVersion: CUSTOM_TRADE_RESPONSE_SCHEMA_V1,
    projectId,
    marketId: market.marketId,
    tradeCapabilityBindingHash: capability.tradeCapabilityBindingHash,
    chainId: input.request.chainId,
    owner: input.request.owner,
    recipient: input.request.recipient,
    side: input.request.side,
    inputAssetId: binding.inputAssetId,
    outputAssetId: binding.outputAssetId,
    inputCurrencyKind: binding.inputCurrencyKind,
    quote,
  } as const;

  if (binding.inputCurrencyKind === "erc20") {
    if (amountIn > (1n << 160n) - 1n) {
      throw new CustomMarketTradeInputErrorV1("The ERC20 input exceeds Permit2 limits");
    }
    const state = await erc20InputStateV1(
      input.client,
      capability,
      input.request.owner,
      inputCurrency,
    );
    if (state.balance < amountIn) {
      throw new CustomMarketTradeInputErrorV1("The input exceeds the wallet token balance");
    }
    if (state.tokenAllowance < amountIn) {
      const transaction = buildCustomTokenApprovalTransactionV1({
        capability,
        token: inputCurrency,
        amountIn,
      });
      await simulateTransactionV1(input.client, input.request.owner, transaction);
      return Object.freeze({
        ...base,
        status: "approval-required" as const,
        approvalState: "erc20-to-permit2" as const,
        transaction,
      });
    }
    if (state.permit2Allowance < amountIn
      || state.permit2Expiration <= block.timestamp + PERMIT2_SAFETY_SECONDS) {
      const transaction = buildCustomPermit2ApprovalTransactionV1({
        capability,
        token: inputCurrency,
        amountIn,
        now: block.timestamp,
        deadline: BigInt(input.request.deadline),
      });
      await simulateTransactionV1(input.client, input.request.owner, transaction);
      return Object.freeze({
        ...base,
        status: "approval-required" as const,
        approvalState: "permit2-to-router" as const,
        transaction,
      });
    }
  } else if (inputCurrency.toLowerCase() !== ZERO_ADDRESS) {
    throw new CustomMarketTradeUnavailableErrorV1(
      "The verified native-input side does not use native ETH",
    );
  }

  const built = buildCustomMarketSwapTransactionV1({
    capability,
    side: input.request.side,
    amountIn,
    quotedAmountOut: quoted.amountOut,
    slippageBps: input.request.slippageBps,
    deadline: BigInt(input.request.deadline),
  });
  const gasLimit = await simulateTransactionV1(input.client, input.request.owner, built);
  const reserve = gasReserve(gasLimit, gasPrice);
  const requiredNative = BigInt(built.value) + reserve;
  if (nativeBalance < requiredNative) {
    throw new CustomMarketTradeInputErrorV1(
      binding.inputCurrencyKind === "native"
        ? "Enter a smaller native amount so the wallet keeps enough for gas"
        : "The wallet needs more native currency for gas",
    );
  }
  return Object.freeze({
    ...base,
    status: "ready" as const,
    ...(binding.inputCurrencyKind === "erc20"
      ? { approvalState: "ready" as const }
      : {}),
    transaction: Object.freeze({ ...built, gasLimit: gasLimit.toString() }),
  });
}

export function selectConservativeCustomPreparationV1(
  first: CustomMarketTradePreparationV1,
  second: CustomMarketTradePreparationV1,
) {
  if (first.transaction.kind !== second.transaction.kind
    || first.tradeCapabilityBindingHash !== second.tradeCapabilityBindingHash
    || first.marketId !== second.marketId
    || first.side !== second.side) {
    throw new CustomMarketTradeUnavailableErrorV1(
      "Independent RPCs disagree on the Custom trade route",
    );
  }
  const left = BigInt(first.quote.amountOut);
  const right = BigInt(second.quote.amountOut);
  const high = left > right ? left : right;
  const low = left > right ? right : left;
  if (low <= 0n || (high - low) * 10_000n > low * 300n) {
    throw new CustomMarketTradeUnavailableErrorV1(
      "Independent RPC quotes differ too much",
    );
  }
  return left <= right ? first : second;
}
