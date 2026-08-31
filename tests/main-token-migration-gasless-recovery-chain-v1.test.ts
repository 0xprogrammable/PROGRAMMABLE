import { TransactionReceiptNotFoundError, type Address, type Hex } from "viem";
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
    // Unit-only executable bytes and their derived pin, never live-chain evidence.
    MAIN_TOKEN_RUNTIME_CODE_KECCAK256: keccak256("0x6001600055"),
  };
});

import {
  MAIN_TOKEN_ADDRESS,
  MAIN_TOKEN_MIGRATION_RELEASE_ID,
  MAIN_TOKEN_NAME,
  MAIN_TOKEN_PERMIT_DOMAIN_SEPARATOR,
} from "../lib/main-token-migration";
import { createMainTokenMigrationGaslessChainV1 } from
  "../lib/server/main-token-migration-gasless-transfer-v1";
import type { MainTokenMigrationGaslessRecordV1 } from
  "../lib/server/main-token-migration-gasless-transfer-store-v1";

const holder = "0x0000000000000000000000000000000000000011" as Address;
const sponsor = "0x0000000000000000000000000000000000000022" as Address;
const finalizedNumber = 25_900_000n;
const finalizedHash = `0x${"12".repeat(32)}` as Hex;
const latestNumber = finalizedNumber + 10n;
const latestHash = `0x${"13".repeat(32)}` as Hex;
const expiredDeadline = 1_788_170_000n;

type State = {
  chainId: number;
  finalizedTimestamp: bigint;
  finalizedHash: Hex;
  latestHash: Hex;
  finalizedNonce: bigint;
  latestNonce: bigint;
  finalizedAllowance: bigint;
  latestAllowance: bigint;
  tokenCode: Hex;
  domain: Hex;
};

function fixture() {
  const state: State = {
    chainId: 1,
    finalizedTimestamp: expiredDeadline + 1n,
    finalizedHash,
    latestHash,
    finalizedNonce: 3n,
    latestNonce: 3n,
    finalizedAllowance: 0n,
    latestAllowance: 0n,
    tokenCode: "0x6001600055",
    domain: MAIN_TOKEN_PERMIT_DOMAIN_SEPARATOR,
  };
  const states = [{ ...state }, { ...state }];
  const clients = states.map((s, index) => ({
    getChainId: vi.fn(async () => s.chainId),
    getBlockNumber: vi.fn(async () => latestNumber + BigInt(index)),
    getBlock: vi.fn(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      const number = input.blockTag === "finalized"
        ? finalizedNumber + BigInt(index) : input.blockNumber;
      if (number === undefined) throw new Error("An explicit canonical block is required");
      const finalized = number <= finalizedNumber + 1n;
      return {
        number,
        hash: finalized ? s.finalizedHash : s.latestHash,
        timestamp: finalized ? s.finalizedTimestamp : expiredDeadline + 100n,
      };
    }),
    getCode: vi.fn(async ({ address }: { address: Address }) =>
      address.toLowerCase() === MAIN_TOKEN_ADDRESS.toLowerCase() ? s.tokenCode : "0x"),
    readContract: vi.fn(async (input: { functionName: string; blockNumber?: bigint }) => {
      if (input.blockNumber !== finalizedNumber && input.blockNumber !== latestNumber) {
        throw new Error("Contract read must use a common explicit block");
      }
      const finalized = input.blockNumber === finalizedNumber;
      if (input.functionName === "name") return MAIN_TOKEN_NAME;
      if (input.functionName === "DOMAIN_SEPARATOR") return s.domain;
      if (input.functionName === "nonces") return finalized ? s.finalizedNonce : s.latestNonce;
      if (input.functionName === "allowance") return finalized ? s.finalizedAllowance : s.latestAllowance;
      if (input.functionName === "balanceOf") return 100n;
      throw new Error("Unexpected contract read");
    }),
    getTransactionReceipt: vi.fn(async () => {
      throw new Error("Unclassified receipt error must fail closed");
    }),
  }));
  clients.forEach((client) => mocks.createPublicClient.mockReturnValueOnce(client));
  const chain = createMainTokenMigrationGaslessChainV1([
    { endpoint: "https://primary.invalid" }, { endpoint: "https://secondary.invalid" },
  ] as never);
  const record: MainTokenMigrationGaslessRecordV1 = {
    intent: {
      schema: "programmable-main-token-migration-gasless-intent/v1",
      releaseId: MAIN_TOKEN_MIGRATION_RELEASE_ID,
      walletAddress: holder,
      rootWalletAddress: holder,
      sponsorAddress: sponsor,
      amountRaw: "100",
      nonce: "3",
      permitDeadline: expiredDeadline.toString(),
      permitSignature: `0x${"11".repeat(65)}`,
      permitGasLimit: "100000",
      transferGasLimit: "100000",
      maxFeePerGasWei: "1000000000",
      maxPriorityFeePerGasWei: "100000000",
      reservedTotalWei: "200000000000000",
      totalBudgetWei: "1000000000000000000",
      requestBindingHash: `sha256:${"44".repeat(32)}`,
      providerPermitIdempotencyKey: "expired-recovery-permit-fixture",
      providerPermitReferenceId: "expired-recovery-permit-fixture",
      providerTransferIdempotencyKey: "expired-recovery-transfer-fixture",
      providerTransferReferenceId: "expired-recovery-transfer-fixture",
      reservedAt: "2026-08-31T09:00:00.000Z",
    },
    permitTransactionHash: null,
    transferTransactionHash: null,
  };
  return { states, clients, chain, record };
}

beforeEach(() => mocks.createPublicClient.mockReset());

describe("expired gasless permit recovery chain proof", () => {
  it("proves expiry from a common finalized block and unused allowance at both canonical reads", async () => {
    const { chain, record, clients } = fixture();
    await expect(chain.assertRecoverable(record)).resolves.toMatchObject({
      finalizedBlockNumber: finalizedNumber.toString(),
      finalizedBlockHash: finalizedHash,
      finalizedBlockTimestamp: (expiredDeadline + 1n).toString(),
      nonce: "3",
      allowanceRaw: "0",
    });
    for (const client of clients) {
      expect(client.getBlock).toHaveBeenCalledWith({ blockTag: "finalized" });
      expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({
        functionName: "nonces", blockNumber: finalizedNumber,
      }));
      expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({
        functionName: "allowance", blockNumber: latestNumber,
      }));
    }
  });

  it.each([
    { finalizedTimestamp: expiredDeadline },
    { finalizedTimestamp: expiredDeadline - 1n },
    { finalizedNonce: 4n },
    { latestNonce: 4n },
    { finalizedAllowance: 100n },
    { latestAllowance: 100n },
    { chainId: 4663 },
    { tokenCode: "0x6002" as Hex },
    { domain: `0x${"55".repeat(32)}` as Hex },
  ])("rejects unusable or changed state even when providers agree (%#)", async (override) => {
    const { chain, record, states } = fixture();
    states.forEach((state) => Object.assign(state, override));
    await expect(chain.assertRecoverable(record)).rejects.toThrow();
  });

  it.each([
    { finalizedHash: `0x${"66".repeat(32)}` as Hex },
    { latestHash: `0x${"66".repeat(32)}` as Hex },
    { finalizedTimestamp: expiredDeadline + 2n },
    { latestNonce: 4n },
    { latestAllowance: 100n },
  ])("rejects RPC disagreement (%#)", async (override) => {
    const { chain, record, states } = fixture();
    Object.assign(states[1], override);
    await expect(chain.assertRecoverable(record)).rejects.toThrow();
  });

  it("does not replace an unavailable finalized read with latest state", async () => {
    const { chain, record, clients } = fixture();
    clients[1]!.getBlock.mockRejectedValueOnce(new Error("finalized unavailable"));
    await expect(chain.assertRecoverable(record)).rejects.toThrow();
  });

  it("does not treat arbitrary receipt errors as proof that a known permit never executed", async () => {
    const { chain, record } = fixture();
    await expect(chain.assertRecoverable({
      ...record, permitTransactionHash: `0x${"77".repeat(32)}`,
    })).rejects.toThrow();
  });

  it("accepts authoritative null receipts for an expired, unused known permit", async () => {
    const { chain, record, clients } = fixture();
    const hash = `0x${"77".repeat(32)}` as Hex;
    for (const client of clients) {
      client.getTransactionReceipt.mockRejectedValue(new TransactionReceiptNotFoundError({ hash }));
    }
    await expect(chain.assertRecoverable({ ...record, permitTransactionHash: hash }))
      .resolves.toMatchObject({ nonce: "3", allowanceRaw: "0" });
  });

  it("rejects a successful permit receipt from either RPC", async () => {
    const { chain, record, clients } = fixture();
    const hash = `0x${"77".repeat(32)}` as Hex;
    clients[0]!.getTransactionReceipt.mockRejectedValue(new TransactionReceiptNotFoundError({ hash }));
    clients[1]!.getTransactionReceipt.mockImplementation(async () => {
      return { transactionHash: hash, status: "success" } as never;
    });
    await expect(chain.assertRecoverable({ ...record, permitTransactionHash: hash }))
      .rejects.toThrow();
  });
});
