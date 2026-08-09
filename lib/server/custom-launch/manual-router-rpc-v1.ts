import "server-only";

import {
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  type Hex,
} from "viem";

import { MANUAL_ROUTER_PRODUCTION_BINDING_V1 } from
  "@/lib/custom-launch/manual-router-bindings-v1";
import {
  resolveManualRouterStrictRpcConfigurationV1,
  type ManualRouterStrictRpcConfigurationV1,
} from "@/lib/server/custom-launch/manual-router-config-v1";

const JSON_RPC_RESPONSE_LIMIT_BYTES = 4 * 1024 * 1024;
const RPC_TIMEOUT_MS = 12_000;
const MAXIMUM_LATEST_TIMESTAMP_SPREAD_SECONDS = 120n;
const SAFE_ABI = [{
  type: "function",
  name: "isValidSignature",
  stateMutability: "view",
  inputs: [
    { name: "hash", type: "bytes32" },
    { name: "signature", type: "bytes" },
  ],
  outputs: [{ name: "magicValue", type: "bytes4" }],
}] as const;

export type ManualRouterChainClockV1 = Readonly<{
  minimumTimestamp: string;
  maximumTimestamp: string;
  commonFinalizedTimestamp: string;
  commonFinalizedBlockNumber: string;
  commonFinalizedBlockHash: `0x${string}`;
}>;

type RpcProviderV1 = Readonly<{
  label: "alchemy" | "quicknode";
  url: string;
}>;

type JsonRpcFetchV1 = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

type RpcBlockV1 = Readonly<{
  number: `0x${string}`;
  hash: `0x${string}`;
  timestamp: `0x${string}`;
}>;

export class ManualRouterRpcQuorumErrorV1 extends Error {
  constructor(
    readonly code:
      | "rpc_provider_unavailable"
      | "rpc_provider_ambiguous"
      | "rpc_chain_binding_failed"
      | "rpc_response_invalid",
  ) {
    super(code);
    this.name = "ManualRouterRpcQuorumErrorV1";
  }
}

export class ManualRouterRpcQuorumV1 {
  readonly #providers: readonly [RpcProviderV1, RpcProviderV1];
  readonly #fetch: JsonRpcFetchV1;

  constructor(input: Readonly<{
    configuration: ManualRouterStrictRpcConfigurationV1;
    fetch?: JsonRpcFetchV1;
  }>) {
    this.#providers = Object.freeze([
      Object.freeze({ label: "alchemy", url: input.configuration.alchemyUrl }),
      Object.freeze({ label: "quicknode", url: input.configuration.quickNodeUrl }),
    ]);
    this.#fetch = input.fetch ?? fetch;
  }

  async readChainClock(signal?: AbortSignal): Promise<ManualRouterChainClockV1> {
    const observations = await Promise.all(this.#providers.map(async (provider) => {
      const [chainId, latest, finalized] = await Promise.all([
        this.#request(provider, "eth_chainId", [], signal),
        this.#request(provider, "eth_getBlockByNumber", ["latest", false], signal),
        this.#request(provider, "eth_getBlockByNumber", ["finalized", false], signal),
      ]);
      if (chainId !== "0x1") {
        throw new ManualRouterRpcQuorumErrorV1("rpc_chain_binding_failed");
      }
      return Object.freeze({
        provider,
        latest: block(latest, `${provider.label} latest block`),
        finalized: block(finalized, `${provider.label} finalized block`),
      });
    }));
    const commonNumber = observations.reduce(
      (minimum, observation) =>
        quantity(observation.finalized.number) < minimum
          ? quantity(observation.finalized.number)
          : minimum,
      quantity(observations[0]!.finalized.number),
    );
    const commonTag = `0x${commonNumber.toString(16)}`;
    const commonBlocks = await Promise.all(this.#providers.map((provider) =>
      this.#request(provider, "eth_getBlockByNumber", [commonTag, false], signal)
        .then((value) => block(value, `${provider.label} common finalized block`))));
    if (
      commonBlocks[0]!.number !== commonTag
      || commonBlocks[1]!.number !== commonTag
      || commonBlocks[0]!.hash.toLowerCase() !== commonBlocks[1]!.hash.toLowerCase()
      || commonBlocks[0]!.timestamp !== commonBlocks[1]!.timestamp
    ) {
      throw new ManualRouterRpcQuorumErrorV1("rpc_provider_ambiguous");
    }
    const timestamps = observations.map((observation) =>
      quantity(observation.latest.timestamp));
    const minimumTimestamp = timestamps.reduce((a, b) => a < b ? a : b);
    const maximumTimestamp = timestamps.reduce((a, b) => a > b ? a : b);
    if (
      maximumTimestamp - minimumTimestamp
        > MAXIMUM_LATEST_TIMESTAMP_SPREAD_SECONDS
      || quantity(commonBlocks[0]!.timestamp) > minimumTimestamp
    ) {
      throw new ManualRouterRpcQuorumErrorV1("rpc_provider_ambiguous");
    }
    return Object.freeze({
      minimumTimestamp: minimumTimestamp.toString(10),
      maximumTimestamp: maximumTimestamp.toString(10),
      commonFinalizedTimestamp: quantity(commonBlocks[0]!.timestamp).toString(10),
      commonFinalizedBlockNumber: commonNumber.toString(10),
      commonFinalizedBlockHash: commonBlocks[0]!.hash,
    });
  }

  async assertProductionRuntimeBindings(
    clock: ManualRouterChainClockV1,
    signal?: AbortSignal,
  ): Promise<void> {
    const binding = MANUAL_ROUTER_PRODUCTION_BINDING_V1;
    const tag = `0x${BigInt(clock.commonFinalizedBlockNumber).toString(16)}` as const;
    await Promise.all([
      this.#assertRuntime(
        binding.router.address,
        binding.router.runtimeCodeHash,
        tag,
        signal,
      ),
      this.#assertRuntime(
        binding.permitAuthoritySafe.address,
        binding.permitAuthoritySafe.runtimeCodeHash,
        tag,
        signal,
      ),
      this.#assertRuntime(
        binding.graphFactory.address,
        binding.graphFactory.runtimeCodeHash,
        tag,
        signal,
      ),
      this.#assertAddressGetter(
        binding.router.permitAuthoritySelector,
        binding.permitAuthoritySafe.address,
        tag,
        signal,
      ),
      this.#assertAddressGetter(
        binding.router.graphFactorySelector,
        binding.graphFactory.address,
        tag,
        signal,
      ),
    ]);
  }

  async assertSafeSignature(input: Readonly<{
    permitDigest: `0x${string}`;
    rawSignature: `0x${string}`;
    blockTag?: `0x${string}` | "latest";
    signal?: AbortSignal;
  }>): Promise<void> {
    if (
      !/^0x[0-9a-f]{64}$/u.test(input.permitDigest)
      || !/^0x[0-9a-f]{130}$/u.test(input.rawSignature)
    ) {
      throw new TypeError("manual Router Safe signature input is invalid");
    }
    const data = encodeFunctionData({
      abi: SAFE_ABI,
      functionName: "isValidSignature",
      args: [input.permitDigest, input.rawSignature],
    });
    const results = await this.#both(
      "eth_call",
      [{
        to: MANUAL_ROUTER_PRODUCTION_BINDING_V1.permitAuthoritySafe.address,
        data,
      }, input.blockTag ?? "latest"],
      input.signal,
    );
    if (results.some((result) =>
      typeof result !== "string"
      || result.toLowerCase()
        !== MANUAL_ROUTER_PRODUCTION_BINDING_V1.permitAuthoritySafe
          .erc1271MagicWord.toLowerCase())) {
      throw new ManualRouterRpcQuorumErrorV1("rpc_chain_binding_failed");
    }
    const mutatedDigest = mutateBytes32(input.permitDigest);
    const mutatedData = encodeFunctionData({
      abi: SAFE_ABI,
      functionName: "isValidSignature",
      args: [mutatedDigest, input.rawSignature],
    });
    const mutatedResults = await Promise.all(this.#providers.map(async (provider) => {
      try {
        return await this.#request(provider, "eth_call", [{
          to: MANUAL_ROUTER_PRODUCTION_BINDING_V1.permitAuthoritySafe.address,
          data: mutatedData,
        }, input.blockTag ?? "latest"], input.signal);
      } catch (error) {
        if (error instanceof ManualRouterRpcExecutionRevertedV1) return "revert";
        throw error;
      }
    }));
    if (mutatedResults.some((result) =>
      result !== "revert" && (
        typeof result !== "string"
        || !/^0x(?:[0-9a-f]{2})*$/u.test(result)
        || result.toLowerCase()
          === MANUAL_ROUTER_PRODUCTION_BINDING_V1.permitAuthoritySafe
            .erc1271MagicWord.toLowerCase()
      ))) {
      throw new ManualRouterRpcQuorumErrorV1("rpc_chain_binding_failed");
    }
  }

  async simulateExactLaunch(input: Readonly<{
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: `0x${string}`;
    expectedStampHash: `0x${string}`;
    signal?: AbortSignal;
  }>): Promise<Hex> {
    if (
      !isAddress(input.from, { strict: true })
      || getAddress(input.to) !== getAddress(
        MANUAL_ROUTER_PRODUCTION_BINDING_V1.router.address,
      )
      || !/^0xe5f6b8cd[0-9a-f]*$/u.test(input.data)
      || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(input.value)
      || !/^0x[0-9a-f]{64}$/u.test(input.expectedStampHash)
    ) {
      throw new TypeError("manual Router simulation action is invalid");
    }
    const results = await this.#both("eth_call", [{
      from: input.from,
      to: input.to,
      data: input.data,
      value: input.value,
    }, "latest"], input.signal);
    if (
      typeof results[0] !== "string"
      || !/^0x(?:[0-9a-f]{2})*$/u.test(results[0])
      || results[0] !== results[1]
      || results[0].toLowerCase() !== input.expectedStampHash.toLowerCase()
    ) {
      throw new ManualRouterRpcQuorumErrorV1("rpc_provider_ambiguous");
    }
    return results[0] as Hex;
  }

  async readPendingNonceDiagnostic(
    wallet: `0x${string}`,
    signal?: AbortSignal,
  ): Promise<Readonly<{
    status: "matching" | "different" | "unavailable";
    alchemy: string | null;
    quickNode: string | null;
  }>> {
    if (!isAddress(wallet, { strict: true })) {
      throw new TypeError("manual Router nonce wallet is invalid");
    }
    const settled = await Promise.allSettled(this.#providers.map((provider) =>
      this.#request(provider, "eth_getTransactionCount", [wallet, "pending"], signal)));
    const values = settled.map((result) =>
      result.status === "fulfilled" && typeof result.value === "string"
        ? quantity(result.value).toString(10)
        : null);
    return Object.freeze({
      status: values.some((value) => value === null)
        ? "unavailable"
        : values[0] === values[1] ? "matching" : "different",
      alchemy: values[0] ?? null,
      quickNode: values[1] ?? null,
    });
  }

  async requestExactBoth(
    method: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<readonly [unknown, unknown]> {
    return this.#both(method, params, signal);
  }

  async #assertRuntime(
    address: `0x${string}`,
    expected: `0x${string}`,
    tag: `0x${string}`,
    signal?: AbortSignal,
  ) {
    const results = await this.#both("eth_getCode", [address, tag], signal);
    for (const result of results) {
      if (
        typeof result !== "string"
        || !/^0x(?:[0-9a-f]{2})+$/u.test(result)
        || keccak256(result as Hex).toLowerCase() !== expected.toLowerCase()
      ) {
        throw new ManualRouterRpcQuorumErrorV1("rpc_chain_binding_failed");
      }
    }
  }

  async #assertAddressGetter(
    selector: `0x${string}`,
    expected: `0x${string}`,
    tag: `0x${string}`,
    signal?: AbortSignal,
  ) {
    const results = await this.#both("eth_call", [{
      to: MANUAL_ROUTER_PRODUCTION_BINDING_V1.router.address,
      data: selector,
    }, tag], signal);
    for (const result of results) {
      if (
        typeof result !== "string"
        || !/^0x[0-9a-f]{64}$/u.test(result)
        || getAddress(`0x${result.slice(-40)}`) !== getAddress(expected)
      ) {
        throw new ManualRouterRpcQuorumErrorV1("rpc_chain_binding_failed");
      }
    }
  }

  async #both(
    method: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<readonly [unknown, unknown]> {
    const settled = await Promise.allSettled(this.#providers.map((provider) =>
      this.#request(provider, method, params, signal)));
    if (settled.some((result) => result.status === "rejected")) {
      throw new ManualRouterRpcQuorumErrorV1("rpc_provider_unavailable");
    }
    return [
      (settled[0] as PromiseFulfilledResult<unknown>).value,
      (settled[1] as PromiseFulfilledResult<unknown>).value,
    ];
  }

  async #request(
    provider: RpcProviderV1,
    method: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(RPC_TIMEOUT_MS);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeout])
      : timeout;
    let response: Response;
    try {
      response = await this.#fetch(provider.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
        cache: "no-store",
        redirect: "error",
        signal: combinedSignal,
      });
    } catch {
      throw new ManualRouterRpcQuorumErrorV1("rpc_provider_unavailable");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (
      !response.ok
      || (declaredLength > 0 && declaredLength > JSON_RPC_RESPONSE_LIMIT_BYTES)
    ) {
      throw new ManualRouterRpcQuorumErrorV1("rpc_provider_unavailable");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > JSON_RPC_RESPONSE_LIMIT_BYTES) {
      throw new ManualRouterRpcQuorumErrorV1("rpc_response_invalid");
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(text) as unknown;
    } catch {
      throw new ManualRouterRpcQuorumErrorV1("rpc_response_invalid");
    }
    if (
      envelope === null
      || typeof envelope !== "object"
      || Array.isArray(envelope)
      || (envelope as Record<string, unknown>).jsonrpc !== "2.0"
      || (envelope as Record<string, unknown>).id !== 1
      || (!("result" in envelope) && !("error" in envelope))
    ) {
      throw new ManualRouterRpcQuorumErrorV1("rpc_response_invalid");
    }
    if ("error" in envelope) {
      const error = (envelope as { error: unknown }).error;
      if (
        error !== null
        && typeof error === "object"
        && !Array.isArray(error)
        && typeof (error as Record<string, unknown>).code === "number"
        && typeof (error as Record<string, unknown>).message === "string"
        && /revert|execution/iu.test(
          String((error as Record<string, unknown>).message),
        )
      ) throw new ManualRouterRpcExecutionRevertedV1();
      throw new ManualRouterRpcQuorumErrorV1("rpc_response_invalid");
    }
    return (envelope as { result: unknown }).result;
  }
}

export function assertManualRouterUsableSendWindowV1(
  clock: ManualRouterChainClockV1,
  permit: Readonly<{ validAfter: string; deadline: string }>,
): void {
  const minimum = decimal(clock.minimumTimestamp, "minimum chain timestamp");
  const maximum = decimal(clock.maximumTimestamp, "maximum chain timestamp");
  const validAfter = decimal(permit.validAfter, "permit valid-after");
  const deadline = decimal(permit.deadline, "permit deadline");
  if (
    minimum > maximum
    || minimum < validAfter
    || maximum + 120n > deadline
  ) throw new TypeError("manual Router permit has no safe 120-second send window");
}

class ManualRouterRpcExecutionRevertedV1 extends Error {
  constructor() {
    super("rpc_execution_reverted");
    this.name = "ManualRouterRpcExecutionRevertedV1";
  }
}

export function createProductionManualRouterRpcQuorumV1():
ManualRouterRpcQuorumV1 {
  return new ManualRouterRpcQuorumV1({
    configuration: resolveManualRouterStrictRpcConfigurationV1(),
  });
}

function block(value: unknown, label: string): RpcBlockV1 {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
  ) throw new ManualRouterRpcQuorumErrorV1("rpc_response_invalid");
  const record = value as Record<string, unknown>;
  if (
    typeof record.number !== "string"
    || typeof record.hash !== "string"
    || typeof record.timestamp !== "string"
    || !/^0x[0-9a-f]{64}$/u.test(record.hash)
  ) {
    void label;
    throw new ManualRouterRpcQuorumErrorV1("rpc_response_invalid");
  }
  quantity(record.number);
  quantity(record.timestamp);
  return Object.freeze({
    number: record.number as `0x${string}`,
    hash: record.hash as `0x${string}`,
    timestamp: record.timestamp as `0x${string}`,
  });
}

function quantity(value: unknown): bigint {
  if (
    typeof value !== "string"
    || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)
  ) throw new ManualRouterRpcQuorumErrorV1("rpc_response_invalid");
  return BigInt(value);
}

function decimal(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return BigInt(value);
}

function mutateBytes32(value: `0x${string}`): `0x${string}` {
  const last = Number.parseInt(value.slice(-2), 16) ^ 1;
  return (
    `${value.slice(0, -2)}${last.toString(16).padStart(2, "0")}`
  ) as `0x${string}`;
}
