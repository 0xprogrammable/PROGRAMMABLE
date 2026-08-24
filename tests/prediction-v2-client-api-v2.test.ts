import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getAddress,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";

import type {
  ParsedPredictionV2PreparedTransactionV2,
  PredictionV2Eip1193ProviderV2,
} from "../lib/prediction-v2/client-api-v2";
import {
  PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2,
  type PredictionV2PreparedTransactionExpectationV2,
} from "../lib/prediction-v2/prepared-transaction-v2";
import { preparePredictionV2Redeem } from
  "../lib/prediction-v2/transactions";

const ORIGIN = "https://programmable.test";
const PATH = "/api/prediction/v2/actions/redeem/prepare";
const NOW = new Date("2026-08-24T12:00:00Z");
const NOW_SECONDS = BigInt(Math.floor(NOW.getTime() / 1_000));

const address = (suffix: number) =>
  getAddress(`0x${suffix.toString(16).padStart(40, "0")}`) as Address;
const bytes32 = (value: number) => toHex(value, { size: 32 }) as Hex;

const VAULT = address(7);
const ACCOUNT = address(8);
const ACTION_ID = bytes32(101);
const MARKET_ID = bytes32(102);
const BLOCK_HASH = bytes32(103);
const RELEASE_HASH = bytes32(104);
const TRANSACTION = preparePredictionV2Redeem({
  vault: VAULT,
  yesAtoms: 1_000_000n,
  noAtoms: 0n,
  recipient: ACCOUNT,
});

type ClientApiModule = typeof import("../lib/prediction-v2/client-api-v2");
const capturedFetch = vi.fn<typeof fetch>();
let clientApiExports: ClientApiModule;
let PREDICTION_V2_CLIENT_API_ERROR_SCHEMA_V2:
  ClientApiModule["PREDICTION_V2_CLIENT_API_ERROR_SCHEMA_V2"];
let PREDICTION_V2_CLIENT_API_MAXIMUM_BODY_BYTES_V2: number;
let PredictionV2ClientApiErrorV2:
  ClientApiModule["PredictionV2ClientApiErrorV2"];
let createPredictionV2ClientApiV2:
  ClientApiModule["createPredictionV2ClientApiV2"];
let fetchPredictionV2PreparedTransactionV2:
  ClientApiModule["fetchPredictionV2PreparedTransactionV2"];
let parsePredictionV2ClientApiErrorV2:
  ClientApiModule["parsePredictionV2ClientApiErrorV2"];
let submitPredictionV2Eip1193TransactionV2:
  ClientApiModule["submitPredictionV2Eip1193TransactionV2"];
let submitPredictionV2PrivyTransactionV2:
  ClientApiModule["submitPredictionV2PrivyTransactionV2"];
const EXPECTED = Object.freeze({
  releaseId: "protocol-v2",
  releaseBindingHash: RELEASE_HASH,
  action: "redeem",
  actionId: ACTION_ID,
  calldataHash: keccak256(TRANSACTION.data),
  minimumConfirmedBlockNumber: 100n,
  minimumConfirmedBlockHash: BLOCK_HASH,
  marketId: MARKET_ID,
  marketVault: VAULT,
  account: ACCOUNT,
  target: VAULT,
}) satisfies PredictionV2PreparedTransactionExpectationV2;
const REQUEST_BODY = Object.freeze({
  schemaVersion: "programmable.prediction-v2.redeem-prepare-request.v2",
  action: "redeem",
  actionId: ACTION_ID,
  marketKey: `eip155:4663:${address(1).toLowerCase()}:${bytes32(105)}`,
  economicKey: bytes32(105),
  marketId: MARKET_ID,
  account: ACCOUNT,
  minimumConfirmedBlockNumber:
    EXPECTED.minimumConfirmedBlockNumber.toString(),
  minimumConfirmedBlockHash: EXPECTED.minimumConfirmedBlockHash,
  yesAtoms: "1000000",
  noAtoms: "0",
});

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2,
    releaseId: EXPECTED.releaseId,
    releaseBindingHash: EXPECTED.releaseBindingHash,
    chainId: 4_663,
    action: EXPECTED.action,
    actionId: EXPECTED.actionId,
    calldataHash: EXPECTED.calldataHash,
    kind: "redeem",
    confirmedBlockNumber: EXPECTED.minimumConfirmedBlockNumber.toString(),
    confirmedBlockHash: EXPECTED.minimumConfirmedBlockHash,
    marketId: EXPECTED.marketId,
    marketVault: EXPECTED.marketVault,
    account: EXPECTED.account,
    issuedAtUnixSeconds: NOW_SECONDS.toString(),
    expiresAtUnixSeconds: (NOW_SECONDS + 120n).toString(),
    transaction: {
      to: TRANSACTION.to,
      data: TRANSACTION.data,
      value: "0",
      gasLimit: "500000",
    },
    ...overrides,
  };
}

function response(
  body: unknown,
  options: Readonly<{
    status?: number;
    url?: string;
    redirected?: boolean;
    contentType?: string;
  }> = {},
) {
  const result = new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: {
      "content-type": options.contentType ?? "application/json; charset=utf-8",
    },
  });
  Object.defineProperty(result, "url", {
    configurable: true,
    value: options.url ?? `${ORIGIN}${PATH}`,
  });
  Object.defineProperty(result, "redirected", {
    configurable: true,
    value: options.redirected ?? false,
  });
  return result;
}

function successFetch(body: unknown = envelope()) {
  return vi.fn<typeof fetch>(async () => response(body));
}

async function mint(
  fetchMock: typeof fetch = successFetch(),
): Promise<ParsedPredictionV2PreparedTransactionV2> {
  capturedFetch.mockImplementation(fetchMock);
  return fetchPredictionV2PreparedTransactionV2({
    requestBody: REQUEST_BODY,
    expected: EXPECTED,
  });
}

beforeAll(async () => {
  vi.resetModules();
  vi.stubGlobal("fetch", capturedFetch);
  clientApiExports = await import("../lib/prediction-v2/client-api-v2");
  ({
    PREDICTION_V2_CLIENT_API_ERROR_SCHEMA_V2,
    PREDICTION_V2_CLIENT_API_MAXIMUM_BODY_BYTES_V2,
    PredictionV2ClientApiErrorV2,
    createPredictionV2ClientApiV2,
    fetchPredictionV2PreparedTransactionV2,
    parsePredictionV2ClientApiErrorV2,
    submitPredictionV2Eip1193TransactionV2,
    submitPredictionV2PrivyTransactionV2,
  } = clientApiExports);
});

beforeEach(() => {
  capturedFetch.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal("location", { origin: ORIGIN });
});

afterEach(() => {
  vi.useRealTimers();
  vi.stubGlobal("location", undefined);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("Prediction V2 same-origin prepared transaction client", () => {
  it("exports no arbitrary response parser or capability mint", () => {
    expect(Object.keys(clientApiExports).some((name) =>
      name.includes("PreparedResponse") || name.includes("parsePrepared")
    )).toBe(false);
    expect(Object.keys(clientApiExports)).toContain(
      "fetchPredictionV2PreparedTransactionV2",
    );
  });

  it("accepts a closed response only from the hard-coded relative path", async () => {
    const fetchMock = successFetch();
    const prepared = await mint(fetchMock);
    expect(prepared).toMatchObject({
      releaseId: "protocol-v2",
      action: "redeem",
      actionId: ACTION_ID,
      marketId: MARKET_ID,
      marketVault: VAULT,
      account: ACCOUNT,
      transaction: {
        to: VAULT,
        data: TRANSACTION.data,
        value: 0n,
        gasLimit: 500_000n,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe(PATH);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(ACTION_ID);
    expect(JSON.parse(String(init?.body))).toEqual(REQUEST_BODY);
  });

  it("rejects response-origin, path and redirect drift before parsing", async () => {
    for (const options of [
      { url: `https://evil.test${PATH}` },
      { url: `${ORIGIN}/api/prediction/v2/actions/buy/prepare` },
      { url: `${ORIGIN}${PATH}?next=1` },
      { redirected: true },
    ]) {
      await expect(mint(vi.fn<typeof fetch>(async () =>
        response(envelope(), options)
      ))).rejects.toThrow("response URL binding");
    }
  });

  it("rejects missing browser origin and never fetches", async () => {
    vi.stubGlobal("location", undefined);
    const fetchMock = successFetch();
    await expect(mint(fetchMock)).rejects.toThrow("browser origin");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds request action, account, market and displayed snapshot", async () => {
    await expect(fetchPredictionV2PreparedTransactionV2({
      requestBody: { ...REQUEST_BODY, account: address(99) },
      expected: EXPECTED,
    })).rejects.toThrow("request intent binding");
    await expect(fetchPredictionV2PreparedTransactionV2({
      requestBody: { ...REQUEST_BODY, marketId: bytes32(999) },
      expected: EXPECTED,
    })).rejects.toThrow("request intent binding");
    await expect(fetchPredictionV2PreparedTransactionV2({
      requestBody: {
        ...REQUEST_BODY,
        minimumConfirmedBlockNumber: "99",
      },
      expected: EXPECTED,
    })).rejects.toThrow("request intent binding");
    await expect(fetchPredictionV2PreparedTransactionV2({
      requestBody: {
        ...REQUEST_BODY,
        minimumConfirmedBlockHash: bytes32(999),
      },
      expected: EXPECTED,
    })).rejects.toThrow("request intent binding");
    await expect(fetchPredictionV2PreparedTransactionV2({
      requestBody: REQUEST_BODY,
      expected: {
        ...EXPECTED,
        actionId: `0x${"AB".repeat(32)}`,
      },
    })).rejects.toThrow("action id");
    expect(capturedFetch).not.toHaveBeenCalled();
  });

  it("rejects release, block, account, target and calldata response drift", async () => {
    const cases = [
      envelope({ releaseBindingHash: bytes32(999) }),
      envelope({ confirmedBlockHash: bytes32(999) }),
      envelope({ account: address(99) }),
      envelope({ transaction: { ...envelope().transaction, to: address(99) } }),
      envelope({ calldataHash: bytes32(999) }),
    ];
    for (const body of cases) {
      await expect(mint(successFetch(body))).rejects.toThrow(
        "Invalid Protocol V2 client API",
      );
    }
  });

  it("accepts the anchored displayed snapshot and a higher server snapshot", async () => {
    await expect(mint()).resolves.toMatchObject({
      confirmedBlockNumber: EXPECTED.minimumConfirmedBlockNumber,
      confirmedBlockHash: EXPECTED.minimumConfirmedBlockHash,
    });
    const freshBlockHash = bytes32(998);
    await expect(mint(successFetch(envelope({
      confirmedBlockNumber:
        (EXPECTED.minimumConfirmedBlockNumber + 5n).toString(),
      confirmedBlockHash: freshBlockHash,
    })))).resolves.toMatchObject({
      confirmedBlockNumber: EXPECTED.minimumConfirmedBlockNumber + 5n,
      confirmedBlockHash: freshBlockHash,
    });
  });

  it("rejects snapshot rollback and same-height hash drift", async () => {
    const cases = [
      {
        body: envelope({
          confirmedBlockNumber:
            (EXPECTED.minimumConfirmedBlockNumber - 1n).toString(),
        }),
        message: "confirmed block rollback",
      },
      {
        body: envelope({ confirmedBlockHash: bytes32(997) }),
        message: "confirmed block anchor",
      },
    ];
    for (const testCase of cases) {
      await expect(mint(successFetch(testCase.body)))
        .rejects.toThrow(testCase.message);
    }
  });

  it("requires the exact action gas limit and a live bounded TTL", async () => {
    await expect(mint(successFetch(envelope({
      transaction: { ...envelope().transaction, gasLimit: "499999" },
    })))).rejects.toThrow("gas limit");
    await expect(mint(successFetch(envelope({
      expiresAtUnixSeconds: NOW_SECONDS.toString(),
    })))).rejects.toThrow("expiry binding");
    await expect(mint(successFetch(envelope({
      expiresAtUnixSeconds: (NOW_SECONDS + 121n).toString(),
    })))).rejects.toThrow("expiry binding");
    await expect(mint(successFetch(envelope({
      issuedAtUnixSeconds: (NOW_SECONDS - 121n).toString(),
      expiresAtUnixSeconds: (NOW_SECONDS + 1n).toString(),
    })))).rejects.toThrow("expiry binding");
    await expect(mint(successFetch(envelope({
      issuedAtUnixSeconds: (NOW_SECONDS + 31n).toString(),
      expiresAtUnixSeconds: (NOW_SECONDS + 151n).toString(),
    })))).rejects.toThrow("expiry binding");
  });

  it("rejects noncanonical envelopes and non-JSON media", async () => {
    await expect(mint(successFetch({ ...envelope(), extra: true })))
      .rejects.toThrow("prepared response fields");
    await expect(mint(vi.fn<typeof fetch>(async () => response(
      envelope(),
      { contentType: "text/plain" },
    )))).rejects.toThrow("response content type");
  });

  it("enforces the bounded response body before JSON parsing", async () => {
    const oversized = "x".repeat(
      PREDICTION_V2_CLIENT_API_MAXIMUM_BODY_BYTES_V2 + 1,
    );
    const result = new Response(oversized, {
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(result, "url", { value: `${ORIGIN}${PATH}` });
    await expect(mint(vi.fn<typeof fetch>(async () => result)))
      .rejects.toThrow("response body size");
  });

  it("maps closed public error responses without trusting malformed errors", async () => {
    const errorBody = {
      schemaVersion: PREDICTION_V2_CLIENT_API_ERROR_SCHEMA_V2,
      code: "rate_limited",
      message: "Try again soon",
      retryable: true,
    };
    await expect(mint(vi.fn<typeof fetch>(async () => response(
      errorBody,
      { status: 429 },
    )))).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      retryable: true,
    });
    await expect(mint(vi.fn<typeof fetch>(async () => response(
      { message: "raw internal error" },
      { status: 500 },
    )))).rejects.toMatchObject({
      status: 500,
      code: "invalid_response",
      retryable: false,
    });
    expect(parsePredictionV2ClientApiErrorV2(errorBody)).toEqual(errorBody);
  });

  it("maps network failure and preserves caller abort", async () => {
    await expect(mint(vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    }))).rejects.toBeInstanceOf(PredictionV2ClientApiErrorV2);
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(fetchPredictionV2PreparedTransactionV2({
      requestBody: REQUEST_BODY,
      expected: EXPECTED,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses only the captured transport inside the frozen client facade", async () => {
    const fetchMock = successFetch();
    capturedFetch.mockImplementation(fetchMock);
    const client = createPredictionV2ClientApiV2();
    await expect(client.prepare({
      requestBody: REQUEST_BODY,
      expected: EXPECTED,
    })).resolves.toMatchObject({ actionId: ACTION_ID });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("ignores caller-injected transports and never lets them mint the brand", async () => {
    const captured = successFetch();
    const attacker = vi.fn<typeof fetch>(async () => response(envelope({
      account: address(99),
    })));
    capturedFetch.mockImplementation(captured);
    await expect(fetchPredictionV2PreparedTransactionV2({
      requestBody: REQUEST_BODY,
      expected: EXPECTED,
      fetch: attacker,
    } as Parameters<typeof fetchPredictionV2PreparedTransactionV2>[0]))
      .resolves.toMatchObject({ account: ACCOUNT });
    expect(captured).toHaveBeenCalledOnce();
    expect(attacker).not.toHaveBeenCalled();

    const facade = (createPredictionV2ClientApiV2 as unknown as (
      input: unknown,
    ) => ReturnType<typeof createPredictionV2ClientApiV2>)({ fetch: attacker });
    await expect(facade.prepare({
      requestBody: REQUEST_BODY,
      expected: EXPECTED,
    })).resolves.toMatchObject({ account: ACCOUNT });
    expect(attacker).not.toHaveBeenCalled();
  });
});

describe("Prediction V2 branded wallet submission", () => {
  it("rechecks chain and account twice immediately before EIP-1193 send", async () => {
    const prepared = await mint();
    const methods: string[] = [];
    const provider: PredictionV2Eip1193ProviderV2 = {
      async request(request) {
        methods.push(request.method);
        if (request.method === "eth_chainId") return "0x1237";
        if (request.method === "eth_accounts") return [ACCOUNT];
        expect(request.params).toEqual([{
          from: ACCOUNT,
          to: VAULT,
          data: TRANSACTION.data,
          value: "0x0",
          gas: "0x7a120",
        }]);
        return bytes32(501);
      },
    };
    await expect(submitPredictionV2Eip1193TransactionV2({ prepared, provider }))
      .resolves.toBe(bytes32(501));
    expect(methods).toEqual([
      "eth_chainId",
      "eth_accounts",
      "eth_chainId",
      "eth_accounts",
      "eth_sendTransaction",
    ]);
  });

  it("does not send when chain or account changes inside the lock", async () => {
    for (const values of [
      ["0x1237", [ACCOUNT], "0x1", [ACCOUNT]],
      ["0x1237", [ACCOUNT], "0x1237", [address(99)]],
    ] as const) {
      const prepared = await mint();
      let index = 0;
      let sends = 0;
      const provider: PredictionV2Eip1193ProviderV2 = {
        async request(request) {
          if (request.method === "eth_sendTransaction") {
            sends += 1;
            return bytes32(502);
          }
          return values[index++];
        },
      };
      await expect(submitPredictionV2Eip1193TransactionV2({ prepared, provider }))
        .rejects.toThrow("provider wallet stability");
      expect(sends).toBe(0);
    }
  });

  it("rechecks expiry after provider state reads and before send", async () => {
    const prepared = await mint();
    let accountReads = 0;
    let sends = 0;
    const provider: PredictionV2Eip1193ProviderV2 = {
      async request(request) {
        if (request.method === "eth_chainId") return "0x1237";
        if (request.method === "eth_accounts") {
          accountReads += 1;
          if (accountReads === 2) {
            vi.setSystemTime(new Date(NOW.getTime() + 121_000));
          }
          return [ACCOUNT];
        }
        sends += 1;
        return bytes32(503);
      },
    };
    await expect(submitPredictionV2Eip1193TransactionV2({ prepared, provider }))
      .rejects.toThrow("expiry binding");
    expect(sends).toBe(0);
  });

  it("rejects a structural clone because JSON/RSC cannot mint the send brand", async () => {
    const prepared = await mint();
    const clone = { ...prepared } as ParsedPredictionV2PreparedTransactionV2;
    const provider: PredictionV2Eip1193ProviderV2 = {
      async request(request) {
        if (request.method === "eth_chainId") return "0x1237";
        if (request.method === "eth_accounts") return [ACCOUNT];
        throw new Error("must not send");
      },
    };
    await expect(submitPredictionV2Eip1193TransactionV2({
      prepared: clone,
      provider,
    })).rejects.toThrow("parsed transaction capability");
  });

  it("binds the exact live Privy wallet and account into the send request", async () => {
    const prepared = await mint();
    const wallet = Object.freeze({ id: "wallet-a" });
    const send = vi.fn(async () => bytes32(504));
    await expect(submitPredictionV2PrivyTransactionV2({
      prepared,
      connected: () => ({
        account: address(99),
        chainId: 4_663,
        wallet,
      }),
      send,
    })).rejects.toThrow("connected account binding");
    expect(send).not.toHaveBeenCalled();
    await expect(submitPredictionV2PrivyTransactionV2({
      prepared,
      connected: () => ({ account: ACCOUNT, chainId: 4_663, wallet }),
      send,
    })).resolves.toBe(bytes32(504));
    expect(send).toHaveBeenCalledWith({
      account: ACCOUNT,
      wallet,
      transaction: {
        to: VAULT,
        data: TRANSACTION.data,
        value: 0n,
        gasLimit: 500_000n,
        chainId: 4_663,
      },
    });
  });

  it("does not send when Privy changes the concrete wallet capability", async () => {
    const prepared = await mint();
    const walletA = Object.freeze({ id: "wallet-a" });
    const walletB = Object.freeze({ id: "wallet-b" });
    const send = vi.fn(async () => bytes32(505));
    let reads = 0;

    await expect(submitPredictionV2PrivyTransactionV2({
      prepared,
      connected: () => ({
        account: ACCOUNT,
        chainId: 4_663,
        wallet: reads++ === 0 ? walletA : walletB,
      }),
      send,
    })).rejects.toThrow("Privy wallet stability");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send when Privy changes account or chain between checks", async () => {
    for (const finalConnection of [
      { account: address(99), chainId: 4_663 },
      { account: ACCOUNT, chainId: 1 },
    ] as const) {
      const prepared = await mint();
      const wallet = Object.freeze({ id: "wallet-a" });
      const send = vi.fn(async () => bytes32(506));
      let reads = 0;

      await expect(submitPredictionV2PrivyTransactionV2({
        prepared,
        connected: () => ({
          ...(reads++ === 0
            ? { account: ACCOUNT, chainId: 4_663 }
            : finalConnection),
          wallet,
        }),
        send,
      })).rejects.toThrow(/connected (account|chain) binding/u);
      expect(send).not.toHaveBeenCalled();
    }
  });
});
