import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPredictionAssetIdentityVerifierV2,
  type PredictionAssetIdentityRpcUrlsV2,
} from "../lib/market-data/prediction-asset-identity-verification-v2.server";

const EVM_ADDRESS = `0x${"ab".repeat(20)}`;
const SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_MAINNET_GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SOLANA_TOKEN_PROGRAM =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SOLANA_TOKEN_2022_PROGRAM =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const EVM_SAFE_BLOCK_NUMBER = "0x1234";
const EVM_SAFE_BLOCK_HASH = `0x${"12".repeat(32)}`;
const SOLANA_FINALIZED_SLOT = 123;
const SOLANA_ACCOUNT_CONTEXT_SLOT = 124;

const RPC_URLS = Object.freeze({
  ethereum: "https://ethereum.rpc.example/v2/key",
  base: "https://base.rpc.example/v2/key",
  bnb: "https://bnb.rpc.example/v2/key",
  robinhood: "https://robinhood.rpc.example/v2/key",
  solana: "https://solana.rpc.example/v2/key",
} as const satisfies PredictionAssetIdentityRpcUrlsV2);

const EVM_CHAIN_ID_BY_HOST = Object.freeze({
  "ethereum.rpc.example": "0x1",
  "base.rpc.example": "0x2105",
  "bnb.rpc.example": "0x38",
  "robinhood.rpc.example": "0x1237",
} as const);

function jsonResponse(
  body: unknown,
  status = 200,
  contentType = "application/json; charset=utf-8",
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
}

function rpcResult(id: number, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32_000, message: "execution reverted" },
  };
}

function abiWord(value: bigint | number) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

type EvmResponseOverrides = Readonly<{
  anchorBlock?: unknown;
  confirmedBlock?: unknown;
  code?: unknown;
  decimals?: unknown;
  decimalsError?: boolean;
  totalSupply?: unknown;
}>;

function evmBlock(
  number = EVM_SAFE_BLOCK_NUMBER,
  hash = EVM_SAFE_BLOCK_HASH,
) {
  return { number, hash };
}

function evmResponse(
  chainId: string,
  request: readonly Readonly<{ id: number; method: string }>[],
  overrides: EvmResponseOverrides = {},
) {
  if (request[0]?.method === "eth_chainId") {
    return [
      rpcResult(1, chainId),
      rpcResult(2, overrides.anchorBlock ?? evmBlock()),
    ];
  }
  if (request[0]?.method === "eth_getBlockByNumber") {
    return [
      rpcResult(3, overrides.confirmedBlock ?? evmBlock()),
      rpcResult(4, overrides.code ?? "0x60006000"),
      overrides.decimalsError
        ? rpcError(5)
        : rpcResult(5, overrides.decimals ?? abiWord(18)),
      rpcResult(6, overrides.totalSupply ?? abiWord(1_000_000)),
    ];
  }
  throw new Error(`Unexpected EVM request: ${request[0]?.method ?? "empty"}`);
}

function solanaAnchorBatch(input: Readonly<{
  genesisHash?: string;
  finalizedSlot?: unknown;
}> = {}) {
  return [
    rpcResult(1, input.genesisHash ?? SOLANA_MAINNET_GENESIS_HASH),
    rpcResult(2, input.finalizedSlot ?? SOLANA_FINALIZED_SLOT),
  ];
}

function solanaAccountBatch(input: Readonly<{
  account?: unknown;
  contextSlot?: unknown;
}> = {}) {
  return [rpcResult(3, {
    context: {
      slot: input.contextSlot ?? SOLANA_ACCOUNT_CONTEXT_SLOT,
    },
    value: input.account === undefined
      ? solanaMintAccount(SOLANA_TOKEN_PROGRAM)
      : input.account,
  })];
}

type SolanaResponseOverrides = Readonly<{
  genesisHash?: string;
  finalizedSlot?: unknown;
  account?: unknown;
  contextSlot?: unknown;
}>;

function solanaResponse(
  request: readonly Readonly<{ method: string }>[],
  overrides: SolanaResponseOverrides = {},
) {
  if (request[0]?.method === "getGenesisHash") {
    return solanaAnchorBatch(overrides);
  }
  if (request[0]?.method === "getAccountInfo") {
    return solanaAccountBatch(overrides);
  }
  throw new Error(`Unexpected Solana request: ${request[0]?.method ?? "empty"}`);
}

function solanaMintAccount(owner: string, type = "mint") {
  return {
    data: {
      program: "spl-token",
      parsed: {
        type,
        info: { decimals: 6, supply: "1000000000" },
      },
      space: 82,
    },
    executable: false,
    lamports: 1_461_600,
    owner,
  };
}

function networkForUrl(url: URL | RequestInfo) {
  const hostname = new URL(String(url)).hostname;
  if (!(hostname in EVM_CHAIN_ID_BY_HOST)) {
    throw new Error(`Unexpected EVM RPC hostname: ${hostname}`);
  }
  return hostname as keyof typeof EVM_CHAIN_ID_BY_HOST;
}

function createVerifier(
  fetchImpl: typeof fetch,
  overrides: Readonly<{
    rpcUrls?: PredictionAssetIdentityRpcUrlsV2;
    timeoutMs?: number;
    maximumResponseBytes?: number;
  }> = {},
) {
  return createPredictionAssetIdentityVerifierV2({
    fetchImpl,
    rpcUrls: overrides.rpcUrls ?? RPC_URLS,
    timeoutMs: overrides.timeoutMs ?? 100,
    maximumResponseBytes: overrides.maximumResponseBytes ?? 64_000,
  });
}

describe("prediction asset identity verification V2", () => {
  it("fails closed without configured RPC URLs and makes no request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const verifier = createVerifier(fetchImpl, { rpcUrls: {} });

    await expect(verifier.verify(EVM_ADDRESS)).resolves.toEqual([
      { sourceNetwork: "ethereum", status: "failed", reason: "identity-unconfigured" },
      { sourceNetwork: "base", status: "failed", reason: "identity-unconfigured" },
      { sourceNetwork: "bnb", status: "failed", reason: "identity-unconfigured" },
      { sourceNetwork: "robinhood", status: "failed", reason: "identity-unconfigured" },
    ]);
    await expect(verifier.verify(SOLANA_MINT)).resolves.toEqual([
      { sourceNetwork: "solana", status: "failed", reason: "identity-unconfigured" },
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-HTTPS and credential-bearing RPC configuration", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const verifier = createVerifier(fetchImpl, {
      rpcUrls: {
        ethereum: "http://ethereum.rpc.example",
        base: "https://user:password@base.rpc.example",
        bnb: "not a URL",
        robinhood: "https://robinhood.rpc.example/#fragment",
      },
    });

    const results = await verifier.verify(EVM_ADDRESS);

    expect(results).toHaveLength(4);
    expect(results.every((result) =>
      result.status === "failed" && result.reason === "identity-unconfigured"
    )).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("pins all four EVM probes to one exact safe block per network", async () => {
    const anchorReleases = new Map<string, (response: Response) => void>();
    const fetchImpl = vi.fn<typeof fetch>((url, init) => {
      const hostname = networkForUrl(url);
      expect(init).toMatchObject({
        method: "POST",
        cache: "no-store",
        redirect: "error",
      });
      expect(init?.headers).toEqual({
        Accept: "application/json",
        "Content-Type": "application/json",
      });
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: readonly unknown[];
      }[];
      expect(JSON.stringify(request)).not.toContain("latest");
      if (request[0]?.method === "eth_chainId") {
        expect(request).toEqual([
          { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "eth_getBlockByNumber",
            params: ["safe", false],
          },
        ]);
        return new Promise<Response>((resolve) => {
          anchorReleases.set(hostname, resolve);
        });
      }
      expect(request).toEqual([
        {
          jsonrpc: "2.0",
          id: 3,
          method: "eth_getBlockByNumber",
          params: [EVM_SAFE_BLOCK_NUMBER, false],
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "eth_getCode",
          params: [EVM_ADDRESS, EVM_SAFE_BLOCK_NUMBER],
        },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "eth_call",
          params: [
            { to: EVM_ADDRESS, data: "0x313ce567" },
            EVM_SAFE_BLOCK_NUMBER,
          ],
        },
        {
          jsonrpc: "2.0",
          id: 6,
          method: "eth_call",
          params: [
            { to: EVM_ADDRESS, data: "0x18160ddd" },
            EVM_SAFE_BLOCK_NUMBER,
          ],
        },
      ]);
      return Promise.resolve(jsonResponse(evmResponse(
        EVM_CHAIN_ID_BY_HOST[hostname],
        request,
      )));
    });

    const pending = createVerifier(fetchImpl).verify(EVM_ADDRESS.toUpperCase());
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
    expect([...anchorReleases.keys()]).toEqual([
      "ethereum.rpc.example",
      "base.rpc.example",
      "bnb.rpc.example",
      "robinhood.rpc.example",
    ]);
    for (const [hostname, release] of anchorReleases) {
      release(jsonResponse(evmResponse(
        EVM_CHAIN_ID_BY_HOST[hostname as keyof typeof EVM_CHAIN_ID_BY_HOST],
        [{ id: 1, method: "eth_chainId" }],
      )));
    }

    await expect(pending).resolves.toEqual([
      { sourceNetwork: "ethereum", status: "verified-token" },
      { sourceNetwork: "base", status: "verified-token" },
      { sourceNetwork: "bnb", status: "verified-token" },
      { sourceNetwork: "robinhood", status: "verified-token" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });

  it("fails the affected probe on a mismatched EVM chain id", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const hostname = networkForUrl(url);
      const chainId = hostname === "base.rpc.example"
        ? "0x1"
        : EVM_CHAIN_ID_BY_HOST[hostname];
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
      }[];
      return jsonResponse(evmResponse(chainId, request));
    });

    const results = await createVerifier(fetchImpl).verify(EVM_ADDRESS);

    expect(results[1]).toEqual({
      sourceNetwork: "base",
      status: "failed",
      reason: "identity-invalid",
    });
    expect(results.filter(({ status }) => status === "verified-token"))
      .toHaveLength(3);
  });

  it.each([
    {
      label: "replaced safe block hash",
      overrides: {
        confirmedBlock: evmBlock(
          EVM_SAFE_BLOCK_NUMBER,
          `0x${"34".repeat(32)}`,
        ),
      },
    },
    {
      label: "replaced safe block number",
      overrides: {
        confirmedBlock: evmBlock("0x1235", EVM_SAFE_BLOCK_HASH),
      },
    },
    {
      label: "noncanonical safe block number",
      overrides: { anchorBlock: evmBlock("0x01234") },
    },
  ] satisfies readonly Readonly<{
    label: string;
    overrides: EvmResponseOverrides;
  }>[])("fails closed on a $label", async ({ overrides }) => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const hostname = networkForUrl(url);
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
      }[];
      return jsonResponse(evmResponse(
        EVM_CHAIN_ID_BY_HOST[hostname],
        request,
        hostname === "base.rpc.example" ? overrides : {},
      ));
    });

    const results = await createVerifier(fetchImpl).verify(EVM_ADDRESS);

    expect(results[1]).toEqual({
      sourceNetwork: "base",
      status: "failed",
      reason: "identity-invalid",
    });
  });

  it("classifies empty bytecode as not-token even when contract calls revert", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const hostname = networkForUrl(url);
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
      }[];
      return jsonResponse(evmResponse(
        EVM_CHAIN_ID_BY_HOST[hostname],
        request,
        hostname === "ethereum.rpc.example"
          ? { code: "0x", decimalsError: true }
          : {},
      ));
    });

    const results = await createVerifier(fetchImpl).verify(EVM_ADDRESS);

    expect(results[0]).toEqual({
      sourceNetwork: "ethereum",
      status: "not-token",
    });
  });

  it.each([
    {
      name: "a reverted decimals probe",
      overrides: { decimalsError: true },
    },
    {
      name: "a malformed totalSupply word",
      overrides: { totalSupply: "0x01" },
    },
    {
      name: "decimals outside uint8",
      overrides: { decimals: abiWord(256) },
    },
  ] satisfies readonly Readonly<{
    name: string;
    overrides: EvmResponseOverrides;
  }>[]) ("fails closed on $name", async ({ overrides }) => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const hostname = networkForUrl(url);
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
      }[];
      return jsonResponse(evmResponse(
        EVM_CHAIN_ID_BY_HOST[hostname],
        request,
        hostname === "base.rpc.example" ? overrides : {},
      ));
    });

    const results = await createVerifier(fetchImpl).verify(EVM_ADDRESS);

    expect(results[1]).toEqual({
      sourceNetwork: "base",
      status: "failed",
      reason: "identity-invalid",
    });
  });

  it.each([
    ["Token", SOLANA_TOKEN_PROGRAM],
    ["Token-2022", SOLANA_TOKEN_2022_PROGRAM],
  ])("verifies a Solana %s mint on mainnet", async (_label, owner) => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: readonly unknown[];
      }[];
      if (request[0]?.method === "getGenesisHash") {
        expect(request).toEqual([
          { jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "getSlot",
            params: [{ commitment: "finalized" }],
          },
        ]);
      } else {
        expect(request).toEqual([{
          jsonrpc: "2.0",
          id: 3,
          method: "getAccountInfo",
          params: [SOLANA_MINT, {
            encoding: "jsonParsed",
            commitment: "finalized",
            minContextSlot: SOLANA_FINALIZED_SLOT,
          }],
        }]);
      }
      return jsonResponse(solanaResponse(request, {
        account: solanaMintAccount(owner),
      }));
    });

    await expect(createVerifier(fetchImpl).verify(SOLANA_MINT)).resolves
      .toEqual([{ sourceNetwork: "solana", status: "verified-token" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(RPC_URLS.solana);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(RPC_URLS.solana);
  });

  it.each([
    ["a missing account", null],
    ["a non-token account", solanaMintAccount("11111111111111111111111111111111")],
  ])("classifies %s as not-token", async (_label, account) => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        method: string;
      }[];
      return jsonResponse(solanaResponse(request, { account }));
    });

    await expect(createVerifier(fetchImpl).verify(SOLANA_MINT)).resolves
      .toEqual([{ sourceNetwork: "solana", status: "not-token" }]);
  });

  it("fails a token-owned Solana account whose parsed data is not a mint", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        method: string;
      }[];
      return jsonResponse(solanaResponse(request, {
        account: solanaMintAccount(SOLANA_TOKEN_PROGRAM, "account"),
      }));
    });

    await expect(createVerifier(fetchImpl).verify(SOLANA_MINT)).resolves
      .toEqual([{
        sourceNetwork: "solana",
        status: "failed",
        reason: "identity-invalid",
      }]);
  });

  it("fails closed when the Solana RPC is not mainnet", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        method: string;
      }[];
      return jsonResponse(solanaResponse(request, {
        genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        account: null,
      }));
    });

    await expect(createVerifier(fetchImpl).verify(SOLANA_MINT)).resolves
      .toEqual([{
        sourceNetwork: "solana",
        status: "failed",
        reason: "identity-invalid",
      }]);
  });

  it("bounds a provider that ignores the timeout signal", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const verifier = createVerifier(fetchImpl, {
      rpcUrls: { solana: RPC_URLS.solana },
      timeoutMs: 5,
    });

    await expect(verifier.verify(SOLANA_MINT)).resolves.toEqual([{
      sourceNetwork: "solana",
      status: "failed",
      reason: "identity-unavailable",
    }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honors an already-aborted caller without issuing requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const controller = new AbortController();
    controller.abort();

    const results = await createVerifier(fetchImpl).verify(EVM_ADDRESS, {
      signal: controller.signal,
    });

    expect(results).toEqual([
      { sourceNetwork: "ethereum", status: "failed", reason: "identity-unavailable" },
      { sourceNetwork: "base", status: "failed", reason: "identity-unavailable" },
      { sourceNetwork: "bnb", status: "failed", reason: "identity-unavailable" },
      { sourceNetwork: "robinhood", status: "failed", reason: "identity-unavailable" },
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds an in-flight provider when the caller aborts", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const controller = new AbortController();
    const verifier = createVerifier(fetchImpl, {
      rpcUrls: { solana: RPC_URLS.solana },
    });

    const pending = verifier.verify(SOLANA_MINT, { signal: controller.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).resolves.toEqual([{
      sourceNetwork: "solana",
      status: "failed",
      reason: "identity-unavailable",
    }]);
  });

  it.each([
    ["a non-JSON response", () => new Response("no", {
      headers: { "content-type": "text/plain" },
    }), 64_000],
    ["an oversized response", () => jsonResponse(solanaAnchorBatch()), 8],
  ])("fails closed on %s", async (_label, response, maximumResponseBytes) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    const verifier = createVerifier(fetchImpl, {
      rpcUrls: { solana: RPC_URLS.solana },
      maximumResponseBytes,
    });

    await expect(verifier.verify(SOLANA_MINT)).resolves.toEqual([{
      sourceNetwork: "solana",
      status: "failed",
      reason: "identity-invalid",
    }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a Solana account response older than the finalized anchor slot", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        method: string;
      }[];
      return jsonResponse(solanaResponse(request, {
        contextSlot: SOLANA_FINALIZED_SLOT - 1,
      }));
    });

    await expect(createVerifier(fetchImpl).verify(SOLANA_MINT)).resolves
      .toEqual([{
        sourceNetwork: "solana",
        status: "failed",
        reason: "identity-invalid",
      }]);
  });

  it.each([
    ["0x1234", 4],
    ["not-a-solana-address", 1],
    [`0x${"0".repeat(40)}`, 4],
    ["1".repeat(32), 1],
  ])("rejects invalid locator %s without a request", async (
    locator,
    resultCount,
  ) => {
    const fetchImpl = vi.fn<typeof fetch>();

    const results = await createVerifier(fetchImpl).verify(locator);

    expect(results).toHaveLength(resultCount);
    expect(results.every((result) =>
      result.status === "failed" && result.reason === "identity-invalid"
    )).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
