import {
  getAddress,
  keccak256,
  stringToHex,
} from "viem";

import { canonicalizeJson } from "./canonical-json.mjs";
import {
  CHAIN_DEPLOYMENT_SCHEMA_V1,
  CREATE_REQUEST_SCHEMA_V4,
  FINALITY_POLICY_REF_SCHEMA_V1,
  ROBINHOOD_CAIP2,
  ROBINHOOD_CHAIN_DEPLOYMENT_ID,
  ROBINHOOD_CHAIN_ID,
  V4_CHAIN_DEPLOYMENT_DIGEST_DOMAIN,
  V4_ADMISSION_BINDING_DIGEST,
  V4_ADMISSION_DESCRIPTOR_DIGEST,
  V4_ADMISSION_POLICY_DIGEST,
  V4_ADMISSION_SCHEMA_DIGEST,
  V4_EXTERNAL_CONTRACT_SCHEMA,
  V4_FUNDING_INTENT_SCHEMA,
  V4_FOUNDATION_SOURCE_COMMITMENT,
  V4_GENESIS_PROVENANCE_SCHEMA,
  V4_GENESIS_PROVIDER_READBACK_SCHEMA,
  V4_ATOMIC_ROOT_DEPLOYMENT_EVIDENCE_SCHEMA,
  V4_L2_CHECKPOINT_ETHEREUM_FINALITY_SCHEMA,
  V4_DEPLOYMENT_EVIDENCE_SCHEMA,
  V4_LAUNCH_INTENT_HASH_DOMAIN,
  V4_LIQUIDITY_MODEL_SCHEMA,
  V4_BUSINESS_PROFILE_ID,
  V4_PROFILE_REF_SCHEMA,
  V4_STRUCTURAL_PROFILE_ID,
  V4_PROFILE_VERSION,
  V4_PROFILE_DIGEST,
  V4_REQUEST_HASH_DOMAIN,
  V4_SOURCE_BUILD_COMMITMENT_DOMAIN,
} from "./constants.mjs";
import { assertExactKeys, compareUtf8, sha256Digest } from "./io.mjs";

const HEX32 = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const IDENTIFIER = /^[a-z][a-z0-9._:-]{0,127}$/u;
const PROFILE_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const EXTERNAL_ROLE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const SAFE_CONFIGURATION_SCHEMA = "programmable.safe-configuration-evidence.v1";
const SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH =
  "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9";
const SAFE_MODULES_END_SENTINEL = "0x0000000000000000000000000000000000000001";
const SAFE_PROXY_ADDRESS = "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06";
const SAFE_PROXY_RUNTIME_CODE_HASH =
  "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c";
const SAFE_SINGLETON_ADDRESS = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const SAFE_SINGLETON_RUNTIME_CODE_HASH =
  "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4";
const SAFE_FALLBACK_HANDLER_ADDRESS = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
const SAFE_SOURCE_COMMITMENT_DOMAIN = "programmable.safe-source-commitment.v1";
const SAFE_SOURCE_COMMITMENT_SUBJECT = Object.freeze({
  schemaVersion: SAFE_SOURCE_COMMITMENT_DOMAIN,
  repository: "safe-global/safe-deployments",
  commit: "0974182c16c57ca6fe2b9bba8cffb8a7e55fb83c",
  version: "1.4.1",
  proxy: Object.freeze({
    sourceIdentity: "SafeProxy",
    address: SAFE_PROXY_ADDRESS,
    runtimeCodeHash: SAFE_PROXY_RUNTIME_CODE_HASH,
  }),
  singleton: Object.freeze({
    sourceIdentity: "Safe",
    address: SAFE_SINGLETON_ADDRESS,
    runtimeCodeHash: SAFE_SINGLETON_RUNTIME_CODE_HASH,
  }),
  fallbackHandler: Object.freeze({
    sourceIdentity: "CompatibilityFallbackHandler",
    address: SAFE_FALLBACK_HANDLER_ADDRESS,
    runtimeCodeHash: SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH,
  }),
  sourcifyExactMatchClaimed: false,
});
const SAFE_SOURCE_COMMITMENT = framedSha256Json(
  SAFE_SOURCE_COMMITMENT_DOMAIN,
  SAFE_SOURCE_COMMITMENT_SUBJECT,
);
if (SAFE_SOURCE_COMMITMENT
    !== "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb") {
  throw new Error("pinned Safe source commitment subject drifted");
}
const ATOMIC_RECEIPT_LOGS_SCHEMA =
  "programmable.robinhood-atomic-root-deployment-receipt-logs.v1";
const ATOMIC_PROVIDER_READBACK_SCHEMA =
  "programmable.robinhood-atomic-root-deployment-provider-readback.v1";
const ATOMIC_RUNTIME_TRANSITION_PROVIDER_READBACK_SCHEMA =
  "programmable.robinhood-atomic-root-runtime-transition-provider-readback.v1";
const ATOMIC_RESULT_STATE_SCHEMA =
  "programmable.robinhood-atomic-root-deployment-result-state.v1";
const ROBINHOOD_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const ATOMIC_DEPLOYMENT_SELECTOR = "0x82ad56cb";
const ATOMIC_DEPLOYMENT_CALLDATA_HASH =
  "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9";
const ATOMIC_DEPLOYMENT_CALLDATA_BYTES = 33_412;
const EMPTY_RUNTIME_CODE_HASH =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const EXTERNAL_DEPLOYMENT_PROVIDER_READBACK_SCHEMA =
  "programmable.custom-launch-deployment-provider-readback.v2";
const V4_UNISWAP_REGISTRY_SOURCE = Object.freeze({
  repository: "Uniswap/contracts",
  commit: "4cfc406c8e34da3ce04e60657a7825075b64fd22",
  path: "deployments/json/4663.json",
  rawUrl:
    "https://raw.githubusercontent.com/Uniswap/contracts/4cfc406c8e34da3ce04e60657a7825075b64fd22/deployments/json/4663.json",
  sha256: "sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15",
});
const SAFE_OWNERS = Object.freeze([
  "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
]);
const ROBINHOOD_ETHEREUM_ROLLUP = "0x23A19d23e89166adedbDcB432518AB01e4272D94";
const ROBINHOOD_ETHEREUM_SEQUENCER_INBOX =
  "0xBd0D173EEb87D57A09521c24388a12789F33ba96";
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const PERMIT2_RUNTIME_CODE_HASH =
  "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca";
const PERMIT2_GENESIS_SOURCE_URL =
  "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-genesis.json";
const PERMIT2_GENESIS_SOURCE_DIGEST =
  "sha256:353e6f6441b47695b41cee0c3645cde8dd7492d2f7f574bfb6aa4371e41bb6ba";
const PERMIT2_GENESIS_RUNTIME_CODE_BYTES = 9_152;
const FINALITY_POLICY_DIGEST =
  "sha256:537d531423d1285a3808556a57303ec68f1e6bdeea3c9aaf6320f9e5a0e47153";

export const V4_TRUST_ROOT_NAMES = Object.freeze([
  "programmableLaunchStampRouter",
  "permitAuthority",
  "graphFactory",
  "poolManager",
  "positionManager",
  "stateView",
  "v4Quoter",
  "permit2",
  "universalRouter",
]);

const V4_EXTERNAL_ROOT_NAMES = Object.freeze([
  "poolManager", "positionManager", "stateView", "v4Quoter", "universalRouter",
]);

const V4_PINNED_TRUST_ROOTS = Object.freeze({
  programmableLaunchStampRouter: Object.freeze({
    address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
    runtimeCodeHash: "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
  }),
  permitAuthority: Object.freeze({
    address: SAFE_PROXY_ADDRESS,
    runtimeCodeHash: SAFE_PROXY_RUNTIME_CODE_HASH,
  }),
  graphFactory: Object.freeze({
    address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
    runtimeCodeHash: "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  }),
  poolManager: Object.freeze({
    address: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    runtimeCodeHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  }),
  positionManager: Object.freeze({
    address: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
    runtimeCodeHash: "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
  }),
  stateView: Object.freeze({
    address: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    runtimeCodeHash: "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6",
  }),
  v4Quoter: Object.freeze({
    address: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
    runtimeCodeHash: "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
  }),
  permit2: Object.freeze({ address: PERMIT2_ADDRESS, runtimeCodeHash: PERMIT2_RUNTIME_CODE_HASH }),
  universalRouter: Object.freeze({
    address: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
    runtimeCodeHash: "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
  }),
});

const V4_EXTERNAL_ROOT_DEPLOYMENTS = Object.freeze({
  poolManager: Object.freeze({
    ...V4_PINNED_TRUST_ROOTS.poolManager,
    transactionHash: "0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41",
    startBlock: "9070",
  }),
  positionManager: Object.freeze({
    ...V4_PINNED_TRUST_ROOTS.positionManager,
    transactionHash: "0x228c18ada6cb46b4fbcc18f4ec1519953415393e256fa8349aafbd5a2db037c8",
    startBlock: "9073",
  }),
  stateView: Object.freeze({
    ...V4_PINNED_TRUST_ROOTS.stateView,
    transactionHash: "0x3d61e2c9eeb482385b1aa436b9e8f812167ea579cc390e4f93bc5abde00582f4",
    startBlock: "9075",
  }),
  v4Quoter: Object.freeze({
    ...V4_PINNED_TRUST_ROOTS.v4Quoter,
    transactionHash: "0x6bf436d72a17f87284ddcab43094689bd320dfb39b535213b9a0b669fabc4ab4",
    startBlock: "9074",
  }),
  universalRouter: Object.freeze({
    ...V4_PINNED_TRUST_ROOTS.universalRouter,
    transactionHash: "0xdfb76494e158d8dea4376160315239271636a18515207fd4526e574bc7eeb456",
    startBlock: "3347899",
  }),
});

export const V4_LIQUIDITY_MODELS = Object.freeze([
  "none-empty-pool",
  "project-provided-liquidity",
  "hook-owned-liquidity",
  "externally-managed-position",
  "custom-bonding-or-curve",
]);

export const V4_LIQUIDITY_STATES = Object.freeze([
  "pool-not-initialized",
  "pool-initialized-empty",
  "liquidity-required",
  "liquidity-provided-by-launch",
  "custom-settlement",
]);

export function normalizeV4ChainDeployment(value) {
  assertExactKeys(value, [
    "schemaVersion",
    "chainDeploymentId",
    "chainId",
    "caip2",
    "finality",
    "foundationSourceCommitment",
    "deploymentEvidence",
    "permit2GenesisProvenance",
    "permitAuthoritySourceProvenance",
    "externalRootDeploymentEvidence",
    "contracts",
  ], "chainDeployment");
  if (value.schemaVersion !== CHAIN_DEPLOYMENT_SCHEMA_V1) {
    throw new TypeError(`chainDeployment.schemaVersion must be ${CHAIN_DEPLOYMENT_SCHEMA_V1}`);
  }
  if (value.chainDeploymentId !== ROBINHOOD_CHAIN_DEPLOYMENT_ID) {
    throw new TypeError(
      `chainDeployment.chainDeploymentId must be ${ROBINHOOD_CHAIN_DEPLOYMENT_ID}`,
    );
  }
  if (value.chainId !== ROBINHOOD_CHAIN_ID || value.caip2 !== ROBINHOOD_CAIP2) {
    throw new TypeError("chainDeployment must bind Robinhood Chain mainnet eip155:4663");
  }
  const finality = normalizeV4FinalityPolicyRef(value.finality);
  if (value.foundationSourceCommitment !== V4_FOUNDATION_SOURCE_COMMITMENT) {
    throw new TypeError("chainDeployment foundation source commitment is invalid");
  }
  const deploymentEvidence = normalizeV4DeploymentEvidence(value.deploymentEvidence);
  const permit2GenesisProvenance = normalizeV4Permit2GenesisProvenance(
    value.permit2GenesisProvenance,
  );
  const permitAuthoritySourceProvenance = normalizeV4PermitAuthoritySourceProvenance(
    value.permitAuthoritySourceProvenance,
  );
  const externalRootDeploymentEvidence = normalizeV4ExternalRootDeploymentEvidence(
    value.externalRootDeploymentEvidence,
  );
  assertExactKeys(value.contracts, V4_TRUST_ROOT_NAMES, "chainDeployment.contracts");
  const contracts = Object.fromEntries(V4_TRUST_ROOT_NAMES.map((name) => [
    name,
    normalizeTrustRoot(value.contracts[name], `chainDeployment.contracts.${name}`),
  ]));
  for (const name of V4_TRUST_ROOT_NAMES) {
    const expected = V4_PINNED_TRUST_ROOTS[name];
    if (contracts[name].address !== expected.address
      || contracts[name].runtimeCodeHash !== expected.runtimeCodeHash) {
      throw new TypeError(`chainDeployment.contracts.${name} is not the pinned Robinhood root`);
    }
  }
  if (permit2GenesisProvenance.address !== contracts.permit2.address) {
    throw new TypeError(
      "chainDeployment Permit2 genesis provenance must bind the exact Permit2 trust root",
    );
  }
  if (permitAuthoritySourceProvenance.address !== contracts.permitAuthority.address) {
    throw new TypeError(
      "chainDeployment permitAuthority provenance must bind the exact trust root",
    );
  }
  if (permitAuthoritySourceProvenance.configurationEvidence.proxyRuntimeCodeHash
      !== contracts.permitAuthority.runtimeCodeHash) {
    throw new TypeError(
      "chainDeployment permitAuthority Safe configuration must bind the exact proxy runtime",
    );
  }
  const safeEvidence = permitAuthoritySourceProvenance.configurationEvidence;
  if (deploymentEvidence.transactionHash !== permitAuthoritySourceProvenance.transactionHash
    || deploymentEvidence.blockNumber !== permitAuthoritySourceProvenance.blockNumber
    || deploymentEvidence.blockHash !== permitAuthoritySourceProvenance.blockHash
    || safeEvidence.blockNumber !== deploymentEvidence.blockNumber
    || safeEvidence.blockHash !== deploymentEvidence.blockHash
    || safeEvidence.ethereumFinalityEvidence.l2Checkpoint.blockNumber
      !== deploymentEvidence.blockNumber
    || safeEvidence.ethereumFinalityEvidence.l2Checkpoint.blockHash
      !== deploymentEvidence.blockHash
    || canonicalizeJson(deploymentEvidence.ethereumFinalityEvidence)
      !== canonicalizeJson(safeEvidence.ethereumFinalityEvidence)) {
    throw new TypeError(
      "chainDeployment atomic deployment, Safe snapshot and Ethereum finality disagree",
    );
  }
  for (const result of deploymentEvidence.resultingContracts) {
    const binding = contracts[result.contract];
    if (result.address !== binding.address
      || result.runtimeCodeHash !== binding.runtimeCodeHash) {
      throw new TypeError(
        `chainDeployment atomic deployment result must bind ${result.contract}`,
      );
    }
  }
  if (deploymentEvidence.resultingContracts[0].stateEvidenceDigest
      !== safeEvidence.atomicRootStateEvidenceDigest) {
    throw new TypeError(
      "chainDeployment atomic Safe result must bind its exact configuration evidence",
    );
  }
  for (const evidence of externalRootDeploymentEvidence) {
    const binding = contracts[evidence.contract];
    if (evidence.address !== binding.address
      || evidence.runtimeCodeHash !== binding.runtimeCodeHash) {
      throw new TypeError(
        `chainDeployment external deployment evidence must bind ${evidence.contract}`,
      );
    }
  }
  if (contracts.programmableLaunchStampRouter.address
      === contracts.universalRouter.address) {
    throw new TypeError("Programmable Router must not equal Uniswap Universal Router");
  }
  return {
    schemaVersion: CHAIN_DEPLOYMENT_SCHEMA_V1,
    chainDeploymentId: ROBINHOOD_CHAIN_DEPLOYMENT_ID,
    chainId: ROBINHOOD_CHAIN_ID,
    caip2: ROBINHOOD_CAIP2,
    finality,
    foundationSourceCommitment: V4_FOUNDATION_SOURCE_COMMITMENT,
    deploymentEvidence,
    permit2GenesisProvenance,
    permitAuthoritySourceProvenance,
    externalRootDeploymentEvidence,
    contracts,
  };
}

export function hashV4ChainDeployment(value) {
  const deployment = normalizeV4ChainDeployment(value);
  return keccak256(stringToHex(canonicalizeJson(deployment)));
}

export function normalizeV4ProfileRef(value) {
  assertExactKeys(value, [
    "schemaVersion",
    "structuralProfileId",
    "businessProfileId",
    "admissionDescriptorDigest",
    "admissionPolicyDigest",
    "admissionBindingDigest",
    "admissionSchemaDigest",
    "profileRevision",
    "profileVersion",
    "profileDigest",
  ], "profile");
  if (value.schemaVersion !== V4_PROFILE_REF_SCHEMA
    || value.structuralProfileId !== V4_STRUCTURAL_PROFILE_ID
    || value.businessProfileId !== V4_BUSINESS_PROFILE_ID
    || value.admissionDescriptorDigest !== V4_ADMISSION_DESCRIPTOR_DIGEST
    || value.admissionPolicyDigest !== V4_ADMISSION_POLICY_DIGEST
    || value.admissionBindingDigest !== V4_ADMISSION_BINDING_DIGEST
    || value.admissionSchemaDigest !== V4_ADMISSION_SCHEMA_DIGEST
    || value.profileVersion !== V4_PROFILE_VERSION
    || value.profileRevision !== 1
    || value.profileDigest !== V4_PROFILE_DIGEST) {
    throw new TypeError("profile is not the exact Robinhood production V4 profile reference");
  }
  const normalized = {
    schemaVersion: V4_PROFILE_REF_SCHEMA,
    structuralProfileId: V4_STRUCTURAL_PROFILE_ID,
    businessProfileId: V4_BUSINESS_PROFILE_ID,
    admissionDescriptorDigest: value.admissionDescriptorDigest,
    admissionPolicyDigest: value.admissionPolicyDigest,
    admissionBindingDigest: value.admissionBindingDigest,
    admissionSchemaDigest: value.admissionSchemaDigest,
    profileRevision: 1,
    profileVersion: V4_PROFILE_VERSION,
  };
  if (value.profileDigest !== framedSha256Json(V4_PROFILE_REF_SCHEMA, normalized)) {
    throw new TypeError(
      "profile.profileDigest does not bind the exact structural, admission and business mapping",
    );
  }
  return { ...normalized, profileDigest: value.profileDigest };
}

export function normalizeV4FundingIntent(value) {
  assertExactKeys(value, ["schemaVersion", "mode", "valueWei"], "funding");
  if (value.schemaVersion !== V4_FUNDING_INTENT_SCHEMA
    || !new Set(["none", "wallet-transaction-value"]).has(value.mode)
    || typeof value.valueWei !== "string"
    || !DECIMAL.test(value.valueWei)
    || BigInt(value.valueWei) >= 1n << 256n) {
    throw new TypeError("funding must be a bounded V4 none or wallet-transaction-value intent");
  }
  if ((value.mode === "none") !== (value.valueWei === "0")) {
    throw new TypeError("funding none requires valueWei 0; wallet-transaction-value requires nonzero valueWei");
  }
  return {
    schemaVersion: V4_FUNDING_INTENT_SCHEMA,
    mode: value.mode,
    valueWei: value.valueWei,
  };
}

export function assertV4FundingValueMatchesGraph(fundingValue, graphBundle) {
  const funding = normalizeV4FundingIntent(fundingValue);
  if (typeof graphBundle !== "object" || graphBundle === null
    || !Array.isArray(graphBundle.targets)) {
    throw new TypeError("graphBundle targets are required for exact V4 funding");
  }
  let requiredValue = 0n;
  for (const [index, target] of graphBundle.targets.entries()) {
    for (const field of ["deploymentValueWei", "initializerValueWei"]) {
      const value = target?.[field];
      if (typeof value !== "string" || !DECIMAL.test(value)
        || BigInt(value) >= 1n << 256n) {
        throw new TypeError(`graphBundle.targets[${index}].${field} is not canonical uint256`);
      }
      requiredValue += BigInt(value);
    }
  }
  if (requiredValue >= 1n << 256n || funding.valueWei !== requiredValue.toString()) {
    throw new TypeError(
      "funding.valueWei must exactly equal the sum of every graph target deployment and initializer value",
    );
  }
  return funding;
}

export function normalizeV4LiquidityModel(value) {
  assertExactKeys(value, [
    "schemaVersion",
    "model",
    "declaredLaunchState",
    "targetIds",
  ], "liquidityModel");
  if (value.schemaVersion !== V4_LIQUIDITY_MODEL_SCHEMA
    || !V4_LIQUIDITY_MODELS.includes(value.model)
    || !V4_LIQUIDITY_STATES.includes(value.declaredLaunchState)
    || !Array.isArray(value.targetIds)
    || value.targetIds.length > 16) {
    throw new TypeError("liquidityModel is invalid");
  }
  const targetIds = value.targetIds.map((targetId) => {
    if (typeof targetId !== "string" || !IDENTIFIER.test(targetId)) {
      throw new TypeError("liquidityModel.targetIds contains an invalid target ID");
    }
    return targetId;
  });
  if (new Set(targetIds).size !== targetIds.length
    || targetIds.some((targetId, index) => index > 0
      && compareUtf8(targetIds[index - 1], targetId) >= 0)) {
    throw new TypeError("liquidityModel.targetIds must be unique and UTF-8 sorted");
  }
  if (value.model === "none-empty-pool" && targetIds.length !== 0) {
    throw new TypeError("none-empty-pool liquidity must not claim a liquidity target");
  }
  return {
    schemaVersion: V4_LIQUIDITY_MODEL_SCHEMA,
    model: value.model,
    declaredLaunchState: value.declaredLaunchState,
    targetIds,
  };
}

export function normalizeV4ExternalContracts(value) {
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError("externalContracts must contain between 0 and 64 entries");
  }
  const normalized = value.map((contract, index) => {
    const label = `externalContracts[${index}]`;
    assertExactKeys(contract, [
      "schemaVersion",
      "chainId",
      "caip2",
      "address",
      "runtimeCodeHash",
      "sourceEvidenceDigest",
      "role",
      "startBlock",
      "auditBlock",
      "locator",
      "mutability",
    ], label);
    let address;
    try {
      address = getAddress(contract.address);
    } catch {
      throw new TypeError(`${label}.address must be an EIP-55 address`);
    }
    if (address !== contract.address
      || contract.schemaVersion !== V4_EXTERNAL_CONTRACT_SCHEMA
      || contract.chainId !== ROBINHOOD_CHAIN_ID
      || contract.caip2 !== ROBINHOOD_CAIP2
      || typeof contract.runtimeCodeHash !== "string"
      || !HEX32.test(contract.runtimeCodeHash)
      || contract.runtimeCodeHash === `0x${"0".repeat(64)}`
      || typeof contract.sourceEvidenceDigest !== "string"
      || !SHA256.test(contract.sourceEvidenceDigest)
      || typeof contract.role !== "string"
      || !EXTERNAL_ROLE.test(contract.role)
      || typeof contract.startBlock !== "string"
      || !POSITIVE_DECIMAL.test(contract.startBlock)
      || BigInt(contract.startBlock) >= 1n << 256n
      || typeof contract.auditBlock !== "string"
      || !DECIMAL.test(contract.auditBlock)
      || BigInt(contract.auditBlock) >= 1n << 256n
      || BigInt(contract.auditBlock) < BigInt(contract.startBlock)) {
      throw new TypeError(`${label} is not a canonical Robinhood external contract binding`);
    }
    const locator = normalizeExternalLocator(contract.locator, `${label}.locator`);
    const mutability = normalizeExternalMutability(contract.mutability, {
      label: `${label}.mutability`,
      auditBlock: contract.auditBlock,
    });
    return {
      schemaVersion: V4_EXTERNAL_CONTRACT_SCHEMA,
      chainId: ROBINHOOD_CHAIN_ID,
      caip2: ROBINHOOD_CAIP2,
      address,
      runtimeCodeHash: contract.runtimeCodeHash,
      sourceEvidenceDigest: contract.sourceEvidenceDigest,
      role: contract.role,
      startBlock: contract.startBlock,
      auditBlock: contract.auditBlock,
      locator,
      mutability,
    };
  });
  const keys = normalized.map(({ role, address }) => `${role}\0${address.toLowerCase()}`);
  if (new Set(keys).size !== keys.length
    || keys.some((key, index) => index > 0 && compareUtf8(keys[index - 1], key) >= 0)) {
    throw new TypeError(
      "externalContracts must be unique and UTF-8 sorted by role and lowercase address",
    );
  }
  assertExternalLocatorUniqueness(normalized);
  return normalized;
}

export function assertV4ExternalContractLocators(externalContracts, graphBundle) {
  const normalized = normalizeV4ExternalContracts(externalContracts);
  if (typeof graphBundle !== "object" || graphBundle === null
    || !Array.isArray(graphBundle.targets)) {
    throw new TypeError("graphBundle targets are required for external contract locators");
  }
  const targets = new Map(graphBundle.targets.map((target) => [target?.targetId, target]));
  for (const contract of normalized) {
    const target = targets.get(contract.locator.targetId);
    if (target === undefined) {
      throw new TypeError(
        `external contract locator references unknown target ${contract.locator.targetId}`,
      );
    }
    const source = contract.locator.phase === "constructor"
      ? target.constructorArguments
      : target.initializerCalldata;
    if (typeof source !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(source)) {
      throw new TypeError("external contract locator source bytes are not canonical");
    }
    const byteLength = contract.locator.encoding === "abi-address-word" ? 32 : 20;
    const start = 2 + contract.locator.byteOffset * 2;
    const end = start + byteLength * 2;
    const actual = source.slice(start, end);
    const addressBytes = contract.address.slice(2).toLowerCase();
    const expected = contract.locator.encoding === "abi-address-word"
      ? `${"0".repeat(24)}${addressBytes}`
      : addressBytes;
    if (actual.length !== byteLength * 2 || actual !== expected) {
      throw new TypeError(
        `external contract ${contract.role} is not present at its exact graph byte locator`,
      );
    }
  }
  return normalized;
}

function normalizeExternalLocator(value, label) {
  assertExactKeys(value, [
    "targetId",
    "phase",
    "byteOffset",
    "encoding",
  ], label);
  if (typeof value.targetId !== "string"
    || !EXTERNAL_ROLE.test(value.targetId)
    || !new Set(["constructor", "initializer"]).has(value.phase)
    || !Number.isSafeInteger(value.byteOffset)
    || value.byteOffset < 0
    || !new Set(["abi-address-word", "packed-address-20"]).has(value.encoding)) {
    throw new TypeError(`${label} is invalid`);
  }
  return {
    targetId: value.targetId,
    phase: value.phase,
    byteOffset: value.byteOffset,
    encoding: value.encoding,
  };
}

function normalizeExternalMutability(value, { label, auditBlock }) {
  assertExactKeys(value, [
    "kind",
    "proxyType",
    "implementation",
    "adminAddress",
    "beaconAddress",
    "evidenceDigest",
  ], label);
  if (typeof value.evidenceDigest !== "string" || !SHA256.test(value.evidenceDigest)) {
    throw new TypeError(`${label}.evidenceDigest is invalid`);
  }
  if (value.kind === "immutable") {
    if (value.proxyType !== null || value.implementation !== null
      || value.adminAddress !== null || value.beaconAddress !== null) {
      throw new TypeError(`${label} immutable binding must not claim proxy fields`);
    }
    return {
      kind: "immutable",
      proxyType: null,
      implementation: null,
      adminAddress: null,
      beaconAddress: null,
      evidenceDigest: value.evidenceDigest,
    };
  }
  const proxyTypes = new Set([
    "eip1967-transparent",
    "eip1967-uups",
    "eip1967-beacon",
    "eip1167-minimal",
    "custom",
  ]);
  if (value.kind !== "proxy" || !proxyTypes.has(value.proxyType)
    || value.proxyType === "custom") {
    throw new TypeError(`${label} proxy type lacks an exact supported resolver`);
  }
  const implementation = normalizeExternalImplementation(
    value.implementation,
    `${label}.implementation`,
  );
  if (implementation.auditBlock !== auditBlock) {
    throw new TypeError(`${label} implementation auditBlock must match the proxy auditBlock`);
  }
  const adminAddress = value.adminAddress === null
    ? null
    : exactEip55Address(value.adminAddress, `${label}.adminAddress`);
  const beaconAddress = value.beaconAddress === null
    ? null
    : exactEip55Address(value.beaconAddress, `${label}.beaconAddress`);
  if ((value.proxyType === "eip1967-beacon") !== (beaconAddress !== null)
    || (value.proxyType !== "eip1967-transparent" && adminAddress !== null)) {
    throw new TypeError(`${label} proxy authority fields do not match proxyType`);
  }
  return {
    kind: "proxy",
    proxyType: value.proxyType,
    implementation,
    adminAddress,
    beaconAddress,
    evidenceDigest: value.evidenceDigest,
  };
}

function normalizeExternalImplementation(value, label) {
  assertExactKeys(value, [
    "address",
    "runtimeCodeHash",
    "sourceEvidenceDigest",
    "startBlock",
    "auditBlock",
  ], label);
  const address = exactEip55Address(value.address, `${label}.address`);
  if (typeof value.runtimeCodeHash !== "string"
    || !HEX32.test(value.runtimeCodeHash)
    || value.runtimeCodeHash === `0x${"0".repeat(64)}`
    || typeof value.sourceEvidenceDigest !== "string"
    || !SHA256.test(value.sourceEvidenceDigest)
    || typeof value.startBlock !== "string"
    || !POSITIVE_DECIMAL.test(value.startBlock)
    || BigInt(value.startBlock) >= 1n << 256n
    || typeof value.auditBlock !== "string"
    || !DECIMAL.test(value.auditBlock)
    || BigInt(value.auditBlock) >= 1n << 256n
    || BigInt(value.auditBlock) < BigInt(value.startBlock)) {
    throw new TypeError(`${label} is invalid`);
  }
  return {
    address,
    runtimeCodeHash: value.runtimeCodeHash,
    sourceEvidenceDigest: value.sourceEvidenceDigest,
    startBlock: value.startBlock,
    auditBlock: value.auditBlock,
  };
}

function exactEip55Address(value, label) {
  let address;
  try {
    address = getAddress(value);
  } catch {
    throw new TypeError(`${label} must be an EIP-55 address`);
  }
  if (address !== value) throw new TypeError(`${label} must be an EIP-55 address`);
  return address;
}

function assertExternalLocatorUniqueness(contracts) {
  const spans = contracts.map(({ locator }) => ({
    key: `${locator.targetId}\0${locator.phase}`,
    start: locator.byteOffset,
    end: locator.byteOffset + (locator.encoding === "abi-address-word" ? 32 : 20),
  })).sort((left, right) => compareUtf8(left.key, right.key) || left.start - right.start);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index - 1].key === spans[index].key
      && spans[index].start < spans[index - 1].end) {
      throw new TypeError("external contract locators must be unique and non-overlapping");
    }
  }
}

export function v4GraphChainContext(chainDeployment) {
  const deployment = normalizeV4ChainDeployment(chainDeployment);
  return {
    chainId: deployment.chainId,
    router: deployment.contracts.programmableLaunchStampRouter.address,
    graphFactory: deployment.contracts.graphFactory.address,
  };
}

export function buildV4LaunchIntentHash(value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(V4_LAUNCH_INTENT_HASH_DOMAIN, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

export function buildV4SourceBuildCommitment(value) {
  assertExactKeys(value, [
    "sourceDescriptor",
    "sourceBundleManifest",
    "externalContracts",
    "projectMetadataImageArtifact",
    "verificationBundleHash",
  ], "V4 source build commitment preimage");
  const normalized = {
    sourceDescriptor: value.sourceDescriptor,
    sourceBundleManifest: value.sourceBundleManifest,
    externalContracts: normalizeV4ExternalContracts(value.externalContracts),
    projectMetadataImageArtifact: value.projectMetadataImageArtifact,
    verificationBundleHash: value.verificationBundleHash,
  };
  if (typeof normalized.verificationBundleHash !== "string"
    || !SHA256.test(normalized.verificationBundleHash)) {
    throw new TypeError("verificationBundleHash must be a lowercase SHA-256 digest");
  }
  return sha256Digest(Buffer.concat([
    Buffer.from(V4_SOURCE_BUILD_COMMITMENT_DOMAIN, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(normalized), "utf8"),
  ]));
}

export function customLaunchRequestHashV4(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || value.schemaVersion !== CREATE_REQUEST_SCHEMA_V4) {
    throw new TypeError(`request schemaVersion must be ${CREATE_REQUEST_SCHEMA_V4}`);
  }
  return sha256Digest(Buffer.concat([
    Buffer.from(V4_REQUEST_HASH_DOMAIN, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function normalizeV4FinalityPolicyRef(value) {
  assertExactKeys(value, [
    "schemaVersion",
    "policyId",
    "policyRevision",
    "policyDigest",
  ], "chainDeployment.finality");
  if (value.schemaVersion !== FINALITY_POLICY_REF_SCHEMA_V1
    || typeof value.policyId !== "string"
    || !IDENTIFIER.test(value.policyId)
    || !Number.isSafeInteger(value.policyRevision)
    || value.policyRevision < 1
    || value.policyId !== "robinhood-stage-finality-v1"
    || value.policyRevision !== 1
    || value.policyDigest !== FINALITY_POLICY_DIGEST) {
    throw new TypeError("chainDeployment.finality is invalid");
  }
  return {
    schemaVersion: FINALITY_POLICY_REF_SCHEMA_V1,
    policyId: value.policyId,
    policyRevision: value.policyRevision,
    policyDigest: value.policyDigest,
  };
}

function normalizeV4DeploymentEvidence(value) {
  assertExactKeys(value, [
    "schemaVersion",
    "deploymentId",
    "chainId",
    "coveredContracts",
    "transactionHash",
    "from",
    "to",
    "valueWei",
    "selector",
    "calldataHash",
    "calldataBytes",
    "nonce",
    "transactionIndex",
    "receiptStatus",
    "blockNumber",
    "blockHash",
    "receiptLogs",
    "receiptLogsDigest",
    "providerReadbacks",
    "resultingContracts",
    "ethereumFinalityEvidence",
    "evidenceDigest",
    "sourceVerification",
  ], "chainDeployment.deploymentEvidence");
  assertExactKeys(value.sourceVerification, [
    "sourcifyProviderMatchCoveredContracts",
    "exactByteSourceBuildTransactionCoveredContracts",
    "officialSourcePinnedCoveredContracts",
  ], "chainDeployment.deploymentEvidence.sourceVerification");
  if (value.schemaVersion !== V4_ATOMIC_ROOT_DEPLOYMENT_EVIDENCE_SCHEMA
    || value.deploymentId !== ROBINHOOD_CHAIN_DEPLOYMENT_ID
    || value.chainId !== ROBINHOOD_CHAIN_ID
    || canonicalizeJson(value.coveredContracts)
      !== canonicalizeJson([
        "programmableLaunchStampRouter", "graphFactory", "permitAuthority",
      ])
    || canonicalizeJson(value.sourceVerification.sourcifyProviderMatchCoveredContracts)
      !== canonicalizeJson(["programmableLaunchStampRouter", "graphFactory"])
    || canonicalizeJson(
      value.sourceVerification.exactByteSourceBuildTransactionCoveredContracts,
    )
      !== canonicalizeJson(["programmableLaunchStampRouter", "graphFactory"])
    || canonicalizeJson(value.sourceVerification.officialSourcePinnedCoveredContracts)
      !== canonicalizeJson(["permitAuthority"])
    || typeof value.transactionHash !== "string"
    || !HEX32.test(value.transactionHash)
    || value.transactionHash === `0x${"0".repeat(64)}`
    || !SAFE_OWNERS.includes(value.from)
    || value.to !== ROBINHOOD_MULTICALL3
    || value.valueWei !== "0"
    || value.selector !== ATOMIC_DEPLOYMENT_SELECTOR
    || value.calldataHash !== ATOMIC_DEPLOYMENT_CALLDATA_HASH
    || value.calldataBytes !== ATOMIC_DEPLOYMENT_CALLDATA_BYTES
    || typeof value.nonce !== "string"
    || !DECIMAL.test(value.nonce)
    || BigInt(value.nonce) >= 1n << 256n
    || typeof value.transactionIndex !== "string"
    || !DECIMAL.test(value.transactionIndex)
    || BigInt(value.transactionIndex) >= 1n << 256n
    || value.receiptStatus !== "1"
    || typeof value.blockNumber !== "string"
    || !/^[1-9][0-9]*$/u.test(value.blockNumber)
    || BigInt(value.blockNumber) >= 1n << 256n
    || typeof value.blockHash !== "string"
    || !HEX32.test(value.blockHash)
    || value.blockHash === `0x${"0".repeat(64)}`
    || !Array.isArray(value.receiptLogs)
    || value.receiptLogs.length > 1_024
    || !Array.isArray(value.providerReadbacks)
    || value.providerReadbacks.length !== 2
    || !Array.isArray(value.resultingContracts)
    || value.resultingContracts.length !== 3
    || typeof value.evidenceDigest !== "string"
    || !SHA256.test(value.evidenceDigest)) {
    throw new TypeError("chainDeployment.deploymentEvidence is invalid");
  }
  const from = exactEip55Address(value.from, "chainDeployment.deploymentEvidence.from");
  const receiptLogs = value.receiptLogs.map((entry, index) => {
    const label = `chainDeployment.deploymentEvidence.receiptLogs[${index}]`;
    assertExactKeys(entry, ["address", "topics", "data", "logIndex"], label);
    if (!Array.isArray(entry.topics) || entry.topics.length > 4
      || typeof entry.data !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(entry.data)
      || typeof entry.logIndex !== "string" || !DECIMAL.test(entry.logIndex)
      || BigInt(entry.logIndex) >= 1n << 256n) {
      throw new TypeError(`${label} is invalid`);
    }
    const topics = entry.topics.map((topic, topicIndex) => {
      if (!NONZERO_HEX32(topic)) throw new TypeError(`${label}.topics[${topicIndex}] is invalid`);
      return topic;
    });
    return {
      address: exactEip55Address(entry.address, `${label}.address`),
      topics,
      data: entry.data,
      logIndex: entry.logIndex,
    };
  });
  if (new Set(receiptLogs.map(({ logIndex }) => logIndex)).size !== receiptLogs.length
    || receiptLogs.some((entry, index) => index > 0
      && BigInt(entry.logIndex) <= BigInt(receiptLogs[index - 1].logIndex))) {
    throw new TypeError("chainDeployment atomic receipt logs must be sorted and unique");
  }
  if (value.receiptLogsDigest !== framedSha256Json(
    ATOMIC_RECEIPT_LOGS_SCHEMA,
    receiptLogs,
  )) {
    throw new TypeError("chainDeployment atomic receipt logs digest is invalid");
  }
  const providerReadbacks = [
    normalizeV4AtomicProviderReadback(
      value.providerReadbacks[0], value.transactionHash, "quicknode", "quicknode.com", 0,
    ),
    normalizeV4AtomicProviderReadback(
      value.providerReadbacks[1], value.transactionHash, "alchemy", "alchemy.com", 1,
    ),
  ];
  const resultingContracts = [
    normalizeV4AtomicDeploymentResult(
      value.resultingContracts[0], "permitAuthority", 0, value.blockNumber, value.blockHash,
    ),
    normalizeV4AtomicDeploymentResult(
      value.resultingContracts[1], "graphFactory", 1, value.blockNumber, value.blockHash,
    ),
    normalizeV4AtomicDeploymentResult(
      value.resultingContracts[2], "programmableLaunchStampRouter", 2,
      value.blockNumber, value.blockHash,
    ),
  ];
  const ethereumFinalityEvidence = normalizeV4EthereumFinalityEvidence(
    value.ethereumFinalityEvidence,
    "chainDeployment.deploymentEvidence.ethereumFinalityEvidence",
  );
  if (ethereumFinalityEvidence.l2Checkpoint.blockNumber !== value.blockNumber
    || ethereumFinalityEvidence.l2Checkpoint.blockHash !== value.blockHash) {
    throw new TypeError("chainDeployment atomic block lacks exact Ethereum finality evidence");
  }
  const normalized = {
    schemaVersion: V4_ATOMIC_ROOT_DEPLOYMENT_EVIDENCE_SCHEMA,
    deploymentId: ROBINHOOD_CHAIN_DEPLOYMENT_ID,
    chainId: ROBINHOOD_CHAIN_ID,
    coveredContracts: [
      "programmableLaunchStampRouter", "graphFactory", "permitAuthority",
    ],
    transactionHash: value.transactionHash,
    from,
    to: ROBINHOOD_MULTICALL3,
    valueWei: "0",
    selector: ATOMIC_DEPLOYMENT_SELECTOR,
    calldataHash: ATOMIC_DEPLOYMENT_CALLDATA_HASH,
    calldataBytes: ATOMIC_DEPLOYMENT_CALLDATA_BYTES,
    nonce: value.nonce,
    transactionIndex: value.transactionIndex,
    receiptStatus: "1",
    blockNumber: value.blockNumber,
    blockHash: value.blockHash,
    receiptLogs,
    receiptLogsDigest: value.receiptLogsDigest,
    providerReadbacks,
    resultingContracts,
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
  if (value.evidenceDigest !== framedSha256Json(
    V4_ATOMIC_ROOT_DEPLOYMENT_EVIDENCE_SCHEMA,
    normalized,
  )) {
    throw new TypeError("chainDeployment atomic deployment evidence digest is invalid");
  }
  return { ...normalized, evidenceDigest: value.evidenceDigest };
}

function normalizeV4AtomicProviderReadback(
  value,
  transactionHash,
  providerId,
  trustDomain,
  index,
) {
  const label = `chainDeployment.deploymentEvidence.providerReadbacks[${index}]`;
  assertExactKeys(value, [
    "providerId", "trustDomain", "transactionHash", "transactionResponseDigest",
    "transactionReceiptDigest", "evidenceDigest",
  ], label);
  if (value.providerId !== providerId || value.trustDomain !== trustDomain
    || value.transactionHash !== transactionHash
    || typeof value.transactionResponseDigest !== "string"
    || !SHA256.test(value.transactionResponseDigest)
    || typeof value.transactionReceiptDigest !== "string"
    || !SHA256.test(value.transactionReceiptDigest)) {
    throw new TypeError(`${label} is not the exact independent atomic transaction readback`);
  }
  const normalized = {
    providerId,
    trustDomain,
    transactionHash,
    transactionResponseDigest: value.transactionResponseDigest,
    transactionReceiptDigest: value.transactionReceiptDigest,
  };
  if (value.evidenceDigest !== framedSha256Json(ATOMIC_PROVIDER_READBACK_SCHEMA, normalized)) {
    throw new TypeError(`${label}.evidenceDigest is invalid`);
  }
  return { ...normalized, evidenceDigest: value.evidenceDigest };
}

function normalizeV4AtomicDeploymentResult(
  value,
  contract,
  index,
  deploymentBlockNumber,
  deploymentBlockHash,
) {
  const label = `chainDeployment.deploymentEvidence.resultingContracts[${index}]`;
  assertExactKeys(value, [
    "contract", "address", "runtimeCodeHash", "previousBlockRuntimeCodeHash",
    "providerReadbacks", "stateEvidenceDigest",
  ], label);
  const expected = V4_PINNED_TRUST_ROOTS[contract];
  const address = exactEip55Address(value.address, `${label}.address`);
  if (value.contract !== contract
    || address !== expected.address
    || value.runtimeCodeHash !== expected.runtimeCodeHash
    || value.previousBlockRuntimeCodeHash !== EMPTY_RUNTIME_CODE_HASH
    || !Array.isArray(value.providerReadbacks)
    || value.providerReadbacks.length !== 2
    || typeof value.stateEvidenceDigest !== "string"
    || !SHA256.test(value.stateEvidenceDigest)) {
    throw new TypeError(`${label} does not prove the exact D-1 to D root transition`);
  }
  const providerReadbacks = [
    normalizeV4AtomicRuntimeTransitionReadback(
      value.providerReadbacks[0], contract, expected, deploymentBlockNumber,
      deploymentBlockHash, "quicknode", "quicknode.com", `${label}.providerReadbacks[0]`,
    ),
    normalizeV4AtomicRuntimeTransitionReadback(
      value.providerReadbacks[1], contract, expected, deploymentBlockNumber,
      deploymentBlockHash, "alchemy", "alchemy.com", `${label}.providerReadbacks[1]`,
    ),
  ];
  if (providerReadbacks[0].preDeploymentBlockHash
      !== providerReadbacks[1].preDeploymentBlockHash) {
    throw new TypeError(`${label} providers disagree on the D-1 block`);
  }
  const normalized = {
    contract,
    address,
    runtimeCodeHash: value.runtimeCodeHash,
    previousBlockRuntimeCodeHash: EMPTY_RUNTIME_CODE_HASH,
    providerReadbacks,
  };
  if (value.stateEvidenceDigest !== framedSha256Json(ATOMIC_RESULT_STATE_SCHEMA, normalized)) {
    throw new TypeError(`${label}.stateEvidenceDigest is invalid`);
  }
  return { ...normalized, stateEvidenceDigest: value.stateEvidenceDigest };
}

function normalizeV4AtomicRuntimeTransitionReadback(
  value,
  contract,
  expected,
  deploymentBlockNumber,
  deploymentBlockHash,
  providerId,
  trustDomain,
  label,
) {
  assertExactKeys(value, [
    "schemaVersion", "providerId", "trustDomain", "contract", "address",
    "preDeploymentBlockNumber", "preDeploymentBlockHash",
    "preDeploymentRuntimeCodeHash", "deploymentBlockNumber", "deploymentBlockHash",
    "deploymentRuntimeCodeHash", "evidenceDigest",
  ], label);
  const address = exactEip55Address(value.address, `${label}.address`);
  const preDeploymentBlockNumber = (BigInt(deploymentBlockNumber) - 1n).toString();
  if (value.schemaVersion !== ATOMIC_RUNTIME_TRANSITION_PROVIDER_READBACK_SCHEMA
    || value.providerId !== providerId
    || value.trustDomain !== trustDomain
    || value.contract !== contract
    || address !== expected.address
    || value.preDeploymentBlockNumber !== preDeploymentBlockNumber
    || !NONZERO_HEX32(value.preDeploymentBlockHash)
    || value.preDeploymentRuntimeCodeHash !== EMPTY_RUNTIME_CODE_HASH
    || value.deploymentBlockNumber !== deploymentBlockNumber
    || value.deploymentBlockHash !== deploymentBlockHash
    || value.deploymentRuntimeCodeHash !== expected.runtimeCodeHash) {
    throw new TypeError(`${label} does not prove the exact D-1 to D runtime transition`);
  }
  const normalized = {
    schemaVersion: ATOMIC_RUNTIME_TRANSITION_PROVIDER_READBACK_SCHEMA,
    providerId,
    trustDomain,
    contract,
    address,
    preDeploymentBlockNumber,
    preDeploymentBlockHash: value.preDeploymentBlockHash,
    preDeploymentRuntimeCodeHash: EMPTY_RUNTIME_CODE_HASH,
    deploymentBlockNumber,
    deploymentBlockHash,
    deploymentRuntimeCodeHash: expected.runtimeCodeHash,
  };
  if (value.evidenceDigest !== framedSha256Json(
    ATOMIC_RUNTIME_TRANSITION_PROVIDER_READBACK_SCHEMA,
    normalized,
  )) {
    throw new TypeError(`${label}.evidenceDigest is invalid`);
  }
  return { ...normalized, evidenceDigest: value.evidenceDigest };
}

function normalizeV4PermitAuthoritySourceProvenance(value) {
  assertExactKeys(value, [
    "schemaVersion",
    "kind",
    "address",
    "transactionHash",
    "blockNumber",
    "blockHash",
    "sourceCommitment",
    "evidenceDigest",
    "configurationEvidence",
  ], "chainDeployment.permitAuthoritySourceProvenance");
  const address = exactEip55Address(
    value.address,
    "chainDeployment.permitAuthoritySourceProvenance.address",
  );
  if (value.schemaVersion !== V4_DEPLOYMENT_EVIDENCE_SCHEMA
    || value.kind !== "official-source-pinned"
    || !NONZERO_HEX32(value.transactionHash)
    || !NONZERO_UINT(value.blockNumber)
    || !NONZERO_HEX32(value.blockHash)
    || value.sourceCommitment !== SAFE_SOURCE_COMMITMENT
    || typeof value.evidenceDigest !== "string"
    || !SHA256.test(value.evidenceDigest)) {
    throw new TypeError("chainDeployment permitAuthority source provenance is invalid");
  }
  const configurationEvidence = normalizeV4SafeConfigurationEvidence(
    value.configurationEvidence,
  );
  const normalized = {
    schemaVersion: V4_DEPLOYMENT_EVIDENCE_SCHEMA,
    kind: "official-source-pinned",
    address,
    transactionHash: value.transactionHash,
    blockNumber: value.blockNumber,
    blockHash: value.blockHash,
    sourceCommitment: SAFE_SOURCE_COMMITMENT,
    configurationEvidence,
  };
  if (value.evidenceDigest !== framedSha256Json(V4_DEPLOYMENT_EVIDENCE_SCHEMA, normalized)) {
    throw new TypeError(
      "chainDeployment permitAuthority provenance digest does not bind the exact Safe evidence",
    );
  }
  return { ...normalized, evidenceDigest: value.evidenceDigest };
}

function normalizeV4SafeConfigurationEvidence(value) {
  const label = "chainDeployment.permitAuthoritySourceProvenance.configurationEvidence";
  assertExactKeys(value, [
    "schemaVersion",
    "finalized",
    "blockNumber",
    "blockHash",
    "proxyRuntimeCodeHash",
    "singleton",
    "fallbackHandler",
    "fallbackHandlerRuntimeCodeHash",
    "owners",
    "threshold",
    "nonce",
    "modules",
    "modulesNext",
    "guard",
    "singletonSlot",
    "fallbackHandlerSlot",
    "guardSlot",
    "primaryProvider",
    "secondaryProvider",
    "atomicRootStateEvidenceDigest",
    "ethereumFinalityEvidence",
    "evidenceDigest",
  ], label);
  assertExactKeys(value.singleton, [
    "address", "runtimeCodeHash", "version", "sourceCommitment",
  ], `${label}.singleton`);
  if (value.schemaVersion !== SAFE_CONFIGURATION_SCHEMA
    || value.finalized !== true
    || !NONZERO_UINT(value.blockNumber)
    || !NONZERO_HEX32(value.blockHash)
    || value.proxyRuntimeCodeHash !== SAFE_PROXY_RUNTIME_CODE_HASH
    || value.singleton.version !== "1.4.1"
    || value.singleton.runtimeCodeHash !== SAFE_SINGLETON_RUNTIME_CODE_HASH
    || value.singleton.sourceCommitment !== SAFE_SOURCE_COMMITMENT
    || value.fallbackHandlerRuntimeCodeHash !== SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH
    || !Array.isArray(value.owners)
    || canonicalizeJson(value.owners) !== canonicalizeJson(SAFE_OWNERS)
    || !Array.isArray(value.modules)
    || value.modules.length !== 0
    || value.modulesNext !== SAFE_MODULES_END_SENTINEL
    || value.threshold !== 1
    || value.nonce !== "0"
    || value.guard !== null
    || !HEX32.test(value.singletonSlot)
    || !HEX32.test(value.fallbackHandlerSlot)
    || !HEX32.test(value.guardSlot)
    || typeof value.atomicRootStateEvidenceDigest !== "string"
    || !SHA256.test(value.atomicRootStateEvidenceDigest)
    || typeof value.evidenceDigest !== "string"
    || !SHA256.test(value.evidenceDigest)) {
    throw new TypeError(`${label} is invalid`);
  }
  const owners = value.owners.map((owner, index) => exactEip55Address(
    owner,
    `${label}.owners[${index}]`,
  ));
  const modules = value.modules.map((module, index) => exactEip55Address(
    module,
    `${label}.modules[${index}]`,
  ));
  if (new Set(owners).size !== owners.length || new Set(modules).size !== modules.length) {
    throw new TypeError(`${label} owners and modules must be unique`);
  }
  const primaryProvider = normalizeV4SafeConfigurationProvider(
    value.primaryProvider,
    `${label}.primaryProvider`,
    "quicknode",
    "quicknode.com",
  );
  const secondaryProvider = normalizeV4SafeConfigurationProvider(
    value.secondaryProvider,
    `${label}.secondaryProvider`,
    "alchemy",
    "alchemy.com",
  );
  const singletonAddress = exactEip55Address(value.singleton.address, `${label}.singleton.address`);
  const fallbackHandler = exactEip55Address(value.fallbackHandler, `${label}.fallbackHandler`);
  if (singletonAddress !== SAFE_SINGLETON_ADDRESS
    || fallbackHandler !== SAFE_FALLBACK_HANDLER_ADDRESS
    || storageWordAddress(value.singletonSlot, `${label}.singletonSlot`)
      !== SAFE_SINGLETON_ADDRESS.toLowerCase()
    || storageWordAddress(value.fallbackHandlerSlot, `${label}.fallbackHandlerSlot`)
      !== SAFE_FALLBACK_HANDLER_ADDRESS.toLowerCase()
    || storageWordAddress(value.guardSlot, `${label}.guardSlot`) !== null) {
    throw new TypeError(`${label} differs from the pinned Safe deployment and storage state`);
  }
  const ethereumFinalityEvidence = normalizeV4EthereumFinalityEvidence(
    value.ethereumFinalityEvidence,
    `${label}.ethereumFinalityEvidence`,
  );
  if (ethereumFinalityEvidence.l2Checkpoint.blockNumber !== value.blockNumber
    || ethereumFinalityEvidence.l2Checkpoint.blockHash !== value.blockHash) {
    throw new TypeError(`${label} is not bound to its Ethereum-finalized L2 checkpoint`);
  }
  const normalized = {
    schemaVersion: SAFE_CONFIGURATION_SCHEMA,
    finalized: true,
    blockNumber: value.blockNumber,
    blockHash: value.blockHash,
    proxyRuntimeCodeHash: SAFE_PROXY_RUNTIME_CODE_HASH,
    singleton: {
      address: SAFE_SINGLETON_ADDRESS,
      runtimeCodeHash: SAFE_SINGLETON_RUNTIME_CODE_HASH,
      version: "1.4.1",
      sourceCommitment: SAFE_SOURCE_COMMITMENT,
    },
    fallbackHandler: SAFE_FALLBACK_HANDLER_ADDRESS,
    fallbackHandlerRuntimeCodeHash: SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH,
    owners,
    threshold: 1,
    nonce: "0",
    modules,
    modulesNext: SAFE_MODULES_END_SENTINEL,
    guard: null,
    singletonSlot: value.singletonSlot,
    fallbackHandlerSlot: value.fallbackHandlerSlot,
    guardSlot: value.guardSlot,
    primaryProvider,
    secondaryProvider,
    atomicRootStateEvidenceDigest: value.atomicRootStateEvidenceDigest,
    ethereumFinalityEvidence,
  };
  if (value.evidenceDigest !== framedSha256Json(SAFE_CONFIGURATION_SCHEMA, normalized)) {
    throw new TypeError(`${label}.evidenceDigest does not bind the exact finalized Safe state`);
  }
  return { ...normalized, evidenceDigest: value.evidenceDigest };
}

function normalizeV4EthereumFinalityEvidence(value, label) {
  assertExactKeys(value, [
    "schemaVersion", "profile", "l2Checkpoint", "batchNumber", "l2Providers",
    "ethereumProviders", "rollup", "sequencerInbox", "postingTransactionHash",
    "postingBlockNumber", "postingBlockHash", "postingLogIndex",
    "ethereumFinalizedCheckpoint", "observedAt", "captureClosureDigest",
    "postingEventDigest", "l1EvidenceDigest", "evidenceDigest",
  ], label);
  assertExactKeys(value.l2Checkpoint, ["blockNumber", "blockHash"], `${label}.l2Checkpoint`);
  assertExactKeys(
    value.ethereumFinalizedCheckpoint,
    ["blockNumber", "blockHash", "tag"],
    `${label}.ethereumFinalizedCheckpoint`,
  );
  if (value.schemaVersion !== V4_L2_CHECKPOINT_ETHEREUM_FINALITY_SCHEMA
    || !NONZERO_UINT(value.l2Checkpoint.blockNumber)
    || !NONZERO_HEX32(value.l2Checkpoint.blockHash)
    || !NONZERO_UINT(value.batchNumber)
    || !Array.isArray(value.l2Providers)
    || value.l2Providers.length !== 2
    || !Array.isArray(value.ethereumProviders)
    || value.ethereumProviders.length !== 2
    || !NONZERO_HEX32(value.postingTransactionHash)
    || !NONZERO_UINT(value.postingBlockNumber)
    || !NONZERO_HEX32(value.postingBlockHash)
    || typeof value.postingLogIndex !== "string"
    || !DECIMAL.test(value.postingLogIndex)
    || BigInt(value.postingLogIndex) >= 1n << 256n
    || !NONZERO_UINT(value.ethereumFinalizedCheckpoint.blockNumber)
    || !NONZERO_HEX32(value.ethereumFinalizedCheckpoint.blockHash)
    || value.ethereumFinalizedCheckpoint.tag !== "finalized"
    || BigInt(value.ethereumFinalizedCheckpoint.blockNumber) < BigInt(value.postingBlockNumber)
    || typeof value.observedAt !== "string"
    || !Number.isFinite(Date.parse(value.observedAt))
    || new Date(value.observedAt).toISOString() !== value.observedAt
    || typeof value.captureClosureDigest !== "string" || !SHA256.test(value.captureClosureDigest)
    || typeof value.postingEventDigest !== "string" || !SHA256.test(value.postingEventDigest)
    || typeof value.l1EvidenceDigest !== "string" || !SHA256.test(value.l1EvidenceDigest)) {
    throw new TypeError(`${label} is invalid`);
  }
  const profile = normalizeV4ProfileRef(value.profile);
  const l2Providers = [
    normalizeV4L2FinalityProvider(
      value.l2Providers[0], `${label}.l2Providers[0]`, "quicknode", "quicknode.com",
    ),
    normalizeV4L2FinalityProvider(value.l2Providers[1], `${label}.l2Providers[1]`, "alchemy", "alchemy.com"),
  ];
  const ethereumProviders = [
    normalizeV4EthereumFinalityProvider(
      value.ethereumProviders[0], `${label}.ethereumProviders[0]`, "drpc", "drpc.org",
    ),
    normalizeV4EthereumFinalityProvider(
      value.ethereumProviders[1], `${label}.ethereumProviders[1]`, "quicknode", "quicknode.com",
    ),
  ];
  const rollup = exactEip55Address(value.rollup, `${label}.rollup`);
  const sequencerInbox = exactEip55Address(value.sequencerInbox, `${label}.sequencerInbox`);
  if (rollup !== ROBINHOOD_ETHEREUM_ROLLUP
    || sequencerInbox !== ROBINHOOD_ETHEREUM_SEQUENCER_INBOX) {
    throw new TypeError(`${label} does not bind the official Robinhood Ethereum contracts`);
  }
  const normalized = {
    schemaVersion: V4_L2_CHECKPOINT_ETHEREUM_FINALITY_SCHEMA,
    profile,
    l2Checkpoint: {
      blockNumber: value.l2Checkpoint.blockNumber,
      blockHash: value.l2Checkpoint.blockHash,
    },
    batchNumber: value.batchNumber,
    l2Providers,
    ethereumProviders,
    rollup: ROBINHOOD_ETHEREUM_ROLLUP,
    sequencerInbox: ROBINHOOD_ETHEREUM_SEQUENCER_INBOX,
    postingTransactionHash: value.postingTransactionHash,
    postingBlockNumber: value.postingBlockNumber,
    postingBlockHash: value.postingBlockHash,
    postingLogIndex: value.postingLogIndex,
    ethereumFinalizedCheckpoint: {
      blockNumber: value.ethereumFinalizedCheckpoint.blockNumber,
      blockHash: value.ethereumFinalizedCheckpoint.blockHash,
      tag: "finalized",
    },
    observedAt: value.observedAt,
    captureClosureDigest: value.captureClosureDigest,
    postingEventDigest: value.postingEventDigest,
    l1EvidenceDigest: value.l1EvidenceDigest,
  };
  if (value.evidenceDigest !== framedSha256Json(
    V4_L2_CHECKPOINT_ETHEREUM_FINALITY_SCHEMA,
    normalized,
  )) {
    throw new TypeError(`${label}.evidenceDigest does not bind the L2-to-L1 finality receipt`);
  }
  return { ...normalized, evidenceDigest: value.evidenceDigest };
}

function normalizeV4L2FinalityProvider(value, label, providerId, trustDomain) {
  assertExactKeys(value, ["providerId", "trustDomain", "l1Confirmations"], label);
  if (value.providerId !== providerId || value.trustDomain !== trustDomain
    || !NONZERO_UINT(value.l1Confirmations)) {
    throw new TypeError(`${label} is not the exact independent L2 provider`);
  }
  return { providerId, trustDomain, l1Confirmations: value.l1Confirmations };
}

function normalizeV4EthereumFinalityProvider(value, label, providerId, trustDomain) {
  assertExactKeys(value, ["providerId", "trustDomain"], label);
  if (value.providerId !== providerId || value.trustDomain !== trustDomain) {
    throw new TypeError(`${label} is not the exact independent Ethereum provider`);
  }
  return { providerId, trustDomain };
}

function storageWordAddress(value, label) {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError(`${label} is not a canonical address storage word`);
  }
  const address = value.slice(26);
  return /^0{40}$/u.test(address) ? null : `0x${address}`;
}

function normalizeV4SafeConfigurationProvider(value, label, providerId, trustDomain) {
  assertExactKeys(value, ["providerId", "trustDomain", "evidenceDigest"], label);
  if (value.providerId !== providerId
    || value.trustDomain !== trustDomain
    || typeof value.evidenceDigest !== "string"
    || !SHA256.test(value.evidenceDigest)) {
    throw new TypeError(`${label} is not the exact independent provider identity`);
  }
  return { providerId, trustDomain, evidenceDigest: value.evidenceDigest };
}

function framedSha256Json(domain, value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function normalizeV4ExternalRootDeploymentEvidence(value) {
  if (!Array.isArray(value) || value.length !== V4_EXTERNAL_ROOT_NAMES.length) {
    throw new TypeError("externalRootDeploymentEvidence must cover every external root once");
  }
  const normalized = value.map((entry, index) => {
    const label = `chainDeployment.externalRootDeploymentEvidence[${index}]`;
    const expectedContract = V4_EXTERNAL_ROOT_NAMES[index];
    const expected = V4_EXTERNAL_ROOT_DEPLOYMENTS[expectedContract];
    assertExactKeys(entry, [
      "schemaVersion",
      "contract",
      "kind",
      "address",
      "runtimeCodeHash",
      "transactionHash",
      "previousBlockNumber",
      "previousBlockHash",
      "previousBlockRuntimeCodeHash",
      "startBlock",
      "blockHash",
      "registrySource",
      "providerReadbacks",
      "evidenceDigest",
    ], label);
    assertExactKeys(entry.registrySource, [
      "repository", "commit", "path", "rawUrl", "sha256",
    ], `${label}.registrySource`);
    const address = exactEip55Address(entry.address, `${label}.address`);
    if (entry.schemaVersion !== V4_DEPLOYMENT_EVIDENCE_SCHEMA
      || entry.kind !== "exact-observed-deployment"
      || entry.contract !== expectedContract
      || address !== expected.address
      || entry.runtimeCodeHash !== expected.runtimeCodeHash
      || entry.transactionHash !== expected.transactionHash
      || entry.previousBlockNumber !== (BigInt(expected.startBlock) - 1n).toString(10)
      || !NONZERO_HEX32(entry.previousBlockHash)
      || entry.previousBlockRuntimeCodeHash !== EMPTY_RUNTIME_CODE_HASH
      || entry.startBlock !== expected.startBlock
      || !NONZERO_HEX32(entry.blockHash)
      || canonicalizeJson(entry.registrySource) !== canonicalizeJson(V4_UNISWAP_REGISTRY_SOURCE)
      || !Array.isArray(entry.providerReadbacks)
      || entry.providerReadbacks.length !== 2) {
      throw new TypeError(`${label} is invalid`);
    }
    const providerReadbacks = [
      normalizeV4ExternalRootProviderReadback(
        entry.providerReadbacks[0], expected, "quicknode", "quicknode.com",
        `${label}.providerReadbacks[0]`,
      ),
      normalizeV4ExternalRootProviderReadback(
        entry.providerReadbacks[1], expected, "alchemy", "alchemy.com",
        `${label}.providerReadbacks[1]`,
      ),
    ];
    if (providerReadbacks[0].rawTransactionDigest
        !== providerReadbacks[1].rawTransactionDigest
      || providerReadbacks[0].blockHash !== providerReadbacks[1].blockHash
      || providerReadbacks[0].previousBlockHash !== providerReadbacks[1].previousBlockHash
      || providerReadbacks[0].transactionDigest !== providerReadbacks[1].transactionDigest
      || providerReadbacks[0].transactionReceiptDigest
        !== providerReadbacks[1].transactionReceiptDigest
      || entry.previousBlockHash !== providerReadbacks[0].previousBlockHash
      || entry.blockHash !== providerReadbacks[0].blockHash) {
      throw new TypeError(`${label} dual providers disagree on the deployment block`);
    }
    const withoutDigest = {
      schemaVersion: V4_DEPLOYMENT_EVIDENCE_SCHEMA,
      contract: expectedContract,
      kind: "exact-observed-deployment",
      address: expected.address,
      runtimeCodeHash: expected.runtimeCodeHash,
      transactionHash: expected.transactionHash,
      previousBlockNumber: entry.previousBlockNumber,
      previousBlockHash: entry.previousBlockHash,
      previousBlockRuntimeCodeHash: EMPTY_RUNTIME_CODE_HASH,
      startBlock: expected.startBlock,
      blockHash: entry.blockHash,
      registrySource: V4_UNISWAP_REGISTRY_SOURCE,
      providerReadbacks,
    };
    if (entry.evidenceDigest !== framedSha256Json(V4_DEPLOYMENT_EVIDENCE_SCHEMA, withoutDigest)) {
      throw new TypeError(`${label}.evidenceDigest is invalid`);
    }
    return { ...withoutDigest, evidenceDigest: entry.evidenceDigest };
  });
  return normalized;
}

function normalizeV4ExternalRootProviderReadback(
  value,
  expected,
  providerId,
  trustDomain,
  label,
) {
  assertExactKeys(value, [
    "providerId", "trustDomain", "transactionHash", "rawTransactionDigest", "transactionDigest",
    "previousBlockNumber", "previousBlockHash", "previousBlockRuntimeCodeHash",
    "blockNumber", "blockHash", "runtimeCodeHash", "transactionReceiptDigest",
    "evidenceDigest",
  ], label);
  if (value.providerId !== providerId || value.trustDomain !== trustDomain
    || value.transactionHash !== expected.transactionHash
    || typeof value.rawTransactionDigest !== "string" || !SHA256.test(value.rawTransactionDigest)
    || typeof value.transactionDigest !== "string" || !SHA256.test(value.transactionDigest)
    || value.previousBlockNumber !== (BigInt(expected.startBlock) - 1n).toString(10)
    || !NONZERO_HEX32(value.previousBlockHash)
    || value.previousBlockRuntimeCodeHash !== EMPTY_RUNTIME_CODE_HASH
    || value.blockNumber !== expected.startBlock
    || !NONZERO_HEX32(value.blockHash)
    || value.runtimeCodeHash !== expected.runtimeCodeHash
    || typeof value.transactionReceiptDigest !== "string"
    || !SHA256.test(value.transactionReceiptDigest)) {
    throw new TypeError(`${label} differs from the exact registry deployment`);
  }
  const withoutDigest = {
    providerId,
    trustDomain,
    transactionHash: expected.transactionHash,
    rawTransactionDigest: value.rawTransactionDigest,
    transactionDigest: value.transactionDigest,
    previousBlockNumber: value.previousBlockNumber,
    previousBlockHash: value.previousBlockHash,
    previousBlockRuntimeCodeHash: EMPTY_RUNTIME_CODE_HASH,
    blockNumber: expected.startBlock,
    blockHash: value.blockHash,
    runtimeCodeHash: expected.runtimeCodeHash,
    transactionReceiptDigest: value.transactionReceiptDigest,
  };
  if (value.evidenceDigest !== framedSha256Json(
    EXTERNAL_DEPLOYMENT_PROVIDER_READBACK_SCHEMA,
    withoutDigest,
  )) {
    throw new TypeError(`${label}.evidenceDigest is invalid`);
  }
  return { ...withoutDigest, evidenceDigest: value.evidenceDigest };
}

function NONZERO_HEX32(value) {
  return typeof value === "string" && HEX32.test(value)
    && value !== `0x${"0".repeat(64)}`;
}

function NONZERO_UINT(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value)
    && BigInt(value) < 1n << 256n;
}

function normalizeV4Permit2GenesisProvenance(value) {
  assertExactKeys(value, [
    "schemaVersion",
    "kind",
    "address",
    "startBlock",
    "genesisSourceUrl",
    "genesisSourceDigest",
    "allocRuntimeCodeBytes",
    "providerReadbacks",
    "evidenceDigest",
  ], "chainDeployment.permit2GenesisProvenance");
  const address = exactEip55Address(
    value.address,
    "chainDeployment.permit2GenesisProvenance.address",
  );
  if (value.schemaVersion !== V4_GENESIS_PROVENANCE_SCHEMA
    || value.kind !== "genesis-predeploy"
    || value.startBlock !== "0"
    || address !== PERMIT2_ADDRESS
    || value.genesisSourceUrl !== PERMIT2_GENESIS_SOURCE_URL
    || value.genesisSourceDigest !== PERMIT2_GENESIS_SOURCE_DIGEST
    || value.allocRuntimeCodeBytes !== PERMIT2_GENESIS_RUNTIME_CODE_BYTES
    || !Array.isArray(value.providerReadbacks)
    || value.providerReadbacks.length !== 2) {
    throw new TypeError(
      "chainDeployment Permit2 startBlock 0 requires exact genesis-predeploy provenance",
    );
  }
  const providerReadbacks = [
    normalizeV4Permit2GenesisProviderReadback(
      value.providerReadbacks[0],
      "chainDeployment.permit2GenesisProvenance.providerReadbacks[0]",
      "quicknode",
      "quicknode.com",
    ),
    normalizeV4Permit2GenesisProviderReadback(
      value.providerReadbacks[1],
      "chainDeployment.permit2GenesisProvenance.providerReadbacks[1]",
      "alchemy",
      "alchemy.com",
    ),
  ];
  if (providerReadbacks[0].blockHash !== providerReadbacks[1].blockHash) {
    throw new TypeError("chainDeployment Permit2 genesis providers disagree on block zero");
  }
  const normalized = {
    schemaVersion: V4_GENESIS_PROVENANCE_SCHEMA,
    kind: "genesis-predeploy",
    address: PERMIT2_ADDRESS,
    startBlock: "0",
    genesisSourceUrl: PERMIT2_GENESIS_SOURCE_URL,
    genesisSourceDigest: PERMIT2_GENESIS_SOURCE_DIGEST,
    allocRuntimeCodeBytes: PERMIT2_GENESIS_RUNTIME_CODE_BYTES,
    providerReadbacks,
  };
  if (value.evidenceDigest !== framedSha256Json(V4_GENESIS_PROVENANCE_SCHEMA, normalized)) {
    throw new TypeError("chainDeployment Permit2 genesis provenance digest is invalid");
  }
  return { ...normalized, evidenceDigest: value.evidenceDigest };
}

function normalizeV4Permit2GenesisProviderReadback(value, label, providerId, trustDomain) {
  assertExactKeys(value, [
    "schemaVersion", "providerId", "trustDomain", "blockNumber", "blockHash",
    "runtimeCodeHash", "evidenceDigest",
  ], label);
  if (value.schemaVersion !== V4_GENESIS_PROVIDER_READBACK_SCHEMA
    || value.providerId !== providerId
    || value.trustDomain !== trustDomain
    || value.blockNumber !== "0"
    || !NONZERO_HEX32(value.blockHash)
    || value.runtimeCodeHash !== PERMIT2_RUNTIME_CODE_HASH) {
    throw new TypeError(`${label} is not the pinned block-zero Permit2 readback`);
  }
  const normalized = {
    schemaVersion: V4_GENESIS_PROVIDER_READBACK_SCHEMA,
    providerId,
    trustDomain,
    blockNumber: "0",
    blockHash: value.blockHash,
    runtimeCodeHash: PERMIT2_RUNTIME_CODE_HASH,
  };
  if (value.evidenceDigest !== framedSha256Json(
    V4_GENESIS_PROVIDER_READBACK_SCHEMA,
    normalized,
  )) {
    throw new TypeError(`${label}.evidenceDigest is invalid`);
  }
  return { ...normalized, evidenceDigest: value.evidenceDigest };
}

function normalizeTrustRoot(value, label) {
  assertExactKeys(value, ["address", "runtimeCodeHash"], label);
  const address = getAddress(value.address);
  if (address === "0x0000000000000000000000000000000000000000"
    || typeof value.runtimeCodeHash !== "string"
    || !HEX32.test(value.runtimeCodeHash)
    || value.runtimeCodeHash === `0x${"0".repeat(64)}`) {
    throw new TypeError(`${label} must bind a nonzero address and runtime code hash`);
  }
  return { address, runtimeCodeHash: value.runtimeCodeHash };
}

export function assertCanonicalV4ProfileVersion(value) {
  if (typeof value !== "string" || !PROFILE_VERSION.test(value)) {
    throw new TypeError("profileVersion must be an exact semantic version");
  }
  return value;
}

export function assertV4DeploymentDescriptorDigest(value, deployment) {
  if (typeof value !== "string" || !HEX32.test(value)) {
    throw new TypeError("chainDeploymentDescriptorDigest must be a lowercase bytes32 digest");
  }
  const expected = hashV4ChainDeployment(deployment);
  if (value !== expected) {
    throw new TypeError(
      `${V4_CHAIN_DEPLOYMENT_DIGEST_DOMAIN} digest does not match canonical chainDeployment`,
    );
  }
  return value;
}
