import "server-only";

import {
  BITQUERY_OAUTH_TOKEN_ENVIRONMENT_VARIABLE,
  ingestBitqueryMarketStreamPayloadV1,
  safeBitqueryMarketDataError,
  BitqueryMarketDataError,
} from "./bitquery.server";
import type {
  MarketDataIdentityV1,
  MarketPoolDataV1,
} from "./market-data-v1";

export const BITQUERY_WEBSOCKET_ENDPOINT =
  "wss://streaming.bitquery.io/graphql" as const;

const SUBSCRIPTION_ID = "programmable-market-stream";
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAXIMUM_RETRY_DELAY_MS = 30_000;
const STREAM_SILENCE_TIMEOUT_MS = 45_000;
const MAXIMUM_STREAM_MESSAGE_BYTES = 1_000_000;
const MAXIMUM_STREAM_POOL_COUNT = 1_000;

type WebSocketConstructor = new (
  url: string | URL,
  protocols?: string | string[],
) => WebSocket;

export type BitqueryMarketStreamEventV1 = Readonly<{
  identity: MarketDataIdentityV1;
  market: MarketPoolDataV1;
}>;

export type BitqueryMarketStreamV1 = Readonly<{
  start(): void;
  stop(): void;
}>;

export function createBitqueryMarketStreamV1(input: Readonly<{
  identities: readonly MarketDataIdentityV1[];
  onData: (event: BitqueryMarketStreamEventV1) => void;
  onStatus?: (status: "connecting" | "connected" | "retrying" | "stopped") => void;
  onError?: (error: Readonly<{ name: string; category: string }>) => void;
  token?: string;
  WebSocketImpl?: WebSocketConstructor;
}>): BitqueryMarketStreamV1 {
  const configuredToken = (input.token ??
    process.env[BITQUERY_OAUTH_TOKEN_ENVIRONMENT_VARIABLE])?.trim();
  if (!configuredToken || configuredToken.length < 16) {
    throw new BitqueryMarketDataError("configuration");
  }
  const token: string = configuredToken;
  const WebSocketImpl = input.WebSocketImpl ?? globalThis.WebSocket;
  if (!WebSocketImpl) throw new BitqueryMarketDataError("configuration");
  const identities = canonicalIdentities(input.identities);
  const identityByPoolId = new Map(
    identities.map((identity) => [identity.poolId, identity]),
  );
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let retryDelay = INITIAL_RETRY_DELAY_MS;

  function report(error: unknown) {
    input.onError?.(safeBitqueryMarketDataError(error));
  }

  function scheduleRetry() {
    if (stopped || retryTimer !== null) return;
    input.onStatus?.("retrying");
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAXIMUM_RETRY_DELAY_MS);
  }

  function armSilenceTimer(active: WebSocket) {
    if (silenceTimer !== null) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      if (!stopped && socket === active) {
        active.close(4000, "stream timeout");
      }
    }, STREAM_SILENCE_TIMEOUT_MS);
  }

  function connect() {
    if (stopped || socket !== null) return;
    input.onStatus?.("connecting");
    // Bitquery requires its OAuth token in the WebSocket URL. This URL remains
    // server-only and is never passed to telemetry or to an error callback.
    const url = `${BITQUERY_WEBSOCKET_ENDPOINT}?token=${encodeURIComponent(token)}`;
    let next: WebSocket;
    try {
      next = new WebSocketImpl(url, "graphql-ws");
    } catch {
      report(new BitqueryMarketDataError("transport"));
      scheduleRetry();
      return;
    }
    socket = next;

    next.addEventListener("open", () => {
      if (stopped || socket !== next) return;
      armSilenceTimer(next);
      next.send(JSON.stringify({ type: "connection_init", payload: {} }));
    });
    next.addEventListener("message", (event) => {
      if (stopped || socket !== next) return;
      try {
        armSilenceTimer(next);
        const raw = String(event.data);
        if (new TextEncoder().encode(raw).byteLength > MAXIMUM_STREAM_MESSAGE_BYTES) {
          throw new BitqueryMarketDataError("response");
        }
        const message: unknown = JSON.parse(raw);
        const value = record(message);
        if (!value) throw new BitqueryMarketDataError("response");
        if (value.type === "connection_ack") {
          retryDelay = INITIAL_RETRY_DELAY_MS;
          input.onStatus?.("connected");
          next.send(JSON.stringify({
            id: SUBSCRIPTION_ID,
            type: "start",
            payload: {
              query: BITQUERY_MARKET_STREAM_QUERY,
              variables: { poolIds: identities.map((identity) => identity.poolId) },
            },
          }));
          return;
        }
        if (value.type === "ka") return;
        if (value.type === "data" && value.id === SUBSCRIPTION_ID) {
          const payload = record(value.payload);
          const data = record(payload?.data);
          if (!data) throw new BitqueryMarketDataError("response");
          for (const [poolId, identity] of identityByPoolId) {
            const payloadForPool = streamPayloadForPool(data, poolId);
            if (payloadForPool === null) continue;
            const market = ingestBitqueryMarketStreamPayloadV1({
              identity,
              payload: payloadForPool,
            });
            if (market) input.onData({ identity, market });
          }
          return;
        }
        if (value.type === "error") {
          throw new BitqueryMarketDataError("response");
        }
      } catch (error) {
        report(error);
      }
    });
    next.addEventListener("error", () => {
      report(new BitqueryMarketDataError("transport"));
    });
    next.addEventListener("close", () => {
      if (silenceTimer !== null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      if (socket === next) socket = null;
      scheduleRetry();
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      retryDelay = INITIAL_RETRY_DELAY_MS;
      connect();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (silenceTimer !== null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      const active = socket;
      socket = null;
      active?.close(1000, "stream stopped");
      input.onStatus?.("stopped");
    },
  };
}

export const BITQUERY_MARKET_STREAM_QUERY = `
  subscription ProgrammablePoolMarketStream($poolIds: [String!]!) {
    EVM(network: eth) {
      DEXTrades(
        where: {
          TransactionStatus: { Success: true }
          Trade: {
            Dex: { ProtocolName: { is: "uniswap_v4" } }
            PoolId: { in: $poolIds }
          }
        }
      ) {
        Block { Number Time }
        Log { Index }
        Trade {
          PoolId
          Buy { Currency { SmartContract Symbol } Amount AmountInUSD Price PriceInUSD }
          Sell { Currency { SmartContract Symbol } Amount AmountInUSD Price PriceInUSD }
        }
        Transaction { Hash Index }
      }
      DEXPoolEvents(
        where: {
          TransactionStatus: { Success: true }
          PoolEvent: {
            Dex: { ProtocolName: { is: "uniswap_v4" } }
            Pool: { PoolId: { in: $poolIds } }
          }
        }
      ) {
        Block { Number Time }
        PoolEvent {
          Pool {
            PoolId
            CurrencyA { SmartContract Symbol }
            CurrencyB { SmartContract Symbol }
          }
          Liquidity {
            AmountCurrencyA
            AmountCurrencyAInUSD
            AmountCurrencyB
            AmountCurrencyBInUSD
          }
        }
        Transaction { Hash }
      }
    }
  }
`;

function canonicalIdentities(
  values: readonly MarketDataIdentityV1[],
): readonly MarketDataIdentityV1[] {
  if (values.length === 0 || values.length > MAXIMUM_STREAM_POOL_COUNT) {
    throw new BitqueryMarketDataError("configuration");
  }
  const byPool = new Map<string, MarketDataIdentityV1>();
  for (const value of values) {
    const identity = canonicalIdentity(value);
    const existing = byPool.get(identity.poolId);
    if (existing && existing.tokenAddress !== identity.tokenAddress) {
      throw new BitqueryMarketDataError("integrity");
    }
    byPool.set(identity.poolId, identity);
  }
  return [...byPool.values()].sort((first, second) =>
    first.poolId.localeCompare(second.poolId)
  );
}

function streamPayloadForPool(
  data: Record<string, unknown>,
  poolId: string,
): Record<string, unknown> | null {
  const evm = record(data.EVM);
  if (!evm) throw new BitqueryMarketDataError("response");
  const trades = array(evm.DEXTrades).filter((row) =>
    nestedPoolId(row, "Trade") === poolId
  );
  const liquidity = array(evm.DEXPoolEvents).filter((row) =>
    nestedPoolId(row, "PoolEvent") === poolId
  );
  return trades.length === 0 && liquidity.length === 0
    ? null
    : { EVM: { DEXTrades: trades, DEXPoolEvents: liquidity } };
}

function nestedPoolId(value: unknown, kind: "Trade" | "PoolEvent"): string | null {
  const row = record(value);
  const parent = record(row?.[kind]);
  const valuePoolId = kind === "Trade"
    ? parent?.PoolId
    : record(parent?.Pool)?.PoolId;
  if (typeof valuePoolId !== "string") return null;
  const normalized = valuePoolId.toLowerCase();
  return /^0x[0-9a-f]{64}$/u.test(normalized) ? normalized : null;
}

function canonicalIdentity(identity: MarketDataIdentityV1): MarketDataIdentityV1 {
  const tokenAddress = identity.tokenAddress.toLowerCase();
  const poolId = identity.poolId.toLowerCase();
  if (
    identity.chainId !== "1" ||
    identity.protocol !== "uniswap_v4" ||
    !/^0x[0-9a-f]{40}$/u.test(tokenAddress) ||
    !/^0x[0-9a-f]{64}$/u.test(poolId)
  ) throw new BitqueryMarketDataError("integrity");
  return {
    chainId: "1",
    tokenAddress: tokenAddress as `0x${string}`,
    poolId: poolId as `0x${string}`,
    protocol: "uniswap_v4",
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
