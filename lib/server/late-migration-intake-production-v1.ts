import "server-only";

import { createPrivateKey, createPublicKey } from "node:crypto";
import { PrivyClient } from "@privy-io/node";
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  toHex,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import {
  getLateMigrationEligibilityClaimV1,
  type LateMigrationEligibilityClaimV1,
} from "@/lib/server/late-migration-eligibility-v1";
import {
  createPrivyWalletPrincipalAuthenticatorV1,
} from "./creator-article/wallet-principal.server";
import {
  mainTokenMigrationRpcProviders,
} from "./main-token-migration-rpc-quorum.server";
import {
  parsePrivySponsorTransactionLookupV1,
} from "./main-token-migration-gas-sponsor-v1";
import { canonicalizeJson, parseStrictJson } from
  "./projection-target/canonical-json";
import {
  buildLateMigrationIntakeTransactionV1,
  createLateMigrationIntakeV1,
  expectedLateMigrationIntakePolicySha256V1,
  lateMigrationIntakeActivationManifestV1,
  lateMigrationIntakePolicyV1,
  LateMigrationIntakeErrorV1,
  LATE_MIGRATION_INTAKE_ABI_V1,
  readLateMigrationIntakeConfigurationV1,
  type LateMigrationIntakeChainV1,
  type LateMigrationIntakeConfigurationV1,
  type LateMigrationIntakeProviderStatusV1,
  type LateMigrationIntakeSenderV1,
  type LateMigrationIntakeTransactionV1,
} from "./late-migration-intake-v1";
import {
  getProductionLateMigrationIntakeStoreV1,
  type LateMigrationIntakeRecordV1,
} from "./late-migration-intake-store-v1";

const OLD_TOKEN = getAddress(
  "0x7987f03462200b3D8A072E02C89A8A41dCB124EE");
const OLD_TOKEN_RECIPIENT = getAddress(
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E");
const TARGET_TOKEN = getAddress(
  "0xC60bA256B44334A0Cd2C7242E98B88f031abB006");
const ROUND_ID =
  "0xe18c667c5916bb9e8929d81a7769a25040da8964555b76d68dc62b7f7a07d179" as Hex;
const ELIGIBILITY_ROOT =
  "0x2817f23e9af279fe00d478f47cee3d36393677af6ac9d00c6ae4a0f821b423a0" as Hex;
const OLD_TOKEN_RUNTIME_CODEHASH =
  "0x4fe466386aeebe507f6bcfc58e046a0632e4687699fa5bd28c4b7ec6333141ad";
const OLD_TOKEN_DOMAIN_SEPARATOR =
  "0xe2ac19a052ba41dccaaa930f489a94353d986c7769e416830273d9362ad26a47";
const MAXIMUM_PROVIDER_RESPONSE_BYTES = 32_768;
const HASH = /^0x[0-9a-f]{64}$/u;

type Environment = Readonly<Record<string, string | undefined>>;
type ProviderPair = readonly [PublicClient, PublicClient];

const SOURCE_ABI = parseAbi([
  "function SOURCE_CHAIN_ID() view returns (uint256)",
  "function TARGET_CHAIN_ID() view returns (uint256)",
  "function ROUND_ID() view returns (bytes32)",
  "function ELIGIBILITY_ROOT() view returns (bytes32)",
  "function eligibilityRoot() view returns (bytes32)",
  "function OLD_TOKEN() view returns (address)",
  "function OLD_TOKEN_RECIPIENT() view returns (address)",
  "function TARGET_TOKEN() view returns (address)",
  "function depositsOpen() view returns (bool)",
  "function activatedAtBlock() view returns (uint256)",
  "function activationAuthority() view returns (address)",
  "function isOfferDeposited(uint256 offerIndex) view returns (bool)",
  "function consumedSource(address source) view returns (bool)",
  "function acceptedDepositId(uint256 offerIndex) view returns (bytes32)",
  "function depositedAtBlock(uint256 offerIndex) view returns (uint256)",
  "function depositIdFor((uint256 offerIndex,address source,uint256 grossAmount,uint256 payoutAmount) offer) pure returns (bytes32)",
  "function assertPinnedOldToken() view",
  "function depositWithPermit((uint256 offerIndex,address source,uint256 grossAmount,uint256 payoutAmount) offer,bytes32[] eligibilityProof,uint256 permitNonce,uint256 permitDeadline,uint8 v,bytes32 r,bytes32 s)",
]);
const TOKEN_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function nonces(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);
const DEPOSIT_EVENT = parseAbiItem(
  "event MigrationDepositAccepted(bytes32 indexed roundId,bytes32 indexed depositId,address indexed source,uint256 offerIndex,uint256 grossAmount,uint256 manualPayoutAmount,address oldTokenRecipient,uint256 targetChainId,address targetToken,address sponsor,uint256 permitNonce)",
);

type DepositEventArgs = Readonly<{
  roundId?: Hex;
  depositId?: Hex;
  source?: Address;
  offerIndex?: bigint;
  grossAmount?: bigint;
  manualPayoutAmount?: bigint;
  oldTokenRecipient?: Address;
  targetChainId?: bigint;
  targetToken?: Address;
  sponsor?: Address;
  permitNonce?: bigint;
}>;

export function createProductionLateMigrationIntakeChainV1(
  environment: Environment = process.env,
): LateMigrationIntakeChainV1 {
  return createLateMigrationIntakeChainFromClientsV1(
    ethereumProviderPair(environment));
}

export function createLateMigrationIntakeChainFromClientsV1(
  clients: ProviderPair,
): LateMigrationIntakeChainV1 {
  const chain: LateMigrationIntakeChainV1 = {
    async assertNoExistingDeposit({ configuration, claim }) {
      const finalized = await assertEthereumDeployment(configuration, clients, false);
      const head = await commonCanonicalHead(clients, finalized);
      const observations = await Promise.all(clients.map(async (client) => {
        const [offerDeposited, sourceConsumed, acceptedDepositId] = await Promise.all([
          client.readContract({ address: configuration.sourceContractAddress,
            abi: SOURCE_ABI, functionName: "isOfferDeposited",
            args: [BigInt(claim.offerIndex)], blockNumber: head }),
          client.readContract({ address: configuration.sourceContractAddress,
            abi: SOURCE_ABI, functionName: "consumedSource",
            args: [claim.walletAddress], blockNumber: head }),
          client.readContract({ address: configuration.sourceContractAddress,
            abi: SOURCE_ABI, functionName: "acceptedDepositId",
            args: [BigInt(claim.offerIndex)], blockNumber: head }),
        ]);
        return { offerDeposited, sourceConsumed, acceptedDepositId };
      }));
      if (canonicalizeJson(observations[0]) !== canonicalizeJson(observations[1])) {
        throw chainUnavailable("canonical_deposit_state_provider_mismatch");
      }
      assertUnconsumedOffer(observations[0], claim);
    },
    async assertSubmissionReady({ configuration, claim, permitNonce }) {
      const commonFinalized = await assertEthereumDeployment(configuration,
        clients, true);
      const commonHead = await commonCanonicalHead(clients, commonFinalized);
      const observations = await Promise.all(clients.map((client) =>
        observeSubmissionState(client, configuration, claim, commonHead)));
      if (canonicalizeJson(observations[0]) !==
        canonicalizeJson(observations[1])) {
        throw chainUnavailable("submission_provider_mismatch");
      }
      const observation = observations[0];
      assertUnconsumedOffer(observation, claim);
      if (!observation.depositsOpen ||
        BigInt(observation.activatedAtBlock) !== configuration.activatedAtBlock ||
        observation.activationAuthority !==
          "0x0000000000000000000000000000000000000000" ||
        observation.sourceChainId !== "1" ||
        observation.targetChainId !== "4663" ||
        observation.roundId !== ROUND_ID ||
        observation.eligibilityRoot !== ELIGIBILITY_ROOT ||
        observation.oldToken !== OLD_TOKEN ||
        observation.oldTokenRecipient !== OLD_TOKEN_RECIPIENT ||
        observation.targetToken !== TARGET_TOKEN ||
        observation.offerDeposited || observation.sourceConsumed ||
        observation.acceptedDepositId !== toHex(0n, { size: 32 }) ||
        observation.domainSeparator !== OLD_TOKEN_DOMAIN_SEPARATOR ||
        (permitNonce !== undefined && BigInt(observation.nonce) !== permitNonce &&
          !(BigInt(observation.nonce) === permitNonce + 1n &&
            observation.allowanceRaw === claim.requiredGrossDepositRaw))) {
        throw chainUnavailable("submission_state_mismatch");
      }
      if (BigInt(observation.balanceRaw) < BigInt(claim.requiredGrossDepositRaw)) {
        throw new LateMigrationIntakeErrorV1(422, "insufficient_old_token_balance");
      }
      return BigInt(observation.nonce);
    },
    async quotePriorityFeePerGas(configuration) {
      try {
        const head = await commonCanonicalHead(clients, 1n);
        const quotes = await Promise.all(clients.map(async (client) => {
          const [chainId, block, priorityHex] = await Promise.all([
            client.getChainId(), client.getBlock({ blockNumber: head }),
            // Use the native RPC quote directly. SDK estimators can silently
            // substitute a fallback, which is inappropriate for sponsored fees.
            client.request({ method: "eth_maxPriorityFeePerGas" }),
          ]);
          if (chainId !== 1 || block.number !== head || !block.hash ||
            typeof block.baseFeePerGas !== "bigint" || block.baseFeePerGas < 0n ||
            typeof priorityHex !== "string" || priorityHex.length > 66 ||
            !/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(priorityHex)) {
            throw chainUnavailable("priority_fee_quote_invalid");
          }
          return { blockHash: block.hash, baseFee: block.baseFeePerGas,
            priorityFee: BigInt(priorityHex) };
        }));
        if (quotes[0].blockHash !== quotes[1].blockHash ||
          quotes[0].baseFee !== quotes[1].baseFee) {
          throw chainUnavailable("priority_fee_quote_provider_mismatch");
        }
        const priority = quotes[0].priorityFee > quotes[1].priorityFee
          ? quotes[0].priorityFee : quotes[1].priorityFee;
        if (priority > configuration.maximumFeePerGasWei ||
          quotes[0].baseFee + priority > configuration.maximumFeePerGasWei) {
          throw chainUnavailable("deposit_fee_cap_too_low");
        }
        return priority;
      } catch (error) {
        if (error instanceof LateMigrationIntakeErrorV1) throw error;
        throw chainUnavailable("priority_fee_quote_unavailable");
      }
    },
    async assertTransactionReady(transaction) {
      const estimates = await Promise.all(clients.map((client) =>
        client.estimateGas({ account: transaction.from, to: transaction.to,
          data: transaction.data, value: transaction.value,
          maxFeePerGas: transaction.maxFeePerGasWei,
          maxPriorityFeePerGas: transaction.maxPriorityFeePerGasWei,
          blockTag: "pending" })));
      if (estimates.some((gas) => gas <= 0n || gas > transaction.gasLimit)) {
        throw chainUnavailable("deposit_simulation_gas_exceeds_limit");
      }
    },
    async observeCanonicalDeposit({ configuration, record }) {
      const commonFinalized = await assertEthereumDeployment(configuration,
        clients, false);
      const claim = requireClaim(record.intent.sourceAddress);
      const expectedDepositId = depositIdFor(claim);
      const states = await Promise.all(clients.map(async (client) => {
        const [deposited, consumed, acceptedDepositId, depositedAtBlock] =
          await Promise.all([
            client.readContract({ address: configuration.sourceContractAddress,
              abi: SOURCE_ABI, functionName: "isOfferDeposited",
              args: [BigInt(claim.offerIndex)], blockNumber: commonFinalized }),
            client.readContract({ address: configuration.sourceContractAddress,
              abi: SOURCE_ABI, functionName: "consumedSource",
              args: [claim.walletAddress], blockNumber: commonFinalized }),
            client.readContract({ address: configuration.sourceContractAddress,
              abi: SOURCE_ABI, functionName: "acceptedDepositId",
              args: [BigInt(claim.offerIndex)], blockNumber: commonFinalized }),
            client.readContract({ address: configuration.sourceContractAddress,
              abi: SOURCE_ABI, functionName: "depositedAtBlock",
              args: [BigInt(claim.offerIndex)], blockNumber: commonFinalized }),
          ]);
        return Object.freeze({ deposited, consumed, acceptedDepositId,
          depositedAtBlock: depositedAtBlock.toString() });
      }));
      if (canonicalizeJson(states[0]) !== canonicalizeJson(states[1])) {
        throw chainUnavailable("canonical_deposit_state_provider_mismatch");
      }
      const state = states[0];
      if (!state.deposited && !state.consumed &&
        state.acceptedDepositId === toHex(0n, { size: 32 }) &&
        state.depositedAtBlock === "0") {
        const confirmed = await observeSubmittedReceipt(clients,
          configuration, record, claim, expectedDepositId);
        return Object.freeze({ confirmed, finalized: null });
      }
      if (!state.deposited || !state.consumed ||
        state.acceptedDepositId !== expectedDepositId ||
        BigInt(state.depositedAtBlock) < configuration.activatedAtBlock ||
        BigInt(state.depositedAtBlock) > commonFinalized) {
        throw chainUnavailable("canonical_deposit_state_mismatch");
      }
      const confirmed = await observeDepositEventPair(clients, configuration,
        record, claim, expectedDepositId, BigInt(state.depositedAtBlock));
      return Object.freeze({ confirmed, finalized: Object.freeze({
        schema: "programmable-late-migration-intake-transition/v1" as const,
        stage: "deposit_finalized" as const,
        transactionHash: confirmed.transactionHash,
        blockNumber: confirmed.blockNumber,
        blockHash: confirmed.blockHash,
        depositId: confirmed.depositId,
        logIndex: confirmed.logIndex,
        finalizedBlockNumberA: commonFinalized.toString(),
        finalizedBlockNumberB: commonFinalized.toString(),
      }) });
    },
  };
  return Object.freeze(chain);
}

async function commonCanonicalHead(clients: ProviderPair, minimum: bigint) {
  const heads = await Promise.all(clients.map((client) =>
    client.getBlock({ blockTag: "latest" })));
  const common = heads[0].number < heads[1].number
    ? heads[0].number : heads[1].number;
  const blocks = await Promise.all(clients.map((client) =>
    client.getBlock({ blockNumber: common })));
  if (common < minimum || !blocks[0].hash || blocks[0].hash !== blocks[1].hash) {
    throw chainUnavailable("submission_head_provider_mismatch");
  }
  return common;
}

function assertUnconsumedOffer(state: Readonly<{ offerDeposited: boolean;
  sourceConsumed: boolean; acceptedDepositId: Hex }>,
claim: LateMigrationEligibilityClaimV1) {
  if (state.offerDeposited && state.sourceConsumed &&
    state.acceptedDepositId === depositIdFor(claim)) {
    // Without the original durable intent this is recovery evidence, not a
    // fabricated receipt/finality status. Never invite another holder signature.
    throw new LateMigrationIntakeErrorV1(409, "deposit_already_recorded");
  }
  if (state.offerDeposited || state.sourceConsumed ||
    state.acceptedDepositId !== toHex(0n, { size: 32 })) {
    throw chainUnavailable("canonical_deposit_state_mismatch");
  }
}

async function observeSubmissionState(
  client: PublicClient,
  configuration: LateMigrationIntakeConfigurationV1,
  claim: LateMigrationEligibilityClaimV1,
  blockNumber: bigint,
) {
  const [sourceChainId, targetChainId, roundId, eligibilityRoot, oldToken,
    oldTokenRecipient, targetToken, depositsOpen, activatedAtBlock,
    activationAuthority, offerDeposited, sourceConsumed, acceptedDepositId,
    balanceRaw, nonce, domainSeparator, allowanceRaw] = await Promise.all([
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "SOURCE_CHAIN_ID", blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "TARGET_CHAIN_ID", blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "ROUND_ID", blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "eligibilityRoot", blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "OLD_TOKEN", blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "OLD_TOKEN_RECIPIENT", blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "TARGET_TOKEN", blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "depositsOpen", blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "activatedAtBlock", blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "activationAuthority", blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "isOfferDeposited",
        args: [BigInt(claim.offerIndex)], blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "consumedSource",
        args: [claim.walletAddress], blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "acceptedDepositId",
        args: [BigInt(claim.offerIndex)], blockNumber }),
      client.readContract({ address: OLD_TOKEN, abi: TOKEN_ABI,
        functionName: "balanceOf", args: [claim.walletAddress], blockNumber }),
      client.readContract({ address: OLD_TOKEN, abi: TOKEN_ABI,
        functionName: "nonces", args: [claim.walletAddress], blockNumber }),
      client.readContract({ address: OLD_TOKEN, abi: TOKEN_ABI,
        functionName: "DOMAIN_SEPARATOR", blockNumber }),
      client.readContract({ address: OLD_TOKEN, abi: TOKEN_ABI,
        functionName: "allowance", args: [claim.walletAddress,
          configuration.sourceContractAddress], blockNumber }),
      client.readContract({ address: configuration.sourceContractAddress,
        abi: SOURCE_ABI, functionName: "assertPinnedOldToken", blockNumber }),
    ]);
  return Object.freeze({ sourceChainId: sourceChainId.toString(),
    targetChainId: targetChainId.toString(), roundId, eligibilityRoot,
    oldToken: getAddress(oldToken), oldTokenRecipient: getAddress(oldTokenRecipient),
    targetToken: getAddress(targetToken), depositsOpen,
    activatedAtBlock: activatedAtBlock.toString(),
    activationAuthority: getAddress(activationAuthority), offerDeposited,
    sourceConsumed, acceptedDepositId, balanceRaw: balanceRaw.toString(),
    nonce: nonce.toString(), domainSeparator,
    allowanceRaw: allowanceRaw.toString() });
}

async function assertEthereumDeployment(
  configuration: LateMigrationIntakeConfigurationV1,
  clients: ProviderPair,
  requireCurrentFunding: boolean,
) {
  const finalized = await Promise.all(clients.map((client) =>
    client.getBlock({ blockTag: "finalized" })));
  const common = finalized[0].number < finalized[1].number
    ? finalized[0].number : finalized[1].number;
  if (common < configuration.activatedAtBlock ||
    common < configuration.relayerFundingBlockNumber) {
    throw chainUnavailable("ethereum_finalized_tag_unavailable");
  }
  const observations = await Promise.all(clients.map(async (client) => {
    const [chainId, commonBlock, deploymentBlock, sourceCode, tokenCode,
      fundingBlock, fundingBalance, relayerFundingCode, currentRelayerBalance,
      currentRelayerCode] = await Promise.all([
        client.getChainId(), client.getBlock({ blockNumber: common }),
        client.getBlock({ blockNumber: configuration.sourceDeploymentBlockNumber }),
        client.getCode({ address: configuration.sourceContractAddress,
          blockNumber: common }),
        client.getCode({ address: OLD_TOKEN, blockNumber: common }),
        client.getBlock({ blockNumber: configuration.relayerFundingBlockNumber }),
        client.getBalance({ address: configuration.relayerAddress,
          blockNumber: configuration.relayerFundingBlockNumber }),
        client.getCode({ address: configuration.relayerAddress,
          blockNumber: configuration.relayerFundingBlockNumber }),
        client.getBalance({ address: configuration.relayerAddress,
          blockNumber: common }),
        client.getCode({ address: configuration.relayerAddress,
          blockNumber: common }),
      ]);
    return Object.freeze({ chainId, commonBlockHash: commonBlock.hash,
      deploymentBlockHash: deploymentBlock.hash,
      sourceCodehash: sourceCode ? keccak256(sourceCode) : null,
      tokenCodehash: tokenCode ? keccak256(tokenCode) : null,
      fundingBlockHash: fundingBlock.hash,
      fundingBalance: fundingBalance.toString(),
      relayerFundingCode: relayerFundingCode ?? null,
      currentRelayerBalance: currentRelayerBalance.toString(),
      currentRelayerCode: currentRelayerCode ?? null });
  }));
  if (canonicalizeJson(observations[0]) !== canonicalizeJson(observations[1])) {
    throw chainUnavailable("ethereum_provider_mismatch");
  }
  const observed = observations[0];
  if (observed.chainId !== 1 || !observed.commonBlockHash ||
    observed.deploymentBlockHash !== configuration.sourceDeploymentBlockHash ||
    observed.sourceCodehash !== configuration.sourceContractRuntimeCodehash ||
    observed.tokenCodehash !== OLD_TOKEN_RUNTIME_CODEHASH ||
    observed.fundingBlockHash !== configuration.relayerFundingBlockHash ||
    observed.fundingBalance !== configuration.relayerFundingBalanceWei.toString() ||
    BigInt(observed.fundingBalance) !== configuration.totalRelayerBudgetWei ||
    (requireCurrentFunding && BigInt(observed.currentRelayerBalance) >
      configuration.totalRelayerBudgetWei) ||
    (requireCurrentFunding && BigInt(observed.currentRelayerBalance) <
      configuration.maximumDepositGasLimit * configuration.maximumFeePerGasWei) ||
    (observed.relayerFundingCode !== null && observed.relayerFundingCode !== "0x") ||
    (observed.currentRelayerCode !== null && observed.currentRelayerCode !== "0x")) {
    throw chainUnavailable("ethereum_deployment_mismatch");
  }
  return common;
}

async function observeSubmittedReceipt(
  clients: ProviderPair,
  configuration: LateMigrationIntakeConfigurationV1,
  record: LateMigrationIntakeRecordV1,
  claim: LateMigrationEligibilityClaimV1,
  expectedDepositId: Hex,
) {
  const submitted = record.transitions.find((item) =>
    item.stage === "deposit_submitted");
  if (!submitted) return null;
  const observations = await Promise.all(clients.map(async (client) => {
    try {
      const receipt = await client.getTransactionReceipt({
        hash: submitted.transactionHash });
      if (receipt.status !== "success") return null;
      return validateDepositReceipt(client, configuration, record, claim,
        expectedDepositId, submitted.transactionHash, receipt);
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw chainUnavailable("ethereum_receipt_unavailable");
    }
  }));
  if (!observations[0] || !observations[1]) return null;
  if (canonicalizeJson(observations[0]) !== canonicalizeJson(observations[1])) {
    throw chainUnavailable("ethereum_receipt_provider_mismatch");
  }
  return observations[0];
}

async function observeDepositEventPair(
  clients: ProviderPair,
  configuration: LateMigrationIntakeConfigurationV1,
  record: LateMigrationIntakeRecordV1,
  claim: LateMigrationEligibilityClaimV1,
  expectedDepositId: Hex,
  blockNumber: bigint,
) {
  const observations = await Promise.all(clients.map(async (client) => {
    const logs = await client.getLogs({ address: configuration.sourceContractAddress,
      event: DEPOSIT_EVENT, args: { roundId: ROUND_ID,
        depositId: expectedDepositId, source: claim.walletAddress },
      fromBlock: blockNumber, toBlock: blockNumber, strict: true });
    if (logs.length !== 1 || !logs[0].transactionHash ||
      !logs[0].blockHash || !logs[0].blockNumber) {
      throw chainUnavailable("canonical_deposit_event_ambiguous");
    }
    const receipt = await client.getTransactionReceipt({
      hash: logs[0].transactionHash });
    return validateDepositReceipt(client, configuration, record, claim,
      expectedDepositId, logs[0].transactionHash, receipt);
  }));
  if (canonicalizeJson(observations[0]) !== canonicalizeJson(observations[1])) {
    throw chainUnavailable("canonical_deposit_provider_mismatch");
  }
  return observations[0];
}

async function validateDepositReceipt(
  client: PublicClient,
  configuration: LateMigrationIntakeConfigurationV1,
  record: LateMigrationIntakeRecordV1,
  claim: LateMigrationEligibilityClaimV1,
  expectedDepositId: Hex,
  transactionHash: Hex,
  receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>,
) {
  const [transaction, block] = await Promise.all([
    client.getTransaction({ hash: transactionHash }),
    client.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  const expected = buildLateMigrationIntakeTransactionV1(configuration,
    record, claim);
  const matching = receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== configuration.sourceContractAddress
      .toLowerCase()) return [];
    try {
      const decoded = decodeEventLog({ abi: [DEPOSIT_EVENT], data: log.data,
        topics: log.topics });
      return decoded.eventName === "MigrationDepositAccepted"
        ? [{ args: decoded.args as DepositEventArgs, log }] : [];
    } catch { return []; }
  });
  const event = matching[0]?.args;
  const log = matching[0]?.log;
  if (receipt.status !== "success" || receipt.transactionHash !== transactionHash ||
    receipt.blockHash !== transaction.blockHash ||
    receipt.blockNumber !== transaction.blockNumber ||
    block.hash !== receipt.blockHash ||
    transaction.to?.toLowerCase() !== expected.to.toLowerCase() ||
    transaction.input.toLowerCase() !== expected.data.toLowerCase() ||
    transaction.value !== 0n || matching.length !== 1 || !event || !log ||
    receipt.blockNumber < configuration.activatedAtBlock ||
    log.removed || log.blockNumber !== receipt.blockNumber ||
    log.blockHash !== receipt.blockHash ||
    log.transactionHash !== transactionHash ||
    !Number.isSafeInteger(log.logIndex) || log.logIndex === null ||
    log.logIndex < 0 ||
    event.roundId !== ROUND_ID || event.depositId !== expectedDepositId ||
    event.source?.toLowerCase() !== claim.walletAddress.toLowerCase() ||
    event.offerIndex !== BigInt(claim.offerIndex) ||
    event.grossAmount !== BigInt(claim.requiredGrossDepositRaw) ||
    event.manualPayoutAmount !== BigInt(claim.targetPayout80Raw) ||
    event.oldTokenRecipient?.toLowerCase() !== OLD_TOKEN_RECIPIENT.toLowerCase() ||
    event.targetChainId !== 4_663n ||
    event.targetToken?.toLowerCase() !== TARGET_TOKEN.toLowerCase() ||
    event.sponsor?.toLowerCase() !== transaction.from.toLowerCase() ||
    event.permitNonce !== BigInt(record.intent.permitNonce)) {
    throw chainUnavailable("deposit_receipt_mismatch");
  }
  return Object.freeze({
    schema: "programmable-late-migration-intake-transition/v1" as const,
    stage: "deposit_confirmed" as const,
    transactionHash, blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash, depositId: expectedDepositId,
    logIndex: log.logIndex,
  });
}

function depositIdFor(claim: LateMigrationEligibilityClaimV1) {
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "uint256" }, { type: "address" },
    { type: "uint256" }, { type: "address" }, { type: "uint256" },
    { type: "uint256" },
  ], [ROUND_ID, 1n, OLD_TOKEN, BigInt(claim.offerIndex), claim.walletAddress,
    BigInt(claim.requiredGrossDepositRaw), BigInt(claim.targetPayout80Raw)]));
}

export function createProductionLateMigrationIntakeSenderV1(
  configuration: LateMigrationIntakeConfigurationV1,
  environment: Environment = process.env,
): LateMigrationIntakeSenderV1 {
  const appId = requiredEnv(environment, "NEXT_PUBLIC_PRIVY_APP_ID");
  const appSecret = requiredEnv(environment, "PRIVY_APP_SECRET");
  const authorizationPrivateKey = requiredAuthorizationPrivateKey(environment,
    "PROGRAMMABLE_LATE_MIGRATION_PRIVY_TRANSACTION_AUTHORIZATION_PRIVATE_KEY");
  const transactionPublicKey = lateMigrationAuthorizationPublicKeyV1(
    authorizationPrivateKey);
  const ownerPublicKey = canonicalP256PublicKey(configuration.relayerOwnerPublicKey);
  if (transactionPublicKey === ownerPublicKey) {
    throw chainUnavailable("relayer_owner_not_isolated");
  }
  const privy = new PrivyClient({ appId, appSecret });
  const sender: LateMigrationIntakeSenderV1 = {
    async assertReady() {
      const [wallet, policy, transactionQuorum, walletOwner, policyOwner] =
        await Promise.all([
        privy.wallets().get(configuration.relayerWalletId),
        privy.policies().get(configuration.relayerPolicyId),
        privy.keyQuorums().get(configuration.relayerTransactionSignerId),
        privy.keyQuorums().get(configuration.relayerWalletOwnerId),
        privy.keyQuorums().get(configuration.relayerPolicyOwnerId),
      ]);
      assertLateMigrationIntakeRelayerWalletV1(wallet, configuration);
      assertLateMigrationIntakeRelayerPolicyV1(policy, configuration);
      assertLateMigrationIntakeQuorumV1(transactionQuorum,
        configuration.relayerTransactionSignerId, transactionPublicKey);
      assertLateMigrationIntakeQuorumV1(walletOwner,
        configuration.relayerWalletOwnerId, ownerPublicKey);
      assertLateMigrationIntakeQuorumV1(policyOwner,
        configuration.relayerPolicyOwnerId, ownerPublicKey);
    },
    async lookup(intent) {
      const url = new URL("https://api.privy.io/v1/transactions");
      url.searchParams.set("reference_id", intent.providerReferenceId);
      const response = await fetch(url, { method: "GET", cache: "no-store",
        headers: { accept: "application/json",
          authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`, "utf8")
            .toString("base64")}`, "privy-app-id": appId },
        signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw chainUnavailable("privy_lookup_unavailable");
      const source = await response.text();
      if (Buffer.byteLength(source, "utf8") > MAXIMUM_PROVIDER_RESPONSE_BYTES) {
        throw chainUnavailable("privy_response_invalid");
      }
      const parsed = parsePrivySponsorTransactionLookupV1(
        parseStrictJson(source, { maximumBytes: MAXIMUM_PROVIDER_RESPONSE_BYTES,
          maximumDepth: 8 }), { referenceId: intent.providerReferenceId,
          sponsorWalletId: configuration.relayerWalletId });
      if (!parsed) return null;
      const status: LateMigrationIntakeProviderStatusV1["status"] =
        parsed.status === "broadcasted" || parsed.status === "confirmed" ||
        parsed.status === "finalized" || parsed.status === "pending" ||
        parsed.status === "replaced" ? parsed.status : "failed";
      return Object.freeze({ status,
        transactionHash: parsed.transactionHash });
    },
    async send(transaction) {
      assertLateMigrationIntakeTransactionV1(configuration, transaction);
      const result = await privy.wallets().ethereum().sendTransaction(
        configuration.relayerWalletId, {
          caip2: "eip155:1",
          params: { transaction: { chain_id: 1, data: transaction.data,
            from: transaction.from, gas_limit: toHex(transaction.gasLimit),
            max_fee_per_gas: toHex(transaction.maxFeePerGasWei),
            max_priority_fee_per_gas:
              toHex(transaction.maxPriorityFeePerGasWei),
            to: transaction.to, type: 2, value: "0x0" } },
          idempotency_key: transaction.providerIdempotencyKey,
          reference_id: transaction.providerReferenceId,
          authorization_context: {
            authorization_private_keys: [authorizationPrivateKey],
          },
        });
      if (result.caip2 !== "eip155:1" || !HASH.test(result.hash) ||
        result.reference_id !== transaction.providerReferenceId) {
        throw chainUnavailable("privy_response_invalid");
      }
      return result.hash as Hex;
    },
  };
  return Object.freeze(sender);
}

export function assertLateMigrationIntakeTransactionV1(
  configuration: LateMigrationIntakeConfigurationV1,
  transaction: LateMigrationIntakeTransactionV1,
) {
  if (transaction.kind !== "deposit" || transaction.chainId !== 1 ||
    transaction.from !== configuration.relayerAddress ||
    transaction.to !== configuration.sourceContractAddress ||
    transaction.value !== 0n ||
    transaction.gasLimit !== configuration.maximumDepositGasLimit ||
    transaction.maxFeePerGasWei !== configuration.maximumFeePerGasWei ||
    transaction.maxPriorityFeePerGasWei > transaction.maxFeePerGasWei) {
    throw chainUnavailable("intake_transaction_mismatch");
  }
  try {
    const decoded = decodeFunctionData({ abi: LATE_MIGRATION_INTAKE_ABI_V1,
      data: transaction.data });
    if (decoded.functionName !== "depositWithPermit") throw new Error();
  } catch { throw chainUnavailable("intake_transaction_mismatch"); }
}

export function assertLateMigrationIntakeRelayerWalletV1(
  wallet: unknown,
  configuration: LateMigrationIntakeConfigurationV1,
) {
  if (!wallet || typeof wallet !== "object" || Array.isArray(wallet)) {
    throw chainUnavailable("relayer_wallet_mismatch");
  }
  const value = wallet as Record<string, unknown>;
  const policyIds = Array.isArray(value.policy_ids) &&
    value.policy_ids.every((item) => typeof item === "string")
      ? value.policy_ids : [];
  const expectedAdditionalSigners = [{
    signer_id: configuration.relayerTransactionSignerId,
    override_policy_ids: [configuration.relayerPolicyId],
  }];
  if (value.id !== configuration.relayerWalletId ||
    value.chain_type !== "ethereum" || typeof value.address !== "string" ||
    !isAddress(value.address, { strict: true }) ||
    getAddress(value.address) !== configuration.relayerAddress ||
    value.owner_id !== configuration.relayerWalletOwnerId ||
    value.owner_id === configuration.relayerTransactionSignerId ||
    value.imported_at !== null || value.exported_at !== null ||
    policyIds.length !== 1 || policyIds[0] !== configuration.relayerPolicyId ||
    canonicalizeJson(value.additional_signers) !==
      canonicalizeJson(expectedAdditionalSigners)) {
    throw chainUnavailable("relayer_wallet_mismatch");
  }
}

export function assertLateMigrationIntakeRelayerPolicyV1(
  policy: unknown,
  configuration: LateMigrationIntakeConfigurationV1,
) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw chainUnavailable("relayer_policy_mismatch");
  }
  const value = policy as Record<string, unknown>;
  const expected = lateMigrationIntakePolicyV1(configuration);
  if (value.id !== configuration.relayerPolicyId ||
    value.owner_id !== configuration.relayerPolicyOwnerId ||
    value.owner_id === configuration.relayerTransactionSignerId ||
    value.chain_type !== expected.chainType || value.name !== expected.name ||
    value.version !== expected.version || !Array.isArray(value.rules)) {
    throw chainUnavailable("relayer_policy_mismatch");
  }
  const rules = value.rules.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw chainUnavailable("relayer_policy_mismatch");
    }
    const rule = candidate as Record<string, unknown>;
    // Privy adds a rule ID on readback. It is the only response-only field;
    // retain every execution condition verbatim in the policy commitment.
    const keys = Object.keys(rule).sort();
    if (typeof rule.id !== "string" ||
      !/^[A-Za-z0-9_-]{8,256}$/u.test(rule.id) ||
      canonicalizeJson(keys) !== canonicalizeJson([
        "action", "conditions", "id", "method", "name",
      ]) || !Array.isArray(rule.conditions)) {
      throw chainUnavailable("relayer_policy_mismatch");
    }
    return { name: rule.name, action: rule.action, method: rule.method,
      conditions: rule.conditions };
  });
  if (canonicalizeJson(rules) !== canonicalizeJson(expected.rules) ||
    expectedLateMigrationIntakePolicySha256V1(configuration) !==
      configuration.relayerPolicySha256) {
    throw chainUnavailable("relayer_policy_mismatch");
  }
}

// Resource IDs alone do not establish authority isolation: different quorums
// may contain the same key. Pin actual P-256 membership and reject extra users,
// nested quorums, or threshold changes before asking a holder to sign.
export function assertLateMigrationIntakeQuorumV1(
  input: unknown, expectedId: string, expectedPublicKey: string,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw chainUnavailable("relayer_quorum_mismatch");
  }
  const quorum = input as Record<string, unknown>;
  const members = quorum.authorization_keys;
  if (quorum.id !== expectedId || quorum.authorization_threshold !== 1 ||
    !Array.isArray(members) || members.length !== 1 ||
    (quorum.user_ids !== null &&
      (!Array.isArray(quorum.user_ids) || quorum.user_ids.length !== 0)) ||
    (quorum.key_quorum_ids !== undefined &&
      (!Array.isArray(quorum.key_quorum_ids) ||
        quorum.key_quorum_ids.length !== 0)) ||
    !members[0] || typeof members[0] !== "object" ||
    canonicalP256PublicKey(members[0].public_key) !==
      canonicalP256PublicKey(expectedPublicKey)) {
    throw chainUnavailable("relayer_quorum_mismatch");
  }
}

export function lateMigrationAuthorizationPublicKeyV1(privateKey: string) {
  try {
    const key = createPrivateKey({ key: Buffer.from(privateKey, "base64"),
      type: "pkcs8", format: "der" });
    if (key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error();
    return createPublicKey(key.export({ type: "pkcs8", format: "pem" }))
      .export({ type: "spki", format: "der" })
      .toString("base64");
  } catch { throw chainUnavailable("authorization_key_invalid"); }
}

function canonicalP256PublicKey(value: unknown) {
  try {
    if (typeof value !== "string" || value.length > 512 ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw new Error();
    const key = createPublicKey({ key: Buffer.from(value, "base64"),
      type: "spki", format: "der" });
    if (key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error();
    const canonical = key.export({ type: "spki", format: "der" }).toString("base64");
    if (canonical !== value) throw new Error();
    return canonical;
  } catch { throw chainUnavailable("authorization_public_key_invalid"); }
}

function ethereumProviderPair(environment: Environment): ProviderPair {
  const providers = mainTokenMigrationRpcProviders(environment);
  if (providers.length !== 2) throw chainUnavailable("ethereum_quorum_invalid");
  return Object.freeze([
    createPublicClient({ chain: mainnet,
      transport: http(providers[0]!.endpoint, { retryCount: 1,
        timeout: 12_000 }) }),
    createPublicClient({ chain: mainnet,
      transport: http(providers[1]!.endpoint, { retryCount: 1,
        timeout: 12_000 }) }),
  ]);
}

function requireClaim(address: Address) {
  const claim = getLateMigrationEligibilityClaimV1(address);
  if (!claim) throw chainUnavailable("claim_missing");
  return claim;
}

function requiredEnv(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw chainUnavailable("configuration_invalid");
  return value;
}

function requiredAuthorizationPrivateKey(environment: Environment,
  name: string) {
  const value = requiredEnv(environment, name);
  if (value.length < 64 || value.length > 512 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw chainUnavailable("configuration_invalid");
  }
  return value;
}

function chainUnavailable(code: string) {
  return new LateMigrationIntakeErrorV1(503, code);
}

let productionConfiguration: LateMigrationIntakeConfigurationV1 | null = null;
let productionHandler: ReturnType<typeof createLateMigrationIntakeV1> | null =
  null;

function getProductionConfiguration() {
  if (productionConfiguration) return productionConfiguration;
  const configuration = readLateMigrationIntakeConfigurationV1({
    environment: process.env, manifest: lateMigrationIntakeActivationManifestV1,
  });
  if (!configuration) {
    throw new LateMigrationIntakeErrorV1(503, "intake_disabled");
  }
  productionConfiguration = configuration;
  return configuration;
}

export function getProductionLateMigrationIntakeV1() {
  if (productionHandler) return productionHandler;
  const configuration = getProductionConfiguration();
  productionHandler = createLateMigrationIntakeV1({ configuration,
    authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    store: getProductionLateMigrationIntakeStoreV1(),
    chain: createProductionLateMigrationIntakeChainV1(),
    sender: createProductionLateMigrationIntakeSenderV1(configuration) });
  return productionHandler;
}

export async function handleProductionLateMigrationIntakeGetV1(
  request: Request,
) {
  try { return await getProductionLateMigrationIntakeV1().get(request); }
  catch { return disabledResponse(); }
}

export async function handleProductionLateMigrationIntakePostV1(
  request: Request,
) {
  try { return await getProductionLateMigrationIntakeV1().post(request); }
  catch { return disabledResponse(); }
}

function disabledResponse() {
  return new Response(canonicalizeJson({ error: { code: "intake_unavailable",
    message: "Late migration is temporarily unavailable." } }), {
    status: 503, headers: { "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8", "retry-after": "10",
      "x-content-type-options": "nosniff" } });
}
