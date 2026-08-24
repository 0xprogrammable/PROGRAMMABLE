import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import {
  PREDICTION_V2_EXECUTION_ROUTER_ABI,
  PREDICTION_V2_VAULT_ABI,
} from "./abi";
import {
  PREDICTION_V2_ONCHAIN_DEADLINE_MAX_TTL_SECONDS,
  PREDICTION_V2_PREPARED_ACTIONS_V2,
  PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID,
  PREDICTION_V2_PREPARED_TRANSACTION_MAX_TTL_SECONDS,
  PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2,
  type PredictionV2PreparedActionV2,
  type PredictionV2PreparedTransactionExpectationV2,
} from "./prepared-transaction-v2";

export const PREDICTION_V2_CLIENT_API_ERROR_SCHEMA_V2 =
  "programmable.prediction-v2.client-error.v2" as const;
export const PREDICTION_V2_CLIENT_API_MAXIMUM_BODY_BYTES_V2 = 128 * 1_024;

const UINT64_MAX = (1n << 64n) - 1n;
const MAXIMUM_CLOCK_SKEW_SECONDS = 30n;
const MAXIMUM_REQUEST_NODES = 2_048;
const MAXIMUM_REQUEST_DEPTH = 12;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const CALLDATA_PATTERN = /^0x[0-9a-f]+$/u;
const RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const RPC_CHAIN_ID_PATTERN = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-f]{64}$/u;
const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

type JsonPrimitiveV2 = string | number | boolean | null;
export type PredictionV2ClientJsonValueV2 =
  | JsonPrimitiveV2
  | readonly PredictionV2ClientJsonValueV2[]
  | PredictionV2ClientJsonObjectV2;
export type PredictionV2ClientJsonObjectV2 = Readonly<{
  [key: string]: PredictionV2ClientJsonValueV2;
}>;

export type PredictionV2ClientApiErrorBodyV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_CLIENT_API_ERROR_SCHEMA_V2;
  code: string;
  message: string;
  retryable: boolean;
}>;

declare const PREDICTION_V2_PARSED_TRANSACTION: unique symbol;

export type ParsedPredictionV2PreparedTransactionV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2;
  releaseId: string;
  releaseBindingHash: Hex;
  chainId: typeof PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID;
  action: PredictionV2PreparedActionV2;
  actionId: Hex;
  calldataHash: Hex;
  kind: "buy" | "sell" | "finalize" | "redeem";
  confirmedBlockNumber: bigint;
  confirmedBlockHash: Hex;
  marketId: Hex;
  marketVault: Address;
  account: Address;
  issuedAtUnixSeconds: bigint;
  expiresAtUnixSeconds: bigint;
  transaction: Readonly<{
    to: Address;
    data: Hex;
    value: 0n;
    gasLimit: bigint;
  }>;
  readonly [PREDICTION_V2_PARSED_TRANSACTION]: true;
}>;

export type PredictionV2ConnectedWalletV2 = Readonly<{
  account: string;
  chainId: number;
}>;

export type PredictionV2PrivyWalletConnectionV2<
  WalletCapability extends object,
> = PredictionV2ConnectedWalletV2 & Readonly<{
  wallet: WalletCapability;
}>;

export type PredictionV2Eip1193ProviderV2 = Readonly<{
  request(input: Readonly<{
    method: "eth_chainId" | "eth_accounts" | "eth_sendTransaction";
    params?: readonly unknown[];
  }>): Promise<unknown>;
}>;

const PARSED_TRANSACTIONS = new WeakSet<object>();
/** Captured once; caller-supplied transports can never enter the brand mint. */
const SAME_ORIGIN_FETCH = typeof globalThis.fetch === "function"
  ? globalThis.fetch.bind(globalThis)
  : null;
const TOP_LEVEL_FIELDS = [
  "schemaVersion",
  "releaseId",
  "releaseBindingHash",
  "chainId",
  "action",
  "actionId",
  "calldataHash",
  "kind",
  "confirmedBlockNumber",
  "confirmedBlockHash",
  "marketId",
  "marketVault",
  "account",
  "issuedAtUnixSeconds",
  "expiresAtUnixSeconds",
  "transaction",
] as const;
const TRANSACTION_FIELDS = ["to", "data", "value", "gasLimit"] as const;
const EXPECTATION_FIELDS = [
  "releaseId",
  "releaseBindingHash",
  "action",
  "actionId",
  "calldataHash",
  "minimumConfirmedBlockNumber",
  "minimumConfirmedBlockHash",
  "marketId",
  "marketVault",
  "account",
  "target",
] as const;

export class PredictionV2ClientApiErrorV2 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "PredictionV2ClientApiErrorV2";
  }
}

function invalid(label: string): never {
  throw new TypeError(`Invalid Protocol V2 client API ${label}.`);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(label);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(label);
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string") ||
    !fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, field);
      return descriptor !== undefined &&
        descriptor.enumerable &&
        Object.hasOwn(descriptor, "value");
    })
  ) {
    invalid(`${label} fields`);
  }
  return record;
}

function boundedText(value: unknown, label: string, maximumLength: number) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    invalid(label);
  }
  return value;
}

function nonzeroAddress(value: unknown, label: string): Address {
  if (
    typeof value !== "string" ||
    !isAddress(value, { strict: false }) ||
    value.toLowerCase() === zeroAddress
  ) {
    invalid(label);
  }
  return getAddress(value);
}

function nonzeroBytes32(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !BYTES32_PATTERN.test(value) ||
    value === ZERO_BYTES32
  ) {
    invalid(label);
  }
  return value as Hex;
}

function canonicalUintString(
  value: unknown,
  label: string,
  maximum: bigint,
): bigint {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !/^[1-9][0-9]*$/u.test(value)
  ) {
    invalid(label);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) invalid(label);
  return parsed;
}

function calldata(value: unknown): Hex {
  if (
    typeof value !== "string" ||
    !CALLDATA_PATTERN.test(value) ||
    value.length < 10 ||
    value.length % 2 !== 0 ||
    value.length > 65_538
  ) {
    invalid("calldata");
  }
  return value as Hex;
}

function action(value: unknown): PredictionV2PreparedActionV2 {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(PREDICTION_V2_PREPARED_ACTIONS_V2, value)
  ) {
    invalid("action");
  }
  return value as PredictionV2PreparedActionV2;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function currentUnixSeconds(): bigint {
  const milliseconds = Date.now();
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    invalid("current time");
  }
  return BigInt(Math.floor(milliseconds / 1_000));
}

function validateExpectation(
  value: PredictionV2PreparedTransactionExpectationV2,
) {
  const expectation = exactRecord(value, EXPECTATION_FIELDS, "expectation");
  const releaseId = boundedText(expectation.releaseId, "release id", 96);
  if (!RELEASE_ID_PATTERN.test(releaseId)) invalid("release id");
  const preparedAction = action(expectation.action);
  const minimumConfirmedBlockNumber = expectation.minimumConfirmedBlockNumber;
  if (
    typeof minimumConfirmedBlockNumber !== "bigint" ||
    minimumConfirmedBlockNumber <= 0n ||
    minimumConfirmedBlockNumber > UINT64_MAX
  ) {
    invalid("minimum confirmed block number");
  }
  return Object.freeze({
    releaseId,
    releaseBindingHash: nonzeroBytes32(
      expectation.releaseBindingHash,
      "release binding hash",
    ),
    action: preparedAction,
    actionId: nonzeroBytes32(expectation.actionId, "action id"),
    calldataHash: nonzeroBytes32(expectation.calldataHash, "calldata hash"),
    minimumConfirmedBlockNumber,
    minimumConfirmedBlockHash: nonzeroBytes32(
      expectation.minimumConfirmedBlockHash,
      "minimum confirmed block hash",
    ),
    marketId: nonzeroBytes32(expectation.marketId, "market id"),
    marketVault: nonzeroAddress(expectation.marketVault, "market vault"),
    account: nonzeroAddress(expectation.account, "account"),
    target: nonzeroAddress(expectation.target, "target"),
  });
}

function assertCanonicalCalldata(actual: Hex, canonical: Hex) {
  if (!sameHex(actual, canonical)) invalid("calldata canonicality");
}

function assertOnchainDeadline(
  deadline: bigint,
  issuedAtUnixSeconds: bigint,
  expiresAtUnixSeconds: bigint,
  label: string,
) {
  if (
    deadline < expiresAtUnixSeconds ||
    deadline >
      issuedAtUnixSeconds + PREDICTION_V2_ONCHAIN_DEADLINE_MAX_TTL_SECONDS
  ) {
    invalid(`${label} deadline binding`);
  }
}

function assertPreparedCalldata(input: Readonly<{
  action: PredictionV2PreparedActionV2;
  data: Hex;
  account: Address;
  marketVault: Address;
  issuedAtUnixSeconds: bigint;
  expiresAtUnixSeconds: bigint;
}>) {
  if (input.action === "buy" || input.action === "sell") {
    let decoded;
    try {
      decoded = decodeFunctionData({
        abi: PREDICTION_V2_EXECUTION_ROUTER_ABI,
        data: input.data,
      });
    } catch {
      return invalid(`${input.action} calldata`);
    }
    const expectedFunction = input.action === "buy"
      ? "buyOutcomeWithPermit"
      : "sellOutcomeWithPermit";
    if (
      decoded.functionName !== expectedFunction ||
      !sameAddress(decoded.args[0], input.marketVault) ||
      (decoded.args[4] !== 27 && decoded.args[4] !== 28) ||
      decoded.args[5] === ZERO_BYTES32 ||
      decoded.args[6] === ZERO_BYTES32
    ) {
      invalid(`${input.action} binding`);
    }
    assertOnchainDeadline(
      decoded.args[2].deadline,
      input.issuedAtUnixSeconds,
      input.expiresAtUnixSeconds,
      `${input.action} trade`,
    );
    assertOnchainDeadline(
      decoded.args[3],
      input.issuedAtUnixSeconds,
      input.expiresAtUnixSeconds,
      `${input.action} permit`,
    );
    assertCanonicalCalldata(
      input.data,
      encodeFunctionData({
        abi: PREDICTION_V2_EXECUTION_ROUTER_ABI,
        functionName: expectedFunction,
        args: decoded.args,
      }),
    );
    return;
  }

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      data: input.data,
    });
  } catch {
    return invalid(`${input.action} calldata`);
  }
  if (input.action === "redeem") {
    if (
      decoded.functionName !== "redeem" ||
      (decoded.args[0] === 0n && decoded.args[1] === 0n) ||
      !sameAddress(decoded.args[2], input.account)
    ) {
      invalid("redeem binding");
    }
    assertCanonicalCalldata(
      input.data,
      encodeFunctionData({
        abi: PREDICTION_V2_VAULT_ABI,
        functionName: "redeem",
        args: decoded.args,
      }),
    );
    return;
  }
  const expectedFunction = {
    "finalize-with-proof": "finalize",
    "finalize-unavailable": "finalizeUnavailable",
    "request-unproven-fallback": "requestUnprovenFallback",
    "finalize-unproven": "finalizeUnproven",
    "finalize-resolved": "finalizeResolved",
  }[input.action];
  if (decoded.functionName !== expectedFunction) invalid("finalize selector");
  if (input.action === "finalize-with-proof") {
    const args = decoded.args as readonly [Hex];
    if (args[0] === "0x") invalid("finalize proof");
    assertCanonicalCalldata(
      input.data,
      encodeFunctionData({
        abi: PREDICTION_V2_VAULT_ABI,
        functionName: "finalize",
        args,
      }),
    );
    return;
  }
  const canonical = {
    "finalize-unavailable": encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "finalizeUnavailable",
    }),
    "request-unproven-fallback": encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "requestUnprovenFallback",
    }),
    "finalize-unproven": encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "finalizeUnproven",
    }),
    "finalize-resolved": encodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "finalizeResolved",
    }),
  }[input.action];
  assertCanonicalCalldata(input.data, canonical);
}

/** Private: the sole browser capability mint, called only after fetch checks. */
function parsePreparedResponse(
  value: unknown,
  expectedInput: PredictionV2PreparedTransactionExpectationV2,
): ParsedPredictionV2PreparedTransactionV2 {
  const expected = validateExpectation(expectedInput);
  const record = exactRecord(value, TOP_LEVEL_FIELDS, "prepared response");
  if (record.schemaVersion !== PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2) {
    invalid("schema version");
  }
  if (record.chainId !== PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID) {
    invalid("chain binding");
  }
  const releaseId = boundedText(record.releaseId, "release id", 96);
  if (!RELEASE_ID_PATTERN.test(releaseId)) invalid("release id");
  const releaseBindingHash = nonzeroBytes32(
    record.releaseBindingHash,
    "release binding hash",
  );
  const preparedAction = action(record.action);
  const specification = PREDICTION_V2_PREPARED_ACTIONS_V2[preparedAction];
  if (record.kind !== specification.kind) invalid("kind/action binding");
  const actionId = nonzeroBytes32(record.actionId, "action id");
  const calldataHash = nonzeroBytes32(record.calldataHash, "calldata hash");
  const confirmedBlockNumber = canonicalUintString(
    record.confirmedBlockNumber,
    "confirmed block number",
    UINT64_MAX,
  );
  const confirmedBlockHash = nonzeroBytes32(
    record.confirmedBlockHash,
    "confirmed block hash",
  );
  const marketId = nonzeroBytes32(record.marketId, "market id");
  const marketVault = nonzeroAddress(record.marketVault, "market vault");
  const account = nonzeroAddress(record.account, "account");
  const issuedAtUnixSeconds = canonicalUintString(
    record.issuedAtUnixSeconds,
    "issue time",
    UINT64_MAX,
  );
  const expiresAtUnixSeconds = canonicalUintString(
    record.expiresAtUnixSeconds,
    "expiry time",
    UINT64_MAX,
  );
  const nowUnixSeconds = currentUnixSeconds();

  if (
    releaseId !== expected.releaseId ||
    !sameHex(releaseBindingHash, expected.releaseBindingHash)
  ) {
    invalid("release binding");
  }
  if (
    preparedAction !== expected.action ||
    !sameHex(actionId, expected.actionId)
  ) {
    invalid("action binding");
  }
  if (confirmedBlockNumber < expected.minimumConfirmedBlockNumber) {
    invalid("confirmed block rollback");
  }
  if (
    confirmedBlockNumber === expected.minimumConfirmedBlockNumber &&
    !sameHex(confirmedBlockHash, expected.minimumConfirmedBlockHash)
  ) {
    invalid("confirmed block anchor");
  }
  if (!sameHex(marketId, expected.marketId)) invalid("market id binding");
  if (!sameAddress(marketVault, expected.marketVault)) {
    invalid("market vault binding");
  }
  if (!sameAddress(account, expected.account)) invalid("account binding");
  if (
    issuedAtUnixSeconds > nowUnixSeconds + MAXIMUM_CLOCK_SKEW_SECONDS ||
    expiresAtUnixSeconds <= nowUnixSeconds ||
    expiresAtUnixSeconds <= issuedAtUnixSeconds ||
    expiresAtUnixSeconds - issuedAtUnixSeconds >
      PREDICTION_V2_PREPARED_TRANSACTION_MAX_TTL_SECONDS
  ) {
    invalid("expiry binding");
  }

  const transaction = exactRecord(
    record.transaction,
    TRANSACTION_FIELDS,
    "transaction",
  );
  const to = nonzeroAddress(transaction.to, "target");
  if (!sameAddress(to, expected.target)) invalid("target binding");
  const data = calldata(transaction.data);
  if (
    !sameHex(calldataHash, expected.calldataHash) ||
    !sameHex(keccak256(data), expected.calldataHash)
  ) {
    invalid("calldata commitment");
  }
  if (data.slice(0, 10) !== specification.selector) {
    invalid("selector binding");
  }
  if (transaction.value !== "0") invalid("native value");
  const gasLimit = canonicalUintString(
    transaction.gasLimit,
    "gas limit",
    specification.gasLimit,
  );
  if (gasLimit !== specification.gasLimit) invalid("gas limit");
  assertPreparedCalldata({
    action: preparedAction,
    data,
    account,
    marketVault,
    issuedAtUnixSeconds,
    expiresAtUnixSeconds,
  });

  const parsed = Object.freeze({
    schemaVersion: PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2,
    releaseId,
    releaseBindingHash,
    chainId: PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID,
    action: preparedAction,
    actionId,
    calldataHash,
    kind: specification.kind,
    confirmedBlockNumber,
    confirmedBlockHash,
    marketId,
    marketVault,
    account,
    issuedAtUnixSeconds,
    expiresAtUnixSeconds,
    transaction: Object.freeze({
      to,
      data,
      value: 0n,
      gasLimit,
    }),
  }) as ParsedPredictionV2PreparedTransactionV2;
  PARSED_TRANSACTIONS.add(parsed);
  return parsed;
}

function responseJson(text: string): unknown {
  if (
    text.length === 0 ||
    new TextEncoder().encode(text).byteLength >
      PREDICTION_V2_CLIENT_API_MAXIMUM_BODY_BYTES_V2
  ) {
    invalid("response body size");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    invalid("response JSON");
  }
}

export function parsePredictionV2ClientApiErrorV2(
  value: unknown,
): PredictionV2ClientApiErrorBodyV2 {
  const record = exactRecord(
    value,
    ["schemaVersion", "code", "message", "retryable"],
    "error",
  );
  if (record.schemaVersion !== PREDICTION_V2_CLIENT_API_ERROR_SCHEMA_V2) {
    invalid("error schema version");
  }
  const code = boundedText(record.code, "error code", 128);
  if (!ERROR_CODE_PATTERN.test(code)) invalid("error code");
  const message = boundedText(record.message, "error message", 2_048);
  if (typeof record.retryable !== "boolean") invalid("error retryability");
  return Object.freeze({
    schemaVersion: PREDICTION_V2_CLIENT_API_ERROR_SCHEMA_V2,
    code,
    message,
    retryable: record.retryable,
  });
}

function canonicalJsonRequest(
  value: unknown,
  depth: number,
  budget: { remaining: number },
): PredictionV2ClientJsonValueV2 {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > MAXIMUM_REQUEST_DEPTH) {
    invalid("request body bounds");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && value.length > 32_768) {
      invalid("request string bounds");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) invalid("request number");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_024) invalid("request array bounds");
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1 ||
      keys.some((key) => typeof key !== "string") ||
      !keys.includes("length")
    ) {
      invalid("request array fields");
    }
    const output: PredictionV2ClientJsonValueV2[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) {
        invalid("request array field");
      }
      output.push(canonicalJsonRequest(descriptor.value, depth + 1, budget));
    }
    return Object.freeze(output);
  }
  if (typeof value !== "object" || value === null) invalid("request JSON value");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid("request object");
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.length > 256) invalid("request object bounds");
  const output: Record<string, PredictionV2ClientJsonValueV2> =
    Object.create(null) as Record<string, PredictionV2ClientJsonValueV2>;
  for (const key of keys) {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > 128 ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      invalid("request field");
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) {
      invalid("request field descriptor");
    }
    output[key] = canonicalJsonRequest(descriptor.value, depth + 1, budget);
  }
  return Object.freeze(output);
}

function encodeRequestBody(
  value: PredictionV2ClientJsonObjectV2,
  expected: ReturnType<typeof validateExpectation>,
): string {
  const canonical = canonicalJsonRequest(
    value,
    0,
    { remaining: MAXIMUM_REQUEST_NODES },
  );
  if (
    canonical === null ||
    typeof canonical !== "object" ||
    Array.isArray(canonical)
  ) {
    invalid("request body");
  }
  const body = canonical as PredictionV2ClientJsonObjectV2;
  if (
    body.action !== expected.action ||
    body.actionId !== expected.actionId ||
    typeof body.account !== "string" ||
    !sameAddress(body.account, expected.account) ||
    body.marketId !== expected.marketId ||
    (expected.action === "redeem" &&
      (body.minimumConfirmedBlockNumber !==
          expected.minimumConfirmedBlockNumber.toString() ||
        body.minimumConfirmedBlockHash !== expected.minimumConfirmedBlockHash))
  ) {
    invalid("request intent binding");
  }
  const encoded = JSON.stringify(canonical);
  if (
    encoded.length === 0 ||
    new TextEncoder().encode(encoded).byteLength >
      PREDICTION_V2_CLIENT_API_MAXIMUM_BODY_BYTES_V2
  ) {
    invalid("request body size");
  }
  return encoded;
}

function browserOrigin(): string {
  const origin = globalThis.location?.origin;
  if (typeof origin !== "string") invalid("browser origin");
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return invalid("browser origin");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.origin !== origin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    invalid("browser origin");
  }
  return origin;
}

function assertExactResponseUrl(
  response: Response,
  origin: string,
  path: string,
) {
  let responseUrl: URL;
  try {
    responseUrl = new URL(response.url);
  } catch {
    return invalid("response URL");
  }
  if (
    response.redirected ||
    responseUrl.origin !== origin ||
    responseUrl.pathname !== path ||
    responseUrl.search !== "" ||
    responseUrl.hash !== "" ||
    responseUrl.username !== "" ||
    responseUrl.password !== ""
  ) {
    invalid("response URL binding");
  }
}

async function readResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength)) {
      invalid("response content length");
    }
    const length = Number(declaredLength);
    if (
      !Number.isSafeInteger(length) ||
      length > PREDICTION_V2_CLIENT_API_MAXIMUM_BODY_BYTES_V2
    ) {
      invalid("response body size");
    }
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > PREDICTION_V2_CLIENT_API_MAXIMUM_BODY_BYTES_V2) {
        await reader.cancel().catch(() => undefined);
        invalid("response body size");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid("response UTF-8");
  }
}

/**
 * The only public mint for a browser-sendable prepared transaction. The URL is
 * derived from the closed action union and must return from that exact path on
 * the current origin without redirects before the private parser can run.
 */
export async function fetchPredictionV2PreparedTransactionV2(input: Readonly<{
  requestBody: PredictionV2ClientJsonObjectV2;
  expected: PredictionV2PreparedTransactionExpectationV2;
  signal?: AbortSignal;
}>): Promise<ParsedPredictionV2PreparedTransactionV2> {
  const expected = validateExpectation(input.expected);
  const path = `/api/prediction/v2/actions/${expected.action}/prepare`;
  const origin = browserOrigin();
  const body = encodeRequestBody(input.requestBody, expected);
  input.signal?.throwIfAborted();
  if (SAME_ORIGIN_FETCH === null) invalid("browser fetch");
  let response: Response;
  try {
    response = await SAME_ORIGIN_FETCH(path, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": expected.actionId,
      },
      body,
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    throw new PredictionV2ClientApiErrorV2(
      0,
      "network_error",
      true,
      "The prediction market service could not be reached",
    );
  }
  input.signal?.throwIfAborted();
  assertExactResponseUrl(response, origin, path);
  const mediaType = response.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") invalid("response content type");
  let text: string;
  try {
    text = await readResponseText(response);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (
      error instanceof TypeError &&
      error.message.startsWith("Invalid Protocol V2")
    ) {
      throw error;
    }
    throw new PredictionV2ClientApiErrorV2(
      0,
      "network_error",
      true,
      "The prediction market response could not be read",
    );
  }
  input.signal?.throwIfAborted();
  if (response.status === 200) {
    return parsePreparedResponse(responseJson(text), input.expected);
  }
  let parsedError: PredictionV2ClientApiErrorBodyV2;
  try {
    parsedError = parsePredictionV2ClientApiErrorV2(responseJson(text));
  } catch {
    throw new PredictionV2ClientApiErrorV2(
      response.status,
      "invalid_response",
      false,
      "The prediction market response could not be verified",
    );
  }
  throw new PredictionV2ClientApiErrorV2(
    response.status,
    parsedError.code,
    parsedError.retryable,
    parsedError.message,
  );
}

export function createPredictionV2ClientApiV2() {
  return Object.freeze({
    prepare(
      request: Parameters<typeof fetchPredictionV2PreparedTransactionV2>[0],
    ) {
      return fetchPredictionV2PreparedTransactionV2(request);
    },
  });
}

function assertFreshParsedTransaction(
  prepared: ParsedPredictionV2PreparedTransactionV2,
) {
  if (
    typeof prepared !== "object" ||
    prepared === null ||
    !PARSED_TRANSACTIONS.has(prepared)
  ) {
    invalid("parsed transaction capability");
  }
  const nowUnixSeconds = currentUnixSeconds();
  if (
    prepared.issuedAtUnixSeconds > nowUnixSeconds + MAXIMUM_CLOCK_SKEW_SECONDS ||
    prepared.expiresAtUnixSeconds <= nowUnixSeconds
  ) {
    invalid("expiry binding");
  }
  return prepared;
}

function assertConnectedWallet(
  connected: PredictionV2ConnectedWalletV2,
  expectedAccount: Address,
) {
  const account = nonzeroAddress(connected.account, "connected account");
  if (!sameAddress(account, expectedAccount)) {
    invalid("connected account binding");
  }
  if (connected.chainId !== PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID) {
    invalid("connected chain binding");
  }
  return account;
}

type PredictionV2PrivyTransactionSubmissionV2<
  WalletCapability extends object,
> = Readonly<{
  account: Address;
  wallet: WalletCapability;
  transaction: Readonly<{
    to: Address;
    data: Hex;
    value: 0n;
    gasLimit: bigint;
    chainId: typeof PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID;
  }>;
}>;

function privyTransactionSubmission<WalletCapability extends object>(
  prepared: ParsedPredictionV2PreparedTransactionV2,
  connected: PredictionV2PrivyWalletConnectionV2<WalletCapability>,
): PredictionV2PrivyTransactionSubmissionV2<WalletCapability> {
  const parsed = assertFreshParsedTransaction(prepared);
  const account = assertConnectedWallet(connected, parsed.account);
  if (
    typeof connected.wallet !== "object" ||
    connected.wallet === null
  ) {
    invalid("connected wallet capability");
  }
  return Object.freeze({
    account,
    wallet: connected.wallet,
    transaction: Object.freeze({
      to: parsed.transaction.to,
      data: parsed.transaction.data,
      value: 0n,
      gasLimit: parsed.transaction.gasLimit,
      chainId: PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID,
    }),
  });
}

function eip1193TransactionRequest(
  prepared: ParsedPredictionV2PreparedTransactionV2,
  connected: PredictionV2ConnectedWalletV2,
) {
  const parsed = assertFreshParsedTransaction(prepared);
  const account = assertConnectedWallet(connected, parsed.account);
  return Object.freeze({
    from: account,
    to: parsed.transaction.to,
    data: parsed.transaction.data,
    value: toHex(0n),
    gas: toHex(parsed.transaction.gasLimit),
  });
}

function submittedTransactionHash(value: unknown): Hex {
  if (typeof value !== "string" || !TRANSACTION_HASH_PATTERN.test(value)) {
    invalid("submitted transaction hash");
  }
  return value as Hex;
}

/** Must be called only inside the existing exclusive browser-wallet lock. */
export async function submitPredictionV2PrivyTransactionV2<
  WalletCapability extends object,
>(input: Readonly<{
  prepared: ParsedPredictionV2PreparedTransactionV2;
  connected: () =>
    | PredictionV2PrivyWalletConnectionV2<WalletCapability>
    | Promise<PredictionV2PrivyWalletConnectionV2<WalletCapability>>;
  send: (
    submission: PredictionV2PrivyTransactionSubmissionV2<WalletCapability>,
  ) => Promise<unknown>;
}>): Promise<Hex> {
  const firstSubmission = privyTransactionSubmission(
    input.prepared,
    await input.connected(),
  );
  const finalSubmission = privyTransactionSubmission(
    input.prepared,
    await input.connected(),
  );
  if (
    firstSubmission.wallet !== finalSubmission.wallet ||
    !sameAddress(firstSubmission.account, finalSubmission.account)
  ) {
    invalid("Privy wallet stability");
  }
  return submittedTransactionHash(await input.send(finalSubmission));
}

function parseProviderChainId(value: unknown): number {
  if (typeof value !== "string" || !RPC_CHAIN_ID_PATTERN.test(value)) {
    invalid("provider chain binding");
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    invalid("provider chain binding");
  }
  return Number(parsed);
}

function parseProviderAccount(value: unknown): Address {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    invalid("provider account binding");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    keys.some((key) => typeof key !== "string") ||
    !keys.includes("length")
  ) {
    invalid("provider account binding");
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value") ||
      typeof descriptor.value !== "string" ||
      !isAddress(descriptor.value, { strict: false })
    ) {
      invalid("provider account binding");
    }
  }
  return nonzeroAddress(value[0], "provider account binding");
}

/** Must be called only inside the existing exclusive browser-wallet lock. */
export async function submitPredictionV2Eip1193TransactionV2(input: Readonly<{
  prepared: ParsedPredictionV2PreparedTransactionV2;
  provider: PredictionV2Eip1193ProviderV2;
}>): Promise<Hex> {
  const firstChainId = parseProviderChainId(await input.provider.request({
    method: "eth_chainId",
  }));
  const firstAccount = parseProviderAccount(await input.provider.request({
    method: "eth_accounts",
  }));
  const finalChainId = parseProviderChainId(await input.provider.request({
    method: "eth_chainId",
  }));
  const finalAccount = parseProviderAccount(await input.provider.request({
    method: "eth_accounts",
  }));
  if (
    firstChainId !== finalChainId ||
    !sameAddress(firstAccount, finalAccount)
  ) {
    invalid("provider wallet stability");
  }
  const request = eip1193TransactionRequest(
    input.prepared,
    { account: finalAccount, chainId: finalChainId },
  );
  return submittedTransactionHash(await input.provider.request({
    method: "eth_sendTransaction",
    params: [request],
  }));
}
