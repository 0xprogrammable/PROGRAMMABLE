import "server-only";

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 64_000;
const ZERO_EVM_ADDRESS = `0x${"0".repeat(40)}`;
const SOLANA_MAINNET_GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SOLANA_TOKEN_PROGRAM =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SOLANA_TOKEN_2022_PROGRAM =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const MAXIMUM_SOLANA_SUPPLY = (1n << 64n) - 1n;
const EVM_IDENTITY_BLOCK_TAG = "safe" as const;
const SOLANA_IDENTITY_COMMITMENT = "finalized" as const;

export type PredictionAssetIdentitySourceNetworkV2 =
  | "ethereum"
  | "base"
  | "bnb"
  | "robinhood"
  | "solana";

export type PredictionAssetIdentityFailureReasonV2 =
  | "identity-unconfigured"
  | "identity-unavailable"
  | "identity-invalid";

export type PredictionAssetIdentityProbeV2 =
  | Readonly<{
    sourceNetwork: PredictionAssetIdentitySourceNetworkV2;
    status: "verified-token" | "not-token";
  }>
  | Readonly<{
    sourceNetwork: PredictionAssetIdentitySourceNetworkV2;
    status: "failed";
    reason: PredictionAssetIdentityFailureReasonV2;
  }>;

export type PredictionAssetIdentityVerifyOptionsV2 = Readonly<{
  signal?: AbortSignal;
}>;

export type PredictionAssetIdentityVerifierV2 = Readonly<{
  verify(
    locator: string,
    options?: PredictionAssetIdentityVerifyOptionsV2,
  ): Promise<readonly PredictionAssetIdentityProbeV2[]>;
}>;

export type PredictionAssetIdentityRpcUrlsV2 = Readonly<
  Partial<Record<PredictionAssetIdentitySourceNetworkV2, string | undefined>>
>;

export type PredictionAssetIdentityVerifierOptionsV2 = Readonly<{
  fetchImpl?: typeof fetch;
  rpcUrls?: PredictionAssetIdentityRpcUrlsV2;
  timeoutMs?: number;
  maximumResponseBytes?: number;
}>;

type EvmNetworkBinding = Readonly<{
  sourceNetwork: Exclude<PredictionAssetIdentitySourceNetworkV2, "solana">;
  chainId: bigint;
}>;

type RpcBatchOutcome =
  | Readonly<{ kind: "result"; value: unknown }>
  | Readonly<{ kind: "error" }>;

type EvmIdentityBlock = Readonly<{
  number: string;
  hash: string;
}>;

const EVM_NETWORKS = Object.freeze([
  Object.freeze({ sourceNetwork: "ethereum", chainId: 1n }),
  Object.freeze({ sourceNetwork: "base", chainId: 8_453n }),
  Object.freeze({ sourceNetwork: "bnb", chainId: 56n }),
  Object.freeze({ sourceNetwork: "robinhood", chainId: 4_663n }),
] as const satisfies readonly EvmNetworkBinding[]);

const ENVIRONMENT_VARIABLE_BY_NETWORK = Object.freeze({
  ethereum: "PROGRAMMABLE_PREDICTION_V2_ETHEREUM_RPC_URL",
  base: "PROGRAMMABLE_PREDICTION_V2_BASE_RPC_URL",
  bnb: "PROGRAMMABLE_PREDICTION_V2_BNB_RPC_URL",
  robinhood: "PROGRAMMABLE_PREDICTION_V2_ROBINHOOD_RPC_URL",
  solana: "PROGRAMMABLE_PREDICTION_V2_SOLANA_RPC_URL",
} as const satisfies Record<
  PredictionAssetIdentitySourceNetworkV2,
  string
>);

class PredictionAssetIdentityRpcError extends Error {
  constructor(readonly reason: PredictionAssetIdentityFailureReasonV2) {
    super(`Prediction asset identity verification failed: ${reason}`);
    this.name = "PredictionAssetIdentityRpcError";
  }
}

export function createPredictionAssetIdentityVerifierV2(
  options: PredictionAssetIdentityVerifierOptionsV2 = {},
): PredictionAssetIdentityVerifierV2 {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rawRpcUrls = options.rpcUrls ?? readEnvironmentRpcUrls();
  const rpcUrls = normalizeRpcUrls(rawRpcUrls);
  const timeoutMs = boundedInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    1,
    30_000,
    "timeoutMs",
  );
  const maximumResponseBytes = boundedInteger(
    options.maximumResponseBytes,
    DEFAULT_MAXIMUM_RESPONSE_BYTES,
    1,
    1_000_000,
    "maximumResponseBytes",
  );

  return Object.freeze({
    async verify(locator, verifyOptions = {}) {
      const normalized = normalizeLocator(locator);
      if (normalized?.namespace === "evm") {
        if (verifyOptions.signal?.aborted) {
          return EVM_NETWORKS.map(({ sourceNetwork }) => failedProbe(
            sourceNetwork,
            "identity-unavailable",
          ));
        }
        return Promise.all(EVM_NETWORKS.map((binding) => verifyEvmNetwork({
          binding,
          locator: normalized.locator,
          rpcUrl: rpcUrls[binding.sourceNetwork],
          fetchImpl,
          timeoutMs,
          maximumResponseBytes,
          signal: verifyOptions.signal,
        })));
      }

      if (normalized?.namespace === "solana") {
        if (verifyOptions.signal?.aborted) {
          return [failedProbe("solana", "identity-unavailable")];
        }
        return [await verifySolana({
          locator: normalized.locator,
          rpcUrl: rpcUrls.solana,
          fetchImpl,
          timeoutMs,
          maximumResponseBytes,
          signal: verifyOptions.signal,
        })];
      }

      const invalidNetworks = locator.trim().toLowerCase().startsWith("0x")
        ? EVM_NETWORKS.map(({ sourceNetwork }) => sourceNetwork)
        : ["solana" as const];
      return invalidNetworks.map((sourceNetwork) =>
        failedProbe(sourceNetwork, "identity-invalid")
      );
    },
  });
}

async function verifyEvmNetwork(input: Readonly<{
  binding: EvmNetworkBinding;
  locator: string;
  rpcUrl: string | null;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maximumResponseBytes: number;
  signal?: AbortSignal;
}>): Promise<PredictionAssetIdentityProbeV2> {
  if (input.rpcUrl === null) {
    return failedProbe(input.binding.sourceNetwork, "identity-unconfigured");
  }

  try {
    const probeSignal = probeDeadlineSignal(input.signal, input.timeoutMs);
    const anchorPayload = await requestJsonRpcBatch({
      rpcUrl: input.rpcUrl,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      maximumResponseBytes: input.maximumResponseBytes,
      signal: probeSignal,
      requests: [
        { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "eth_getBlockByNumber",
          params: [EVM_IDENTITY_BLOCK_TAG, false],
        },
      ],
      expectedIds: [1, 2],
    });

    const chainId = canonicalEvmQuantity(rpcResult(anchorPayload, 1));
    if (
      chainId === null ||
      BigInt(chainId) !== input.binding.chainId
    ) {
      return failedProbe(input.binding.sourceNetwork, "identity-invalid");
    }
    const anchoredBlock = evmIdentityBlock(rpcResult(anchorPayload, 2));

    // Resolve every identity field against one exact safe block number, then
    // re-read that block in the same batch. This prevents a moving `latest`
    // view or a replaced block from mixing code, decimals and supply states.
    const identityPayload = await requestJsonRpcBatch({
      rpcUrl: input.rpcUrl,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      maximumResponseBytes: input.maximumResponseBytes,
      signal: probeSignal,
      requests: [
        {
          jsonrpc: "2.0",
          id: 3,
          method: "eth_getBlockByNumber",
          params: [anchoredBlock.number, false],
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "eth_getCode",
          params: [input.locator, anchoredBlock.number],
        },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "eth_call",
          params: [
            { to: input.locator, data: "0x313ce567" },
            anchoredBlock.number,
          ],
        },
        {
          jsonrpc: "2.0",
          id: 6,
          method: "eth_call",
          params: [
            { to: input.locator, data: "0x18160ddd" },
            anchoredBlock.number,
          ],
        },
      ],
      expectedIds: [3, 4, 5, 6],
    });
    const confirmedBlock = evmIdentityBlock(rpcResult(identityPayload, 3));
    if (!sameEvmIdentityBlock(anchoredBlock, confirmedBlock)) {
      return failedProbe(input.binding.sourceNetwork, "identity-invalid");
    }

    const code = rpcResult(identityPayload, 4);
    if (code === "0x") {
      return {
        sourceNetwork: input.binding.sourceNetwork,
        status: "not-token",
      };
    }
    if (
      typeof code !== "string" ||
      !/^0x(?:[0-9a-fA-F]{2})+$/u.test(code)
    ) {
      return failedProbe(input.binding.sourceNetwork, "identity-invalid");
    }

    const decimals = abiWord(rpcResult(identityPayload, 5));
    const totalSupply = abiWord(rpcResult(identityPayload, 6));
    if (decimals === null || decimals > 255n || totalSupply === null) {
      return failedProbe(input.binding.sourceNetwork, "identity-invalid");
    }
    return {
      sourceNetwork: input.binding.sourceNetwork,
      status: "verified-token",
    };
  } catch (error) {
    return failedProbe(
      input.binding.sourceNetwork,
      identityFailureReason(error),
    );
  }
}

async function verifySolana(input: Readonly<{
  locator: string;
  rpcUrl: string | null;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maximumResponseBytes: number;
  signal?: AbortSignal;
}>): Promise<PredictionAssetIdentityProbeV2> {
  if (input.rpcUrl === null) {
    return failedProbe("solana", "identity-unconfigured");
  }

  try {
    const probeSignal = probeDeadlineSignal(input.signal, input.timeoutMs);
    const anchorPayload = await requestJsonRpcBatch({
      rpcUrl: input.rpcUrl,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      maximumResponseBytes: input.maximumResponseBytes,
      signal: probeSignal,
      requests: [
        { jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "getSlot",
          params: [{ commitment: SOLANA_IDENTITY_COMMITMENT }],
        },
      ],
      expectedIds: [1, 2],
    });

    if (rpcResult(anchorPayload, 1) !== SOLANA_MAINNET_GENESIS_HASH) {
      return failedProbe("solana", "identity-invalid");
    }
    const finalizedSlot = solanaSlot(rpcResult(anchorPayload, 2));

    const accountPayload = await requestJsonRpcBatch({
      rpcUrl: input.rpcUrl,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      maximumResponseBytes: input.maximumResponseBytes,
      signal: probeSignal,
      requests: [
        {
          jsonrpc: "2.0",
          id: 3,
          method: "getAccountInfo",
          params: [input.locator, {
            encoding: "jsonParsed",
            commitment: SOLANA_IDENTITY_COMMITMENT,
            minContextSlot: finalizedSlot,
          }],
        },
      ],
      expectedIds: [3],
    });

    const accountResponse = rpcResult(accountPayload, 3);
    if (
      !isPlainRecord(accountResponse) ||
      !isPlainRecord(accountResponse.context) ||
      !("value" in accountResponse) ||
      solanaSlot(accountResponse.context.slot) < finalizedSlot
    ) {
      return failedProbe("solana", "identity-invalid");
    }
    if (accountResponse.value === null) {
      return { sourceNetwork: "solana", status: "not-token" };
    }
    if (!isPlainRecord(accountResponse.value)) {
      return failedProbe("solana", "identity-invalid");
    }

    const owner = accountResponse.value.owner;
    if (owner !== SOLANA_TOKEN_PROGRAM && owner !== SOLANA_TOKEN_2022_PROGRAM) {
      return { sourceNetwork: "solana", status: "not-token" };
    }
    if (accountResponse.value.executable !== false) {
      return failedProbe("solana", "identity-invalid");
    }

    const data = accountResponse.value.data;
    if (!isPlainRecord(data) || !isPlainRecord(data.parsed)) {
      return failedProbe("solana", "identity-invalid");
    }
    if (data.parsed.type !== "mint" || !isPlainRecord(data.parsed.info)) {
      return failedProbe("solana", "identity-invalid");
    }
    const { decimals, supply } = data.parsed.info;
    if (
      typeof decimals !== "number" ||
      !Number.isSafeInteger(decimals) ||
      decimals < 0 ||
      decimals > 255 ||
      typeof supply !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/u.test(supply) ||
      supply.length > 20 ||
      BigInt(supply) > MAXIMUM_SOLANA_SUPPLY
    ) {
      return failedProbe("solana", "identity-invalid");
    }

    return { sourceNetwork: "solana", status: "verified-token" };
  } catch (error) {
    return failedProbe("solana", identityFailureReason(error));
  }
}

function probeDeadlineSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;
}

function evmIdentityBlock(value: unknown): EvmIdentityBlock {
  if (!isPlainRecord(value)) {
    throw new PredictionAssetIdentityRpcError("identity-invalid");
  }
  const number = canonicalEvmQuantity(value.number);
  const hash = typeof value.hash === "string" &&
      /^0x[0-9a-fA-F]{64}$/u.test(value.hash) &&
      !/^0x0{64}$/u.test(value.hash.toLowerCase())
    ? value.hash.toLowerCase()
    : null;
  if (number === null || hash === null) {
    throw new PredictionAssetIdentityRpcError("identity-invalid");
  }
  return Object.freeze({ number, hash });
}

function canonicalEvmQuantity(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,15})$/u.test(value)
  ) return null;
  return `0x${BigInt(value).toString(16)}`;
}

function sameEvmIdentityBlock(
  first: EvmIdentityBlock,
  second: EvmIdentityBlock,
) {
  return first.number === second.number && first.hash === second.hash;
}

function solanaSlot(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new PredictionAssetIdentityRpcError("identity-invalid");
  }
  return value as number;
}

async function requestJsonRpcBatch(input: Readonly<{
  rpcUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maximumResponseBytes: number;
  signal?: AbortSignal;
  requests: readonly Readonly<{
    jsonrpc: "2.0";
    id: number;
    method: string;
    params: readonly unknown[];
  }>[];
  expectedIds: readonly number[];
}>): Promise<ReadonlyMap<number, RpcBatchOutcome>> {
  if (input.signal?.aborted) {
    throw new PredictionAssetIdentityRpcError("identity-unavailable");
  }

  const controller = new AbortController();
  let rejectDeadline!: (error: PredictionAssetIdentityRpcError) => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  let deadlineSettled = false;
  const abortRequest = () => {
    if (deadlineSettled) return;
    deadlineSettled = true;
    controller.abort();
    rejectDeadline(
      new PredictionAssetIdentityRpcError("identity-unavailable"),
    );
  };
  const timer = setTimeout(abortRequest, input.timeoutMs);
  input.signal?.addEventListener("abort", abortRequest, { once: true });

  try {
    let response: Response;
    try {
      response = await Promise.race([
        input.fetchImpl(input.rpcUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input.requests),
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        }),
        deadline,
      ]);
    } catch (error) {
      if (error instanceof PredictionAssetIdentityRpcError) throw error;
      throw new PredictionAssetIdentityRpcError("identity-unavailable");
    }
    if (!(response instanceof Response)) {
      throw new PredictionAssetIdentityRpcError("identity-invalid");
    }
    if (!response.ok) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetIdentityRpcError("identity-unavailable");
    }
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (
      contentType === undefined ||
      !/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/u.test(contentType)
    ) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetIdentityRpcError("identity-invalid");
    }
    const body = await readBoundedResponseBody(
      response,
      input.maximumResponseBytes,
      deadline,
      controller,
    );
    let value: unknown;
    try {
      value = JSON.parse(body) as unknown;
    } catch {
      throw new PredictionAssetIdentityRpcError("identity-invalid");
    }
    return parseRpcBatch(value, input.expectedIds);
  } finally {
    deadlineSettled = true;
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abortRequest);
  }
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
  deadline: Promise<never>,
  controller: AbortController,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength)) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetIdentityRpcError("identity-invalid");
    }
    if (BigInt(declaredLength) > BigInt(maximumBytes)) {
      abortUnreadResponse(response, controller);
      throw new PredictionAssetIdentityRpcError("identity-invalid");
    }
  }

  if (response.body === null) {
    throw new PredictionAssetIdentityRpcError("identity-invalid");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        throw new PredictionAssetIdentityRpcError("identity-invalid");
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > maximumBytes) {
        controller.abort();
        void reader.cancel().catch(() => undefined);
        throw new PredictionAssetIdentityRpcError("identity-invalid");
      }
      chunks.push(next.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The request controller owns a body read that outlives this verifier.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PredictionAssetIdentityRpcError("identity-invalid");
  }
}

function parseRpcBatch(
  value: unknown,
  expectedIds: readonly number[],
): ReadonlyMap<number, RpcBatchOutcome> {
  if (!Array.isArray(value) || value.length !== expectedIds.length) {
    throw new PredictionAssetIdentityRpcError("identity-invalid");
  }
  const expected = new Set(expectedIds);
  const results = new Map<number, RpcBatchOutcome>();
  for (const row of value) {
    if (
      !isPlainRecord(row) ||
      row.jsonrpc !== "2.0" ||
      typeof row.id !== "number" ||
      !Number.isSafeInteger(row.id) ||
      !expected.has(row.id) ||
      results.has(row.id)
    ) {
      throw new PredictionAssetIdentityRpcError("identity-invalid");
    }
    const hasResult = Object.hasOwn(row, "result");
    const hasError = Object.hasOwn(row, "error");
    if (hasResult === hasError) {
      throw new PredictionAssetIdentityRpcError("identity-invalid");
    }
    if (hasError) {
      if (!isPlainRecord(row.error)) {
        throw new PredictionAssetIdentityRpcError("identity-invalid");
      }
      results.set(row.id, { kind: "error" });
    } else {
      results.set(row.id, { kind: "result", value: row.result });
    }
  }
  return results;
}

function rpcResult(
  results: ReadonlyMap<number, RpcBatchOutcome>,
  id: number,
): unknown {
  const outcome = results.get(id);
  if (outcome?.kind !== "result") {
    throw new PredictionAssetIdentityRpcError("identity-invalid");
  }
  return outcome.value;
}

function abiWord(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    return null;
  }
  return BigInt(value);
}

function failedProbe(
  sourceNetwork: PredictionAssetIdentitySourceNetworkV2,
  reason: PredictionAssetIdentityFailureReasonV2,
): PredictionAssetIdentityProbeV2 {
  return { sourceNetwork, status: "failed", reason };
}

function identityFailureReason(
  error: unknown,
): PredictionAssetIdentityFailureReasonV2 {
  return error instanceof PredictionAssetIdentityRpcError
    ? error.reason
    : "identity-unavailable";
}

function readEnvironmentRpcUrls(): PredictionAssetIdentityRpcUrlsV2 {
  return Object.freeze(Object.fromEntries(
    Object.entries(ENVIRONMENT_VARIABLE_BY_NETWORK).map(
      ([sourceNetwork, variable]) => [sourceNetwork, process.env[variable]],
    ),
  ) as Partial<Record<PredictionAssetIdentitySourceNetworkV2, string>>);
}

function normalizeRpcUrls(
  values: PredictionAssetIdentityRpcUrlsV2,
): Readonly<Record<PredictionAssetIdentitySourceNetworkV2, string | null>> {
  return Object.freeze({
    ethereum: normalizeRpcUrl(values.ethereum),
    base: normalizeRpcUrl(values.base),
    bnb: normalizeRpcUrl(values.bnb),
    robinhood: normalizeRpcUrl(values.robinhood),
    solana: normalizeRpcUrl(values.solana),
  });
}

function normalizeRpcUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.hostname === ""
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeLocator(locator: unknown):
  | Readonly<{ namespace: "evm" | "solana"; locator: string }>
  | null {
  if (typeof locator !== "string") return null;
  const trimmed = locator.trim();
  const evm = trimmed.toLowerCase();
  if (/^0x[0-9a-f]{40}$/u.test(evm) && evm !== ZERO_EVM_ADDRESS) {
    return { namespace: "evm", locator: evm };
  }
  const solanaBytes = decodeBase58(trimmed);
  if (
    solanaBytes?.byteLength === 32 &&
    solanaBytes.some((value) => value !== 0)
  ) {
    return { namespace: "solana", locator: trimmed };
  }
  return null;
}

function decodeBase58(value: string): Uint8Array | null {
  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  if (value.length === 0 || value.length > 64) return null;
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    number = number * 58n + BigInt(digit);
  }
  const tail: number[] = [];
  while (number > 0n) {
    tail.push(Number(number & 0xffn));
    number >>= 8n;
  }
  tail.reverse();
  let leadingZeroCount = 0;
  while (value[leadingZeroCount] === "1") leadingZeroCount += 1;
  return Uint8Array.from([
    ...new Array<number>(leadingZeroCount).fill(0),
    ...tail,
  ]);
}

function abortUnreadResponse(
  response: Response,
  controller: AbortController,
) {
  controller.abort();
  if (response.body !== null) {
    void response.body.cancel().catch(() => undefined);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  const candidate = value ?? fallback;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return candidate;
}
