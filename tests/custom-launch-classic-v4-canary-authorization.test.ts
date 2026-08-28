import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";

vi.mock("server-only", () => ({}));
// The production factory has no runtime-hash override. This module-only test
// fixture supplies a short bytecode preimage so the full replay can be tested.
vi.mock("../lib/classic-v4", () => ({
  CLASSIC_V4_LAUNCH_STAMP_ROUTER:
    "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
  CLASSIC_V4_LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH:
    "0xaa53892a9b709bf03acecc31d77738a3e8080ab933ff55af15b4d8231635ae3f",
}));

import {
  CLASSIC_LAUNCH_AUTHORIZATION_SCHEMA_V1,
  ClassicLaunchAuthorizationBridgeErrorV1,
} from "../lib/server/custom-launch/classic-launch-authorization-bridge-v1";
import {
  CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1,
  CLASSIC_V4_CANARY_AUTHORIZATION_DOWNLOAD_SCHEMA_V1,
  CLASSIC_V4_CANARY_AUTHORIZATION_ENABLED_ENV,
  CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_BASE64URL_ENV,
  CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_DIGEST_ENV,
  createClassicV4CanaryAuthorizationHandlerV1,
  createProductionClassicV4CanaryAuthorizationReplayV1,
  getProductionClassicV4CanaryAuthorizationHandlerV1,
  isClassicV4CanaryAuthorizationLaneEnabledV1,
  loadAvailableClassicV4CanaryAuthorizationRequestV1,
  loadInstalledClassicV4CanaryAuthorizationRequestV1,
  validateClassicV4CanaryAuthorizationAgainstInstalledRequestV1,
} from "../lib/server/custom-launch/classic-v4-canary-authorization-v1";
import { productionMainnetRpcEnvironment } from
  "../lib/onchain/website-rpc-providers.server";
import { canonicalizeJson } from
  "../lib/server/projection-target/canonical-json";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const OTHER_WALLET = "0x2222222222222222222222222222222222222222" as Address;
const LAUNCHER = "0x3333333333333333333333333333333333333333" as Address;
const OTHER_LAUNCHER = "0x9999999999999999999999999999999999999999" as Address;
const FEE_HOOK = "0x4444444444444444444444444444444444444444" as Address;
const TOKEN = "0x1000000000000000000000000000000000000001" as Address;
const REWARD_VAULT = "0x2000000000000000000000000000000000000001" as Address;
const POSITION_RECIPIENT =
  "0x3000000000000000000000000000000000000001" as Address;
const ROUTER = "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56" as Address;
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90" as Address;
const HASH_A = `0x${"11".repeat(32)}` as Hex;
const HASH_B = `0x${"22".repeat(32)}` as Hex;
const HASH_C = `0x${"33".repeat(32)}` as Hex;
const HASH_D = `0x${"44".repeat(32)}` as Hex;
const HASH_E = `0x${"55".repeat(32)}` as Hex;
const HASH_F = `0x${"66".repeat(32)}` as Hex;
const HASH_G = `0x${"77".repeat(32)}` as Hex;
const HASH_H = `0x${"88".repeat(32)}` as Hex;
const HASH_I = `0x${"99".repeat(32)}` as Hex;
const VALUE_WEI = "600000000000000";
const TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;
const TEST_ROUTER_RUNTIME_CODE = "0x600001" as Hex;
const ASSUMED_RPC_ACCEPTED_SIGNATURE = concat([
  toHex(2n, { size: 32 }),
  toHex(3n, { size: 32 }),
  "0x1b",
]);
const FORGED_SIGNATURE = concat([
  toHex(1n, { size: 32 }),
  toHex(1n, { size: 32 }),
  "0x1b",
]);

const launcherAbi = parseAbi([
  "function launchFor(address launchWallet,(string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters) payable returns ((address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash) result)",
]);
const routerAbi = parseAbi([
  "function launchAndStampV1((uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value) permit,(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bytes32 hookRuntimeCodeHash,(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)[] components) stampRequest,bytes routePayload,bytes signature) payable returns (bytes32 stampHash)",
]);
const routeParameters = parseAbiParameters(
  "(address launcher,bytes32 launcherRuntimeCodeHash,(string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters,(address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash) expectedResult) route",
);
const permitTypes = {
  ProgrammableLaunchPermitV1: [
    { name: "chainId", type: "uint256" },
    { name: "router", type: "address" },
    { name: "launchWallet", type: "address" },
    { name: "kind", type: "uint8" },
    { name: "routePayloadHash", type: "bytes32" },
    { name: "expectedResultHash", type: "bytes32" },
    { name: "stampRequestHash", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
    { name: "validAfter", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "value", type: "uint256" },
  ],
} as const;
const resultAddressesTypehash = keccak256(stringToHex(
  "ProgrammableClassicResultAddressesV1(address token,address rewardVault,address positionRecipient,address initialBuyCustody)",
));
const resultAmountsTypehash = keccak256(stringToHex(
  "ProgrammableClassicResultAmountsV1(uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount)",
));
const resultTypehash = keccak256(stringToHex(
  "ProgrammableClassicLaunchResultV1(bytes32 addressesHash,bytes32 amountsHash,bytes32 poolId,bytes32 launchHash)",
));
const componentTypehash = keccak256(stringToHex(
  "ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)",
));
const poolKeyTypehash = keccak256(stringToHex(
  "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
));
const stampRequestTypehash = keccak256(stringToHex(
  "ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)",
));
const launchStampTypehash = keccak256(stringToHex(
  "ProgrammableLaunchStampV1(uint256 chainId,address router,bytes32 launchId,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 permitDigest,address poolManager,bytes32 poolId)",
));

type PoolKey = Readonly<{
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}>;

type Component = Readonly<{
  resultIndex: number;
  account: Address;
  runtimeCodeHash: Hex;
  kind: number;
  scope: number;
}>;

type ExpectedResult = Readonly<{
  token: Address;
  rewardVault: Address;
  positionRecipient: Address;
  positionTokenId: bigint;
  tokenLiquidityAmount: bigint;
  lockedTokenDust: bigint;
  initialBuyNativeAmount: bigint;
  initialBuyTokenAmount: bigint;
  initialBuyCustody: Address;
  poolId: Hex;
  launchHash: Hex;
}>;

type FixtureOptions = Readonly<{
  routeLauncher?: Address;
  routeLauncherRuntimeCodeHash?: Hex;
  routeName?: string;
  stampHookRuntimeCodeHash?: Hex;
  componentHookRuntimeCodeHash?: Hex;
  componentHookKind?: number;
  resultPositionTokenId?: bigint;
  resultInitialBuyNativeAmount?: bigint;
  reportedPermitDigest?: Hex;
  reportedStampHash?: Hex;
  predictedToken?: Address;
  transactionFrom?: Address;
  transactionTo?: Address;
  transactionValueWei?: string;
  transactionCalldataSuffix?: Hex;
  gasEstimate?: string;
  gasLimit?: string;
  signature?: Hex;
}>;

function poolId(poolKey: PoolKey) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters(
      "address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks",
    ),
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ],
  ));
}

function poolKeyHash(poolKey: PoolKey) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks",
    ),
    [
      poolKeyTypehash,
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ],
  ));
}

function componentSetHash(components: readonly Component[]) {
  const hashes = components.map((component) => keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope",
    ),
    [
      componentTypehash,
      component.resultIndex,
      component.account,
      component.runtimeCodeHash,
      component.kind,
      component.scope,
    ],
  )));
  return keccak256(concat(hashes as [Hex, ...Hex[]]));
}

function expectedResultHash(result: ExpectedResult) {
  const addressesHash = keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,address token,address rewardVault,address positionRecipient,address initialBuyCustody",
    ),
    [
      resultAddressesTypehash,
      result.token,
      result.rewardVault,
      result.positionRecipient,
      result.initialBuyCustody,
    ],
  ));
  const amountsHash = keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount",
    ),
    [
      resultAmountsTypehash,
      result.positionTokenId,
      result.tokenLiquidityAmount,
      result.lockedTokenDust,
      result.initialBuyNativeAmount,
      result.initialBuyTokenAmount,
    ],
  ));
  return keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,bytes32 addressesHash,bytes32 amountsHash,bytes32 poolId,bytes32 launchHash",
    ),
    [resultTypehash, addressesHash, amountsHash, result.poolId, result.launchHash],
  ));
}

function authorizationFixture(options: FixtureOptions = {}) {
  const parameters = {
    name: options.routeName ?? "Programmable Canary",
    symbol: "PCNY",
    buySwapFeeBps: 80,
    sellSwapFeeBps: 120,
    creatorSalt: HASH_I,
    metadata: {
      description: "Classic V4 lifecycle canary",
      website: "https://programmable.market",
      image: "ipfs://programmable-canary",
      extraData: "0x" as Hex,
    },
    rewardBeneficiaries: [WALLET],
    rewardSharesBps: [10_000],
    initialBuyCustody: { mode: 0, durationDays: 0, cliffDays: 0 },
  } as const;
  const installedParameters = { ...parameters, name: "Programmable Canary" };
  const launcherCalldata = encodeFunctionData({
    abi: launcherAbi,
    functionName: "launchFor",
    args: [WALLET, installedParameters],
  });
  const request = {
    schemaVersion: "programmable.classic-launch-authorization-request.v1",
    chainId: "1",
    launchWallet: WALLET,
    releaseManifestDigest: HASH_A,
    launcher: LAUNCHER,
    launcherRuntimeCodeHash: HASH_B,
    feeHook: FEE_HOOK,
    feeHookRuntimeCodeHash: HASH_C,
    valueWei: VALUE_WEI,
    launcherCalldata,
  } as const;
  const poolKey = {
    currency0: ZERO_ADDRESS,
    currency1: TOKEN,
    fee: 0,
    tickSpacing: 200,
    hooks: FEE_HOOK,
  } as const satisfies PoolKey;
  const result = {
    token: TOKEN,
    rewardVault: REWARD_VAULT,
    positionRecipient: POSITION_RECIPIENT,
    positionTokenId: options.resultPositionTokenId ?? 0n,
    tokenLiquidityAmount: TOKEN_SUPPLY - 123n,
    lockedTokenDust: 123n,
    initialBuyNativeAmount:
      options.resultInitialBuyNativeAmount ?? BigInt(VALUE_WEI),
    initialBuyTokenAmount: 10_000n,
    initialBuyCustody: ZERO_ADDRESS,
    poolId: poolId(poolKey),
    launchHash: HASH_H,
  } as const satisfies ExpectedResult;
  const components = [
    {
      resultIndex: 0,
      account: TOKEN,
      runtimeCodeHash: HASH_E,
      kind: 1,
      scope: 1,
    },
    {
      resultIndex: 1,
      account: REWARD_VAULT,
      runtimeCodeHash: HASH_F,
      kind: 0,
      scope: 1,
    },
    {
      resultIndex: 2,
      account: POSITION_RECIPIENT,
      runtimeCodeHash: HASH_G,
      kind: 0,
      scope: 1,
    },
    {
      resultIndex: 255,
      account: FEE_HOOK,
      runtimeCodeHash:
        options.componentHookRuntimeCodeHash
          ?? options.stampHookRuntimeCodeHash
          ?? HASH_C,
      kind: options.componentHookKind ?? 2,
      scope: 2,
    },
  ] as const satisfies readonly Component[];
  const stampRequest = {
    launchId: HASH_D,
    token: TOKEN,
    tokenRuntimeCodeHash: HASH_E,
    poolKey,
    hookRuntimeCodeHash: options.stampHookRuntimeCodeHash ?? HASH_C,
    components,
  } as const;
  const stampRequestDigest = keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash",
    ),
    [
      stampRequestTypehash,
      stampRequest.launchId,
      stampRequest.token,
      stampRequest.tokenRuntimeCodeHash,
      poolKeyHash(poolKey),
      stampRequest.hookRuntimeCodeHash,
      componentSetHash(components),
    ],
  ));
  const route = {
    launcher: options.routeLauncher ?? LAUNCHER,
    launcherRuntimeCodeHash: options.routeLauncherRuntimeCodeHash ?? HASH_B,
    parameters,
    expectedResult: result,
  } as const;
  const routePayload = encodeAbiParameters(routeParameters, [route]);
  const permit = {
    chainId: 1n,
    router: ROUTER,
    launchWallet: WALLET,
    kind: 2,
    routePayloadHash: keccak256(routePayload),
    expectedResultHash: expectedResultHash(result),
    stampRequestHash: stampRequestDigest,
    nonce: HASH_I,
    validAfter: 1_999_999_970n,
    deadline: 2_000_000_300n,
    value: BigInt(VALUE_WEI),
  } as const;
  const permitDigest = hashTypedData({
    domain: {
      name: "ProgrammableLaunchStampRouter",
      version: "1",
      chainId: 1,
      verifyingContract: ROUTER,
    },
    types: permitTypes,
    primaryType: "ProgrammableLaunchPermitV1",
    message: permit,
  });
  const signature = options.signature ?? ASSUMED_RPC_ACCEPTED_SIGNATURE;
  const routerCalldata = encodeFunctionData({
    abi: routerAbi,
    functionName: "launchAndStampV1",
    args: [permit, stampRequest, routePayload, signature],
  });
  const transactionCalldata = options.transactionCalldataSuffix
    ? concat([routerCalldata, options.transactionCalldataSuffix])
    : routerCalldata;
  const computedStampHash = keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,uint256 chainId,address router,bytes32 launchId,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 permitDigest,address poolManager,bytes32 poolId",
    ),
    [
      launchStampTypehash,
      1n,
      ROUTER,
      stampRequest.launchId,
      permit.launchWallet,
      permit.kind,
      permit.routePayloadHash,
      permit.expectedResultHash,
      permit.stampRequestHash,
      permitDigest,
      POOL_MANAGER,
      result.poolId,
    ],
  ));
  const authorization = {
    schemaVersion: CLASSIC_LAUNCH_AUTHORIZATION_SCHEMA_V1,
    chainId: "1" as const,
    releaseManifestDigest: HASH_A,
    predictedToken: options.predictedToken ?? TOKEN,
    predictedHook: FEE_HOOK,
    permitDigest: options.reportedPermitDigest ?? permitDigest,
    validAfter: permit.validAfter.toString(),
    deadline: permit.deadline.toString(),
    simulation: {
      blockNumber: "22000000",
      blockHash: HASH_D,
      blockTimestamp: "2000000000",
      gasEstimate: options.gasEstimate ?? "1900000",
      stampHash: options.reportedStampHash ?? computedStampHash,
    },
    transaction: {
      chainId: "1" as const,
      from: options.transactionFrom ?? WALLET,
      to: options.transactionTo ?? ROUTER,
      valueWei: options.transactionValueWei ?? VALUE_WEI,
      calldata: transactionCalldata,
      gasLimit: options.gasLimit ?? "2280000",
    },
  } as const;
  return { request, authorization };
}

function installedEnvironment(
  request = authorizationFixture().request,
  overrides: Readonly<Record<string, string>> = {},
) {
  const source = canonicalizeJson(request);
  const digest = keccak256(Buffer.from(source, "utf8"));
  return {
    [CLASSIC_V4_CANARY_AUTHORIZATION_ENABLED_ENV]: "enabled",
    [CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_BASE64URL_ENV]:
      Buffer.from(source, "utf8").toString("base64url"),
    [CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_DIGEST_ENV]: digest,
    ...overrides,
  };
}

function browserRequest(
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
  method = "POST",
) {
  return new Request(
    "https://programmable.market/api/ops/classic-v4-canary/authorization",
    {
      method,
      headers: {
        authorization: "Bearer privy-access-token",
        "content-type": "application/json",
        origin: "https://programmable.market",
        "sec-fetch-site": "same-origin",
        "x-privy-identity-token": "privy-identity-token",
        ...headers,
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    },
  );
}

type ReplayRpcPayload = Readonly<{
  id: number;
  method: string;
  params: readonly unknown[];
}>;

function productionReplayRpcHarness(
  fixture = authorizationFixture(),
) {
  const state: {
    oversizedResponse: boolean;
    rejectedCalldata: Hex | null;
    routerCode: Hex;
    secondaryHttpFailure: boolean;
    secondaryStampHash: Hex | null;
  } = {
    oversizedResponse: false,
    rejectedCalldata: null,
    routerCode: TEST_ROUTER_RUNTIME_CODE,
    secondaryHttpFailure: false,
    secondaryStampHash: null,
  };
  const fetchImplementation = vi.fn(async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const endpoint = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const payload = JSON.parse(String(init?.body)) as ReplayRpcPayload;
    if (state.secondaryHttpFailure && endpoint.includes("quiknode.pro")) {
      return new Response("unavailable", { status: 503 });
    }
    let result: unknown;
    if (payload.method === "eth_chainId") {
      result = "0x1";
    } else if (payload.method === "eth_getBlockByNumber") {
      const latest = payload.params[0] === "latest";
      result = {
        number: toHex(
          BigInt(fixture.authorization.simulation.blockNumber)
            + (latest ? 1n : 0n),
        ),
        hash: latest ? HASH_E : fixture.authorization.simulation.blockHash,
        timestamp: toHex(
          BigInt(fixture.authorization.simulation.blockTimestamp),
        ),
      };
    } else if (payload.method === "eth_getCode") {
      result = state.routerCode;
    } else if (payload.method === "eth_call") {
      const transaction = payload.params[0] as Readonly<{
        data?: unknown;
      }>;
      if (transaction.data === state.rejectedCalldata) {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          error: { code: -32_000, message: "execution reverted" },
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      result = endpoint.includes("quiknode.pro")
        && state.secondaryStampHash !== null
        ? state.secondaryStampHash
        : fixture.authorization.simulation.stampHash;
    } else {
      throw new TypeError("Unexpected test RPC method");
    }
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: payload.id,
      result,
    }), {
      headers: {
        "content-type": "application/json",
        ...(state.oversizedResponse
          ? { "content-length": "1048577" }
          : {}),
      },
    });
  });
  return { fetchImplementation, fixture, state };
}

describe("Classic V4 canary authorization lane", () => {
  const authorize = vi.fn();
  const replayAuthorization = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    authorize.mockResolvedValue(authorizationFixture().authorization);
    replayAuthorization.mockImplementation(async (authorization) => {
      if (
        authorization.transaction.calldata
          !== authorizationFixture().authorization.transaction.calldata
      ) {
        throw new TypeError("Router replay rejected the authorization");
      }
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is available only for the exact flag, canonical request and matching Keccak digest", () => {
    const environment = installedEnvironment();
    const installed = loadInstalledClassicV4CanaryAuthorizationRequestV1(
      environment,
    );

    expect(installed.launchWallet).toBe(WALLET);
    expect(installed.request).toEqual(authorizationFixture().request);
    expect(installed.authorizationRequestDigest).toBe(
      environment[CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_DIGEST_ENV],
    );
    expect(isClassicV4CanaryAuthorizationLaneEnabledV1(environment)).toBe(true);
    expect(isClassicV4CanaryAuthorizationLaneEnabledV1({
      ...environment,
      [CLASSIC_V4_CANARY_AUTHORIZATION_ENABLED_ENV]: "1",
    })).toBe(false);
    expect(loadAvailableClassicV4CanaryAuthorizationRequestV1({
      ...environment,
      [CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_DIGEST_ENV]: HASH_H,
    })).toBeNull();
    expect(loadAvailableClassicV4CanaryAuthorizationRequestV1({
      [CLASSIC_V4_CANARY_AUTHORIZATION_ENABLED_ENV]: "enabled",
    })).toBeNull();
  });

  it("rejects noncanonical installed bytes, invalid inner calldata and digest drift", () => {
    const request = authorizationFixture().request;
    const pretty = JSON.stringify(request, null, 2);
    expect(() => loadInstalledClassicV4CanaryAuthorizationRequestV1(
      installedEnvironment(request, {
        [CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_BASE64URL_ENV]:
          Buffer.from(pretty, "utf8").toString("base64url"),
        [CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_DIGEST_ENV]:
          keccak256(Buffer.from(pretty, "utf8")),
      }),
    )).toThrow("not canonical");

    expect(() => loadInstalledClassicV4CanaryAuthorizationRequestV1(
      installedEnvironment({ ...request, launcherCalldata: "0x12345678" }),
    )).toThrow("launcher calldata");

    expect(() => loadInstalledClassicV4CanaryAuthorizationRequestV1(
      installedEnvironment(request, {
        [CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_DIGEST_ENV]: HASH_H,
      }),
    )).toThrow("digest mismatch");
  });

  it("returns 404 before constructing the production bridge when config is absent or invalid", async () => {
    vi.stubEnv(CLASSIC_V4_CANARY_AUTHORIZATION_ENABLED_ENV, "enabled");
    vi.stubEnv(CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_BASE64URL_ENV, "invalid=");
    vi.stubEnv(CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_DIGEST_ENV, HASH_A);

    const response = await getProductionClassicV4CanaryAuthorizationHandlerV1()(
      browserRequest({
        schemaVersion: CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1,
        authorizationRequestDigest: HASH_A,
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "The requested resource was not found.",
      },
    });
  });

  it("replays the exact Router transaction on both committed production RPCs", async () => {
    const { fetchImplementation, fixture, state } =
      productionReplayRpcHarness();
    const environment = productionMainnetRpcEnvironment(
      "https://lb.drpc.live/ethereum/classic-v4-canary-test",
      "https://classic-v4.ethereum-mainnet.quiknode.pro/canary-test-key/",
    );
    const replay = createProductionClassicV4CanaryAuthorizationReplayV1({
      environment,
      fetchImplementation,
      nowMs: () => 2_000_000_000_000,
    });

    await expect(replay(fixture.authorization)).resolves.toBeUndefined();
    let requests = fetchImplementation.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)) as ReplayRpcPayload
    );
    expect(requests).toHaveLength(14);
    const codeRequests = requests.filter(
      ({ method }) => method === "eth_getCode",
    );
    const callRequests = requests.filter(({ method }) => method === "eth_call");
    expect(codeRequests).toHaveLength(4);
    expect(callRequests).toHaveLength(4);
    for (const { params } of [...codeRequests, ...callRequests]) {
      const selector = params[params.length - 1];
      expect(selector).toEqual(expect.objectContaining({
        requireCanonical: true,
      }));
      expect([HASH_D, HASH_E]).toContain(
        (selector as Readonly<{ blockHash: Hex }>).blockHash,
      );
    }
    for (const { params } of callRequests) {
      expect(params[0]).toEqual({
        from: WALLET,
        to: ROUTER,
        value: toHex(BigInt(VALUE_WEI)),
        gas: toHex(2_280_000n),
        data: fixture.authorization.transaction.calldata,
      });
    }

    fetchImplementation.mockClear();
    const forged = authorizationFixture({ signature: FORGED_SIGNATURE });
    state.rejectedCalldata = forged.authorization.transaction.calldata;
    await expect(replay(forged.authorization)).rejects.toThrow();
    requests = fetchImplementation.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)) as ReplayRpcPayload
    );
    expect(requests.some(({ method }) => method === "eth_call")).toBe(true);

    fetchImplementation.mockClear();
    state.rejectedCalldata = null;
    state.secondaryStampHash = HASH_H;
    await expect(replay(fixture.authorization)).rejects.toThrow(
      "authorization binding is invalid",
    );
    requests = fetchImplementation.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)) as ReplayRpcPayload
    );
    expect(requests.filter(({ method }) => method === "eth_call")).toHaveLength(4);

    fetchImplementation.mockClear();
    state.secondaryStampHash = concat([
      fixture.authorization.simulation.stampHash,
      HASH_H,
    ]);
    await expect(replay(fixture.authorization)).rejects.toThrow(
      "authorization replay is invalid",
    );

    fetchImplementation.mockClear();
    state.secondaryStampHash = null;
    state.secondaryHttpFailure = true;
    await expect(replay(fixture.authorization)).rejects.toThrow(
      "authorization replay is invalid",
    );
    expect(fetchImplementation.mock.calls.some(([input]) =>
      String(input).includes("quiknode.pro")
    )).toBe(true);

    expect(() => createProductionClassicV4CanaryAuthorizationReplayV1({
      environment: {
        ...environment,
        PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT: HASH_A,
      },
      fetchImplementation,
    })).toThrow("commitment mismatch");
  });

  it("fails production replay closed on future, expired, stale, unbound, or oversized RPC evidence", async () => {
    const { fetchImplementation, fixture, state } =
      productionReplayRpcHarness();
    const environment = productionMainnetRpcEnvironment(
      "https://lb.drpc.live/ethereum/classic-v4-canary-test",
      "https://classic-v4.ethereum-mainnet.quiknode.pro/canary-test-key/",
    );

    const futureReplay = createProductionClassicV4CanaryAuthorizationReplayV1({
      environment,
      fetchImplementation,
      nowMs: () => 1_999_999_969_000,
    });
    await expect(futureReplay(fixture.authorization)).rejects.toThrow(
      "authorization binding is invalid",
    );
    expect(fetchImplementation).not.toHaveBeenCalled();

    const expiredReplay = createProductionClassicV4CanaryAuthorizationReplayV1({
      environment,
      fetchImplementation,
      nowMs: () => 2_000_000_301_000,
    });
    await expect(expiredReplay(fixture.authorization)).rejects.toThrow(
      "authorization binding is invalid",
    );
    expect(fetchImplementation).not.toHaveBeenCalled();

    const staleReplay = createProductionClassicV4CanaryAuthorizationReplayV1({
      environment,
      fetchImplementation,
      nowMs: () => 2_000_000_100_000,
    });
    await expect(staleReplay(fixture.authorization)).rejects.toThrow(
      "authorization binding is invalid",
    );
    let requests = fetchImplementation.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)) as ReplayRpcPayload
    );
    expect(requests).toHaveLength(6);
    expect(requests.some(({ method }) => method === "eth_call")).toBe(false);
    expect(requests.some(({ method }) => method === "eth_getCode")).toBe(false);

    fetchImplementation.mockClear();
    state.routerCode = "0x00";
    const unboundCodeReplay =
      createProductionClassicV4CanaryAuthorizationReplayV1({
        environment,
        fetchImplementation,
        nowMs: () => 2_000_000_000_000,
      });
    await expect(unboundCodeReplay(fixture.authorization)).rejects.toThrow(
      "authorization binding is invalid",
    );
    requests = fetchImplementation.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)) as ReplayRpcPayload
    );
    const codeRequests = requests.filter(
      ({ method }) => method === "eth_getCode",
    );
    expect(codeRequests).toHaveLength(4);
    expect(codeRequests.map(({ params }) => params[1])).toContainEqual({
      blockHash: HASH_D,
      requireCanonical: true,
    });
    expect(codeRequests.map(({ params }) => params[1])).toContainEqual({
      blockHash: HASH_E,
      requireCanonical: true,
    });
    expect(requests.some(({ method }) => method === "eth_call")).toBe(false);

    fetchImplementation.mockClear();
    state.routerCode = TEST_ROUTER_RUNTIME_CODE;
    state.oversizedResponse = true;
    const oversizedReplay =
      createProductionClassicV4CanaryAuthorizationReplayV1({
        environment,
        fetchImplementation,
        nowMs: () => 2_000_000_000_000,
      });
    await expect(oversizedReplay(fixture.authorization)).rejects.toThrow(
      "authorization replay is invalid",
    );
    expect(fetchImplementation).toHaveBeenCalled();
  });

  it("rejects an authorization that expires during the dual-RPC replay", async () => {
    const { fetchImplementation, fixture } = productionReplayRpcHarness();
    const advancingClock = vi.fn()
      .mockReturnValueOnce(2_000_000_000_000)
      .mockReturnValueOnce(2_000_000_301_000);
    const replay = createProductionClassicV4CanaryAuthorizationReplayV1({
      environment: productionMainnetRpcEnvironment(
        "https://lb.drpc.live/ethereum/classic-v4-canary-test",
        "https://classic-v4.ethereum-mainnet.quiknode.pro/canary-test-key/",
      ),
      fetchImplementation,
      nowMs: advancingClock,
    });

    await expect(replay(fixture.authorization)).rejects.toThrow(
      "authorization binding is invalid",
    );
    expect(advancingClock).toHaveBeenCalledTimes(2);
    expect(fetchImplementation).toHaveBeenCalledTimes(14);
  });

  it("sends only the digest acknowledgement and downloads a fully validated artifact", async () => {
    const fixture = authorizationFixture();
    const installed = loadInstalledClassicV4CanaryAuthorizationRequestV1(
      installedEnvironment(fixture.request),
    );
    const handler = createClassicV4CanaryAuthorizationHandlerV1({
      bridge: { authorize },
      replayAuthorization,
      loadInstalledRequest: () => installed,
    });
    const request = browserRequest({
      schemaVersion: CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1,
      authorizationRequestDigest: installed.authorizationRequestDigest,
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith(request, installed.request);
    expect(replayAuthorization).toHaveBeenCalledWith(fixture.authorization);
    expect(await response.json()).toEqual({
      schemaVersion: CLASSIC_V4_CANARY_AUTHORIZATION_DOWNLOAD_SCHEMA_V1,
      authorizationRequestDigest: installed.authorizationRequestDigest,
      authorization: fixture.authorization,
    });
    await expect(validateClassicV4CanaryAuthorizationAgainstInstalledRequestV1(
      installed.request,
      fixture.authorization,
      replayAuthorization,
    )).resolves.toEqual(fixture.authorization);

    const clientSource = readFileSync(path.join(
      process.cwd(),
      "components/classic-v4-canary-authorization-console.tsx",
    ), "utf8");
    const commandBody = /body:\s*JSON\.stringify\(\{([\s\S]*?)\}\),/u
      .exec(clientSource)?.[1] ?? "";
    expect(commandBody).toContain("schemaVersion: COMMAND_SCHEMA");
    expect(commandBody).toContain("authorizationRequestDigest");
    expect(commandBody).not.toMatch(
      /launchWallet|launcherCalldata|releaseManifestDigest|feeHook/u,
    );
  });

  it.each([
    ["route launcher", { routeLauncher: OTHER_LAUNCHER }],
    ["launcher runtime", { routeLauncherRuntimeCodeHash: HASH_H }],
    ["inner launcher calldata", { routeName: "Changed Canary" }],
    ["hook runtime", { stampHookRuntimeCodeHash: HASH_H }],
    ["prelaunch position sentinel", { resultPositionTokenId: 1n }],
    ["expected result", { resultInitialBuyNativeAmount: 1n }],
    ["component binding", { componentHookKind: 0 }],
    ["predicted result", { predictedToken: OTHER_WALLET }],
    ["permit digest", { reportedPermitDigest: HASH_H }],
    ["stamp digest", { reportedStampHash: HASH_H }],
    ["transaction sender", { transactionFrom: OTHER_WALLET }],
    ["transaction target", { transactionTo: LAUNCHER }],
    ["transaction value", { transactionValueWei: "1" }],
    ["canonical Router calldata", { transactionCalldataSuffix: "0x00" }],
    ["gas estimate", { gasEstimate: "2200001" }],
    ["gas limit formula", { gasLimit: "2279999" }],
  ] satisfies readonly (readonly [string, FixtureOptions])[])(
    "rejects a Router authorization with a changed %s",
    async (_label, options) => {
      const installed = loadInstalledClassicV4CanaryAuthorizationRequestV1(
        installedEnvironment(),
      );
      authorize.mockResolvedValueOnce(authorizationFixture(options).authorization);
      const handler = createClassicV4CanaryAuthorizationHandlerV1({
        bridge: { authorize },
        replayAuthorization,
        loadInstalledRequest: () => installed,
      });

      const response = await handler(browserRequest({
        schemaVersion: CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1,
        authorizationRequestDigest: installed.authorizationRequestDigest,
      }));
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body).toEqual({
        error: {
          code: "classic_v4_canary_authorization_unavailable",
          message:
            "Authorization is unavailable. Verify the installed request and try again.",
          requestId: expect.any(String),
        },
      });
      expect(JSON.stringify(body)).not.toContain("launcherCalldata");
      expect(JSON.stringify(body)).not.toContain("PROGRAMMABLE_");
      expect(replayAuthorization).not.toHaveBeenCalled();
    },
  );

  it("does not download an otherwise canonical authorization with a forged signature", async () => {
    const installed = loadInstalledClassicV4CanaryAuthorizationRequestV1(
      installedEnvironment(),
    );
    const forged = authorizationFixture({ signature: FORGED_SIGNATURE });
    authorize.mockResolvedValueOnce(forged.authorization);
    const handler = createClassicV4CanaryAuthorizationHandlerV1({
      bridge: { authorize },
      replayAuthorization,
      loadInstalledRequest: () => installed,
    });

    const response = await handler(browserRequest({
      schemaVersion: CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1,
      authorizationRequestDigest: installed.authorizationRequestDigest,
    }));

    expect(response.status).toBe(503);
    expect(replayAuthorization).toHaveBeenCalledTimes(1);
    expect(replayAuthorization).toHaveBeenCalledWith(forged.authorization);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "classic_v4_canary_authorization_unavailable",
        message:
          "Authorization is unavailable. Verify the installed request and try again.",
        requestId: expect.any(String),
      },
    });
  });

  it("rejects browser request injection, stale digest, cross-origin use and non-POST methods", async () => {
    const installed = loadInstalledClassicV4CanaryAuthorizationRequestV1(
      installedEnvironment(),
    );
    const handler = createClassicV4CanaryAuthorizationHandlerV1({
      bridge: { authorize },
      replayAuthorization,
      loadInstalledRequest: () => installed,
    });

    const injected = await handler(browserRequest({
      schemaVersion: CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1,
      authorizationRequestDigest: installed.authorizationRequestDigest,
      launchWallet: OTHER_WALLET,
    }));
    expect(injected.status).toBe(400);

    const stale = await handler(browserRequest({
      schemaVersion: CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1,
      authorizationRequestDigest: HASH_H,
    }));
    expect(stale.status).toBe(409);

    const crossOrigin = await handler(browserRequest({
      schemaVersion: CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1,
      authorizationRequestDigest: installed.authorizationRequestDigest,
    }, {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    }));
    expect(crossOrigin.status).toBe(403);

    const get = await handler(browserRequest({}, {}, "GET"));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect(authorize).not.toHaveBeenCalled();
  });

  it("bounds the browser command before parsing it", async () => {
    const installed = loadInstalledClassicV4CanaryAuthorizationRequestV1(
      installedEnvironment(),
    );
    const handler = createClassicV4CanaryAuthorizationHandlerV1({
      bridge: { authorize },
      replayAuthorization,
      loadInstalledRequest: () => installed,
    });
    const response = await handler(browserRequest({ padding: "x".repeat(5_000) }));

    expect(response.status).toBe(413);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("preserves safe bridge status and correlation without exposing server configuration", async () => {
    const installed = loadInstalledClassicV4CanaryAuthorizationRequestV1(
      installedEnvironment(),
    );
    authorize.mockRejectedValueOnce(
      new ClassicLaunchAuthorizationBridgeErrorV1(
        401,
        "privy_session_invalid",
        "request-id-1",
      ),
    );
    const handler = createClassicV4CanaryAuthorizationHandlerV1({
      bridge: { authorize },
      replayAuthorization,
      loadInstalledRequest: () => installed,
    });

    const response = await handler(browserRequest({
      schemaVersion: CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1,
      authorizationRequestDigest: installed.authorizationRequestDigest,
    }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: "privy_session_invalid",
        message: "Reconnect the installed launch wallet and try again.",
        requestId: "request-id-1",
      },
    });
    expect(JSON.stringify(body)).not.toContain("launcherCalldata");
    expect(JSON.stringify(body)).not.toContain("PROGRAMMABLE_");
  });
});
