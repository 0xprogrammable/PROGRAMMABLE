import "server-only";

import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";

import {
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import {
  productionMainnetRpcPair,
  type WebsiteMainnetRpcPair,
} from "../../onchain/website-rpc-providers.server";
import {
  CLASSIC_V4_LAUNCH_STAMP_ROUTER,
  CLASSIC_V4_LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
} from "../../classic-v4";

import {
  CLASSIC_LAUNCH_AUTHORIZATION_REQUEST_SCHEMA_V1,
  CLASSIC_LAUNCH_AUTHORIZATION_SCHEMA_V1,
  ClassicLaunchAuthorizationBridgeErrorV1,
  getProductionClassicLaunchAuthorizationBridgeV1,
  type ClassicLaunchAuthorizationV1,
  type ClassicLaunchAuthorizationBridgeV1,
  type ClassicLaunchAuthorizationRequestV1,
} from "./classic-launch-authorization-bridge-v1";
import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";

export const CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1 =
  "programmable.classic-v4.canary-authorization-command.v1" as const;
export const CLASSIC_V4_CANARY_AUTHORIZATION_DOWNLOAD_SCHEMA_V1 =
  "programmable.classic-v4.canary-authorization-download.v1" as const;

export const CLASSIC_V4_CANARY_AUTHORIZATION_ENABLED_ENV =
  "PROGRAMMABLE_CLASSIC_V4_CANARY_AUTHORIZATION_ENABLED" as const;
export const CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_BASE64URL_ENV =
  "PROGRAMMABLE_CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_BASE64URL" as const;
export const CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_DIGEST_ENV =
  "PROGRAMMABLE_CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_DIGEST" as const;

const MAXIMUM_INSTALLED_REQUEST_BYTES = 65_536;
const MAXIMUM_COMMAND_BYTES = 4_096;
const MAXIMUM_RPC_RESPONSE_BYTES = 1_048_576;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAINNET_POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const MAINNET_ROUTER = CLASSIC_V4_LAUNCH_STAMP_ROUTER;
const MAINNET_ROUTER_RUNTIME_CODE_HASH =
  CLASSIC_V4_LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH;
const CLASSIC_V4_KIND = 2;
const CLASSIC_V4_LP_FEE_PIPS = 0;
const CLASSIC_V4_TICK_SPACING = 200;
const CLASSIC_V4_TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;
const MINIMUM_GAS_LIMIT = 1_500_000n;
const MAXIMUM_GAS_LIMIT = 13_500_000n;
const MAXIMUM_PERMIT_WINDOW_SECONDS = 330n;
const MAXIMUM_LATEST_BLOCK_AGE_SECONDS = 60n;
const MAXIMUM_LATEST_BLOCK_FUTURE_SKEW_SECONDS = 30n;
const ROUTER_REPLAY_TIMEOUT_MS = 12_000;
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_ORDER = SECP256K1_ORDER >> 1n;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const CLASSIC_V4_LAUNCHER_ABI = parseAbi([
  "function launchFor(address launchWallet,(string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters) payable returns ((address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash) result)",
]);
const CLASSIC_V4_ROUTER_ABI = parseAbi([
  "function launchAndStampV1((uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value) permit,(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bytes32 hookRuntimeCodeHash,(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)[] components) stampRequest,bytes routePayload,bytes signature) payable returns (bytes32 stampHash)",
]);
const CLASSIC_V4_ROUTE_PARAMETERS = parseAbiParameters(
  "(address launcher,bytes32 launcherRuntimeCodeHash,(string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters,(address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash) expectedResult) route",
);
const CLASSIC_V4_LAUNCH_PERMIT_TYPES = Object.freeze({
  ProgrammableLaunchPermitV1: Object.freeze([
    Object.freeze({ name: "chainId", type: "uint256" }),
    Object.freeze({ name: "router", type: "address" }),
    Object.freeze({ name: "launchWallet", type: "address" }),
    Object.freeze({ name: "kind", type: "uint8" }),
    Object.freeze({ name: "routePayloadHash", type: "bytes32" }),
    Object.freeze({ name: "expectedResultHash", type: "bytes32" }),
    Object.freeze({ name: "stampRequestHash", type: "bytes32" }),
    Object.freeze({ name: "nonce", type: "bytes32" }),
    Object.freeze({ name: "validAfter", type: "uint64" }),
    Object.freeze({ name: "deadline", type: "uint64" }),
    Object.freeze({ name: "value", type: "uint256" }),
  ]),
});
const CLASSIC_RESULT_ADDRESSES_TYPEHASH = keccak256(stringToHex(
  "ProgrammableClassicResultAddressesV1(address token,address rewardVault,address positionRecipient,address initialBuyCustody)",
));
const CLASSIC_RESULT_AMOUNTS_TYPEHASH = keccak256(stringToHex(
  "ProgrammableClassicResultAmountsV1(uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount)",
));
const CLASSIC_RESULT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableClassicLaunchResultV1(bytes32 addressesHash,bytes32 amountsHash,bytes32 poolId,bytes32 launchHash)",
));
const COMPONENT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)",
));
const POOL_KEY_TYPEHASH = keccak256(stringToHex(
  "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
));
const STAMP_REQUEST_TYPEHASH = keccak256(stringToHex(
  "ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)",
));
const LAUNCH_STAMP_TYPEHASH = keccak256(stringToHex(
  "ProgrammableLaunchStampV1(uint256 chainId,address router,bytes32 launchId,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 permitDigest,address poolManager,bytes32 poolId)",
));

export type InstalledClassicV4CanaryAuthorizationRequestV1 = Readonly<{
  authorizationRequestDigest: Hex;
  launchWallet: Address;
  request: ClassicLaunchAuthorizationRequestV1;
}>;

export type ClassicV4CanaryAuthorizationReplayV1 = (
  authorization: ClassicLaunchAuthorizationV1,
) => Promise<void>;

type Environment = Readonly<Record<string, string | undefined>>;

type AuthorizationCommandV1 = Readonly<{
  schemaVersion: typeof CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1;
  authorizationRequestDigest: Hex;
}>;

class CanaryAuthorizationLaneErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(code);
    this.name = "CanaryAuthorizationLaneErrorV1";
  }
}

export function isClassicV4CanaryAuthorizationLaneEnabledV1(
  environment: Environment = process.env,
) {
  return loadAvailableClassicV4CanaryAuthorizationRequestV1(environment)
    !== null;
}

export function loadAvailableClassicV4CanaryAuthorizationRequestV1(
  environment: Environment = process.env,
): InstalledClassicV4CanaryAuthorizationRequestV1 | null {
  if (!hasClassicV4CanaryAuthorizationEnableFlag(environment)) return null;
  try {
    return loadInstalledClassicV4CanaryAuthorizationRequestV1(environment);
  } catch {
    return null;
  }
}

export function loadInstalledClassicV4CanaryAuthorizationRequestV1(
  environment: Environment = process.env,
): InstalledClassicV4CanaryAuthorizationRequestV1 {
  if (!hasClassicV4CanaryAuthorizationEnableFlag(environment)) {
    throw new TypeError("Classic V4 canary authorization lane is disabled");
  }

  const encoded = requiredEnvironment(
    environment,
    CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_BASE64URL_ENV,
  );
  if (
    encoded.length > Math.ceil(MAXIMUM_INSTALLED_REQUEST_BYTES * 4 / 3)
    || !/^[A-Za-z0-9_-]+$/u.test(encoded)
  ) {
    throw new TypeError("Classic V4 canary authorization request is invalid");
  }

  const requestBytes = Buffer.from(encoded, "base64url");
  if (
    requestBytes.length === 0
    || requestBytes.length > MAXIMUM_INSTALLED_REQUEST_BYTES
    || requestBytes.toString("base64url") !== encoded
  ) {
    throw new TypeError("Classic V4 canary authorization request is invalid");
  }

  let requestSource: string;
  try {
    requestSource = utf8Decoder.decode(requestBytes);
  } catch {
    throw new TypeError("Classic V4 canary authorization request is invalid");
  }

  let parsed: JsonValue;
  try {
    parsed = parseStrictJson(requestSource, {
      maximumBytes: MAXIMUM_INSTALLED_REQUEST_BYTES,
      maximumDepth: 8,
    });
  } catch {
    throw new TypeError("Classic V4 canary authorization request is invalid");
  }
  if (canonicalizeJson(parsed) !== requestSource) {
    throw new TypeError(
      "Classic V4 canary authorization request bytes are not canonical",
    );
  }

  const request = parseInstalledRequest(parsed);
  requireCanonicalInstalledLauncherCall(request);
  const configuredDigest = nonzeroHex32(requiredEnvironment(
    environment,
    CLASSIC_V4_CANARY_AUTHORIZATION_REQUEST_DIGEST_ENV,
  ));
  const computedDigest = keccak256(requestBytes);
  if (computedDigest !== configuredDigest) {
    throw new TypeError("Classic V4 canary authorization digest mismatch");
  }

  return Object.freeze({
    authorizationRequestDigest: configuredDigest,
    launchWallet: request.launchWallet,
    request,
  });
}

function hasClassicV4CanaryAuthorizationEnableFlag(environment: Environment) {
  return environment[CLASSIC_V4_CANARY_AUTHORIZATION_ENABLED_ENV] === "enabled";
}

export function createClassicV4CanaryAuthorizationHandlerV1(input: Readonly<{
  bridge: ClassicLaunchAuthorizationBridgeV1;
  replayAuthorization: ClassicV4CanaryAuthorizationReplayV1;
  loadInstalledRequest?: () => InstalledClassicV4CanaryAuthorizationRequestV1;
}>) {
  if (typeof input.bridge?.authorize !== "function") {
    throw new TypeError("Classic V4 canary authorization bridge is invalid");
  }
  if (typeof input.replayAuthorization !== "function") {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  const loadInstalledRequest = input.loadInstalledRequest
    ?? (() => loadInstalledClassicV4CanaryAuthorizationRequestV1());

  return async function handleClassicV4CanaryAuthorization(request: Request) {
    try {
      if (request.method !== "POST") {
        return methodNotAllowedResponse();
      }
      requireSameOriginBrowserRequest(request);
      const installed = loadInstalledRequest();
      const command = await readAuthorizationCommand(request);
      if (
        command.authorizationRequestDigest
          !== installed.authorizationRequestDigest
      ) {
        throw new CanaryAuthorizationLaneErrorV1(
          409,
          "authorization_request_changed",
          "The installed request changed. Reload the page and verify the new digest.",
        );
      }

      const authorization = await input.bridge.authorize(
        request,
        installed.request,
      );
      const validatedAuthorization =
        await validateClassicV4CanaryAuthorizationAgainstInstalledRequestV1(
          installed.request,
          authorization,
          input.replayAuthorization,
        );
      return jsonResponse({
        schemaVersion: CLASSIC_V4_CANARY_AUTHORIZATION_DOWNLOAD_SCHEMA_V1,
        authorizationRequestDigest: installed.authorizationRequestDigest,
        authorization: validatedAuthorization,
      }, 200);
    } catch (error) {
      if (error instanceof CanaryAuthorizationLaneErrorV1) {
        return errorResponse(
          error.status,
          error.code,
          error.publicMessage,
        );
      }
      if (error instanceof ClassicLaunchAuthorizationBridgeErrorV1) {
        return bridgeErrorResponse(error);
      }
      return unexpectedLaneErrorResponse(error);
    }
  };
}

export function getProductionClassicV4CanaryAuthorizationHandlerV1() {
  return async (request: Request) => {
    const installed = loadAvailableClassicV4CanaryAuthorizationRequestV1();
    if (installed === null) {
      return errorResponse(
        404,
        "not_found",
        "The requested resource was not found.",
      );
    }
    if (request.method !== "POST") return methodNotAllowedResponse();
    try {
      return await createClassicV4CanaryAuthorizationHandlerV1({
        bridge: getProductionClassicLaunchAuthorizationBridgeV1(),
        replayAuthorization:
          createProductionClassicV4CanaryAuthorizationReplayV1(),
        loadInstalledRequest: () => installed,
      })(request);
    } catch (error) {
      return unexpectedLaneErrorResponse(error);
    }
  };
}

export function createProductionClassicV4CanaryAuthorizationReplayV1(
  dependencies: Readonly<{
    environment?: Environment;
    fetchImplementation?: typeof fetch;
    nowMs?: () => number;
  }> = {},
): ClassicV4CanaryAuthorizationReplayV1 {
  const rpcPair = productionMainnetRpcPair(
    dependencies.environment ?? process.env,
  );
  requireClassicV4ProductionRpcPair(rpcPair);
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const nowMs = dependencies.nowMs ?? Date.now;
  if (typeof fetchImplementation !== "function" || typeof nowMs !== "function") {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }

  return async (authorization) => {
    const nowSeconds = classicV4ObservedAtSeconds(nowMs);
    const validAfter = BigInt(authorization.validAfter);
    const deadline = BigInt(authorization.deadline);
    requireAuthorizationBinding(
      validAfter <= nowSeconds && nowSeconds <= deadline,
    );

    await Promise.all([
      replayClassicV4AuthorizationAtProvider(
        rpcPair.primary.url,
        authorization,
        nowSeconds,
        fetchImplementation,
      ),
      replayClassicV4AuthorizationAtProvider(
        rpcPair.secondary.url,
        authorization,
        nowSeconds,
        fetchImplementation,
      ),
    ]);
    const completedAtSeconds = classicV4ObservedAtSeconds(nowMs);
    requireAuthorizationBinding(
      validAfter <= completedAtSeconds && completedAtSeconds <= deadline,
    );
  };
}

function classicV4ObservedAtSeconds(nowMs: () => number) {
  const observedAt = nowMs();
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  return BigInt(Math.floor(observedAt / 1_000));
}

function requireClassicV4ProductionRpcPair(rpcPair: WebsiteMainnetRpcPair) {
  if (
    rpcPair.source !== "role-bound-v1"
    || rpcPair.primary.provider !== "drpc"
    || rpcPair.secondary.provider !== "quicknode"
    || rpcPair.primary.url === rpcPair.secondary.url
    || rpcPair.primary.endpointCommitment
      === rpcPair.secondary.endpointCommitment
  ) {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
}

async function replayClassicV4AuthorizationAtProvider(
  endpoint: string,
  authorization: ClassicLaunchAuthorizationV1,
  nowSeconds: bigint,
  fetchImplementation: typeof fetch,
) {
  const signal = AbortSignal.timeout(ROUTER_REPLAY_TIMEOUT_MS);
  const pinnedTag = rpcQuantity(BigInt(authorization.simulation.blockNumber));
  const [chainId, pinnedBlockValue, latestBlockValue] = await Promise.all([
      classicV4RpcRequest(endpoint, "eth_chainId", [], signal, fetchImplementation),
      classicV4RpcRequest(
        endpoint,
        "eth_getBlockByNumber",
        [pinnedTag, false],
        signal,
        fetchImplementation,
      ),
      classicV4RpcRequest(
        endpoint,
        "eth_getBlockByNumber",
        ["latest", false],
        signal,
        fetchImplementation,
      ),
    ]);
  const pinnedBlock = classicV4RpcBlock(pinnedBlockValue);
  const latestBlock = classicV4RpcBlock(latestBlockValue);
  const pinnedBlockNumber = BigInt(authorization.simulation.blockNumber);
  const pinnedBlockTimestamp = BigInt(authorization.simulation.blockTimestamp);
  const validAfter = BigInt(authorization.validAfter);
  const deadline = BigInt(authorization.deadline);
  requireAuthorizationBinding(
    chainId === "0x1"
      && pinnedBlock.number === pinnedBlockNumber
      && sameHex(pinnedBlock.hash, authorization.simulation.blockHash)
      && pinnedBlock.timestamp === pinnedBlockTimestamp
      && latestBlock.number >= pinnedBlock.number
      && validAfter <= latestBlock.timestamp
      && latestBlock.timestamp <= deadline
      && latestBlock.timestamp
        <= nowSeconds + MAXIMUM_LATEST_BLOCK_FUTURE_SKEW_SECONDS
      && nowSeconds
        <= latestBlock.timestamp + MAXIMUM_LATEST_BLOCK_AGE_SECONDS,
  );

  const pinnedSelector = Object.freeze({
    blockHash: pinnedBlock.hash,
    requireCanonical: true,
  });
  const latestSelector = Object.freeze({
    blockHash: latestBlock.hash,
    requireCanonical: true,
  });
  const [pinnedCode, latestCode] = await Promise.all([
    classicV4RpcRequest(
      endpoint,
      "eth_getCode",
      [MAINNET_ROUTER, pinnedSelector],
      signal,
      fetchImplementation,
    ),
    classicV4RpcRequest(
      endpoint,
      "eth_getCode",
      [MAINNET_ROUTER, latestSelector],
      signal,
      fetchImplementation,
    ),
  ]);
  requireAuthorizationBinding(
    classicV4RuntimeCodeHash(pinnedCode)
        === MAINNET_ROUTER_RUNTIME_CODE_HASH
      && classicV4RuntimeCodeHash(latestCode)
        === MAINNET_ROUTER_RUNTIME_CODE_HASH,
  );

  const transaction = Object.freeze({
    from: authorization.transaction.from,
    to: authorization.transaction.to,
    value: rpcQuantity(BigInt(authorization.transaction.valueWei)),
    gas: rpcQuantity(BigInt(authorization.transaction.gasLimit)),
    data: authorization.transaction.calldata,
  });
  const [pinnedResult, latestResult] = await Promise.all([
    classicV4RpcRequest(
      endpoint,
      "eth_call",
      [transaction, pinnedSelector],
      signal,
      fetchImplementation,
    ),
    classicV4RpcRequest(
      endpoint,
      "eth_call",
      [transaction, latestSelector],
      signal,
      fetchImplementation,
    ),
  ]);
  requireAuthorizationBinding(
    sameHex(
      classicV4RouterStampHashResult(pinnedResult),
      authorization.simulation.stampHash,
    )
      && sameHex(
        classicV4RouterStampHashResult(latestResult),
        authorization.simulation.stampHash,
      ),
  );
}

async function classicV4RpcRequest(
  endpoint: string,
  method: string,
  params: readonly unknown[],
  signal: AbortSignal,
  fetchImplementation: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  if (!response.ok) {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }

  const parsed = await readBoundedClassicV4RpcJson(response);
  const record = exactRecord(parsed, ["id", "jsonrpc", "result"]);
  if (record.id !== 1 || record.jsonrpc !== "2.0") {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  return record.result;
}

async function readBoundedClassicV4RpcJson(response: Response) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null
    && (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength)
      || BigInt(declaredLength) > BigInt(MAXIMUM_RPC_RESPONSE_BYTES))
  ) {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > MAXIMUM_RPC_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new TypeError("Classic V4 canary authorization replay is invalid");
    }
    chunks.push(part.value);
  }
  if (length === 0) {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  try {
    return parseStrictJson(utf8Decoder.decode(Buffer.concat(chunks, length)), {
      maximumBytes: MAXIMUM_RPC_RESPONSE_BYTES,
      maximumDepth: 16,
    });
  } catch {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
}

function classicV4RpcBlock(value: unknown) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  const record = value as Readonly<Record<string, unknown>>;
  return Object.freeze({
    number: rpcQuantityValue(record.number),
    hash: nonzeroHex32(record.hash),
    timestamp: rpcQuantityValue(record.timestamp),
  });
}

function classicV4RuntimeCodeHash(value: unknown) {
  if (typeof value !== "string" || !isHex(value, { strict: true })) {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  return keccak256(value).toLowerCase();
}

function classicV4RouterStampHashResult(value: unknown) {
  if (
    typeof value !== "string"
    || !/^0x[0-9a-fA-F]{64}$/u.test(value)
    || !isHex(value, { strict: true })
  ) {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  try {
    return decodeFunctionResult({
      abi: CLASSIC_V4_ROUTER_ABI,
      functionName: "launchAndStampV1",
      data: value,
    });
  } catch {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
}

function rpcQuantity(value: bigint) {
  if (value < 0n) {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  return `0x${value.toString(16)}`;
}

function rpcQuantityValue(value: unknown) {
  if (
    typeof value !== "string"
    || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)
  ) {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  return BigInt(value);
}

export async function validateClassicV4CanaryAuthorizationAgainstInstalledRequestV1(
  rawRequest: ClassicLaunchAuthorizationRequestV1,
  rawAuthorization: unknown,
  replayAuthorization: ClassicV4CanaryAuthorizationReplayV1,
): Promise<ClassicLaunchAuthorizationV1> {
  if (typeof replayAuthorization !== "function") {
    throw new TypeError("Classic V4 canary authorization replay is invalid");
  }
  const request = parseInstalledRequest(rawRequest as unknown as JsonValue);
  const installedLauncherCall = requireCanonicalInstalledLauncherCall(request);
  const authorization = parseDownloadedAuthorization(rawAuthorization);
  const gasEstimate = BigInt(authorization.simulation.gasEstimate);
  const gasLimit = BigInt(authorization.transaction.gasLimit);
  const validAfter = BigInt(authorization.validAfter);
  const deadline = BigInt(authorization.deadline);
  const blockTimestamp = BigInt(authorization.simulation.blockTimestamp);

  requireAuthorizationBinding(
    authorization.chainId === "1"
      && sameHex(
        authorization.releaseManifestDigest,
        request.releaseManifestDigest,
      )
      && sameAddress(authorization.predictedHook, request.feeHook)
      && sameAddress(authorization.transaction.from, request.launchWallet)
      && sameAddress(authorization.transaction.to, MAINNET_ROUTER)
      && authorization.transaction.valueWei === request.valueWei
      && gasLimit >= MINIMUM_GAS_LIMIT
      && gasLimit <= MAXIMUM_GAS_LIMIT
      && gasEstimate > 0n
      && gasLimit === maximumBigInt(
        MINIMUM_GAS_LIMIT,
        (gasEstimate * 120n + 99n) / 100n,
      )
      && validAfter <= blockTimestamp
      && blockTimestamp <= deadline
      && validAfter <= deadline
      && deadline - validAfter <= MAXIMUM_PERMIT_WINDOW_SECONDS,
  );

  const call = readClassicV4RouterCall(authorization.transaction.calldata);
  const [permit, stampRequest, routePayload, signature] = call.args;
  const route = readClassicV4Route(routePayload);
  requireAuthorizationBinding(
    encodeFunctionData({
      abi: CLASSIC_V4_ROUTER_ABI,
      functionName: "launchAndStampV1",
      args: [permit, stampRequest, routePayload, signature],
    }).toLowerCase() === authorization.transaction.calldata.toLowerCase()
      && encodeAbiParameters(CLASSIC_V4_ROUTE_PARAMETERS, [route])
        .toLowerCase() === routePayload.toLowerCase()
      && permit.chainId === 1n
      && sameAddress(permit.router, MAINNET_ROUTER)
      && sameAddress(permit.launchWallet, request.launchWallet)
      && permit.kind === CLASSIC_V4_KIND
      && permit.value === BigInt(request.valueWei)
      && isNonzeroHex32(permit.nonce)
      && permit.validAfter === validAfter
      && permit.deadline === deadline
      && sameHex(keccak256(routePayload), permit.routePayloadHash)
      && sameAddress(route.launcher, request.launcher)
      && sameHex(
        route.launcherRuntimeCodeHash,
        request.launcherRuntimeCodeHash,
      )
      && encodeFunctionData({
        abi: CLASSIC_V4_LAUNCHER_ABI,
        functionName: "launchFor",
        args: [request.launchWallet, route.parameters],
      }).toLowerCase() === request.launcherCalldata.toLowerCase()
      && sameAddress(
        installedLauncherCall.args[0],
        request.launchWallet,
      ),
  );

  requireClassicV4ExpectedResultBinding(
    request,
    authorization,
    stampRequest,
    route.expectedResult,
  );
  const resultHash = classicV4ResultHash(route.expectedResult);
  const stampRequestHash = classicV4StampRequestHash(stampRequest);
  const permitDigest = classicV4PermitDigest(permit);
  const stampHash = classicV4LaunchStampHash(
    permit,
    stampRequest,
    permitDigest,
  );
  requireAuthorizationBinding(
    sameHex(resultHash, permit.expectedResultHash)
      && sameHex(stampRequestHash, permit.stampRequestHash)
      && sameHex(permitDigest, authorization.permitDigest)
      && sameHex(stampHash, authorization.simulation.stampHash)
      && canonicalClassicV4Signature(signature),
  );

  await replayAuthorization(authorization);
  return authorization;
}

function parseDownloadedAuthorization(
  value: unknown,
): ClassicLaunchAuthorizationV1 {
  const record = exactRecord(value, [
    "chainId",
    "deadline",
    "permitDigest",
    "predictedHook",
    "predictedToken",
    "releaseManifestDigest",
    "schemaVersion",
    "simulation",
    "transaction",
    "validAfter",
  ]);
  const simulation = exactRecord(record.simulation, [
    "blockHash",
    "blockNumber",
    "blockTimestamp",
    "gasEstimate",
    "stampHash",
  ]);
  const transaction = exactRecord(record.transaction, [
    "calldata",
    "chainId",
    "from",
    "gasLimit",
    "to",
    "valueWei",
  ]);
  if (
    record.schemaVersion !== CLASSIC_LAUNCH_AUTHORIZATION_SCHEMA_V1
    || record.chainId !== "1"
    || transaction.chainId !== "1"
  ) {
    throw new TypeError("Classic V4 canary authorization is invalid");
  }
  return Object.freeze({
    schemaVersion: CLASSIC_LAUNCH_AUTHORIZATION_SCHEMA_V1,
    chainId: "1",
    releaseManifestDigest: nonzeroHex32(record.releaseManifestDigest),
    predictedToken: nonzeroAddress(record.predictedToken),
    predictedHook: nonzeroAddress(record.predictedHook),
    permitDigest: nonzeroHex32(record.permitDigest),
    validAfter: uint256Decimal(record.validAfter),
    deadline: positiveUint256Decimal(record.deadline),
    simulation: Object.freeze({
      blockNumber: positiveUint256Decimal(simulation.blockNumber),
      blockHash: nonzeroHex32(simulation.blockHash),
      blockTimestamp: positiveUint256Decimal(simulation.blockTimestamp),
      gasEstimate: positiveUint256Decimal(simulation.gasEstimate),
      stampHash: nonzeroHex32(simulation.stampHash),
    }),
    transaction: Object.freeze({
      chainId: "1",
      from: nonzeroAddress(transaction.from),
      to: nonzeroAddress(transaction.to),
      valueWei: uint256Decimal(transaction.valueWei),
      calldata: authorizationCalldata(transaction.calldata),
      gasLimit: positiveUint256Decimal(transaction.gasLimit),
    }),
  });
}

function requireCanonicalInstalledLauncherCall(
  request: ClassicLaunchAuthorizationRequestV1,
) {
  let call: ReturnType<typeof decodeFunctionData<typeof CLASSIC_V4_LAUNCHER_ABI>>;
  try {
    call = decodeFunctionData({
      abi: CLASSIC_V4_LAUNCHER_ABI,
      data: request.launcherCalldata,
    });
  } catch {
    throw new TypeError("Classic V4 canary launcher calldata is invalid");
  }
  if (
    call.functionName !== "launchFor"
    || !sameAddress(call.args[0], request.launchWallet)
    || call.args[1].initialBuyCustody.mode !== 0
    || call.args[1].initialBuyCustody.durationDays !== 0
    || call.args[1].initialBuyCustody.cliffDays !== 0
    || encodeFunctionData({
      abi: CLASSIC_V4_LAUNCHER_ABI,
      functionName: "launchFor",
      args: call.args,
    }).toLowerCase() !== request.launcherCalldata.toLowerCase()
  ) {
    throw new TypeError("Classic V4 canary launcher calldata is invalid");
  }
  return call;
}

function readClassicV4RouterCall(data: Hex) {
  try {
    const call = decodeFunctionData({ abi: CLASSIC_V4_ROUTER_ABI, data });
    if (call.functionName !== "launchAndStampV1") throw new TypeError();
    return call;
  } catch {
    throw new TypeError("Classic V4 canary Router calldata is invalid");
  }
}

function readClassicV4Route(routePayload: Hex) {
  try {
    return decodeAbiParameters(CLASSIC_V4_ROUTE_PARAMETERS, routePayload)[0];
  } catch {
    throw new TypeError("Classic V4 canary Router route is invalid");
  }
}

function requireClassicV4ExpectedResultBinding(
  request: ClassicLaunchAuthorizationRequestV1,
  authorization: ClassicLaunchAuthorizationV1,
  stampRequest: ReturnType<typeof readClassicV4RouterCall>["args"][1],
  result: ReturnType<typeof readClassicV4Route>["expectedResult"],
) {
  const poolKey = stampRequest.poolKey;
  const components = stampRequest.components;
  requireAuthorizationBinding(
    isNonzeroAddress(result.token)
      && isNonzeroAddress(result.rewardVault)
      && isNonzeroAddress(result.positionRecipient)
      && result.positionTokenId === 0n
      && result.tokenLiquidityAmount > 0n
      && result.tokenLiquidityAmount + result.lockedTokenDust
        === CLASSIC_V4_TOKEN_SUPPLY
      && result.initialBuyNativeAmount === BigInt(request.valueWei)
      && result.initialBuyTokenAmount > 0n
      && sameAddress(result.initialBuyCustody, ZERO_ADDRESS)
      && isNonzeroHex32(result.poolId)
      && isNonzeroHex32(result.launchHash)
      && sameAddress(authorization.predictedToken, result.token)
      && sameAddress(authorization.predictedHook, request.feeHook)
      && isNonzeroHex32(stampRequest.launchId)
      && sameAddress(stampRequest.token, result.token)
      && isNonzeroHex32(stampRequest.tokenRuntimeCodeHash)
      && sameAddress(poolKey.currency0, ZERO_ADDRESS)
      && sameAddress(poolKey.currency1, result.token)
      && poolKey.fee === CLASSIC_V4_LP_FEE_PIPS
      && poolKey.tickSpacing === CLASSIC_V4_TICK_SPACING
      && sameAddress(poolKey.hooks, request.feeHook)
      && sameHex(
        stampRequest.hookRuntimeCodeHash,
        request.feeHookRuntimeCodeHash,
      )
      && sameHex(classicV4PoolId(poolKey), result.poolId)
      && components.length === 4,
  );

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!;
    requireAuthorizationBinding(
      isNonzeroAddress(component.account)
        && isNonzeroHex32(component.runtimeCodeHash)
        && (index === 0
          || BigInt(components[index - 1]!.account) < BigInt(component.account)),
    );
  }
  const byResultIndex = new Map(
    components.map((component) => [component.resultIndex, component]),
  );
  const token = byResultIndex.get(0);
  const reward = byResultIndex.get(1);
  const position = byResultIndex.get(2);
  const hook = byResultIndex.get(255);
  requireAuthorizationBinding(
    byResultIndex.size === 4
      && token !== undefined
      && sameAddress(token.account, result.token)
      && sameHex(token.runtimeCodeHash, stampRequest.tokenRuntimeCodeHash)
      && token.kind === 1
      && token.scope === 1
      && reward !== undefined
      && sameAddress(reward.account, result.rewardVault)
      && reward.kind === 0
      && reward.scope === 1
      && position !== undefined
      && sameAddress(position.account, result.positionRecipient)
      && position.kind === 0
      && position.scope === 1
      && hook !== undefined
      && sameAddress(hook.account, request.feeHook)
      && sameHex(hook.runtimeCodeHash, request.feeHookRuntimeCodeHash)
      && sameHex(hook.runtimeCodeHash, stampRequest.hookRuntimeCodeHash)
      && hook.kind === 2
      && hook.scope === 2,
  );
}

function classicV4PoolId(poolKey: Readonly<{
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}>) {
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

function classicV4PoolKeyHash(
  poolKey: Parameters<typeof classicV4PoolId>[0],
) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks",
    ),
    [
      POOL_KEY_TYPEHASH,
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ],
  ));
}

function classicV4ComponentSetHash(
  components: ReturnType<typeof readClassicV4RouterCall>["args"][1]["components"],
) {
  const hashes = components.map((component) => keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope",
    ),
    [
      COMPONENT_TYPEHASH,
      component.resultIndex,
      component.account,
      component.runtimeCodeHash,
      component.kind,
      component.scope,
    ],
  )));
  if (hashes.length === 0) {
    throw new TypeError("Classic V4 canary components are invalid");
  }
  return keccak256(concat(hashes as unknown as readonly [Hex, ...Hex[]]));
}

function classicV4StampRequestHash(
  request: ReturnType<typeof readClassicV4RouterCall>["args"][1],
) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash",
    ),
    [
      STAMP_REQUEST_TYPEHASH,
      request.launchId,
      request.token,
      request.tokenRuntimeCodeHash,
      classicV4PoolKeyHash(request.poolKey),
      request.hookRuntimeCodeHash,
      classicV4ComponentSetHash(request.components),
    ],
  ));
}

function classicV4ResultHash(
  result: ReturnType<typeof readClassicV4Route>["expectedResult"],
) {
  const addressesHash = keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,address token,address rewardVault,address positionRecipient,address initialBuyCustody",
    ),
    [
      CLASSIC_RESULT_ADDRESSES_TYPEHASH,
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
      CLASSIC_RESULT_AMOUNTS_TYPEHASH,
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
    [
      CLASSIC_RESULT_TYPEHASH,
      addressesHash,
      amountsHash,
      result.poolId,
      result.launchHash,
    ],
  ));
}

function classicV4PermitDigest(
  permit: ReturnType<typeof readClassicV4RouterCall>["args"][0],
) {
  return hashTypedData({
    domain: {
      name: "ProgrammableLaunchStampRouter",
      version: "1",
      chainId: 1,
      verifyingContract: MAINNET_ROUTER,
    },
    types: CLASSIC_V4_LAUNCH_PERMIT_TYPES,
    primaryType: "ProgrammableLaunchPermitV1",
    message: permit,
  });
}

function classicV4LaunchStampHash(
  permit: ReturnType<typeof readClassicV4RouterCall>["args"][0],
  stampRequest: ReturnType<typeof readClassicV4RouterCall>["args"][1],
  permitDigest: Hex,
) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,uint256 chainId,address router,bytes32 launchId,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 permitDigest,address poolManager,bytes32 poolId",
    ),
    [
      LAUNCH_STAMP_TYPEHASH,
      1n,
      MAINNET_ROUTER,
      stampRequest.launchId,
      permit.launchWallet,
      permit.kind,
      permit.routePayloadHash,
      permit.expectedResultHash,
      permit.stampRequestHash,
      permitDigest,
      MAINNET_POOL_MANAGER,
      classicV4PoolId(stampRequest.poolKey),
    ],
  ));
}

function canonicalClassicV4Signature(signature: Hex) {
  if (!/^0x[0-9a-fA-F]{130}$/u.test(signature)) return false;
  const r = BigInt(`0x${signature.slice(2, 66)}`);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);
  return r > 0n
    && r < SECP256K1_ORDER
    && s > 0n
    && s <= SECP256K1_HALF_ORDER
    && (v === 27 || v === 28);
}

function maximumBigInt(left: bigint, right: bigint) {
  return left >= right ? left : right;
}

function requireAuthorizationBinding(condition: unknown): asserts condition {
  if (!condition) {
    throw new TypeError("Classic V4 canary authorization binding is invalid");
  }
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function isNonzeroAddress(value: string) {
  return isAddress(value) && !sameAddress(value, ZERO_ADDRESS);
}

function isNonzeroHex32(value: string) {
  return isHex(value, { strict: true })
    && value.length === 66
    && BigInt(value) !== 0n;
}

function parseInstalledRequest(value: JsonValue) {
  const record = exactRecord(value, [
    "chainId",
    "feeHook",
    "feeHookRuntimeCodeHash",
    "launchWallet",
    "launcher",
    "launcherCalldata",
    "launcherRuntimeCodeHash",
    "releaseManifestDigest",
    "schemaVersion",
    "valueWei",
  ]);
  if (
    record.schemaVersion !== CLASSIC_LAUNCH_AUTHORIZATION_REQUEST_SCHEMA_V1
    || record.chainId !== "1"
  ) {
    throw new TypeError("Classic V4 canary authorization request is invalid");
  }
  return Object.freeze({
    schemaVersion: CLASSIC_LAUNCH_AUTHORIZATION_REQUEST_SCHEMA_V1,
    chainId: "1" as const,
    launchWallet: nonzeroAddress(record.launchWallet),
    releaseManifestDigest: nonzeroHex32(record.releaseManifestDigest),
    launcher: nonzeroAddress(record.launcher),
    launcherRuntimeCodeHash: nonzeroHex32(record.launcherRuntimeCodeHash),
    feeHook: nonzeroAddress(record.feeHook),
    feeHookRuntimeCodeHash: nonzeroHex32(record.feeHookRuntimeCodeHash),
    valueWei: positiveUint256Decimal(record.valueWei),
    launcherCalldata: calldata(record.launcherCalldata),
  }) satisfies ClassicLaunchAuthorizationRequestV1;
}

async function readAuthorizationCommand(
  request: Request,
): Promise<AuthorizationCommandV1> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]
    ?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new CanaryAuthorizationLaneErrorV1(
      415,
      "unsupported_media_type",
      "Reload the page and try the authorization request again.",
    );
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null
    && (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength)
      || BigInt(declaredLength) > BigInt(MAXIMUM_COMMAND_BYTES))
  ) {
    throw new CanaryAuthorizationLaneErrorV1(
      413,
      "request_too_large",
      "Reload the page and try the authorization request again.",
    );
  }
  const source = await readBoundedCommandSource(request);

  let parsed: JsonValue;
  try {
    parsed = parseStrictJson(source, {
      maximumBytes: MAXIMUM_COMMAND_BYTES,
      maximumDepth: 4,
    });
  } catch {
    throw new CanaryAuthorizationLaneErrorV1(
      400,
      "invalid_command",
      "Reload the page and try the authorization request again.",
    );
  }
  try {
    const record = exactRecord(parsed, [
      "authorizationRequestDigest",
      "schemaVersion",
    ]);
    if (
      record.schemaVersion
        !== CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1
    ) {
      throw new TypeError("Classic V4 canary command schema is invalid");
    }
    return Object.freeze({
      schemaVersion: CLASSIC_V4_CANARY_AUTHORIZATION_COMMAND_SCHEMA_V1,
      authorizationRequestDigest: nonzeroHex32(
        record.authorizationRequestDigest,
      ),
    });
  } catch {
    throw new CanaryAuthorizationLaneErrorV1(
      400,
      "invalid_command",
      "Reload the page and try the authorization request again.",
    );
  }
}

async function readBoundedCommandSource(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new CanaryAuthorizationLaneErrorV1(
      400,
      "invalid_command",
      "Reload the page and try the authorization request again.",
    );
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > MAXIMUM_COMMAND_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new CanaryAuthorizationLaneErrorV1(
        413,
        "request_too_large",
        "Reload the page and try the authorization request again.",
      );
    }
    chunks.push(part.value);
  }
  if (length === 0) {
    throw new CanaryAuthorizationLaneErrorV1(
      400,
      "invalid_command",
      "Reload the page and try the authorization request again.",
    );
  }
  try {
    return utf8Decoder.decode(Buffer.concat(chunks, length));
  } catch {
    throw new CanaryAuthorizationLaneErrorV1(
      400,
      "invalid_command",
      "Reload the page and try the authorization request again.",
    );
  }
}

function requireSameOriginBrowserRequest(request: Request) {
  const origin = request.headers.get("origin");
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    throw new CanaryAuthorizationLaneErrorV1(
      403,
      "origin_forbidden",
      "Open the authorization page on Programmable and try again.",
    );
  }
  if (
    origin !== requestOrigin
    || request.headers.get("sec-fetch-site") !== "same-origin"
  ) {
    throw new CanaryAuthorizationLaneErrorV1(
      403,
      "origin_forbidden",
      "Open the authorization page on Programmable and try again.",
    );
  }
}

function unexpectedLaneErrorResponse(error: unknown) {
  const requestId = randomUUID();
  console.error("Classic V4 canary authorization lane failed", {
    name: error instanceof Error
      ? error.name
      : "ClassicV4CanaryAuthorizationError",
    requestId,
  });
  return errorResponse(
    503,
    "classic_v4_canary_authorization_unavailable",
    "Authorization is unavailable. Verify the installed request and try again.",
    requestId,
  );
}

function methodNotAllowedResponse() {
  return jsonResponse({
    error: {
      code: "method_not_allowed",
      message: "Use the authorization page to request this download.",
    },
  }, 405, { Allow: "POST" });
}

function bridgeErrorResponse(error: ClassicLaunchAuthorizationBridgeErrorV1) {
  const authenticationFailure = error.status === 401 || error.status === 403;
  const message = authenticationFailure
    ? "Reconnect the installed launch wallet and try again."
    : error.status === 400 || error.status === 409
      ? "The installed request is no longer valid. Rebuild and reinstall it."
      : error.status === 429
        ? "Authorization is rate limited. Wait and try again."
        : "Authorization is unavailable. Verify the installed request and try again.";
  return errorResponse(
    error.status >= 400 && error.status <= 599 ? error.status : 503,
    error.code,
    message,
    error.requestId,
    error.retryAfter,
  );
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string | null = null,
  retryAfter: string | null = null,
) {
  return jsonResponse({
    error: {
      code,
      message,
      ...(requestId ? { requestId } : {}),
    },
  }, status, retryAfter ? { "Retry-After": retryAfter } : undefined);
}

function jsonResponse(
  value: unknown,
  status: number,
  extraHeaders?: Readonly<Record<string, string>>,
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "Content-Type": "application/json; charset=utf-8",
      "Cross-Origin-Resource-Policy": "same-origin",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      Vary: "Authorization, X-Privy-Identity-Token, Origin, Sec-Fetch-Site",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (
    value === null
    || Array.isArray(value)
    || typeof value !== "object"
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())
  ) {
    throw new TypeError("Classic V4 canary authorization value is invalid");
  }
  return value as Readonly<Record<string, unknown>>;
}

function nonzeroAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new TypeError("Classic V4 canary authorization address is invalid");
  }
  const result = getAddress(value);
  if (result.toLowerCase() === ZERO_ADDRESS) {
    throw new TypeError("Classic V4 canary authorization address is invalid");
  }
  return result;
}

function nonzeroHex32(value: unknown): Hex {
  if (
    typeof value !== "string"
    || !isHex(value, { strict: true })
    || value.length !== 66
    || BigInt(value) === 0n
  ) {
    throw new TypeError("Classic V4 canary authorization digest is invalid");
  }
  return value.toLowerCase() as Hex;
}

function calldata(value: unknown): Hex {
  if (
    typeof value !== "string"
    || !isHex(value, { strict: true })
    || value.length < 10
  ) {
    throw new TypeError("Classic V4 canary launcher calldata is invalid");
  }
  return value.toLowerCase() as Hex;
}

function authorizationCalldata(value: unknown): Hex {
  if (
    typeof value !== "string"
    || !isHex(value, { strict: true })
    || value.length < 10
  ) {
    throw new TypeError("Classic V4 canary Router calldata is invalid");
  }
  return value.toLowerCase() as Hex;
}

function uint256Decimal(value: unknown) {
  if (
    typeof value !== "string"
    || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || BigInt(value) >= 2n ** 256n
  ) {
    throw new TypeError("Classic V4 canary value is invalid");
  }
  return value;
}

function positiveUint256Decimal(value: unknown) {
  const result = uint256Decimal(value);
  if (BigInt(result) === 0n) {
    throw new TypeError("Classic V4 canary value is invalid");
  }
  return result;
}

function requiredEnvironment(environment: Environment, name: string) {
  const value = environment[name];
  if (!value || value !== value.trim()) {
    throw new TypeError(`${name} is not configured`);
  }
  return value;
}
