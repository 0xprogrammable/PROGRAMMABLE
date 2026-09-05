import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi, toEventSelector, toHex, type Address, type Hex } from "viem";

const mocks = vi.hoisted(() => ({
  client: {
    getChainId: vi.fn(), getBlock: vi.fn(), getTransactionReceipt: vi.fn(),
    readContract: vi.fn(), request: vi.fn(),
  },
  root: vi.fn(),
  validate: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => mocks.client,
}));
vi.mock("@/lib/server/robinhood-index/verify-launch-stamp", () => ({ verifyLaunchStampWithViem: mocks.root }));
vi.mock("ajv/dist/2020", () => ({ default: class {
  async compileAsync() { return mocks.validate; }
} }));
vi.mock("ajv-formats", () => ({ default: vi.fn() }));

import { robinhoodSource } from "@/lib/server/robinhood-index/source";
import { IndexBlockIncomplete, IndexRangeTooWide } from "@/lib/server/robinhood-index/sync";

const ORIGIN = "https://developers.programmable.family";
const SCHEMA = `${ORIGIN}/schemas/v2/manifest.schema.json`;
const ROUTER = address(100);
const FACTORY = address(101);
const POOL_MANAGER = address(102);
const RPC = "https://rpc.example.test";
// Only the three event definitions are needed: root/schema verification is a
// separate dependency here; event encoding and source decoding are both real.
const ABI = parseAbi([
  "event ProgrammableLaunchStampedV1(bytes32 indexed launchId,address indexed token,address indexed hook,address poolManager,bytes32 poolId,bytes32 stampHash)",
  "event ProgrammableLaunchRouteStampedV1(bytes32 indexed launchId,uint8 indexed kind,bytes32 indexed routePayloadHash,bytes32 expectedResultHash,bytes32 permitDigest)",
  "event ProgrammableComponentStampedV1(bytes32 indexed launchId,address indexed component,uint8 indexed kind,bytes32 runtimeCodeHash)",
]);
const ABI_TEXT = JSON.stringify(ABI);

function hash(value: number | bigint): Hex {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}
function address(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}`;
}
function block(number: bigint) {
  return { number, hash: hash(number + 100_000n), timestamp: 1_780_000_000n };
}

function fixture(count = 1) {
  const records = Array.from({ length: count }, (_, index) => ({
    kind: 1, launchId: hash(index + 1), launchWallet: address(103),
    token: address(1_000 + index), hook: address(9_000 + index), poolManager: POOL_MANAGER,
    poolId: hash(2_000 + index), stampHash: hash(3_000 + index), poolKeyHash: hash(4_000 + index),
    componentSetHash: hash(5_000 + index), routePayloadHash: hash(6_000 + index),
    expectedResultHash: hash(7_000 + index), permitDigest: hash(8_000 + index),
    routeLauncher: FACTORY, routeLauncherRuntimeCodeHash: hash(9_000),
    tokenRuntime: hash(10_000 + index), hookRuntime: hash(11_000 + index),
  }));
  const logs = records.flatMap((record, index) => {
    const base = { address: ROUTER, blockNumber: toHex(150n), blockHash: block(150n).hash,
      transactionHash: hash(20_000 + index), removed: false };
    const components = [[record.token, 1, record.tokenRuntime], [record.hook, 2, record.hookRuntime]] as const;
    return [
      ...components.map(([component, kind, runtime], offset) => ({
        ...base, logIndex: toHex(index * 4 + offset),
        topics: encodeEventTopics({ abi: ABI, eventName: "ProgrammableComponentStampedV1", args: {
          launchId: record.launchId, component, kind,
        } }),
        data: encodeAbiParameters([{ type: "bytes32" }], [runtime]),
      })),
      {
        ...base, logIndex: toHex(index * 4 + 2),
        topics: encodeEventTopics({ abi: ABI, eventName: "ProgrammableLaunchRouteStampedV1", args: record }),
        data: encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [record.expectedResultHash, record.permitDigest]),
      },
      {
        ...base, logIndex: toHex(index * 4 + 3),
        topics: encodeEventTopics({ abi: ABI, eventName: "ProgrammableLaunchStampedV1", args: record }),
        data: encodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
          [record.poolManager, record.poolId, record.stampHash]),
      },
    ];
  });
  const manifest = {
    $schema: SCHEMA, chainId: 4663, caip2: "eip155:4663",
    launchStampRouter: {
      status: "live", address: ROUTER, startBlock: "100", runtimeCodeHash: hash(99),
      abiUrl: `${ORIGIN}/abis/programmable-launch-stamp-router-v1.json`,
      abiSha256: `sha256:${createHash("sha256").update(ABI_TEXT).digest("hex")}`,
      bindings: { poolManager: POOL_MANAGER, graphFactory: FACTORY, graphFactoryRuntimeCodeHash: hash(9_000) },
      events: {
        launchStamped: { topic0: toEventSelector(ABI[0]) },
        launchRouteStamped: { topic0: toEventSelector(ABI[1]) },
        componentStamped: { topic0: toEventSelector(ABI[2]) },
      },
      deploymentEvidence: { deploymentTransactionHash: hash(30_000), deploymentBlockNumber: "100", deploymentBlockHash: block(100n).hash },
      canaryEvidence: { transactionHash: hash(20_000), blockNumber: "150", blockHash: block(150n).hash, launchId: records[0].launchId },
    },
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === manifest.launchStampRouter.abiUrl) return new Response(ABI_TEXT);
    const value = url === `${ORIGIN}/.well-known/programmable.json`
      ? { chains: [{ chainId: 4663, manifestUrl: `${ORIGIN}/api/v2/manifests/4663` }] }
      : url === `${ORIGIN}/api/v2/manifests/4663` ? manifest : url === SCHEMA ? {} : null;
    if (value === null) throw new Error(`Unexpected fixture URL: ${url}`);
    return Response.json(value);
  }));
  mocks.root.mockResolvedValue({ state: "not-stamped", router: ROUTER, blockHash: block(299n).hash });
  mocks.client.getChainId.mockResolvedValue(4663);
  mocks.client.getBlock.mockImplementation(async (query: { blockNumber?: bigint }) => block(query.blockNumber ?? 299n));
  mocks.client.getTransactionReceipt.mockImplementation(async ({ hash: transactionHash }: { hash: Hex }) => {
    const number = transactionHash === hash(30_000) ? 100n : 150n;
    return { status: "success", transactionHash, blockNumber: number, blockHash: block(number).hash, logs: number === 150n ? logs : [] };
  });
  const read = async ({ functionName, args = [] }: { functionName: string; args?: readonly unknown[] }) => {
    const record = records.find((row) => [row.launchId, row.token, row.hook, row.poolManager]
      .some((value) => value.toLowerCase() === String(args[0]).toLowerCase())) ?? records[0];
    switch (functionName) {
      case "launchStamp": return record;
      case "launchIdByToken": return record.launchId;
      case "launchIdByPool": return records.find((row) => row.poolId === args[1])?.launchId;
      case "stampProof": return [record.launchId, record.stampHash];
      case "componentRuntimeCodeHash": return String(args[0]).toLowerCase() === record.token.toLowerCase() ? record.tokenRuntime : record.hookRuntime;
      case "name": return "Custom token";
      case "symbol": return "CUST";
      case "decimals": return 18;
      default: throw new Error(`Unexpected fixture getter: ${functionName}`);
    }
  };
  mocks.client.readContract.mockImplementation(read);
  mocks.client.request.mockImplementation(async () => logs);
  return { records, logs, read, manifest };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.validate.mockReturnValue(true);
});
afterEach(() => vi.unstubAllGlobals());

describe("Robinhood website canonical stamp source", () => {
  it("accepts a stamped arbitrary hook and preserves the launch when ERC-20 metadata reverts", async () => {
    const { records, read } = fixture();
    mocks.client.readContract.mockImplementation(async (query) => {
      if (["name", "symbol", "decimals"].includes(query.functionName)) throw new Error("ERC-20 metadata revert");
      return read(query);
    });
    const source = await robinhoodSource(RPC);

    const rows = await source.launches(100n, 199n, []);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tokenAddress: records[0].token, hookAddress: records[0].hook,
      launchId: records[0].launchId, name: null, symbol: null, decimals: null });
    expect(mocks.root).toHaveBeenCalledOnce();
    expect(mocks.client.readContract.mock.calls.every(([query]) => query.blockNumber === 299n)).toBe(true);
    expect(mocks.client.request).toHaveBeenCalledWith({ method: "eth_getLogs", params: [{
      address: ROUTER, fromBlock: "0x64", toBlock: "0xc7", topics: [[toEventSelector(ABI[0]), toEventSelector(ABI[1]), toEventSelector(ABI[2])]],
    }] });
  });

  it("rejects a matching event topic from a foreign emitter", async () => {
    const { logs } = fixture();
    const source = await robinhoodSource(RPC);
    mocks.client.request.mockResolvedValue(logs.map((log) => ({ ...log, address: address(999) })));

    await expect(source.launches(100n, 199n, [])).rejects.toThrow("stamp verification failed");
    expect(mocks.client.readContract).not.toHaveBeenCalled();
  });

  it.each(["token proof", "pool lookup", "route commitment"])("rejects a conflicting %s", async (failure) => {
    const { records, read } = fixture();
    const source = await robinhoodSource(RPC);
    mocks.client.readContract.mockImplementation(async (query) => {
      if (failure === "token proof" && query.functionName === "stampProof" && query.args?.[0] === records[0].token) {
        return [records[0].launchId, hash(999)];
      }
      if (failure === "pool lookup" && query.functionName === "launchIdByPool") return hash(999);
      if (failure === "route commitment" && query.functionName === "launchStamp") return { ...records[0], routePayloadHash: hash(999) };
      return read(query);
    });

    await expect(source.launches(100n, 199n, [])).rejects.toThrow("stamp verification failed");
  });

  it("requests a smaller range before hydrating more than three new launches", async () => {
    fixture(4);
    const source = await robinhoodSource(RPC);

    await expect(source.launches(100n, 199n, [])).rejects.toBeInstanceOf(IndexRangeTooWide);
    expect(mocks.client.readContract).not.toHaveBeenCalled();
  });

  it("continues a dense single block from its three verified launches without verifying them twice", async () => {
    const { records } = fixture(4);
    const source = await robinhoodSource(RPC);
    const incomplete = await source.launches(150n, 150n, []).then(() => null, (error: unknown) => error);
    expect(incomplete).toBeInstanceOf(IndexBlockIncomplete);
    if (!(incomplete instanceof IndexBlockIncomplete)) throw new Error("Expected a partial block");
    expect(incomplete.items.map((row) => row.launchId)).toEqual(records.slice(0, 3).map((row) => row.launchId));
    mocks.client.readContract.mockClear();

    const complete = await source.launches(150n, 150n, incomplete.items);

    expect(complete.map((row) => row.launchId)).toEqual(records.map((row) => row.launchId));
    const stampReads = mocks.client.readContract.mock.calls.filter(([query]) => query.functionName === "launchStamp");
    expect(stampReads).toHaveLength(1);
    expect(stampReads[0][0].args).toEqual([records[3].launchId]);
    expect(mocks.root).toHaveBeenCalledOnce();
  });
});
