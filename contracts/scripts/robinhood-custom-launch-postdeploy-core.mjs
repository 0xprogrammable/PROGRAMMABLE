import { spawnSync } from "node:child_process";
import { realpathSync, readFileSync } from "node:fs";
import path from "node:path";

import { encodeAbiParameters, getAddress, parseAbiParameters } from "viem";

import {
  canonicalizeJson,
  parseStrictJson,
} from "../../packages/launch/src/canonical-json.mjs";
import {
  assertExactKeys,
  compareUtf8,
  decodeExactUtf8,
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
  validateV4BackendReleaseEvidence,
} from "../../scripts/programmable-launch-v4-release-binding.mjs";
import {
  ROBINHOOD_CAPTURE_CLOSURE_SCHEMA,
  validateRobinhoodProductionCapture,
} from "./robinhood-custom-launch-capture-v2.mjs";
import {
  validateRobinhoodBackendAuthorization,
  validateRobinhoodBackendCaptureAuthorization,
  validateRobinhoodBackendPromotionPublicInput,
  ROBINHOOD_BACKEND_CAPTURE_TRUST_CLASS,
} from "./robinhood-backend-promotion-v1.mjs";

export const ROBINHOOD_POSTDEPLOYMENT_INPUT_SCHEMA =
  "programmable.robinhood-custom-launch.postdeployment-input.v3";
export const ROBINHOOD_STAGE_BUNDLE_SCHEMA =
  "programmable.robinhood-custom-launch.stage-bundle.v1";
export const ROBINHOOD_PROMOTION_BUNDLE_SCHEMA =
  "programmable.robinhood-custom-launch.promotion-bundle.v2";
export const ROBINHOOD_STAGE_BUNDLE_PATH =
  "release/robinhood-chain-4663/programmable-stage-bundle.json";
export const ROBINHOOD_PROMOTION_BUNDLE_PATH =
  "release/robinhood-chain-4663/programmable-promotion-bundle.json";
export const ROBINHOOD_LIVE_DEPLOYMENT_PATH =
  "contracts/deployments/robinhood-custom-launch-v1.json";
export const ROBINHOOD_PREDEPLOYMENT_PATH =
  "contracts/deployments/robinhood-custom-launch-v1.predeployment.json";
export const ROBINHOOD_BACKEND_CHAIN_DEPLOYMENT_PATH =
  "release/robinhood-v4-chain-deployment.v1.json";
export const ROBINHOOD_BACKEND_SOURCE_MANIFEST_PATH =
  "release/robinhood-v4-prepared-root-source-manifest.v1.json";
export const ROBINHOOD_BACKEND_STANDARD_JSON_PATHS = Object.freeze({
  router:
    "release/assets/robinhood-v4/ProgrammableLaunchStampRouterV1.standard-input.json",
  graphFactory:
    "release/assets/robinhood-v4/ProgrammableCreate2GraphDeployerV1.standard-input.json",
});
export const ROBINHOOD_BACKEND_PHASE_A_STAGE_BUNDLE_PATH =
  "release/robinhood-v4-phase-a-stage-bundle.v1.json";
export const ROBINHOOD_BACKEND_PHASE_A_STAGE_ATTESTATION_PATH =
  "release/robinhood-v4-phase-a-stage-bundle.v1.attestation.json";
export const ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_PATH =
  "release/robinhood-v4-phase-a-production-capture.v3.json";
export const ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_ATTESTATION_PATH =
  "release/robinhood-v4-phase-a-production-capture.v3.attestation.json";

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
const EXACT_SOURCE_BUILD_TARGETS = Object.freeze([
  Object.freeze({
    contract: "programmableLaunchStampRouter",
    address: ROOTS.programmableLaunchStampRouter.address,
    standardJsonInputSha256:
      "sha256:6abca24d06b013599f4ff63e049976419c3f17455fa9bc343b15ec0d6e6a078a",
    creationCodeHash:
      "0xf4176bf15de19a93b76cd138d6525a30d68efdad356e831f6d8449659959eb39",
    runtimeCodeHash: ROOTS.programmableLaunchStampRouter.runtimeCodeHash,
  }),
  Object.freeze({
    contract: "graphFactory",
    address: ROOTS.graphFactory.address,
    standardJsonInputSha256:
      "sha256:8ab811a215d70b1d5aef0c71a47153173953ee78d7632725413833888369ec4d",
    creationCodeHash:
      "0x84f7cb8e9e445d3322249dbc2b9efc65bb9c7a8ba26902aafef9b0552f4bc208",
    runtimeCodeHash: ROOTS.graphFactory.runtimeCodeHash,
  }),
]);
const HOSTED_REPRODUCTION_COMPILER_SHA256 =
  "0xd5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef";

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
  externalReadback: "programmable.custom-launch-deployment-provider-readback.v2",
  sourceVerification:
    "programmable.robinhood-custom-launch.source-verification-closure.v5",
  exactSourceBinding:
    "programmable.robinhood-custom-launch.exact-byte-source-build-transaction-binding.v1",
  backendReleaseAssets:
    "programmable.robinhood-custom-launch.backend-release-assets.v1",
  stageBundle: ROBINHOOD_STAGE_BUNDLE_SCHEMA,
  promotionBundle: ROBINHOOD_PROMOTION_BUNDLE_SCHEMA,
});

const PROVIDERS = Object.freeze([
  Object.freeze({ providerId: "drpc", trustDomain: "drpc.org" }),
  Object.freeze({ providerId: "alchemy", trustDomain: "alchemy.com" }),
]);

function assertJsonBytesMatch(value, bytes, label, maximumBytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    throw new TypeError(`${label} bytes are empty or exceed the bounded input limit`);
  }
  const parsed = parseStrictJson(decodeExactUtf8(bytes, `${label} bytes`), {
    maximumBytes,
    maximumDepth: 256,
  });
  if (canonicalizeJson(parsed) !== canonicalizeJson(value)) {
    throw new TypeError(`${label} object differs from its exact authorized bytes`);
  }
  return bytes;
}

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
    "contract", "address", "preStartBlockNumber", "preStartBlockHash",
    "preStartBlockRuntimeCodeHash", "runtimeCodeHash", "transactionHash",
    "rawTransactionDigest", "transactionDigest", "startBlock", "blockHash",
    "transactionReceiptDigest",
  ], label);
  const expected = EXTERNAL_ROOTS[contract];
  if (value.contract !== contract || value.transactionHash !== expected.transactionHash
    || value.startBlock !== expected.startBlock
    || value.preStartBlockNumber !== (BigInt(expected.startBlock) - 1n).toString(10)
    || value.preStartBlockRuntimeCodeHash !== EMPTY_RUNTIME_CODE_HASH) {
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
    rawTransactionDigest: exactSha256(
      value.rawTransactionDigest,
      `${label}.rawTransactionDigest`,
    ),
    transactionDigest: exactSha256(value.transactionDigest, `${label}.transactionDigest`),
    preStartBlockNumber: value.preStartBlockNumber,
    preStartBlockHash: exactHex32(value.preStartBlockHash, `${label}.preStartBlockHash`),
    preStartBlockRuntimeCodeHash: EMPTY_RUNTIME_CODE_HASH,
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
    "ethereumFinalizedCheckpoint", "observedAt", "captureClosureDigest",
    "postingEventDigest", "l1EvidenceDigest",
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
    captureClosureDigest: exactSha256(
      value.captureClosureDigest,
      `${label}.captureClosureDigest`,
    ),
    postingEventDigest: exactSha256(
      value.postingEventDigest,
      `${label}.postingEventDigest`,
    ),
    l1EvidenceDigest: exactSha256(
      value.l1EvidenceDigest,
      `${label}.l1EvidenceDigest`,
    ),
  };
  return { ...normalized, evidenceDigest: framedSha256(DOMAINS.finality, normalized) };
}

function exactSourceBindingFromCapture(captureClosure) {
  const provider = captureClosure.l2ProviderReadbacks[0];
  const compilerSettingsByContract = new Map(
    captureClosure.sourcify.map((entry) => [
      entry.contract,
      entry.compiler.compilerSettingsDigest,
    ]),
  );
  const normalized = {
    schemaVersion: DOMAINS.exactSourceBinding,
    authority: "protected-hosted-build-finalized-transaction-bytecode",
    coveredContracts: EXACT_SOURCE_BUILD_TARGETS.map(({ contract }) => contract),
    sourceRevision: captureClosure.sourceOrigin.revision,
    sourceTree: captureClosure.sourceOrigin.tree,
    captureAuthorizationDigest: captureClosure.authorization.verificationDigest,
    productionVerifyProofSha256:
      captureClosure.authorization.productionVerifyProofSha256,
    productionVerifyArtifactDigest:
      captureClosure.authorization.productionVerifyArtifactDigest,
    compilerVersion: "0.8.26+commit.8a97fa7a",
    hostedReproductionCompilerSha256: HOSTED_REPRODUCTION_COMPILER_SHA256,
    deploymentTransactionHash: provider.transactionHash,
    deploymentBlockNumber: provider.deploymentBlock.blockNumber,
    deploymentBlockHash: provider.deploymentBlock.blockHash,
    ownerTransactionDataHash: OWNER_CALLDATA_HASH,
    contracts: EXACT_SOURCE_BUILD_TARGETS.map((target) => ({
      ...target,
      compilerSettingsDigest: compilerSettingsByContract.get(target.contract),
    })),
    bindingDigest: null,
  };
  if (normalized.contracts.some(({ compilerSettingsDigest }) =>
    typeof compilerSettingsDigest !== "string")) {
    throw new TypeError("exact source binding is missing compiler settings evidence");
  }
  normalized.bindingDigest = framedSha256(
    DOMAINS.exactSourceBinding,
    { ...normalized, bindingDigest: null },
  );
  return Object.freeze(normalized);
}

function normalizeSourceVerification(value, captureClosure) {
  const label = "sourceVerification";
  assertExactKeys(value, [
    "schemaVersion", "provider", "graphFactory", "programmableLaunchStampRouter",
    "providerReleaseAuthority", "exactSourceAuthority", "exactSourceBinding",
    "permitAuthority", "sourceVerificationClosureDigest",
  ], label);
  if (value.schemaVersion !== DOMAINS.sourceVerification || value.provider !== "sourcify-v2"
    || value.providerReleaseAuthority !== false
    || value.exactSourceAuthority
      !== "protected-hosted-build-finalized-transaction-bytecode") {
    throw new TypeError(`${label} must use the no-CBOR provider match plus exact byte binding`);
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
      "chainId", "address", "match", "creationMatch", "runtimeMatch", "observedAt",
      "providerClassification", "providerReleaseAuthority",
      "compiler", "sourceFilesDigest", "urlPath", "httpStatus",
      "contentType", "standardJsonInputPath",
      "standardJsonInputSha256", "normalizedVerificationDigest",
    ], entryLabel);
    assertExactKeys(entry.compiler, [
      "language", "compiler", "compilerVersion", "name", "fullyQualifiedName",
      "compilerSettingsDigest",
    ], `${entryLabel}.compiler`);
    if (entry.chainId !== CHAIN_ID || entry.match !== "match"
      || entry.creationMatch !== "match" || entry.runtimeMatch !== "match"
      || entry.providerClassification !== "PARTIAL_NO_CBOR_EXACT_BYTES"
      || entry.providerReleaseAuthority !== false
      || entry.httpStatus !== 200 || entry.contentType !== "application/json"
      || entry.standardJsonInputPath !== expected.standardJsonInputPath) {
      throw new TypeError(`${entryLabel} is not the no-CBOR provider source match`);
    }
    return [name, {
      chainId: CHAIN_ID,
      address: exactAddress(entry.address, `${entryLabel}.address`, expected.address),
      match: "match",
      creationMatch: "match",
      runtimeMatch: "match",
      providerClassification: "PARTIAL_NO_CBOR_EXACT_BYTES",
      providerReleaseAuthority: false,
      observedAt: isoDate(entry.observedAt, `${entryLabel}.observedAt`),
      compiler: {
        language: entry.compiler.language,
        compiler: entry.compiler.compiler,
        compilerVersion: entry.compiler.compilerVersion,
        name: entry.compiler.name,
        fullyQualifiedName: entry.compiler.fullyQualifiedName,
        compilerSettingsDigest: exactSha256(
          entry.compiler.compilerSettingsDigest,
          `${entryLabel}.compiler.compilerSettingsDigest`,
        ),
      },
      sourceFilesDigest: exactSha256(entry.sourceFilesDigest, `${entryLabel}.sourceFilesDigest`),
      urlPath: entry.urlPath,
      httpStatus: 200,
      contentType: "application/json",
      standardJsonInputPath: expected.standardJsonInputPath,
      standardJsonInputSha256: exactSha256(
        entry.standardJsonInputSha256,
        `${entryLabel}.standardJsonInputSha256`,
        expected.standardJsonInputSha256,
      ),
      normalizedVerificationDigest: exactSha256(
        entry.normalizedVerificationDigest,
        `${entryLabel}.normalizedVerificationDigest`,
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
  const exactSourceBinding = exactSourceBindingFromCapture(captureClosure);
  if (canonicalizeJson(value.exactSourceBinding) !== canonicalizeJson(exactSourceBinding)) {
    throw new TypeError(`${label}.exactSourceBinding differs from source/build/transaction bytes`);
  }
  const normalized = {
    schemaVersion: DOMAINS.sourceVerification,
    provider: "sourcify-v2",
    providerReleaseAuthority: false,
    exactSourceAuthority: "protected-hosted-build-finalized-transaction-bytecode",
    ...normalizedRoots,
    exactSourceBinding,
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
    sourceVerificationClosureDigest: exactSha256(
      value.sourceVerificationClosureDigest,
      `${label}.sourceVerificationClosureDigest`,
    ),
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
        rawTransactionDigest: observed.rawTransactionDigest,
        transactionDigest: observed.transactionDigest,
        previousBlockNumber: observed.preStartBlockNumber,
        previousBlockHash: observed.preStartBlockHash,
        previousBlockRuntimeCodeHash: observed.preStartBlockRuntimeCodeHash,
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
      || providerReadbacks[0].previousBlockHash !== providerReadbacks[1].previousBlockHash
      || providerReadbacks[0].rawTransactionDigest
        !== providerReadbacks[1].rawTransactionDigest
      || providerReadbacks[0].transactionDigest !== providerReadbacks[1].transactionDigest
      || providerReadbacks[0].transactionReceiptDigest
        !== providerReadbacks[1].transactionReceiptDigest) {
      throw new TypeError(`${contract} providers disagree on its exact deployment transition`);
    }
    const normalized = {
      schemaVersion: DOMAINS.deploymentEvidence,
      contract,
      kind: "exact-observed-deployment",
      address: expected.address,
      runtimeCodeHash: expected.runtimeCodeHash,
      transactionHash: expected.transactionHash,
      previousBlockNumber: providerReadbacks[0].previousBlockNumber,
      previousBlockHash: providerReadbacks[0].previousBlockHash,
      previousBlockRuntimeCodeHash: EMPTY_RUNTIME_CODE_HASH,
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
      sourcifyProviderMatchCoveredContracts: [
        "programmableLaunchStampRouter", "graphFactory",
      ],
      exactByteSourceBuildTransactionCoveredContracts: [
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

function finalityFromCapture(captureClosure) {
  const posting = captureClosure.postingEvent;
  return {
    schemaVersion: "programmable.robinhood-l2-checkpoint-ethereum-finality-input.v1",
    l2Checkpoint: structuredClone(captureClosure.l2Checkpoint),
    batchNumber: captureClosure.batchNumber,
    l2Providers: captureClosure.l2ProviderReadbacks.map((entry) => ({
      providerId: entry.identity.providerId,
      trustDomain: entry.identity.trustDomain,
      l1Confirmations: entry.l1Confirmations,
    })),
    ethereumProviders: captureClosure.ethereumProviderReadbacks.map((entry) => ({
      providerId: entry.identity.providerId,
      trustDomain: entry.identity.trustDomain,
    })),
    rollup: ROLLUP,
    sequencerInbox: SEQUENCER_INBOX,
    postingTransactionHash: posting.transactionHash,
    postingBlockNumber: posting.blockNumber,
    postingBlockHash: posting.blockHash,
    postingLogIndex: posting.logIndex,
    ethereumFinalizedCheckpoint: structuredClone(captureClosure.ethereumFinalizedCheckpoint),
    observedAt: captureClosure.observedAt,
    captureClosureDigest: captureClosure.captureClosureDigest,
    postingEventDigest: framedSha256(
      "programmable.robinhood-custom-launch.sequencer-posting-event.v1",
      posting,
    ),
    l1EvidenceDigest: framedSha256(
      "programmable.robinhood-custom-launch.ethereum-finality-readbacks.v1",
      captureClosure.ethereumProviderReadbacks,
    ),
  };
}

function sourceVerificationFromCapture(captureClosure) {
  const entries = Object.fromEntries(captureClosure.sourcify.map((entry) => [entry.contract, {
    chainId: entry.chainId,
    address: entry.address,
    match: entry.match,
    creationMatch: entry.creationMatch,
    runtimeMatch: entry.runtimeMatch,
    providerClassification: entry.providerClassification,
    providerReleaseAuthority: entry.providerReleaseAuthority,
    observedAt: entry.observedAt,
    compiler: structuredClone(entry.compiler),
    sourceFilesDigest: entry.sourceFilesDigest,
    urlPath: entry.urlPath,
    httpStatus: entry.httpStatus,
    contentType: entry.contentType,
    standardJsonInputPath: entry.standardJsonInputPath,
    standardJsonInputSha256: entry.standardJsonInputSha256,
    normalizedVerificationDigest: entry.normalizedVerificationDigest,
  }]));
  return {
    schemaVersion: DOMAINS.sourceVerification,
    provider: "sourcify-v2",
    providerReleaseAuthority: false,
    exactSourceAuthority: "protected-hosted-build-finalized-transaction-bytecode",
    ...entries,
    exactSourceBinding: exactSourceBindingFromCapture(captureClosure),
    permitAuthority: {
      address: ROOTS.permitAuthority.address,
      kind: "official-source-pinned",
      sourceCommitment: SAFE_SOURCE_COMMITMENT,
    },
    sourceVerificationClosureDigest: captureClosure.sourceVerificationClosureDigest,
  };
}

export async function buildRobinhoodChainDeployment({
  input,
  inputBytes,
  profile,
  repositoryRoot,
  captureAuthorization,
  captureDependencies = {},
}) {
  assertJsonBytesMatch(input, inputBytes, "postdeployment input", 128 * 1024 * 1024);
  assertExactKeys(input, [
    "schemaVersion", "chainDeploymentId", "providers", "sourceClosure", "capture",
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
  const captureClosure = await validateRobinhoodProductionCapture({
    capture: input.capture,
    captureBytes: inputBytes,
    repositoryRoot,
    normalizedProviders: providers,
    authorization: captureAuthorization,
    readFile: (root, relativePath) => readFileSync(resolveInside(root, relativePath)),
    ...captureDependencies,
  });
  const blockNumber = providers[0].transaction.blockNumber;
  const blockHash = providers[0].transaction.blockHash;
  const ethereumFinalityEvidence = normalizeFinalityInput(
    finalityFromCapture(captureClosure),
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
  const sourceVerificationInput = sourceVerificationFromCapture(captureClosure);
  const sourceVerification = normalizeSourceVerification(
    sourceVerificationInput,
    captureClosure,
  );
  return {
    descriptor: normalizedDescriptor,
    chainDeploymentDescriptorDigest: hashV4ChainDeployment(normalizedDescriptor),
    providers,
    sourceVerification,
    captureClosure,
    sourceClosureInput: input.sourceClosure,
    normalizedInput: {
      schemaVersion: ROBINHOOD_POSTDEPLOYMENT_INPUT_SCHEMA,
      chainDeploymentId: CHAIN_DEPLOYMENT_ID,
      providers,
      sourceClosure: input.sourceClosure,
      captureClosureDigest: captureClosure.captureClosureDigest,
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

function buildSourceClosure(
  repositoryRoot,
  input,
  foundationSourceCommitment,
  sourceVerificationClosureDigest,
  { historicalReplay = false } = {},
) {
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
  const head = git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"],
    "source closure HEAD").toString("utf8").trim();
  const protectedRemote = git(
    repositoryRoot,
    ["rev-parse", "--verify", "refs/remotes/origin/production^{commit}"],
    "source closure protected origin/production",
  ).toString("utf8").trim();
  if (historicalReplay) {
    git(repositoryRoot, ["merge-base", "--is-ancestor", revision, head],
      "source closure protected ancestry");
    if (protectedRemote !== head) {
      throw new TypeError("source closure requires protected origin/production at current HEAD");
    }
  } else if (head !== revision || protectedRemote !== revision) {
    throw new TypeError("source closure requires HEAD and protected origin/production at revision");
  }
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
    repositoryId: "1314365508",
    branch: "production",
    protectedRef: "refs/heads/production",
    revision,
    tree,
    foundationSourceCommitment,
    entries,
    sourceVerificationClosureDigest: exactSha256(
      sourceVerificationClosureDigest,
      "source verification response closure digest",
    ),
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
  return {
    ...structuredClone(template),
    releaseReady: false,
    chain: {
      chainId: CHAIN_ID,
      caip2: CAIP2,
      chainDeploymentId: CHAIN_DEPLOYMENT_ID,
      chainDeploymentDescriptorDigest: descriptorDigest,
    },
    evidence: {
      chainDeployment: deployment,
      profile,
      manifest: null,
      source: sourceClosure,
      finality,
      backend: null,
    },
    blockers: ["releaseManifestEvidence", "backendReleaseEvidence"],
  };
}

function buildBackendReleaseAssets({
  repositoryRoot,
  descriptor,
  descriptorDigest,
  captureClosure,
}) {
  const sourceByContract = Object.fromEntries(
    captureClosure.sourcify.map((entry) => [entry.contract, entry]),
  );
  const transactionHash = descriptor.deploymentEvidence.transactionHash;
  const finalizedBlockNumber = descriptor.deploymentEvidence.blockNumber;
  const chainDeployment = artifact(ROBINHOOD_BACKEND_CHAIN_DEPLOYMENT_PATH, descriptor);
  const targets = [
    {
      contract: "router",
      captureKey: "programmableLaunchStampRouter",
      targetId: "robinhood-v4-programmable-launch-stamp-router",
      backendPath: ROBINHOOD_BACKEND_STANDARD_JSON_PATHS.router,
      constructorArguments: encodeAbiParameters(parseAbiParameters("address,address,address"), [
        descriptor.contracts.permitAuthority.address,
        descriptor.contracts.graphFactory.address,
        descriptor.contracts.poolManager.address,
      ]),
    },
    {
      contract: "graphFactory",
      captureKey: "graphFactory",
      targetId: "robinhood-v4-programmable-create2-graph-deployer",
      backendPath: ROBINHOOD_BACKEND_STANDARD_JSON_PATHS.graphFactory,
      constructorArguments: "0x",
    },
  ];
  const standardJsonInputs = targets.map((target) => {
    const source = sourceByContract[target.captureKey];
    if (source === undefined) {
      throw new TypeError(`backend source asset is missing ${target.captureKey}`);
    }
    const bytes = readFileSync(resolveInside(repositoryRoot, source.standardJsonInputPath));
    if (sha256Digest(bytes) !== source.standardJsonInputSha256) {
      throw new TypeError(`backend source asset changed for ${target.captureKey}`);
    }
    return {
      target,
      source,
      artifact: binaryArtifact(target.backendPath, bytes),
    };
  });
  const jobs = standardJsonInputs.map(({ target, source }) => ({
    contract: target.contract,
    verificationJobId:
      `robinhood-v4-${target.contract}-${captureClosure.captureId.slice(0, 16)}`,
    requestId: captureClosure.captureId,
    attemptNumber: 1,
    targetId: target.targetId,
    address: source.address,
    expectedRuntimeCodeHash: descriptor.contracts[target.captureKey].runtimeCodeHash,
    compilerVersion: source.compiler.compilerVersion,
    standardJsonInputPath: target.backendPath.slice("release/".length),
    standardJsonInputSha256: source.standardJsonInputSha256,
    sourcePath: source.compiler.fullyQualifiedName.split(":", 1)[0],
    contractName: source.compiler.name,
    constructorArguments: target.constructorArguments,
    artifactHash: framedSha256(
      "programmable.robinhood-custom-launch.backend-source-job-artifact.v1",
      {
        chainDeploymentDescriptorDigest: descriptorDigest,
        contract: target.contract,
        address: source.address,
        runtimeCodeHash: descriptor.contracts[target.captureKey].runtimeCodeHash,
        standardJsonInputSha256: source.standardJsonInputSha256,
      },
    ),
    verificationBundleHash: captureClosure.sourceVerificationClosureDigest,
    finalizedBlockNumber,
    creationTransactionHash: transactionHash,
  }));
  const sourceManifest = artifact(ROBINHOOD_BACKEND_SOURCE_MANIFEST_PATH, {
    schemaVersion: "programmable.robinhood-prepared-root-source-manifest.v1",
    providerProfileDigest: captureClosure.profileDigest,
    jobs,
  });
  const normalized = {
    schemaVersion: DOMAINS.backendReleaseAssets,
    state: "phase-a-closed",
    publicAuthorization: false,
    chainDeploymentDescriptorDigest: descriptorDigest,
    chainDeployment: {
      path: chainDeployment.path,
      sha256: chainDeployment.sha256,
      byteLength: chainDeployment.byteLength,
    },
    preparedRootSourceManifest: {
      path: sourceManifest.path,
      sha256: sourceManifest.sha256,
      byteLength: sourceManifest.byteLength,
    },
    standardJsonInputs: standardJsonInputs.map(({ target, artifact: value }) => ({
      contract: target.contract,
      path: value.path,
      sha256: value.sha256,
      byteLength: value.byteLength,
    })),
    backendRuntimeReadinessRequired: true,
    flyControlPlaneReceiptRequired: true,
  };
  return {
    closure: {
      ...normalized,
      backendReleaseAssetsDigest: framedSha256(DOMAINS.backendReleaseAssets, normalized),
    },
    artifacts: {
      chainDeployment,
      preparedRootSourceManifest: sourceManifest,
      standardJsonInputs: standardJsonInputs.map(({ artifact: value }) => value),
    },
  };
}

function buildConsumerInputs({
  descriptor,
  descriptorDigest,
  binding,
  sourceVerification,
  captureClosure,
  backendReleaseAssets,
}) {
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
      status: "closed-awaiting-backend-readiness",
      publicAuthorization: false,
      publicWrites: false,
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
      sourceVerificationClosureDigest: source.sourceVerificationClosureDigest,
      captureClosureDigest: captureClosure.captureClosureDigest,
      backendReleaseAssetsDigest: backendReleaseAssets.backendReleaseAssetsDigest,
      backendPromotionPublicInputDigest: null,
      backendPromotionInputDigest: null,
      backendReleaseEvidenceDigest: null,
      backendAuthorizationDigest: null,
      releaseManifestDigest: null,
      postingEventDigest: descriptor.deploymentEvidence.ethereumFinalityEvidence.postingEventDigest,
      standardJsonInputs,
    },
    cli: {
      schemaVersion: "programmable.robinhood-custom-launch.cli-promotion-input.v1",
      status: "closed-awaiting-backend-readiness",
      publicAuthorization: false,
      publicWrites: false,
      chainDeploymentId: CHAIN_DEPLOYMENT_ID,
      chainDeploymentDescriptorDigest: descriptorDigest,
      chainDeploymentPath: ROBINHOOD_LIVE_DEPLOYMENT_PATH,
      releaseBindingPath: V4_RELEASE_BINDING_PATH,
      profile: structuredClone(binding.releaseIdentity.profile),
      releaseManifestDigest: null,
      captureClosureDigest: captureClosure.captureClosureDigest,
      sourceVerificationClosureDigest: source.sourceVerificationClosureDigest,
      backendReleaseAssetsDigest: backendReleaseAssets.backendReleaseAssetsDigest,
      backendPromotionPublicInputDigest: null,
      backendPromotionInputDigest: null,
      backendReleaseEvidenceDigest: null,
      backendAuthorizationDigest: null,
    },
    developers: {
      schemaVersion: "programmable.robinhood-custom-launch.developers-promotion-input.v1",
      status: "closed-awaiting-backend-readiness",
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
      sourceVerificationClosureDigest: source.sourceVerificationClosureDigest,
      captureClosureDigest: captureClosure.captureClosureDigest,
      postingEventDigest: descriptor.deploymentEvidence.ethereumFinalityEvidence.postingEventDigest,
      backendReleaseAssetsDigest: backendReleaseAssets.backendReleaseAssetsDigest,
      backendPromotionPublicInputDigest: null,
      backendPromotionInputDigest: null,
      backendReleaseEvidenceDigest: null,
      backendAuthorizationDigest: null,
      releaseManifestDigest: null,
      backendRuntimeReadinessRequired: true,
      flyControlPlaneReceiptRequired: true,
      sourceRevision: source.revision,
      sourceTree: source.tree,
      sourceClosureDigest: source.sourceClosureDigest,
    },
    backend: {
      schemaVersion: "programmable.robinhood-custom-launch.backend-release-input.v1",
      state: "phase-a-closed",
      publicAuthorization: false,
      chainId: CHAIN_ID,
      chainDeploymentId: CHAIN_DEPLOYMENT_ID,
      chainDeploymentDescriptorDigest: descriptorDigest,
      backendReleaseAssetsDigest: backendReleaseAssets.backendReleaseAssetsDigest,
      backendPromotionPublicInputDigest: null,
      backendPromotionInputDigest: null,
      backendReleaseEvidenceDigest: null,
      backendAuthorizationDigest: null,
      chainDeployment: structuredClone(backendReleaseAssets.chainDeployment),
      preparedRootSourceManifest:
        structuredClone(backendReleaseAssets.preparedRootSourceManifest),
      standardJsonInputs: structuredClone(backendReleaseAssets.standardJsonInputs),
      runtimeReadinessPath: "/v4/chains/4663/readiness",
      runtimeReadinessSchemaVersion:
        "programmable.custom-launch-api-release-identity.v4",
      flyControlPlaneReceiptRequired: true,
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

function binaryArtifact(pathValue, bytes) {
  return {
    path: pathValue,
    sha256: sha256Digest(bytes),
    byteLength: String(bytes.byteLength),
    bytesBase64: Buffer.from(bytes).toString("base64"),
  };
}

async function buildRobinhoodStageBundle({
  repositoryRoot,
  input,
  inputBytes = canonicalJsonBytes(input),
  captureAuthorization,
  captureDependencies = {},
}, { historicalReplay }) {
  const root = realpathSync(path.resolve(repositoryRoot));
  const prepared = readPreparedArtifact(root);
  const sourceRevision = input?.sourceClosure?.revision;
  if (typeof sourceRevision !== "string" || !/^[0-9a-f]{40}$/u.test(sourceRevision)) {
    throw new TypeError("stage source revision is invalid");
  }
  const templateAudit = historicalReplay
    ? auditV4ReleaseBinding({
        repositoryRoot: root,
        bindingBytes: git(
          root,
          ["show", `${sourceRevision}:${V4_RELEASE_BINDING_PATH}`],
          "historical release binding template",
        ),
      })
    : auditV4ReleaseBinding({ repositoryRoot: root });
  const template = templateAudit.binding;
  const profile = normalizeV4ProfileRef(template.releaseIdentity.profile);
  const deployment = await buildRobinhoodChainDeployment({
    input,
    inputBytes,
    profile,
    repositoryRoot: root,
    captureAuthorization,
    captureDependencies,
  });
  const sourceClosure = buildSourceClosure(
    root,
    deployment.sourceClosureInput,
    deployment.descriptor.foundationSourceCommitment,
    deployment.captureClosure.sourceVerificationClosureDigest,
    { historicalReplay },
  );
  if (canonicalizeJson({
    repository: sourceClosure.repository,
    repositoryId: sourceClosure.repositoryId,
    protectedRef: sourceClosure.protectedRef,
    revision: sourceClosure.revision,
    tree: sourceClosure.tree,
    sourceClosureDigest: sourceClosure.sourceClosureDigest,
  }) !== canonicalizeJson(deployment.captureClosure.sourceOrigin)) {
    throw new TypeError("authenticated capture source origin differs from protected Git closure");
  }
  bindSourceVerificationToClosure(root, deployment.sourceVerification, sourceClosure);
  const binding = buildReleaseBinding({
    template,
    descriptor: deployment.descriptor,
    descriptorDigest: deployment.chainDeploymentDescriptorDigest,
    sourceClosure,
  });
  const backendRelease = buildBackendReleaseAssets({
    repositoryRoot: root,
    descriptor: deployment.descriptor,
    descriptorDigest: deployment.chainDeploymentDescriptorDigest,
    captureClosure: deployment.captureClosure,
  });
  const consumerInputs = buildConsumerInputs({
    descriptor: deployment.descriptor,
    descriptorDigest: deployment.chainDeploymentDescriptorDigest,
    binding,
    sourceVerification: deployment.sourceVerification,
    captureClosure: deployment.captureClosure,
    backendReleaseAssets: backendRelease.closure,
  });
  const normalized = {
    schemaVersion: ROBINHOOD_STAGE_BUNDLE_SCHEMA,
    state: deployment.captureClosure.authorization.trustClass === "test-only"
      ? "test-only-structural"
      : "closed-awaiting-backend-readiness",
    releaseReady: false,
    publicAuthorization: false,
    publicWrites: false,
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
    captureAuthorization: deployment.captureClosure.authorization,
    captureClosure: deployment.captureClosure,
    sourceVerification: deployment.sourceVerification,
    sourceClosure,
    backendReleaseAssets: backendRelease.closure,
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
      captureClosureDigest: deployment.captureClosure.captureClosureDigest,
      postingEventDigest:
        deployment.descriptor.deploymentEvidence.ethereumFinalityEvidence.postingEventDigest,
      sourceClosureDigest: sourceClosure.sourceClosureDigest,
      sourceVerificationClosureDigest: sourceClosure.sourceVerificationClosureDigest,
      backendReleaseAssetsDigest:
        backendRelease.closure.backendReleaseAssetsDigest,
      backendPromotionPublicInputDigest: null,
      backendPromotionInputDigest: null,
      backendReleaseEvidenceDigest: null,
      backendAuthorizationDigest: null,
      releaseManifestDigest: null,
    },
    artifacts: {
      liveDeployment: artifact(ROBINHOOD_LIVE_DEPLOYMENT_PATH, deployment.descriptor),
      cliReleaseBinding: {
        ...artifact(V4_RELEASE_BINDING_PATH, binding),
        replacesSha256: templateAudit.bindingSha256,
      },
      backendRelease: backendRelease.artifacts,
    },
    consumerInputs,
  };
  return {
    ...normalized,
    stageBundleDigest: framedSha256(DOMAINS.stageBundle, normalized),
  };
}

export async function materializeRobinhoodStageBundle(options) {
  return buildRobinhoodStageBundle(options, { historicalReplay: false });
}

export async function verifyRobinhoodStageBundle({
  repositoryRoot,
  bundle,
  input,
  inputBytes = canonicalJsonBytes(input),
  captureAuthorization,
  captureDependencies = {},
}) {
  if (input === null || typeof input !== "object") {
    throw new TypeError("promotion verification requires the exact retained capture sidecar");
  }
  const rebuilt = await buildRobinhoodStageBundle({
    repositoryRoot,
    input,
    inputBytes,
    captureAuthorization,
    captureDependencies,
  }, { historicalReplay: true });
  deepEqual(bundle, rebuilt, "stage bundle and authenticated capture sidecar");
  return Object.freeze({
    chainDeploymentDescriptorDigest:
      rebuilt.finalizedBindings.chainDeploymentDescriptorDigest,
    stageBundleDigest: rebuilt.stageBundleDigest,
    startBlock: rebuilt.finalizedBindings.startBlock,
    structurallyValid: true,
    releaseReady: false,
    phase: "backend-assets",
    authorizationClass: rebuilt.captureAuthorization.trustClass,
  });
}

function buildReleaseManifest(binding, backend) {
  const deployment = binding.evidence.chainDeployment;
  const profile = binding.evidence.profile;
  const source = binding.evidence.source;
  const finality = binding.evidence.finality;
  const atomic = deployment.descriptor.deploymentEvidence;
  const manifest = {
    schemaVersion: "programmable.launch-cli-v4-release-manifest.v1",
    releaseIdentity: structuredClone(binding.releaseIdentity),
    chainId: CHAIN_ID,
    caip2: CAIP2,
    chainDeploymentId: CHAIN_DEPLOYMENT_ID,
    chainDeploymentDescriptorDigest: deployment.descriptorDigest,
    chainDeploymentBindingDigest: deployment.bindingDigest,
    profileEvidenceDigest: profile.profileEvidenceDigest,
    sourceRevision: source.revision,
    sourceTree: source.tree,
    sourceClosureDigest: source.sourceClosureDigest,
    sourceVerificationClosureDigest: source.sourceVerificationClosureDigest,
    deploymentTransactionHash: atomic.transactionHash,
    deploymentBlockHash: atomic.blockHash,
    finalityEvidenceDigest: finality.finalityEvidenceDigest,
    backendReleaseEvidenceDigest: backend.backendReleaseEvidenceDigest,
    machineContracts: binding.machineContracts.map(({ name, sha256 }) => ({ name, sha256 })),
    releaseManifestDigest: null,
  };
  manifest.releaseManifestDigest = computeV4ReleaseManifestDigest(manifest);
  return manifest;
}

function buildFinalReleaseBinding(stageBinding, backend, productionAuthorized) {
  const binding = structuredClone(stageBinding);
  binding.evidence.backend = structuredClone(backend);
  binding.evidence.manifest = productionAuthorized ? buildReleaseManifest(binding, backend) : null;
  binding.blockers = productionAuthorized ? [] : ["releaseManifestEvidence"];
  binding.releaseReady = productionAuthorized;
  return binding;
}

function buildFinalConsumerInputs({
  stageInputs,
  finalBinding,
  backendPromotionPublicInput,
  backendReleaseEvidence,
  backendAuthorization,
  productionAuthorized,
}) {
  const releaseManifestDigest = finalBinding.evidence.manifest?.releaseManifestDigest ?? null;
  const common = {
    status: productionAuthorized ? "authorized-live" : "test-only-finalized",
    publicAuthorization: productionAuthorized,
    publicWrites: productionAuthorized,
    backendPromotionPublicInputDigest: backendPromotionPublicInput.publicInputDigest,
    backendPromotionInputDigest: backendReleaseEvidence.backendPromotionInputDigest,
    backendReleaseEvidenceDigest: backendReleaseEvidence.backendReleaseEvidenceDigest,
    backendAuthorizationDigest: backendAuthorization.authorizationDigest,
    releaseManifestDigest,
  };
  return {
    indexer: { ...structuredClone(stageInputs.indexer), ...common },
    cli: { ...structuredClone(stageInputs.cli), ...common },
    developers: {
      ...structuredClone(stageInputs.developers),
      ...common,
      backendRuntimeReadinessRequired: false,
      flyControlPlaneReceiptRequired: false,
    },
    backend: {
      ...structuredClone(stageInputs.backend),
      state: productionAuthorized ? "phase-b-authorized" : "test-only-finalized",
      publicAuthorization: productionAuthorized,
      backendPromotionPublicInputDigest: backendPromotionPublicInput.publicInputDigest,
      backendPromotionInputDigest: backendReleaseEvidence.backendPromotionInputDigest,
      backendReleaseEvidenceDigest: backendReleaseEvidence.backendReleaseEvidenceDigest,
      backendAuthorizationDigest: backendAuthorization.authorizationDigest,
      runtimeReadinessNormalizedResponseSha256:
        backendReleaseEvidence.runtimeReadiness.normalizedResponseSha256,
      flySafeReadbacksDigest: backendReleaseEvidence.flyControlPlane.safeReadbacksDigest,
    },
  };
}

function buildPublicBackendPromotionBinding({
  publicInput,
  inputBytes,
  backendReleaseEvidence,
  backendCaptureAuthorization,
  backendAuthorization,
}) {
  const runtime = backendReleaseEvidence.runtimeReadiness;
  const fly = backendReleaseEvidence.flyControlPlane;
  const result = {
    schemaVersion: "programmable.robinhood-custom-launch.backend-promotion-binding.v1",
    publicArtifact: {
      path: backendAuthorization.backendPromotionPublicInputPath,
      byteLength: String(inputBytes.byteLength),
      sha256: sha256Digest(inputBytes),
    },
    publicInputDigest: publicInput.publicInputDigest,
    readbackReceipts: structuredClone(publicInput.readbackReceipts),
    backendPromotionInputDigest: backendReleaseEvidence.backendPromotionInputDigest,
    backendSource: {
      repository: backendReleaseEvidence.repository,
      sourceCommit: backendReleaseEvidence.sourceCommit,
      sourceTree: backendReleaseEvidence.sourceTree,
    },
    captureAuthorization: {
      trustClass: backendCaptureAuthorization.trustClass,
      subjectPath: backendCaptureAuthorization.subjectPath,
      subjectSha256: backendCaptureAuthorization.subjectSha256,
      attestationBundlePath: backendCaptureAuthorization.attestationBundlePath,
      attestationBundleSha256: backendCaptureAuthorization.attestationBundleSha256,
      bundleMediaType: backendCaptureAuthorization.bundleMediaType,
      verifier: structuredClone(backendCaptureAuthorization.verifier),
      certificateIdentity: backendCaptureAuthorization.certificateIdentity,
      certificateOidcIssuer: backendCaptureAuthorization.certificateOidcIssuer,
      certificateGithubWorkflowName:
        backendCaptureAuthorization.certificateGithubWorkflowName,
      certificateGithubWorkflowRepository:
        backendCaptureAuthorization.certificateGithubWorkflowRepository,
      certificateGithubWorkflowRef:
        backendCaptureAuthorization.certificateGithubWorkflowRef,
      certificateGithubWorkflowSha:
        backendCaptureAuthorization.certificateGithubWorkflowSha,
      certificateGithubWorkflowTrigger:
        backendCaptureAuthorization.certificateGithubWorkflowTrigger,
      repository: backendCaptureAuthorization.repository,
      repositoryId: backendCaptureAuthorization.repositoryId,
      workflow: backendCaptureAuthorization.workflow,
      sourceRef: backendCaptureAuthorization.sourceRef,
      sourceRevision: backendCaptureAuthorization.sourceRevision,
      sourceTree: backendCaptureAuthorization.sourceTree,
      verificationDigest: backendCaptureAuthorization.verificationDigest,
    },
    runtimeReadiness: {
      schemaVersion: runtime.schemaVersion,
      path: runtime.path,
      httpStatus: runtime.httpStatus,
      contentType: runtime.contentType,
      normalizedResponseSha256: runtime.normalizedResponseSha256,
      releaseIdentityDigest: runtime.releaseIdentityDigest,
      observedAt: runtime.observedAt,
      authorizationDigest: runtime.authorizationDigest,
    },
    flyControlPlane: {
      schemaVersion: fly.schemaVersion,
      app: fly.app,
      appStatus: fly.appStatus,
      releaseIdDigest: fly.releaseIdDigest,
      releaseVersionDigest: fly.releaseVersionDigest,
      imageTag: fly.imageTag,
      imageIdentityDigest: fly.imageIdentityDigest,
      machines: structuredClone(fly.machines),
      safeReadbacksDigest: fly.safeReadbacksDigest,
      releaseIdentityDigest: fly.releaseIdentityDigest,
      observedAt: fly.observedAt,
      authorizationDigest: fly.authorizationDigest,
    },
    backendReleaseEvidenceDigest: backendReleaseEvidence.backendReleaseEvidenceDigest,
  };
  const forbidden = /"(?:private_ip|instance_id|config|env|metadata|bodyBytesBase64|sanitizedBytesBase64|request|response)"\s*:/u;
  if (forbidden.test(JSON.stringify(result))) {
    throw new TypeError("public backend promotion binding contains private provider fields");
  }
  return result;
}

async function buildRobinhoodPromotionBundle({
  repositoryRoot,
  stageBundle,
  stageBundleBytes = canonicalJsonBytes(stageBundle),
  input,
  inputBytes = canonicalJsonBytes(input),
  captureAuthorization,
  captureDependencies = {},
  backendPromotionInput,
  backendPromotionInputBytes = canonicalJsonBytes(backendPromotionInput),
  backendAttestationBundleBytes,
  backendCaptureAuthorization,
  backendAuthorization,
  backendDependencies = {},
}, { historicalReplay }) {
  assertJsonBytesMatch(stageBundle, stageBundleBytes, "stage bundle", 64 * 1024 * 1024);
  assertJsonBytesMatch(
    backendPromotionInput,
    backendPromotionInputBytes,
    "backend promotion public input",
    32 * 1024 * 1024,
  );
  await verifyRobinhoodStageBundle({
    repositoryRoot,
    bundle: stageBundle,
    input,
    inputBytes,
    captureAuthorization,
    captureDependencies,
  });
  const backendCapture = validateRobinhoodBackendCaptureAuthorization({
    authorization: backendCaptureAuthorization,
    inputBytes: backendPromotionInputBytes,
    attestationBundleBytes: backendAttestationBundleBytes,
    input: backendPromotionInput,
    allowTestOnly: backendDependencies.allowTestOnly === true,
  });
  const backend = validateRobinhoodBackendPromotionPublicInput({
    input: backendPromotionInput,
    stageBundle,
    now: historicalReplay
      ? () => new Date(backendPromotionInput.observedAt)
      : backendDependencies.now,
  });
  validateV4BackendReleaseEvidence(
    backend.backendReleaseEvidence,
    stageBundle.finalizedBindings.chainDeploymentDescriptorDigest,
  );
  const authorization = validateRobinhoodBackendAuthorization({
    authorization: backendAuthorization,
    stageBundle,
    stageBundleBytes,
    backendPromotionInputBytes,
    backendPromotionPublicInput: backendPromotionInput,
    backendReleaseEvidence: backend.backendReleaseEvidence,
    allowTestOnly: backendDependencies.allowTestOnly === true,
  });
  const productionAuthorized = stageBundle.captureAuthorization.trustClass
      === "github-artifact-attestation"
    && backendCapture.trustClass === ROBINHOOD_BACKEND_CAPTURE_TRUST_CLASS
    && authorization.trustClass === "github-artifact-attestation";
  const explicitlyTestOnly = backendDependencies.allowTestOnlyPromotion === true
    && stageBundle.captureAuthorization.trustClass === "test-only"
    && backendCapture.trustClass === "test-only"
    && authorization.trustClass === "test-only";
  if (!productionAuthorized && !explicitlyTestOnly) {
    throw new TypeError("Phase B requires three authenticated production authorities");
  }
  const finalBinding = buildFinalReleaseBinding(
    stageBundle.artifacts.cliReleaseBinding.value,
    backend.backendReleaseEvidence,
    productionAuthorized,
  );
  const consumerInputs = buildFinalConsumerInputs({
    stageInputs: stageBundle.consumerInputs,
    finalBinding,
    backendPromotionPublicInput: backendPromotionInput,
    backendReleaseEvidence: backend.backendReleaseEvidence,
    backendAuthorization: authorization,
    productionAuthorized,
  });
  const normalized = {
    schemaVersion: ROBINHOOD_PROMOTION_BUNDLE_SCHEMA,
    state: productionAuthorized ? "finalized-live" : "test-only-finalized",
    releaseReady: productionAuthorized,
    publicAuthorization: productionAuthorized,
    publicWrites: productionAuthorized,
    stageBundle: {
      path: ROBINHOOD_STAGE_BUNDLE_PATH,
      sha256: sha256Digest(stageBundleBytes),
      byteLength: String(stageBundleBytes.byteLength),
      stageBundleDigest: stageBundle.stageBundleDigest,
    },
    chainDeploymentId: stageBundle.chainDeploymentId,
    inputEvidenceDigest: stageBundle.inputEvidenceDigest,
    preparedArtifact: structuredClone(stageBundle.preparedArtifact),
    captureAuthorization: structuredClone(stageBundle.captureAuthorization),
    captureClosure: structuredClone(stageBundle.captureClosure),
    sourceVerification: structuredClone(stageBundle.sourceVerification),
    sourceClosure: structuredClone(stageBundle.sourceClosure),
    backendReleaseAssets: structuredClone(stageBundle.backendReleaseAssets),
    backendPromotionBinding: buildPublicBackendPromotionBinding({
      publicInput: backendPromotionInput,
      inputBytes: backendPromotionInputBytes,
      backendReleaseEvidence: backend.backendReleaseEvidence,
      backendCaptureAuthorization: backendCapture,
      backendAuthorization: authorization,
    }),
    backendCaptureAuthorization: backendCapture,
    backendAuthorization: authorization,
    finalizedBindings: {
      ...structuredClone(stageBundle.finalizedBindings),
      backendPromotionPublicInputDigest: backendPromotionInput.publicInputDigest,
      backendPromotionInputDigest:
        backend.backendReleaseEvidence.backendPromotionInputDigest,
      backendReleaseEvidenceDigest:
        backend.backendReleaseEvidence.backendReleaseEvidenceDigest,
      backendAuthorizationDigest: authorization.authorizationDigest,
      releaseManifestDigest: finalBinding.evidence.manifest?.releaseManifestDigest ?? null,
    },
    artifacts: {
      liveDeployment: structuredClone(stageBundle.artifacts.liveDeployment),
      cliReleaseBinding: {
        ...artifact(V4_RELEASE_BINDING_PATH, finalBinding),
        replacesSha256: stageBundle.artifacts.cliReleaseBinding.replacesSha256,
      },
      backendRelease: structuredClone(stageBundle.artifacts.backendRelease),
    },
    consumerInputs,
  };
  return Object.freeze({
    ...normalized,
    promotionBundleDigest: framedSha256(DOMAINS.promotionBundle, normalized),
  });
}

export async function materializeRobinhoodPromotionBundle(options) {
  return buildRobinhoodPromotionBundle(options, { historicalReplay: false });
}

export async function verifyRobinhoodPromotionBundle(options) {
  const rebuilt = await buildRobinhoodPromotionBundle(options, { historicalReplay: true });
  deepEqual(options.bundle, rebuilt,
    "promotion bundle and exact stage/capture/backend evidence sidecars");
  const production = rebuilt.state === "finalized-live";
  return Object.freeze({
    chainDeploymentDescriptorDigest:
      rebuilt.finalizedBindings.chainDeploymentDescriptorDigest,
    promotionBundleDigest: rebuilt.promotionBundleDigest,
    startBlock: rebuilt.finalizedBindings.startBlock,
    structurallyValid: true,
    releaseReady: production,
    publicAuthorization: rebuilt.publicAuthorization,
    publicWrites: rebuilt.publicWrites,
    phase: "promotion",
    authorizationClass: production ? "production" : "test-only",
  });
}
