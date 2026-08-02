import { describe, expect, it, vi } from "vitest";
import { rootCertificates } from "node:tls";

vi.mock("server-only", () => ({}));

import {
  CACHE_POLICIES,
  cachePolicyForRead,
  provenanceHeaders,
} from "../../lib/data-pipeline/cache";
import { CircuitBreaker } from "../../lib/data-pipeline/circuit";
import {
  addressFromBytea,
  bytes32FromBytea,
  canonicalAddress,
  canonicalBytes32,
  canonicalRawData,
  canonicalSelector,
  parseUint256Text,
} from "../../lib/data-pipeline/codecs";
import {
  INDEXED_ROUTE_FLAG_NAMES,
  loadDataPipelineConfig,
} from "../../lib/data-pipeline/config";
import {
  DataPipelineError,
  dataPipelineError,
} from "../../lib/data-pipeline/errors";
import { boundedJsonRequest } from "../../lib/data-pipeline/request";

describe("data-pipeline configuration", () => {
  it("keeps every indexed route off while retaining fail-closed parity and live fallback", () => {
    const config = loadDataPipelineConfig({});

    for (const flag of INDEXED_ROUTE_FLAG_NAMES) {
      expect(config.flags[flag]).toBe(false);
    }
    expect(config.flags.INDEXED_READ_SHADOW_COMPARE_ENABLED).toBe(false);
    expect(config.flags.INDEXED_READ_REQUIRE_PARITY_ENABLED).toBe(true);
    expect(config.flags.INDEXED_READ_LIVE_FALLBACK_ENABLED).toBe(true);
  });

  it("accepts only exact boolean spellings and bounded server-only settings", () => {
    const config = loadDataPipelineConfig({
      INDEXED_EXPLORE_LIST_READS_ENABLED: "true",
      INDEXED_READ_LIVE_FALLBACK_ENABLED: "false",
      PROGRAMMABLE_POSTGRES_MAX_CONNECTIONS: "4",
      PROGRAMMABLE_POSTGRES_CONNECT_TIMEOUT_MS: "900",
      PROGRAMMABLE_API_READER_DATABASE_URL:
        "postgres://postgres.project:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
      PROGRAMMABLE_RELEASE_PROBE_DATABASE_URL:
        "postgres://probe.project:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
      PROGRAMMABLE_POSTGRES_SSL_CA_PEM: rootCertificates[0],
      PROGRAMMABLE_ENVIO_GRAPHQL_URL: "https://envio.example/graphql",
      PROGRAMMABLE_UNISWAP_GRAPH_BASE_URL: "https://gateway.thegraph.com",
      UNISWAP_V4_SUBGRAPH_API_KEY: "legacy-server-only-graph-key",
    });

    expect(config.flags.INDEXED_EXPLORE_LIST_READS_ENABLED).toBe(true);
    expect(config.flags.INDEXED_READ_LIVE_FALLBACK_ENABLED).toBe(false);
    expect(config.postgres.maxConnections).toBe(4);
    expect(config.postgres.connectTimeoutMs).toBe(900);
    expect(config.postgres.sslCaPem).toBe(rootCertificates[0]);
    expect(config.postgres.releaseProbeConnectionString).toContain(
      "probe.project",
    );
    expect(config.envio.endpoint).toBe("https://envio.example/graphql");
    expect(config.uniswap.gatewayBaseUrl).toBe(
      "https://gateway.thegraph.com",
    );
    expect(config.uniswap.apiKey).toBe("legacy-server-only-graph-key");

    expect(() =>
      loadDataPipelineConfig({
        INDEXED_EXPLORE_LIST_READS_ENABLED: "1",
      }),
    ).toThrowError(DataPipelineError);
    expect(() =>
      loadDataPipelineConfig({
        NEXT_PUBLIC_PROGRAMMABLE_RELEASE_PROBE_DATABASE_URL:
          "postgres://probe:secret@example.invalid:5432/db?sslmode=verify-full",
      }),
    ).toThrowError(DataPipelineError);
    expect(() =>
      loadDataPipelineConfig({
        NEXT_PUBLIC_PROGRAMMABLE_SHADOW_PROBE_TOKEN: "x".repeat(48),
      }),
    ).toThrowError(DataPipelineError);
    expect(() =>
      loadDataPipelineConfig({
        NEXT_PUBLIC_UNISWAP_V4_SUBGRAPH_API_KEY: "public-graph-key",
      }),
    ).toThrowError(DataPipelineError);
    expect(() =>
      loadDataPipelineConfig({
        PROGRAMMABLE_POSTGRES_MAX_CONNECTIONS: "6",
      }),
    ).toThrowError(DataPipelineError);
    expect(() =>
      loadDataPipelineConfig({
        PROGRAMMABLE_ENVIO_GRAPHQL_URL:
          "https://secret:password@envio.example/graphql",
      }),
    ).toThrowError(DataPipelineError);
    expect(() =>
      loadDataPipelineConfig({
        PROGRAMMABLE_POSTGRES_SSL_CA_PEM: "not-a-certificate",
      }),
    ).toThrowError(DataPipelineError);
    expect(() =>
      loadDataPipelineConfig({
        PROGRAMMABLE_POSTGRES_SSL_CA_PEM: rootCertificates[0],
      }),
    ).toThrowError(DataPipelineError);
    expect(() =>
      loadDataPipelineConfig({
        PROGRAMMABLE_API_READER_DATABASE_URL:
          "postgres://postgres.project:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
      }),
    ).toThrowError(DataPipelineError);
  });

  it.each(["NODE_ENV", "VERCEL_ENV"] as const)(
    "rejects disabled parity when %s marks a production runtime",
    (productionMarker) => {
      expect(() =>
        loadDataPipelineConfig({
          [productionMarker]: "production",
          INDEXED_READ_REQUIRE_PARITY_ENABLED: "false",
        }),
      ).toThrowError(DataPipelineError);
    },
  );

  it("allows operators to disable parity outside production", () => {
    const config = loadDataPipelineConfig({
      NODE_ENV: "development",
      VERCEL_ENV: "preview",
      INDEXED_READ_REQUIRE_PARITY_ENABLED: "false",
    });

    expect(config.flags.INDEXED_READ_REQUIRE_PARITY_ENABLED).toBe(false);
  });

  it("rejects disabled parity when the trusted process environment is production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    try {
      expect(() =>
        loadDataPipelineConfig({
          INDEXED_READ_REQUIRE_PARITY_ENABLED: "false",
        }),
      ).toThrowError(DataPipelineError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts only the official Graph gateway base in production", () => {
    expect(
      loadDataPipelineConfig({
        NODE_ENV: "production",
        PROGRAMMABLE_UNISWAP_GRAPH_BASE_URL:
          "https://gateway.thegraph.com/",
      }).uniswap.gatewayBaseUrl,
    ).toBe("https://gateway.thegraph.com");

    for (const gatewayBaseUrl of [
      "https://graph-proxy.example",
      "https://gateway.thegraph.com.evil.example",
      "https://gateway.thegraph.com/custom-proxy",
    ]) {
      expect(() =>
        loadDataPipelineConfig({
          VERCEL_ENV: "production",
          PROGRAMMABLE_UNISWAP_GRAPH_BASE_URL: gatewayBaseUrl,
        }),
      ).toThrowError(DataPipelineError);
    }
  });

  it("retains custom HTTPS Graph gateways outside production", () => {
    const config = loadDataPipelineConfig({
      NODE_ENV: "test",
      VERCEL_ENV: "preview",
      PROGRAMMABLE_UNISWAP_GRAPH_BASE_URL:
        "https://graph-proxy.example/custom-base/",
    });

    expect(config.uniswap.gatewayBaseUrl).toBe(
      "https://graph-proxy.example/custom-base",
    );
  });

  it("prefers the dedicated Graph key over the legacy server-only key", () => {
    const config = loadDataPipelineConfig({
      PROGRAMMABLE_UNISWAP_GRAPH_API_KEY: "dedicated-server-key",
      UNISWAP_V4_SUBGRAPH_API_KEY: "legacy-server-key",
    });

    expect(config.uniswap.apiKey).toBe("dedicated-server-key");
  });

  it("rejects a custom Graph gateway when the trusted process environment is production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    try {
      expect(() =>
        loadDataPipelineConfig({
          PROGRAMMABLE_UNISWAP_GRAPH_BASE_URL:
            "https://graph-proxy.example",
        }),
      ).toThrowError(DataPipelineError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects browser-prefixed credential paths without echoing a secret", () => {
    const secret = "do-not-echo-this-token";
    let thrown: unknown;
    try {
      loadDataPipelineConfig({
        NEXT_PUBLIC_PROGRAMMABLE_ENVIO_GRAPHQL_TOKEN: secret,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DataPipelineError);
    expect(String(thrown)).not.toContain(secret);
    expect(JSON.stringify(thrown)).not.toContain(secret);
    expect(() =>
      loadDataPipelineConfig({
        NEXT_PUBLIC_PROGRAMMABLE_POSTGRES_SSL_CA_PEM:
          rootCertificates[0],
      }),
    ).toThrowError(DataPipelineError);
  });
});

describe("strict hex and numeric codecs", () => {
  it("canonicalizes known fixed-width vectors and preserves leading zeroes", () => {
    expect(
      canonicalAddress(`0x${"00".repeat(19)}A1`),
    ).toBe(`0x${"00".repeat(19)}a1`);
    expect(
      canonicalBytes32(`0x${"00".repeat(31)}Ff`),
    ).toBe(`0x${"00".repeat(31)}ff`);
    expect(canonicalSelector("0xBF388406")).toBe("0xbf388406");
    expect(canonicalRawData("0x")).toBe("0x");

    expect(addressFromBytea(Uint8Array.from([1, ...Array(19).fill(0)]))).toBe(
      `0x01${"00".repeat(19)}`,
    );
    expect(bytes32FromBytea(`\\x${"ab".repeat(32)}`)).toBe(
      `0x${"ab".repeat(32)}`,
    );
  });

  it("rejects malformed, odd, missing-prefix, and wrong-width values", () => {
    for (const value of [
      "",
      "00",
      "0x0",
      "0xzz",
      `0x${"11".repeat(19)}`,
      `0x${"11".repeat(21)}`,
    ]) {
      expect(() => canonicalAddress(value)).toThrowError(DataPipelineError);
    }
    expect(() => canonicalRawData("")).toThrowError(DataPipelineError);
    expect(() => canonicalRawData("0x0")).toThrowError(DataPipelineError);
    expect(() => canonicalRawData("0xgg")).toThrowError(DataPipelineError);
    expect(() => canonicalBytes32("0x")).toThrowError(DataPipelineError);
    expect(() => canonicalSelector("0x1234")).toThrowError(DataPipelineError);
  });

  it("parses uint256 as text without entering JavaScript number space", () => {
    const maximum =
      "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    expect(parseUint256Text(maximum)).toBe(maximum);
    expect(parseUint256Text("0001")).toBe("1");
    expect(() =>
      parseUint256Text(
        "115792089237316195423570985008687907853269984665640564039457584007913129639936",
      ),
    ).toThrowError(DataPipelineError);
    expect(() => parseUint256Text("-1")).toThrowError(DataPipelineError);
    expect(() => parseUint256Text("1e18")).toThrowError(DataPipelineError);
  });
});

describe("bounded request helper", () => {
  it("aborts the entire request at the exact timeout and makes one attempt", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(
        async (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );

      const request = boundedJsonRequest({
        dependency: "envio",
        endpoint: "https://envio.example/graphql",
        timeoutMs: 2_000,
        maximumBodyBytes: 1024,
        fetcher,
        body: { query: "query Ready { ready }" },
      });
      const rejection = expect(request).rejects.toMatchObject({
        code: "timeout",
        dependency: "envio",
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      await rejection;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects declared and streamed oversized bodies", async () => {
    await expect(
      boundedJsonRequest({
        dependency: "uniswap",
        endpoint: "https://gateway.thegraph.com/api/subgraphs/id/fixed",
        timeoutMs: 100,
        maximumBodyBytes: 16,
        fetcher: async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-length": "17" },
          }),
        body: {},
      }),
    ).rejects.toMatchObject({ code: "response_oversize" });

    await expect(
      boundedJsonRequest({
        dependency: "uniswap",
        endpoint: "https://gateway.thegraph.com/api/subgraphs/id/fixed",
        timeoutMs: 100,
        maximumBodyBytes: 16,
        fetcher: async () =>
          new Response(JSON.stringify({ value: "x".repeat(32) }), {
            status: 200,
          }),
        body: {},
      }),
    ).rejects.toMatchObject({ code: "response_oversize" });
  });

  it("rejects invalid JSON and GraphQL errors without exposing endpoint data", async () => {
    await expect(
      boundedJsonRequest({
        dependency: "envio",
        endpoint: "https://envio.example/graphql?token=secret",
        timeoutMs: 100,
        maximumBodyBytes: 1024,
        fetcher: async () => new Response("{", { status: 200 }),
        body: {},
      }),
    ).rejects.toMatchObject({ code: "invalid_json" });

    let thrown: unknown;
    try {
      await boundedJsonRequest({
        dependency: "envio",
        endpoint: "https://envio.example/graphql?token=secret",
        timeoutMs: 100,
        maximumBodyBytes: 1024,
        fetcher: async () =>
          new Response(
            JSON.stringify({
              data: { candidate: null },
              errors: [{ message: "database password=secret" }],
            }),
            { status: 200 },
          ),
        body: {},
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "graphql_error" });
    expect(String(thrown)).not.toContain("secret");
    expect(JSON.stringify(thrown)).not.toContain("secret");
  });
});

describe("independent circuit breaker", () => {
  it("opens after three counted failures, admits one half-open probe, and closes on success", async () => {
    let now = 1_000;
    const circuit = new CircuitBreaker({
      dependency: "envio",
      now: () => now,
    });
    const dependencyFailure = () =>
      Promise.reject(
        dataPipelineError({
          dependency: "envio",
          code: "dependency_unavailable",
          retryable: true,
          countsTowardCircuit: true,
        }),
      );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(circuit.execute(dependencyFailure)).rejects.toBeInstanceOf(
        DataPipelineError,
      );
    }
    expect(circuit.snapshot()).toMatchObject({
      state: "open",
      consecutiveFailures: 3,
    });
    await expect(circuit.execute(async () => "blocked")).rejects.toMatchObject({
      code: "circuit_open",
    });

    now += 30_000;
    let releaseProbe: (() => void) | undefined;
    const probe = circuit.execute(
      () =>
        new Promise<string>((resolve) => {
          releaseProbe = () => resolve("ready");
        }),
    );
    await expect(circuit.execute(async () => "second")).rejects.toMatchObject({
      code: "circuit_open",
    });
    releaseProbe?.();
    await expect(probe).resolves.toBe("ready");
    expect(circuit.snapshot()).toEqual({
      state: "closed",
      consecutiveFailures: 0,
      openUntil: 0,
      halfOpenProbeActive: false,
    });
  });

  it("does not share state and does not count caller validation failures", async () => {
    const first = new CircuitBreaker({ dependency: "postgres" });
    const second = new CircuitBreaker({ dependency: "postgres" });
    const callerFailure = () =>
      Promise.reject(
        dataPipelineError({
          dependency: "postgres",
          code: "invalid_input",
          retryable: false,
          countsTowardCircuit: false,
        }),
      );

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(first.execute(callerFailure)).rejects.toBeInstanceOf(
        DataPipelineError,
      );
    }
    expect(first.snapshot().state).toBe("closed");
    expect(second.snapshot()).toEqual({
      state: "closed",
      consecutiveFailures: 0,
      openUntil: 0,
      halfOpenProbeActive: false,
    });
  });
});

describe("cache and provenance policy", () => {
  it("keeps public reads bounded and sensitive reads private no-store", () => {
    expect(cachePolicyForRead("explore-list")).toEqual(CACHE_POLICIES.public);
    expect(cachePolicyForRead("token-detail")).toEqual(CACHE_POLICIES.public);
    expect(cachePolicyForRead("chart")).toEqual(CACHE_POLICIES.public);
    for (const kind of [
      "account-rewards",
      "claimability",
      "launch-confirmation",
      "transaction-adjacent",
    ] as const) {
      expect(cachePolicyForRead(kind)).toEqual(CACHE_POLICIES.private);
    }
  });

  it("emits only the approved bounded provenance headers", () => {
    expect(
      provenanceHeaders({
        source: "indexed",
        projectionBlock: "25650000",
        projectionHash: `0x${"ab".repeat(32)}`,
        projectionLag: 2,
        reconciledAt: "2026-07-31T08:00:00.000Z",
        releaseVersion: "classic-v3",
      }),
    ).toEqual({
      "X-Programmable-Read-Source": "indexed",
      "X-Programmable-Projection-Block": "25650000",
      "X-Programmable-Projection-Hash": `0x${"ab".repeat(32)}`,
      "X-Programmable-Projection-Lag": "2",
      "X-Programmable-Reconciled-At": "2026-07-31T08:00:00.000Z",
      "X-Programmable-Release-Version": "classic-v3",
    });
  });
});
