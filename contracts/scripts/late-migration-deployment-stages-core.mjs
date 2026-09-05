import { createHash } from "node:crypto";
import {
  decodeEventLog,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  numberToHex,
  parseAbi,
  parseAbiItem,
} from "viem";
import {
  EXPECTED,
  address,
  agreedRead,
  assertAnchorCanonical,
  assertLateMigrationDeploymentAddressesSafe,
  assertProviderSet,
  boundedEstimate,
  canonicalJson,
  commitment,
  contractRead,
  createReadonlyJsonRpcProvider,
  equal,
  exactKeys,
  fail,
  freeze,
  hash,
  hex,
  pendingOwnerNonce,
  providersFromConfig,
  quantity,
  sourceAnchor,
  sourceArtifactBytes,
  verifyFrozenLateMigrationInputs,
  verifyOldToken,
} from "./late-migration-deployment-preflight-core.mjs";

export const LATE_MIGRATION_STAGE_JOURNAL_SCHEMA =
  "programmable-late-migration-intake-deployment-journal/v1";
export const LATE_MIGRATION_STAGE_HANDOFF_SCHEMA =
  "programmable-late-migration-intake-stage-handoff/v1";
export const LATE_MIGRATION_STAGE_VERIFICATION_SCHEMA =
  "programmable-late-migration-intake-stage-verification/v1";
export const SOURCE_ABI = parseAbi([
  "function oldToken() view returns (address)",
  "function activationAuthority() view returns (address)",
  "function depositsOpen() view returns (bool)",
  "function activatedAtBlock() view returns (uint256)",
  "function depositedOfferCount() view returns (uint256)",
  "function depositedGrossTotal() view returns (uint256)",
  "function depositedPayoutTotal() view returns (uint256)",
  "function ROUND_ID() view returns (bytes32)",
  "function eligibilityRoot() view returns (bytes32)",
  "function OLD_TOKEN_RECIPIENT() view returns (address)",
  "function TARGET_CHAIN_ID() view returns (uint256)",
  "function TARGET_TOKEN() view returns (address)",
  "function PAYOUT_BPS() view returns (uint256)",
  "function assertPinnedOldToken() view",
  "function activateDeposits()",
]);
const ACTIVATED_EVENT = parseAbiItem(
  "event DepositsActivated(bytes32 indexed roundId,address indexed previousAuthority,uint256 activatedAtBlock)",
);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const VERIFIED_CONTEXTS = new WeakMap();
const PRODUCTION_PROVIDERS = new WeakSet();

function journal(transactions) {
  return freeze({
    schema: LATE_MIGRATION_STAGE_JOURNAL_SCHEMA,
    state: "untrusted-transaction-pointers-reverified-on-every-use",
    signingAllowed: false,
    broadcastAllowed: false,
    transactions: { ...transactions },
  });
}
export function createLateMigrationStageJournal(
  sourceDeploymentTransactionHash,
) {
  return journal({
    sourceDeployment: hash(
      sourceDeploymentTransactionHash,
      "deployment transaction hash",
    ),
    depositActivation: null,
  });
}
export function unwrapLateMigrationStageJournal(value) {
  const candidate = value?.journal ?? value;
  exactKeys(
    candidate,
    ["schema", "state", "signingAllowed", "broadcastAllowed", "transactions"],
    "journal",
  );
  if (
    candidate.schema !== LATE_MIGRATION_STAGE_JOURNAL_SCHEMA ||
    candidate.state !==
      "untrusted-transaction-pointers-reverified-on-every-use" ||
    candidate.signingAllowed !== false ||
    candidate.broadcastAllowed !== false
  )
    fail("journal schema or read-only state mismatch");
  exactKeys(
    candidate.transactions,
    ["sourceDeployment", "depositActivation"],
    "journal transactions",
  );
  const sourceDeployment = hash(
    candidate.transactions.sourceDeployment,
    "deployment transaction hash",
  );
  const depositActivation =
    candidate.transactions.depositActivation === null
      ? null
      : hash(
          candidate.transactions.depositActivation,
          "activation transaction hash",
        );
  if (sourceDeployment === depositActivation)
    fail("deployment and activation require separate transactions");
  return journal({ sourceDeployment, depositActivation });
}
export function appendLateMigrationStageTransaction(
  value,
  key,
  transactionHash,
) {
  const prior = unwrapLateMigrationStageJournal(value);
  if (
    key !== "depositActivation" ||
    prior.transactions.depositActivation !== null
  )
    fail("only one deposit activation stage may be appended");
  return unwrapLateMigrationStageJournal(
    journal({
      ...prior.transactions,
      depositActivation: hash(transactionHash, "activation hash"),
    }),
  );
}
export function lateMigrationEndpointCommitment({ headers, url }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail("production provider URL invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  )
    fail(
      "production provider requires HTTPS without embedded credentials or fragments",
    );
  if (
    !headers ||
    typeof headers !== "object" ||
    Array.isArray(headers) ||
    Object.keys(headers).length === 0
  )
    fail("production provider authentication headers required");
  const normalized = {};
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (
      !/^[a-z0-9!#$%&'*+.^_`|~-]+$/u.test(name) ||
      [
        "connection",
        "content-length",
        "content-type",
        "host",
        "transfer-encoding",
      ].includes(name) ||
      typeof value !== "string" ||
      value.length < 8 ||
      value.length > 4096 ||
      /[\r\n]/u.test(value) ||
      name in normalized
    )
      fail("production authentication headers invalid");
    normalized[name] = value;
  }
  return `sha256:${createHash("sha256")
    .update("programmable-late-migration-rpc-endpoint/v1\n")
    .update(canonicalJson({ headers: normalized, url: parsed.toString() }))
    .digest("hex")}`;
}
export function productionProvidersFromEnvironment({
  chain = "source",
  env = process.env,
  fetchImpl = fetch,
  policy,
}) {
  if (chain !== "source")
    fail("intake supports Ethereum source providers only");
  equal(
    policy,
    {
      minimumIndependentProviders: 2,
      maximumFinalizedAnchorAgeSeconds: 3600,
      requireAuthentication: true,
      requireEndpointCommitment: true,
      requireLiteralFinalizedTag: true,
      sourceProvidersJsonEnv:
        "LATE_MIGRATION_ETHEREUM_PRODUCTION_PROVIDERS_JSON",
    },
    "production provider policy",
  );
  const secretJson = env[policy.sourceProvidersJsonEnv];
  if (typeof secretJson !== "string" || secretJson.length > 32768)
    fail("production provider configuration absent or oversized");
  let entries;
  try {
    entries = JSON.parse(secretJson);
  } catch {
    fail("production provider configuration invalid JSON");
  }
  if (!Array.isArray(entries) || entries.length < 2 || entries.length > 4)
    fail("two to four independent production providers required");
  const evidence = [];
  const providers = entries.map((entry) => {
    exactKeys(
      entry,
      ["endpointCommitmentSha256", "headers", "id", "trustDomain", "url"],
      "production provider",
    );
    const endpointCommitmentSha256 = lateMigrationEndpointCommitment(entry);
    equal(
      endpointCommitmentSha256,
      entry.endpointCommitmentSha256,
      "endpoint commitment",
    );
    const hostname = new URL(entry.url).hostname;
    if (
      entry.trustDomain !== hostname.split(".").slice(-2).join(".") ||
      ["ethereum-rpc.publicnode.com", "eth.drpc.org"].includes(hostname)
    )
      fail(
        "production provider trust domain or authenticated endpoint invalid",
      );
    evidence.push({
      id: entry.id,
      trustDomain: entry.trustDomain,
      authenticated: true,
      endpointCommitmentSha256,
    });
    return createReadonlyJsonRpcProvider({ ...entry, fetchImpl });
  });
  assertProviderSet(providers);
  const result = freeze({ chain: "source", providers, evidence });
  PRODUCTION_PROVIDERS.add(result);
  return result;
}
export const lateMigrationStageProvidersFromConfig = providersFromConfig;

async function finalizedTransaction(providers, txHash, anchor) {
  const transaction = await agreedRead(providers, "eth_getTransactionByHash", [
    txHash,
  ]);
  const receipt = await agreedRead(providers, "eth_getTransactionReceipt", [
    txHash,
  ]);
  if (!transaction || !receipt) fail("transaction or receipt unavailable");
  equal(
    hash(transaction.hash, "transaction hash"),
    txHash,
    "transaction identity",
  );
  equal(
    hash(receipt.transactionHash, "receipt hash"),
    txHash,
    "receipt identity",
  );
  equal(
    quantity(receipt.status, "receipt status").toString(),
    "1",
    "successful receipt",
  );
  equal(
    quantity(transaction.chainId, "transaction chain").toString(),
    "1",
    "Ethereum transaction",
  );
  const blockNumber = quantity(receipt.blockNumber, "receipt block");
  if (blockNumber > BigInt(anchor.blockNumber))
    fail("transaction is not finalized");
  const blockHash = hash(receipt.blockHash, "receipt block hash");
  equal(
    hash(transaction.blockHash, "transaction block hash"),
    blockHash,
    "transaction/receipt block hash",
  );
  equal(
    quantity(transaction.blockNumber, "transaction block").toString(),
    blockNumber.toString(),
    "transaction/receipt block number",
  );
  const transactionIndex = quantity(receipt.transactionIndex, "receipt index");
  equal(
    quantity(transaction.transactionIndex, "transaction index").toString(),
    transactionIndex.toString(),
    "transaction/receipt index",
  );
  equal(
    address(transaction.from, "transaction sender"),
    EXPECTED.owner,
    "owner sender",
  );
  equal(
    address(receipt.from, "receipt sender"),
    EXPECTED.owner,
    "receipt sender",
  );
  equal(
    quantity(transaction.value, "transaction value").toString(),
    "0",
    "zero transaction value",
  );
  const canonical = await agreedRead(
    providers,
    "eth_getBlockByNumber",
    [numberToHex(blockNumber), false],
    "transaction canonical block",
  );
  equal(
    hash(canonical?.hash, "canonical block hash"),
    blockHash,
    "finalized canonical transaction block",
  );
  equal(
    quantity(canonical?.number, "canonical block number").toString(),
    blockNumber.toString(),
    "canonical transaction height",
  );
  if (
    !Array.isArray(canonical.transactions) ||
    hash(
      canonical.transactions[Number(transactionIndex)],
      "canonical transaction index",
    ) !== txHash
  )
    fail("transaction absent from canonical block position");
  return {
    transaction,
    receipt,
    evidence: {
      transactionHash: txHash,
      blockNumber: blockNumber.toString(),
      blockHash,
      transactionIndex: transactionIndex.toString(),
    },
  };
}
async function intakeState(providers, sourceAddress, anchor) {
  const tag = numberToHex(BigInt(anchor.blockNumber));
  const state = {};
  for (const name of [
    "oldToken",
    "activationAuthority",
    "depositsOpen",
    "activatedAtBlock",
    "depositedOfferCount",
    "depositedGrossTotal",
    "depositedPayoutTotal",
    "ROUND_ID",
    "eligibilityRoot",
    "OLD_TOKEN_RECIPIENT",
    "TARGET_CHAIN_ID",
    "TARGET_TOKEN",
    "PAYOUT_BPS",
  ]) {
    const result = await contractRead(
      providers,
      sourceAddress,
      SOURCE_ABI,
      name,
      tag,
    );
    state[name] = typeof result === "bigint" ? result.toString() : result;
  }
  for (const [key, value] of Object.entries({
    oldToken: EXPECTED.oldToken,
    ROUND_ID: EXPECTED.roundId,
    eligibilityRoot: EXPECTED.eligibilityRoot,
    OLD_TOKEN_RECIPIENT: EXPECTED.oldTokenRecipient,
    TARGET_CHAIN_ID: "4663",
    TARGET_TOKEN: EXPECTED.manualPayoutToken,
    PAYOUT_BPS: "8000",
  }))
    equal(state[key], value, `intake.${key}`);
  if (
    BigInt(state.depositedOfferCount) > BigInt(EXPECTED.eligibleOfferCount) ||
    BigInt(state.depositedGrossTotal) >
      BigInt(EXPECTED.aggregateGrossAmountRaw) ||
    BigInt(state.depositedPayoutTotal) >
      BigInt(EXPECTED.aggregateManualPayoutAmountRaw)
  )
    fail("intake aggregate bound exceeded");
  await contractRead(
    providers,
    sourceAddress,
    SOURCE_ABI,
    "assertPinnedOldToken",
    tag,
  );
  return state;
}
export async function verifyLateMigrationStageContext({
  activation,
  artifacts,
  eligibility,
  preflight,
  journal: journalInput,
  sourceProviders,
  productionProviderSets = null,
  requireProductionActivationProviders = false,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  verifyFrozenLateMigrationInputs({ activation, eligibility, preflight });
  const verifiedJournal = unwrapLateMigrationStageJournal(journalInput);
  if (
    requireProductionActivationProviders &&
    (!PRODUCTION_PROVIDERS.has(productionProviderSets?.source) ||
      productionProviderSets.source.providers !== sourceProviders)
  )
    fail("verified authenticated production provider set required");
  const sourceBytes = sourceArtifactBytes(artifacts.source, preflight);
  const anchor = await sourceAnchor(sourceProviders, preflight, nowSeconds);
  await verifyOldToken(sourceProviders, anchor);
  const deployed = await finalizedTransaction(
    sourceProviders,
    verifiedJournal.transactions.sourceDeployment,
    anchor,
  );
  equal(deployed.transaction.to, null, "contract creation transaction");
  equal(deployed.receipt.to, null, "contract creation receipt");
  equal(
    hex(deployed.transaction.input, "deployment input"),
    sourceBytes.initcode,
    "exact V3 initcode and owner constructor",
  );
  const sourceAddress = getContractAddress({
    from: EXPECTED.owner,
    nonce: quantity(deployed.transaction.nonce, "deployment nonce"),
  });
  assertLateMigrationDeploymentAddressesSafe({ eligibility, sourceAddress });
  equal(
    address(deployed.receipt.contractAddress, "deployed contract"),
    sourceAddress,
    "CREATE address",
  );
  for (const tag of [
    numberToHex(BigInt(deployed.evidence.blockNumber)),
    numberToHex(BigInt(anchor.blockNumber)),
  ]) {
    equal(
      hex(
        await agreedRead(sourceProviders, "eth_getCode", [sourceAddress, tag]),
        "intake runtime",
      ),
      sourceBytes.runtimeCode,
      "exact deployed V3 runtime",
    );
  }
  const state = await intakeState(sourceProviders, sourceAddress, anchor);
  let activationEvidence = null;
  if (verifiedJournal.transactions.depositActivation === null) {
    equal(
      state.depositsOpen,
      false,
      "deposits closed before separate activation",
    );
    equal(
      state.activationAuthority,
      EXPECTED.owner,
      "one-time activation authority",
    );
    for (const key of [
      "activatedAtBlock",
      "depositedOfferCount",
      "depositedGrossTotal",
      "depositedPayoutTotal",
    ])
      equal(state[key], "0", `preactivation ${key}`);
  } else {
    const activated = await finalizedTransaction(
      sourceProviders,
      verifiedJournal.transactions.depositActivation,
      anchor,
    );
    equal(
      address(activated.transaction.to, "activation destination"),
      sourceAddress,
      "activation target",
    );
    equal(
      address(activated.receipt.to, "activation receipt destination"),
      sourceAddress,
      "activation receipt target",
    );
    equal(
      activated.receipt.contractAddress,
      null,
      "activation receipt cannot create a contract",
    );
    equal(
      hex(activated.transaction.input, "activation input"),
      encodeFunctionData({ abi: SOURCE_ABI, functionName: "activateDeposits" }),
      "exact activation calldata",
    );
    const deployBlock = BigInt(deployed.evidence.blockNumber);
    const activateBlock = BigInt(activated.evidence.blockNumber);
    if (
      activateBlock < deployBlock ||
      (activateBlock === deployBlock &&
        BigInt(activated.evidence.transactionIndex) <=
          BigInt(deployed.evidence.transactionIndex))
    )
      fail("activation must follow deployment");
    const matchingLogs = (activated.receipt.logs ?? []).filter(
      (log) => address(log.address, "activation log address") === sourceAddress,
    );
    if (matchingLogs.length !== 1)
      fail("exactly one activation event required");
    const log = matchingLogs[0];
    if (log.removed !== false)
      fail("activation event is removed or missing canonical flag");
    equal(
      hash(log.transactionHash, "event transaction hash"),
      activated.evidence.transactionHash,
      "activation event identity",
    );
    equal(
      hash(log.blockHash, "event block hash"),
      activated.evidence.blockHash,
      "activation event block",
    );
    equal(
      quantity(log.blockNumber, "event block number").toString(),
      activated.evidence.blockNumber,
      "activation event height",
    );
    equal(
      quantity(log.transactionIndex, "event transaction index").toString(),
      activated.evidence.transactionIndex,
      "activation event transaction index",
    );
    const decoded = decodeEventLog({
      abi: [ACTIVATED_EVENT],
      topics: log.topics,
      data: log.data,
      strict: true,
    });
    equal(decoded.args.roundId, EXPECTED.roundId, "activation round");
    equal(
      decoded.args.previousAuthority,
      EXPECTED.owner,
      "activation previous authority",
    );
    equal(
      decoded.args.activatedAtBlock.toString(),
      activated.evidence.blockNumber,
      "activation event height commitment",
    );
    equal(state.depositsOpen, true, "deposits open");
    equal(
      state.activationAuthority,
      ZERO_ADDRESS,
      "activation authority deleted",
    );
    equal(
      state.activatedAtBlock,
      activated.evidence.blockNumber,
      "activatedAtBlock",
    );
    activationEvidence = {
      ...activated.evidence,
      logIndex: quantity(log.logIndex, "activation log index").toString(),
    };
  }
  await assertAnchorCanonical(sourceProviders, anchor);
  const context = freeze({
    schema: LATE_MIGRATION_STAGE_VERIFICATION_SCHEMA,
    state: activationEvidence
      ? "activation-finalized"
      : "deployment-finalized-deposits-closed",
    signingAllowed: false,
    broadcastAllowed: false,
    generatedAt: nowSeconds,
    inputCommitmentSha256: commitment({ activation, eligibility, preflight }),
    activationManifestCommitmentSha256: commitment(activation),
    sourceAddress,
    sourceRuntimeCodehash: keccak256(sourceBytes.runtimeCode),
    maximumActivationGas: preflight.ownerHandoff.maximumActivationGas,
    sourceAnchor: anchor,
    deployment: deployed.evidence,
    activation: activationEvidence,
    intakeState: state,
    journal: verifiedJournal,
    productionProviderEvidence: requireProductionActivationProviders
      ? productionProviderSets.source.evidence
      : null,
  });
  VERIFIED_CONTEXTS.set(context, sourceProviders);
  return context;
}
function assertContext(context, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (
    !VERIFIED_CONTEXTS.has(context) ||
    nowSeconds < context.generatedAt ||
    nowSeconds - context.generatedAt > 300
  )
    fail("fresh in-process verified context required");
}
export function lateMigrationStageVerificationSummary(context) {
  assertContext(context);
  return context;
}
export async function prepareDepositActivation({
  context,
  providers,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  assertContext(context, nowSeconds);
  if (
    context.activation !== null ||
    context.productionProviderEvidence === null
  )
    fail(
      "activation requires finalized closed deployment and authenticated production providers",
    );
  // Bind the exact endpoints used for verification to preparation; callers cannot swap quorum sets.
  if (VERIFIED_CONTEXTS.get(context) !== providers)
    fail("activation preparation provider identity mismatch");
  assertProviderSet(providers);
  equal(
    providers.map(({ id, trustDomain }) => ({ id, trustDomain })),
    context.productionProviderEvidence.map(({ id, trustDomain }) => ({
      id,
      trustDomain,
    })),
    "activation preparation provider bindings",
  );
  const nonce = await pendingOwnerNonce(providers);
  const data = encodeFunctionData({
    abi: SOURCE_ABI,
    functionName: "activateDeposits",
  });
  const rpcTransaction = {
    from: EXPECTED.owner,
    to: context.sourceAddress,
    value: "0x0",
    nonce: numberToHex(nonce),
    data,
  };
  equal(
    hex(
      await agreedRead(
        providers,
        "eth_call",
        [rpcTransaction, "latest"],
        "activation simulation",
      ),
      "activation simulation result",
    ),
    "0x",
    "successful activation simulation",
  );
  const gasLimit = await boundedEstimate(
    providers,
    rpcTransaction,
    context.maximumActivationGas,
  );
  await assertAnchorCanonical(providers, context.sourceAnchor);
  equal(
    (await pendingOwnerNonce(providers)).toString(),
    nonce.toString(),
    "final activation owner nonce recheck",
  );
  return freeze({
    schema: LATE_MIGRATION_STAGE_HANDOFF_SCHEMA,
    state: "prepared-not-signed-not-broadcast",
    stage: "one-time-source-activation",
    signingAllowed: false,
    broadcastAllowed: false,
    generatedAt: nowSeconds,
    expiresAt: nowSeconds + 300,
    inputCommitmentSha256: context.inputCommitmentSha256,
    sourceAnchor: context.sourceAnchor,
    journal: context.journal,
    transactions: [
      {
        chainId: 1,
        from: EXPECTED.owner,
        to: context.sourceAddress,
        nonce: nonce.toString(),
        value: "0",
        data,
        gasLimit,
        decoded: {
          function: "activateDeposits()",
          effect:
            "Irreversibly opens the frozen Ethereum intake and deletes activation authority.",
          roundId: EXPECTED.roundId,
          eligibilityRoot: EXPECTED.eligibilityRoot,
          oldToken: EXPECTED.oldToken,
          oldTokenRecipient: EXPECTED.oldTokenRecipient,
          manualPayoutBps: 8000,
        },
      },
    ],
  });
}
export function deriveDisabledLateMigrationActivationManifest({
  activation,
  context,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  assertContext(context, nowSeconds);
  if (
    context.activation === null ||
    context.productionProviderEvidence === null ||
    activation.enabled !== false
  )
    fail(
      "finalized production activation evidence and disabled manifest required",
    );
  equal(
    commitment(activation),
    context.activationManifestCommitmentSha256,
    "unchanged activation manifest",
  );
  return freeze({
    ...activation,
    enabled: false,
    sourceContractAddress: context.sourceAddress,
    sourceContractRuntimeCodehash: context.sourceRuntimeCodehash,
    sourceDeploymentBlockNumber: context.deployment.blockNumber,
    sourceDeploymentBlockHash: context.deployment.blockHash,
    activatedAtBlock: context.activation.blockNumber,
  });
}
