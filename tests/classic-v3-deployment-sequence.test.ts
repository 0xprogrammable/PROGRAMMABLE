import { describe, expect, it } from "vitest";

// The release helper is intentionally a directly executable Node module.
// @ts-expect-error JavaScript release tool has no separate declaration file.
import * as releaseCore from "../scripts/classic-v3-release-core.mjs";

const {
  EXPECTED_ACCOUNT,
  FINALITY_CONFIRMATIONS,
  assertClassicV3SequenceState,
  assertReviewedClassicV3SourceCommitment,
  computeClassicV3SourceCommitment,
  createClassicV3Evidence,
  mergeClassicV3EvidenceRecord,
  prepareReviewedTransaction,
  validateClassicV3TransactionRecord,
} = releaseCore;

const transactions = Array.from({ length: 4 }, (_, index) => ({
  name: `Contract${index + 1}`,
  label: `Contract ${index + 1}`,
  transactionType: index === 2 ? "CALL" : "CREATE",
  address: `0x${String(index + 1).padStart(40, "0")}`,
  to:
    index === 2
      ? "0x0000000000000000000000000000000000000002"
      : null,
  nonce: `0x${(30 + index).toString(16)}`,
  value: "0x0",
  data: `0x60${String(index + 1).padStart(2, "0")}`,
  inputHash: `0x${String(index + 1).padStart(64, "0")}`,
  reviewedGasLimit: "0x1e8480",
}));

const plan = {
  planDigest: `0x${"11".repeat(32)}`,
  sourceCommitment: `0x${"22".repeat(32)}`,
  simulationDigest: `0x${"33".repeat(32)}`,
  startingNonce: 30,
  endingNonce: 34,
  transactions,
};

function state(
  confirmedNonce: number,
  pendingNonce: number,
  deployments: boolean[],
  balance = 10n ** 20n,
) {
  return {
    confirmedNonce: `0x${confirmedNonce.toString(16)}`,
    pendingNonce: `0x${pendingNonce.toString(16)}`,
    balance: `0x${balance.toString(16)}`,
    gasPrice: "0x3b9aca00",
    baseFeePerGas: "0x2faf0800",
    deployments: deployments.map((verified) => ({ verified })),
  };
}

function submittedTransaction(index: number) {
  const expected = transactions[index];
  return {
    hash: `0x${String(index + 10).padStart(64, "0")}`,
    from: EXPECTED_ACCOUNT,
    to: expected.to,
    nonce: expected.nonce,
    value: "0x0",
    input: expected.data,
    chainId: "0x1",
    gas: expected.reviewedGasLimit,
    maxFeePerGas: "0x77359400",
    maxPriorityFeePerGas: "0x5f5e100",
    blockNumber: null,
    blockHash: null,
  };
}

function confirmedTransaction(index: number) {
  return {
    ...submittedTransaction(index),
    blockNumber: "0x64",
    blockHash: `0x${"ab".repeat(32)}`,
  };
}

function successfulReceipt(index: number) {
  const expected = transactions[index];
  const transaction = confirmedTransaction(index);
  return {
    transactionHash: transaction.hash,
    status: "0x1",
    from: EXPECTED_ACCOUNT,
    to: expected.to,
    contractAddress:
      expected.transactionType === "CREATE" ? expected.address : null,
    blockNumber: transaction.blockNumber,
    blockHash: transaction.blockHash,
    transactionIndex: "0x0",
    gasUsed: "0x100000",
    effectiveGasPrice: "0x3b9aca00",
  };
}

describe("Classic V3 four-transaction boundary", () => {
  it("accepts a fresh and correctly resumed reviewed sequence", () => {
    expect(() =>
      assertClassicV3SequenceState(
        plan,
        state(30, 30, [false, false, false, false]),
      ),
    ).not.toThrow();
    expect(() =>
      assertClassicV3SequenceState(
        plan,
        state(32, 32, [true, true, false, false]),
      ),
    ).not.toThrow();
  });

  it("rejects nonce consumption without the expected deployment", () => {
    expect(() =>
      assertClassicV3SequenceState(
        plan,
        state(31, 31, [false, false, false, false]),
      ),
    ).toThrow("confirmed without the expected");
  });

  it("rejects code appearing before its reviewed nonce", () => {
    expect(() =>
      assertClassicV3SequenceState(
        plan,
        state(30, 30, [false, true, false, false]),
      ),
    ).toThrow("exists before its reviewed nonce");
  });

  it("allows later wallet activity only after all four deployments verify", () => {
    expect(() =>
      assertClassicV3SequenceState(
        plan,
        state(40, 40, [true, true, true, true]),
      ),
    ).not.toThrow();
    expect(() =>
      assertClassicV3SequenceState(
        plan,
        state(40, 40, [true, true, true, false]),
      ),
    ).toThrow("moved past the sequence");
  });

  it("rejects unrelated pending nonces during the reviewed sequence", () => {
    expect(() =>
      assertClassicV3SequenceState(
        plan,
        state(30, 35, [false, false, false, false]),
      ),
    ).toThrow("Pending nonce is outside");
  });
});

describe("Classic V3 dual-RPC preparation", () => {
  it("prepares only the exact next reviewed transaction", () => {
    const prepared = prepareReviewedTransaction(
      plan,
      state(30, 30, [false, false, false, false]),
      [
        { callResult: "0x1234", estimatedGas: "0x186a0" },
        { callResult: "0x1234", estimatedGas: "0x18a88" },
      ],
    );
    expect(prepared?.index).toBe(0);
    expect(prepared?.request.from).toBe(EXPECTED_ACCOUNT);
    expect(prepared?.request.nonce).toBe("0x1e");
    expect(prepared?.request.value).toBe("0x0");
    expect(prepared?.request.data).toBe(transactions[0].data);
  });

  it("rejects simulation disagreement and gas above the reviewed limit", () => {
    const current = state(30, 30, [false, false, false, false]);
    expect(() =>
      prepareReviewedTransaction(plan, current, [
        { callResult: "0x1234", estimatedGas: "0x186a0" },
        { callResult: "0xabcd", estimatedGas: "0x186a0" },
      ]),
    ).toThrow("simulations disagree");
    expect(() =>
      prepareReviewedTransaction(plan, current, [
        { callResult: "0x1234", estimatedGas: "0x1dc130" },
        { callResult: "0x1234", estimatedGas: "0x1dc130" },
      ]),
    ).toThrow("exceeds its reviewed gas limit");
  });

  it("blocks when the wallet cannot cover the remaining fee ceiling", () => {
    expect(() =>
      prepareReviewedTransaction(
        plan,
        state(30, 30, [false, false, false, false], 1n),
        [
          { callResult: "0x1234", estimatedGas: "0x186a0" },
          { callResult: "0x1234", estimatedGas: "0x186a0" },
        ],
      ),
    ).toThrow("balance is below");
  });
});

describe("Classic V3 receipt evidence", () => {
  it("records a pending exact transaction without treating it as confirmed", () => {
    const record = validateClassicV3TransactionRecord(
      plan,
      0,
      submittedTransaction(0),
      null,
    );
    expect(record.status).toBe("pending");
    expect(record.receipt).toBeNull();
  });

  it("rejects calldata drift and reverted receipts", () => {
    expect(() =>
      validateClassicV3TransactionRecord(
        plan,
        0,
        { ...submittedTransaction(0), input: "0xdeadbeef" },
        null,
      ),
    ).toThrow("does not match the reviewed request");
    expect(() =>
      validateClassicV3TransactionRecord(
        plan,
        0,
        confirmedTransaction(0),
        { ...successfulReceipt(0), status: "0x0" },
      ),
    ).toThrow("receipt does not match");
  });

  it("marks evidence ready only after every exact receipt is finalized", () => {
    const evidence = createClassicV3Evidence(plan, new Date(0));
    for (let index = 0; index < 4; index += 1) {
      const record = validateClassicV3TransactionRecord(
        plan,
        index,
        confirmedTransaction(index),
        successfulReceipt(index),
      );
      mergeClassicV3EvidenceRecord(
        evidence,
        plan,
        index,
        record,
        `0x${(100 + FINALITY_CONFIRMATIONS - 1).toString(16)}`,
        true,
        new Date(index + 1),
      );
    }
    expect(evidence.transactions.every((entry: { status: string }) =>
      entry.status === "finalized",
    )).toBe(true);
    expect(evidence.receiptEvidenceReady).toBe(true);
  });

  it("does not allow a recorded transaction hash to be replaced", () => {
    const evidence = createClassicV3Evidence(plan, new Date(0));
    const first = validateClassicV3TransactionRecord(
      plan,
      0,
      submittedTransaction(0),
      null,
    );
    mergeClassicV3EvidenceRecord(
      evidence,
      plan,
      0,
      first,
      "0x64",
      false,
    );
    const replacement = {
      ...first,
      transaction: {
        ...first.transaction,
        hash: `0x${"ff".repeat(32)}`,
      },
    };
    expect(() =>
      mergeClassicV3EvidenceRecord(
        evidence,
        plan,
        0,
        replacement,
        "0x64",
        false,
      ),
    ).toThrow("different transaction hash");
  });
});

describe("Classic V3 source commitment", () => {
  it("changes when any reviewed creation bytecode changes", () => {
    const artifacts = {
      feeSplitVaultFactory: {
        bytecode: { object: "0x6001" },
      },
      hookFactory: { bytecode: { object: "0x6002" } },
      feeHook: { bytecode: { object: "0x6003" } },
      launcher: { bytecode: { object: "0x6004" } },
    };
    const original = computeClassicV3SourceCommitment(artifacts);
    const changed = computeClassicV3SourceCommitment({
      ...artifacts,
      launcher: { bytecode: { object: "0x6005" } },
    });
    expect(original).toMatch(/^0x[0-9a-f]{64}$/);
    expect(changed).not.toBe(original);
    expect(() =>
      assertReviewedClassicV3SourceCommitment(
        artifacts,
        `0x${"ff".repeat(32)}`,
      ),
    ).toThrow("manifest source commitment drifted");
    expect(() =>
      assertReviewedClassicV3SourceCommitment(
        artifacts,
        releaseCore.REVIEWED_SOURCE_COMMITMENT,
      ),
    ).toThrow("artifacts do not match");
  });
});
