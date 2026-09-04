import "server-only";

import { randomUUID } from "node:crypto";
import type { Policy } from "@privy-io/node";

import {
  encodeFunctionData,
  getAddress,
  isAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";

import activationManifest from
  "@/config/late-migration-intake-activation.v1.json";
import {
  getLateMigrationEligibilityClaimV1,
  type LateMigrationEligibilityClaimV1,
} from "@/lib/server/late-migration-eligibility-v1";
import {
  buildMainTokenMigrationPermitTypedData,
  parseMainTokenMigrationPermitSignature,
} from "@/lib/main-token-migration";
import type {
  WalletPrincipalAuthenticatorV1,
} from "./creator-article/wallet-principal.server";
import {
  WalletPrincipalAuthenticationErrorV1,
} from "./creator-article/wallet-principal.server";
import { canonicalizeJson, parseStrictJson } from
  "./projection-target/canonical-json";
import { canonicalSha256 } from "./projection-target/hashing";
import {
  LateMigrationIntakeStoreErrorV1,
  type LateMigrationIntakeIntentV1,
  type LateMigrationIntakeRecordV1,
  type LateMigrationIntakeStoreV1,
  type LateMigrationIntakeSupportV1,
  type LateMigrationIntakeTransitionV1,
} from "./late-migration-intake-store-v1";

export const LATE_MIGRATION_INTAKE_RESPONSE_SCHEMA_V1 =
  "programmable-late-migration-intake/v1";
export const LATE_MIGRATION_INTAKE_RELEASE_ID_V1 =
  "late-migration-80pct-e18c667c-intake-v1";

const SOURCE_CHAIN_ID = 1;
const MANUAL_PAYOUT_CHAIN_ID = 4_663;
const ROUND_ID =
  "0xe18c667c5916bb9e8929d81a7769a25040da8964555b76d68dc62b7f7a07d179";
const ELIGIBILITY_ROOT =
  "0x2817f23e9af279fe00d478f47cee3d36393677af6ac9d00c6ae4a0f821b423a0";
const OLD_TOKEN = getAddress(
  "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
);
const OLD_TOKEN_RECIPIENT = getAddress(
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
);
const MANUAL_PAYOUT_TOKEN = getAddress(
  "0xC60bA256B44334A0Cd2C7242E98B88f031abB006",
);
const OLD_TOKEN_RUNTIME_CODEHASH =
  "0x4fe466386aeebe507f6bcfc58e046a0632e4687699fa5bd28c4b7ec6333141ad";
const OLD_TOKEN_DOMAIN_SEPARATOR =
  "0xe2ac19a052ba41dccaaa930f489a94353d986c7769e416830273d9362ad26a47";
const AGGREGATE_GROSS_RAW = "176529129261873518239425341";
const AGGREGATE_MANUAL_PAYOUT_RAW = "141223303409498814591539678";
const ELIGIBLE_COUNT = 1_499;
const MAXIMUM_PERMIT_LEAD_SECONDS = 1_200;
const MAXIMUM_BODY_BYTES = 8_192;
const MAXIMUM_DEPOSIT_GAS_LIMIT = 1_000_000n;
const MAXIMUM_FEE_PER_GAS_WEI = 200_000_000_000n;
const MAXIMUM_TOTAL_RELAYER_BUDGET_WEI = 10_000_000_000_000_000_000n;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._~-]{15,127}$/u;
const SAFE_EXTERNAL_ID = /^[A-Za-z0-9_-]{8,256}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const SECP256K1_HALF_ORDER =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
type PrivyPolicyCondition = Policy["rules"][number]["conditions"][number];
type EthereumTransactionCondition = Extract<PrivyPolicyCondition,
  { field_source: "ethereum_transaction" }>;
type EthereumCalldataCondition = Extract<PrivyPolicyCondition,
  { field_source: "ethereum_calldata" }>;
type ConditionOperator = EthereumTransactionCondition["operator"];
type AbiSchema = EthereumCalldataCondition["abi"];

export const LATE_MIGRATION_INTAKE_ABI_V1 = [{
  type: "function",
  name: "depositWithPermit",
  stateMutability: "nonpayable",
  inputs: [
    { name: "offer", type: "tuple", components: [
      { name: "offerIndex", type: "uint256" },
      { name: "source", type: "address" },
      { name: "grossAmount", type: "uint256" },
      { name: "payoutAmount", type: "uint256" },
    ] },
    { name: "eligibilityProof", type: "bytes32[]" },
    { name: "permitNonce", type: "uint256" },
    { name: "permitDeadline", type: "uint256" },
    { name: "v", type: "uint8" },
    { name: "r", type: "bytes32" },
    { name: "s", type: "bytes32" },
  ],
  outputs: [],
}] as const;

export type LateMigrationIntakeConfigurationV1 = Readonly<{
  releaseId: typeof LATE_MIGRATION_INTAKE_RELEASE_ID_V1;
  sourceContractAddress: Address;
  sourceContractRuntimeCodehash: Hex;
  sourceDeploymentBlockNumber: bigint;
  sourceDeploymentBlockHash: Hex;
  activatedAtBlock: bigint;
  relayerAddress: Address;
  relayerFundingBlockNumber: bigint;
  relayerFundingBlockHash: Hex;
  relayerFundingBalanceWei: bigint;
  relayerPolicySha256: `sha256:${string}`;
  maximumDepositGasLimit: bigint;
  maximumFeePerGasWei: bigint;
  totalRelayerBudgetWei: bigint;
  permitValiditySeconds: number;
  relayerWalletId: string;
  relayerPolicyId: string;
  relayerTransactionSignerId: string;
  relayerWalletOwnerId: string;
  relayerPolicyOwnerId: string;
  relayerOwnerPublicKey: string;
}>;

export type LateMigrationIntakeTransactionV1 = Readonly<{
  kind: "deposit";
  chainId: 1;
  from: Address;
  to: Address;
  data: Hex;
  value: 0n;
  gasLimit: bigint;
  maxFeePerGasWei: bigint;
  maxPriorityFeePerGasWei: bigint;
  providerIdempotencyKey: string;
  providerReferenceId: string;
}>;

export type LateMigrationIntakeProviderStatusV1 = Readonly<{
  status:
    | "broadcasted"
    | "confirmed"
    | "finalized"
    | "pending"
    | "replaced"
    | "failed";
  transactionHash: Hex | null;
}>;

export interface LateMigrationIntakeSenderV1 {
  assertReady(): Promise<void>;
  lookup(intent: LateMigrationIntakeIntentV1):
    Promise<LateMigrationIntakeProviderStatusV1 | null>;
  send(transaction: LateMigrationIntakeTransactionV1): Promise<Hex>;
}

export interface LateMigrationIntakeChainV1 {
  assertNoExistingDeposit(input: Readonly<{
    configuration: LateMigrationIntakeConfigurationV1;
    claim: LateMigrationEligibilityClaimV1;
  }>): Promise<void>;
  assertSubmissionReady(input: Readonly<{
    configuration: LateMigrationIntakeConfigurationV1;
    claim: LateMigrationEligibilityClaimV1;
    permitNonce?: bigint;
  }>): Promise<bigint>;
  quotePriorityFeePerGas(configuration: LateMigrationIntakeConfigurationV1):
    Promise<bigint>;
  assertTransactionReady(transaction: LateMigrationIntakeTransactionV1):
    Promise<void>;
  observeCanonicalDeposit(input: Readonly<{
    configuration: LateMigrationIntakeConfigurationV1;
    record: LateMigrationIntakeRecordV1;
  }>): Promise<Readonly<{
    confirmed: Extract<LateMigrationIntakeTransitionV1,
      { stage: "deposit_confirmed" }> | null;
    finalized: Extract<LateMigrationIntakeTransitionV1,
      { stage: "deposit_finalized" }> | null;
  }>>;
}

export class LateMigrationIntakeErrorV1 extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 409 | 413 | 422 | 429 | 503,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super("Late migration intake failed closed");
    this.name = "LateMigrationIntakeErrorV1";
  }
}

export function readLateMigrationIntakeConfigurationV1(input: Readonly<{
  environment: Readonly<Record<string, string | undefined>>;
  manifest: unknown;
}>): LateMigrationIntakeConfigurationV1 | null {
  if (input.environment.PROGRAMMABLE_LATE_MIGRATION_INTAKE_ENABLED !== "true") {
    return null;
  }
  if (!input.manifest || typeof input.manifest !== "object" ||
    Array.isArray(input.manifest)) throw configurationError();
  const manifest = input.manifest as Record<string, unknown>;
  exactConfigKeys(manifest, [
    "schema", "releaseId", "enabled", "sourceChainId", "roundId",
    "eligibilityRoot", "eligibleOfferCount", "aggregateGrossAmountRaw",
    "aggregateManualPayoutAmountRaw", "manualPayoutBps", "oldTokenAddress",
    "oldTokenRuntimeCodehash", "oldTokenDomainSeparator", "oldTokenRecipient",
    "manualPayoutChainId", "manualPayoutTokenAddress",
    "maximumPermitDeadlineLeadSeconds", "permitValiditySeconds",
    "sourceContractAddress", "sourceContractRuntimeCodehash",
    "sourceDeploymentBlockNumber", "sourceDeploymentBlockHash",
    "activatedAtBlock", "relayerAddress", "relayerFundingBlockNumber",
    "relayerFundingBlockHash", "relayerFundingBalanceWei",
    "relayerPolicySha256", "maximumDepositGasLimit",
    "maximumFeePerGasWei", "totalRelayerBudgetWei",
    "relayerWalletOwnerId", "relayerPolicyOwnerId",
  ]);
  if (manifest.schema !==
    "programmable-late-migration-intake-activation/v1" ||
    manifest.releaseId !== LATE_MIGRATION_INTAKE_RELEASE_ID_V1 ||
    manifest.enabled !== true || manifest.sourceChainId !== SOURCE_CHAIN_ID ||
    manifest.roundId !== ROUND_ID || manifest.eligibilityRoot !== ELIGIBILITY_ROOT ||
    manifest.eligibleOfferCount !== ELIGIBLE_COUNT ||
    manifest.aggregateGrossAmountRaw !== AGGREGATE_GROSS_RAW ||
    manifest.aggregateManualPayoutAmountRaw !==
      AGGREGATE_MANUAL_PAYOUT_RAW || manifest.manualPayoutBps !== 8_000 ||
    !sameAddress(manifest.oldTokenAddress, OLD_TOKEN) ||
    manifest.oldTokenRuntimeCodehash !== OLD_TOKEN_RUNTIME_CODEHASH ||
    manifest.oldTokenDomainSeparator !== OLD_TOKEN_DOMAIN_SEPARATOR ||
    !sameAddress(manifest.oldTokenRecipient, OLD_TOKEN_RECIPIENT) ||
    manifest.manualPayoutChainId !== MANUAL_PAYOUT_CHAIN_ID ||
    !sameAddress(manifest.manualPayoutTokenAddress, MANUAL_PAYOUT_TOKEN) ||
    manifest.maximumPermitDeadlineLeadSeconds !==
      MAXIMUM_PERMIT_LEAD_SECONDS ||
    typeof manifest.permitValiditySeconds !== "number" ||
    !Number.isSafeInteger(manifest.permitValiditySeconds) ||
    manifest.permitValiditySeconds < 60 ||
    manifest.permitValiditySeconds > MAXIMUM_PERMIT_LEAD_SECONDS) {
    throw configurationError();
  }
  const sourceContractAddress = requiredAddress(manifest.sourceContractAddress);
  const sourceContractRuntimeCodehash = requiredHash(
    manifest.sourceContractRuntimeCodehash);
  const sourceDeploymentBlockNumber = requiredPositiveInteger(
    manifest.sourceDeploymentBlockNumber);
  const sourceDeploymentBlockHash = requiredHash(manifest.sourceDeploymentBlockHash);
  const activatedAtBlock = requiredPositiveInteger(manifest.activatedAtBlock);
  const relayerAddress = requiredAddress(manifest.relayerAddress);
  const relayerFundingBlockNumber = requiredPositiveInteger(
    manifest.relayerFundingBlockNumber);
  const relayerFundingBlockHash = requiredHash(manifest.relayerFundingBlockHash);
  const relayerFundingBalanceWei = requiredPositiveInteger(
    manifest.relayerFundingBalanceWei);
  const relayerPolicySha256 = requiredDigest(manifest.relayerPolicySha256);
  const maximumDepositGasLimit = requiredPositiveInteger(
    manifest.maximumDepositGasLimit);
  const maximumFeePerGasWei = requiredPositiveInteger(manifest.maximumFeePerGasWei);
  const totalRelayerBudgetWei = requiredPositiveInteger(
    manifest.totalRelayerBudgetWei);
  const relayerWalletId = requiredExternalId(
    input.environment.PROGRAMMABLE_LATE_MIGRATION_PRIVY_WALLET_ID);
  const relayerPolicyId = requiredExternalId(
    input.environment.PROGRAMMABLE_LATE_MIGRATION_PRIVY_POLICY_ID);
  const relayerTransactionSignerId = requiredExternalId(
    input.environment.PROGRAMMABLE_LATE_MIGRATION_PRIVY_TRANSACTION_SIGNER_ID);
  const relayerWalletOwnerId = requiredExternalId(manifest.relayerWalletOwnerId);
  const relayerPolicyOwnerId = requiredExternalId(manifest.relayerPolicyOwnerId);
  const relayerOwnerPublicKey = input.environment
    .PROGRAMMABLE_LATE_MIGRATION_PRIVY_OWNER_PUBLIC_KEY?.trim();
  if (!relayerOwnerPublicKey || relayerOwnerPublicKey.length > 512 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(relayerOwnerPublicKey) ||
    relayerWalletOwnerId === relayerTransactionSignerId ||
    relayerPolicyOwnerId === relayerTransactionSignerId ||
    relayerAddress.toLowerCase() ===
      "0x245099e77f8f0cad9a75b1b56db8fde7c948d5b1") {
    throw configurationError();
  }
  if (new Set([sourceContractAddress.toLowerCase(),
    relayerAddress.toLowerCase(), OLD_TOKEN.toLowerCase(),
    OLD_TOKEN_RECIPIENT.toLowerCase()]).size !== 4 ||
    sourceDeploymentBlockNumber >= activatedAtBlock ||
    relayerFundingBlockNumber < sourceDeploymentBlockNumber ||
    maximumDepositGasLimit > MAXIMUM_DEPOSIT_GAS_LIMIT ||
    maximumFeePerGasWei > MAXIMUM_FEE_PER_GAS_WEI ||
    totalRelayerBudgetWei > MAXIMUM_TOTAL_RELAYER_BUDGET_WEI ||
    relayerFundingBalanceWei !== totalRelayerBudgetWei ||
    totalRelayerBudgetWei < maximumDepositGasLimit * maximumFeePerGasWei) {
    throw configurationError();
  }
  const configuration = Object.freeze({
    releaseId: LATE_MIGRATION_INTAKE_RELEASE_ID_V1,
    sourceContractAddress, sourceContractRuntimeCodehash,
    sourceDeploymentBlockNumber, sourceDeploymentBlockHash, activatedAtBlock,
    relayerAddress, relayerFundingBlockNumber, relayerFundingBlockHash,
    relayerFundingBalanceWei, relayerPolicySha256, maximumDepositGasLimit,
    maximumFeePerGasWei, totalRelayerBudgetWei,
    permitValiditySeconds: manifest.permitValiditySeconds,
    relayerWalletId, relayerPolicyId, relayerTransactionSignerId,
    relayerWalletOwnerId, relayerPolicyOwnerId, relayerOwnerPublicKey,
  });
  if (expectedLateMigrationIntakePolicySha256V1(configuration) !==
    relayerPolicySha256) throw configurationError();
  return configuration;
}

export function lateMigrationIntakePolicyV1(
  configuration: Pick<LateMigrationIntakeConfigurationV1,
    "sourceContractAddress">,
) {
  return Object.freeze({
    name: "Programmable late migration intake v1",
    chainType: "ethereum",
    version: "1.0",
    rules: Object.freeze([Object.freeze({
      name: "Gas-sponsored exact V4 intake deposits",
      action: "ALLOW",
      method: "eth_sendTransaction",
      conditions: Object.freeze([
        policyCondition("ethereum_transaction", "chain_id", "eq", "1"),
        policyCondition("ethereum_transaction", "to", "eq",
          configuration.sourceContractAddress),
        policyCondition("ethereum_transaction", "value", "eq", "0x0"),
        policyCondition("ethereum_calldata", "function_name", "eq",
          "depositWithPermit", [LATE_MIGRATION_INTAKE_ABI_V1[0]]),
      ]),
    })]),
  });
}

export function expectedLateMigrationIntakePolicySha256V1(
  configuration: Pick<LateMigrationIntakeConfigurationV1,
    "sourceContractAddress">,
) {
  return canonicalSha256("programmable.late-migration.intake-policy.v1",
    lateMigrationIntakePolicyV1(configuration));
}

export function buildLateMigrationIntakeTransactionV1(
  configuration: LateMigrationIntakeConfigurationV1,
  record: LateMigrationIntakeRecordV1,
  claim: LateMigrationEligibilityClaimV1,
): LateMigrationIntakeTransactionV1 {
  assertRecordClaim(configuration, record, claim);
  const permit = parseMainTokenMigrationPermitSignature(
    record.intent.permitSignature);
  const transaction = Object.freeze({
    kind: "deposit" as const,
    chainId: 1 as const,
    from: configuration.relayerAddress,
    to: configuration.sourceContractAddress,
    data: encodeFunctionData({
      abi: LATE_MIGRATION_INTAKE_ABI_V1,
      functionName: "depositWithPermit",
      args: [{
        offerIndex: BigInt(claim.offerIndex),
        source: claim.walletAddress,
        grossAmount: BigInt(claim.requiredGrossDepositRaw),
        payoutAmount: BigInt(claim.targetPayout80Raw),
      }, [...claim.eligibilityProof], BigInt(record.intent.permitNonce),
      BigInt(record.intent.permitDeadline), permit.v, permit.r, permit.s],
    }),
    value: 0n as const,
    gasLimit: BigInt(record.intent.depositGasLimit),
    maxFeePerGasWei: BigInt(record.intent.maxFeePerGasWei),
    maxPriorityFeePerGasWei: BigInt(record.intent.maxPriorityFeePerGasWei),
    providerIdempotencyKey: record.intent.providerIdempotencyKey,
    providerReferenceId: record.intent.providerReferenceId,
  });
  if (transactionBindingHash(transaction) !==
    record.intent.transactionBindingHash) throw configurationError();
  return transaction;
}

export function createLateMigrationIntakeV1(input: Readonly<{
  configuration: LateMigrationIntakeConfigurationV1;
  authenticator: WalletPrincipalAuthenticatorV1;
  store: LateMigrationIntakeStoreV1;
  chain: LateMigrationIntakeChainV1;
  sender: LateMigrationIntakeSenderV1;
  now?: () => Date;
}>) {
  const now = input.now ?? (() => new Date());
  return Object.freeze({
    async get(request: Request) {
      try {
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = parseWalletQuery(request);
        assertLinkedWallet(principal.wallets, walletAddress);
        const claim = requireClaim(walletAddress);
        await input.store.admit({ releaseId: input.configuration.releaseId,
          sourceAddress: walletAddress,
          principalBindingHash: derivePrincipalBinding(principal.privyUserId),
          operation: "get", nowMs: now().getTime() });
        let record = await input.store.get(lookup(input.configuration, claim));
        if (record) record = await progressRecord(input, record, false, now);
        else await input.chain.assertNoExistingDeposit({
          configuration: input.configuration, claim });
        return intakeResponse(claim, record);
      } catch (error) {
        return errorResponse(error);
      }
    },
    async post(request: Request) {
      try {
        requireSameOrigin(request);
        const principal = await input.authenticator.authenticate(request);
        const body = parseRequest(await boundedJson(request));
        assertLinkedWallet(principal.wallets, body.walletAddress);
        const claim = requireClaim(body.walletAddress);
        const principalBindingHash = derivePrincipalBinding(principal.privyUserId);
        await input.store.admit({ releaseId: input.configuration.releaseId,
          sourceAddress: claim.walletAddress, principalBindingHash,
          operation: body.action, nowMs: now().getTime() });
        let existing = await input.store.get(lookup(input.configuration, claim));
        if (existing) {
          existing = await progressRecord(input, existing, false, now);
          if (body.action === "submit") {
            const idempotencyKey = request.headers.get("idempotency-key") ?? "";
            if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
              throw new LateMigrationIntakeErrorV1(400,
                "idempotency_key_invalid");
            }
            assertExistingSubmission(existing, body, principalBindingHash,
              idempotencyKey);
          }
          if (existing.stage !== "signature_reserved" || existing.support) {
            return intakeResponse(claim, existing);
          }
        }
        if (body.action === "prepare") {
          if (existing) return intakeResponse(claim, existing);
          const [permitNonce] = await Promise.all([
            input.chain.assertSubmissionReady({
              configuration: input.configuration, claim }),
            input.sender.assertReady(),
            input.chain.quotePriorityFeePerGas(input.configuration),
          ]);
          const permitDeadline = BigInt(Math.floor(now().getTime() / 1_000) +
            input.configuration.permitValiditySeconds);
          const requestBindingHash = deriveRequestBinding(input.configuration,
            claim, permitNonce, permitDeadline);
          return json({
            schema: LATE_MIGRATION_INTAKE_RESPONSE_SCHEMA_V1,
            status: "signature_required",
            walletAddress: claim.walletAddress,
            offerIndex: claim.offerIndex,
            requiredGrossDepositRaw: claim.requiredGrossDepositRaw,
            targetPayout80Raw: claim.targetPayout80Raw,
            permitNonce: permitNonce.toString(),
            permitDeadline: permitDeadline.toString(),
            requestBindingHash,
            typedData: permitTypedDataJson(claim,
              input.configuration.sourceContractAddress, permitNonce,
              permitDeadline),
          }, 200);
        }
        const idempotencyKey = request.headers.get("idempotency-key") ?? "";
        if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
          throw new LateMigrationIntakeErrorV1(400, "idempotency_key_invalid");
        }
        if (existing) {
          return intakeResponse(claim,
            await progressRecord(input, existing, true, now));
        }
        assertPermitWindow(body.permitDeadline, now(),
          input.configuration.permitValiditySeconds);
        const expectedBinding = deriveRequestBinding(input.configuration, claim,
          body.permitNonce, body.permitDeadline);
        if (body.requestBindingHash !== expectedBinding) {
          throw new LateMigrationIntakeErrorV1(409,
            "request_binding_mismatch");
        }
        await assertPermitSignature(claim, input.configuration,
          body.permitNonce, body.permitDeadline, body.permitSignature);
        const [maxPriorityFeePerGasWei] = await Promise.all([
          input.chain.quotePriorityFeePerGas(input.configuration),
          input.chain.assertSubmissionReady({ configuration:
            input.configuration, claim, permitNonce: body.permitNonce }),
          input.sender.assertReady(),
        ]);
        const bindings = deriveIntentBindings(input.configuration, claim,
          principal.privyUserId, idempotencyKey, expectedBinding,
          body.permitNonce, body.permitDeadline, body.permitSignature,
          maxPriorityFeePerGasWei);
        const intent: LateMigrationIntakeIntentV1 = Object.freeze({
          schema: "programmable-late-migration-intake-intent/v1",
          releaseId: input.configuration.releaseId,
          sourceAddress: claim.walletAddress,
          offerIndex: claim.offerIndex,
          grossAmountRaw: claim.requiredGrossDepositRaw,
          manualPayoutAmountRaw: claim.targetPayout80Raw,
          sourceContractAddress: input.configuration.sourceContractAddress,
          relayerAddress: input.configuration.relayerAddress,
          permitNonce: body.permitNonce.toString(),
          permitDeadline: body.permitDeadline.toString(),
          permitSignature: body.permitSignature,
          depositGasLimit: input.configuration.maximumDepositGasLimit.toString(),
          maxFeePerGasWei: input.configuration.maximumFeePerGasWei.toString(),
          maxPriorityFeePerGasWei: maxPriorityFeePerGasWei.toString(),
          reservationWei: (input.configuration.maximumDepositGasLimit *
            input.configuration.maximumFeePerGasWei).toString(),
          totalBudgetWei: input.configuration.totalRelayerBudgetWei.toString(),
          principalBindingHash: bindings.principalBindingHash,
          idempotencyBindingHash: bindings.idempotencyBindingHash,
          requestBindingHash: expectedBinding,
          transactionBindingHash: bindings.transactionBindingHash,
          providerIdempotencyKey: bindings.providerIdempotencyKey,
          providerReferenceId: bindings.providerReferenceId,
          reservedAt: now().toISOString(),
        });
        const reservation = await input.store.reserve({
          lookup: lookup(input.configuration, claim), intent });
        return intakeResponse(claim,
          await progressRecord(input, reservation.record, true, now));
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
}

async function progressRecord(
  input: Readonly<{
    configuration: LateMigrationIntakeConfigurationV1;
    store: LateMigrationIntakeStoreV1;
    chain: LateMigrationIntakeChainV1;
    sender: LateMigrationIntakeSenderV1;
  }>,
  initial: LateMigrationIntakeRecordV1,
  allowSend: boolean,
  now: () => Date,
) {
  let record = initial;
  const claim = requireClaim(record.intent.sourceAddress);
  assertRecordClaim(input.configuration, record, claim);
  const canonical = await input.chain.observeCanonicalDeposit({
    configuration: input.configuration, record });
  if (record.stage === "deposit_finalized") {
    const saved = record.transitions.at(-1);
    if (!canonical.finalized || saved?.stage !== "deposit_finalized" ||
      canonical.finalized.transactionHash !== saved.transactionHash ||
      canonical.finalized.blockNumber !== saved.blockNumber ||
      canonical.finalized.blockHash !== saved.blockHash ||
      canonical.finalized.depositId !== saved.depositId ||
      canonical.finalized.logIndex !== saved.logIndex) {
      throw new LateMigrationIntakeErrorV1(503, "finalized_deposit_unverified");
    }
    return record;
  }
  if (canonical.confirmed) {
    if (record.stage === "signature_reserved") {
      record = await advance(input, record, Object.freeze({
        schema: "programmable-late-migration-intake-transition/v1" as const,
        stage: "deposit_submitted" as const,
        transactionHash: canonical.confirmed.transactionHash,
      }));
    }
    if (record.stage === "deposit_submitted") {
      record = await advance(input, record, canonical.confirmed);
    }
    if (canonical.finalized && record.stage === "deposit_confirmed") {
      record = await advance(input, record, canonical.finalized);
    } else if (record.stage === "deposit_confirmed") {
      const saved = record.transitions.at(-1);
      if (saved?.stage !== "deposit_confirmed" ||
        canonical.confirmed.transactionHash !== saved.transactionHash ||
        canonical.confirmed.blockHash !== saved.blockHash ||
        canonical.confirmed.blockNumber !== saved.blockNumber) {
        return markSupport(input, record, "confirmation_reorged", now);
      }
    }
    return record;
  }
  if (record.stage === "deposit_confirmed") {
    return markSupport(input, record, "confirmation_reorged", now);
  }
  if (record.support) return record;
  const provider = await input.sender.lookup(record.intent);
  if (provider?.transactionHash &&
    (provider.status === "broadcasted" || provider.status === "pending" ||
      provider.status === "confirmed" || provider.status === "finalized" ||
      provider.status === "replaced")) {
    if (record.stage === "signature_reserved") {
      record = await advance(input, record, Object.freeze({
        schema: "programmable-late-migration-intake-transition/v1" as const,
        stage: "deposit_submitted" as const,
        transactionHash: provider.transactionHash,
      }));
    }
    return record;
  }
  if (provider?.status === "replaced" && !provider.transactionHash) {
    return markSupport(input, record, "provider_replacement_unresolved", now);
  }
  if (provider?.status === "failed") {
    return markSupport(input, record, "provider_terminal_failure", now);
  }
  // A provider record without a hash can still have been accepted. Never send
  // another transaction merely because its hash has not reached the lookup API.
  if (provider) return record;
  if (BigInt(record.intent.permitDeadline) <
    BigInt(Math.floor(now().getTime() / 1_000))) {
    return markSupport(input, record, record.sendClaim ||
      record.stage === "deposit_submitted" ? "submission_outcome_unknown" :
      "permit_expired_before_submission", now);
  }
  if (!allowSend || record.stage !== "signature_reserved" || record.sendClaim) {
    return record;
  }
  const transaction = buildLateMigrationIntakeTransactionV1(
    input.configuration, record, claim);
  await input.chain.assertTransactionReady(transaction);
  await input.sender.assertReady();
  const sendClaim = await input.store.claimSend({
    lookup: lookup(input.configuration, claim),
    expectedRequestBindingHash: record.intent.requestBindingHash,
    claim: Object.freeze({
      schema: "programmable-late-migration-intake-send-claim/v1",
      transactionBindingHash: record.intent.transactionBindingHash,
      providerReferenceId: record.intent.providerReferenceId,
      claimedAt: now().toISOString(),
    }),
  });
  // The durable winner is the only process allowed to call the provider. A
  // timeout/crash after this point is reconciled from chain evidence, never
  // retried through a provider whose idempotency retention may have expired.
  if (sendClaim.kind !== "created") return sendClaim.record;
  let hash: Hex;
  try {
    hash = await input.sender.send(transaction);
  } catch {
    return markSupport(input, sendClaim.record, "submission_outcome_unknown", now);
  }
  return advance(input, record, Object.freeze({
    schema: "programmable-late-migration-intake-transition/v1" as const,
    stage: "deposit_submitted" as const,
    transactionHash: hash,
  }));
}

async function advance(
  input: Pick<Parameters<typeof progressRecord>[0], "configuration" | "store">,
  record: LateMigrationIntakeRecordV1,
  transition: LateMigrationIntakeTransitionV1,
) {
  return input.store.advance({
    lookup: { releaseId: input.configuration.releaseId,
      sourceAddress: record.intent.sourceAddress },
    expectedRequestBindingHash: record.intent.requestBindingHash,
    transition,
  });
}

async function markSupport(
  input: Pick<Parameters<typeof progressRecord>[0], "configuration" | "store">,
  record: LateMigrationIntakeRecordV1,
  reason: LateMigrationIntakeSupportV1["reason"],
  now: () => Date,
) {
  if (record.support) return record;
  return input.store.markSupport({
    lookup: { releaseId: input.configuration.releaseId,
      sourceAddress: record.intent.sourceAddress },
    expectedRequestBindingHash: record.intent.requestBindingHash,
    support: Object.freeze({
      schema: "programmable-late-migration-intake-support/v1",
      reason,
      markedAt: now().toISOString(),
    }),
  });
}

function deriveIntentBindings(
  configuration: LateMigrationIntakeConfigurationV1,
  claim: LateMigrationEligibilityClaimV1,
  privyUserId: string,
  idempotencyKey: string,
  requestBindingHash: `sha256:${string}`,
  permitNonce: bigint,
  permitDeadline: bigint,
  permitSignature: Hex,
  maxPriorityFeePerGasWei: bigint,
) {
  const principalBindingHash = derivePrincipalBinding(privyUserId);
  const idempotencyBindingHash = canonicalSha256(
    "programmable.late-migration.intake-idempotency.v1", {
      idempotencyKey, sourceAddress: claim.walletAddress.toLowerCase(),
    });
  const digest = canonicalSha256("programmable.late-migration.intake-provider.v1",
    { releaseId: configuration.releaseId,
      sourceAddress: claim.walletAddress.toLowerCase(), requestBindingHash })
    .slice("sha256:".length);
  const placeholder = Object.freeze({
    intent: {
      permitNonce: permitNonce.toString(),
      permitDeadline: permitDeadline.toString(),
      permitSignature,
      depositGasLimit: configuration.maximumDepositGasLimit.toString(),
      maxFeePerGasWei: configuration.maximumFeePerGasWei.toString(),
      maxPriorityFeePerGasWei: maxPriorityFeePerGasWei.toString(),
      providerIdempotencyKey: `lmi-deposit-${digest}`,
      providerReferenceId: `lmi-d-${digest.slice(0, 58)}`,
    },
  } as unknown as LateMigrationIntakeRecordV1);
  const transaction = buildUnboundTransaction(configuration, placeholder, claim);
  return Object.freeze({ principalBindingHash, idempotencyBindingHash,
    transactionBindingHash: transactionBindingHash(transaction),
    providerIdempotencyKey: placeholder.intent.providerIdempotencyKey,
    providerReferenceId: placeholder.intent.providerReferenceId });
}

function buildUnboundTransaction(
  configuration: LateMigrationIntakeConfigurationV1,
  record: LateMigrationIntakeRecordV1,
  claim: LateMigrationEligibilityClaimV1,
) {
  const permit = parseMainTokenMigrationPermitSignature(
    record.intent.permitSignature);
  return Object.freeze({
    kind: "deposit" as const, chainId: 1 as const,
    from: configuration.relayerAddress,
    to: configuration.sourceContractAddress,
    data: encodeFunctionData({ abi: LATE_MIGRATION_INTAKE_ABI_V1,
      functionName: "depositWithPermit", args: [{
        offerIndex: BigInt(claim.offerIndex), source: claim.walletAddress,
        grossAmount: BigInt(claim.requiredGrossDepositRaw),
        payoutAmount: BigInt(claim.targetPayout80Raw),
      }, [...claim.eligibilityProof], BigInt(record.intent.permitNonce),
      BigInt(record.intent.permitDeadline), permit.v, permit.r, permit.s] }),
    value: 0n as const,
    gasLimit: BigInt(record.intent.depositGasLimit),
    maxFeePerGasWei: BigInt(record.intent.maxFeePerGasWei),
    maxPriorityFeePerGasWei: BigInt(record.intent.maxPriorityFeePerGasWei),
    providerIdempotencyKey: record.intent.providerIdempotencyKey,
    providerReferenceId: record.intent.providerReferenceId,
  });
}

function transactionBindingHash(transaction: LateMigrationIntakeTransactionV1) {
  return canonicalSha256("programmable.late-migration.intake-transaction.v1", {
    chainId: String(transaction.chainId), from: transaction.from.toLowerCase(),
    to: transaction.to.toLowerCase(), data: transaction.data.toLowerCase(),
    value: transaction.value.toString(), gasLimit: transaction.gasLimit.toString(),
    maxFeePerGasWei: transaction.maxFeePerGasWei.toString(),
    maxPriorityFeePerGasWei: transaction.maxPriorityFeePerGasWei.toString(),
  });
}

function deriveRequestBinding(
  configuration: LateMigrationIntakeConfigurationV1,
  claim: LateMigrationEligibilityClaimV1,
  permitNonce: bigint,
  permitDeadline: bigint,
) {
  return canonicalSha256("programmable.late-migration.intake-permit.v1", {
    releaseId: configuration.releaseId,
    sourceChainId: String(SOURCE_CHAIN_ID), oldToken: OLD_TOKEN.toLowerCase(),
    oldTokenRecipient: OLD_TOKEN_RECIPIENT.toLowerCase(),
    sourceContractAddress: configuration.sourceContractAddress.toLowerCase(),
    roundId: ROUND_ID, eligibilityRoot: ELIGIBILITY_ROOT,
    offerIndex: String(claim.offerIndex),
    sourceAddress: claim.walletAddress.toLowerCase(),
    grossAmountRaw: claim.requiredGrossDepositRaw,
    manualPayoutAmountRaw: claim.targetPayout80Raw,
    manualPayoutChainId: String(MANUAL_PAYOUT_CHAIN_ID),
    manualPayoutToken: MANUAL_PAYOUT_TOKEN.toLowerCase(),
    permitNonce: permitNonce.toString(), permitDeadline: permitDeadline.toString(),
  });
}

function derivePrincipalBinding(privyUserId: string) {
  if (!privyUserId || privyUserId.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(privyUserId)) {
    throw new LateMigrationIntakeErrorV1(503, "principal_invalid");
  }
  return canonicalSha256("programmable.late-migration.intake-principal.v1",
    { privyUserId });
}

async function assertPermitSignature(
  claim: LateMigrationEligibilityClaimV1,
  configuration: LateMigrationIntakeConfigurationV1,
  permitNonce: bigint,
  permitDeadline: bigint,
  signature: Hex,
) {
  try {
    assertCanonicalPermitSignatureV1(signature);
    const recovered = await recoverTypedDataAddress({
      ...buildMainTokenMigrationPermitTypedData({ owner: claim.walletAddress,
        spender: configuration.sourceContractAddress,
        value: BigInt(claim.requiredGrossDepositRaw), nonce: permitNonce,
        deadline: permitDeadline }), signature });
    if (recovered.toLowerCase() !== claim.walletAddress.toLowerCase()) {
      throw new TypeError("wrong signer");
    }
  } catch {
    throw new LateMigrationIntakeErrorV1(422, "permit_signature_invalid");
  }
}

export function assertCanonicalPermitSignatureV1(signature: Hex) {
  const parsed = parseMainTokenMigrationPermitSignature(signature);
  if (BigInt(parsed.r) === 0n || BigInt(parsed.s) === 0n ||
    BigInt(parsed.s) > SECP256K1_HALF_ORDER) {
    throw new TypeError("Permit signature is not canonical");
  }
  return parsed;
}

function assertRecordClaim(
  configuration: LateMigrationIntakeConfigurationV1,
  record: LateMigrationIntakeRecordV1,
  claim: LateMigrationEligibilityClaimV1,
) {
  const intent = record.intent;
  if (intent.releaseId !== configuration.releaseId ||
    intent.sourceContractAddress !== configuration.sourceContractAddress ||
    intent.relayerAddress !== configuration.relayerAddress ||
    intent.sourceAddress !== claim.walletAddress ||
    intent.offerIndex !== claim.offerIndex ||
    intent.grossAmountRaw !== claim.requiredGrossDepositRaw ||
    intent.manualPayoutAmountRaw !== claim.targetPayout80Raw ||
    BigInt(intent.depositGasLimit) !== configuration.maximumDepositGasLimit ||
    BigInt(intent.maxFeePerGasWei) !== configuration.maximumFeePerGasWei ||
    BigInt(intent.reservationWei) !== configuration.maximumDepositGasLimit *
      configuration.maximumFeePerGasWei ||
    BigInt(intent.totalBudgetWei) !== configuration.totalRelayerBudgetWei) {
    throw new LateMigrationIntakeErrorV1(503, "record_binding_mismatch");
  }
}

function assertExistingSubmission(
  record: LateMigrationIntakeRecordV1,
  body: Extract<IntakeRequest, { action: "submit" }>,
  principalBindingHash: `sha256:${string}`,
  idempotencyKey: string,
) {
  const idempotencyBindingHash = canonicalSha256(
    "programmable.late-migration.intake-idempotency.v1", {
      idempotencyKey, sourceAddress: body.walletAddress.toLowerCase(),
    });
  if (record.intent.requestBindingHash !== body.requestBindingHash ||
    record.intent.permitNonce !== body.permitNonce.toString() ||
    record.intent.permitDeadline !== body.permitDeadline.toString() ||
    record.intent.permitSignature !== body.permitSignature ||
    record.intent.principalBindingHash !== principalBindingHash ||
    record.intent.idempotencyBindingHash !== idempotencyBindingHash) {
    throw new LateMigrationIntakeErrorV1(409, "request_conflict");
  }
}

function intakeResponse(
  claim: LateMigrationEligibilityClaimV1,
  record: LateMigrationIntakeRecordV1 | null,
) {
  if (!record) return json({
    schema: LATE_MIGRATION_INTAKE_RESPONSE_SCHEMA_V1,
    status: "not_started", walletAddress: claim.walletAddress,
    offerIndex: claim.offerIndex,
    requiredGrossDepositRaw: claim.requiredGrossDepositRaw,
    targetPayout80Raw: claim.targetPayout80Raw,
  }, 200);
  const submitted = record.transitions.find((item) =>
    item.stage === "deposit_submitted");
  const canonical = [...record.transitions].reverse().find((item) =>
    item.stage === "deposit_confirmed" || item.stage === "deposit_finalized");
  const status = record.stage === "deposit_finalized" ? "deposit_finalized" :
    record.support ? "support_required" :
    record.stage === "signature_reserved" ? "support_required" : record.stage;
  return json({
    schema: LATE_MIGRATION_INTAKE_RESPONSE_SCHEMA_V1,
    status, walletAddress: claim.walletAddress, offerIndex: claim.offerIndex,
    requiredGrossDepositRaw: claim.requiredGrossDepositRaw,
    targetPayout80Raw: claim.targetPayout80Raw,
    requestBindingHash: record.intent.requestBindingHash,
    depositTransactionHash: canonical?.transactionHash ??
      submitted?.transactionHash ?? null,
  }, 200);
}

type IntakeRequest = Readonly<{ action: "prepare"; walletAddress: Address }> |
Readonly<{ action: "submit"; walletAddress: Address; permitNonce: bigint;
  permitDeadline: bigint; permitSignature: Hex;
  requestBindingHash: `sha256:${string}` }>;

function parseRequest(input: unknown): IntakeRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new LateMigrationIntakeErrorV1(400, "request_invalid");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.walletAddress !== "string" ||
    !isAddress(value.walletAddress, { strict: true })) {
    throw new LateMigrationIntakeErrorV1(400, "request_invalid");
  }
  const walletAddress = getAddress(value.walletAddress);
  if (value.action === "prepare") {
    exactKeys(value, ["action", "walletAddress"]);
    return Object.freeze({ action: "prepare" as const, walletAddress });
  }
  if (value.action !== "submit") {
    throw new LateMigrationIntakeErrorV1(400, "request_invalid");
  }
  exactKeys(value, ["action", "walletAddress", "permitNonce",
    "permitDeadline", "permitSignature", "requestBindingHash"]);
  if (typeof value.permitSignature !== "string" ||
    !/^0x[0-9a-f]{130}$/iu.test(value.permitSignature) ||
    typeof value.requestBindingHash !== "string" ||
    !DIGEST.test(value.requestBindingHash)) {
    throw new LateMigrationIntakeErrorV1(400, "request_invalid");
  }
  return Object.freeze({ action: "submit" as const, walletAddress,
    permitNonce: parseDecimal(value.permitNonce),
    permitDeadline: parsePositiveDecimal(value.permitDeadline),
    permitSignature: value.permitSignature.toLowerCase() as Hex,
    requestBindingHash: value.requestBindingHash as `sha256:${string}` });
}

function permitTypedDataJson(
  claim: LateMigrationEligibilityClaimV1,
  spender: Address,
  nonce: bigint,
  deadline: bigint,
) {
  const typedData = buildMainTokenMigrationPermitTypedData({
    owner: claim.walletAddress, spender,
    value: BigInt(claim.requiredGrossDepositRaw), nonce, deadline });
  return Object.freeze({ domain: typedData.domain,
    primaryType: typedData.primaryType, types: typedData.types,
    message: { owner: typedData.message.owner, spender: typedData.message.spender,
      value: typedData.message.value.toString(),
      nonce: typedData.message.nonce.toString(),
      deadline: typedData.message.deadline.toString() } });
}

function lookup(configuration: LateMigrationIntakeConfigurationV1,
  claim: LateMigrationEligibilityClaimV1) {
  return { releaseId: configuration.releaseId,
    sourceAddress: claim.walletAddress } as const;
}

function requireClaim(address: Address) {
  const claim = getLateMigrationEligibilityClaimV1(address);
  if (!claim) throw new LateMigrationIntakeErrorV1(422, "not_eligible");
  return claim;
}

function parseWalletQuery(request: Request) {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "walletAddress" ||
    !isAddress(entries[0][1], { strict: true })) {
    throw new LateMigrationIntakeErrorV1(400, "request_invalid");
  }
  return getAddress(entries[0][1]);
}

function assertLinkedWallet(wallets: readonly Address[], wallet: Address) {
  if (!wallets.some((candidate) =>
    candidate.toLowerCase() === wallet.toLowerCase())) {
    throw new LateMigrationIntakeErrorV1(403, "wallet_not_linked");
  }
}

function requireSameOrigin(request: Request) {
  let expected: string;
  try { expected = new URL(request.url).origin; } catch {
    throw new LateMigrationIntakeErrorV1(403, "origin_forbidden");
  }
  if (request.headers.get("origin") !== expected ||
    request.headers.get("sec-fetch-site") !== "same-origin") {
    throw new LateMigrationIntakeErrorV1(403, "origin_forbidden");
  }
}

async function boundedJson(request: Request) {
  const length = request.headers.get("content-length");
  if (length && (!/^[0-9]+$/u.test(length) ||
    Number(length) > MAXIMUM_BODY_BYTES)) {
    throw new LateMigrationIntakeErrorV1(413, "request_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new LateMigrationIntakeErrorV1(400, "request_invalid");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAXIMUM_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new LateMigrationIntakeErrorV1(413, "request_too_large");
    }
    chunks.push(part.value);
  }
  try {
    return parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, bytes)), { maximumBytes: MAXIMUM_BODY_BYTES,
      maximumDepth: 4 });
  } catch {
    throw new LateMigrationIntakeErrorV1(400, "request_invalid");
  }
}

function assertPermitWindow(deadline: bigint, now: Date, validitySeconds: number) {
  const current = BigInt(Math.floor(now.getTime() / 1_000));
  if (deadline < current || deadline > current + BigInt(validitySeconds)) {
    throw new LateMigrationIntakeErrorV1(422, "permit_deadline_invalid");
  }
}

function errorResponse(error: unknown) {
  const requestId = randomUUID();
  const failure = error instanceof WalletPrincipalAuthenticationErrorV1
    ? new LateMigrationIntakeErrorV1(error.status, error.code)
    : error instanceof LateMigrationIntakeStoreErrorV1
      ? new LateMigrationIntakeErrorV1(
        error.code === "conflict" ? 409 :
          error.code === "rate_limited" ? 429 : 503,
        error.code, error.retryAfterSeconds)
      : error instanceof LateMigrationIntakeErrorV1 ? error
        : new LateMigrationIntakeErrorV1(503, "intake_unavailable");
  if (failure.status >= 500) console.error("Late migration intake unavailable",
    { code: failure.code, requestId });
  const message = failure.status === 401 || failure.status === 403
    ? "Reconnect this wallet and try again."
    : failure.code === "deposit_already_recorded"
      ? "A deposit is already recorded for this wallet. Do not sign again. Contact support to recover its status."
    : failure.code === "insufficient_old_token_balance"
      ? "This wallet does not hold the full eligible amount of old V4."
    : failure.code === "not_eligible"
      ? "This wallet is not eligible for late migration."
      : failure.status === 409
        ? "This deposit request conflicts with its saved state."
        : failure.status === 422
          ? "The wallet signature is not valid for this deposit."
          : "Late migration is temporarily unavailable.";
  return json({ error: { code: failure.code, message, requestId } },
    failure.status, failure.status === 429
      ? { "retry-after": String(failure.retryAfterSeconds ?? 60) }
      : failure.status === 503 ? { "retry-after": "10" } : {});
}

function json(value: unknown, status: number,
  extraHeaders: Record<string, string> = {}) {
  return new Response(canonicalizeJson(value), { status, headers: {
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    "vary": "Authorization, X-Privy-Identity-Token",
    "x-content-type-options": "nosniff", ...extraHeaders } });
}

function policyCondition(fieldSource: "ethereum_transaction",
  field: EthereumTransactionCondition["field"], operator: ConditionOperator,
  value: string): Readonly<EthereumTransactionCondition>;
function policyCondition(fieldSource: "ethereum_calldata", field: string,
  operator: ConditionOperator, value: string,
  abi: AbiSchema): Readonly<EthereumCalldataCondition>;
function policyCondition(fieldSource: "ethereum_transaction" | "ethereum_calldata",
  field: string, operator: ConditionOperator, value: string, abi?: AbiSchema):
  Readonly<EthereumTransactionCondition | EthereumCalldataCondition> {
  if (fieldSource === "ethereum_calldata") {
    if (!abi) throw configurationError();
    return Object.freeze({ field_source: fieldSource, field, operator, value,
      abi: Object.freeze([...abi]) });
  }
  if (field !== "to" && field !== "value" && field !== "chain_id") {
    throw configurationError();
  }
  return Object.freeze({ field_source: fieldSource, field, operator, value });
}

function parseDecimal(value: unknown) {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new LateMigrationIntakeErrorV1(400, "request_invalid");
  }
  return BigInt(value);
}
function parsePositiveDecimal(value: unknown) {
  if (typeof value !== "string" || !POSITIVE_DECIMAL.test(value)) {
    throw new LateMigrationIntakeErrorV1(400, "request_invalid");
  }
  return BigInt(value);
}
function exactKeys(value: object, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length ||
    actual.some((key, index) => key !== sorted[index])) {
    throw new LateMigrationIntakeErrorV1(400, "request_invalid");
  }
}
function exactConfigKeys(value: object, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length ||
    actual.some((key, index) => key !== sorted[index])) configurationError();
}
function requiredAddress(value: unknown) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    configurationError();
  }
  return getAddress(value);
}
function requiredHash(value: unknown) {
  if (typeof value !== "string" || !HASH.test(value)) configurationError();
  return value as Hex;
}
function requiredDigest(value: unknown) {
  if (typeof value !== "string" || !DIGEST.test(value)) configurationError();
  return value as `sha256:${string}`;
}
function requiredPositiveInteger(value: unknown) {
  if (typeof value !== "string" || !POSITIVE_DECIMAL.test(value)) {
    configurationError();
  }
  return BigInt(value);
}
function requiredExternalId(value: unknown) {
  if (typeof value !== "string" || !SAFE_EXTERNAL_ID.test(value)) {
    configurationError();
  }
  return value;
}
function sameAddress(value: unknown, expected: Address) {
  return typeof value === "string" && isAddress(value, { strict: true }) &&
    getAddress(value) === expected;
}
function configurationError(): never {
  throw new LateMigrationIntakeErrorV1(503, "configuration_invalid");
}

export const lateMigrationIntakeActivationManifestV1 = activationManifest;
