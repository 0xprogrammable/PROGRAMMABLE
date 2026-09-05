import { createHash } from "node:crypto";
import {
  concatHex,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  isAddress,
  keccak256,
  numberToHex,
  parseAbi,
} from "viem";
import { readBoundedResponseText } from "../../scripts/read-bounded-response.mjs";

export const LATE_MIGRATION_PREFLIGHT_SCHEMA =
  "programmable-late-migration-intake-deployment-preflight/v1";
export const LATE_MIGRATION_HANDOFF_SCHEMA =
  "programmable-late-migration-intake-owner-handoff/v1";
export const EXPECTED = Object.freeze({
  roundId: "0xe18c667c5916bb9e8929d81a7769a25040da8964555b76d68dc62b7f7a07d179",
  eligibilityRoot:
    "0x2817f23e9af279fe00d478f47cee3d36393677af6ac9d00c6ae4a0f821b423a0",
  eligibleOfferCount: 1499,
  aggregateGrossAmountRaw: "176529129261873518239425341",
  aggregateManualPayoutAmountRaw: "141223303409498814591539678",
  manualPayoutBps: 8000,
  sourceArtifactSha256:
    "5e09163c764abbd2c29a63df990b3a9a99d8547d1a69840a8033d7d794d6ecb1",
  oldToken: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
  oldTokenRecipient: "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
  oldTokenRuntimeCodehash:
    "0x4fe466386aeebe507f6bcfc58e046a0632e4687699fa5bd28c4b7ec6333141ad",
  oldTokenDomainSeparator:
    "0xe2ac19a052ba41dccaaa930f489a94353d986c7769e416830273d9362ad26a47",
  manualPayoutToken: "0xC60bA256B44334A0Cd2C7242E98B88f031abB006",
  owner: "0x245099E77F8F0Cad9a75B1B56db8FDE7C948d5B1",
  totalSupplyRaw: "1000000000000000000000000000",
});
export const DEPLOYMENT_FIELDS = Object.freeze([
  "sourceContractAddress",
  "sourceContractRuntimeCodehash",
  "sourceDeploymentBlockNumber",
  "sourceDeploymentBlockHash",
  "activatedAtBlock",
  "relayerAddress",
  "relayerFundingBlockNumber",
  "relayerFundingBlockHash",
  "relayerFundingBalanceWei",
  "relayerPolicySha256",
  "maximumDepositGasLimit",
  "maximumFeePerGasWei",
  "totalRelayerBudgetWei",
  "relayerWalletOwnerId",
  "relayerPolicyOwnerId",
]);
export const TOKEN_ABI = parseAbi([
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const READ_ONLY_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
]);
const VALIDATED_RECEIPTS = new WeakMap();
export function fail(message) {
  throw new Error(`LATE_MIGRATION_INTAKE_DEPLOYMENT_INVALID: ${message}`);
}
export function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function commitment(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
export function hash(value, label) {
  if (typeof value !== "string" || !/^0x[\da-f]{64}$/iu.test(value))
    fail(`${label} must be bytes32`);
  return value.toLowerCase();
}
export function address(value, label) {
  if (typeof value !== "string" || !isAddress(value, { strict: true }))
    fail(`${label} must be a checksummed address`);
  return getAddress(value);
}
export function quantity(value, label) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][\da-f]*)$/iu.test(value))
    fail(`${label} must be a canonical RPC quantity`);
  return BigInt(value);
}
export function decimal(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][\d]*)$/u.test(value))
    fail(`${label} must be a raw decimal integer`);
  return BigInt(value);
}
export function hex(value, label) {
  if (typeof value !== "string" || !/^0x(?:[\da-f]{2})*$/iu.test(value))
    fail(`${label} must be hex bytes`);
  return value.toLowerCase();
}
export function equal(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected))
    fail(`${label} mismatch`);
}
export function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  equal(Object.keys(value).sort(), [...keys].sort(), `${label} keys`);
}
export function assertLateMigrationActivationIsInert(activation) {
  if (
    activation?.schema !== "programmable-late-migration-intake-activation/v1" ||
    activation.enabled !== false
  )
    fail("activation must be disabled intake v1");
  for (const key of DEPLOYMENT_FIELDS)
    if (activation[key] !== null)
      fail(`activation.${key} must be null before deployment`);
  return true;
}
export function verifyFrozenLateMigrationInputs({
  activation,
  eligibility,
  preflight,
}) {
  if (
    preflight?.schema !== LATE_MIGRATION_PREFLIGHT_SCHEMA ||
    preflight.state !== "predeployment-only" ||
    preflight.signingAllowed !== false ||
    preflight.broadcastAllowed !== false
  )
    fail("preflight must be read-only intake v1");
  exactKeys(
    preflight,
    [
      "schema",
      "state",
      "signingAllowed",
      "broadcastAllowed",
      "activationConfigPath",
      "eligibilityConfigPath",
      "sourceChain",
      "oldToken",
      "frozenRound",
      "ownerHandoff",
      "activationProviderPolicy",
    ],
    "preflight",
  );
  equal(
    preflight.activationConfigPath,
    "config/late-migration-intake-activation.v1.json",
    "activation path",
  );
  equal(
    preflight.eligibilityConfigPath,
    "config/late-migration-eligibility.v1.json",
    "eligibility path",
  );
  equal(preflight.sourceChain.chainId, 1, "source chain");
  equal(
    preflight.sourceChain.minimumIndependentProviders,
    2,
    "provider minimum",
  );
  equal(preflight.sourceChain.maximumHeadLagBlocks, 4, "head lag bound");
  equal(
    preflight.sourceChain.maximumFinalizedAnchorAgeSeconds,
    3600,
    "finality freshness",
  );
  equal(
    preflight.oldToken,
    {
      address: EXPECTED.oldToken,
      runtimeCodehash: EXPECTED.oldTokenRuntimeCodehash,
      domainSeparator: EXPECTED.oldTokenDomainSeparator,
      totalSupplyRaw: EXPECTED.totalSupplyRaw,
      decimals: 18,
    },
    "old token pins",
  );
  equal(
    preflight.ownerHandoff.activationAuthority,
    EXPECTED.owner,
    "activation authority",
  );
  equal(
    preflight.ownerHandoff.sourceArtifactPath,
    "contracts/out/ProgrammableLateMigrationIntakeV3.sol/ProgrammableLateMigrationIntakeV3.json",
    "V3 artifact",
  );
  hash(
    preflight.ownerHandoff.sourceCreationCodeKeccak256,
    "creation code commitment",
  );
  hash(preflight.ownerHandoff.sourceRuntimeCodehash, "runtime commitment");
  equal(preflight.ownerHandoff.validForSeconds, 300, "handoff freshness");
  equal(
    preflight.ownerHandoff.maximumDeploymentGas,
    "4000000",
    "deployment gas cap",
  );
  equal(
    preflight.ownerHandoff.maximumActivationGas,
    "200000",
    "activation gas cap",
  );
  equal(
    preflight.activationProviderPolicy,
    {
      minimumIndependentProviders: 2,
      maximumFinalizedAnchorAgeSeconds: 3600,
      requireAuthentication: true,
      requireEndpointCommitment: true,
      requireLiteralFinalizedTag: true,
      sourceProvidersJsonEnv:
        "LATE_MIGRATION_ETHEREUM_PRODUCTION_PROVIDERS_JSON",
    },
    "activation provider policy",
  );
  const frozen = Object.fromEntries(
    [
      "roundId",
      "eligibilityRoot",
      "eligibleOfferCount",
      "aggregateGrossAmountRaw",
      "aggregateManualPayoutAmountRaw",
      "manualPayoutBps",
    ].map((key) => [key, EXPECTED[key]]),
  );
  equal(preflight.frozenRound, frozen, "frozen round");
  if (
    activation?.schema !== "programmable-late-migration-intake-activation/v1" ||
    activation.enabled !== false
  )
    fail("local activation must stay disabled");
  for (const [key, value] of Object.entries(frozen))
    equal(activation[key], value, `activation.${key}`);
  for (const [key, value] of Object.entries({
    releaseId: "late-migration-80pct-e18c667c-intake-v1",
    sourceChainId: 1,
    oldTokenAddress: EXPECTED.oldToken,
    oldTokenRuntimeCodehash: EXPECTED.oldTokenRuntimeCodehash,
    oldTokenDomainSeparator: EXPECTED.oldTokenDomainSeparator,
    oldTokenRecipient: EXPECTED.oldTokenRecipient,
    manualPayoutChainId: 4663,
    manualPayoutTokenAddress: EXPECTED.manualPayoutToken,
    maximumPermitDeadlineLeadSeconds: 1200,
    permitValiditySeconds: 600,
  }))
    equal(activation[key], value, `activation.${key}`);
  if (
    eligibility?.schema !==
      "programmable-late-migration-eligibility-config/v1" ||
    eligibility.rows?.length !== EXPECTED.eligibleOfferCount
  )
    fail("eligibility schema or count mismatch");
  equal(
    eligibility.sourceArtifact,
    {
      schema: "programmable-v4-late-migration-source-proofs/v1",
      sha256: EXPECTED.sourceArtifactSha256,
      roundId: EXPECTED.roundId,
      merkleRoot: EXPECTED.eligibilityRoot,
      count: EXPECTED.eligibleOfferCount,
    },
    "source artifact",
  );
  let gross = 0n;
  let payout = 0n;
  const seen = new Set();
  const leaves = [];
  for (const [index, row] of eligibility.rows.entries()) {
    exactKeys(
      row,
      [
        "offerIndex",
        "requiredGrossDepositRaw",
        "sourceAddress",
        "targetPayout80Raw",
      ],
      "eligibility row",
    );
    equal(row.offerIndex, index, "contiguous offer index");
    const source = address(row.sourceAddress, "source");
    if (
      seen.has(source) ||
      source === "0x0000000000000000000000000000000000000000"
    )
      fail("duplicate or zero eligibility source");
    seen.add(source);
    const amount = decimal(row.requiredGrossDepositRaw, "gross");
    const expectedPayout = decimal(row.targetPayout80Raw, "manual payout");
    if (
      amount === 0n ||
      expectedPayout === 0n ||
      expectedPayout !== (amount * 8000n) / 10000n
    )
      fail("per-wallet 80% amount mismatch");
    gross += amount;
    payout += expectedPayout;
    leaves.push(
      keccak256(
        keccak256(
          encodeAbiParameters(
            [
              { type: "bytes32" },
              { type: "uint256" },
              { type: "address" },
              { type: "uint256" },
              { type: "uint256" },
            ],
            [EXPECTED.roundId, BigInt(index), source, amount, expectedPayout],
          ),
        ),
      ),
    );
  }
  const sorted = leaves.sort();
  const tree = new Array(sorted.length * 2 - 1);
  sorted.forEach((leaf, index) => {
    tree[tree.length - 1 - index] = leaf;
  });
  for (let index = tree.length - 1 - sorted.length; index >= 0; index--) {
    const pair = [tree[2 * index + 1], tree[2 * index + 2]].sort();
    tree[index] = keccak256(concatHex(pair));
  }
  equal(tree[0], EXPECTED.eligibilityRoot, "Merkle root");
  equal(gross.toString(), EXPECTED.aggregateGrossAmountRaw, "gross sum");
  equal(
    payout.toString(),
    EXPECTED.aggregateManualPayoutAmountRaw,
    "per-wallet payout sum",
  );
  equal(
    eligibility.aggregateGrossAmountRaw,
    gross.toString(),
    "eligibility gross summary",
  );
  equal(
    eligibility.aggregatePayoutAmountRaw,
    payout.toString(),
    "eligibility payout summary",
  );
  return freeze(frozen);
}
export function assertLateMigrationDeploymentAddressesSafe({
  eligibility,
  sourceAddress,
}) {
  const candidate = address(sourceAddress, "intake deployment address");
  if (
    [
      EXPECTED.oldToken,
      EXPECTED.oldTokenRecipient,
      EXPECTED.manualPayoutToken,
      EXPECTED.owner,
      "0x0000000000000000000000000000000000000000",
      ...eligibility.rows.map((row) => row.sourceAddress),
    ].includes(candidate)
  )
    fail(
      "intake deployment address collides with a fixed address or eligible source",
    );
  return true;
}
export function assertProviderSet(providers) {
  if (!Array.isArray(providers) || providers.length < 2 || providers.length > 4)
    fail("two to four independent source providers required");
  const ids = new Set();
  const domains = new Set();
  for (const provider of providers) {
    if (
      !provider ||
      typeof provider.request !== "function" ||
      typeof provider.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(provider.id) ||
      typeof provider.trustDomain !== "string" ||
      !/^[a-z0-9.-]+$/u.test(provider.trustDomain) ||
      ids.has(provider.id) ||
      domains.has(provider.trustDomain)
    )
      fail("providers must have independent ids and trust domains");
    ids.add(provider.id);
    domains.add(provider.trustDomain);
  }
}
function canonicalRpcObservation(method, value) {
  if (value === null) return null;
  const rpcAddress = (item) =>
    item === null ? null : address(item, "RPC address");
  const rpcQuantity = (item) => numberToHex(quantity(item, "RPC quantity"));
  const log = (item) => ({
    address: rpcAddress(item.address),
    blockHash: hash(item.blockHash, "log block hash"),
    blockNumber: rpcQuantity(item.blockNumber),
    transactionHash: hash(item.transactionHash, "log transaction hash"),
    transactionIndex: rpcQuantity(item.transactionIndex),
    logIndex: rpcQuantity(item.logIndex),
    data: hex(item.data, "log data"),
    topics: item.topics.map((topic) => hash(topic, "log topic")),
    removed: item.removed,
  });
  if (method === "eth_getBlockByNumber") {
    if (!Array.isArray(value.transactions))
      fail("canonical block transactions unavailable");
    return {
      number: rpcQuantity(value.number),
      hash: hash(value.hash, "block hash"),
      timestamp: rpcQuantity(value.timestamp),
      transactions: value.transactions.map((item) =>
        hash(item, "block transaction"),
      ),
    };
  }
  if (method === "eth_getTransactionByHash")
    return {
      hash: hash(value.hash, "transaction hash"),
      from: rpcAddress(value.from),
      to: rpcAddress(value.to),
      nonce: rpcQuantity(value.nonce),
      chainId: rpcQuantity(value.chainId),
      value: rpcQuantity(value.value),
      input: hex(value.input, "transaction input"),
      blockHash: hash(value.blockHash, "transaction block hash"),
      blockNumber: rpcQuantity(value.blockNumber),
      transactionIndex: rpcQuantity(value.transactionIndex),
    };
  if (method === "eth_getTransactionReceipt") {
    if (!Array.isArray(value.logs)) fail("receipt logs unavailable");
    return {
      transactionHash: hash(value.transactionHash, "receipt transaction hash"),
      from: rpcAddress(value.from),
      to: rpcAddress(value.to),
      contractAddress: rpcAddress(value.contractAddress),
      status: rpcQuantity(value.status),
      blockHash: hash(value.blockHash, "receipt block hash"),
      blockNumber: rpcQuantity(value.blockNumber),
      transactionIndex: rpcQuantity(value.transactionIndex),
      logs: value.logs.map(log),
    };
  }
  return typeof value === "string" && /^0x[\da-f]*$/iu.test(value)
    ? value.toLowerCase()
    : value;
}
export async function agreedRead(providers, method, params, label = method) {
  const values = await Promise.all(
    providers.map(async (provider) =>
      canonicalRpcObservation(method, await provider.request(method, params)),
    ),
  );
  values
    .slice(1)
    .forEach((value) =>
      equal(value, values[0], `independent provider agreement for ${label}`),
    );
  return values[0];
}
export async function sourceAnchor(
  providers,
  preflight,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  assertProviderSet(providers);
  const observations = await Promise.all(
    providers.map(async (provider) => {
      const chain = quantity(
        await provider.request("eth_chainId", []),
        "chainId",
      );
      if (chain !== 1n) fail("provider is not Ethereum");
      const head = quantity(
        await provider.request("eth_blockNumber", []),
        "head",
      );
      const finalized = await provider.request("eth_getBlockByNumber", [
        "finalized",
        false,
      ]);
      if (!finalized) fail("literal finalized block unavailable");
      const finalNumber = quantity(finalized.number, "finalized number");
      if (finalNumber > head) fail("finalized block ahead of head");
      const finalHash = hash(finalized.hash, "finalized hash");
      return { head, finalNumber, finalHash };
    }),
  );
  const heads = observations.map((item) => item.head);
  const finals = observations.map((item) => item.finalNumber);
  if (
    heads.reduce((a, b) => (a > b ? a : b)) -
      heads.reduce((a, b) => (a < b ? a : b)) >
    BigInt(preflight.sourceChain.maximumHeadLagBlocks)
  )
    fail("provider head lag exceeds bound");
  for (const observation of observations) {
    const canonicalFinal = await agreedRead(
      providers,
      "eth_getBlockByNumber",
      [numberToHex(observation.finalNumber), false],
      "literal finalized canonical binding",
    );
    equal(
      hash(canonicalFinal?.hash, "canonical finalized hash"),
      observation.finalHash,
      "literal finalized hash",
    );
    equal(
      quantity(canonicalFinal?.number, "canonical finalized height").toString(),
      observation.finalNumber.toString(),
      "literal finalized height",
    );
  }
  const blockNumber = finals.reduce((a, b) => (a < b ? a : b));
  const block = await agreedRead(
    providers,
    "eth_getBlockByNumber",
    [numberToHex(blockNumber), false],
    "canonical finalized anchor",
  );
  if (!block || quantity(block.number, "anchor number") !== blockNumber)
    fail("anchor number mismatch");
  const timestamp = quantity(block.timestamp, "anchor timestamp");
  if (
    timestamp > BigInt(nowSeconds + 30) ||
    BigInt(nowSeconds) - timestamp >
      BigInt(preflight.sourceChain.maximumFinalizedAnchorAgeSeconds)
  )
    fail("finalized anchor stale or from future");
  return freeze({
    blockNumber: blockNumber.toString(),
    blockHash: hash(block.hash, "anchor hash"),
    blockTimestamp: timestamp.toString(),
  });
}
export async function assertAnchorCanonical(providers, anchor) {
  const block = await agreedRead(
    providers,
    "eth_getBlockByNumber",
    [numberToHex(BigInt(anchor.blockNumber)), false],
    "anchor recheck",
  );
  equal(
    hash(block?.hash, "anchor recheck hash"),
    anchor.blockHash,
    "unchanged canonical anchor",
  );
  equal(
    quantity(block?.number, "anchor recheck number").toString(),
    anchor.blockNumber,
    "unchanged canonical height",
  );
  equal(
    quantity(block?.timestamp, "anchor recheck timestamp").toString(),
    anchor.blockTimestamp,
    "unchanged anchor timestamp",
  );
}
export async function contractRead(providers, target, abi, name, blockTag) {
  const result = await agreedRead(
    providers,
    "eth_call",
    [
      { to: target, data: encodeFunctionData({ abi, functionName: name }) },
      blockTag,
    ],
    name,
  );
  return decodeFunctionResult({
    abi,
    functionName: name,
    data: hex(result, name),
  });
}
export async function verifyOldToken(providers, anchor) {
  const tag = numberToHex(BigInt(anchor.blockNumber));
  const code = hex(
    await agreedRead(providers, "eth_getCode", [EXPECTED.oldToken, tag]),
    "old token code",
  );
  equal(keccak256(code), EXPECTED.oldTokenRuntimeCodehash, "old token runtime");
  equal(
    await contractRead(
      providers,
      EXPECTED.oldToken,
      TOKEN_ABI,
      "DOMAIN_SEPARATOR",
      tag,
    ),
    EXPECTED.oldTokenDomainSeparator,
    "native permit domain",
  );
  equal(
    await contractRead(
      providers,
      EXPECTED.oldToken,
      TOKEN_ABI,
      "decimals",
      tag,
    ),
    18,
    "token decimals",
  );
  equal(
    (
      await contractRead(
        providers,
        EXPECTED.oldToken,
        TOKEN_ABI,
        "totalSupply",
        tag,
      )
    ).toString(),
    EXPECTED.totalSupplyRaw,
    "total supply",
  );
}
export async function pendingOwnerNonce(providers) {
  const latest = quantity(
    await agreedRead(providers, "eth_getTransactionCount", [
      EXPECTED.owner,
      "latest",
    ]),
    "latest owner nonce",
  );
  const pending = quantity(
    await agreedRead(providers, "eth_getTransactionCount", [
      EXPECTED.owner,
      "pending",
    ]),
    "pending owner nonce",
  );
  if (latest !== pending)
    fail("owner has pending transactions; refresh after they settle");
  return pending;
}
export function sourceArtifactBytes(artifact, preflight) {
  const creationCode = hex(
    artifact?.bytecode?.object,
    "compiled creation code",
  );
  if (creationCode === "0x") fail("empty creation code");
  equal(
    keccak256(creationCode),
    preflight.ownerHandoff.sourceCreationCodeKeccak256,
    "compiled creation commitment",
  );
  let runtimeCode = hex(
    artifact?.deployedBytecode?.object,
    "compiled runtime code",
  );
  const references = Object.values(
    artifact?.deployedBytecode?.immutableReferences ?? {},
  );
  if (references.length !== 1 || references[0].length === 0)
    fail("exactly one oldToken immutable required");
  for (const entry of references[0]) {
    if (
      !Number.isSafeInteger(entry.start) ||
      entry.start < 0 ||
      entry.length !== 32 ||
      (entry.start + 32) * 2 > runtimeCode.length - 2
    )
      fail("invalid oldToken immutable reference");
    const replacement = EXPECTED.oldToken
      .slice(2)
      .toLowerCase()
      .padStart(64, "0");
    runtimeCode = `${runtimeCode.slice(0, 2 + entry.start * 2)}${replacement}${runtimeCode.slice(2 + (entry.start + 32) * 2)}`;
  }
  equal(
    keccak256(runtimeCode),
    preflight.ownerHandoff.sourceRuntimeCodehash,
    "compiled runtime commitment",
  );
  const constructor = encodeAbiParameters(
    [{ type: "address" }],
    [EXPECTED.owner],
  );
  return freeze({
    creationCode,
    runtimeCode,
    initcode: concatHex([creationCode, constructor]),
  });
}
export async function boundedEstimate(providers, tx, cap) {
  const estimates = await Promise.all(
    providers.map(async (provider) =>
      quantity(await provider.request("eth_estimateGas", [tx]), "gas estimate"),
    ),
  );
  const estimate = estimates.reduce((a, b) => (a > b ? a : b));
  const padded = (estimate * 120n + 99n) / 100n;
  if (estimate === 0n || padded > BigInt(cap))
    fail("gas estimate exceeds reviewed bound");
  return padded.toString();
}
export async function runLateMigrationDeploymentPreflight({
  activation,
  eligibility,
  preflight,
  sourceProviders,
  includePendingNonces = false,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  assertLateMigrationActivationIsInert(activation);
  const frozenRound = verifyFrozenLateMigrationInputs({
    activation,
    eligibility,
    preflight,
  });
  const anchor = await sourceAnchor(sourceProviders, preflight, nowSeconds);
  await verifyOldToken(sourceProviders, anchor);
  const nonce = includePendingNonces
    ? await pendingOwnerNonce(sourceProviders)
    : null;
  const sourceAddress =
    nonce === null ? null : getContractAddress({ from: EXPECTED.owner, nonce });
  if (sourceAddress !== null) {
    assertLateMigrationDeploymentAddressesSafe({ eligibility, sourceAddress });
    equal(
      hex(
        await agreedRead(sourceProviders, "eth_getCode", [
          sourceAddress,
          "latest",
        ]),
        "predicted address code",
      ),
      "0x",
      "empty predicted address",
    );
  }
  await assertAnchorCanonical(sourceProviders, anchor);
  const receipt = freeze({
    schema: LATE_MIGRATION_PREFLIGHT_SCHEMA,
    state: "checked-not-deployed",
    signingAllowed: false,
    broadcastAllowed: false,
    generatedAt: nowSeconds,
    inputCommitmentSha256: commitment({ activation, eligibility, preflight }),
    frozenRound,
    sourceAnchor: anchor,
    sourceNonce: nonce?.toString() ?? null,
    predictedSourceAddress: sourceAddress,
    sourceProviders: sourceProviders.map(({ id, trustDomain }) => ({
      id,
      trustDomain,
    })),
  });
  VALIDATED_RECEIPTS.set(receipt, sourceProviders);
  return receipt;
}
export async function prepareLateMigrationOwnerHandoff({
  activation,
  eligibility,
  artifacts,
  preflight,
  preflightReceipt,
  sourceProviders,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (VALIDATED_RECEIPTS.get(preflightReceipt) !== sourceProviders)
    fail("a fresh in-process verified preflight receipt is required");
  equal(
    preflightReceipt.inputCommitmentSha256,
    commitment({ activation, eligibility, preflight }),
    "unmodified preflight inputs",
  );
  if (
    nowSeconds < preflightReceipt.generatedAt ||
    nowSeconds - preflightReceipt.generatedAt > 300 ||
    preflightReceipt.sourceNonce === null
  )
    fail("nonce-bound preflight receipt is stale or missing");
  const artifact = sourceArtifactBytes(artifacts.source, preflight);
  equal(
    (await pendingOwnerNonce(sourceProviders)).toString(),
    preflightReceipt.sourceNonce,
    "owner nonce recheck",
  );
  const transaction = {
    chainId: 1,
    from: EXPECTED.owner,
    to: null,
    value: "0",
    nonce: preflightReceipt.sourceNonce,
    data: artifact.initcode,
  };
  const gasLimit = await boundedEstimate(
    sourceProviders,
    {
      from: transaction.from,
      data: transaction.data,
      value: "0x0",
      nonce: numberToHex(BigInt(transaction.nonce)),
    },
    preflight.ownerHandoff.maximumDeploymentGas,
  );
  await assertAnchorCanonical(sourceProviders, preflightReceipt.sourceAnchor);
  equal(
    (await pendingOwnerNonce(sourceProviders)).toString(),
    preflightReceipt.sourceNonce,
    "final owner nonce recheck",
  );
  return freeze({
    schema: LATE_MIGRATION_HANDOFF_SCHEMA,
    state: "prepared-not-signed-not-broadcast",
    stage: "source-deployment-only",
    signingAllowed: false,
    broadcastAllowed: false,
    generatedAt: nowSeconds,
    expiresAt: nowSeconds + 300,
    inputCommitmentSha256: preflightReceipt.inputCommitmentSha256,
    sourceAnchor: preflightReceipt.sourceAnchor,
    predictedSourceAddress: preflightReceipt.predictedSourceAddress,
    sourceRuntimeCodehash: preflight.ownerHandoff.sourceRuntimeCodehash,
    transactions: [
      {
        ...transaction,
        gasLimit,
        decoded: {
          contract: "ProgrammableLateMigrationIntakeV3",
          constructorArguments: { activationAuthority: EXPECTED.owner },
        },
      },
    ],
    nextStep:
      "Owner approval and wallet review, followed by finalized deployment verification. Deployment leaves deposits closed. One-time activation is a separate owner action.",
  });
}
export function createReadonlyJsonRpcProvider({
  fetchImpl = fetch,
  id,
  trustDomain,
  url,
  headers = {},
}) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(id))
    fail("provider id invalid");
  if (typeof trustDomain !== "string" || !/^[a-z0-9.-]+$/u.test(trustDomain))
    fail("provider trust domain invalid");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`provider ${id} URL invalid`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.hostname !== trustDomain &&
      !parsed.hostname.endsWith(`.${trustDomain}`))
  )
    fail(`provider ${id} HTTPS trust-domain binding invalid`);
  let counter = 0;
  return Object.freeze({
    id,
    trustDomain,
    async request(method, params) {
      if (!READ_ONLY_METHODS.has(method))
        fail(`RPC method ${method} is forbidden`);
      const requestId = ++counter;
      let response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          redirect: "error",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            method,
            params,
          }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        fail(`provider ${id} request failed`);
      }
      if (!response.ok) fail(`provider ${id} HTTP ${response.status}`);
      let body;
      try {
        body = JSON.parse(
          await readBoundedResponseText(response, {
            maximumBytes: 2000000,
            label: `provider ${id} response`,
          }),
        );
      } catch {
        fail(`provider ${id} invalid bounded JSON response`);
      }
      if (
        !body ||
        body.jsonrpc !== "2.0" ||
        body.id !== requestId ||
        "error" in body ||
        !("result" in body)
      )
        fail(`provider ${id} invalid RPC response`);
      return body.result;
    },
  });
}
export function providersFromConfig(chainConfig, env = process.env) {
  return chainConfig.providers.map((provider) =>
    createReadonlyJsonRpcProvider({
      id: provider.id,
      trustDomain: provider.trustDomain,
      url: env[provider.urlEnv] || provider.defaultPublicUrl,
    }),
  );
}
