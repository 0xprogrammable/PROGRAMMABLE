import { privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress,
  keccak256, parseAbiItem, TransactionReceiptNotFoundError,
  type Hex, type PublicClient } from "viem";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Policy, PrivyPoliciesService } from "@privy-io/node";

type PolicyCondition = Policy["rules"][number]["conditions"][number];
type PolicyCreateParams = Parameters<PrivyPoliciesService["create"]>[0];

vi.mock("server-only", () => ({}));
// Production deployment checks require the exact historical token bytecode
// commitment. Substitute only this short test bytecode; all event, calldata,
// and deposit identity hashing remains the real implementation.
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, keccak256: (value: Parameters<typeof actual.keccak256>[0]) =>
    value === "0x6001" ?
      "0x4fe466386aeebe507f6bcfc58e046a0632e4687699fa5bd28c4b7ec6333141ad" :
      actual.keccak256(value) };
});

const account = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const claim = Object.freeze({
  walletAddress: account.address,
  offerIndex: 42,
  requiredGrossDepositRaw: "100",
  targetPayout80Raw: "80",
  eligibilityProof: Object.freeze([`0x${"ab".repeat(32)}` as Hex]),
});

vi.mock("@/lib/server/late-migration-eligibility-v1", () => ({
  getLateMigrationEligibilityClaimV1: (address: string) =>
    address.toLowerCase() === account.address.toLowerCase() ? claim : null,
}));

import activationManifest from
  "../config/late-migration-intake-activation.v1.json";
import { buildMainTokenMigrationPermitTypedData } from
  "../lib/main-token-migration";
import {
  buildLateMigrationIntakeTransactionV1,
  createLateMigrationIntakeV1,
  expectedLateMigrationIntakePolicySha256V1,
  lateMigrationIntakePolicyV1,
  LATE_MIGRATION_INTAKE_ABI_V1,
  readLateMigrationIntakeConfigurationV1,
  type LateMigrationIntakeChainV1,
  type LateMigrationIntakeConfigurationV1,
  type LateMigrationIntakeSenderV1,
} from "../lib/server/late-migration-intake-v1";
import {
  createLateMigrationIntakeMemoryStoreV1,
  createLateMigrationIntakePostgresStoreV1,
  type LateMigrationIntakeIntentV1,
  type LateMigrationIntakeTransitionV1,
  type LateMigrationIntakeStoreV1,
} from "../lib/server/late-migration-intake-store-v1";
import {
  assertLateMigrationIntakeTransactionV1,
  assertLateMigrationIntakeRelayerWalletV1,
  assertLateMigrationIntakeRelayerPolicyV1,
  assertLateMigrationIntakeQuorumV1,
  lateMigrationAuthorizationPublicKeyV1,
  createLateMigrationIntakeChainFromClientsV1,
  createProductionLateMigrationIntakeSenderV1,
} from "../lib/server/late-migration-intake-production-v1";
import type { ProjectionTargetPostgresPoolV1,
  ProjectionTargetPostgresQueryResultV1 } from
  "../lib/server/projection-target/postgres-store";

const sourceContract = getAddress(
  "0x1111111111111111111111111111111111111111");
const relayer = getAddress("0x3333333333333333333333333333333333333333");
const depositHash = `0x${"01".repeat(32)}` as Hex;
const blockHash = `0x${"04".repeat(32)}` as Hex;
const depositId = `0x${"05".repeat(32)}` as Hex;
const now = new Date("2026-09-04T12:00:00.000Z");
const ownerKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const ownerPublicKey = ownerKeys.publicKey.export({ type: "spki", format: "der" })
  .toString("base64");

function configuration(): LateMigrationIntakeConfigurationV1 {
  const withoutHash = {
    releaseId: "late-migration-80pct-e18c667c-intake-v1" as const,
    sourceContractAddress: sourceContract,
    sourceContractRuntimeCodehash: `0x${"11".repeat(32)}` as Hex,
    sourceDeploymentBlockNumber: 100n,
    sourceDeploymentBlockHash: `0x${"12".repeat(32)}` as Hex,
    activatedAtBlock: 110n,
    relayerAddress: relayer,
    relayerFundingBlockNumber: 120n,
    relayerFundingBlockHash: `0x${"13".repeat(32)}` as Hex,
    relayerFundingBalanceWei: 20_000_000_000_000_000n,
    maximumDepositGasLimit: 500_000n,
    maximumFeePerGasWei: 20_000_000_000n,
    totalRelayerBudgetWei: 20_000_000_000_000_000n,
    permitValiditySeconds: 600,
    relayerWalletId: "wallet_12345678",
    relayerPolicyId: "policy_12345678",
    relayerTransactionSignerId: "signer_12345678",
    relayerWalletOwnerId: "wallet_owner_12345678",
    relayerPolicyOwnerId: "policy_owner_12345678",
    relayerOwnerPublicKey: ownerPublicKey,
  };
  return Object.freeze({ ...withoutHash,
    relayerPolicySha256: expectedLateMigrationIntakePolicySha256V1(
      withoutHash),
  });
}

function authenticated(wallets = [account.address]) {
  return { authenticate: vi.fn(async () => ({
    privyUserId: "did:privy:test-user",
    privySessionId: "session-test",
    wallets,
  })) };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://programmable.market/api/late-migration/intake", {
    method: "POST", body: JSON.stringify(body), headers: {
      "content-type": "application/json",
      origin: "https://programmable.market",
      "sec-fetch-site": "same-origin", ...headers,
    },
  });
}

function get() {
  return new Request(
    `https://programmable.market/api/late-migration/intake?walletAddress=${account.address}`,
  );
}

function confirmed(): Extract<LateMigrationIntakeTransitionV1,
  { stage: "deposit_confirmed" }> {
  return { schema: "programmable-late-migration-intake-transition/v1",
    stage: "deposit_confirmed", transactionHash: depositHash,
    blockNumber: "500", blockHash, depositId, logIndex: 3 };
}

function finalized(): Extract<LateMigrationIntakeTransitionV1,
  { stage: "deposit_finalized" }> {
  return { schema: "programmable-late-migration-intake-transition/v1",
    stage: "deposit_finalized", transactionHash: depositHash,
    blockNumber: "500", blockHash, depositId, logIndex: 3,
    finalizedBlockNumberA: "510", finalizedBlockNumberB: "511" };
}

function chain(): LateMigrationIntakeChainV1 {
  return {
    assertNoExistingDeposit: vi.fn(async () => undefined),
    assertSubmissionReady: vi.fn(async () => 7n),
    quotePriorityFeePerGas: vi.fn(async () => 2_000_000_000n),
    assertTransactionReady: vi.fn(async () => undefined),
    observeCanonicalDeposit: vi.fn(async () => ({
      confirmed: null, finalized: null,
    })),
  };
}

function sender() {
  const sends: LateMigrationIntakeTransactionV1[] = [];
  const boundary: LateMigrationIntakeSenderV1 & { sends: typeof sends } = {
    assertReady: vi.fn(async () => undefined),
    lookup: vi.fn(async () => null),
    send: vi.fn(async (transaction) => {
      sends.push(transaction);
      return depositHash;
    }),
    sends,
  };
  return boundary;
}

type LateMigrationIntakeTransactionV1 = Parameters<
  LateMigrationIntakeSenderV1["send"]>[0];

async function prepareAndSubmit(
  chainBoundary = chain(),
  senderBoundary = sender(),
  store: LateMigrationIntakeStoreV1 = createLateMigrationIntakeMemoryStoreV1(),
) {
  const intake = createLateMigrationIntakeV1({ configuration: configuration(),
    authenticator: authenticated(), store, chain: chainBoundary,
    sender: senderBoundary, now: () => now });
  const prepared = await intake.post(post({ action: "prepare",
    walletAddress: account.address }));
  const preparedBody = await prepared.json() as {
    permitNonce: string;
    permitDeadline: string;
    requestBindingHash: `sha256:${string}`;
    typedData: { message: { value: string; spender: string } };
  };
  const permitSignature = await account.signTypedData(
    buildMainTokenMigrationPermitTypedData({ owner: account.address,
      spender: sourceContract, value: 100n,
      nonce: BigInt(preparedBody.permitNonce),
      deadline: BigInt(preparedBody.permitDeadline) }));
  const body = { action: "submit", walletAddress: account.address,
    permitNonce: preparedBody.permitNonce,
    permitDeadline: preparedBody.permitDeadline, permitSignature,
    requestBindingHash: preparedBody.requestBindingHash } as const;
  const submitted = await intake.post(post(body,
    { "idempotency-key": "late-migration-test-0001" }));
  return { body, chainBoundary, intake, prepared, preparedBody,
    senderBoundary, store, submitted };
}

describe("late migration intake v1", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ships disabled and contains no target relay or retryable fields", () => {
    expect(activationManifest).toMatchObject({
      schema: "programmable-late-migration-intake-activation/v1",
      enabled: false,
      sourceContractAddress: null,
      activatedAtBlock: null,
    });
    expect(Object.keys(activationManifest)).not.toEqual(expect.arrayContaining([
      "targetReserveAddress", "arbitrumDelayedInbox",
      "maximumDispatchGasLimit", "maximumRetryableTicketValueWei",
    ]));
  });

  it("does not load production configuration from only one activation switch", () => {
    expect(readLateMigrationIntakeConfigurationV1({ environment: {},
      manifest: activationManifest })).toBeNull();
    expect(() => readLateMigrationIntakeConfigurationV1({ environment: {
      PROGRAMMABLE_LATE_MIGRATION_INTAKE_ENABLED: "true",
    }, manifest: activationManifest })).toThrow("Late migration intake");
  });

  it("binds activation to isolated owners and exactly capped sponsor funding", () => {
    const config = configuration();
    const manifest = { ...activationManifest, enabled: true,
      sourceContractAddress: sourceContract,
      sourceContractRuntimeCodehash: config.sourceContractRuntimeCodehash,
      sourceDeploymentBlockNumber: "100", sourceDeploymentBlockHash:
        config.sourceDeploymentBlockHash, activatedAtBlock: "110",
      relayerAddress: relayer, relayerFundingBlockNumber: "120",
      relayerFundingBlockHash: config.relayerFundingBlockHash,
      relayerFundingBalanceWei: config.relayerFundingBalanceWei.toString(),
      relayerPolicySha256: config.relayerPolicySha256,
      maximumDepositGasLimit: config.maximumDepositGasLimit.toString(),
      maximumFeePerGasWei: config.maximumFeePerGasWei.toString(),
      totalRelayerBudgetWei: config.totalRelayerBudgetWei.toString(),
      permitValiditySeconds: 600, relayerWalletOwnerId: config.relayerWalletOwnerId,
      relayerPolicyOwnerId: config.relayerPolicyOwnerId };
    const environment = { PROGRAMMABLE_LATE_MIGRATION_INTAKE_ENABLED: "true",
      PROGRAMMABLE_LATE_MIGRATION_PRIVY_WALLET_ID: config.relayerWalletId,
      PROGRAMMABLE_LATE_MIGRATION_PRIVY_POLICY_ID: config.relayerPolicyId,
      PROGRAMMABLE_LATE_MIGRATION_PRIVY_TRANSACTION_SIGNER_ID:
        config.relayerTransactionSignerId,
      PROGRAMMABLE_LATE_MIGRATION_PRIVY_OWNER_PUBLIC_KEY: ownerPublicKey };
    expect(readLateMigrationIntakeConfigurationV1({ environment, manifest }))
      .toEqual(config);
    for (const changed of [{ ...manifest, relayerWalletOwnerId:
      config.relayerTransactionSignerId }, { ...manifest,
      relayerFundingBalanceWei: (config.totalRelayerBudgetWei + 1n).toString() },
      { ...manifest, relayerAddress: "0x245099E77F8F0Cad9a75B1B56db8FDE7C948d5B1" }]) {
      expect(() => readLateMigrationIntakeConfigurationV1({ environment,
        manifest: changed })).toThrow();
    }
  });

  it("defines one value-zero Ethereum deposit policy and no payout action", () => {
    const policy = lateMigrationIntakePolicyV1(configuration());
    expect(policy.rules).toHaveLength(1);
    expect(JSON.stringify(policy)).toContain("depositWithPermit");
    expect(JSON.stringify(policy)).toContain('"value":"0x0"');
    expect(JSON.stringify(policy)).not.toMatch(/dispatch|retryable|robinhood/iu);
  });

  it("produces Privy's actual SDK policy shape and normalizes only readback rule IDs", () => {
    const config = configuration();
    const policy = lateMigrationIntakePolicyV1(config);
    expectTypeOf(policy.rules[0]!.conditions).toExtend<readonly PolicyCondition[]>();
    const createRequest = { chain_type: policy.chainType, name: policy.name,
      version: policy.version, owner_id: config.relayerPolicyOwnerId,
      rules: policy.rules.map((rule) => ({ ...rule,
        conditions: [...rule.conditions] })) } satisfies PolicyCreateParams;
    const conditions = createRequest.rules[0]!.conditions;
    expect(conditions.slice(0, 3)).toEqual([
      { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "1" },
      { field_source: "ethereum_transaction", field: "to", operator: "eq", value: sourceContract },
      { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0x0" },
    ]);
    expect(conditions[3]).toEqual({ field_source: "ethereum_calldata",
      field: "function_name", operator: "eq", value: "depositWithPermit",
      abi: [LATE_MIGRATION_INTAKE_ABI_V1[0]] });
    expect(conditions.every((condition) => !("type" in condition))).toBe(true);
    const readback = { ...createRequest, id: config.relayerPolicyId,
      created_at: now.getTime(), owner_id: config.relayerPolicyOwnerId,
      rules: createRequest.rules.map((rule) => ({ ...rule, id: "rule_12345678" })),
    } satisfies Policy;
    expect(() => assertLateMigrationIntakeRelayerPolicyV1(readback, config)).not.toThrow();
    expect(() => assertLateMigrationIntakeRelayerPolicyV1({ ...readback,
      rules: readback.rules.map((rule) => ({ ...rule, id: "rule_different_id" })) }, config))
      .not.toThrow();
    const oldSchema = { ...readback, rules: readback.rules.map((rule) => ({ ...rule,
      conditions: rule.conditions.map((condition) => {
        const { field_source: source, ...rest } = condition;
        return { ...rest, type: source };
      }) })) };
    expect(() => assertLateMigrationIntakeRelayerPolicyV1(oldSchema, config)).toThrow();
    for (const [field, value] of [["chain_id", "4663"], ["to", relayer],
      ["value", "0x1"], ["function_name", "transferFrom"]] as const) {
      const changed = { ...readback, rules: readback.rules.map((rule) => ({ ...rule,
        conditions: rule.conditions.map((condition) => condition.field === field
          ? { ...condition, value } : condition) })) };
      expect(() => assertLateMigrationIntakeRelayerPolicyV1(changed, config)).toThrow();
    }
    const rule = readback.rules[0]!;
    for (const rules of [[{ ...rule, unknown_execution_option: true }],
      [{ ...rule, conditions: rule.conditions.slice(1) }],
      [{ ...rule, conditions: rule.conditions.map((condition) =>
        condition.field_source === "ethereum_calldata"
          ? { ...condition, abi: [] } : condition) }],
      [{ ...rule, action: "DENY" }], [{ ...rule, method: "eth_signTypedData_v4" }],
      [rule, { ...rule, id: "rule_another_id" }]]) {
      expect(() => assertLateMigrationIntakeRelayerPolicyV1({ ...readback, rules }, config))
        .toThrow();
    }
  });

  it("prepares the exact native ERC-2612 permit", async () => {
    const intake = createLateMigrationIntakeV1({ configuration: configuration(),
      authenticator: authenticated(),
      store: createLateMigrationIntakeMemoryStoreV1(), chain: chain(),
      sender: sender(), now: () => now });
    const response = await intake.post(post({ action: "prepare",
      walletAddress: account.address }));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      schema: "programmable-late-migration-intake/v1",
      status: "signature_required", walletAddress: account.address,
      offerIndex: 42, requiredGrossDepositRaw: "100",
      targetPayout80Raw: "80", permitNonce: "7",
    });
    expect(body).not.toHaveProperty("eligibilityProof");
    expect((body.typedData as { message: object }).message).toMatchObject({
      owner: account.address, spender: sourceContract, value: "100", nonce: "7",
    });
  });

  it("sponsors exactly one value-zero deposit transaction", async () => {
    const result = await prepareAndSubmit();
    expect(result.submitted.status).toBe(200);
    expect(await result.submitted.json()).toMatchObject({
      schema: "programmable-late-migration-intake/v1",
      status: "deposit_submitted", walletAddress: account.address,
      requiredGrossDepositRaw: "100", targetPayout80Raw: "80",
      depositTransactionHash: depositHash,
    });
    expect(result.senderBoundary.sends).toHaveLength(1);
    const transaction = result.senderBoundary.sends[0]!;
    expect(transaction).toMatchObject({ kind: "deposit", chainId: 1,
      from: relayer, to: sourceContract, value: 0n });
    const decoded = decodeFunctionData({ abi: LATE_MIGRATION_INTAKE_ABI_V1,
      data: transaction.data });
    expect(decoded.functionName).toBe("depositWithPermit");
    expect(JSON.stringify(decoded.args, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value)).not.toMatch(
        /dispatch|reserve|retryable/iu);
  });

  it("returns one idempotent record and never sponsors a second transaction", async () => {
    const result = await prepareAndSubmit();
    const repeated = await result.intake.post(post(result.body,
      { "idempotency-key": "late-migration-test-0001" }));
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).status).toBe("deposit_submitted");
    expect(result.senderBoundary.sends).toHaveLength(1);
  });

  it("rejects a changed idempotency key after reservation", async () => {
    const result = await prepareAndSubmit();
    const repeated = await result.intake.post(post(result.body,
      { "idempotency-key": "late-migration-test-9999" }));
    expect(repeated.status).toBe(409);
    expect(result.senderBoundary.sends).toHaveLength(1);
  });

  it("rejects a session that is not linked to the eligible wallet", async () => {
    const intake = createLateMigrationIntakeV1({ configuration: configuration(),
      authenticator: authenticated([
        "0x4444444444444444444444444444444444444444",
      ]), store: createLateMigrationIntakeMemoryStoreV1(), chain: chain(),
      sender: sender(), now: () => now });
    const response = await intake.post(post({ action: "prepare",
      walletAddress: account.address }));
    expect(response.status).toBe(403);
  });

  it("rejects a forged permit before reserving or sending sponsor gas", async () => {
    const senderBoundary = sender();
    const intake = createLateMigrationIntakeV1({ configuration: configuration(),
      authenticator: authenticated(),
      store: createLateMigrationIntakeMemoryStoreV1(), chain: chain(),
      sender: senderBoundary, now: () => now });
    const prepared = await intake.post(post({ action: "prepare",
      walletAddress: account.address }));
    const body = await prepared.json() as { permitNonce: string;
      permitDeadline: string; requestBindingHash: string };
    const response = await intake.post(post({ action: "submit",
      walletAddress: account.address, permitNonce: body.permitNonce,
      permitDeadline: body.permitDeadline,
      permitSignature: `0x${"11".repeat(65)}`,
      requestBindingHash: body.requestBindingHash },
    { "idempotency-key": "late-migration-forged-0001" }));
    expect(response.status).toBe(422);
    expect(senderBoundary.sends).toHaveLength(0);
  });

  it("polls canonical Ethereum state through confirmation and finality", async () => {
    const chainBoundary = chain();
    const result = await prepareAndSubmit(chainBoundary);
    vi.mocked(chainBoundary.observeCanonicalDeposit).mockResolvedValue({
      confirmed: confirmed(), finalized: finalized(),
    });
    const response = await result.intake.get(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "deposit_finalized", depositTransactionHash: depositHash,
      requiredGrossDepositRaw: "100", targetPayout80Raw: "80",
    });
    const record = await result.store.get({ releaseId: configuration().releaseId,
      sourceAddress: account.address });
    expect(record?.transitions.map((item) => item.stage)).toEqual([
      "deposit_submitted", "deposit_confirmed", "deposit_finalized",
    ]);
    expect(result.senderBoundary.sends).toHaveLength(1);
  });

  it("marks an unresolved terminal provider result for support without resending", async () => {
    const senderBoundary = sender();
    vi.mocked(senderBoundary.lookup).mockResolvedValue({
      status: "failed", transactionHash: null,
    });
    const result = await prepareAndSubmit(chain(), senderBoundary);
    expect((await result.submitted.json()).status).toBe("support_required");
    expect(senderBoundary.sends).toHaveLength(0);
  });

  it("fails closed if any transaction is not the single value-zero deposit", () => {
    const config = configuration();
    expect(() => assertLateMigrationIntakeTransactionV1(config, {
      kind: "deposit", chainId: 1, from: relayer, to: sourceContract,
      data: "0x12345678", value: 0n,
      gasLimit: config.maximumDepositGasLimit,
      maxFeePerGasWei: config.maximumFeePerGasWei,
      maxPriorityFeePerGasWei: 2_000_000_000n,
      providerIdempotencyKey: "late-migration-test-0001",
      providerReferenceId: "late-migration-ref-0001",
    })).toThrow("Late migration intake");
    expect(() => assertLateMigrationIntakeTransactionV1(config, {
      ...({} as LateMigrationIntakeTransactionV1),
      kind: "deposit", chainId: 1, from: relayer, to: sourceContract,
      data: "0x12345678", value: 1n as 0n,
      gasLimit: config.maximumDepositGasLimit,
      maxFeePerGasWei: config.maximumFeePerGasWei,
      maxPriorityFeePerGasWei: 2_000_000_000n,
      providerIdempotencyKey: "late-migration-test-0001",
      providerReferenceId: "late-migration-ref-0001",
    })).toThrow("Late migration intake");
  });

  it("caps durable sponsor reservations before any provider send", async () => {
    const store = createLateMigrationIntakeMemoryStoreV1();
    const base: LateMigrationIntakeIntentV1 = {
      schema: "programmable-late-migration-intake-intent/v1",
      releaseId: configuration().releaseId, sourceAddress: account.address,
      offerIndex: 42, grossAmountRaw: "100", manualPayoutAmountRaw: "80",
      sourceContractAddress: sourceContract, relayerAddress: relayer,
      permitNonce: "7", permitDeadline: "2000000000",
      permitSignature: `0x${"11".repeat(65)}`,
      depositGasLimit: "500000", maxFeePerGasWei: "20000000000",
      maxPriorityFeePerGasWei: "2000000000",
      reservationWei: "10000000000000000",
      totalBudgetWei: "10000000000000000",
      principalBindingHash: `sha256:${"11".repeat(32)}`,
      idempotencyBindingHash: `sha256:${"12".repeat(32)}`,
      requestBindingHash: `sha256:${"13".repeat(32)}`,
      transactionBindingHash: `sha256:${"14".repeat(32)}`,
      providerIdempotencyKey: "provider-key-00000001",
      providerReferenceId: "provider-ref-00000001",
      reservedAt: now.toISOString(),
    };
    await store.reserve({ lookup: { releaseId: base.releaseId,
      sourceAddress: base.sourceAddress }, intent: base });
    const other = getAddress("0x5555555555555555555555555555555555555555");
    await expect(store.reserve({ lookup: { releaseId: base.releaseId,
      sourceAddress: other }, intent: { ...base, sourceAddress: other,
        offerIndex: 43,
        principalBindingHash: `sha256:${"21".repeat(32)}`,
        idempotencyBindingHash: `sha256:${"22".repeat(32)}`,
        requestBindingHash: `sha256:${"23".repeat(32)}`,
        transactionBindingHash: `sha256:${"24".repeat(32)}`,
        providerIdempotencyKey: "provider-key-00000002",
        providerReferenceId: "provider-ref-00000002" } })).rejects.toMatchObject({
          code: "budget_exhausted",
        });
  });

  it("rate limits requests without permanently closing a holder's intake", async () => {
    const store = createLateMigrationIntakeMemoryStoreV1();
    const input = { releaseId: configuration().releaseId, sourceAddress: account.address,
      principalBindingHash: `sha256:${"ab".repeat(32)}` as `sha256:${string}`,
      operation: "submit" as const, nowMs: now.getTime() };
    for (let index = 0; index < 32; index++) {
      await store.admit({ ...input, nowMs: input.nowMs + index * 60_000 });
    }
    await expect(store.admit({ ...input, nowMs: input.nowMs + 33 * 60_000 }))
      .rejects.toMatchObject({ code: "rate_limited" });
    await expect(store.admit({ ...input, nowMs: input.nowMs + 86_400_000 }))
      .resolves.toBeUndefined();
  });

  it("builds only the contract-bound deposit call from a durable record", async () => {
    const result = await prepareAndSubmit();
    const record = await result.store.get({ releaseId: configuration().releaseId,
      sourceAddress: account.address });
    if (!record) throw new Error("missing intake record");
    const transaction = buildLateMigrationIntakeTransactionV1(configuration(),
      record, claim);
    expect(transaction.kind).toBe("deposit");
    expect(transaction.value).toBe(0n);
    expect(decodeFunctionData({ abi: LATE_MIGRATION_INTAKE_ABI_V1,
      data: transaction.data }).functionName).toBe("depositWithPermit");
  });

  it("checks provider authorization readiness before requesting a holder signature", async () => {
    const sponsor = sender();
    vi.mocked(sponsor.assertReady).mockRejectedValue(new Error("wrong quorum"));
    const intake = createLateMigrationIntakeV1({ configuration: configuration(),
      authenticator: authenticated(), store: createLateMigrationIntakeMemoryStoreV1(),
      chain: chain(), sender: sponsor, now: () => now });
    const response = await intake.post(post({ action: "prepare",
      walletAddress: account.address }));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("typedData");
    expect(sponsor.send).not.toHaveBeenCalled();
  });

  it("never sends after a failed preflight simulation", async () => {
    const ethereum = chain();
    vi.mocked(ethereum.assertTransactionReady).mockRejectedValue(new Error("revert"));
    const result = await prepareAndSubmit(ethereum);
    expect(result.submitted.status).toBe(503);
    expect(result.senderBoundary.send).not.toHaveBeenCalled();
  });

  it("checks live fee readiness before asking the holder for a permit", async () => {
    const ethereum = chain();
    const sponsor = sender();
    vi.mocked(ethereum.quotePriorityFeePerGas).mockRejectedValue(new Error("fee RPC unavailable"));
    const intake = createLateMigrationIntakeV1({ configuration: configuration(),
      authenticator: authenticated(), store: createLateMigrationIntakeMemoryStoreV1(),
      chain: ethereum, sender: sponsor, now: () => now });
    const response = await intake.post(post({ action: "prepare", walletAddress: account.address }));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("typedData");
    expect(sponsor.send).not.toHaveBeenCalled();
  });

  it("binds the fresh submit priority immutably while reserving the full configured cap", async () => {
    const ethereum = chain();
    vi.mocked(ethereum.quotePriorityFeePerGas)
      .mockResolvedValueOnce(1_000_000n) // Prepare verifies affordability.
      .mockResolvedValueOnce(2_000_000n) // Submit binds a fresh quote.
      .mockResolvedValue(100_000_000n);
    const result = await prepareAndSubmit(ethereum);
    expect(result.submitted.status).toBe(200);
    const sent = result.senderBoundary.sends[0]!;
    expect(sent.maxPriorityFeePerGasWei).toBe(2_000_000n);
    expect(sent.maxFeePerGasWei).toBe(configuration().maximumFeePerGasWei);
    const record = await result.store.get({ releaseId: configuration().releaseId,
      sourceAddress: account.address });
    if (!record) throw new Error("missing intent");
    expect(record.intent.maxPriorityFeePerGasWei).toBe("2000000");
    expect(record.intent.reservationWei).toBe((configuration().maximumDepositGasLimit *
      configuration().maximumFeePerGasWei).toString());
    expect(buildLateMigrationIntakeTransactionV1(configuration(), record, claim))
      .toEqual(sent);
    const repeated = await result.intake.post(post(result.body,
      { "idempotency-key": "late-migration-test-0001" }));
    expect(repeated.status).toBe(200);
    expect(ethereum.quotePriorityFeePerGas).toHaveBeenCalledTimes(2);
    expect(result.senderBoundary.send).toHaveBeenCalledTimes(1);
  });

  it("does not reserve or send if the fresh submission fee quote fails", async () => {
    const ethereum = chain();
    vi.mocked(ethereum.quotePriorityFeePerGas).mockResolvedValueOnce(1_000_000n)
      .mockRejectedValueOnce(new Error("quote unavailable after signing"));
    const result = await prepareAndSubmit(ethereum);
    expect(result.submitted.status).toBe(503);
    expect(await result.store.get({ releaseId: configuration().releaseId,
      sourceAddress: account.address })).toBeNull();
    expect(result.senderBoundary.send).not.toHaveBeenCalled();
  });

  it("does not replay an ambiguous send and later recovers from canonical finality", async () => {
    const sponsor = sender();
    vi.mocked(sponsor.send).mockRejectedValue(new Error("provider timeout after accept"));
    const result = await prepareAndSubmit(chain(), sponsor);
    expect((await result.submitted.json()).status).toBe("support_required");
    expect(sponsor.send).toHaveBeenCalledTimes(1);
    const repeated = await result.intake.post(post(result.body,
      { "idempotency-key": "late-migration-test-0001" }));
    expect((await repeated.json()).status).toBe("support_required");
    expect(sponsor.send).toHaveBeenCalledTimes(1);
    vi.mocked(result.chainBoundary.observeCanonicalDeposit).mockResolvedValue({
      confirmed: confirmed(), finalized: finalized() });
    expect((await (await result.intake.get(get())).json()).status)
      .toBe("deposit_finalized");
    expect(sponsor.send).toHaveBeenCalledTimes(1);
  });

  it("does not send when the provider accepted a pending request without a hash", async () => {
    const sponsor = sender();
    vi.mocked(sponsor.lookup).mockResolvedValue({ status: "pending",
      transactionHash: null });
    const result = await prepareAndSubmit(chain(), sponsor);
    expect((await result.submitted.json()).status).toBe("support_required");
    expect(sponsor.send).not.toHaveBeenCalled();
  });

  it("stops showing an orphaned confirmation and recovers its new final block", async () => {
    const result = await prepareAndSubmit();
    const observation = vi.mocked(result.chainBoundary.observeCanonicalDeposit);
    observation.mockResolvedValue({ confirmed: confirmed(), finalized: null });
    expect((await (await result.intake.get(get())).json()).status)
      .toBe("deposit_confirmed");
    observation.mockResolvedValue({ confirmed: null, finalized: null });
    expect((await (await result.intake.get(get())).json()).status)
      .toBe("support_required");
    const canonical = { ...confirmed(), blockNumber: "501",
      blockHash: `0x${"ab".repeat(32)}` as Hex,
      transactionHash: `0x${"cd".repeat(32)}` as Hex };
    observation.mockResolvedValue({ confirmed: canonical,
      finalized: { ...finalized(), ...canonical, stage: "deposit_finalized" } });
    const response = await result.intake.get(get());
    expect(await response.json()).toMatchObject({ status: "deposit_finalized",
      depositTransactionHash: canonical.transactionHash });
    const record = await result.store.get({ releaseId: configuration().releaseId,
      sourceAddress: account.address });
    expect(record?.transitions[1]).toEqual(confirmed());
    expect(record?.transitions[2]).toMatchObject({ blockNumber: "501", logIndex: 3 });
  });

  it("does not treat stored finality as current chain proof", async () => {
    const result = await prepareAndSubmit();
    const observation = vi.mocked(result.chainBoundary.observeCanonicalDeposit);
    observation.mockResolvedValue({ confirmed: confirmed(), finalized: finalized() });
    expect((await (await result.intake.get(get())).json()).status)
      .toBe("deposit_finalized");
    observation.mockResolvedValue({ confirmed: null, finalized: null });
    const response = await result.intake.get(get());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: {
      code: "finalized_deposit_unverified" } });
  });

  it("rejects changed request commitments and another linked principal on replay", async () => {
    const result = await prepareAndSubmit();
    const changed = await result.intake.post(post({ ...result.body,
      requestBindingHash: `sha256:${"ff".repeat(32)}` },
    { "idempotency-key": "late-migration-test-0001" }));
    expect(changed.status).toBe(409);
    const intake = createLateMigrationIntakeV1({ configuration: configuration(),
      authenticator: { authenticate: async () => ({ privyUserId: "another-principal",
        privySessionId: "different", wallets: [account.address] }) },
      store: result.store, chain: result.chainBoundary, sender: result.senderBoundary,
      now: () => now });
    expect((await intake.post(post(result.body,
      { "idempotency-key": "late-migration-test-0001" }))).status).toBe(409);
    expect(result.senderBoundary.send).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin intake and unexpected payout instructions", async () => {
    const sponsor = sender();
    const intake = createLateMigrationIntakeV1({ configuration: configuration(),
      authenticator: authenticated(), store: createLateMigrationIntakeMemoryStoreV1(),
      chain: chain(), sender: sponsor, now: () => now });
    expect((await intake.post(post({ action: "prepare", walletAddress: account.address },
      { origin: "https://attacker.example" }))).status).toBe(403);
    expect((await intake.post(post({ action: "prepare", walletAddress: account.address,
      payoutAddress: relayer }))).status).toBe(400);
    expect(sponsor.send).not.toHaveBeenCalled();
  });

  it("has one durable send winner even after a process restart", async () => {
    const database = new PGlite();
    try {
      await database.exec(`CREATE SCHEMA programmable_website_projection_v1;
        CREATE TABLE programmable_website_projection_v1.credential_uses (
          credential_id text PRIMARY KEY, request_binding_hash text NOT NULL,
          canonical_use text NOT NULL);`);
      const pool = new IntakeTestPool(database);
      const sponsor = sender();
      vi.mocked(sponsor.send).mockRejectedValue(new Error("connection lost"));
      const result = await prepareAndSubmit(chain(), sponsor,
        createLateMigrationIntakePostgresStoreV1(pool));
      expect((await result.submitted.json()).status).toBe("support_required");
      const restarted = createLateMigrationIntakePostgresStoreV1(pool);
      const record = await restarted.get({ releaseId: configuration().releaseId,
        sourceAddress: account.address });
      expect(record?.sendClaim).not.toBeNull();
      expect(record?.support?.reason).toBe("submission_outcome_unknown");
      if (!record?.sendClaim) throw new Error("missing durable send claim");
      expect((await restarted.claimSend({ lookup: { releaseId: configuration().releaseId,
        sourceAddress: account.address }, expectedRequestBindingHash:
          record.intent.requestBindingHash, claim: { ...record.sendClaim,
            claimedAt: "2026-09-04T12:01:00.000Z" } })).kind).toBe("existing");
      const ethereum = chain();
      vi.mocked(ethereum.observeCanonicalDeposit).mockResolvedValue({
        confirmed: confirmed(), finalized: finalized() });
      const intake = createLateMigrationIntakeV1({ configuration: configuration(),
        authenticator: authenticated(), store: restarted, chain: ethereum,
        sender: sponsor, now: () => now });
      expect((await (await intake.get(get())).json()).status).toBe("deposit_finalized");
      const again = createLateMigrationIntakePostgresStoreV1(pool);
      const recovered = await again.get({ releaseId: configuration().releaseId,
        sourceAddress: account.address });
      expect(recovered?.stage).toBe("deposit_finalized");
      expect(recovered?.transitions.at(-1)).toMatchObject({ logIndex: 3 });
      expect(sponsor.send).toHaveBeenCalledTimes(1);
    } finally { await database.close(); }
  });

  it("checks wallet and policy owner IDs against an isolated transaction signer", () => {
    const config = configuration();
    const policy = lateMigrationIntakePolicyV1(config);
    const wallet = { id: config.relayerWalletId, chain_type: "ethereum",
      address: relayer, owner_id: config.relayerWalletOwnerId,
      imported_at: null, exported_at: null, policy_ids: [config.relayerPolicyId],
      additional_signers: [{ signer_id: config.relayerTransactionSignerId,
        override_policy_ids: [config.relayerPolicyId] }] };
    const providerPolicy = { id: config.relayerPolicyId,
      owner_id: config.relayerPolicyOwnerId, chain_type: policy.chainType,
      name: policy.name, version: policy.version,
      rules: policy.rules.map((rule) => ({ ...rule, id: "rule_12345678" })) };
    expect(() => assertLateMigrationIntakeRelayerWalletV1(wallet, config)).not.toThrow();
    expect(() => assertLateMigrationIntakeRelayerPolicyV1(providerPolicy, config))
      .not.toThrow();
    for (const owner of [null, config.relayerTransactionSignerId, "unapproved_owner"]) {
      expect(() => assertLateMigrationIntakeRelayerWalletV1({ ...wallet,
        owner_id: owner }, config)).toThrow();
      expect(() => assertLateMigrationIntakeRelayerPolicyV1({ ...providerPolicy,
        owner_id: owner }, config)).toThrow();
    }
  });

  it("verifies actual P-256 quorum membership, thresholds, and key separation", () => {
    const key = ownerKeys.privateKey.export({ type: "pkcs8", format: "der" })
      .toString("base64");
    expect(lateMigrationAuthorizationPublicKeyV1(key)).toBe(ownerPublicKey);
    expect(() => createProductionLateMigrationIntakeSenderV1(configuration(), {
      NEXT_PUBLIC_PRIVY_APP_ID: "local-fixture-app", PRIVY_APP_SECRET: "local-fixture-secret",
      PROGRAMMABLE_LATE_MIGRATION_PRIVY_TRANSACTION_AUTHORIZATION_PRIVATE_KEY: key,
    })).toThrow(expect.objectContaining({ code: "relayer_owner_not_isolated" }));
    expect(() => lateMigrationAuthorizationPublicKeyV1("a".repeat(100))).toThrow();
    const secp = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    expect(() => lateMigrationAuthorizationPublicKeyV1(secp.privateKey.export({
      type: "pkcs8", format: "der" }).toString("base64"))).toThrow();
    const quorum = { id: "owner_quorum", authorization_threshold: 1,
      authorization_keys: [{ public_key: ownerPublicKey, display_name: null }],
      user_ids: [], key_quorum_ids: [] };
    expect(() => assertLateMigrationIntakeQuorumV1(quorum, "owner_quorum",
      ownerPublicKey)).not.toThrow();
    for (const altered of [ { ...quorum, authorization_threshold: 2 },
      { ...quorum, authorization_keys: [] }, { ...quorum, user_ids: ["user"] },
      { ...quorum, key_quorum_ids: ["hot_signer"] },
      { ...quorum, authorization_keys: [...quorum.authorization_keys,
        ...quorum.authorization_keys] } ]) {
      expect(() => assertLateMigrationIntakeQuorumV1(altered, "owner_quorum",
        ownerPublicKey)).toThrow();
    }
    const hot = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    expect(() => assertLateMigrationIntakeQuorumV1(quorum, "owner_quorum",
      hot.publicKey.export({ type: "spki", format: "der" }).toString("base64")))
      .toThrow();
  });

  it("grants exactly one send claim to concurrent workers", async () => {
    const result = await prepareAndSubmit();
    const lookup = { releaseId: configuration().releaseId, sourceAddress: account.address };
    const old = await result.store.get(lookup);
    if (!old?.sendClaim) throw new Error("missing send claim");
    const store = createLateMigrationIntakeMemoryStoreV1();
    await store.reserve({ lookup, intent: old.intent });
    const outcomes = await Promise.all([0, 1].map((offset) => store.claimSend({
      lookup, expectedRequestBindingHash: old.intent.requestBindingHash,
      claim: { ...old.sendClaim!, claimedAt:
        new Date(now.getTime() + offset).toISOString() } })));
    expect(outcomes.map((item) => item.kind).sort()).toEqual(["created", "existing"]);
    await expect(store.claimSend({ lookup,
      expectedRequestBindingHash: old.intent.requestBindingHash,
      claim: { ...old.sendClaim, transactionBindingHash: `sha256:${"ff".repeat(32)}` },
    })).rejects.toMatchObject({ code: "conflict" });
  });

  it("verifies canonical finality from both provider states, receipt, calldata and log identity", async () => {
    const result = await prepareAndSubmit();
    const record = await result.store.get({ releaseId: configuration().releaseId,
      sourceAddress: account.address });
    if (!record) throw new Error("missing record");
    const fixture = productionChainFixture(result.senderBoundary.sends[0]!);
    const production = createLateMigrationIntakeChainFromClientsV1([
      fixture.client(), fixture.client() ]);
    const observation = await production.observeCanonicalDeposit({
      configuration: fixture.config, record });
    expect(observation.finalized).toMatchObject({ stage: "deposit_finalized",
      blockNumber: "500", logIndex: 3, transactionHash: depositHash,
      depositId: fixture.expectedId, finalizedBlockNumberA: "600" });
  });

  it("fails closed on a mismatched canonical provider block", async () => {
    const result = await prepareAndSubmit();
    const record = await result.store.get({ releaseId: configuration().releaseId,
      sourceAddress: account.address });
    if (!record) throw new Error("missing record");
    const fixture = productionChainFixture(result.senderBoundary.sends[0]!);
    const right = fixture.client();
    vi.mocked(right.getBlock).mockResolvedValue({ number: 600n,
      hash: `0x${"ac".repeat(32)}` } as never);
    const production = createLateMigrationIntakeChainFromClientsV1([
      fixture.client(), right ]);
    await expect(production.observeCanonicalDeposit({ configuration: fixture.config,
      record })).rejects.toMatchObject({ code: "ethereum_provider_mismatch" });
  });

  it("rejects a removed log, altered amount, or substituted calldata despite success receipts", async () => {
    const result = await prepareAndSubmit();
    const record = await result.store.get({ releaseId: configuration().releaseId,
      sourceAddress: account.address });
    if (!record) throw new Error("missing record");
    for (const mutation of ["removed", "amount", "calldata"] as const) {
      const fixture = productionChainFixture(result.senderBoundary.sends[0]!);
      if (mutation === "removed") fixture.log.removed = true;
      if (mutation === "amount") fixture.log.data = fixture.eventData(101n);
      if (mutation === "calldata") fixture.transaction.input = "0x12345678";
      const production = createLateMigrationIntakeChainFromClientsV1([
        fixture.client(), fixture.client() ]);
      await expect(production.observeCanonicalDeposit({ configuration: fixture.config,
        record })).rejects.toMatchObject({ code: "deposit_receipt_mismatch" });
    }
  });

  it("distinguishes receipt absence from an RPC outage before finality", async () => {
    const result = await prepareAndSubmit();
    const record = await result.store.get({ releaseId: configuration().releaseId,
      sourceAddress: account.address });
    if (!record) throw new Error("missing record");
    const fixture = productionChainFixture(result.senderBoundary.sends[0]!, false);
    const left = fixture.client();
    const right = fixture.client();
    vi.mocked(left.getTransactionReceipt).mockRejectedValue(
      new TransactionReceiptNotFoundError({ hash: depositHash }));
    vi.mocked(right.getTransactionReceipt).mockRejectedValue(
      new TransactionReceiptNotFoundError({ hash: depositHash }));
    const production = createLateMigrationIntakeChainFromClientsV1([left, right]);
    expect(await production.observeCanonicalDeposit({ configuration: fixture.config,
      record })).toEqual({ confirmed: null, finalized: null });
    vi.mocked(right.getTransactionReceipt).mockRejectedValue(new Error("RPC unavailable"));
    await expect(production.observeCanonicalDeposit({ configuration: fixture.config,
      record })).rejects.toMatchObject({ code: "ethereum_receipt_unavailable" });
  });

  it("uses current-head permit state and tolerates an exact front-run permit", async () => {
    const result = await prepareAndSubmit();
    const fixture = productionChainFixture(result.senderBoundary.sends[0]!, false);
    const left = fixture.client();
    const right = fixture.client();
    const production = createLateMigrationIntakeChainFromClientsV1([left, right]);
    expect(await production.assertSubmissionReady({ configuration: fixture.config,
      claim })).toBe(7n);
    fixture.state.nonces = 8n;
    fixture.state.allowance = 100n;
    expect(await production.assertSubmissionReady({ configuration: fixture.config,
      claim, permitNonce: 7n })).toBe(8n);
    fixture.state.allowance = 101n;
    await expect(production.assertSubmissionReady({ configuration: fixture.config,
      claim, permitNonce: 7n })).rejects.toMatchObject({ code: "submission_state_mismatch" });
    expect(vi.mocked(left.readContract).mock.calls.some(([input]) =>
      input.functionName === "nonces" && input.blockNumber === 610n)).toBe(true);
    fixture.state.allowance = 100n;
    fixture.state.balanceOf = 99n;
    await expect(production.assertSubmissionReady({ configuration: fixture.config,
      claim, permitNonce: 7n })).rejects.toMatchObject({
      code: "insufficient_old_token_balance", status: 422 });
  });

  it("requires both pending simulations within the reserved gas maximum", async () => {
    const result = await prepareAndSubmit();
    const transaction = result.senderBoundary.sends[0]!;
    const fixture = productionChainFixture(transaction, false);
    const left = fixture.client();
    const right = fixture.client();
    const production = createLateMigrationIntakeChainFromClientsV1([left, right]);
    await expect(production.assertTransactionReady(transaction)).resolves.toBeUndefined();
    vi.mocked(right.estimateGas).mockResolvedValue(transaction.gasLimit + 1n);
    await expect(production.assertTransactionReady(transaction)).rejects.toMatchObject({
      code: "deposit_simulation_gas_exceeds_limit" });
    expect(vi.mocked(left.estimateGas).mock.calls[0]?.[0].blockTag).toBe("pending");
  });

  it("quotes live priority independently of the configured max fee cap", async () => {
    const result = await prepareAndSubmit();
    const fixture = productionChainFixture(result.senderBoundary.sends[0]!);
    const left = fixture.client();
    const right = fixture.client();
    vi.mocked(right.request).mockResolvedValue("0x1e8480"); // 0.002 gwei
    const production = createLateMigrationIntakeChainFromClientsV1([left, right]);
    const cap = { ...fixture.config, maximumFeePerGasWei: 200_000_000n };
    expect(await production.quotePriorityFeePerGas(cap)).toBe(2_000_000n);
    expect(left.request).toHaveBeenCalledWith({ method: "eth_maxPriorityFeePerGas" });
    expect(right.request).toHaveBeenCalledWith({ method: "eth_maxPriorityFeePerGas" });
    vi.mocked(left.request).mockResolvedValue("0x0");
    vi.mocked(right.request).mockResolvedValue("0x0");
    expect(await production.quotePriorityFeePerGas(cap)).toBe(0n);
  });

  it("rejects invalid, missing, or unaffordable fee quotes without a fallback", async () => {
    const result = await prepareAndSubmit();
    const fixture = productionChainFixture(result.senderBoundary.sends[0]!);
    const left = fixture.client();
    const right = fixture.client();
    const production = createLateMigrationIntakeChainFromClientsV1([left, right]);
    const cap = { ...fixture.config, maximumFeePerGasWei: 200_000_000n };
    for (const invalid of [null, undefined, "0x", "-1", "0x00", "0xzz",
      `0x${"f".repeat(65)}`]) {
      vi.mocked(right.request).mockResolvedValue(invalid as never);
      await expect(production.quotePriorityFeePerGas(cap)).rejects.toMatchObject({
        code: "priority_fee_quote_invalid" });
    }
    vi.mocked(right.request).mockRejectedValue(new Error("unsupported RPC method"));
    await expect(production.quotePriorityFeePerGas(cap)).rejects.toMatchObject({
      code: "priority_fee_quote_unavailable" });
    vi.mocked(right.request).mockResolvedValue("0xbebc200"); // 0.2 gwei before base
    await expect(production.quotePriorityFeePerGas(cap)).rejects.toMatchObject({
      code: "deposit_fee_cap_too_low" });
    vi.mocked(right.request).mockResolvedValue("0xee6b280"); // 0.25 gwei
    await expect(production.quotePriorityFeePerGas(cap)).rejects.toMatchObject({
      code: "deposit_fee_cap_too_low" });
  });

  it("requires canonical base fee agreement and Ethereum chain identity for fee quotes", async () => {
    const result = await prepareAndSubmit();
    const fixture = productionChainFixture(result.senderBoundary.sends[0]!);
    const left = fixture.client();
    const right = fixture.client();
    const production = createLateMigrationIntakeChainFromClientsV1([left, right]);
    vi.mocked(right.getBlock).mockImplementation(async (input) => ({
      ...await fixture.client().getBlock(input), baseFeePerGas: 99n,
    }) as never);
    await expect(production.quotePriorityFeePerGas(fixture.config)).rejects.toMatchObject({
      code: "priority_fee_quote_provider_mismatch" });
    vi.mocked(right.getBlock).mockImplementation(async (input) => ({
      ...await fixture.client().getBlock(input), baseFeePerGas: null,
    }) as never);
    await expect(production.quotePriorityFeePerGas(fixture.config)).rejects.toMatchObject({
      code: "priority_fee_quote_invalid" });
    vi.mocked(right.getBlock).mockImplementation(fixture.client().getBlock);
    vi.mocked(right.getChainId).mockResolvedValue(4663);
    await expect(production.quotePriorityFeePerGas(fixture.config)).rejects.toMatchObject({
      code: "priority_fee_quote_invalid" });
  });

  it("blocks GET and prepare for an onchain deposit even when its durable record is absent", async () => {
    const result = await prepareAndSubmit();
    const fixture = productionChainFixture(result.senderBoundary.sends[0]!);
    const production = createLateMigrationIntakeChainFromClientsV1([
      fixture.client(), fixture.client() ]);
    const sponsor = sender();
    const intake = createLateMigrationIntakeV1({ configuration: fixture.config,
      authenticator: authenticated(), store: createLateMigrationIntakeMemoryStoreV1(),
      chain: production, sender: sponsor, now: () => now });
    for (const response of [await intake.get(get()), await intake.post(post({
      action: "prepare", walletAddress: account.address }))]) {
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toMatchObject({ error: { code: "deposit_already_recorded" } });
      expect(body.error.message).toContain("Do not sign again");
      expect(body).not.toHaveProperty("typedData");
      expect(body).not.toHaveProperty("status", "not_started");
    }
    expect(sponsor.send).not.toHaveBeenCalled();
  });
});

function productionChainFixture(deposit: LateMigrationIntakeTransactionV1,
  deposited = true) {
  const config = { ...configuration(), sourceContractRuntimeCodehash:
    keccak256("0x6002") };
  const oldToken = getAddress("0x7987f03462200b3D8A072E02C89A8A41dCB124EE");
  const recipient = getAddress("0x2Bb333d48DFAF1596D9036671d2E43168994249E");
  const target = getAddress("0xC60bA256B44334A0Cd2C7242E98B88f031abB006");
  const round = "0xe18c667c5916bb9e8929d81a7769a25040da8964555b76d68dc62b7f7a07d179";
  const expectedId = keccak256(encodeAbiParameters([{ type: "bytes32" },
    { type: "uint256" }, { type: "address" }, { type: "uint256" },
    { type: "address" }, { type: "uint256" }, { type: "uint256" }],
  [round, 1n, oldToken, 42n, account.address, 100n, 80n]));
  const event = parseAbiItem("event MigrationDepositAccepted(bytes32 indexed roundId,bytes32 indexed depositId,address indexed source,uint256 offerIndex,uint256 grossAmount,uint256 manualPayoutAmount,address oldTokenRecipient,uint256 targetChainId,address targetToken,address sponsor,uint256 permitNonce)");
  const eventData = (gross = 100n) => encodeAbiParameters([{ type: "uint256" },
    { type: "uint256" }, { type: "uint256" }, { type: "address" },
    { type: "uint256" }, { type: "address" }, { type: "address" },
    { type: "uint256" }], [42n, gross, 80n, recipient, 4663n, target, relayer, 7n]);
  const log = { address: sourceContract, blockHash, blockNumber: 500n,
    transactionHash: depositHash, logIndex: 3, transactionIndex: 1,
    removed: false, data: eventData(), topics: encodeEventTopics({ abi: [event],
      eventName: "MigrationDepositAccepted", args: { roundId: round,
        depositId: expectedId, source: account.address } }) };
  const transaction = { blockHash, blockNumber: 500n, from: relayer,
    to: sourceContract, input: deposit.data, value: 0n, hash: depositHash };
  const state: Record<string, unknown> = { SOURCE_CHAIN_ID: 1n,
    TARGET_CHAIN_ID: 4663n, ROUND_ID: round,
    eligibilityRoot: "0x2817f23e9af279fe00d478f47cee3d36393677af6ac9d00c6ae4a0f821b423a0",
    OLD_TOKEN: oldToken, OLD_TOKEN_RECIPIENT: recipient, TARGET_TOKEN: target,
    depositsOpen: true, activatedAtBlock: 110n,
    activationAuthority: "0x0000000000000000000000000000000000000000",
    isOfferDeposited: deposited, consumedSource: deposited,
    acceptedDepositId: deposited ? expectedId : `0x${"00".repeat(32)}`,
    depositedAtBlock: deposited ? 500n : 0n, balanceOf: 100n,
    nonces: 7n, allowance: 0n,
    DOMAIN_SEPARATOR: "0xe2ac19a052ba41dccaaa930f489a94353d986c7769e416830273d9362ad26a47" };
  const client = () => ({
    getChainId: vi.fn(async () => 1),
    getBlock: vi.fn(async (input: { blockTag?: string; blockNumber?: bigint }) => {
      const number = input.blockNumber ?? (input.blockTag === "latest" ? 610n : 600n);
      return { number, baseFeePerGas: 54_000_000n,
        hash: number === 100n ? config.sourceDeploymentBlockHash :
        number === 120n ? config.relayerFundingBlockHash :
          number === 500n ? blockHash : `0x${"60".repeat(32)}` };
    }),
    getCode: vi.fn(async ({ address }: { address: string }) =>
      address.toLowerCase() === oldToken.toLowerCase() ? "0x6001" :
        address.toLowerCase() === sourceContract.toLowerCase() ? "0x6002" : "0x"),
    getBalance: vi.fn(async () => config.totalRelayerBudgetWei),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      state[functionName]),
    getLogs: vi.fn(async () => [log]),
    getTransactionReceipt: vi.fn(async () => ({ status: "success",
      transactionHash: depositHash, blockNumber: 500n, blockHash, logs: [log] })),
    getTransaction: vi.fn(async () => transaction),
    estimateGas: vi.fn(async () => 100_000n),
    request: vi.fn(async () => "0xf4240"), // 0.001 gwei live priority
  }) as unknown as PublicClient;
  return { config, state, client, expectedId, log, transaction, eventData };
}

class IntakeTestPool implements ProjectionTargetPostgresPoolV1 {
  constructor(private readonly database: PGlite) {}
  async assertProductionReadiness() {}
  async connect() {
    return { query: <Row extends Record<string, unknown>>(sql: string,
      values: readonly unknown[] = []) => this.query<Row>(sql, values), release() {} };
  }
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string, values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    const result = await this.database.query<Row>(sql, [...values]);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }
}
import { generateKeyPairSync } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
