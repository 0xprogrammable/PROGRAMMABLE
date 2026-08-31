import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createPublicClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: mocks.createPublicClient,
}));
vi.mock("../lib/main-token-migration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/main-token-migration")>();
  const { keccak256 } = await import("viem");
  return {
    ...actual,
    // Unit-only runtime fixture: derive its pin from its actual bytes. This
    // does not replace the production token's runtime pin or claim live proof.
    MAIN_TOKEN_RUNTIME_CODE_KECCAK256: keccak256("0x6001600055"),
  };
});

import {
  MAIN_TOKEN_ADDRESS,
  MAIN_TOKEN_MIGRATION_RELEASE_ID,
  MAIN_TOKEN_NAME,
  MAIN_TOKEN_PERMIT_DOMAIN_SEPARATOR,
} from "../lib/main-token-migration";
import {
  createMainTokenMigrationGaslessChainV1,
} from "../lib/server/main-token-migration-gasless-transfer-v1";

const walletAddress = "0x0000000000000000000000000000000000000011" as Address;
const sponsorAddress = "0x0000000000000000000000000000000000000022" as Address;
const tokenCode = "0x6001600055" as Hex;
const blockHash = `0x${"12".repeat(32)}` as Hex;
const commonBlock = 25_900_100n;
const configuration = {
  releaseId: MAIN_TOKEN_MIGRATION_RELEASE_ID,
  windowStartTimestamp: 1_788_159_300,
  startBlockNumber: 25_873_498n,
  startBlockHash: `0x${"33".repeat(32)}` as Hex,
  deadlineTimestampExclusive: 1_788_418_500,
  sponsorWalletId: "wallet-current-holder-test",
  sponsorPolicyId: "policy-current-holder-test",
  sponsorAddress,
  maximumTopUpWei: 2_000_000_000_000_000n,
  totalBudgetWei: 1_000_000_000_000_000_000n,
};
type State = {
  code?: Hex;
  tokenCode: Hex;
  sponsorCode?: Hex;
  chainId: number;
  blockHash: Hex;
  name: string;
  domainSeparator: Hex;
  nonce: bigint;
  balance: bigint;
  sponsorBalance: bigint;
  fee: bigint;
  priorityFee: bigint;
};

function client(state: State, head: bigint) {
  return {
    getBlockNumber: vi.fn(async () => head),
    getChainId: vi.fn(async () => state.chainId),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber, hash: state.blockHash, timestamp: 1_788_170_000n,
    })),
    getCode: vi.fn(async ({ address }: { address: Address; blockNumber: bigint }) =>
      address.toLowerCase() === MAIN_TOKEN_ADDRESS.toLowerCase() ? state.tokenCode
        : address === sponsorAddress ? state.sponsorCode : state.code),
    readContract: vi.fn(async (input: {
      functionName: string; blockNumber: bigint; args?: readonly unknown[];
    }) => {
      if (input.blockNumber !== commonBlock) throw new Error("unexpected historical read");
      if (input.functionName === "name") return state.name;
      if (input.functionName === "DOMAIN_SEPARATOR") return state.domainSeparator;
      if (input.functionName === "nonces") return state.nonce;
      if (input.functionName === "balanceOf") return state.balance;
      throw new Error("unexpected contract read");
    }),
    getBalance: vi.fn(async () => state.sponsorBalance),
    estimateFeesPerGas: vi.fn(async () => ({
      maxFeePerGas: state.fee, maxPriorityFeePerGas: state.priorityFee,
    })),
    getLogs: vi.fn(async () => { throw new Error("historical eligibility must not run"); }),
  };
}

function fixture(overrides: Partial<State> = {}) {
  const initial: State = {
    code: "0x", tokenCode, sponsorCode: "0x", chainId: 1, blockHash,
    name: MAIN_TOKEN_NAME, domainSeparator: MAIN_TOKEN_PERMIT_DOMAIN_SEPARATOR,
    nonce: 3n, balance: 150n, sponsorBalance: 20_000_000_000_000_000n,
    fee: 1_000_000_000n, priorityFee: 100_000_000n, ...overrides,
  };
  const left = { ...initial };
  const right = { ...initial };
  const clients = [client(left, commonBlock + 1n), client(right, commonBlock)];
  mocks.createPublicClient.mockReturnValueOnce(clients[0]).mockReturnValueOnce(clients[1]);
  const chain = createMainTokenMigrationGaslessChainV1([
    { endpoint: "https://primary.invalid" },
    { endpoint: "https://secondary.invalid" },
  ] as never);
  return { left, right, clients, prepare: () => chain.prepare({
    configuration, walletAddress, amountRaw: 100n,
  }) };
}

beforeEach(() => { mocks.createPublicClient.mockReset(); });

describe("gasless current-holder eligibility", () => {
  it.each([
    undefined,
    "0x" as Hex,
    `0xef0100${"55".repeat(20)}` as Hex,
  ])("accepts a current EOA holder without historical eligibility (code=%s)", async (code) => {
    const { prepare, clients } = fixture({ code });
    await expect(prepare()).resolves.toMatchObject({
      nonce: 3n, rootWalletAddress: walletAddress,
      sponsorBalanceWei: 20_000_000_000_000_000n,
    });
    for (const rpc of clients) {
      expect(rpc.getLogs).not.toHaveBeenCalled();
      expect(rpc.getBlock).toHaveBeenCalledExactlyOnceWith({ blockNumber: commonBlock });
      expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({
        functionName: "balanceOf", args: [walletAddress], blockNumber: commonBlock,
      }));
      expect(rpc.getCode.mock.calls.every(([input]) => input.blockNumber === commonBlock)).toBe(true);
    }
  });

  it("uses conservative current fee quotes without requiring identical estimates", async () => {
    const { right, prepare } = fixture();
    right.fee = 2_000_000_000n;
    right.priorityFee = 200_000_000n;
    await expect(prepare()).resolves.toMatchObject({
      feePerGasWei: right.fee, maxPriorityFeePerGasWei: right.priorityFee,
    });
  });

  it.each([
    [{ balance: 99n }, 422, "insufficient_balance"],
    [{ code: "0x6002" }, 422, "gasless_wallet_unsupported"],
    [{ code: "0xef010055" }, 422, "gasless_wallet_unsupported"],
    [{ tokenCode: "0x6002" }, 503, "token_binding_mismatch"],
    [{ name: "Other token" }, 503, "token_binding_mismatch"],
    [{ domainSeparator: `0x${"44".repeat(32)}` }, 503, "token_binding_mismatch"],
    [{ sponsorCode: `0xef0100${"55".repeat(20)}` }, 503, "sponsor_wallet_mismatch"],
    [{ fee: 0n }, 503, "gas_quote_unavailable"],
  ] as const)("rejects unsupported or unbound state (case %#)", async (override, status, code) => {
    const { prepare } = fixture(override);
    await expect(prepare()).rejects.toMatchObject({ status, code });
  });

  it.each([
    { chainId: 4663 },
    { blockHash: `0x${"66".repeat(32)}` as Hex },
    { nonce: 4n },
    { balance: 151n },
    { sponsorBalance: 1n },
  ])("fails closed on provider disagreement (case %#)", async (override) => {
    const { right, prepare } = fixture();
    Object.assign(right, override);
    await expect(prepare()).rejects.toMatchObject({ status: 503, code: "rpc_quorum_unavailable" });
  });

  it("normalizes RPC failures without leaking provider details", async () => {
    const { clients, prepare } = fixture();
    clients[0]!.getBlockNumber.mockRejectedValueOnce(new Error("private-provider-credential"));
    await expect(prepare()).rejects.toMatchObject({ status: 503, code: "rpc_quorum_unavailable" });
  });
});
