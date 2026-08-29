import { spawnSync } from "node:child_process";
import { realpathSync, readFileSync } from "node:fs";
import path from "node:path";

import { getAddress } from "viem";

import { canonicalizeJson } from "../../packages/launch/src/canonical-json.mjs";
import {
  assertExactKeys,
  compareUtf8,
  resolveInside,
  sha256Digest,
} from "../../packages/launch/src/io.mjs";
import {
  hashV4ChainDeployment,
  normalizeV4ChainDeployment,
  normalizeV4ProfileRef,
} from "../../packages/launch/src/v4-contract.mjs";
import {
  V4_RELEASE_BINDING_PATH,
  V4_RELEASE_REQUIRED_SOURCE_PATHS,
  auditV4ReleaseBinding,
  computeV4ChainDeploymentBindingDigest,
  computeV4FinalityEvidenceDigest,
  computeV4ProfileEvidenceDigest,
  computeV4ReleaseManifestDigest,
  computeV4SourceClosureDigest,
} from "../../scripts/programmable-launch-v4-release-binding.mjs";

export const ROBINHOOD_POSTDEPLOYMENT_INPUT_SCHEMA =
  "programmable.robinhood-custom-launch.postdeployment-input.v1";
export const ROBINHOOD_PROMOTION_BUNDLE_SCHEMA =
  "programmable.robinhood-custom-launch.promotion-bundle.v1";
export const ROBINHOOD_LIVE_DEPLOYMENT_PATH =
  "contracts/deployments/robinhood-custom-launch-v1.json";
export const ROBINHOOD_PREDEPLOYMENT_PATH =
  "contracts/deployments/robinhood-custom-launch-v1.predeployment.json";

const PREDEPLOYMENT_SHA256 =
  "sha256:2d58b964232d345f82aa7c7d58e678df03bf83828b9d95da42f3cd54ab03319e";
const CHAIN_DEPLOYMENT_ID = "robinhood-mainnet-custom-launch-v1";
const CHAIN_ID = "4663";
const CAIP2 = "eip155:4663";
const FOUNDATION_SOURCE_COMMITMENT =
  "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730";
const EMPTY_RUNTIME_CODE_HASH =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_RUNTIME_CODE_HASH =
  "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891";
const MULTICALL3_SELECTOR = "0x82ad56cb";
const OWNER_CALLDATA_HASH =
  "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9";
const OWNER_CALLDATA_BYTES = 33_412;
const SAFE_SOURCE_COMMITMENT =
  "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb";
const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const SAFE_SINGLETON_RUNTIME_CODE_HASH =
  "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4";
const SAFE_FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
const SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH =
  "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9";
const SAFE_MODULES_END_SENTINEL = "0x0000000000000000000000000000000000000001";
const SAFE_OWNERS = Object.freeze([
  "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
]);
const ROLLUP = "0x23A19d23e89166adedbDcB432518AB01e4272D94";
const SEQUENCER_INBOX = "0xBd0D173EEb87D57A09521c24388a12789F33ba96";
const PERMIT2_GENESIS_SOURCE_URL =
  "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-genesis.json";
const PERMIT2_GENESIS_SOURCE_DIGEST =
  "sha256:353e6f6441b47695b41cee0c3645cde8dd7492d2f7f574bfb6aa4371e41bb6ba";
const PERMIT2_GENESIS_RUNTIME_CODE_BYTES = 9_152;
const FINALITY = Object.freeze({
  schemaVersion: "programmable.custom-launch-finality-policy-ref.v1",
  policyId: "robinhood-stage-finality-v1",
  policyRevision: 1,
  policyDigest:
    "sha256:537d531423d1285a3808556a57303ec68f1e6bdeea3c9aaf6320f9e5a0e47153",
});
const UNISWAP_REGISTRY_SOURCE = Object.freeze({
  repository: "Uniswap/contracts",
  commit: "4cfc406c8e34da3ce04e60657a7825075b64fd22",
  path: "deployments/json/4663.json",
  rawUrl:
    "https://raw.githubusercontent.com/Uniswap/contracts/4cfc406c8e34da3ce04e60657a7825075b64fd22/deployments/json/4663.json",
  sha256: "sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15",
});

const ROOTS = Object.freeze({
  programmableLaunchStampRouter: Object.freeze({
    address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
    runtimeCodeHash:
      "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
  }),
  permitAuthority: Object.freeze({
    address: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
    runtimeCodeHash:
      "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  }),
  graphFactory: Object.freeze({
    address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
    runtimeCodeHash:
      "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  }),
  poolManager: Object.freeze({
    address: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    runtimeCodeHash:
      "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  }),
  positionManager: Object.freeze({
    address: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
    runtimeCodeHash:
      "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
  }),
  stateView: Object.freeze({
    address: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    runtimeCodeHash:
      "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6",
  }),
  v4Quoter: Object.freeze({
    address: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
    runtimeCodeHash:
      "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
  }),
  permit2: Object.freeze({
    address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    runtimeCodeHash:
      "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
  }),
  universalRouter: Object.freeze({
    address: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
    runtimeCodeHash:
      "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
  }),
});

const ATOMIC_ROOT_NAMES = Object.freeze([
  "permitAuthority",
  "graphFactory",
  "programmableLaunchStampRouter",
]);
const EXTERNAL_ROOTS = Object.freeze({
  poolManager: Object.freeze({
    ...ROOTS.poolManager,
    transactionHash:
      "0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41",
    startBlock: "9070",
  }),
  positionManager: Object.freeze({
    ...ROOTS.positionManager,
    transactionHash:
      "0x228c18ada6cb46b4fbcc18f4ec1519953415393e256fa8349aafbd5a2db037c8",
    startBlock: "9073",
  }),
  stateView: Object.freeze({
    ...ROOTS.stateView,
    transactionHash:
      "0x3d61e2c9eeb482385b1aa436b9e8f812167ea579cc390e4f93bc5abde00582f4",
    startBlock: "9075",
  }),
  v4Quoter: Object.freeze({
    ...ROOTS.v4Quoter,
    transactionHash:
      "0x6bf436d72a17f87284ddcab43094689bd320dfb39b535213b9a0b669fabc4ab4",
    startBlock: "9074",
  }),
  universalRouter: Object.freeze({
    ...ROOTS.universalRouter,
    transactionHash:
      "0xdfb76494e158d8dea4376160315239271636a18515207fd4526e574bc7eeb456",
    startBlock: "3347899",
  }),
});
const EXTERNAL_ROOT_NAMES = Object.freeze(Object.keys(EXTERNAL_ROOTS));

const DOMAINS = Object.freeze({
  transaction: "programmable.robinhood-postdeployment-l2-transaction-readback.v1",
  receipt: "programmable.robinhood-postdeployment-l2-receipt-readback.v1",
  safeProvider: "programmable.robinhood-postdeployment-safe-provider-readback.v1",
  atomicProvider: "programmable.robinhood-atomic-root-deployment-provider-readback.v1",
  runtimeTransition:
    "programmable.robinhood-atomic-root-runtime-transition-provider-readback.v1",
  resultState: "programmable.robinhood-atomic-root-deployment-result-state.v1",
  receiptLogs: "programmable.robinhood-atomic-root-deployment-receipt-logs.v1",
  atomicDeployment: "programmable.robinhood-atomic-root-deployment-evidence.v1",
  finality: "programmable.robinhood-l2-checkpoint-ethereum-finality.v1",
  safeConfiguration: "programmable.safe-configuration-evidence.v1",
  deploymentEvidence: "programmable.custom-launch-deployment-evidence.v1",
  permit2Readback: "programmable.custom-launch-genesis-provider-readback.v1",
  permit2: "programmable.custom-launch-genesis-provenance.v1",
  externalReadback: "programmable.custom-launch-deployment-provider-readback.v1",
  sourceVerification:
    "programmable.robinhood-custom-launch.source-verification-closure.v1",
  bundle: ROBINHOOD_PROMOTION_BUNDLE_SCHEMA,
});

const PROVIDERS = Object.freeze([
  Object.freeze({ providerId: "drpc", trustDomain: "drpc.org" }),
  Object.freeze({ providerId: "alchemy", trustDomain: "alchemy.com" }),
]);

function framedSha256(domain, value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function deepEqual(left, right, label) {
  if (canonicalizeJson(left) !== canonicalizeJson(right)) {
    throw new TypeError(`${label} differs across the independently identified providers`);
  }
}

function exactAddress(value, label, expected = null) {
  let normalized;
  try {
    normalized = getAddress(value);
  } catch {
    throw new TypeError(`${label} must be an EIP-55 address`);
  }
  if (value !== normalized) throw new TypeError(`${label} must be an EIP-55 address`);
  if (expected !== null && normalized !== expected) {
    throw new TypeError(`${label} does not match the pinned address`);
  }
  return normalized;
}

function exactHex32(value, label, expected = null) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)
    || value === `0x${"0".repeat(64)}`) {
    throw new TypeError(`${label} must be a nonzero lowercase bytes32`);
  }
  if (expected !== null && value !== expected) {
    throw new TypeError(`${label} does not match the pinned digest`);
  }
  return value;
}

function exactSha256(value, label, expected = null) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  if (expected !== null && value !== expected) {
    throw new TypeError(`${label} does not match the pinned digest`);
  }
  return value;
}

function decimal(value, label, { positive = false } = {}) {
  const pattern = positive ? /^[1-9][0-9]*$/u : /^(?:0|[1-9][0-9]*)$/u;
  if (typeof value !== "string" || !pattern.test(value) || BigInt(value) >= 1n << 256n) {
    throw new TypeError(`${label} must be a canonical bounded decimal string`);
  }
  return value;
}

function isoDate(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical ISO-8601 instant`);
  }
  return value;
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readPreparedArtifact(repositoryRoot) {
  const preparedPath = resolveInside(repositoryRoot, ROBINHOOD_PREDEPLOYMENT_PATH);
  const bytes = readFileSync(preparedPath);
  exactSha256(sha256Digest(bytes), "prepared artifact SHA-256", PREDEPLOYMENT_SHA256);
  const value = JSON.parse(bytes.toString("utf8"));
  if (value?.schemaVersion !== "programmable.robinhood-custom-launch.deployment.v1"
    || value?.chainDeploymentId !== CHAIN_DEPLOYMENT_ID
    || value?.state !== "prepared-not-broadcast"
    || value?.foundationSourceCommitment !== FOUNDATION_SOURCE_COMMITMENT
    || value?.chainDeploymentDescriptorDigest !== null
    || value?.live !== false) {
    throw new TypeError("prepared artifact is not the exact immutable no-broadcast foundation");
  }
  return { bytes, value };
}

function normalizeReceipt(value, label) {
  assertExactKeys(value, [
    "transactionHash", "from", "to", "status", "transactionIndex",
    "blockNumber", "blockHash", "logs",
  ], label);
  if (value.status !== "1" || !Array.isArray(value.logs) || value.logs.length > 1_024) {
    throw new TypeError(`${label} is not a bounded successful receipt`);
  }
  const logs = value.logs.map((entry, index) => {
    const logLabel = `${label}.logs[${index}]`;
    assertExactKeys(entry, ["address", "topics", "data", "logIndex"], logLabel);
    if (!Array.isArray(entry.topics) || entry.topics.length > 4
      || typeof entry.data !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(entry.data)) {
      throw new TypeError(`${logLabel} is invalid`);
    }
    return {
      address: exactAddress(entry.address, `${logLabel}.address`),
      topics: entry.topics.map((topic, topicIndex) =>
        exactHex32(topic, `${logLabel}.topics[${topicIndex}]`)),
      data: entry.data,
      logIndex: decimal(entry.logIndex, `${logLabel}.logIndex`),
    };
  });
  if (new Set(logs.map(({ logIndex }) => logIndex)).size !== logs.length
    || logs.some((entry, index) => index > 0
      && BigInt(entry.logIndex) <= BigInt(logs[index - 1].logIndex))) {
    throw new TypeError(`${label}.logs must be strictly increasing and unique`);
  }
  return {
    transactionHash: exactHex32(value.transactionHash, `${label}.transactionHash`),
    from: exactAddress(value.from, `${label}.from`),
    to: exactAddress(value.to, `${label}.to`, MULTICALL3_ADDRESS),
    status: "1",
    transactionIndex: decimal(value.transactionIndex, `${label}.transactionIndex`),
    blockNumber: decimal(value.blockNumber, `${label}.blockNumber`, { positive: true }),
    blockHash: exactHex32(value.blockHash, `${label}.blockHash`),
    logs,
  };
}

function normalizeTransaction(value, label) {
  assertExactKeys(value, [
    "hash", "from", "to", "valueWei", "selector", "calldataHash",
    "calldataBytes", "nonce", "transactionIndex", "blockNumber", "blockHash",
  ], label);
  const from = exactAddress(value.from, `${label}.from`);
  if (!SAFE_OWNERS.includes(from)) throw new TypeError(`${label}.from is not an allowed owner`);
  if (value.valueWei !== "0" || value.selector !== MULTICALL3_SELECTOR
    || value.calldataHash !== OWNER_CALLDATA_HASH
    || value.calldataBytes !== OWNER_CALLDATA_BYTES) {
    throw new TypeError(`${label} does not bind the exact zero-value Multicall3 calldata`);
  }
  return {
    hash: exactHex32(value.hash, `${label}.hash`),
    from,
    to: exactAddress(value.to, `${label}.to`, MULTICALL3_ADDRESS),
    valueWei: "0",
    selector: MULTICALL3_SELECTOR,
    calldataHash: OWNER_CALLDATA_HASH,
    calldataBytes: OWNER_CALLDATA_BYTES,
    nonce: decimal(value.nonce, `${label}.nonce`),
    transactionIndex: decimal(value.transactionIndex, `${label}.transactionIndex`),
    blockNumber: decimal(value.blockNumber, `${label}.blockNumber`, { positive: true }),
    blockHash: exactHex32(value.blockHash, `${label}.blockHash`),
  };
}

function normalizeAtomicRoot(value, label, contract, blockNumber, blockHash) {
  assertExactKeys(value, [
    "contract", "address", "preDeploymentBlockNumber", "preDeploymentBlockHash",
    "preDeploymentRuntimeCodeHash", "deploymentBlockNumber", "deploymentBlockHash",
    "deploymentRuntimeCodeHash",
  ], label);
  const expected = ROOTS[contract];
  const predecessor = (BigInt(blockNumber) - 1n).toString();
  if (value.contract !== contract
    || value.preDeploymentBlockNumber !== predecessor
    || value.preDeploymentRuntimeCodeHash !== EMPTY_RUNTIME_CODE_HASH
    || value.deploymentBlockNumber !== blockNumber
    || value.deploymentBlockHash !== blockHash) {
    throw new TypeError(`${label} does not prove the exact D-1 to D transition`);
  }
  return {
    contract,
    address: exactAddress(value.address, `${label}.address`, expected.address),
    preDeploymentBlockNumber: predecessor,
    preDeploymentBlockHash: exactHex32(
      value.preDeploymentBlockHash,
      `${label}.preDeploymentBlockHash`,
    ),
    preDeploymentRuntimeCodeHash: EMPTY_RUNTIME_CODE_HASH,
    deploymentBlockNumber: blockNumber,
    deploymentBlockHash: blockHash,
    deploymentRuntimeCodeHash: exactHex32(
      value.deploymentRuntimeCodeHash,
      `${label}.deploymentRuntimeCodeHash`,
      expected.runtimeCodeHash,
    ),
  };
}

function normalizeRouterState(value, label) {
  assertExactKeys(value, [
    "address", "runtimeCodeHash", "chainId", "permitAuthority",
    "permitAuthorityRuntimeCodeHash", "graphFactory", "graphFactoryRuntimeCodeHash",
    "poolManager", "poolManagerRuntimeCodeHash",
  ], label);
  if (value.chainId !== CHAIN_ID) throw new TypeError(`${label}.chainId differs`);
  return {
    address: exactAddress(value.address, `${label}.address`, ROOTS.programmableLaunchStampRouter.address),
    runtimeCodeHash: exactHex32(
      value.runtimeCodeHash,
      `${label}.runtimeCodeHash`,
      ROOTS.programmableLaunchStampRouter.runtimeCodeHash,
    ),
    chainId: CHAIN_ID,
    permitAuthority: exactAddress(
      value.permitAuthority,
      `${label}.permitAuthority`,
      ROOTS.permitAuthority.address,
    ),
    permitAuthorityRuntimeCodeHash: exactHex32(
      value.permitAuthorityRuntimeCodeHash,
      `${label}.permitAuthorityRuntimeCodeHash`,
      ROOTS.permitAuthority.runtimeCodeHash,
    ),
    graphFactory: exactAddress(value.graphFactory, `${label}.graphFactory`, ROOTS.graphFactory.address),
    graphFactoryRuntimeCodeHash: exactHex32(
      value.graphFactoryRuntimeCodeHash,
      `${label}.graphFactoryRuntimeCodeHash`,
      ROOTS.graphFactory.runtimeCodeHash,
    ),
    poolManager: exactAddress(value.poolManager, `${label}.poolManager`, ROOTS.poolManager.address),
    poolManagerRuntimeCodeHash: exactHex32(
      value.poolManagerRuntimeCodeHash,
      `${label}.poolManagerRuntimeCodeHash`,
      ROOTS.poolManager.runtimeCodeHash,
    ),
  };
}

function storageWord(value, label, expectedAddress = null) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is not a lowercase storage word`);
  }
  if (expectedAddress !== null
    && value !== `0x${"0".repeat(24)}${expectedAddress.slice(2).toLowerCase()}`) {
    throw new TypeError(`${label} does not bind the pinned address`);
  }
  return value;
}

function normalizeSafeState(value, label, blockNumber, blockHash) {
  assertExactKeys(value, [
    "blockNumber", "blockHash", "proxyAddress", "proxyRuntimeCodeHash", "singleton",
    "fallbackHandler", "fallbackHandlerRuntimeCodeHash", "owners", "threshold", "nonce",
    "modules", "modulesNext", "guard", "singletonSlot", "fallbackHandlerSlot", "guardSlot",
  ], label);
  assertExactKeys(value.singleton, ["address", "runtimeCodeHash", "version"], `${label}.singleton`);
  if (value.blockNumber !== blockNumber || value.blockHash !== blockHash
    || value.singleton.version !== "1.4.1"
    || !Array.isArray(value.owners) || !Array.isArray(value.modules)
    || value.threshold !== 1 || value.nonce !== "0" || value.modules.length !== 0
    || value.modulesNext !== SAFE_MODULES_END_SENTINEL || value.guard !== null) {
    throw new TypeError(`${label} does not bind the exact freshly deployed Safe state`);
  }
  const owners = value.owners.map((owner, index) =>
    exactAddress(owner, `${label}.owners[${index}]`));
  deepEqual(owners, SAFE_OWNERS, `${label}.owners`);
  return {
    blockNumber,
    blockHash,
    proxyAddress: exactAddress(
      value.proxyAddress,
      `${label}.proxyAddress`,
      ROOTS.permitAuthority.address,
    ),
    proxyRuntimeCodeHash: exactHex32(
      value.proxyRuntimeCodeHash,
      `${label}.proxyRuntimeCodeHash`,
      ROOTS.permitAuthority.runtimeCodeHash,
    ),
    singleton: {
      address: exactAddress(value.singleton.address, `${label}.singleton.address`, SAFE_SINGLETON),
      runtimeCodeHash: exactHex32(
        value.singleton.runtimeCodeHash,
        `${label}.singleton.runtimeCodeHash`,
        SAFE_SINGLETON_RUNTIME_CODE_HASH,
      ),
      version: "1.4.1",
    },
    fallbackHandler: exactAddress(
      value.fallbackHandler,
      `${label}.fallbackHandler`,
      SAFE_FALLBACK_HANDLER,
    ),
    fallbackHandlerRuntimeCodeHash: exactHex32(
      value.fallbackHandlerRuntimeCodeHash,
      `${label}.fallbackHandlerRuntimeCodeHash`,
      SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH,
    ),
    owners,
    threshold: 1,
    nonce: "0",
    modules: [],
    modulesNext: SAFE_MODULES_END_SENTINEL,
    guard: null,
    singletonSlot: storageWord(value.singletonSlot, `${label}.singletonSlot`, SAFE_SINGLETON),
    fallbackHandlerSlot: storageWord(
      value.fallbackHandlerSlot,
      `${label}.fallbackHandlerSlot`,
      SAFE_FALLBACK_HANDLER,
    ),
    guardSlot: storageWord(value.guardSlot, `${label}.guardSlot`,
      "0x0000000000000000000000000000000000000000"),
  };
}

function normalizePermit2Genesis(value, label) {
  assertExactKeys(value, [
    "address", "blockNumber", "blockHash", "runtimeCodeHash", "runtimeCodeBytes",
  ], label);
  if (value.blockNumber !== "0" || value.runtimeCodeBytes !== PERMIT2_GENESIS_RUNTIME_CODE_BYTES) {
    throw new TypeError(`${label} is not the exact block-zero Permit2 allocation`);
  }
  return {
    address: exactAddress(value.address, `${label}.address`, ROOTS.permit2.address),
    blockNumber: "0",
    blockHash: exactHex32(value.blockHash, `${label}.blockHash`),
    runtimeCodeHash: exactHex32(
      value.runtimeCodeHash,
      `${label}.runtimeCodeHash`,
      ROOTS.permit2.runtimeCodeHash,
    ),
    runtimeCodeBytes: PERMIT2_GENESIS_RUNTIME_CODE_BYTES,
  };
}

function normalizeExternalRoot(value, label, contract) {
  assertExactKeys(value, [
    "contract", "address", "runtimeCodeHash", "transactionHash", "startBlock",
    "blockHash", "transactionReceiptDigest",
  ], label);
  const expected = EXTERNAL_ROOTS[contract];
  if (value.contract !== contract || value.transactionHash !== expected.transactionHash
    || value.startBlock !== expected.startBlock) {
    throw new TypeError(`${label} differs from the pinned Uniswap deployment tuple`);
  }
  return {
    contract,
    address: exactAddress(value.address, `${label}.address`, expected.address),
    runtimeCodeHash: exactHex32(
      value.runtimeCodeHash,
      `${label}.runtimeCodeHash`,
      expected.runtimeCodeHash,
    ),
    transactionHash: exactHex32(
      value.transactionHash,
      `${label}.transactionHash`,
      expected.transactionHash,
    ),
    startBlock: expected.startBlock,
    blockHash: exactHex32(value.blockHash, `${label}.blockHash`),
    transactionReceiptDigest: exactSha256(
      value.transactionReceiptDigest,
      `${label}.transactionReceiptDigest`,
    ),
  };
}

function normalizeProvider(value, index) {
  const label = `providers[${index}]`;
  assertExactKeys(value, [
    "providerId", "trustDomain", "transaction", "receipt", "multicall3",
    "atomicRoots", "routerState", "safeState", "permit2Genesis", "externalRoots",
  ], label);
  const expectedProvider = PROVIDERS[index];
  if (value.providerId !== expectedProvider.providerId
    || value.trustDomain !== expectedProvider.trustDomain) {
    throw new TypeError(`${label} is not the exact ordered independent provider identity`);
  }
  const transaction = normalizeTransaction(value.transaction, `${label}.transaction`);
  const receipt = normalizeReceipt(value.receipt, `${label}.receipt`);
  if (receipt.transactionHash !== transaction.hash || receipt.from !== transaction.from
    || receipt.to !== transaction.to || receipt.transactionIndex !== transaction.transactionIndex
    || receipt.blockNumber !== transaction.blockNumber || receipt.blockHash !== transaction.blockHash) {
    throw new TypeError(`${label} transaction and successful receipt disagree`);
  }
  assertExactKeys(value.multicall3, ["address", "runtimeCodeHash"], `${label}.multicall3`);
  const multicall3 = {
    address: exactAddress(
      value.multicall3.address,
      `${label}.multicall3.address`,
      MULTICALL3_ADDRESS,
    ),
    runtimeCodeHash: exactHex32(
      value.multicall3.runtimeCodeHash,
      `${label}.multicall3.runtimeCodeHash`,
      MULTICALL3_RUNTIME_CODE_HASH,
    ),
  };
  if (!Array.isArray(value.atomicRoots) || value.atomicRoots.length !== ATOMIC_ROOT_NAMES.length) {
    throw new TypeError(`${label}.atomicRoots must contain the three ordered foundation roots`);
  }
  const atomicRoots = ATOMIC_ROOT_NAMES.map((contract, rootIndex) =>
    normalizeAtomicRoot(
      value.atomicRoots[rootIndex],
      `${label}.atomicRoots[${rootIndex}]`,
      contract,
      transaction.blockNumber,
      transaction.blockHash,
    ));
  const routerState = normalizeRouterState(value.routerState, `${label}.routerState`);
  const safeState = normalizeSafeState(
    value.safeState,
    `${label}.safeState`,
    transaction.blockNumber,
    transaction.blockHash,
  );
  const permit2Genesis = normalizePermit2Genesis(
    value.permit2Genesis,
    `${label}.permit2Genesis`,
  );
  if (!Array.isArray(value.externalRoots)
    || value.externalRoots.length !== EXTERNAL_ROOT_NAMES.length) {
    throw new TypeError(`${label}.externalRoots must contain the ordered Uniswap tuple`);
  }
  const externalRoots = EXTERNAL_ROOT_NAMES.map((contract, rootIndex) =>
    normalizeExternalRoot(
      value.externalRoots[rootIndex],
      `${label}.externalRoots[${rootIndex}]`,
      contract,
    ));
  return {
    ...expectedProvider,
    transaction,
    receipt,
    multicall3,
    atomicRoots,
    routerState,
    safeState,
    permit2Genesis,
    externalRoots,
  };
}

function normalizeFinalityInput(value, profile, blockNumber, blockHash) {
  const label = "ethereumFinality";
  assertExactKeys(value, [
    "schemaVersion", "l2Checkpoint", "batchNumber", "l2Providers",
    "ethereumProviders", "rollup", "sequencerInbox", "postingTransactionHash",
    "postingBlockNumber", "postingBlockHash", "postingLogIndex",
    "ethereumFinalizedCheckpoint", "observedAt",
  ], label);
  assertExactKeys(value.l2Checkpoint, ["blockNumber", "blockHash"], `${label}.l2Checkpoint`);
  assertExactKeys(
    value.ethereumFinalizedCheckpoint,
    ["blockNumber", "blockHash", "tag"],
    `${label}.ethereumFinalizedCheckpoint`,
  );
  if (value.schemaVersion
      !== "programmable.robinhood-l2-checkpoint-ethereum-finality-input.v1"
    || value.l2Checkpoint.blockNumber !== blockNumber
    || value.l2Checkpoint.blockHash !== blockHash
    || !Array.isArray(value.l2Providers) || value.l2Providers.length !== 2
    || !Array.isArray(value.ethereumProviders) || value.ethereumProviders.length !== 2
    || value.ethereumFinalizedCheckpoint.tag !== "finalized") {
    throw new TypeError(`${label} is not bound to the exact foundation checkpoint`);
  }
  const l2Providers = value.l2Providers.map((provider, index) => {
    const providerLabel = `${label}.l2Providers[${index}]`;
    assertExactKeys(provider, ["providerId", "trustDomain", "l1Confirmations"], providerLabel);
    if (provider.providerId !== PROVIDERS[index].providerId
      || provider.trustDomain !== PROVIDERS[index].trustDomain) {
      throw new TypeError(`${providerLabel} is not the exact ordered L2 provider`);
    }
    return {
      ...PROVIDERS[index],
      l1Confirmations: decimal(
        provider.l1Confirmations,
        `${providerLabel}.l1Confirmations`,
        { positive: true },
      ),
    };
  });
  const expectedEthereumProviders = [
    { providerId: "drpc", trustDomain: "drpc.org" },
    { providerId: "quicknode", trustDomain: "quicknode.com" },
  ];
  const ethereumProviders = value.ethereumProviders.map((provider, index) => {
    const providerLabel = `${label}.ethereumProviders[${index}]`;
    assertExactKeys(provider, ["providerId", "trustDomain"], providerLabel);
    deepEqual(provider, expectedEthereumProviders[index], providerLabel);
    return { ...expectedEthereumProviders[index] };
  });
  const postingBlockNumber = decimal(
    value.postingBlockNumber,
    `${label}.postingBlockNumber`,
    { positive: true },
  );
  const finalizedBlockNumber = decimal(
    value.ethereumFinalizedCheckpoint.blockNumber,
    `${label}.ethereumFinalizedCheckpoint.blockNumber`,
    { positive: true },
  );
  if (BigInt(finalizedBlockNumber) < BigInt(postingBlockNumber)) {
    throw new TypeError(`${label} Ethereum finalized checkpoint predates the posting block`);
  }
  const normalized = {
    schemaVersion: DOMAINS.finality,
    profile: normalizeV4ProfileRef(profile),
    l2Checkpoint: { blockNumber, blockHash },
    batchNumber: decimal(value.batchNumber, `${label}.batchNumber`, { positive: true }),
    l2Providers,
    ethereumProviders,
    rollup: exactAddress(value.rollup, `${label}.rollup`, ROLLUP),
    sequencerInbox: exactAddress(
      value.sequencerInbox,
      `${label}.sequencerInbox`,
      SEQUENCER_INBOX,
    ),
    postingTransactionHash: exactHex32(
      value.postingTransactionHash,
      `${label}.postingTransactionHash`,
    ),
    postingBlockNumber,
    postingBlockHash: exactHex32(value.postingBlockHash, `${label}.postingBlockHash`),
    postingLogIndex: decimal(value.postingLogIndex, `${label}.postingLogIndex`),
    ethereumFinalizedCheckpoint: {
      blockNumber: finalizedBlockNumber,
      blockHash: exactHex32(
        value.ethereumFinalizedCheckpoint.blockHash,
        `${label}.ethereumFinalizedCheckpoint.blockHash`,
      ),
      tag: "finalized",
    },
    observedAt: isoDate(value.observedAt, `${label}.observedAt`),
  };
  return { ...normalized, evidenceDigest: framedSha256(DOMAINS.finality, normalized) };
}

function normalizeSourceVerification(value) {
  const label = "sourceVerification";
  assertExactKeys(value, [
    "schemaVersion", "provider", "graphFactory", "programmableLaunchStampRouter",
    "permitAuthority",
  ], label);
  if (value.schemaVersion !== DOMAINS.sourceVerification || value.provider !== "sourcify-v2") {
    throw new TypeError(`${label} must use the exact Sourcify V2 closure`);
  }
  const sourceRoots = {
    graphFactory: {
      ...ROOTS.graphFactory,
      standardJsonInputPath:
        "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
      standardJsonInputSha256:
        "sha256:8ab811a215d70b1d5aef0c71a47153173953ee78d7632725413833888369ec4d",
    },
    programmableLaunchStampRouter: {
      ...ROOTS.programmableLaunchStampRouter,
      standardJsonInputPath:
        "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
      standardJsonInputSha256:
        "sha256:6abca24d06b013599f4ff63e049976419c3f17455fa9bc343b15ec0d6e6a078a",
    },
  };
  const normalizedRoots = Object.fromEntries(Object.entries(sourceRoots).map(([name, expected]) => {
    const entryLabel = `${label}.${name}`;
    const entry = value[name];
    assertExactKeys(entry, [
      "chainId", "address", "match", "standardJsonInputPath",
      "standardJsonInputSha256", "verificationResponseDigest",
    ], entryLabel);
    if (entry.chainId !== CHAIN_ID || entry.match !== "exact"
      || entry.standardJsonInputPath !== expected.standardJsonInputPath) {
      throw new TypeError(`${entryLabel} is not the exact prepared compiler input match`);
    }
    return [name, {
      chainId: CHAIN_ID,
      address: exactAddress(entry.address, `${entryLabel}.address`, expected.address),
      match: "exact",
      standardJsonInputPath: expected.standardJsonInputPath,
      standardJsonInputSha256: exactSha256(
        entry.standardJsonInputSha256,
        `${entryLabel}.standardJsonInputSha256`,
        expected.standardJsonInputSha256,
      ),
      verificationResponseDigest: exactSha256(
        entry.verificationResponseDigest,
        `${entryLabel}.verificationResponseDigest`,
      ),
    }];
  }));
  assertExactKeys(
    value.permitAuthority,
    ["address", "kind", "sourceCommitment"],
    `${label}.permitAuthority`,
  );
  if (value.permitAuthority.kind !== "official-source-pinned") {
    throw new TypeError(`${label}.permitAuthority.kind differs`);
  }
  const normalized = {
    schemaVersion: DOMAINS.sourceVerification,
    provider: "sourcify-v2",
    ...normalizedRoots,
    permitAuthority: {
      address: exactAddress(
        value.permitAuthority.address,
        `${label}.permitAuthority.address`,
        ROOTS.permitAuthority.address,
      ),
      kind: "official-source-pinned",
      sourceCommitment: exactSha256(
        value.permitAuthority.sourceCommitment,
        `${label}.permitAuthority.sourceCommitment`,
        SAFE_SOURCE_COMMITMENT,
      ),
    },
  };
  return {
    ...normalized,
    evidenceDigest: framedSha256(DOMAINS.sourceVerification, normalized),
  };
}

function buildAtomicResult(providers, contract, index) {
  const expected = ROOTS[contract];
  const providerReadbacks = providers.map((provider) => {
    const observed = provider.atomicRoots[index];
    const normalized = {
      schemaVersion: DOMAINS.runtimeTransition,
      providerId: provider.providerId,
      trustDomain: provider.trustDomain,
      contract,
      address: expected.address,
      preDeploymentBlockNumber: observed.preDeploymentBlockNumber,
      preDeploymentBlockHash: observed.preDeploymentBlockHash,
      preDeploymentRuntimeCodeHash: EMPTY_RUNTIME_CODE_HASH,
      deploymentBlockNumber: observed.deploymentBlockNumber,
      deploymentBlockHash: observed.deploymentBlockHash,
      deploymentRuntimeCodeHash: expected.runtimeCodeHash,
    };
    return {
      ...normalized,
      evidenceDigest: framedSha256(DOMAINS.runtimeTransition, normalized),
    };
  });
  if (providerReadbacks[0].preDeploymentBlockHash
      !== providerReadbacks[1].preDeploymentBlockHash) {
    throw new TypeError(`${contract} providers disagree on the D-1 block hash`);
  }
  const state = {
    contract,
    address: expected.address,
    runtimeCodeHash: expected.runtimeCodeHash,
    previousBlockRuntimeCodeHash: EMPTY_RUNTIME_CODE_HASH,
    providerReadbacks,
  };
  return {
    ...state,
    stateEvidenceDigest: framedSha256(DOMAINS.resultState, state),
  };
}

function buildPermit2Provenance(providers) {
  const providerReadbacks = providers.map((provider) => {
    const normalized = {
      schemaVersion: DOMAINS.permit2Readback,
      providerId: provider.providerId,
      trustDomain: provider.trustDomain,
      blockNumber: "0",
      blockHash: provider.permit2Genesis.blockHash,
      runtimeCodeHash: ROOTS.permit2.runtimeCodeHash,
    };
    return {
      ...normalized,
      evidenceDigest: framedSha256(DOMAINS.permit2Readback, normalized),
    };
  });
  if (providerReadbacks[0].blockHash !== providerReadbacks[1].blockHash) {
    throw new TypeError("Permit2 providers disagree on the Robinhood genesis block hash");
  }
  const normalized = {
    schemaVersion: DOMAINS.permit2,
    kind: "genesis-predeploy",
    address: ROOTS.permit2.address,
    startBlock: "0",
    genesisSourceUrl: PERMIT2_GENESIS_SOURCE_URL,
    genesisSourceDigest: PERMIT2_GENESIS_SOURCE_DIGEST,
    allocRuntimeCodeBytes: PERMIT2_GENESIS_RUNTIME_CODE_BYTES,
    providerReadbacks,
  };
  return { ...normalized, evidenceDigest: framedSha256(DOMAINS.permit2, normalized) };
}

function buildExternalRootEvidence(providers) {
  return EXTERNAL_ROOT_NAMES.map((contract, index) => {
    const expected = EXTERNAL_ROOTS[contract];
    const providerReadbacks = providers.map((provider) => {
      const observed = provider.externalRoots[index];
      const normalized = {
        providerId: provider.providerId,
        trustDomain: provider.trustDomain,
        transactionHash: expected.transactionHash,
        blockNumber: expected.startBlock,
        blockHash: observed.blockHash,
        runtimeCodeHash: expected.runtimeCodeHash,
        transactionReceiptDigest: observed.transactionReceiptDigest,
      };
      return {
        ...normalized,
        evidenceDigest: framedSha256(DOMAINS.externalReadback, normalized),
      };
    });
    if (providerReadbacks[0].blockHash !== providerReadbacks[1].blockHash
      || providerReadbacks[0].transactionReceiptDigest
        !== providerReadbacks[1].transactionReceiptDigest) {
      throw new TypeError(`${contract} providers disagree on its deployment receipt`);
    }
    const normalized = {
      schemaVersion: DOMAINS.deploymentEvidence,
      contract,
      kind: "exact-observed-deployment",
      address: expected.address,
      runtimeCodeHash: expected.runtimeCodeHash,
      transactionHash: expected.transactionHash,
      startBlock: expected.startBlock,
      blockHash: providerReadbacks[0].blockHash,
      registrySource: UNISWAP_REGISTRY_SOURCE,
      providerReadbacks,
    };
    return {
      ...normalized,
      evidenceDigest: framedSha256(DOMAINS.deploymentEvidence, normalized),
    };
  });
}

function buildSafeEvidence(providers, atomicResult, ethereumFinalityEvidence) {
  const first = providers[0].safeState;
  deepEqual(first, providers[1].safeState, "Safe finalized state");
  const safeProviderDigests = providers.map((provider) => framedSha256(
    DOMAINS.safeProvider,
    {
      schemaVersion: DOMAINS.safeProvider,
      providerId: provider.providerId,
      trustDomain: provider.trustDomain,
      safeState: provider.safeState,
      routerState: provider.routerState,
      multicall3: provider.multicall3,
    },
  ));
  const configuration = {
    schemaVersion: DOMAINS.safeConfiguration,
    finalized: true,
    blockNumber: first.blockNumber,
    blockHash: first.blockHash,
    proxyRuntimeCodeHash: ROOTS.permitAuthority.runtimeCodeHash,
    singleton: {
      address: SAFE_SINGLETON,
      runtimeCodeHash: SAFE_SINGLETON_RUNTIME_CODE_HASH,
      version: "1.4.1",
      sourceCommitment: SAFE_SOURCE_COMMITMENT,
    },
    fallbackHandler: SAFE_FALLBACK_HANDLER,
    fallbackHandlerRuntimeCodeHash: SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH,
    owners: [...SAFE_OWNERS],
    threshold: 1,
    nonce: "0",
    modules: [],
    modulesNext: SAFE_MODULES_END_SENTINEL,
    guard: null,
    singletonSlot: first.singletonSlot,
    fallbackHandlerSlot: first.fallbackHandlerSlot,
    guardSlot: first.guardSlot,
    primaryProvider: { ...PROVIDERS[0], evidenceDigest: safeProviderDigests[0] },
    secondaryProvider: { ...PROVIDERS[1], evidenceDigest: safeProviderDigests[1] },
    atomicRootStateEvidenceDigest: atomicResult.stateEvidenceDigest,
    ethereumFinalityEvidence,
  };
  const configurationEvidence = {
    ...configuration,
    evidenceDigest: framedSha256(DOMAINS.safeConfiguration, configuration),
  };
  const normalized = {
    schemaVersion: DOMAINS.deploymentEvidence,
    kind: "official-source-pinned",
    address: ROOTS.permitAuthority.address,
    transactionHash: providers[0].transaction.hash,
    blockNumber: providers[0].transaction.blockNumber,
    blockHash: providers[0].transaction.blockHash,
    sourceCommitment: SAFE_SOURCE_COMMITMENT,
    configurationEvidence,
  };
  return {
    ...normalized,
    evidenceDigest: framedSha256(DOMAINS.deploymentEvidence, normalized),
  };
}

function buildAtomicDeploymentEvidence(providers, results, ethereumFinalityEvidence) {
  const transaction = providers[0].transaction;
  const receipt = providers[0].receipt;
  const providerReadbacks = providers.map((provider) => {
    const transactionResponseDigest = framedSha256(DOMAINS.transaction, provider.transaction);
    const transactionReceiptDigest = framedSha256(DOMAINS.receipt, provider.receipt);
    const normalized = {
      providerId: provider.providerId,
      trustDomain: provider.trustDomain,
      transactionHash: transaction.hash,
      transactionResponseDigest,
      transactionReceiptDigest,
    };
    return {
      ...normalized,
      evidenceDigest: framedSha256(DOMAINS.atomicProvider, normalized),
    };
  });
  const receiptLogs = receipt.logs;
  const normalized = {
    schemaVersion: DOMAINS.atomicDeployment,
    deploymentId: CHAIN_DEPLOYMENT_ID,
    chainId: CHAIN_ID,
    coveredContracts: [
      "programmableLaunchStampRouter", "graphFactory", "permitAuthority",
    ],
    transactionHash: transaction.hash,
    from: transaction.from,
    to: MULTICALL3_ADDRESS,
    valueWei: "0",
    selector: MULTICALL3_SELECTOR,
    calldataHash: OWNER_CALLDATA_HASH,
    calldataBytes: OWNER_CALLDATA_BYTES,
    nonce: transaction.nonce,
    transactionIndex: transaction.transactionIndex,
    receiptStatus: "1",
    blockNumber: transaction.blockNumber,
    blockHash: transaction.blockHash,
    receiptLogs,
    receiptLogsDigest: framedSha256(DOMAINS.receiptLogs, receiptLogs),
    providerReadbacks,
    resultingContracts: results,
    ethereumFinalityEvidence,
    sourceVerification: {
      sourcifyExactMatchCoveredContracts: [
        "programmableLaunchStampRouter", "graphFactory",
      ],
      officialSourcePinnedCoveredContracts: ["permitAuthority"],
    },
  };
  return {
    ...normalized,
    evidenceDigest: framedSha256(DOMAINS.atomicDeployment, normalized),
  };
}

export function buildRobinhoodChainDeployment({ input, profile }) {
  assertExactKeys(input, [
    "schemaVersion", "chainDeploymentId", "providers", "ethereumFinality",
    "sourceVerification", "sourceClosure",
  ], "postdeployment input");
  if (input.schemaVersion !== ROBINHOOD_POSTDEPLOYMENT_INPUT_SCHEMA
    || input.chainDeploymentId !== CHAIN_DEPLOYMENT_ID
    || !Array.isArray(input.providers) || input.providers.length !== 2) {
    throw new TypeError("postdeployment input must bind the exact Robinhood foundation");
  }
  const providers = input.providers.map(normalizeProvider);
  deepEqual(providers[0].transaction, providers[1].transaction, "foundation transaction");
  deepEqual(providers[0].receipt, providers[1].receipt, "foundation receipt");
  deepEqual(providers[0].routerState, providers[1].routerState, "Router finalized state");
  deepEqual(providers[0].multicall3, providers[1].multicall3, "Multicall3 finalized code");
  const blockNumber = providers[0].transaction.blockNumber;
  const blockHash = providers[0].transaction.blockHash;
  const ethereumFinalityEvidence = normalizeFinalityInput(
    input.ethereumFinality,
    profile,
    blockNumber,
    blockHash,
  );
  const resultingContracts = ATOMIC_ROOT_NAMES.map((contract, index) =>
    buildAtomicResult(providers, contract, index));
  const permit2GenesisProvenance = buildPermit2Provenance(providers);
  const externalRootDeploymentEvidence = buildExternalRootEvidence(providers);
  const permitAuthoritySourceProvenance = buildSafeEvidence(
    providers,
    resultingContracts[0],
    ethereumFinalityEvidence,
  );
  const deploymentEvidence = buildAtomicDeploymentEvidence(
    providers,
    resultingContracts,
    ethereumFinalityEvidence,
  );
  const descriptor = {
    schemaVersion: "programmable.custom-launch-chain-deployment.v1",
    chainDeploymentId: CHAIN_DEPLOYMENT_ID,
    chainId: CHAIN_ID,
    caip2: CAIP2,
    finality: FINALITY,
    foundationSourceCommitment: FOUNDATION_SOURCE_COMMITMENT,
    deploymentEvidence,
    permit2GenesisProvenance,
    permitAuthoritySourceProvenance,
    externalRootDeploymentEvidence,
    contracts: Object.fromEntries(Object.entries(ROOTS).map(([name, binding]) => [
      name,
      { address: binding.address, runtimeCodeHash: binding.runtimeCodeHash },
    ])),
  };
  const normalizedDescriptor = normalizeV4ChainDeployment(descriptor);
  const sourceVerification = normalizeSourceVerification(input.sourceVerification);
  return {
    descriptor: normalizedDescriptor,
    chainDeploymentDescriptorDigest: hashV4ChainDeployment(normalizedDescriptor),
    providers,
    sourceVerification,
    sourceClosureInput: input.sourceClosure,
    normalizedInput: {
      schemaVersion: ROBINHOOD_POSTDEPLOYMENT_INPUT_SCHEMA,
      chainDeploymentId: CHAIN_DEPLOYMENT_ID,
      providers,
      ethereumFinality: input.ethereumFinality,
      sourceVerification: input.sourceVerification,
      sourceClosure: input.sourceClosure,
    },
  };
}

function git(repositoryRoot, args, label) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new TypeError(`${label}: ${result.stderr?.toString("utf8").trim() || "git failed"}`);
  }
  return result.stdout;
}

function buildSourceClosure(repositoryRoot, input, foundationSourceCommitment) {
  assertExactKeys(input, ["repository", "branch", "revision", "tree"], "sourceClosure");
  if (input.repository !== "programmablehq/PROGRAMMABLE" || input.branch !== "production"
    || typeof input.revision !== "string" || !/^[0-9a-f]{40}$/u.test(input.revision)
    || typeof input.tree !== "string" || !/^[0-9a-f]{40}$/u.test(input.tree)) {
    throw new TypeError("sourceClosure must bind an exact production revision and tree");
  }
  const revision = git(
    repositoryRoot,
    ["rev-parse", "--verify", `${input.revision}^{commit}`],
    "source closure revision",
  ).toString("utf8").trim();
  const tree = git(
    repositoryRoot,
    ["rev-parse", `${revision}^{tree}`],
    "source closure tree",
  ).toString("utf8").trim();
  if (revision !== input.revision || tree !== input.tree) {
    throw new TypeError("sourceClosure revision or tree does not resolve exactly");
  }
  git(
    repositoryRoot,
    ["merge-base", "--is-ancestor", revision, "refs/heads/production"],
    "source closure revision is not on local production",
  );
  const paths = [...V4_RELEASE_REQUIRED_SOURCE_PATHS].sort(compareUtf8);
  const entries = paths.map((relativePath) => {
    const currentBytes = readFileSync(resolveInside(repositoryRoot, relativePath));
    const revisionBytes = git(
      repositoryRoot,
      ["show", `${revision}:${relativePath}`],
      `source closure entry ${relativePath}`,
    );
    if (!currentBytes.equals(revisionBytes)) {
      throw new TypeError(`source closure entry ${relativePath} differs from ${revision}`);
    }
    return {
      path: relativePath,
      byteLength: String(currentBytes.byteLength),
      sha256: sha256Digest(currentBytes),
    };
  });
  const normalized = {
    schemaVersion: "programmable.launch-cli-v4-source-closure.v1",
    repository: "programmablehq/PROGRAMMABLE",
    branch: "production",
    revision,
    tree,
    foundationSourceCommitment,
    entries,
    sourceClosureDigest: null,
  };
  normalized.sourceClosureDigest = computeV4SourceClosureDigest(normalized);
  return normalized;
}

function bindSourceVerificationToClosure(repositoryRoot, sourceVerification, sourceClosure) {
  const bindings = [
    {
      contract: "graphFactory",
      standardJsonPath:
        "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
      sourcePath: "contracts/src/ProgrammableCreate2GraphDeployerV1.sol",
      compilerSourcePath: "src/ProgrammableCreate2GraphDeployerV1.sol",
    },
    {
      contract: "programmableLaunchStampRouter",
      standardJsonPath:
        "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
      sourcePath: "contracts/src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol",
      compilerSourcePath: "src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol",
    },
  ];
  const entries = new Map(sourceClosure.entries.map((entry) => [entry.path, entry]));
  for (const binding of bindings) {
    const standardJsonEntry = entries.get(binding.standardJsonPath);
    const sourceEntry = entries.get(binding.sourcePath);
    if (standardJsonEntry?.sha256
        !== sourceVerification[binding.contract].standardJsonInputSha256) {
      throw new TypeError(
        `${binding.contract} source verification does not bind the production Standard JSON bytes`,
      );
    }
    const standardJson = JSON.parse(
      readFileSync(resolveInside(repositoryRoot, binding.standardJsonPath), "utf8"),
    );
    const sourceContent = standardJson?.sources?.[binding.compilerSourcePath]?.content;
    if (typeof sourceContent !== "string"
      || sourceEntry?.sha256 !== sha256Digest(Buffer.from(sourceContent, "utf8"))) {
      throw new TypeError(
        `${binding.contract} production source differs from its verified Standard JSON closure`,
      );
    }
  }
}

function buildReleaseBinding({ template, descriptor, descriptorDigest, sourceClosure }) {
  const deployment = {
    schemaVersion: "programmable.launch-cli-v4-chain-deployment-binding.v1",
    descriptor,
    descriptorDigest,
    bindingDigest: null,
  };
  deployment.bindingDigest = computeV4ChainDeploymentBindingDigest(deployment);
  const profile = {
    schemaVersion: "programmable.launch-cli-v4-profile-evidence.v1",
    profile: structuredClone(template.releaseIdentity.profile),
    chainDeploymentDescriptorDigest: descriptorDigest,
    fundingModes: ["none", "wallet-transaction-value"],
    capabilities: {
      feeBehaviorClaim: false,
      universalFeeBehaviorClaim: false,
      genericClaimingLive: false,
      buybacksLive: false,
    },
    profileEvidenceDigest: null,
  };
  profile.profileEvidenceDigest = computeV4ProfileEvidenceDigest(profile);
  const atomic = descriptor.deploymentEvidence;
  const finality = {
    schemaVersion: "programmable.launch-cli-v4-finality-evidence.v1",
    chainDeploymentDescriptorDigest: descriptorDigest,
    deploymentTransactionHash: atomic.transactionHash,
    l2Checkpoint: {
      blockNumber: atomic.blockNumber,
      blockHash: atomic.blockHash,
    },
    ethereumFinalityEvidence: structuredClone(atomic.ethereumFinalityEvidence),
    finalityEvidenceDigest: null,
  };
  finality.finalityEvidenceDigest = computeV4FinalityEvidenceDigest(finality);
  const manifest = {
    schemaVersion: "programmable.launch-cli-v4-release-manifest.v1",
    releaseIdentity: structuredClone(template.releaseIdentity),
    chainId: CHAIN_ID,
    caip2: CAIP2,
    chainDeploymentId: CHAIN_DEPLOYMENT_ID,
    chainDeploymentDescriptorDigest: descriptorDigest,
    chainDeploymentBindingDigest: deployment.bindingDigest,
    profileEvidenceDigest: profile.profileEvidenceDigest,
    sourceRevision: sourceClosure.revision,
    sourceTree: sourceClosure.tree,
    sourceClosureDigest: sourceClosure.sourceClosureDigest,
    deploymentTransactionHash: atomic.transactionHash,
    deploymentBlockHash: atomic.blockHash,
    finalityEvidenceDigest: finality.finalityEvidenceDigest,
    machineContracts: template.machineContracts.map(({ name, sha256 }) => ({ name, sha256 })),
    releaseManifestDigest: null,
  };
  manifest.releaseManifestDigest = computeV4ReleaseManifestDigest(manifest);
  return {
    ...structuredClone(template),
    releaseReady: true,
    chain: {
      chainId: CHAIN_ID,
      caip2: CAIP2,
      chainDeploymentId: CHAIN_DEPLOYMENT_ID,
      chainDeploymentDescriptorDigest: descriptorDigest,
    },
    evidence: {
      chainDeployment: deployment,
      profile,
      manifest,
      source: sourceClosure,
      finality,
    },
    blockers: [],
  };
}

function buildConsumerInputs({ descriptor, descriptorDigest, binding, sourceVerification }) {
  const atomic = descriptor.deploymentEvidence;
  const source = binding.evidence.source;
  const finalityEvidence = binding.evidence.finality;
  const standardJsonInputs = source.entries.filter(({ path: relativePath }) =>
    relativePath.includes("/standard-json/")).map(({ path: relativePath, sha256 }) => ({
    path: relativePath,
    sha256,
  }));
  const rootAtStartBlock = (name) => ({
    address: descriptor.contracts[name].address,
    runtimeCodeHash: descriptor.contracts[name].runtimeCodeHash,
    startBlock: atomic.blockNumber,
  });
  return {
    indexer: {
      schemaVersion: "programmable.robinhood-custom-launch.indexer-bootstrap.v1",
      chainId: CHAIN_ID,
      caip2: CAIP2,
      chainDeploymentId: CHAIN_DEPLOYMENT_ID,
      chainDeploymentDescriptorDigest: descriptorDigest,
      router: rootAtStartBlock("programmableLaunchStampRouter"),
      graphFactory: rootAtStartBlock("graphFactory"),
      permitAuthority: rootAtStartBlock("permitAuthority"),
      finalizedCheckpoint: {
        blockNumber: atomic.blockNumber,
        blockHash: atomic.blockHash,
      },
      finalityEvidenceDigest: finalityEvidence.finalityEvidenceDigest,
      sourceRevision: source.revision,
      sourceTree: source.tree,
      sourceClosureDigest: source.sourceClosureDigest,
      standardJsonInputs,
    },
    cli: {
      schemaVersion: "programmable.robinhood-custom-launch.cli-promotion-input.v1",
      chainDeploymentId: CHAIN_DEPLOYMENT_ID,
      chainDeploymentDescriptorDigest: descriptorDigest,
      chainDeploymentPath: ROBINHOOD_LIVE_DEPLOYMENT_PATH,
      releaseBindingPath: V4_RELEASE_BINDING_PATH,
      profile: structuredClone(binding.releaseIdentity.profile),
      releaseManifestDigest: binding.evidence.manifest.releaseManifestDigest,
    },
    developers: {
      schemaVersion: "programmable.robinhood-custom-launch.developers-promotion-input.v1",
      status: "ethereum-finalized-source-closed",
      publicAuthorization: false,
      publicWrites: false,
      chainId: CHAIN_ID,
      caip2: CAIP2,
      chainDeploymentId: CHAIN_DEPLOYMENT_ID,
      chainDeploymentDescriptorDigest: descriptorDigest,
      startBlock: atomic.blockNumber,
      finalizedCheckpoint: {
        blockNumber: atomic.blockNumber,
        blockHash: atomic.blockHash,
      },
      finalityPolicy: FINALITY,
      roots: structuredClone(descriptor.contracts),
      sourceVerificationEvidenceDigest: sourceVerification.evidenceDigest,
      sourceRevision: source.revision,
      sourceTree: source.tree,
      sourceClosureDigest: source.sourceClosureDigest,
    },
  };
}

function artifact(pathValue, value) {
  const bytes = canonicalJsonBytes(value);
  return {
    path: pathValue,
    sha256: sha256Digest(bytes),
    byteLength: String(bytes.byteLength),
    value,
  };
}

export function materializeRobinhoodPromotionBundle({ repositoryRoot, input }) {
  const root = realpathSync(path.resolve(repositoryRoot));
  const prepared = readPreparedArtifact(root);
  const templateAudit = auditV4ReleaseBinding({ repositoryRoot: root });
  const template = templateAudit.binding;
  const profile = normalizeV4ProfileRef(template.releaseIdentity.profile);
  const deployment = buildRobinhoodChainDeployment({ input, profile });
  const sourceClosure = buildSourceClosure(
    root,
    deployment.sourceClosureInput,
    deployment.descriptor.foundationSourceCommitment,
  );
  bindSourceVerificationToClosure(root, deployment.sourceVerification, sourceClosure);
  const binding = buildReleaseBinding({
    template,
    descriptor: deployment.descriptor,
    descriptorDigest: deployment.chainDeploymentDescriptorDigest,
    sourceClosure,
  });
  const consumerInputs = buildConsumerInputs({
    descriptor: deployment.descriptor,
    descriptorDigest: deployment.chainDeploymentDescriptorDigest,
    binding,
    sourceVerification: deployment.sourceVerification,
  });
  const normalized = {
    schemaVersion: ROBINHOOD_PROMOTION_BUNDLE_SCHEMA,
    state: "closed-awaiting-separate-runtime-promotion",
    chainDeploymentId: CHAIN_DEPLOYMENT_ID,
    inputEvidenceDigest: framedSha256(
      ROBINHOOD_POSTDEPLOYMENT_INPUT_SCHEMA,
      deployment.normalizedInput,
    ),
    preparedArtifact: {
      path: ROBINHOOD_PREDEPLOYMENT_PATH,
      sha256: sha256Digest(prepared.bytes),
      state: "prepared-not-broadcast",
      preserved: true,
    },
    sourceVerification: deployment.sourceVerification,
    sourceClosure,
    finalizedBindings: {
      chainId: CHAIN_ID,
      caip2: CAIP2,
      chainDeploymentId: CHAIN_DEPLOYMENT_ID,
      chainDeploymentDescriptorDigest: deployment.chainDeploymentDescriptorDigest,
      deploymentTransactionHash: deployment.descriptor.deploymentEvidence.transactionHash,
      deploymentBlockNumber: deployment.descriptor.deploymentEvidence.blockNumber,
      deploymentBlockHash: deployment.descriptor.deploymentEvidence.blockHash,
      startBlock: deployment.descriptor.deploymentEvidence.blockNumber,
      finalityEvidenceDigest: binding.evidence.finality.finalityEvidenceDigest,
      sourceClosureDigest: sourceClosure.sourceClosureDigest,
      releaseManifestDigest: binding.evidence.manifest.releaseManifestDigest,
    },
    artifacts: {
      liveDeployment: artifact(ROBINHOOD_LIVE_DEPLOYMENT_PATH, deployment.descriptor),
      cliReleaseBinding: artifact(V4_RELEASE_BINDING_PATH, binding),
    },
    consumerInputs,
  };
  return {
    ...normalized,
    promotionBundleDigest: framedSha256(DOMAINS.bundle, normalized),
  };
}

function verifySourceClosure(repositoryRoot, value) {
  const rebuilt = buildSourceClosure(repositoryRoot, {
    repository: value.repository,
    branch: value.branch,
    revision: value.revision,
    tree: value.tree,
  }, FOUNDATION_SOURCE_COMMITMENT);
  deepEqual(value, rebuilt, "promotion source closure");
}

function verifyReleaseBindingValue(template, binding, descriptor, sourceClosure) {
  const expected = buildReleaseBinding({
    template,
    descriptor,
    descriptorDigest: hashV4ChainDeployment(descriptor),
    sourceClosure,
  });
  deepEqual(binding, expected, "promotion release binding");
}

export function verifyRobinhoodPromotionBundle({ repositoryRoot, bundle }) {
  const root = realpathSync(path.resolve(repositoryRoot));
  assertExactKeys(bundle, [
    "schemaVersion", "state", "chainDeploymentId", "inputEvidenceDigest",
    "preparedArtifact", "sourceVerification", "sourceClosure", "finalizedBindings",
    "artifacts", "consumerInputs", "promotionBundleDigest",
  ], "promotion bundle");
  if (bundle.schemaVersion !== ROBINHOOD_PROMOTION_BUNDLE_SCHEMA
    || bundle.state !== "closed-awaiting-separate-runtime-promotion"
    || bundle.chainDeploymentId !== CHAIN_DEPLOYMENT_ID) {
    throw new TypeError("promotion bundle identity is invalid");
  }
  exactSha256(bundle.inputEvidenceDigest, "promotion input evidence digest");
  assertExactKeys(bundle.preparedArtifact, ["path", "sha256", "state", "preserved"],
    "promotion preparedArtifact");
  if (bundle.preparedArtifact.path !== ROBINHOOD_PREDEPLOYMENT_PATH
    || bundle.preparedArtifact.sha256 !== PREDEPLOYMENT_SHA256
    || bundle.preparedArtifact.state !== "prepared-not-broadcast"
    || bundle.preparedArtifact.preserved !== true) {
    throw new TypeError("promotion bundle does not preserve the exact prepared artifact");
  }
  readPreparedArtifact(root);
  const { evidenceDigest: suppliedSourceVerificationDigest, ...sourceVerificationInput } =
    bundle.sourceVerification;
  const sourceVerification = normalizeSourceVerification(sourceVerificationInput);
  if (sourceVerification.evidenceDigest !== suppliedSourceVerificationDigest) {
    throw new TypeError("source verification closure digest differs");
  }
  verifySourceClosure(root, bundle.sourceClosure);
  bindSourceVerificationToClosure(root, sourceVerification, bundle.sourceClosure);
  assertExactKeys(bundle.artifacts, ["liveDeployment", "cliReleaseBinding"],
    "promotion artifacts");
  for (const [name, expectedPath] of [
    ["liveDeployment", ROBINHOOD_LIVE_DEPLOYMENT_PATH],
    ["cliReleaseBinding", V4_RELEASE_BINDING_PATH],
  ]) {
    const entry = bundle.artifacts[name];
    assertExactKeys(entry, ["path", "sha256", "byteLength", "value"],
      `promotion artifacts.${name}`);
    const bytes = canonicalJsonBytes(entry.value);
    if (entry.path !== expectedPath || entry.sha256 !== sha256Digest(bytes)
      || entry.byteLength !== String(bytes.byteLength)) {
      throw new TypeError(`promotion artifacts.${name} bytes are invalid`);
    }
  }
  const descriptor = normalizeV4ChainDeployment(bundle.artifacts.liveDeployment.value);
  const descriptorDigest = hashV4ChainDeployment(descriptor);
  const template = auditV4ReleaseBinding({ repositoryRoot: root }).binding;
  verifyReleaseBindingValue(
    template,
    bundle.artifacts.cliReleaseBinding.value,
    descriptor,
    bundle.sourceClosure,
  );
  const expectedConsumers = buildConsumerInputs({
    descriptor,
    descriptorDigest,
    binding: bundle.artifacts.cliReleaseBinding.value,
    sourceVerification: bundle.sourceVerification,
  });
  deepEqual(bundle.consumerInputs, expectedConsumers, "promotion consumer inputs");
  const binding = bundle.artifacts.cliReleaseBinding.value;
  const expectedFinalizedBindings = {
    chainId: CHAIN_ID,
    caip2: CAIP2,
    chainDeploymentId: CHAIN_DEPLOYMENT_ID,
    chainDeploymentDescriptorDigest: descriptorDigest,
    deploymentTransactionHash: descriptor.deploymentEvidence.transactionHash,
    deploymentBlockNumber: descriptor.deploymentEvidence.blockNumber,
    deploymentBlockHash: descriptor.deploymentEvidence.blockHash,
    startBlock: descriptor.deploymentEvidence.blockNumber,
    finalityEvidenceDigest: binding.evidence.finality.finalityEvidenceDigest,
    sourceClosureDigest: bundle.sourceClosure.sourceClosureDigest,
    releaseManifestDigest: binding.evidence.manifest.releaseManifestDigest,
  };
  deepEqual(bundle.finalizedBindings, expectedFinalizedBindings, "promotion finalized bindings");
  const { promotionBundleDigest, ...withoutDigest } = bundle;
  if (promotionBundleDigest !== framedSha256(DOMAINS.bundle, withoutDigest)) {
    throw new TypeError("promotion bundle digest is invalid");
  }
  return Object.freeze({
    chainDeploymentDescriptorDigest: descriptorDigest,
    promotionBundleDigest,
    startBlock: descriptor.deploymentEvidence.blockNumber,
    releaseReady: true,
  });
}
