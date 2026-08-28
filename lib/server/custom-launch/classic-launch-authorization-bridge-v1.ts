import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import {
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import { parseStrictJson, type JsonValue } from
  "../projection-target/canonical-json";
import {
  createPrivyWalletPrincipalAuthenticatorV1,
  WalletPrincipalAuthenticationErrorV1,
  type WalletPrincipalAuthenticatorV1,
} from "../creator-article/wallet-principal.server";
import {
  PreservedBackendPublicErrorV1,
  readPreservedBackendPublicErrorV1,
} from "./backend-public-error-v1";
import {
  createWalletAdminBffAssertionV2,
  requireWalletAdminBffAssertionKeyV2,
} from "./wallet-admin-bff-assertion-v2";

export const CLASSIC_LAUNCH_AUTHORIZATION_REQUEST_SCHEMA_V1 =
  "programmable.classic-launch-authorization-request.v1" as const;
export const CLASSIC_LAUNCH_AUTHORIZATION_SCHEMA_V1 =
  "programmable.classic-launch-authorization.v1" as const;

const AUTHORIZATION_PATH =
  "/v1/wallet-admin/classic-launches/authorization";
const MAXIMUM_BACKEND_BODY_BYTES = 65_536;
const DEFAULT_BACKEND_TIMEOUT_MS = 45_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAINNET_ROUTER = "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56";
const MINIMUM_GAS_LIMIT = 1_500_000n;
const MAXIMUM_GAS_LIMIT = 13_500_000n;

export type ClassicLaunchAuthorizationRequestV1 = Readonly<{
  schemaVersion: typeof CLASSIC_LAUNCH_AUTHORIZATION_REQUEST_SCHEMA_V1;
  chainId: "1";
  launchWallet: Address;
  releaseManifestDigest: Hex;
  launcher: Address;
  launcherRuntimeCodeHash: Hex;
  feeHook: Address;
  feeHookRuntimeCodeHash: Hex;
  valueWei: string;
  launcherCalldata: Hex;
}>;

export type ClassicLaunchAuthorizationV1 = Readonly<{
  schemaVersion: typeof CLASSIC_LAUNCH_AUTHORIZATION_SCHEMA_V1;
  chainId: "1";
  releaseManifestDigest: Hex;
  predictedToken: Address;
  predictedHook: Address;
  permitDigest: Hex;
  validAfter: string;
  deadline: string;
  simulation: Readonly<{
    blockNumber: string;
    blockHash: Hex;
    blockTimestamp: string;
    gasEstimate: string;
    stampHash: Hex;
  }>;
  transaction: Readonly<{
    chainId: "1";
    from: Address;
    to: Address;
    valueWei: string;
    calldata: Hex;
    gasLimit: string;
  }>;
}>;

export class ClassicLaunchAuthorizationBridgeErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null = null,
    readonly retryAfter: string | null = null,
  ) {
    super(code);
    this.name = "ClassicLaunchAuthorizationBridgeErrorV1";
  }
}

export interface ClassicLaunchAuthorizationBridgeV1 {
  authorize(
    request: Request,
    input: ClassicLaunchAuthorizationRequestV1,
  ): Promise<ClassicLaunchAuthorizationV1>;
}

export function createClassicLaunchAuthorizationBridgeV1(input: Readonly<{
  authenticator: WalletPrincipalAuthenticatorV1;
  backendBaseUrl: string;
  websiteToken: string;
  bffAssertionKeyV2: string;
  fetchBackend: typeof fetch;
  backendTimeoutMs?: number;
  assertionNow?: () => Date;
  assertionNonce?: () => string;
}>): ClassicLaunchAuthorizationBridgeV1 {
  const backendBaseUrl = normalizedBackendBaseUrl(input.backendBaseUrl);
  const websiteToken = boundedWebsiteToken(input.websiteToken);
  const assertionKey = requireWalletAdminBffAssertionKeyV2(
    input.bffAssertionKeyV2,
    websiteToken,
  );
  const timeoutMs = input.backendTimeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS;
  const assertionNow = input.assertionNow ?? (() => new Date());
  const assertionNonce = input.assertionNonce
    ?? (() => randomBytes(16).toString("base64url"));
  if (
    typeof input.authenticator?.authenticate !== "function"
    || typeof input.fetchBackend !== "function"
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1_000
    || timeoutMs > 60_000
  ) throw new TypeError("Classic launch bridge configuration is invalid");

  const bridge: ClassicLaunchAuthorizationBridgeV1 = {
    async authorize(request, rawInput) {
      try {
        const requestInput = parseRequest(rawInput);
        const principal = await input.authenticator.authenticate(request);
        const launchWallet = requireLinkedWallet(
          principal.wallets,
          requestInput.launchWallet,
        );
        const body = Object.freeze({
          ...requestInput,
          launchWallet,
        });
        const bodyBytes = Buffer.from(JSON.stringify(body), "utf8");
        const backendUrl = new URL(AUTHORIZATION_PATH, backendBaseUrl);
        const assertion = createWalletAdminBffAssertionV2({
          method: "POST",
          requestTarget: backendUrl.pathname,
          privyUserId: principal.privyUserId,
          walletAddress: launchWallet,
          issuedAt: assertionNow().toISOString(),
          nonce: assertionNonce(),
          bodyBytes,
          assertionKey,
        });
        const signal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(timeoutMs),
        ]);
        const response = await input.fetchBackend(backendUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${websiteToken}`,
            "Content-Type": "application/json",
            "X-Programmable-Privy-User-Id": principal.privyUserId,
            "X-Programmable-Wallet-Address": launchWallet,
            ...assertion,
          },
          body: bodyBytes,
          cache: "no-store",
          redirect: "error",
          signal,
        });
        if (!response.ok) throw await mappedBackendError(response);
        if (response.status !== 200) throw new BackendContractErrorV1();
        return parseAuthorization(
          await readBoundedBackendJson(response),
          requestInput,
        );
      } catch (error) {
        if (error instanceof ClassicLaunchAuthorizationBridgeErrorV1) {
          throw error;
        }
        if (error instanceof WalletPrincipalAuthenticationErrorV1) {
          throw new ClassicLaunchAuthorizationBridgeErrorV1(
            error.status,
            error.code,
          );
        }
        if (error instanceof PreservedBackendPublicErrorV1) {
          throw new ClassicLaunchAuthorizationBridgeErrorV1(
            error.status,
            error.code,
            error.requestId,
            error.retryAfter,
          );
        }
        const requestId = randomUUID();
        console.error("Classic launch authorization bridge failed", {
          name: error instanceof Error ? error.name : "ClassicAuthorizationError",
          requestId,
        });
        throw new ClassicLaunchAuthorizationBridgeErrorV1(
          503,
          "CLASSIC_LAUNCH_AUTHORIZATION_UNAVAILABLE",
          requestId,
        );
      }
    },
  };
  return Object.freeze(bridge);
}

let productionBridge: ClassicLaunchAuthorizationBridgeV1 | null = null;

export function getProductionClassicLaunchAuthorizationBridgeV1() {
  productionBridge ??= createClassicLaunchAuthorizationBridgeV1({
    authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    backendBaseUrl: requiredEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL",
    ),
    websiteToken: requiredEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN",
    ),
    bffAssertionKeyV2: requiredRawEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2",
    ),
    fetchBackend: fetch,
  });
  return productionBridge;
}

function parseRequest(
  value: ClassicLaunchAuthorizationRequestV1,
): ClassicLaunchAuthorizationRequestV1 {
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
  ) throw new BackendContractErrorV1();
  return Object.freeze({
    schemaVersion: CLASSIC_LAUNCH_AUTHORIZATION_REQUEST_SCHEMA_V1,
    chainId: "1",
    launchWallet: address(record.launchWallet),
    releaseManifestDigest: hex32(record.releaseManifestDigest),
    launcher: address(record.launcher),
    launcherRuntimeCodeHash: hex32(record.launcherRuntimeCodeHash),
    feeHook: address(record.feeHook),
    feeHookRuntimeCodeHash: hex32(record.feeHookRuntimeCodeHash),
    valueWei: decimal(record.valueWei),
    launcherCalldata: calldata(record.launcherCalldata),
  });
}

function parseAuthorization(
  value: JsonValue,
  request: ClassicLaunchAuthorizationRequestV1,
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
  const validAfter = decimal(record.validAfter);
  const deadline = decimal(record.deadline);
  const blockTimestamp = decimal(simulation.blockTimestamp);
  const gasLimit = decimal(transaction.gasLimit);
  if (
    record.schemaVersion !== CLASSIC_LAUNCH_AUTHORIZATION_SCHEMA_V1
    || record.chainId !== "1"
    || transaction.chainId !== "1"
    || hex32(record.releaseManifestDigest).toLowerCase()
      !== request.releaseManifestDigest.toLowerCase()
    || address(record.predictedHook).toLowerCase()
      !== request.feeHook.toLowerCase()
    || address(transaction.from).toLowerCase()
      !== request.launchWallet.toLowerCase()
    || address(transaction.to).toLowerCase() !== MAINNET_ROUTER.toLowerCase()
    || decimal(transaction.valueWei) !== request.valueWei
    || BigInt(validAfter) > BigInt(blockTimestamp)
    || BigInt(deadline) < BigInt(blockTimestamp)
    || BigInt(deadline) - BigInt(validAfter) > 330n
    || BigInt(gasLimit) < MINIMUM_GAS_LIMIT
    || BigInt(gasLimit) > MAXIMUM_GAS_LIMIT
  ) throw new BackendContractErrorV1();
  return Object.freeze({
    schemaVersion: CLASSIC_LAUNCH_AUTHORIZATION_SCHEMA_V1,
    chainId: "1",
    releaseManifestDigest: hex32(record.releaseManifestDigest),
    predictedToken: address(record.predictedToken),
    predictedHook: address(record.predictedHook),
    permitDigest: hex32(record.permitDigest),
    validAfter,
    deadline,
    simulation: Object.freeze({
      blockNumber: decimal(simulation.blockNumber),
      blockHash: hex32(simulation.blockHash),
      blockTimestamp,
      gasEstimate: decimal(simulation.gasEstimate),
      stampHash: hex32(simulation.stampHash),
    }),
    transaction: Object.freeze({
      chainId: "1",
      from: address(transaction.from),
      to: address(transaction.to),
      valueWei: decimal(transaction.valueWei),
      calldata: calldata(transaction.calldata),
      gasLimit,
    }),
  });
}

async function readBoundedBackendJson(response: Response): Promise<JsonValue> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MAXIMUM_BACKEND_BODY_BYTES
  ) throw new BackendContractErrorV1();
  const text = await response.text();
  if (!text || Buffer.byteLength(text, "utf8") > MAXIMUM_BACKEND_BODY_BYTES) {
    throw new BackendContractErrorV1();
  }
  try {
    return parseStrictJson(text, {
      maximumBytes: MAXIMUM_BACKEND_BODY_BYTES,
      maximumDepth: 16,
    });
  } catch {
    throw new BackendContractErrorV1();
  }
}

async function mappedBackendError(response: Response) {
  const preserved = await readPreservedBackendPublicErrorV1(response);
  return preserved ?? new BackendContractErrorV1();
}

function requireLinkedWallet(
  wallets: readonly `0x${string}`[],
  candidate: Address,
): Address {
  const wallet = getAddress(candidate);
  if (!wallets.some((entry) => entry.toLowerCase() === wallet.toLowerCase())) {
    throw new ClassicLaunchAuthorizationBridgeErrorV1(
      403,
      "wallet_not_linked",
    );
  }
  return wallet;
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
  ) throw new BackendContractErrorV1();
  return value as Readonly<Record<string, unknown>>;
}

function address(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new BackendContractErrorV1();
  }
  const result = getAddress(value);
  if (result === ZERO_ADDRESS) throw new BackendContractErrorV1();
  return result;
}

function hex32(value: unknown): Hex {
  if (
    typeof value !== "string"
    || !isHex(value, { strict: true })
    || value.length !== 66
    || BigInt(value) === 0n
  ) throw new BackendContractErrorV1();
  return value.toLowerCase() as Hex;
}

function calldata(value: unknown): Hex {
  if (
    typeof value !== "string"
    || !isHex(value, { strict: true })
    || value.length < 10
  ) throw new BackendContractErrorV1();
  return value.toLowerCase() as Hex;
}

function decimal(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || BigInt(value) >= 2n ** 256n
  ) throw new BackendContractErrorV1();
  return value;
}

function normalizedBackendBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Custom launch API base URL is invalid");
  }
  const localHttp = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !localHttp)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) throw new TypeError("Custom launch API base URL is invalid");
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  return url;
}

function boundedWebsiteToken(value: string) {
  if (
    typeof value !== "string"
    || value.length < 43
    || value.length > 512
    || /[\s\u0000]/u.test(value)
  ) throw new TypeError("Custom launch Website token is invalid");
  return value;
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function requiredRawEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

class BackendContractErrorV1 extends Error {
  constructor() {
    super("Classic launch backend contract is invalid");
    this.name = "BackendContractErrorV1";
  }
}
