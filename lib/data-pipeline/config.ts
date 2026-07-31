import "server-only";

import { dataPipelineError } from "./errors";

export const INDEXED_ROUTE_FLAG_NAMES = [
  "INDEXED_EXPLORE_LIST_READS_ENABLED",
  "INDEXED_EXPLORE_TOKEN_READS_ENABLED",
  "INDEXED_EXPLORE_CHART_READS_ENABLED",
  "INDEXED_CREATOR_PROFILE_READS_ENABLED",
  "INDEXED_CLASSIC_V3_PROFILE_READS_ENABLED",
  "INDEXED_LAUNCH_LOOKUP_ENABLED",
] as const;

export const INDEXED_CONTROL_FLAG_NAMES = [
  "INDEXED_READ_SHADOW_COMPARE_ENABLED",
  "INDEXED_READ_REQUIRE_PARITY_ENABLED",
  "INDEXED_READ_LIVE_FALLBACK_ENABLED",
] as const;

type RouteFlagName = (typeof INDEXED_ROUTE_FLAG_NAMES)[number];
type ControlFlagName = (typeof INDEXED_CONTROL_FLAG_NAMES)[number];
export type DataPipelineFlagName = RouteFlagName | ControlFlagName;

type Environment = Readonly<Record<string, string | undefined>>;

const OFFICIAL_UNISWAP_GRAPH_GATEWAY_BASE_URL =
  "https://gateway.thegraph.com";

const BROWSER_FORBIDDEN_NAMES = [
  "NEXT_PUBLIC_PROGRAMMABLE_ENVIO_GRAPHQL_URL",
  "NEXT_PUBLIC_PROGRAMMABLE_ENVIO_GRAPHQL_TOKEN",
  "NEXT_PUBLIC_PROGRAMMABLE_API_READER_DATABASE_URL",
  "NEXT_PUBLIC_PROGRAMMABLE_UNISWAP_GRAPH_API_KEY",
  "NEXT_PUBLIC_PROGRAMMABLE_UNISWAP_GRAPH_BASE_URL",
  "NEXT_PUBLIC_PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
  "NEXT_PUBLIC_PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
] as const;

function invalidConfig(): never {
  throw dataPipelineError({
    dependency: "config",
    code: "invalid_config",
    retryable: false,
    countsTowardCircuit: false,
  });
}
function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value === "") return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  return invalidConfig();
}

function parseInteger(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || value === "") return defaultValue;
  if (!/^(0|[1-9]\d*)$/.test(value)) return invalidConfig();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return invalidConfig();
  }
  return parsed;
}

function parseHttpsUrl(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return invalidConfig();
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return invalidConfig();
  }
}

function parseDatabaseUrl(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "postgresql:" ||
      url.username === "" ||
      url.password === "" ||
      url.hostname === "" ||
      url.hash !== ""
    ) {
      return invalidConfig();
    }
    return value;
  } catch {
    return invalidConfig();
  }
}

function optionalSecret(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (
    value.length < 8 ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return invalidConfig();
  }
  return value;
}

export type DataPipelineConfig = {
  flags: Readonly<Record<DataPipelineFlagName, boolean>>;
  envio: {
    endpoint?: string;
    token?: string;
    timeoutMs: 2_000;
    maximumBodyBytes: number;
  };
  postgres: {
    connectionString?: string;
    maxConnections: number;
    connectTimeoutMs: number;
    idleTimeoutMs: number;
    statementTimeoutMs: 1_000;
    lockTimeoutMs: number;
  };
  uniswap: {
    gatewayBaseUrl: string;
    apiKey?: string;
    timeoutMs: 2_500;
    maximumBodyBytes: number;
  };
};

export function loadDataPipelineConfig(
  env: Environment = process.env,
): DataPipelineConfig {
  for (const name of BROWSER_FORBIDDEN_NAMES) {
    if (env[name] !== undefined && env[name] !== "") invalidConfig();
  }

  const flags = {
    INDEXED_EXPLORE_LIST_READS_ENABLED: parseBoolean(
      env.INDEXED_EXPLORE_LIST_READS_ENABLED,
      false,
    ),
    INDEXED_EXPLORE_TOKEN_READS_ENABLED: parseBoolean(
      env.INDEXED_EXPLORE_TOKEN_READS_ENABLED,
      false,
    ),
    INDEXED_EXPLORE_CHART_READS_ENABLED: parseBoolean(
      env.INDEXED_EXPLORE_CHART_READS_ENABLED,
      false,
    ),
    INDEXED_CREATOR_PROFILE_READS_ENABLED: parseBoolean(
      env.INDEXED_CREATOR_PROFILE_READS_ENABLED,
      false,
    ),
    INDEXED_CLASSIC_V3_PROFILE_READS_ENABLED: parseBoolean(
      env.INDEXED_CLASSIC_V3_PROFILE_READS_ENABLED,
      false,
    ),
    INDEXED_LAUNCH_LOOKUP_ENABLED: parseBoolean(
      env.INDEXED_LAUNCH_LOOKUP_ENABLED,
      false,
    ),
    INDEXED_READ_SHADOW_COMPARE_ENABLED: parseBoolean(
      env.INDEXED_READ_SHADOW_COMPARE_ENABLED,
      false,
    ),
    INDEXED_READ_REQUIRE_PARITY_ENABLED: parseBoolean(
      env.INDEXED_READ_REQUIRE_PARITY_ENABLED,
      true,
    ),
    INDEXED_READ_LIVE_FALLBACK_ENABLED: parseBoolean(
      env.INDEXED_READ_LIVE_FALLBACK_ENABLED,
      true,
    ),
  } satisfies Record<DataPipelineFlagName, boolean>;

  const isProduction =
    env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";
  if (isProduction && !flags.INDEXED_READ_REQUIRE_PARITY_ENABLED) {
    invalidConfig();
  }

  const uniswapGraphGatewayBaseUrl =
    parseHttpsUrl(env.PROGRAMMABLE_UNISWAP_GRAPH_BASE_URL) ??
    OFFICIAL_UNISWAP_GRAPH_GATEWAY_BASE_URL;
  if (
    isProduction &&
    uniswapGraphGatewayBaseUrl !== OFFICIAL_UNISWAP_GRAPH_GATEWAY_BASE_URL
  ) {
    invalidConfig();
  }

  return Object.freeze({
    flags: Object.freeze(flags),
    envio: Object.freeze({
      endpoint: parseHttpsUrl(env.PROGRAMMABLE_ENVIO_GRAPHQL_URL),
      token: optionalSecret(env.PROGRAMMABLE_ENVIO_GRAPHQL_TOKEN),
      timeoutMs: 2_000 as const,
      maximumBodyBytes: parseInteger(
        env.PROGRAMMABLE_ENVIO_MAXIMUM_BODY_BYTES,
        128 * 1024,
        4 * 1024,
        256 * 1024,
      ),
    }),
    postgres: Object.freeze({
      connectionString: parseDatabaseUrl(
        env.PROGRAMMABLE_API_READER_DATABASE_URL,
      ),
      maxConnections: parseInteger(
        env.PROGRAMMABLE_POSTGRES_MAX_CONNECTIONS,
        2,
        1,
        5,
      ),
      connectTimeoutMs: parseInteger(
        env.PROGRAMMABLE_POSTGRES_CONNECT_TIMEOUT_MS,
        1_000,
        100,
        5_000,
      ),
      idleTimeoutMs: parseInteger(
        env.PROGRAMMABLE_POSTGRES_IDLE_TIMEOUT_MS,
        5_000,
        1_000,
        60_000,
      ),
      statementTimeoutMs: 1_000 as const,
      lockTimeoutMs: parseInteger(
        env.PROGRAMMABLE_POSTGRES_LOCK_TIMEOUT_MS,
        250,
        50,
        1_000,
      ),
    }),
    uniswap: Object.freeze({
      gatewayBaseUrl: uniswapGraphGatewayBaseUrl,
      apiKey: optionalSecret(env.PROGRAMMABLE_UNISWAP_GRAPH_API_KEY),
      timeoutMs: 2_500 as const,
      maximumBodyBytes: 128 * 1024,
    }),
  });
}
