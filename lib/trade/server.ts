import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import appDeployments from "../../contracts/config/app-deployments.v1.json";
import mainnetDeployments from "../../contracts/dependencies/ethereum-mainnet.json";
import sepoliaDeployments from "../../contracts/dependencies/ethereum-sepolia.json";
import mainnetDeepV3Manifest from "../../contracts/deployments/mainnet-deep-full-range-v3.json";
import {
  getConfiguredClassicV3Release,
  isClassicV3ReleaseVerified,
} from "../classic-v3-release";
import {
  getConfiguredClassicV4PublicRelease,
  isClassicV4PublicActionRelease,
} from "../classic-v4-release";
import {
  NATIVE_ETH,
  amountOutMinimum,
  assertClassicDeadline,
  assertClassicV4Deadline,
  assertClassicTradeDeployment,
  buildClassicPermit2ApprovalTransaction,
  buildClassicSwapTransaction,
  buildClassicTokenApprovalTransaction,
  classicGasReserve,
  classicPermit2Abi,
  classicTokenAbi,
  createClassicPoolKey,
  getClassicPoolId,
  getClassicSellApprovalState,
  maximumClassicBuyAmount,
  quoteClassicExactInput,
  ClassicTradeInputError,
  type ClassicQuoteClient,
  type ClassicTradeDeployment,
  type ClassicTradeSide,
} from "./classic";
import { MAX_TRADE_SLIPPAGE_BPS } from "./policy";
import {
  getVerifiedDeepRelease,
  getVerifiedDeepV2Release,
  type LaunchModelReleaseManifest,
} from "../launch-model-gating";
import type { ExploreReadModel } from "../onchain/types";
import type { LauncherToken } from "../tokens";
import { requireDeepV2IndexedCandidate } from "../profile/deep-v2-indexed-candidate";
import {
  assertDeepV2TradeRuntime,
  resolveManifestGatedDeepV2TradeBoundary,
  type DeepV2TradeCandidate,
  type DeepV2TradeRelease,
} from "./deep-v2";
import {
  assertDeepV3TradeRuntime,
  buildDeepV3ExactPoolRoute,
  resolveDeepV3TradeBoundary,
  resolveManifestGatedDeepV3TradeBoundary,
  type DeepV3TradeRuntimeClient,
} from "./deep-v3";
import type {
  DeepV3LaunchProvenance,
  VerifiedDeepV3ReadRelease,
} from "../onchain/deep-v3-read-model";
import type { DeepV3ReleaseManifest } from "../deep-v3-release";

const UINT128_MAX = (1n << 128n) - 1n;
const REQUEST_FIELDS = new Set([
  "chainId",
  "owner",
  "token",
  "side",
  "amountIn",
  "slippageBps",
  "deadline",
]);

export type ClassicTradeRelease = ClassicTradeDeployment & {
  launchModel: "classic" | "deep";
  poolManagerRuntimeCodeHash: Hex;
  v4QuoterRuntimeCodeHash: Hex;
  universalRouterRuntimeCodeHash: Hex;
  permit2RuntimeCodeHash: Hex;
  hookRuntimeCodeHash: Hex;
  deepReleaseVersion?:
    | "deep-full-range-v1"
    | "deep-full-range-v2"
    | "deep-full-range-v3";
  deepV2Release?: DeepV2TradeRelease;
  deepV2Candidate?: DeepV2TradeCandidate;
  deepV3Release?: VerifiedDeepV3ReadRelease;
  deepV3Candidate?: DeepV3LaunchProvenance;
};

type OfficialTradeStack = Omit<
  ClassicTradeRelease,
  "launchModel" | "hook" | "hookRuntimeCodeHash"
>;

export type ClassicTradeRequest = {
  chainId: number;
  owner: Address;
  token: Address;
  side: ClassicTradeSide;
  amountIn: bigint;
  slippageBps: number;
  deadline: bigint;
};

export type ClassicTradeRuntimeClient = ClassicQuoteClient &
  DeepV3TradeRuntimeClient & {
  getBlock(): Promise<{ timestamp: bigint }>;
  getBalance(args: { address: Address }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  estimateGas(args: {
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
  }): Promise<bigint>;
};

export class ClassicTradeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassicTradeUnavailableError";
  }
}

function requestAddress(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new ClassicTradeInputError(`${label} must be an address`);
  }
  try {
    const address = getAddress(value);
    if (address.toLowerCase() === NATIVE_ETH.toLowerCase()) {
      throw new Error("zero");
    }
    return address;
  } catch {
    throw new ClassicTradeInputError(
      `${label} must be a non-zero Ethereum address`,
    );
  }
}

function baseUnitInteger(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !/^[1-9]\d*$/.test(value)
  ) {
    throw new ClassicTradeInputError(
      `${label} must be a positive base-unit integer string`,
    );
  }
  const parsed = BigInt(value);
  if (parsed > UINT128_MAX) {
    throw new ClassicTradeInputError(
      `${label} exceeds the supported uint128 limit`,
    );
  }
  return parsed;
}

export function parseClassicTradeRequest(
  input: unknown,
): ClassicTradeRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ClassicTradeInputError("The trade request is missing");
  }
  const raw = input as Record<string, unknown>;
  const unsupported = Object.keys(raw).find(
    (field) => !REQUEST_FIELDS.has(field),
  );
  if (unsupported) {
    throw new ClassicTradeInputError(
      `The trade request contains unsupported field ${unsupported}`,
    );
  }
  if (!Number.isSafeInteger(raw.chainId) || Number(raw.chainId) <= 0) {
    throw new ClassicTradeInputError("Chain ID must be a positive integer");
  }
  if (raw.side !== "buy" && raw.side !== "sell") {
    throw new ClassicTradeInputError("Trade side must be buy or sell");
  }
  if (
    !Number.isInteger(raw.slippageBps) ||
    Number(raw.slippageBps) < 1 ||
    Number(raw.slippageBps) > MAX_TRADE_SLIPPAGE_BPS
  ) {
    throw new ClassicTradeInputError(
      "Slippage must be an integer from 1 to 1000 basis points",
    );
  }

  return {
    chainId: Number(raw.chainId),
    owner: requestAddress(raw.owner, "Wallet"),
    token: requestAddress(raw.token, "Token"),
    side: raw.side,
    amountIn: baseUnitInteger(raw.amountIn, "Input amount"),
    slippageBps: Number(raw.slippageBps),
    deadline: baseUnitInteger(raw.deadline, "Deadline"),
  };
}

export function getPinnedOfficialTradeStack(
  chainId: number,
): OfficialTradeStack {
  const snapshot =
    chainId === 1
      ? mainnetDeployments
      : chainId === 11155111
        ? sepoliaDeployments
        : null;
  if (!snapshot) {
    throw new ClassicTradeUnavailableError(
      `Classic trading is not supported on chain ${chainId}`,
    );
  }
  if (snapshot.chainId !== chainId) {
    throw new ClassicTradeUnavailableError(
      "The pinned Uniswap deployment snapshot has the wrong chain ID",
    );
  }

  return {
    chainId,
    poolManager: getAddress(snapshot.contracts.poolManager.address),
    v4Quoter: getAddress(snapshot.contracts.v4Quoter.address),
    universalRouter: getAddress(
      snapshot.contracts.universalRouter.address,
    ),
    universalRouterVersion: "2.0",
    permit2: getAddress(snapshot.contracts.permit2.address),
    poolManagerRuntimeCodeHash:
      snapshot.contracts.poolManager.runtimeCodeHash as Hex,
    v4QuoterRuntimeCodeHash:
      snapshot.contracts.v4Quoter.runtimeCodeHash as Hex,
    universalRouterRuntimeCodeHash:
      snapshot.contracts.universalRouter.runtimeCodeHash as Hex,
    permit2RuntimeCodeHash:
      snapshot.contracts.permit2.runtimeCodeHash as Hex,
  };
}

export function resolveClassicTradeDeployment(
  chainId: number,
): ClassicTradeRelease {
  const official = getPinnedOfficialTradeStack(chainId);
  const app =
    chainId === 1
      ? appDeployments.production
      : chainId === 11155111
        ? appDeployments.rehearsal
        : null;
  if (!app || app.chainId !== chainId) {
    throw new ClassicTradeUnavailableError(
      `Classic trading is not configured on chain ${chainId}`,
    );
  }
  if (
    app.status !== "ready" ||
    app.memeLaunchStatus !== "ready" ||
    !app.ethCreatorFeeHook
  ) {
    throw new ClassicTradeUnavailableError(
      `Classic trading is not deployed on chain ${chainId}`,
    );
  }

  const hookRuntimeCodeHash = app.runtimeCodeHashes?.ethCreatorFeeHook;
  if (
    typeof hookRuntimeCodeHash !== "string" ||
    !isHex(hookRuntimeCodeHash) ||
    hookRuntimeCodeHash.length !== 66
  ) {
    throw new ClassicTradeUnavailableError(
      `Classic trading has no pinned hook runtime code on chain ${chainId}`,
    );
  }

  const deployment: ClassicTradeRelease = {
    ...official,
    launchModel: "classic",
    hook: getAddress(app.ethCreatorFeeHook),
    hookRuntimeCodeHash,
  };
  assertClassicTradeDeployment(deployment);
  return deployment;
}

export function resolveClassicV3TradeDeployment(
  chainId: number,
): ClassicTradeRelease {
  const official = getPinnedOfficialTradeStack(chainId);
  const environment =
    chainId === 1
      ? "production"
      : chainId === 11_155_111
        ? "rehearsal"
        : null;
  if (!environment) {
    throw new ClassicTradeUnavailableError(
      `Classic V3 trading is not supported on chain ${chainId}`,
    );
  }
  const { appManifest, releaseManifest } =
    getConfiguredClassicV3Release(environment);
  if (!isClassicV3ReleaseVerified(appManifest, releaseManifest, chainId)) {
    throw new ClassicTradeUnavailableError(
      `Classic V3 trading has no verified release on chain ${chainId}`,
    );
  }
  const hookRuntimeCodeHash =
    appManifest.runtimeCodeHashes?.ethCreatorFeeHookV3;
  if (
    typeof appManifest.ethCreatorFeeHookV3 !== "string" ||
    typeof hookRuntimeCodeHash !== "string" ||
    !isHex(hookRuntimeCodeHash) ||
    hookRuntimeCodeHash.length !== 66
  ) {
    throw new ClassicTradeUnavailableError(
      `Classic V3 trading has no pinned hook release on chain ${chainId}`,
    );
  }
  const deployment: ClassicTradeRelease = {
    ...official,
    launchModel: "classic",
    hook: getAddress(appManifest.ethCreatorFeeHookV3),
    hookRuntimeCodeHash,
  };
  assertClassicTradeDeployment(deployment);
  return deployment;
}

export function resolveClassicV4TradeDeployment(
  chainId: number,
): ClassicTradeRelease {
  if (chainId !== 1) {
    throw new ClassicTradeUnavailableError(
      `Classic V4 trading is not supported on chain ${chainId}`,
    );
  }
  const release = getConfiguredClassicV4PublicRelease("production");
  if (
    !isClassicV4PublicActionRelease(release) ||
    release.chainId !== chainId ||
    release.model !== "classic" ||
    release.internalContractRelease !== "classic-v4" ||
    release.verification.deploymentLive !== true ||
    release.verification.deploymentFinalized !== true ||
    release.verification.runtimeCodeVerified !== true ||
    release.verification.constructorBindingsVerified !== true ||
    release.verification.sourceVerified !== true ||
    release.verification.lifecycleVerified !== true ||
    release.verification.indexerActivated !== true
  ) {
    throw new ClassicTradeUnavailableError(
      `Classic V4 trading has no verified public release on chain ${chainId}`,
    );
  }

  const dependencies = release.officialDependencies;
  const deployment: ClassicTradeRelease = {
    chainId: release.chainId,
    launchModel: "classic",
    poolManager: dependencies.poolManager.address,
    v4Quoter: dependencies.v4Quoter.address,
    universalRouter: dependencies.universalRouter.address,
    universalRouterVersion: "2.0",
    permit2: dependencies.permit2.address,
    hook: release.addresses.feeHook,
    poolManagerRuntimeCodeHash:
      dependencies.poolManager.runtimeCodeHash,
    v4QuoterRuntimeCodeHash: dependencies.v4Quoter.runtimeCodeHash,
    universalRouterRuntimeCodeHash:
      dependencies.universalRouter.runtimeCodeHash,
    permit2RuntimeCodeHash: dependencies.permit2.runtimeCodeHash,
    hookRuntimeCodeHash: release.runtimeCodeHashes.feeHook,
  };
  assertClassicTradeDeployment(deployment);
  return deployment;
}

function verifiedIndexedToken(
  model: ExploreReadModel,
  chainId: number,
  token: Address,
): LauncherToken {
  if (
    model.status !== "ready" ||
    model.snapshot.chainId !== chainId
  ) {
    throw new ClassicTradeUnavailableError(
      "The verified Programmable launch registry is unavailable",
    );
  }
  const verified = model.tokens.find(
    (candidate) =>
      candidate.tokenAddress.toLowerCase() === token.toLowerCase(),
  );
  if (!verified || verified.liquidityPath !== "meme") {
    throw new ClassicTradeUnavailableError(
      "This token is not a verified Programmable launch",
    );
  }
  return verified;
}

function deepV3CandidateFromIndexedToken(
  token: LauncherToken,
): DeepV3LaunchProvenance {
  const indexed = token.deepV3Provenance;
  if (!indexed) {
    throw new Error("Deep V3 trading requires verified indexed V3 provenance");
  }
  return indexed;
}

export function resolveTradeDeployment(
  chainId: number,
  model: ExploreReadModel,
  token: Address,
  manifestOverride?:
    | LaunchModelReleaseManifest
    | DeepV3ReleaseManifest,
): ClassicTradeRelease {
  const verified = verifiedIndexedToken(model, chainId, token);
  const launchModel = verified.launchModel ?? "classic";
  const indexedDeepV3 = verified.deepV3Provenance;
  const declaresDeepV3 =
    verified.deepReleaseVersion === "deep-full-range-v3" ||
    indexedDeepV3 !== undefined;
  if (declaresDeepV3 && launchModel !== "deep") {
    throw new ClassicTradeUnavailableError(
      "Deep V3 provenance cannot use a Classic trade release",
    );
  }
  if (launchModel === "classic") {
    const deployment =
      verified.launchModelVersion === "classic-v4"
        ? resolveClassicV4TradeDeployment(chainId)
        : verified.launchModelVersion === "classic-v3"
          ? resolveClassicV3TradeDeployment(chainId)
          : resolveClassicTradeDeployment(chainId);
    assertVerifiedTradeToken(model, deployment, token);
    return deployment;
  }
  if (launchModel !== "deep") {
    throw new ClassicTradeUnavailableError(
      `Trading is not supported for the verified ${launchModel} launch model`,
    );
  }

  const app =
    manifestOverride ??
    (chainId === 1
      ? appDeployments.production
      : chainId === 11155111
        ? appDeployments.rehearsal
        : null);
  if (!app) {
    getPinnedOfficialTradeStack(chainId);
    throw new ClassicTradeUnavailableError(
      `Deep trading is not configured on chain ${chainId}`,
    );
  }

  if (declaresDeepV3) {
    try {
      if (
        verified.deepReleaseVersion !== "deep-full-range-v3" ||
        !indexedDeepV3 ||
        verified.deepV2Provenance
      ) {
        throw new Error(
          "Deep V3 trading requires one unambiguous indexed V3 provenance record",
        );
      }
      const boundary = resolveManifestGatedDeepV3TradeBoundary({
        manifest:
          manifestOverride === undefined
            ? mainnetDeepV3Manifest
            : manifestOverride,
        chainId,
        candidate: deepV3CandidateFromIndexedToken(verified),
      });
      const dependencies = boundary.release.officialDependencies;
      const deployment: ClassicTradeRelease = {
        chainId: boundary.release.chainId,
        launchModel: "deep",
        poolManager: dependencies.poolManager.address,
        v4Quoter: dependencies.v4Quoter.address,
        universalRouter: dependencies.universalRouter.address,
        universalRouterVersion: "2.0",
        permit2: dependencies.permit2.address,
        hook: boundary.release.addresses.feeHook,
        poolManagerRuntimeCodeHash:
          dependencies.poolManager.runtimeCodeHash,
        v4QuoterRuntimeCodeHash:
          dependencies.v4Quoter.runtimeCodeHash,
        universalRouterRuntimeCodeHash:
          dependencies.universalRouter.runtimeCodeHash,
        permit2RuntimeCodeHash: dependencies.permit2.runtimeCodeHash,
        hookRuntimeCodeHash:
          boundary.release.runtimeCodeHashes.feeHook,
        deepReleaseVersion: "deep-full-range-v3",
        deepV3Release: boundary.release,
        deepV3Candidate: boundary.candidate,
      };
      assertClassicTradeDeployment(deployment);
      assertVerifiedTradeToken(model, deployment, token);
      return deployment;
    } catch (error) {
      throw new ClassicTradeUnavailableError(
        error instanceof Error
          ? `Deep V3 provenance is not eligible for trading: ${error.message}`
          : "Deep V3 provenance is not eligible for trading",
      );
    }
  }

  if (verified.deepV2Provenance) {
    try {
      const indexed = requireDeepV2IndexedCandidate(verified);
      const candidate: DeepV2TradeCandidate = {
        deepReleaseVersion: "deep-full-range-v2",
        launchModel: "deep",
        launcher: indexed.launcher,
        tokenAddress: indexed.tokenAddress,
        hookAddress: indexed.hookAddress,
        poolId: indexed.poolId,
      };
      const official = getPinnedOfficialTradeStack(chainId);
      const boundary = resolveManifestGatedDeepV2TradeBoundary({
        manifest: app as LaunchModelReleaseManifest,
        chainId,
        candidate,
        official: {
          chainId: official.chainId as 1 | 11_155_111,
          poolManager: official.poolManager,
          poolManagerRuntimeCodeHash:
            official.poolManagerRuntimeCodeHash,
        },
      });
      const deployment: ClassicTradeRelease = {
        ...official,
        launchModel: "deep",
        hook: boundary.release.feeHook,
        hookRuntimeCodeHash:
          boundary.release.feeHookRuntimeCodeHash,
        deepReleaseVersion: "deep-full-range-v2",
        deepV2Release: boundary.release,
        deepV2Candidate: boundary.candidate,
      };
      assertClassicTradeDeployment(deployment);
      assertVerifiedTradeToken(model, deployment, token);
      return deployment;
    } catch (error) {
      throw new ClassicTradeUnavailableError(
        error instanceof Error
          ? `Deep V2 provenance is not eligible for trading: ${error.message}`
          : "Deep V2 provenance is not eligible for trading",
      );
    }
  }
  if (
    getVerifiedDeepV2Release(
      app as LaunchModelReleaseManifest,
      chainId,
    )
  ) {
    throw new ClassicTradeUnavailableError(
      "Deep V2 trading requires verified indexed V2 provenance",
    );
  }

  const release = getVerifiedDeepRelease(
    app as LaunchModelReleaseManifest,
    chainId,
  );
  if (!release) {
    throw new ClassicTradeUnavailableError(
      `Deep trading is not enabled by an eligible verified release on chain ${chainId}`,
    );
  }
  const hookRuntimeCodeHash = release.runtimeCodeHashes?.feeHook;
  if (
    typeof release.feeHook !== "string" ||
    typeof hookRuntimeCodeHash !== "string" ||
    !isHex(hookRuntimeCodeHash) ||
    hookRuntimeCodeHash.length !== 66
  ) {
    throw new ClassicTradeUnavailableError(
      `Deep trading has no pinned hook release on chain ${chainId}`,
    );
  }

  let hook: Address;
  try {
    hook = getAddress(release.feeHook);
  } catch {
    throw new ClassicTradeUnavailableError(
      `Deep trading has no pinned hook release on chain ${chainId}`,
    );
  }
  const deployment: ClassicTradeRelease = {
    ...getPinnedOfficialTradeStack(chainId),
    launchModel: "deep",
    hook,
    hookRuntimeCodeHash: hookRuntimeCodeHash as Hex,
    deepReleaseVersion: "deep-full-range-v1",
  };
  assertClassicTradeDeployment(deployment);
  assertVerifiedTradeToken(model, deployment, token);
  return deployment;
}

async function assertRuntimeContracts(
  client: ClassicTradeRuntimeClient,
  deployment: ClassicTradeRelease,
  token: Address,
) {
  const actualChainId = await client.getChainId();
  if (actualChainId !== deployment.chainId) {
    throw new ClassicTradeInputError(
      `RPC chain ${actualChainId} does not match deployment chain ${deployment.chainId}`,
    );
  }

  const contracts = [
    [
      "PoolManager",
      deployment.poolManager,
      deployment.poolManagerRuntimeCodeHash,
    ],
    [
      "V4Quoter",
      deployment.v4Quoter,
      deployment.v4QuoterRuntimeCodeHash,
    ],
    [
      "Universal Router",
      deployment.universalRouter,
      deployment.universalRouterRuntimeCodeHash,
    ],
    ["Permit2", deployment.permit2, deployment.permit2RuntimeCodeHash],
    [
      deployment.launchModel === "deep" ? "Deep hook" : "Classic hook",
      deployment.hook,
      deployment.hookRuntimeCodeHash,
    ],
  ] as const;
  const code = await Promise.all(
    [...contracts, ["Token", token] as const].map(([, address]) =>
      client.getCode({ address }),
    ),
  );
  for (let index = 0; index < contracts.length; index += 1) {
    const contract = contracts[index];
    const runtimeCode = code[index];
    if (!runtimeCode || runtimeCode === "0x") {
      throw new ClassicTradeUnavailableError(
        `${contract[0]} code is missing at the pinned address`,
      );
    }
    if (
      keccak256(runtimeCode).toLowerCase() !==
      contract[2].toLowerCase()
    ) {
      throw new ClassicTradeUnavailableError(
        `${contract[0]} runtime code does not match the pinned release`,
      );
    }
  }
  if (!code[contracts.length] || code[contracts.length] === "0x") {
    throw new ClassicTradeUnavailableError(
      "Token code is missing at the verified launch address",
    );
  }
}

export function assertVerifiedTradeToken(
  model: ExploreReadModel,
  deployment: ClassicTradeRelease,
  token: Address,
) {
  const verified = verifiedIndexedToken(
    model,
    deployment.chainId,
    token,
  );
  const launchModel = verified.launchModel ?? "classic";
  if (
    (verified.deepV3Provenance ||
      verified.deepReleaseVersion === "deep-full-range-v3") &&
    deployment.deepReleaseVersion !== "deep-full-range-v3"
  ) {
    throw new ClassicTradeUnavailableError(
      "A Deep V3 token cannot use another trade release",
    );
  }
  if (launchModel !== deployment.launchModel) {
    throw new ClassicTradeUnavailableError(
      "The token launch model does not match the selected trade release",
    );
  }
  if (deployment.launchModel === "deep") {
    const indexedDeepV3 = verified.deepV3Provenance;
    if (deployment.deepReleaseVersion === "deep-full-range-v3") {
      if (
        !deployment.deepV3Candidate ||
        !deployment.deepV3Release ||
        verified.deepReleaseVersion !== "deep-full-range-v3" ||
        verified.deepV2Provenance
      ) {
        throw new ClassicTradeUnavailableError(
          "The Deep V3 trade release is incomplete or ambiguous",
        );
      }
      let indexed;
      try {
        indexed = resolveDeepV3TradeBoundary(
          deepV3CandidateFromIndexedToken(verified),
          deployment.deepV3Release,
        ).candidate;
      } catch (error) {
        throw new ClassicTradeUnavailableError(
          error instanceof Error
            ? `Deep V3 provenance is invalid: ${error.message}`
            : "Deep V3 provenance is invalid",
        );
      }
      const selected = deployment.deepV3Candidate;
      if (
        indexed.launcher.toLowerCase() !==
          selected.launcher.toLowerCase() ||
        indexed.creator.toLowerCase() !==
          selected.creator.toLowerCase() ||
        indexed.tokenAddress.toLowerCase() !==
          selected.tokenAddress.toLowerCase() ||
        indexed.vaultAddress.toLowerCase() !==
          selected.vaultAddress.toLowerCase() ||
        indexed.hookAddress.toLowerCase() !==
          selected.hookAddress.toLowerCase() ||
        indexed.positionRecipient.toLowerCase() !==
          selected.positionRecipient.toLowerCase() ||
        indexed.positionTokenId !== selected.positionTokenId ||
        indexed.poolId.toLowerCase() !== selected.poolId.toLowerCase() ||
        indexed.launchHash.toLowerCase() !==
          selected.launchHash.toLowerCase() ||
        indexed.vaultConfigurationHash.toLowerCase() !==
          selected.vaultConfigurationHash.toLowerCase() ||
        indexed.blockNumber !== selected.blockNumber ||
        indexed.blockHash.toLowerCase() !==
          selected.blockHash.toLowerCase() ||
        indexed.transactionHash.toLowerCase() !==
          selected.transactionHash.toLowerCase() ||
        indexed.transactionIndex !== selected.transactionIndex ||
        indexed.logIndex !== selected.logIndex
      ) {
        throw new ClassicTradeUnavailableError(
          "The Deep V3 token does not match its selected verified release",
        );
      }
    } else if (
      indexedDeepV3 ||
      verified.deepReleaseVersion === "deep-full-range-v3"
    ) {
      throw new ClassicTradeUnavailableError(
        "A Deep V3 token cannot use a historical Deep trade release",
      );
    } else if (deployment.deepReleaseVersion === "deep-full-range-v2") {
      let indexed;
      try {
        indexed = requireDeepV2IndexedCandidate(verified);
      } catch (error) {
        throw new ClassicTradeUnavailableError(
          error instanceof Error
            ? `Deep V2 provenance is invalid: ${error.message}`
            : "Deep V2 provenance is invalid",
        );
      }
      if (
        !deployment.deepV2Candidate ||
        !deployment.deepV2Release ||
        indexed.launcher.toLowerCase() !==
          deployment.deepV2Candidate.launcher.toLowerCase() ||
        indexed.tokenAddress.toLowerCase() !==
          deployment.deepV2Candidate.tokenAddress.toLowerCase() ||
        indexed.hookAddress.toLowerCase() !==
          deployment.deepV2Candidate.hookAddress.toLowerCase() ||
        indexed.poolId.toLowerCase() !==
          deployment.deepV2Candidate.poolId.toLowerCase()
      ) {
        throw new ClassicTradeUnavailableError(
          "The Deep V2 token does not match its selected verified release",
        );
      }
    } else if (verified.deepV2Provenance) {
      throw new ClassicTradeUnavailableError(
        "A Deep V2 token cannot use the historical Deep V1 trade release",
      );
    }
  }
  const expectedPoolId = getClassicPoolId(
    createClassicPoolKey(token, deployment),
    deployment,
  );
  if (
    verified.hookAddress.toLowerCase() !==
      deployment.hook.toLowerCase() ||
    verified.poolId.toLowerCase() !== expectedPoolId.toLowerCase()
  ) {
    throw new ClassicTradeUnavailableError(
      "The token does not match its verified Programmable pool",
    );
  }
  return verified;
}

export const assertVerifiedClassicToken = assertVerifiedTradeToken;

async function requiredCall(
  client: ClassicTradeRuntimeClient,
  args: { to: Address; data: Hex; account?: Address },
  label: string,
) {
  const result = await client.call(args);
  if (!result.data || result.data === "0x") {
    throw new Error(`${label} returned no data`);
  }
  return result.data;
}

async function readSellAllowances(
  client: ClassicTradeRuntimeClient,
  deployment: ClassicTradeDeployment,
  owner: Address,
  token: Address,
) {
  const [tokenData, permit2Data] = await Promise.all([
    requiredCall(
      client,
      {
        to: token,
        data: encodeFunctionData({
          abi: classicTokenAbi,
          functionName: "allowance",
          args: [owner, deployment.permit2],
        }),
        account: owner,
      },
      "Token allowance",
    ),
    requiredCall(
      client,
      {
        to: deployment.permit2,
        data: encodeFunctionData({
          abi: classicPermit2Abi,
          functionName: "allowance",
          args: [owner, token, deployment.universalRouter],
        }),
        account: owner,
      },
      "Permit2 allowance",
    ),
  ]);

  const tokenAllowance = decodeFunctionResult({
    abi: classicTokenAbi,
    functionName: "allowance",
    data: tokenData,
  });
  const [permit2Allowance, permit2Expiration] =
    decodeFunctionResult({
      abi: classicPermit2Abi,
      functionName: "allowance",
      data: permit2Data,
    });

  return {
    tokenAllowance,
    permit2Allowance,
    permit2Expiration: BigInt(permit2Expiration),
  };
}

async function readTokenBalance(
  client: ClassicTradeRuntimeClient,
  owner: Address,
  token: Address,
) {
  const data = await requiredCall(
    client,
    {
      to: token,
      data: encodeFunctionData({
        abi: classicTokenAbi,
        functionName: "balanceOf",
        args: [owner],
      }),
      account: owner,
    },
    "Token balance",
  );
  return decodeFunctionResult({
    abi: classicTokenAbi,
    functionName: "balanceOf",
    data,
  });
}

function walletTransaction(transaction: {
  kind: "swap" | "token-to-permit2" | "permit2-to-router";
  chainId: number;
  to: Address;
  data: Hex;
  value: string;
}) {
  return {
    kind: transaction.kind,
    chainId: transaction.chainId,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  };
}

async function simulatedSwapTransaction(
  client: ClassicTradeRuntimeClient,
  owner: Address,
  nativeBalance: bigint,
  side: ClassicTradeSide,
  transaction: {
    kind: "swap";
    chainId: number;
    to: Address;
    data: Hex;
    value: string;
  },
) {
  const value = BigInt(transaction.value);
  const request = {
    account: owner,
    to: transaction.to,
    data: transaction.data,
    value,
  };
  await client.call(request);
  const [estimatedGas, gasPrice] = await Promise.all([
    client.estimateGas(request),
    client.getGasPrice(),
  ]);
  if (estimatedGas <= 0n) {
    throw new ClassicTradeUnavailableError(
      "The prepared swap returned an invalid gas estimate",
    );
  }
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  if (gasPrice <= 0n) {
    throw new ClassicTradeUnavailableError(
      "The network returned an invalid gas price",
    );
  }
  if (side === "buy") {
    const maximumAmountIn = maximumClassicBuyAmount({
      nativeBalance,
      gasLimit,
      gasPrice,
    });
    if (value > maximumAmountIn) {
      throw new ClassicTradeInputError(
        "Enter a smaller ETH amount so the wallet keeps enough ETH for this buy and a later sell",
      );
    }
  } else {
    const reserve = classicGasReserve({ gasLimit, gasPrice });
    if (nativeBalance < reserve) {
      throw new ClassicTradeInputError(
        "The wallet needs more ETH to pay for the sell transaction",
      );
    }
  }
  return {
    ...walletTransaction(transaction),
    gasLimit: gasLimit.toString(),
  };
}

export async function prepareClassicTrade(
  client: ClassicTradeRuntimeClient,
  deployment: ClassicTradeRelease,
  request: ClassicTradeRequest,
  registry: ExploreReadModel,
) {
  assertClassicTradeDeployment(deployment);
  if (request.chainId !== deployment.chainId) {
    throw new ClassicTradeInputError(
      `Request chain ${request.chainId} does not match deployment chain ${deployment.chainId}`,
    );
  }

  let poolKey = createClassicPoolKey(request.token, deployment);
  const verifiedToken = assertVerifiedTradeToken(
    registry,
    deployment,
    poolKey.currency1,
  );
  if (deployment.deepReleaseVersion === "deep-full-range-v3") {
    if (registry.status !== "ready") {
      throw new ClassicTradeUnavailableError(
        "The verified Programmable launch registry is unavailable",
      );
    }
    if (!deployment.deepV3Release || !deployment.deepV3Candidate) {
      throw new ClassicTradeUnavailableError(
        "The Deep V3 trade release is incomplete",
      );
    }
    try {
      const boundary = resolveDeepV3TradeBoundary(
        deployment.deepV3Candidate,
        deployment.deepV3Release,
      );
      const route = buildDeepV3ExactPoolRoute(boundary, request.side);
      const computedPoolId = getClassicPoolId(
        route.poolKey,
        deployment,
      );
      if (
        computedPoolId.toLowerCase() !== route.poolId.toLowerCase() ||
        route.poolId.toLowerCase() !== verifiedToken.poolId.toLowerCase()
      ) {
        throw new Error(
          "Deep V3 trading is not bound to the original PoolId",
        );
      }
      poolKey = { ...route.poolKey };
      await assertDeepV3TradeRuntime(
        client,
        deployment.deepV3Release,
        deployment.deepV3Candidate,
        BigInt(registry.snapshot.blockNumber),
      );
    } catch (error) {
      throw new ClassicTradeUnavailableError(
        error instanceof Error
          ? error.message
          : "The Deep V3 runtime is unavailable",
      );
    }
  } else if (deployment.deepReleaseVersion === "deep-full-range-v2") {
    if (!deployment.deepV2Release || !deployment.deepV2Candidate) {
      throw new ClassicTradeUnavailableError(
        "The Deep V2 trade release is incomplete",
      );
    }
    try {
      await assertDeepV2TradeRuntime(
        client,
        deployment.deepV2Release,
        deployment.deepV2Candidate,
      );
    } catch (error) {
      throw new ClassicTradeUnavailableError(
        error instanceof Error
          ? error.message
          : "The Deep V2 runtime is unavailable",
      );
    }
  }
  await assertRuntimeContracts(
    client,
    deployment,
    poolKey.currency1,
  );
  const nativeBalance = await client.getBalance({
    address: request.owner,
  });
  if (nativeBalance < 0n) {
    throw new ClassicTradeUnavailableError(
      "The network returned an invalid wallet ETH balance",
    );
  }
  if (request.side === "buy" && request.amountIn > nativeBalance) {
    throw new ClassicTradeInputError(
      "The buy amount exceeds the wallet ETH balance",
    );
  }
  if (request.side === "sell") {
    const tokenBalance = await readTokenBalance(
      client,
      request.owner,
      poolKey.currency1,
    );
    if (request.amountIn > tokenBalance) {
      throw new ClassicTradeInputError(
        "The sell amount exceeds the wallet token balance",
      );
    }
  }
  const block = await client.getBlock();
  if (verifiedToken.launchModelVersion === "classic-v4") {
    assertClassicV4Deadline(block.timestamp, request.deadline);
  } else {
    assertClassicDeadline(block.timestamp, request.deadline);
  }

  const quoted = await quoteClassicExactInput(client, {
    deployment,
    poolKey,
    owner: request.owner,
    side: request.side,
    amountIn: request.amountIn,
  });
  const minimum = amountOutMinimum(
    quoted.amountOut,
    request.slippageBps,
  );
  const quote = {
    amountIn: request.amountIn.toString(),
    amountOut: quoted.amountOut.toString(),
    amountOutMinimum: minimum.toString(),
    gasEstimate: quoted.gasEstimate.toString(),
    slippageBps: request.slippageBps,
    deadline: request.deadline.toString(),
  };

  if (request.side === "sell") {
    const allowances = await readSellAllowances(
      client,
      deployment,
      request.owner,
      poolKey.currency1,
    );
    const approvalState = getClassicSellApprovalState({
      amountIn: request.amountIn,
      ...allowances,
      now: block.timestamp,
    });
    if (approvalState === "token-to-permit2") {
      return {
        status: "approval-required" as const,
        chainId: deployment.chainId,
        owner: request.owner,
        token: poolKey.currency1,
        side: request.side,
        poolKey,
        quote,
        approvalState,
        transaction: walletTransaction(
          buildClassicTokenApprovalTransaction({
            deployment,
            token: poolKey.currency1,
            amountIn: request.amountIn,
          }),
        ),
      };
    }
    if (approvalState === "permit2-to-router") {
      return {
        status: "approval-required" as const,
        chainId: deployment.chainId,
        owner: request.owner,
        token: poolKey.currency1,
        side: request.side,
        poolKey,
        quote,
        approvalState,
        transaction: walletTransaction(
          buildClassicPermit2ApprovalTransaction({
            deployment,
            token: poolKey.currency1,
            amountIn: request.amountIn,
            now: block.timestamp,
            deadline: request.deadline,
          }),
        ),
      };
    }

    return {
      status: "ready" as const,
      chainId: deployment.chainId,
      owner: request.owner,
      token: poolKey.currency1,
      side: request.side,
      poolKey,
      quote,
      approvalState,
      transaction: await simulatedSwapTransaction(
        client,
        request.owner,
        nativeBalance,
        request.side,
        buildClassicSwapTransaction({
          deployment,
          poolKey,
          side: request.side,
          amountIn: request.amountIn,
          quotedAmountOut: quoted.amountOut,
          slippageBps: request.slippageBps,
          now: block.timestamp,
          deadline: request.deadline,
        }),
      ),
    };
  }

  return {
    status: "ready" as const,
    chainId: deployment.chainId,
    owner: request.owner,
    token: poolKey.currency1,
    side: request.side,
    poolKey,
    quote,
    transaction: await simulatedSwapTransaction(
      client,
      request.owner,
      nativeBalance,
      request.side,
      buildClassicSwapTransaction({
        deployment,
        poolKey,
        side: request.side,
        amountIn: request.amountIn,
        quotedAmountOut: quoted.amountOut,
        slippageBps: request.slippageBps,
        now: block.timestamp,
        deadline: request.deadline,
      }),
    ),
  };
}
