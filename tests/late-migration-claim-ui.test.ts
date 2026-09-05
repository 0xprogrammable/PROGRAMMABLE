import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/wallet-provider", () => ({ useWallet: vi.fn() }));
import {
  formatLateMigrationAmount, lateMigrationIntakeUiErrorMessage,
  LATE_MIGRATION_ELIGIBILITY_SCHEMA, parseLateMigrationEligibility,
} from "../components/late-migration-claim";
import {
  lateMigrationIntakeFailureMessageV1, lateMigrationIntakeProgressCopyV1,
  parseLateMigrationIntakeResponseV1, type LateMigrationIntakeExpectationV1,
} from "../lib/late-migration-intake-client-v1";

const walletAddress = "0x228Be90653fDDAa408fB6cf9ca0AEC311dbE9A0D";
const otherWallet = "0x1111111111111111111111111111111111111111";
const sourceContractAddress = "0x2222222222222222222222222222222222222222";
const transactionHash = `0x${"ab".repeat(32)}` as const;
const requestBindingHash = `sha256:${"cd".repeat(32)}` as const;
const expected: LateMigrationIntakeExpectationV1 = {
  walletAddress, offerIndex: 4, sourceContractAddress,
  requiredGrossDepositRaw: "12345000000000000000001", targetPayout80Raw: "9876000000000000000000",
};
function allocation() {
  return { schema: "programmable-late-migration-intake/v1", walletAddress, offerIndex: expected.offerIndex,
    requiredGrossDepositRaw: expected.requiredGrossDepositRaw, targetPayout80Raw: expected.targetPayout80Raw };
}
function prepared() {
  return {
    ...allocation(), status: "signature_required", permitNonce: "7", permitDeadline: "1788500000", requestBindingHash,
    typedData: {
      domain: { chainId: 1, name: "Programmable", version: "1", verifyingContract: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE" },
      primaryType: "Permit",
      types: { Permit: [ { name: "owner", type: "address" }, { name: "spender", type: "address" },
        { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" } ] },
      message: { owner: walletAddress, spender: sourceContractAddress, value: expected.requiredGrossDepositRaw, nonce: "7", deadline: "1788500000" },
    },
  };
}

describe("late migration exact snapshot amounts", () => {
  it("preserves all raw units and per-wallet 80% rounding", () => {
    expect(parseLateMigrationEligibility({ ...allocation(), schema: LATE_MIGRATION_ELIGIBILITY_SCHEMA, status: "eligible" }, walletAddress.toLowerCase())).toMatchObject({ requiredGrossDepositRaw: expected.requiredGrossDepositRaw, targetPayout80Raw: expected.targetPayout80Raw });
    expect(formatLateMigrationAmount(expected.requiredGrossDepositRaw)).toBe("12345.000000000000000001");
    expect(formatLateMigrationAmount(expected.targetPayout80Raw)).toBe("9876");
    expect(formatLateMigrationAmount("1")).toBe("0.000000000000000001");
    expect(formatLateMigrationAmount("176529129261873518239425341")).toBe("176529129.261873518239425341");
  });
  it("never invents amounts for ineligible wallets", () => {
    expect(parseLateMigrationEligibility({ schema: LATE_MIGRATION_ELIGIBILITY_SCHEMA, status: "not_eligible", walletAddress }, walletAddress)).toEqual({ status: "not_eligible", walletAddress });
  });
  it.each([
    ["notation", { requiredGrossDepositRaw: "1e18" }], ["leading zero", { requiredGrossDepositRaw: "0123" }],
    ["zero", { requiredGrossDepositRaw: "0" }], ["wrong payout", { targetPayout80Raw: "9876000000000000000001" }],
    ["fractional index", { offerIndex: 1.5 }], ["unsafe index", { offerIndex: Number.MAX_SAFE_INTEGER + 1 }],
    ["negative index", { offerIndex: -1 }], ["extra balance", { currentBalanceRaw: "99999999999999999999999" }],
  ])("rejects malformed eligibility: %s", (_, overrides) => {
    expect(() => parseLateMigrationEligibility({ ...allocation(), schema: LATE_MIGRATION_ELIGIBILITY_SCHEMA, status: "eligible", ...overrides }, walletAddress)).toThrow();
  });
  it("binds eligibility to the connected checksummed wallet", () => {
    const value = { ...allocation(), schema: LATE_MIGRATION_ELIGIBILITY_SCHEMA, status: "eligible" };
    expect(() => parseLateMigrationEligibility(value, otherWallet)).toThrow("different wallet");
    expect(() => parseLateMigrationEligibility({ ...value, walletAddress: walletAddress.toLowerCase() }, walletAddress)).toThrow("checksummed");
    expect(() => parseLateMigrationEligibility({ schema: LATE_MIGRATION_ELIGIBILITY_SCHEMA, status: "not_eligible", walletAddress, offerIndex: null }, walletAddress)).toThrow("fields");
  });
});

describe("intake response and permit binding", () => {
  it("accepts exactly the activated permit", () => {
    expect(parseLateMigrationIntakeResponseV1(prepared(), expected)).toEqual({
      status: "signature_required", walletAddress, offerIndex: 4, requiredGrossDepositRaw: expected.requiredGrossDepositRaw,
      targetPayout80Raw: expected.targetPayout80Raw, permitNonce: "7", permitDeadline: "1788500000", requestBindingHash, sourceContractAddress,
    });
  });
  it.each([["owner", otherWallet], ["spender", otherWallet], ["value", "999999999999999999999999"], ["nonce", "8"], ["deadline", "1788500001"]])("rejects altered permit %s", (field, value) => {
    const response = prepared(); Object.assign(response.typedData.message, { [field]: value });
    expect(() => parseLateMigrationIntakeResponseV1(response, expected)).toThrow("does not match this migration");
  });
  it.each([["chainId", 4663], ["name", "New V4"], ["version", "2"], ["verifyingContract", otherWallet]])("rejects altered domain %s", (field, value) => {
    const response = prepared(); Object.assign(response.typedData.domain, { [field]: value });
    expect(() => parseLateMigrationIntakeResponseV1(response, expected)).toThrow("does not match old V4");
  });
  it("rejects changed shapes, field order, ambiguous numbers and allocation", () => {
    const reordered = prepared(); reordered.typedData.types.Permit.reverse();
    const wrongType = prepared(); wrongType.typedData.primaryType = "PermitBatch";
    const extra = prepared(); Object.assign(extra.typedData.message, { recipient: otherWallet });
    for (const response of [reordered, wrongType, extra, { ...prepared(), permitNonce: "07" }, { ...prepared(), permitDeadline: "0" },
      { ...prepared(), requestBindingHash: `sha256:${"AB".repeat(32)}` }, { ...prepared(), offerIndex: 5 }, { ...prepared(), walletAddress: otherWallet },
      { ...prepared(), requiredGrossDepositRaw: "12345000000000000000002" }, { ...prepared(), targetPayout80Raw: "9876000000000000000001" },
    ]) expect(() => parseLateMigrationIntakeResponseV1(response, expected)).toThrow();
  });
  it.each(["deposit_submitted", "deposit_confirmed", "deposit_finalized"])("requires a transaction for %s", (status) => {
    const value = { ...allocation(), status, requestBindingHash, depositTransactionHash: transactionHash };
    expect(parseLateMigrationIntakeResponseV1(value, expected).status).toBe(status);
    expect(() => parseLateMigrationIntakeResponseV1({ ...value, depositTransactionHash: null }, expected)).toThrow("transaction state");
  });
  it("accepts support without a known hash but never old automated payout states", () => {
    for (const depositTransactionHash of [transactionHash, null]) expect(parseLateMigrationIntakeResponseV1({ ...allocation(), status: "support_required", requestBindingHash, depositTransactionHash }, expected)).toMatchObject({ status: "support_required", depositTransactionHash });
    for (const status of ["target_paid", "dispatch_submitted", "target_pending"]) expect(() => parseLateMigrationIntakeResponseV1({ ...allocation(), status, requestBindingHash, depositTransactionHash: transactionHash }, expected)).toThrow("status");
    expect(() => parseLateMigrationIntakeResponseV1({ ...allocation(), status: "deposit_finalized", requestBindingHash, depositTransactionHash: transactionHash, payoutTransactionHash: transactionHash }, expected)).toThrow("fields");
  });
});

describe("intake error context", () => {
  it("preserves recovery instructions for an existing onchain deposit", () => {
    const message = lateMigrationIntakeFailureMessageV1(409, { error: { code: "deposit_already_recorded" } });
    expect(message).toBe("An Ethereum deposit already exists for this wallet. Do not sign again. Contact support.");
    for (const context of ["before_signature", "after_signature", "status_unknown"] as const) {
      expect(lateMigrationIntakeUiErrorMessage(new Error(message), context)).toBe(message);
    }
  });
  it("never says nothing moved after signing or unknown status", () => {
    for (const error of [new Error("network timeout"), new Error("Deposits are temporarily unavailable. Nothing was moved."), new Error("User rejected request"), null]) {
      for (const context of ["after_signature", "status_unknown"] as const) {
        expect(lateMigrationIntakeUiErrorMessage(error, context)).toMatch(/may already be processing/u);
        expect(lateMigrationIntakeUiErrorMessage(error, context)).not.toContain("Nothing was moved");
      }
    }
  });
  it("explains rejection and unsupported signing before submit", () => {
    expect(lateMigrationIntakeUiErrorMessage(new Error("User rejected request"))).toBe("Signature cancelled. Nothing was moved.");
    expect(lateMigrationIntakeUiErrorMessage(new Error("Unsupported signing method"))).toContain("cannot sign the required Ethereum permit");
  });
  it("uses safe API messages and hides provider details", () => {
    expect(lateMigrationIntakeFailureMessageV1(401, {})).toContain("Reconnect");
    expect(lateMigrationIntakeFailureMessageV1(429, {})).toContain("Wait a minute");
    expect(lateMigrationIntakeFailureMessageV1(409, {})).toContain("Check its status");
    expect(lateMigrationIntakeFailureMessageV1(422, { error: { code: "insufficient_old_token_balance" } })).toContain("full eligible old V4");
    expect(lateMigrationIntakeFailureMessageV1(503, { error: { message: "secret provider URL" } })).not.toContain("secret");
    const expired = lateMigrationIntakeFailureMessageV1(409, { error: { code: "permit_expired_resign_required" } });
    expect(lateMigrationIntakeUiErrorMessage(new Error(expired), "status_unknown")).toBe(expired);
  });
  it("distinguishes submission from confirmation and finality", () => {
    expect(lateMigrationIntakeProgressCopyV1("deposit_submitted")).toBe("Deposit submitted. Waiting for confirmation.");
    expect(lateMigrationIntakeProgressCopyV1("deposit_confirmed")).toBe("Deposit confirmed. Waiting for Ethereum finality.");
  });
});
