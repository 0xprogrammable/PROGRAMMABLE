import "server-only";

import { randomUUID } from "node:crypto";

import { PrivyClient } from "@privy-io/node";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  recoverTypedDataAddress,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import activationManifest from "@/config/main-token-migration-activation.v1.json";
import {
  buildMainTokenMigrationPermitTypedData,
  isMainTokenMigrationWalletCodeEligible,
  MAIN_TOKEN_ADDRESS,
  MAIN_TOKEN_MIGRATION_CHAIN_ID,
  MAIN_TOKEN_MIGRATION_WALLET,
  MAIN_TOKEN_NAME,
  MAIN_TOKEN_PERMIT_DOMAIN_SEPARATOR,
  MAIN_TOKEN_RUNTIME_CODE_KECCAK256,
  MAIN_TOKEN_TOTAL_SUPPLY_RAW,
  parseMainTokenMigrationPermitSignature,
} from "@/lib/main-token-migration";
import { tradeActionRpcProviders } from "./action-rpc-quorum.server";
import {
  createPrivyWalletPrincipalAuthenticatorV1,
  WalletPrincipalAuthenticationErrorV1,
  type WalletPrincipalAuthenticatorV1,
} from "./creator-article/wallet-principal.server";
import {
  assertMainTokenMigrationPrivySponsorWalletV1,
  assertMainTokenMigrationPrivySponsorPolicyV2,
  deriveMainTokenMigrationSponsorBindingsV1,
  deriveMainTokenMigrationSponsorPrincipalBindingV1,
  MainTokenMigrationGasSponsorErrorV1,
  parsePrivySponsorTransactionLookupV1,
  readMainTokenMigrationGasSponsorConfigurationV1,
  type MainTokenMigrationGasSponsorConfigurationV1,
} from "./main-token-migration-gas-sponsor-v1";
import {
  getProductionMainTokenMigrationGasSponsorStoreV1,
  MainTokenMigrationGasSponsorStoreErrorV1,
  type MainTokenMigrationGasSponsorStoreV1,
} from "./main-token-migration-gas-sponsor-store-v1";
import {
  getProductionMainTokenMigrationGaslessStoreV1,
  MainTokenMigrationGaslessStoreErrorV1,
  type MainTokenMigrationGaslessIntentV1,
  type MainTokenMigrationGaslessRecordV1,
  type MainTokenMigrationGaslessStoreV1,
} from "./main-token-migration-gasless-transfer-store-v1";
import {
  canonicalizeJson,
  parseStrictJson,
} from "./projection-target/canonical-json";
import { canonicalSha256 } from "./projection-target/hashing";

const TOKEN_ABI = parseAbi([
  "function name() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function nonces(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function transferFrom(address from,address to,uint256 amount) returns (bool)",
]);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._~-]{15,127}$/u;
const DECIMAL = /^[1-9][0-9]{0,77}$/u;
const ZERO_DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAXIMUM_BODY_BYTES = 8_192;
const MAXIMUM_PROVIDER_RESPONSE_BYTES = 32_768;
const PROVIDER_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const PROVIDER_IDEMPOTENCY_SAFETY_MS = 5 * 60 * 1_000;
const PERMIT_VALIDITY_SECONDS = 20 * 60;
const DEADLINE_SAFETY_SECONDS = 5 * 60;
const GAS_MULTIPLIER_BPS = 12_500n;
const BPS = 10_000n;
const PERMIT_GAS_LIMIT = 100_000n;
const TRANSFER_GAS_LIMIT = 100_000n;
const MAXIMUM_FEE_PER_GAS_WEI = 20_000_000_000n;

type Environment = Readonly<Record<string, string | undefined>>;
type ProviderStatus = Readonly<{
  status: string;
  transactionHash: Hex | null;
}>;
type TransactionKind = "permit" | "transfer";

type PrepareRequest = Readonly<{
  action: "prepare" | "resume";
  walletAddress: Address;
  amountRaw: bigint;
}>;
type SubmitRequest = Readonly<{
  action: "submit";
  walletAddress: Address;
  amountRaw: bigint;
  nonce: bigint;
  permitDeadline: bigint;
  permitSignature: Hex;
  requestBindingHash: `sha256:${string}`;
}>;

export class MainTokenMigrationGaslessErrorV1 extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 409 | 413 | 422 | 429 | 503,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super("Main token migration gasless transfer failed closed");
    this.name = "MainTokenMigrationGaslessErrorV1";
  }
}

export function deriveMainTokenMigrationGaslessBindingV1(input: Readonly<{
  baseRequestBindingHash: `sha256:${string}`;
  nonce: bigint;
  permitDeadline: bigint;
}>) {
  return canonicalSha256("programmable.main-token-migration.gasless.v1", {
    baseRequestBindingHash: input.baseRequestBindingHash,
    nonce: input.nonce.toString(),
    permitDeadline: input.permitDeadline.toString(),
  });
}

export function createMainTokenMigrationGaslessTransferV1(input: Readonly<{
  configuration: MainTokenMigrationGasSponsorConfigurationV1;
  authenticator: WalletPrincipalAuthenticatorV1;
  admissionStore: MainTokenMigrationGasSponsorStoreV1;
  store: MainTokenMigrationGaslessStoreV1;
  chain: ReturnType<typeof createMainTokenMigrationGaslessChainV1>;
  sender: ReturnType<typeof createMainTokenMigrationGaslessSenderV1>;
  now?: () => Date;
}>) {
  const now = input.now ?? (() => new Date());
  return Object.freeze({
    async post(request: Request) {
      try {
        requireSameOrigin(request);
        const principal = await input.authenticator.authenticate(request);
        const parsed = parseRequest(await boundedJson(request));
        if (parsed.action !== "resume") assertWindowOpen(input.configuration, now());
        assertLinkedWallet(principal.wallets, parsed.walletAddress);
        const idempotencyKey = request.headers.get("idempotency-key") ?? "";
        if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
          throw new MainTokenMigrationGaslessErrorV1(
            400,
            "idempotency_key_invalid",
          );
        }
        const baseBindings = deriveMainTokenMigrationSponsorBindingsV1({
          releaseId: input.configuration.releaseId,
          walletAddress: parsed.walletAddress,
          amountRaw: parsed.amountRaw,
          idempotencyKey,
        });
        const admission = {
          releaseId: input.configuration.releaseId,
          principalBindingHash:
            deriveMainTokenMigrationSponsorPrincipalBindingV1(
              principal.privyUserId,
            ),
          walletAddress: parsed.walletAddress,
        };
        await input.admissionStore.admit({
          ...admission,
          operation: parsed.action === "prepare" ? "read" : "progress",
        });
        const lookup = {
          releaseId: input.configuration.releaseId,
          walletAddress: parsed.walletAddress,
        };
        const existing = await input.store.get(lookup);
        if (parsed.action === "prepare" || parsed.action === "resume") {
          if (existing) {
            const binding = deriveMainTokenMigrationGaslessBindingV1({
              baseRequestBindingHash: baseBindings.requestBindingHash,
              nonce: BigInt(existing.intent.nonce),
              permitDeadline: BigInt(existing.intent.permitDeadline),
            });
            if (binding !== existing.intent.requestBindingHash ||
              existing.intent.amountRaw !== parsed.amountRaw.toString()) {
              throw new MainTokenMigrationGaslessErrorV1(
                409,
                "idempotency_conflict",
              );
            }
            if (parsed.action === "resume") {
              const allowSend = windowOpen(input.configuration, now());
              if (allowSend) await input.sender.assertReady();
              return await progressTransfer({
                chain: input.chain,
                configuration: input.configuration,
                now: now(),
                record: existing,
                sender: input.sender,
                store: input.store,
                allowSend,
              });
            }
            return prepareResponse(existing.intent);
          }
          if (parsed.action === "resume") {
            throw new MainTokenMigrationGaslessErrorV1(
              409, "gasless_request_not_found",
            );
          }
          const observation = await input.chain.prepare({
            configuration: input.configuration,
            walletAddress: parsed.walletAddress,
            amountRaw: parsed.amountRaw,
          });
          const permitDeadline = BigInt(Math.min(
            Math.floor(now().getTime() / 1_000) + PERMIT_VALIDITY_SECONDS,
            input.configuration.deadlineTimestampExclusive -
              DEADLINE_SAFETY_SECONDS,
          ));
          const binding = deriveMainTokenMigrationGaslessBindingV1({
            baseRequestBindingHash: baseBindings.requestBindingHash,
            nonce: observation.nonce,
            permitDeadline,
          });
          return json({
            schema: "programmable-main-token-migration-gasless-transfer/v1",
            status: "signature_required",
            walletAddress: parsed.walletAddress,
            amountRaw: parsed.amountRaw.toString(),
            sponsorAddress: input.configuration.sponsorAddress,
            nonce: observation.nonce.toString(),
            permitDeadline: permitDeadline.toString(),
            requestBindingHash: binding,
            permitTransactionHash: null,
            transferTransactionHash: null,
            transferBlockNumber: null,
          }, 200);
        }

        const expectedBinding = deriveMainTokenMigrationGaslessBindingV1({
          baseRequestBindingHash: baseBindings.requestBindingHash,
          nonce: parsed.nonce,
          permitDeadline: parsed.permitDeadline,
        });
        if (parsed.requestBindingHash !== expectedBinding) {
          throw new MainTokenMigrationGaslessErrorV1(409, "idempotency_conflict");
        }
        const permit = parseMainTokenMigrationPermitSignature(
          parsed.permitSignature,
        );
        const recovered = await recoverTypedDataAddress({
          ...buildMainTokenMigrationPermitTypedData({
            owner: parsed.walletAddress,
            spender: input.configuration.sponsorAddress,
            value: parsed.amountRaw,
            nonce: parsed.nonce,
            deadline: parsed.permitDeadline,
          }),
          signature: permit.signature,
        });
        if (recovered.toLowerCase() !== parsed.walletAddress.toLowerCase()) {
          throw new MainTokenMigrationGaslessErrorV1(422, "signature_invalid");
        }

        let record = existing;
        if (!record) {
          // Only a new durable reservation consumes the new-transfer budget.
          // Identical signed retries still pass the bounded progress admission,
          // signature verification and immutable binding checks above/below.
          await input.admissionStore.admit({
            ...admission,
            operation: "submit",
          });
          const nowSeconds = Math.floor(now().getTime() / 1_000);
          if (parsed.permitDeadline <= BigInt(nowSeconds + 30) ||
            parsed.permitDeadline > BigInt(
              Math.min(
                nowSeconds + PERMIT_VALIDITY_SECONDS,
                input.configuration.deadlineTimestampExclusive -
                  DEADLINE_SAFETY_SECONDS,
              ),
            )) {
            throw new MainTokenMigrationGaslessErrorV1(422, "permit_expired");
          }
          const observation = await input.chain.prepare({
            configuration: input.configuration,
            walletAddress: parsed.walletAddress,
            amountRaw: parsed.amountRaw,
          });
          if (observation.nonce !== parsed.nonce) {
            throw new MainTokenMigrationGaslessErrorV1(409, "permit_nonce_changed");
          }
          const maxFeePerGasWei = divCeil(
            observation.feePerGasWei * GAS_MULTIPLIER_BPS,
            BPS,
          );
          if (maxFeePerGasWei <= 0n ||
            maxFeePerGasWei > MAXIMUM_FEE_PER_GAS_WEI ||
            observation.maxPriorityFeePerGasWei > maxFeePerGasWei) {
            throw new MainTokenMigrationGaslessErrorV1(503, "gas_quote_unavailable");
          }
          const reservedTotalWei =
            (PERMIT_GAS_LIMIT + TRANSFER_GAS_LIMIT) * maxFeePerGasWei;
          if (observation.sponsorBalanceWei < reservedTotalWei) {
            throw new MainTokenMigrationGaslessErrorV1(503, "sponsor_balance_low");
          }
          const providerBinding = expectedBinding.slice("sha256:".length);
          const intent: MainTokenMigrationGaslessIntentV1 = Object.freeze({
            schema: "programmable-main-token-migration-gasless-intent/v1",
            releaseId: input.configuration.releaseId,
            walletAddress: parsed.walletAddress,
            rootWalletAddress: observation.rootWalletAddress,
            sponsorAddress: input.configuration.sponsorAddress,
            amountRaw: parsed.amountRaw.toString(),
            nonce: parsed.nonce.toString(),
            permitDeadline: parsed.permitDeadline.toString(),
            permitSignature: permit.signature.toLowerCase() as Hex,
            permitGasLimit: PERMIT_GAS_LIMIT.toString(),
            transferGasLimit: TRANSFER_GAS_LIMIT.toString(),
            maxFeePerGasWei: maxFeePerGasWei.toString(),
            maxPriorityFeePerGasWei:
              observation.maxPriorityFeePerGasWei.toString(),
            reservedTotalWei: reservedTotalWei.toString(),
            totalBudgetWei: input.configuration.totalBudgetWei.toString(),
            requestBindingHash: expectedBinding,
            providerPermitIdempotencyKey:
              `mtmgp-${providerBinding.slice(0, 58)}`,
            providerPermitReferenceId:
              `mtmgp-${providerBinding.slice(0, 58)}`,
            providerTransferIdempotencyKey:
              `mtmgt-${providerBinding.slice(0, 58)}`,
            providerTransferReferenceId:
              `mtmgt-${providerBinding.slice(0, 58)}`,
            reservedAt: now().toISOString(),
          });
          // An unavailable sponsor must not consume the wallet's durable slot.
          await input.sender.assertReady();
          record = (await input.store.reserve({
            lookup,
            idempotencyBindingHash: baseBindings.idempotencyBindingHash,
            intent,
          })).record;
        } else if (record.intent.requestBindingHash !== expectedBinding ||
          record.intent.amountRaw !== parsed.amountRaw.toString() ||
          record.intent.nonce !== parsed.nonce.toString() ||
          record.intent.permitDeadline !== parsed.permitDeadline.toString()) {
          throw new MainTokenMigrationGaslessErrorV1(409, "idempotency_conflict");
        } else {
          await input.sender.assertReady();
        }
        return await progressTransfer({
          chain: input.chain,
          configuration: input.configuration,
          now: now(),
          record,
          sender: input.sender,
          store: input.store,
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
}

async function progressTransfer(input: Readonly<{
  chain: ReturnType<typeof createMainTokenMigrationGaslessChainV1>;
  configuration: MainTokenMigrationGasSponsorConfigurationV1;
  now: Date;
  record: MainTokenMigrationGaslessRecordV1;
  sender: ReturnType<typeof createMainTokenMigrationGaslessSenderV1>;
  store: MainTokenMigrationGaslessStoreV1;
  allowSend?: boolean;
}>) {
  let record = input.record;
  if (!record.permitTransactionHash) {
    const reconciled = await input.sender.lookup("permit", record.intent);
    const recoveredHash = providerHashOrNull(reconciled);
    if (!recoveredHash) {
      if (input.allowSend === false) {
        throw new MainTokenMigrationGaslessErrorV1(409, "relay_needs_attention");
      }
      if (BigInt(record.intent.permitDeadline) <=
        BigInt(Math.floor(input.now.getTime() / 1_000))) {
        throw new MainTokenMigrationGaslessErrorV1(422, "permit_expired");
      }
      assertProviderRetryWindow(record.intent, input.now);
    }
    const hash = recoveredHash ?? await input.sender.send("permit", record.intent);
    record = await input.store.complete({
      lookup: {
        releaseId: record.intent.releaseId,
        walletAddress: record.intent.walletAddress,
      },
      kind: "permit",
      providerReferenceId: record.intent.providerPermitReferenceId,
      transactionHash: hash,
    });
    return transferResponse("permit_submitted", record, 10);
  }
  const permitStatus = await input.chain.transactionStatus(
    "permit",
    record,
  );
  if (permitStatus === "failed") {
    throw new MainTokenMigrationGaslessErrorV1(409, "permit_reverted");
  }
  if (permitStatus === "pending") {
    assertProviderNotTerminal(await input.sender.lookup("permit", record.intent));
    return transferResponse("permit_pending", record, 10);
  }
  if (!record.transferTransactionHash) {
    const reconciled = await input.sender.lookup("transfer", record.intent);
    const recoveredHash = providerHashOrNull(reconciled);
    if (!recoveredHash) {
      if (input.allowSend === false) {
        throw new MainTokenMigrationGaslessErrorV1(409, "relay_needs_attention");
      }
      assertProviderRetryWindow(record.intent, input.now);
      // transferFrom consumes the exact allowance. A known transaction must
      // be reconciled by its receipt, not rejected for already using it.
      await input.chain.assertPermitEffect(record);
    }
    const hash = recoveredHash ?? await input.sender.send("transfer", record.intent);
    record = await input.store.complete({
      lookup: {
        releaseId: record.intent.releaseId,
        walletAddress: record.intent.walletAddress,
      },
      kind: "transfer",
      providerReferenceId: record.intent.providerTransferReferenceId,
      transactionHash: hash,
    });
    return transferResponse("transfer_submitted", record, 5);
  }
  const transferStatus = await input.chain.transactionStatus(
    "transfer",
    record,
  );
  if (transferStatus === "failed") {
    throw new MainTokenMigrationGaslessErrorV1(409, "transfer_reverted");
  }
  if (transferStatus === "pending") {
    assertProviderNotTerminal(await input.sender.lookup("transfer", record.intent));
  }
  return typeof transferStatus === "object"
    ? transferResponse(
        "confirmed",
        record,
        undefined,
        transferStatus.blockNumber.toString(),
      )
    : transferResponse("transfer_pending", record, 5);
}

function assertProviderNotTerminal(record: ProviderStatus | null) {
  if (record && ["replaced", "failed", "provider_error", "execution_reverted"]
    .includes(record.status)) {
    throw new MainTokenMigrationGaslessErrorV1(409, "relay_needs_attention");
  }
}

function providerHashOrNull(record: ProviderStatus | null) {
  if (record === null) return null;
  assertProviderNotTerminal(record);
  if (record.transactionHash) return record.transactionHash;
  throw new MainTokenMigrationGaslessErrorV1(503, "submission_unknown");
}

function assertProviderRetryWindow(
  intent: MainTokenMigrationGaslessIntentV1,
  now: Date,
) {
  const reservedAtMs = new Date(intent.reservedAt).getTime();
  const ageMs = now.getTime() - reservedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < 0 ||
    ageMs >= PROVIDER_IDEMPOTENCY_WINDOW_MS -
      PROVIDER_IDEMPOTENCY_SAFETY_MS) {
    throw new MainTokenMigrationGaslessErrorV1(503, "submission_unknown");
  }
}

export function createMainTokenMigrationGaslessChainV1(
  providers = tradeActionRpcProviders(1),
) {
  if (providers.length !== 2) {
    throw new TypeError("Gasless migration RPC quorum is invalid");
  }
  const clients: [PublicClient, PublicClient] = [
    createPublicClient({
      chain: mainnet,
      transport: http(providers[0]!.endpoint, { retryCount: 1, timeout: 12_000 }),
    }),
    createPublicClient({
      chain: mainnet,
      transport: http(providers[1]!.endpoint, { retryCount: 1, timeout: 12_000 }),
    }),
  ];
  return Object.freeze({
    async prepare(input: Readonly<{
      configuration: MainTokenMigrationGasSponsorConfigurationV1;
      walletAddress: Address;
      amountRaw: bigint;
    }>) {
      if (input.amountRaw <= 0n || input.amountRaw > MAIN_TOKEN_TOTAL_SUPPLY_RAW) {
        throw new MainTokenMigrationGaslessErrorV1(400, "request_invalid");
      }
      try {
        const heads = await Promise.all(clients.map((client) =>
          client.getBlockNumber()));
        const blockNumber = heads[0] < heads[1] ? heads[0] : heads[1];
        const states = await Promise.all(clients.map(async (client) => {
          const [chainId, block, code, tokenCode, sponsorCode, name,
            domainSeparator, nonce, balance, sponsorBalance, fees] =
            await Promise.all([
              client.getChainId(),
              client.getBlock({ blockNumber }),
              client.getCode({ address: input.walletAddress, blockNumber }),
              client.getCode({ address: MAIN_TOKEN_ADDRESS, blockNumber }),
              client.getCode({ address: input.configuration.sponsorAddress, blockNumber }),
              client.readContract({
                address: MAIN_TOKEN_ADDRESS,
                abi: TOKEN_ABI,
                functionName: "name",
                blockNumber,
              }),
              client.readContract({
                address: MAIN_TOKEN_ADDRESS,
                abi: TOKEN_ABI,
                functionName: "DOMAIN_SEPARATOR",
                blockNumber,
              }),
              client.readContract({
                address: MAIN_TOKEN_ADDRESS,
                abi: TOKEN_ABI,
                functionName: "nonces",
                args: [input.walletAddress],
                blockNumber,
              }),
              client.readContract({
                address: MAIN_TOKEN_ADDRESS,
                abi: TOKEN_ABI,
                functionName: "balanceOf",
                args: [input.walletAddress],
                blockNumber,
              }),
              client.getBalance({ address: input.configuration.sponsorAddress, blockNumber }),
              client.estimateFeesPerGas(),
            ]);
          return {
            chainId, block, code: code ?? "0x", tokenCode,
            sponsorCode: sponsorCode ?? "0x", name, domainSeparator,
            nonce, balance, sponsorBalance,
            fee: fees.maxFeePerGas,
            priorityFee: fees.maxPriorityFeePerGas,
          };
        }));
        const [left, right] = states;
        if (!left || !right || left.chainId !== MAIN_TOKEN_MIGRATION_CHAIN_ID ||
          right.chainId !== MAIN_TOKEN_MIGRATION_CHAIN_ID ||
          left.block.number !== blockNumber || right.block.number !== blockNumber ||
          !left.block.hash || left.block.hash !== right.block.hash ||
          left.block.timestamp !== right.block.timestamp || left.code !== right.code ||
          left.sponsorCode !== right.sponsorCode ||
          left.tokenCode !== right.tokenCode || left.name !== right.name ||
          left.domainSeparator !== right.domainSeparator || left.nonce !== right.nonce ||
          left.balance !== right.balance || left.sponsorBalance !== right.sponsorBalance ||
          !left.tokenCode || !right.tokenCode) {
          throw new MainTokenMigrationGaslessErrorV1(503, "rpc_quorum_unavailable");
        }
        if (keccak256(left.tokenCode) !== MAIN_TOKEN_RUNTIME_CODE_KECCAK256 ||
          left.name !== MAIN_TOKEN_NAME ||
          left.domainSeparator.toLowerCase() !==
            MAIN_TOKEN_PERMIT_DOMAIN_SEPARATOR.toLowerCase()) {
          throw new MainTokenMigrationGaslessErrorV1(503, "token_binding_mismatch");
        }
        if (left.sponsorCode !== "0x") {
          throw new MainTokenMigrationGaslessErrorV1(503, "sponsor_wallet_mismatch");
        }
        if (!isMainTokenMigrationWalletCodeEligible(left.code)) {
          throw new MainTokenMigrationGaslessErrorV1(422, "gasless_wallet_unsupported");
        }
        if (left.balance < input.amountRaw) {
          throw new MainTokenMigrationGaslessErrorV1(422, "insufficient_balance");
        }
        if (!left.fee || !right.fee || left.fee < 0n || right.fee < 0n ||
          left.priorityFee === undefined || right.priorityFee === undefined ||
          left.priorityFee < 0n || right.priorityFee < 0n) {
          throw new MainTokenMigrationGaslessErrorV1(503, "gas_quote_unavailable");
        }
        return Object.freeze({
          nonce: left.nonce,
          feePerGasWei: left.fee > right.fee ? left.fee : right.fee,
          maxPriorityFeePerGasWei: left.priorityFee > right.priorityFee
            ? left.priorityFee : right.priorityFee,
          sponsorBalanceWei: left.sponsorBalance,
          // Gasless support binds the current holder; the separate ETH faucet
          // retains its historical eligibility and relocation guards.
          rootWalletAddress: getAddress(input.walletAddress),
        });
      } catch (error) {
        if (error instanceof MainTokenMigrationGaslessErrorV1) throw error;
        throw new MainTokenMigrationGaslessErrorV1(503, "rpc_quorum_unavailable");
      }
    },

    async assertPermitEffect(record: MainTokenMigrationGaslessRecordV1) {
      const values = await Promise.all(clients.map((client) =>
        client.readContract({
          address: MAIN_TOKEN_ADDRESS,
          abi: TOKEN_ABI,
          functionName: "allowance",
          args: [record.intent.walletAddress, record.intent.sponsorAddress],
        })));
      if (values[0] !== values[1] || values[0] < BigInt(record.intent.amountRaw)) {
        throw new MainTokenMigrationGaslessErrorV1(503, "permit_effect_unavailable");
      }
    },

    async transactionStatus(
      kind: TransactionKind,
      record: MainTokenMigrationGaslessRecordV1,
    ) {
      const hash = kind === "permit"
        ? record.permitTransactionHash
        : record.transferTransactionHash;
      if (!hash) return "pending" as const;
      const expectedData = transactionData(kind, record.intent);
      const states = await Promise.all(clients.map(async (client) => {
        try {
          const [transaction, receipt] = await Promise.all([
            client.getTransaction({ hash }),
            client.getTransactionReceipt({ hash }),
          ]);
          const exact = transaction.hash === hash &&
            transaction.from.toLowerCase() ===
              record.intent.sponsorAddress.toLowerCase() &&
            transaction.to?.toLowerCase() === MAIN_TOKEN_ADDRESS.toLowerCase() &&
            transaction.value === 0n &&
            transaction.gas === BigInt(kind === "permit"
              ? record.intent.permitGasLimit
              : record.intent.transferGasLimit) &&
            transaction.maxFeePerGas ===
              BigInt(record.intent.maxFeePerGasWei) &&
            transaction.maxPriorityFeePerGas ===
              BigInt(record.intent.maxPriorityFeePerGasWei) &&
            transaction.input.toLowerCase() === expectedData.toLowerCase() &&
            receipt.transactionHash === hash;
          if (!exact || receipt.status !== "success") return "failed" as const;
          return {
            status: "confirmed" as const,
            blockHash: receipt.blockHash,
            blockNumber: receipt.blockNumber,
          };
        } catch {
          return "pending" as const;
        }
      }));
      if (states.some((state) => state === "failed")) return "failed" as const;
      const [left, right] = states;
      if (typeof left === "object" && typeof right === "object" &&
        left.blockHash === right.blockHash && left.blockNumber === right.blockNumber) {
        return {
          status: "confirmed" as const,
          blockNumber: left.blockNumber,
        };
      }
      return "pending" as const;
    },
  });
}

export function createMainTokenMigrationGaslessSenderV1(
  configuration: MainTokenMigrationGasSponsorConfigurationV1,
  environment: Environment,
) {
  const appId = requiredEnv(environment, "NEXT_PUBLIC_PRIVY_APP_ID");
  const appSecret = requiredEnv(environment, "PRIVY_APP_SECRET");
  const privy = new PrivyClient({ appId, appSecret });
  return Object.freeze({
    async assertReady() {
      const wallet = await privy.wallets().get(configuration.sponsorWalletId);
      assertMainTokenMigrationPrivySponsorWalletV1(wallet, configuration);
      const policy = await privy.policies().get(configuration.sponsorPolicyId);
      assertMainTokenMigrationPrivySponsorPolicyV2(policy, configuration);
    },
    async lookup(kind: TransactionKind, intent: MainTokenMigrationGaslessIntentV1) {
      const referenceId = kind === "permit"
        ? intent.providerPermitReferenceId
        : intent.providerTransferReferenceId;
      const url = new URL("https://api.privy.io/v1/transactions");
      url.searchParams.set("reference_id", referenceId);
      const authorization = Buffer.from(`${appId}:${appSecret}`, "utf8")
        .toString("base64");
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: `Basic ${authorization}`,
          "privy-app-id": appId,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new MainTokenMigrationGaslessErrorV1(503, "provider_unavailable");
      }
      const source = await response.text();
      if (Buffer.byteLength(source, "utf8") > MAXIMUM_PROVIDER_RESPONSE_BYTES) {
        throw new MainTokenMigrationGaslessErrorV1(503, "provider_response_invalid");
      }
      return parsePrivySponsorTransactionLookupV1(
        parseStrictJson(source, {
          maximumBytes: MAXIMUM_PROVIDER_RESPONSE_BYTES,
          maximumDepth: 8,
        }),
        { referenceId, sponsorWalletId: configuration.sponsorWalletId },
      ) as ProviderStatus | null;
    },
    async send(kind: TransactionKind, intent: MainTokenMigrationGaslessIntentV1) {
      assertSenderIntent(configuration, intent);
      const gasLimit = kind === "permit"
        ? BigInt(intent.permitGasLimit)
        : BigInt(intent.transferGasLimit);
      const idempotencyKey = kind === "permit"
        ? intent.providerPermitIdempotencyKey
        : intent.providerTransferIdempotencyKey;
      const referenceId = kind === "permit"
        ? intent.providerPermitReferenceId
        : intent.providerTransferReferenceId;
      const result = await privy.wallets().ethereum().sendTransaction(
        configuration.sponsorWalletId,
        {
          caip2: "eip155:1",
          params: {
            transaction: {
              chain_id: MAIN_TOKEN_MIGRATION_CHAIN_ID,
              data: transactionData(kind, intent),
              from: configuration.sponsorAddress,
              gas_limit: toHex(gasLimit),
              max_fee_per_gas: toHex(BigInt(intent.maxFeePerGasWei)),
              max_priority_fee_per_gas:
                toHex(BigInt(intent.maxPriorityFeePerGasWei)),
              to: MAIN_TOKEN_ADDRESS,
              type: 2,
              value: "0x0",
            },
          },
          idempotency_key: idempotencyKey,
          reference_id: referenceId,
        },
      );
      if (result.caip2 !== "eip155:1" || !HASH.test(result.hash) ||
        result.reference_id !== referenceId) {
        throw new MainTokenMigrationGaslessErrorV1(503, "provider_response_invalid");
      }
      return result.hash as Hex;
    },
  });
}

function transactionData(
  kind: TransactionKind,
  intent: MainTokenMigrationGaslessIntentV1,
) {
  if (kind === "transfer") {
    return encodeFunctionData({
      abi: TOKEN_ABI,
      functionName: "transferFrom",
      args: [
        intent.walletAddress,
        MAIN_TOKEN_MIGRATION_WALLET,
        BigInt(intent.amountRaw),
      ],
    });
  }
  const signature = parseMainTokenMigrationPermitSignature(
    intent.permitSignature,
  );
  return encodeFunctionData({
    abi: TOKEN_ABI,
    functionName: "permit",
    args: [
      intent.walletAddress,
      intent.sponsorAddress,
      BigInt(intent.amountRaw),
      BigInt(intent.permitDeadline),
      signature.v,
      signature.r,
      signature.s,
    ],
  });
}

function assertSenderIntent(
  configuration: MainTokenMigrationGasSponsorConfigurationV1,
  intent: MainTokenMigrationGaslessIntentV1,
) {
  if (intent.releaseId !== configuration.releaseId ||
    intent.sponsorAddress !== configuration.sponsorAddress ||
    BigInt(intent.permitGasLimit) !== PERMIT_GAS_LIMIT ||
    BigInt(intent.transferGasLimit) !== TRANSFER_GAS_LIMIT ||
    BigInt(intent.maxFeePerGasWei) > MAXIMUM_FEE_PER_GAS_WEI ||
    BigInt(intent.maxPriorityFeePerGasWei) > BigInt(intent.maxFeePerGasWei) ||
    BigInt(intent.reservedTotalWei) !==
      (PERMIT_GAS_LIMIT + TRANSFER_GAS_LIMIT) *
        BigInt(intent.maxFeePerGasWei)) {
    throw new MainTokenMigrationGaslessErrorV1(503, "intent_mismatch");
  }
}

function parseRequest(input: unknown): PrepareRequest | SubmitRequest {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    throw new MainTokenMigrationGaslessErrorV1(400, "request_invalid");
  }
  const value = input as Record<string, unknown>;
  const common = value.action === "prepare" || value.action === "resume"
    ? ["action", "amountRaw", "walletAddress"]
    : ["action", "amountRaw", "nonce", "permitDeadline", "permitSignature",
      "requestBindingHash", "walletAddress"];
  if (Object.keys(value).sort().join("\0") !== common.sort().join("\0") ||
    (value.action !== "prepare" && value.action !== "resume" &&
      value.action !== "submit") ||
    typeof value.walletAddress !== "string" ||
    !isAddress(value.walletAddress, { strict: true }) ||
    typeof value.amountRaw !== "string" || !DECIMAL.test(value.amountRaw)) {
    throw new MainTokenMigrationGaslessErrorV1(400, "request_invalid");
  }
  const amountRaw = BigInt(value.amountRaw);
  if (amountRaw <= 0n || amountRaw > MAIN_TOKEN_TOTAL_SUPPLY_RAW) {
    throw new MainTokenMigrationGaslessErrorV1(400, "request_invalid");
  }
  const walletAddress = getAddress(value.walletAddress);
  if (value.action === "prepare" || value.action === "resume") {
    return Object.freeze({ action: value.action, walletAddress, amountRaw });
  }
  if (typeof value.nonce !== "string" || !ZERO_DECIMAL.test(value.nonce) ||
    typeof value.permitDeadline !== "string" || !DECIMAL.test(value.permitDeadline) ||
    typeof value.permitSignature !== "string" ||
    !SIGNATURE.test(value.permitSignature) ||
    typeof value.requestBindingHash !== "string" ||
    !DIGEST.test(value.requestBindingHash)) {
    throw new MainTokenMigrationGaslessErrorV1(400, "request_invalid");
  }
  return Object.freeze({
    action: "submit",
    walletAddress,
    amountRaw,
    nonce: BigInt(value.nonce),
    permitDeadline: BigInt(value.permitDeadline),
    permitSignature: value.permitSignature.toLowerCase() as Hex,
    requestBindingHash: value.requestBindingHash as `sha256:${string}`,
  });
}

function prepareResponse(intent: MainTokenMigrationGaslessIntentV1) {
  return json({
    schema: "programmable-main-token-migration-gasless-transfer/v1",
    status: "signature_required",
    walletAddress: intent.walletAddress,
    amountRaw: intent.amountRaw,
    sponsorAddress: intent.sponsorAddress,
    nonce: intent.nonce,
    permitDeadline: intent.permitDeadline,
    requestBindingHash: intent.requestBindingHash,
    permitTransactionHash: null,
    transferTransactionHash: null,
    transferBlockNumber: null,
  }, 200);
}

function transferResponse(
  status: "permit_submitted" | "permit_pending" | "transfer_submitted" |
    "transfer_pending" | "confirmed",
  record: MainTokenMigrationGaslessRecordV1,
  retryAfterSeconds?: number,
  transferBlockNumber: string | null = null,
) {
  return json({
    schema: "programmable-main-token-migration-gasless-transfer/v1",
    status,
    walletAddress: record.intent.walletAddress,
    amountRaw: record.intent.amountRaw,
    sponsorAddress: record.intent.sponsorAddress,
    nonce: record.intent.nonce,
    permitDeadline: record.intent.permitDeadline,
    requestBindingHash: record.intent.requestBindingHash,
    permitTransactionHash: record.permitTransactionHash,
    transferTransactionHash: record.transferTransactionHash,
    transferBlockNumber,
  }, 200, retryAfterSeconds === undefined
    ? {}
    : { "retry-after": String(retryAfterSeconds) });
}

function errorResponse(error: unknown) {
  const requestId = randomUUID();
  const failure = error instanceof WalletPrincipalAuthenticationErrorV1
    ? new MainTokenMigrationGaslessErrorV1(error.status, error.code)
    : error instanceof MainTokenMigrationGasSponsorStoreErrorV1
      ? new MainTokenMigrationGaslessErrorV1(
          error.code === "conflict" ? 409 :
            error.code === "rate_limited" ? 429 : 503,
          error.code === "conflict" ? "idempotency_conflict" : error.code,
          error.retryAfterSeconds,
        )
      : error instanceof MainTokenMigrationGaslessStoreErrorV1
        ? new MainTokenMigrationGaslessErrorV1(
            error.code === "conflict" ? 409 : 503,
            error.code,
          )
        : error instanceof MainTokenMigrationGaslessErrorV1 ||
            error instanceof MainTokenMigrationGasSponsorErrorV1
          ? error
          : new MainTokenMigrationGaslessErrorV1(503, "gasless_unavailable");
  if (failure.status >= 500) {
    console.error("Main token migration gasless transfer unavailable", {
      code: failure.code,
      requestId,
    });
  } else if (failure.status === 429) {
    console.warn("Main token migration gasless transfer rate limited", {
      code: failure.code,
      requestId,
      retryAfterSeconds: failure.retryAfterSeconds ?? 60,
    });
  }
  const message = failure.status === 401 || failure.status === 403
    ? "Reconnect this wallet and try again."
    : failure.code === "relay_needs_attention" || failure.code === "permit_expired"
      ? "This gasless request needs migration support. Do not send V4 again; contact support with this request ID."
    : failure.code === "gasless_request_not_found"
      ? "No stored signed gasless request was found. Contact migration support before starting again."
    : failure.code === "insufficient_balance"
      ? "This wallet does not hold the requested V4 amount. Refresh your balance before starting a new transfer."
    : failure.code === "budget_exhausted"
      ? "The gas sponsorship budget is exhausted. No new gasless transfer can start."
    : failure.code === "sponsor_balance_low"
      ? "Gas sponsorship needs more ETH before a new transfer can start. Contact migration support."
    : failure.code === "permit_reverted" ||
        failure.code === "transfer_reverted"
      ? "The gasless relay reverted and cannot be retried automatically. Do not send again; contact migration support with this request ID."
    : failure.status === 409
      ? "This wallet already has a different migration request."
      : failure.status === 422
        ? "This wallet cannot use the gasless transfer path."
        : failure.status === 429
          ? "Migration checks are briefly paused. Wait before resuming this same request."
          : failure.code === "sponsorship_closed"
            ? "The migration window is closed."
            : "The gasless transfer is temporarily unavailable.";
  return json({ error: { code: failure.code, message, requestId } },
    failure.status, failure.status === 429
      ? { "retry-after": String(failure.retryAfterSeconds ?? 60) }
      : failure.status === 503
        ? { "retry-after": String(failure.retryAfterSeconds ?? 5) }
        : {});
}

function json(
  value: unknown,
  status: number,
  headers: Record<string, string> = {},
) {
  return new Response(canonicalizeJson(value), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function assertLinkedWallet(wallets: readonly `0x${string}`[], wallet: Address) {
  if (!wallets.some((candidate) =>
    candidate.toLowerCase() === wallet.toLowerCase())) {
    throw new MainTokenMigrationGaslessErrorV1(403, "wallet_not_linked");
  }
}

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  let expected: string;
  try {
    expected = new URL(request.url).origin;
  } catch {
    throw new MainTokenMigrationGaslessErrorV1(403, "origin_forbidden");
  }
  if (origin !== expected || request.headers.get("sec-fetch-site") !== "same-origin") {
    throw new MainTokenMigrationGaslessErrorV1(403, "origin_forbidden");
  }
}

async function boundedJson(request: Request) {
  const length = request.headers.get("content-length");
  if (length && (!/^[0-9]+$/u.test(length) ||
    Number(length) > MAXIMUM_BODY_BYTES)) {
    throw new MainTokenMigrationGaslessErrorV1(413, "request_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new MainTokenMigrationGaslessErrorV1(400, "request_invalid");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAXIMUM_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new MainTokenMigrationGaslessErrorV1(413, "request_too_large");
    }
    chunks.push(part.value);
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true })
      .decode(Buffer.concat(chunks, bytes));
  } catch {
    throw new MainTokenMigrationGaslessErrorV1(400, "request_invalid");
  }
  return parseStrictJson(source, {
    maximumBytes: MAXIMUM_BODY_BYTES,
    maximumDepth: 4,
  });
}

function assertWindowOpen(
  configuration: MainTokenMigrationGasSponsorConfigurationV1,
  now: Date,
) {
  if (!windowOpen(configuration, now)) {
    throw new MainTokenMigrationGaslessErrorV1(503, "sponsorship_closed");
  }
}

function windowOpen(
  configuration: MainTokenMigrationGasSponsorConfigurationV1,
  now: Date,
) {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  return Number.isFinite(nowSeconds) &&
    nowSeconds >= configuration.windowStartTimestamp &&
    nowSeconds < configuration.deadlineTimestampExclusive - DEADLINE_SAFETY_SECONDS;
}

function divCeil(value: bigint, denominator: bigint) {
  return (value + denominator - 1n) / denominator;
}

function requiredEnv(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new MainTokenMigrationGaslessErrorV1(503, "configuration_invalid");
  return value;
}

let productionHandler: ReturnType<
  typeof createMainTokenMigrationGaslessTransferV1
> | null = null;

export function getProductionMainTokenMigrationGaslessTransferV1() {
  if (productionHandler) return productionHandler;
  const configuration = readMainTokenMigrationGasSponsorConfigurationV1({
    environment: process.env,
    manifest: activationManifest,
    nowMs: Date.now(),
    allowClosedWindowReadback: true,
  });
  if (!configuration) {
    throw new MainTokenMigrationGaslessErrorV1(503, "sponsorship_disabled");
  }
  productionHandler = createMainTokenMigrationGaslessTransferV1({
    configuration,
    authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    admissionStore: getProductionMainTokenMigrationGasSponsorStoreV1(),
    store: getProductionMainTokenMigrationGaslessStoreV1(),
    chain: createMainTokenMigrationGaslessChainV1(),
    sender: createMainTokenMigrationGaslessSenderV1(configuration, process.env),
  });
  return productionHandler;
}

export async function handleProductionMainTokenMigrationGaslessTransferPostV1(
  request: Request,
) {
  try {
    return await getProductionMainTokenMigrationGaslessTransferV1().post(request);
  } catch (error) {
    return errorResponse(error);
  }
}
