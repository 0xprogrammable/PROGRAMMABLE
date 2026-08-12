import { createHash } from "node:crypto";

import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  isAddress,
  keccak256,
  padHex,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toHex,
} from "viem";

export const EXACT_SHARDS_RELEASE_DESCRIPTOR_SCHEMA =
  "programmable.exact-shards-two-transaction-release-descriptor.v1";
export const EXACT_SHARDS_RELEASE_CHECKPOINT_SCHEMA =
  "programmable.exact-shards-two-transaction-release-checkpoint.v1";
export const EXACT_SHARDS_RELEASE_CAPTURE_SCHEMA =
  "programmable.exact-shards-two-transaction-release-capture.v1";

export const REQUIRED_EXACT_SHARDS_READBACKS = Object.freeze([
  "authority.permitVerifier",
  "authority.permitVerifierRuntimeCodeHash",
  "registry.launchRoute",
  "registry.writerRole",
  "registry.feePolicyVerifier",
  "registry.feePolicyVerifierRuntimeCodeHash",
  "registry.launchPermitAuthority",
  "registry.registryGeneration",
  "registry.minimumFinalityBlocks",
  "registry.chainProfileHash",
  "registry.registryPolicyHash",
  "registry.defaultAdmin",
  "coordinator.permitAuthority",
  "coordinator.registry",
  "coordinator.reviewedFactoryImplementation",
  "coordinator.factory",
  "coordinator.route",
  "factory.authorizedRoute",
  "factory.implementation",
  "factory.implementationRuntimeCodeHash",
  "route.permitAuthority",
  "route.registry",
  "route.factory",
  "route.factoryRuntimeCodeHash",
  "route.permitVerifier",
  "route.permitVerifierRuntimeCodeHash",
  "route.poolManager",
  "route.poolManagerRuntimeCodeHash",
  "route.defaultRenderer",
  "route.defaultRendererRuntimeCodeHash",
]);

export const EXACT_SHARDS_REGISTRY_ROLE_IDS = Object.freeze({
  defaultAdmin: `0x${"00".repeat(32)}`,
  approver: keccak256(stringToHex("programmable.custom-registry.approver.v1")),
  launchIntentApprover: keccak256(
    stringToHex("programmable.exact-shards-registry.launch-intent-approver.v1"),
  ),
  writer: keccak256(stringToHex("programmable.custom-registry.writer.v1")),
  finalizer: keccak256(stringToHex("programmable.custom-registry.finalizer.v1")),
  revoker: keccak256(stringToHex("programmable.custom-registry.revoker.v1")),
});

const EXACT_SHARDS_REGISTRY_ROLE_CONFIG_FIELDS = Object.freeze({
  defaultAdmin: "initialAdmin",
  approver: "initialApprover",
  launchIntentApprover: "initialLaunchIntentApprover",
  writer: "initialWriter",
  finalizer: "initialFinalizer",
  revoker: "initialRevoker",
});

const STEP_NAMES = Object.freeze(["registry", "coordinator"]);
const ARTIFACT_NAMES = Object.freeze([
  "registry",
  "coordinator",
  "factory",
  "route",
]);
const STEP_STATUSES = new Set([
  "not-signed",
  "signed",
  "submitted",
  "finalized",
]);
const EXACT_SHARDS_PAIR_DEPLOYED_TOPIC = keccak256(
  stringToHex(
    "ExactShardsFactoryRoutePairDeployedV1(address,address,address,address,address,bytes32,bytes32)",
  ),
).toLowerCase();

export class ExactShardsReleaseError extends Error {
  constructor(code, message, details = undefined) {
    super(`${code}: ${message}`);
    this.name = "ExactShardsReleaseError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ExactShardsReleaseError(code, message, details);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_DESCRIPTOR", `${label} must be an object`);
  }
  return value;
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail("INVALID_DESCRIPTOR", `${label} must be a non-empty string`);
  }
  return value;
}

function normalizeHex(value, label, bytes = undefined) {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) ||
    (bytes !== undefined && value.length !== 2 + bytes * 2)
  ) {
    fail(
      "INVALID_DESCRIPTOR",
      `${label} must be ${bytes === undefined ? "even-length hex" : `${bytes}-byte hex`}`,
    );
  }
  return value.toLowerCase();
}

function normalizeBytes32(value, label) {
  const normalized = normalizeHex(value, label, 32);
  if (/^0x0{64}$/.test(normalized)) {
    fail("INVALID_DESCRIPTOR", `${label} must not be zero`);
  }
  return normalized;
}

function normalizeAddress(value, label) {
  if (typeof value !== "string" || !isAddress(value)) {
    fail("INVALID_DESCRIPTOR", `${label} must be an Ethereum address`);
  }
  return getAddress(value).toLowerCase();
}

function quantity(value, label) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    fail("INVALID_DESCRIPTOR", `${label} must be a non-negative quantity`);
  }
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    fail(
      "INVALID_DESCRIPTOR",
      `${label} must be an integer in [1, ${maximum}]`,
    );
  }
  return value;
}

function normalizeProviderIdentity(value, label) {
  const identity = assertObject(value, label);
  const canonicalOrigin = assertString(
    identity.canonicalOrigin,
    `${label}.canonicalOrigin`,
  );
  let parsedOrigin;
  try {
    const parsed = new URL(canonicalOrigin);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("non-canonical");
    }
    parsedOrigin = parsed.origin.toLowerCase();
  } catch {
    fail("INVALID_DESCRIPTOR", `${label}.canonicalOrigin must be a credential-free HTTPS origin`);
  }
  if (canonicalOrigin.toLowerCase() !== parsedOrigin) {
    fail("INVALID_DESCRIPTOR", `${label}.canonicalOrigin is not canonical`);
  }
  return {
    providerId: assertString(identity.providerId, `${label}.providerId`),
    credentialProviderId: assertString(
      identity.credentialProviderId,
      `${label}.credentialProviderId`,
    ),
    canonicalOrigin: parsedOrigin,
    trustDomain: assertString(identity.trustDomain, `${label}.trustDomain`),
    operatorIdentityHash: normalizeBytes32(
      identity.operatorIdentityHash,
      `${label}.operatorIdentityHash`,
    ),
    endpointCommitment: normalizeBytes32(
      identity.endpointCommitment,
      `${label}.endpointCommitment`,
    ),
  };
}

function validateIndependentProviderIdentities(values, label) {
  if (!Array.isArray(values) || values.length !== 2) {
    fail("INVALID_DESCRIPTOR", `${label} must bind exactly two read providers`);
  }
  const identities = values.map((value, index) =>
    normalizeProviderIdentity(value, `${label}[${index}]`),
  );
  for (const field of [
    "providerId",
    "credentialProviderId",
    "canonicalOrigin",
    "trustDomain",
    "operatorIdentityHash",
    "endpointCommitment",
  ]) {
    if (identities[0][field] === identities[1][field]) {
      fail("INVALID_DESCRIPTOR", `${label} must use distinct ${field} values`);
    }
  }
  return identities;
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail("INVALID_DESCRIPTOR", "canonical JSON numbers must be safe integers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  fail("INVALID_DESCRIPTOR", "descriptor contains a non-canonical JSON value");
}

export function canonicalSha256(value) {
  return `0x${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

export function exactShardsRpcEndpointCommitment(url) {
  return `0x${createHash("sha256").update(String(url)).digest("hex")}`;
}

function abiValue(type, value, label) {
  if (type === "address") return normalizeAddress(value, label);
  if (type === "bytes32") return normalizeHex(value, label, 32);
  if (type === "bool") {
    if (typeof value !== "boolean") {
      fail("INVALID_DESCRIPTOR", `${label} must be boolean`);
    }
    return value;
  }
  if (/^uint(?:8|16|32|48|64|128|256)?$/.test(type)) {
    return quantity(value, label);
  }
  fail("INVALID_DESCRIPTOR", `${label} uses unsupported ABI type ${type}`);
}

function canonicalAbiReadback({ label, target, signature, args = [], returnTypes, expectedValue }) {
  const abi = parseAbi([`function ${signature} view returns (${returnTypes.join(",")})`]);
  const inputTypes = signature
    .slice(signature.indexOf("(") + 1, signature.lastIndexOf(")"))
    .split(",")
    .filter(Boolean);
  if (inputTypes.length !== args.length || returnTypes.length !== expectedValue.length) {
    fail("INVALID_DESCRIPTOR", `${label} ABI arity is invalid`);
  }
  const normalizedArgs = args.map((value, index) =>
    abiValue(inputTypes[index], value, `${label}.args[${index}]`),
  );
  const normalizedReturns = expectedValue.map((value, index) =>
    abiValue(returnTypes[index], value, `${label}.expectedValue[${index}]`),
  );
  return {
    label,
    target: normalizeAddress(target, `${label}.target`),
    signature,
    args: args.map((value) => value),
    returnTypes: [...returnTypes],
    expectedValue: expectedValue.map((value) => value),
    data: encodeFunctionData({ abi, functionName: signature.slice(0, signature.indexOf("(")), args: normalizedArgs }),
    expectedReturn: encodeAbiParameters(
      parseAbiParameters(returnTypes.join(",")),
      normalizedReturns,
    ),
  };
}

export function exactShardsRegistryConstructorArgumentsHash(descriptor) {
  const config = assertObject(descriptor.registryConfig, "registryConfig");
  const dependencies = Object.fromEntries(
    descriptor.dependencies.map((dependency) => [dependency.label, dependency]),
  );
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "(uint48,address,address,address,address,address,address,uint64,uint64,bytes32,bytes32),address,address",
      ),
      [
        [
          quantity(config.initialAdminDelay, "registryConfig.initialAdminDelay"),
          normalizeAddress(config.initialAdmin, "registryConfig.initialAdmin"),
          normalizeAddress(config.initialApprover, "registryConfig.initialApprover"),
          normalizeAddress(
            config.initialLaunchIntentApprover,
            "registryConfig.initialLaunchIntentApprover",
          ),
          normalizeAddress(config.initialWriter, "registryConfig.initialWriter"),
          normalizeAddress(config.initialFinalizer, "registryConfig.initialFinalizer"),
          normalizeAddress(config.initialRevoker, "registryConfig.initialRevoker"),
          quantity(config.registryGeneration, "registryConfig.registryGeneration"),
          quantity(config.minimumFinalityBlocks, "registryConfig.minimumFinalityBlocks"),
          normalizeBytes32(config.chainProfileHash, "registryConfig.chainProfileHash"),
          normalizeBytes32(config.registryPolicyHash, "registryConfig.registryPolicyHash"),
        ],
        normalizeAddress(
          dependencies.feePolicyVerifier?.address,
          "dependencies.feePolicyVerifier.address",
        ),
        normalizeAddress(
          dependencies.permitAuthority?.address,
          "dependencies.permitAuthority.address",
        ),
      ],
    ),
  ).toLowerCase();
}

export function createExactShardsReleaseReadbacks(descriptor) {
  const addresses = expectedAddresses(descriptor);
  const config = assertObject(descriptor.registryConfig, "registryConfig");
  const dependencies = Object.fromEntries(
    descriptor.dependencies.map((dependency) => [dependency.label, dependency]),
  );
  const base = [
    ["authority.permitVerifier", dependencies.permitAuthority.address, "PERMIT_VERIFIER()", [], ["address"], [dependencies.permitVerifier.address]],
    ["authority.permitVerifierRuntimeCodeHash", dependencies.permitAuthority.address, "PERMIT_VERIFIER_RUNTIME_CODE_HASH()", [], ["bytes32"], [dependencies.permitVerifier.runtimeCodeHash]],
    ["registry.launchRoute", addresses.registry, "LAUNCH_ROUTE()", [], ["address"], [addresses.route]],
    ["registry.writerRole", addresses.registry, "WRITER_ROLE()", [], ["bytes32"], [EXACT_SHARDS_REGISTRY_ROLE_IDS.writer]],
    ["registry.feePolicyVerifier", addresses.registry, "FEE_POLICY_VERIFIER()", [], ["address"], [dependencies.feePolicyVerifier.address]],
    ["registry.feePolicyVerifierRuntimeCodeHash", addresses.registry, "VERIFIER_RUNTIME_CODE_HASH()", [], ["bytes32"], [dependencies.feePolicyVerifier.runtimeCodeHash]],
    ["registry.launchPermitAuthority", addresses.registry, "LAUNCH_PERMIT_AUTHORITY()", [], ["address"], [dependencies.permitAuthority.address]],
    ["registry.registryGeneration", addresses.registry, "REGISTRY_GENERATION()", [], ["uint64"], [config.registryGeneration]],
    ["registry.minimumFinalityBlocks", addresses.registry, "MINIMUM_FINALITY_BLOCKS()", [], ["uint64"], [config.minimumFinalityBlocks]],
    ["registry.chainProfileHash", addresses.registry, "CHAIN_PROFILE_HASH()", [], ["bytes32"], [config.chainProfileHash]],
    ["registry.registryPolicyHash", addresses.registry, "REGISTRY_POLICY_HASH()", [], ["bytes32"], [config.registryPolicyHash]],
    ["registry.defaultAdmin", addresses.registry, "defaultAdmin()", [], ["address"], [config.initialAdmin]],
    ["coordinator.permitAuthority", addresses.coordinator, "PERMIT_AUTHORITY()", [], ["address"], [dependencies.permitAuthority.address]],
    ["coordinator.registry", addresses.coordinator, "REGISTRY()", [], ["address"], [addresses.registry]],
    ["coordinator.reviewedFactoryImplementation", addresses.coordinator, "REVIEWED_FACTORY_IMPLEMENTATION()", [], ["address"], [dependencies.reviewedFactoryImplementation.address]],
    ["coordinator.factory", addresses.coordinator, "factory()", [], ["address"], [addresses.factory]],
    ["coordinator.route", addresses.coordinator, "route()", [], ["address"], [addresses.route]],
    ["factory.authorizedRoute", addresses.factory, "AUTHORIZED_ROUTE()", [], ["address"], [addresses.route]],
    ["factory.implementation", addresses.factory, "IMPLEMENTATION()", [], ["address"], [dependencies.reviewedFactoryImplementation.address]],
    ["factory.implementationRuntimeCodeHash", addresses.factory, "IMPLEMENTATION_RUNTIME_CODE_HASH()", [], ["bytes32"], [dependencies.reviewedFactoryImplementation.runtimeCodeHash]],
    ["route.permitAuthority", addresses.route, "PERMIT_AUTHORITY()", [], ["address"], [dependencies.permitAuthority.address]],
    ["route.registry", addresses.route, "REGISTRY()", [], ["address"], [addresses.registry]],
    ["route.factory", addresses.route, "FACTORY()", [], ["address"], [addresses.factory]],
    ["route.factoryRuntimeCodeHash", addresses.route, "FACTORY_RUNTIME_CODE_HASH()", [], ["bytes32"], [descriptor.artifacts.factory.runtimeCodeHash]],
    ["route.permitVerifier", addresses.route, "PERMIT_VERIFIER()", [], ["address"], [dependencies.permitVerifier.address]],
    ["route.permitVerifierRuntimeCodeHash", addresses.route, "PERMIT_VERIFIER_RUNTIME_CODE_HASH()", [], ["bytes32"], [dependencies.permitVerifier.runtimeCodeHash]],
    ["route.poolManager", addresses.route, "POOL_MANAGER()", [], ["address"], [dependencies.poolManager.address]],
    ["route.poolManagerRuntimeCodeHash", addresses.route, "POOL_MANAGER_RUNTIME_CODE_HASH()", [], ["bytes32"], [dependencies.poolManager.runtimeCodeHash]],
    ["route.defaultRenderer", addresses.route, "DEFAULT_RENDERER()", [], ["address"], [dependencies.defaultRenderer.address]],
    ["route.defaultRendererRuntimeCodeHash", addresses.route, "DEFAULT_RENDERER_RUNTIME_CODE_HASH()", [], ["bytes32"], [dependencies.defaultRenderer.runtimeCodeHash]],
  ].map(([label, target, signature, args, returnTypes, expectedValue]) =>
    canonicalAbiReadback({ label, target, signature, args, returnTypes, expectedValue }),
  );
  const roleReadbacks = [];
  for (const [actorRole, configField] of Object.entries(EXACT_SHARDS_REGISTRY_ROLE_CONFIG_FIELDS)) {
    for (const [testedRole, roleId] of Object.entries(EXACT_SHARDS_REGISTRY_ROLE_IDS)) {
      roleReadbacks.push(
        canonicalAbiReadback({
          label: `registry.role.${actorRole}.${testedRole}`,
          target: addresses.registry,
          signature: "hasRole(bytes32,address)",
          args: [roleId, config[configField]],
          returnTypes: ["bool"],
          expectedValue: [actorRole === testedRole],
        }),
      );
    }
  }
  return [...base, ...roleReadbacks];
}

function expectedAddresses(descriptor) {
  const deployer = normalizeAddress(descriptor.deployer.address, "deployer.address");
  const startingNonce = quantity(
    descriptor.deployer.startingNonce,
    "deployer.startingNonce",
  );
  const registry = getContractAddress({
    from: deployer,
    nonce: startingNonce,
    opcode: "CREATE",
  }).toLowerCase();
  const coordinator = getContractAddress({
    from: deployer,
    nonce: startingNonce + 1n,
    opcode: "CREATE",
  }).toLowerCase();
  const factory = getContractAddress({
    from: coordinator,
    nonce: 1n,
    opcode: "CREATE",
  }).toLowerCase();
  const route = getContractAddress({
    from: coordinator,
    nonce: 2n,
    opcode: "CREATE",
  }).toLowerCase();
  return { deployer, startingNonce, registry, coordinator, factory, route };
}

function validateTransaction(descriptor, transaction, index, addresses) {
  const step = STEP_NAMES[index];
  assertObject(transaction, `transactions[${index}]`);
  if (transaction.step !== step) {
    fail("INVALID_DESCRIPTOR", `transaction ${index} must be ${step}`);
  }
  const expectedNonce = addresses.startingNonce + BigInt(index);
  if (quantity(transaction.nonce, `${step}.nonce`) !== expectedNonce) {
    fail("INVALID_DESCRIPTOR", `${step} transaction nonce is not exact`);
  }
  if (
    quantity(transaction.chainId, `${step}.chainId`) !==
    quantity(descriptor.chain.chainId, "chain.chainId")
  ) {
    fail("INVALID_DESCRIPTOR", `${step} transaction chain id drifted`);
  }
  if (normalizeAddress(transaction.from, `${step}.from`) !== addresses.deployer) {
    fail("INVALID_DESCRIPTOR", `${step} transaction sender drifted`);
  }
  if (transaction.to !== null) {
    fail("INVALID_DESCRIPTOR", `${step} transaction must be contract creation`);
  }
  if (quantity(transaction.value, `${step}.value`) !== 0n) {
    fail("INVALID_DESCRIPTOR", `${step} transaction value must be zero`);
  }
  if (transaction.type !== "eip1559") {
    fail("INVALID_DESCRIPTOR", `${step} transaction type must be eip1559`);
  }
  const data = normalizeHex(transaction.data, `${step}.data`);
  if (data === "0x") {
    fail("INVALID_DESCRIPTOR", `${step} initcode must not be empty`);
  }
  const artifact = descriptor.artifacts[step];
  const initCodeByteLength = (data.length - 2) / 2;
  if (initCodeByteLength > 49_152) {
    fail("INVALID_DESCRIPTOR", `${step} initcode exceeds the EIP-3860 limit`);
  }
  if (artifact.initCodeByteLength !== initCodeByteLength) {
    fail("INVALID_DESCRIPTOR", `${step} initcode byte length drifted`);
  }
  if (keccak256(data).toLowerCase() !== normalizeBytes32(artifact.initCodeHash, `${step}.initCodeHash`)) {
    fail("INVALID_DESCRIPTOR", `${step} initcode hash drifted`);
  }
  const gas = quantity(transaction.gas, `${step}.gas`);
  const maxFeePerGas = quantity(
    transaction.maxFeePerGas,
    `${step}.maxFeePerGas`,
  );
  const maxPriorityFeePerGas = quantity(
    transaction.maxPriorityFeePerGas,
    `${step}.maxPriorityFeePerGas`,
  );
  if (gas === 0n || maxFeePerGas === 0n || maxPriorityFeePerGas > maxFeePerGas) {
    fail("INVALID_DESCRIPTOR", `${step} gas envelope is invalid`);
  }
  if (gas > quantity(descriptor.chain.maximumTransactionGas, "chain.maximumTransactionGas")) {
    fail("INVALID_DESCRIPTOR", `${step} gas exceeds the frozen chain cap`);
  }
  const expectedAddress = addresses[step];
  if (
    normalizeAddress(transaction.expectedContractAddress, `${step}.expectedContractAddress`) !==
    expectedAddress
  ) {
    fail("INVALID_DESCRIPTOR", `${step} expected address drifted`);
  }
}

export function validateExactShardsReleaseDescriptor(descriptor) {
  assertObject(descriptor, "descriptor");
  if (descriptor.schema !== EXACT_SHARDS_RELEASE_DESCRIPTOR_SCHEMA) {
    fail("INVALID_DESCRIPTOR", "unknown descriptor schema");
  }
  const release = assertObject(descriptor.release, "release");
  if (release.freezeStatus !== "DRAFT" && release.freezeStatus !== "FROZEN") {
    fail("INVALID_DESCRIPTOR", "release.freezeStatus must be DRAFT or FROZEN");
  }
  if (typeof release.activationAllowed !== "boolean") {
    fail("INVALID_DESCRIPTOR", "release.activationAllowed must be boolean");
  }
  positiveInteger(
    release.maximumExactHashBroadcastAttempts,
    "release.maximumExactHashBroadcastAttempts",
    10,
  );
  if (release.activationAllowed) {
    if (release.freezeStatus !== "FROZEN" || release.authorizationState !== "AUTHORIZED") {
      fail("INVALID_DESCRIPTOR", "activation requires FROZEN and AUTHORIZED release state");
    }
    normalizeBytes32(release.authorizationHash, "release.authorizationHash");
    normalizeBytes32(
      release.authorizationPolicyHash,
      "release.authorizationPolicyHash",
    );
    normalizeAddress(
      release.authorizedReleaseActor,
      "release.authorizedReleaseActor",
    );
  } else {
    if (
      release.authorizationState !== "NOT_AUTHORIZED" ||
      release.authorizationHash !== null ||
      release.authorizationPolicyHash !== null ||
      release.authorizedReleaseActor !== null
    ) {
      fail("INVALID_DESCRIPTOR", "inactive release must remain explicitly NOT_AUTHORIZED");
    }
  }

  const source = assertObject(descriptor.source, "source");
  assertString(source.repository, "source.repository");
  if (!/^[0-9a-f]{40}$/.test(source.commit)) {
    fail("INVALID_DESCRIPTOR", "source.commit must be an exact lowercase Git SHA");
  }
  normalizeBytes32(source.treeHash, "source.treeHash");
  normalizeBytes32(source.buildInputHash, "source.buildInputHash");
  normalizeBytes32(source.artifactBundleHash, "source.artifactBundleHash");
  const config = assertObject(descriptor.registryConfig, "registryConfig");
  const roleActors = Object.values(EXACT_SHARDS_REGISTRY_ROLE_CONFIG_FIELDS).map((field) =>
    normalizeAddress(config[field], `registryConfig.${field}`),
  );
  if (new Set(roleActors).size !== roleActors.length) {
    fail("INVALID_DESCRIPTOR", "Registry authority role actors must be pairwise distinct");
  }
  if (quantity(config.initialAdminDelay, "registryConfig.initialAdminDelay") === 0n) {
    fail("INVALID_DESCRIPTOR", "registryConfig.initialAdminDelay must not be zero");
  }
  if (quantity(config.registryGeneration, "registryConfig.registryGeneration") === 0n) {
    fail("INVALID_DESCRIPTOR", "registryConfig.registryGeneration must not be zero");
  }
  if (quantity(config.minimumFinalityBlocks, "registryConfig.minimumFinalityBlocks") === 0n) {
    fail("INVALID_DESCRIPTOR", "registryConfig.minimumFinalityBlocks must not be zero");
  }
  normalizeBytes32(config.chainProfileHash, "registryConfig.chainProfileHash");
  normalizeBytes32(config.registryPolicyHash, "registryConfig.registryPolicyHash");

  const chain = assertObject(descriptor.chain, "chain");
  if (quantity(chain.chainId, "chain.chainId") === 0n) {
    fail("INVALID_DESCRIPTOR", "chain.chainId must not be zero");
  }
  normalizeBytes32(chain.chainProfileHash, "chain.chainProfileHash");
  validateIndependentProviderIdentities(chain.readProviders, "chain.readProviders");
  const finality = assertObject(chain.finality, "chain.finality");
  positiveInteger(finality.minimumConfirmations, "minimumConfirmations", 256);
  positiveInteger(finality.maximumProviderHeadLag, "maximumProviderHeadLag", 32);
  if (quantity(chain.maximumTransactionGas, "chain.maximumTransactionGas") === 0n) {
    fail("INVALID_DESCRIPTOR", "chain.maximumTransactionGas must not be zero");
  }

  assertObject(descriptor.deployer, "deployer");
  const addresses = expectedAddresses(descriptor);
  const declaredAddresses = assertObject(descriptor.addresses, "addresses");
  for (const name of ARTIFACT_NAMES) {
    if (normalizeAddress(declaredAddresses[name], `addresses.${name}`) !== addresses[name]) {
      fail("INVALID_DESCRIPTOR", `${name} CREATE address is not canonical`);
    }
  }
  if (normalizeAddress(config.initialWriter, "registryConfig.initialWriter") !== addresses.route) {
    fail("INVALID_DESCRIPTOR", "Registry writer must be the exact predicted route");
  }
  if (
    quantity(config.registryGeneration, "registryConfig.registryGeneration") !==
      quantity(descriptor.registryConfig.registryGeneration, "registryGeneration") ||
    normalizeBytes32(config.chainProfileHash, "registryConfig.chainProfileHash") !==
      normalizeBytes32(descriptor.chain.chainProfileHash, "chain.chainProfileHash")
  ) {
    fail("INVALID_DESCRIPTOR", "Registry config and chain descriptor drifted");
  }

  const artifacts = assertObject(descriptor.artifacts, "artifacts");
  for (const name of ARTIFACT_NAMES) {
    const artifact = assertObject(artifacts[name], `artifacts.${name}`);
    normalizeBytes32(artifact.runtimeCodeHash, `${name}.runtimeCodeHash`);
    positiveInteger(artifact.runtimeByteLength, `${name}.runtimeByteLength`, 24_576);
    normalizeBytes32(artifact.sourceArtifactHash, `${name}.sourceArtifactHash`);
    if (name === "registry" || name === "coordinator") {
      normalizeBytes32(artifact.initCodeHash, `${name}.initCodeHash`);
      positiveInteger(artifact.initCodeByteLength, `${name}.initCodeByteLength`, 49_152);
    }
  }

  if (!Array.isArray(descriptor.dependencies) || descriptor.dependencies.length !== 6) {
    fail("INVALID_DESCRIPTOR", "exactly six frozen dependencies are required");
  }
  const dependencyAddresses = new Set();
  const dependencyLabels = new Set();
  for (const [index, dependency] of descriptor.dependencies.entries()) {
    assertObject(dependency, `dependencies[${index}]`);
    assertString(dependency.label, `dependencies[${index}].label`);
    if (dependencyLabels.has(dependency.label)) {
      fail("INVALID_DESCRIPTOR", "dependency labels must be unique");
    }
    dependencyLabels.add(dependency.label);
    const address = normalizeAddress(dependency.address, `${dependency.label}.address`);
    if (dependencyAddresses.has(address)) {
      fail("INVALID_DESCRIPTOR", "dependency addresses must be unique");
    }
    dependencyAddresses.add(address);
    normalizeBytes32(dependency.runtimeCodeHash, `${dependency.label}.runtimeCodeHash`);
    positiveInteger(
      dependency.runtimeByteLength,
      `${dependency.label}.runtimeByteLength`,
      24_576,
    );
  }
  for (const label of [
    "permitAuthority",
    "permitVerifier",
    "feePolicyVerifier",
    "reviewedFactoryImplementation",
    "poolManager",
    "defaultRenderer",
  ]) {
    if (!dependencyLabels.has(label)) {
      fail("INVALID_DESCRIPTOR", `missing required dependency ${label}`);
    }
  }
  if (
    normalizeBytes32(descriptor.configHash, "configHash") !==
    exactShardsRegistryConstructorArgumentsHash(descriptor)
  ) {
    fail("INVALID_DESCRIPTOR", "configHash does not match exact Registry constructor arguments");
  }

  if (!Array.isArray(descriptor.transactions) || descriptor.transactions.length !== 2) {
    fail("INVALID_DESCRIPTOR", "exactly two transactions are required");
  }
  descriptor.transactions.forEach((transaction, index) =>
    validateTransaction(descriptor, transaction, index, addresses),
  );
  const maximumTotalFeeWei = quantity(release.maximumTotalFeeWei, "release.maximumTotalFeeWei");
  const totalFeeEnvelope = descriptor.transactions.reduce(
    (sum, transaction) =>
      sum + quantity(transaction.gas, "transaction.gas") *
        quantity(transaction.maxFeePerGas, "transaction.maxFeePerGas"),
    0n,
  );
  if (maximumTotalFeeWei === 0n || totalFeeEnvelope > maximumTotalFeeWei) {
    fail("INVALID_DESCRIPTOR", "two-transaction max-fee envelope exceeds the frozen budget");
  }

  if (!Array.isArray(descriptor.readbacks)) {
    fail("INVALID_DESCRIPTOR", "readbacks must be an array");
  }
  const expectedReadbacks = createExactShardsReleaseReadbacks(descriptor);
  if (
    descriptor.readbacks.length !== expectedReadbacks.length ||
    canonicalSha256(descriptor.readbacks) !== canonicalSha256(expectedReadbacks)
  ) {
    fail(
      "INVALID_DESCRIPTOR",
      "readbacks must be the canonical ABI-generated exact graph and role topology",
    );
  }

  return {
    descriptor,
    descriptorDigest: canonicalSha256(descriptor),
    addresses,
  };
}

export function createEmptyExactShardsReleaseCheckpoint(descriptor) {
  const { descriptorDigest } = validateExactShardsReleaseDescriptor(descriptor);
  return {
    schema: EXACT_SHARDS_RELEASE_CHECKPOINT_SCHEMA,
    descriptorDigest,
    steps: {
      registry: { status: "not-signed" },
      coordinator: { status: "not-signed" },
    },
  };
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateCheckpoint(checkpoint, descriptorDigest) {
  const value = checkpoint ? copy(checkpoint) : null;
  if (!value) return null;
  if (value.schema !== EXACT_SHARDS_RELEASE_CHECKPOINT_SCHEMA) {
    fail("CHECKPOINT_DRIFT", "unknown checkpoint schema");
  }
  if (value.descriptorDigest !== descriptorDigest) {
    fail("CHECKPOINT_DRIFT", "checkpoint is bound to another descriptor");
  }
  assertObject(value.steps, "checkpoint.steps");
  for (const name of STEP_NAMES) {
    const step = assertObject(value.steps[name], `checkpoint.steps.${name}`);
    if (!STEP_STATUSES.has(step.status)) {
      fail("CHECKPOINT_DRIFT", `${name} checkpoint status is invalid`);
    }
    if (step.status !== "not-signed") {
      normalizeBytes32(step.transactionHash, `${name}.transactionHash`);
    }
    if (step.status === "signed" || step.status === "submitted") {
      assertString(step.signedPayloadRef, `${name}.signedPayloadRef`);
      if (
        !Number.isSafeInteger(step.broadcastAttempts) ||
        step.broadcastAttempts < 0 ||
        step.broadcastAttempts > 10
      ) {
        fail("CHECKPOINT_DRIFT", `${name}.broadcastAttempts is invalid`);
      }
    }
    if (step.status === "finalized") {
      normalizeBytes32(step.blockHash, `${name}.blockHash`);
      quantity(step.blockNumber, `${name}.blockNumber`);
    }
  }
  const firstRank = [...STEP_STATUSES].indexOf(value.steps.registry.status);
  const secondRank = [...STEP_STATUSES].indexOf(value.steps.coordinator.status);
  if (secondRank > 0 && firstRank < 3) {
    fail("CHECKPOINT_DRIFT", "coordinator evidence precedes registry finality");
  }
  return value;
}

async function request(provider, method, params = []) {
  if (!provider || typeof provider.request !== "function") {
    fail("PROVIDER_ERROR", "provider.request is required");
  }
  try {
    return await provider.request(method, params);
  } catch (error) {
    fail("PROVIDER_ERROR", `${provider.providerId ?? "provider"} ${method} failed`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizeBlock(block, label) {
  if (!block?.number || !block?.hash) {
    fail("PROVIDER_ERROR", `${label} returned an invalid block`);
  }
  return {
    number: quantity(block.number, `${label}.number`),
    hash: normalizeBytes32(block.hash, `${label}.hash`),
  };
}

function compareProviderValues(values, label) {
  const encoded = values.map((value) =>
    canonicalize(
      JSON.parse(
        JSON.stringify(value, (_key, entry) =>
          typeof entry === "bigint" ? entry.toString() : entry,
        ),
      ),
    ),
  );
  if (encoded.some((value) => value !== encoded[0])) {
    fail("PROVIDER_DIVERGENCE", `${label} differs across providers`, values);
  }
  return values[0];
}

function codeState(code, expected, label) {
  const normalized = normalizeHex(code, `${label}.code`);
  if (normalized === "0x") {
    return { occupied: false, runtimeCodeHash: null, runtimeByteLength: 0 };
  }
  const runtimeCodeHash = keccak256(normalized).toLowerCase();
  const runtimeByteLength = (normalized.length - 2) / 2;
  if (
    runtimeCodeHash !== normalizeBytes32(expected.runtimeCodeHash, `${label}.expectedHash`) ||
    runtimeByteLength !== expected.runtimeByteLength
  ) {
    fail("ADDRESS_PREOCCUPIED", `${label} contains unreviewed runtime`, {
      runtimeCodeHash,
      runtimeByteLength,
    });
  }
  return { occupied: true, runtimeCodeHash, runtimeByteLength };
}

function detectStage(runtime) {
  const occupied = Object.fromEntries(
    ARTIFACT_NAMES.map((name) => [name, runtime[name].occupied]),
  );
  if (!occupied.registry && !occupied.coordinator && !occupied.factory && !occupied.route) {
    return 0;
  }
  if (occupied.registry && !occupied.coordinator && !occupied.factory && !occupied.route) {
    return 1;
  }
  if (occupied.registry && occupied.coordinator && occupied.factory && occupied.route) {
    return 2;
  }
  fail("WRONG_DEPLOYMENT_ORDER", "the exact two-transaction topology is partially occupied", occupied);
}

function normalizeTransaction(transaction) {
  if (!transaction) return null;
  return {
    hash: normalizeBytes32(transaction.hash, "transaction.hash"),
    from: normalizeAddress(transaction.from, "transaction.from"),
    to: transaction.to === null ? null : normalizeAddress(transaction.to, "transaction.to"),
    nonce: quantity(transaction.nonce, "transaction.nonce").toString(),
    input: normalizeHex(transaction.input, "transaction.input"),
    value: quantity(transaction.value, "transaction.value").toString(),
    chainId:
      transaction.chainId === undefined || transaction.chainId === null
        ? null
        : quantity(transaction.chainId, "transaction.chainId").toString(),
  };
}

function normalizeReceipt(receipt) {
  if (!receipt) return null;
  return {
    transactionHash: normalizeBytes32(receipt.transactionHash, "receipt.transactionHash"),
    status: quantity(receipt.status, "receipt.status").toString(),
    blockNumber: quantity(receipt.blockNumber, "receipt.blockNumber").toString(),
    blockHash: normalizeBytes32(receipt.blockHash, "receipt.blockHash"),
    contractAddress: normalizeAddress(receipt.contractAddress, "receipt.contractAddress"),
    from: normalizeAddress(receipt.from, "receipt.from"),
    to: receipt.to === null ? null : normalizeAddress(receipt.to, "receipt.to"),
    logs: Array.isArray(receipt.logs)
      ? receipt.logs.map((log, index) => ({
          address: normalizeAddress(log.address, `receipt.logs[${index}].address`),
          topics: Array.isArray(log.topics)
            ? log.topics.map((topic, topicIndex) =>
                normalizeBytes32(topic, `receipt.logs[${index}].topics[${topicIndex}]`),
              )
            : fail("INVALID_RECEIPT", `receipt.logs[${index}].topics must be an array`),
          data: normalizeHex(log.data, `receipt.logs[${index}].data`),
        }))
      : [],
  };
}

export function expectedExactShardsPairDeploymentEvent(descriptor) {
  const { addresses } = validateExactShardsReleaseDescriptor(descriptor);
  const dependency = Object.fromEntries(
    descriptor.dependencies.map((entry) => [entry.label, entry]),
  );
  return {
    address: addresses.coordinator,
    topics: [
      EXACT_SHARDS_PAIR_DEPLOYED_TOPIC,
      padHex(addresses.factory, { size: 32 }).toLowerCase(),
      padHex(addresses.route, { size: 32 }).toLowerCase(),
      padHex(dependency.reviewedFactoryImplementation.address, { size: 32 }).toLowerCase(),
    ],
    data: encodeAbiParameters(
      parseAbiParameters("address,address,bytes32,bytes32"),
      [
        dependency.permitAuthority.address,
        addresses.registry,
        descriptor.artifacts.factory.runtimeCodeHash,
        descriptor.artifacts.route.runtimeCodeHash,
      ],
    ).toLowerCase(),
  };
}

async function readAgreement(descriptor, checkpoint, providers) {
  if (!Array.isArray(providers) || providers.length !== 2) {
    fail("PROVIDER_ERROR", "exactly two read providers are required");
  }
  const frozenIdentities = validateIndependentProviderIdentities(
    descriptor.chain.readProviders,
    "chain.readProviders",
  );
  const actualIdentities = providers.map((provider, index) =>
    normalizeProviderIdentity(provider, `providers[${index}]`),
  );
  for (let index = 0; index < 2; index += 1) {
    if (canonicalSha256(actualIdentities[index]) !== canonicalSha256(frozenIdentities[index])) {
      fail("PROVIDER_ERROR", "read providers differ from the frozen provider identities");
    }
  }
  const chainIds = await Promise.all(
    providers.map((provider) => request(provider, "eth_chainId")),
  );
  const expectedChainId = quantity(descriptor.chain.chainId, "chain.chainId");
  for (const chainId of chainIds) {
    if (quantity(chainId, "provider.chainId") !== expectedChainId) {
      fail("WRONG_CHAIN", "a provider is connected to the wrong chain");
    }
  }
  const heads = await Promise.all(
    providers.map(async (provider) =>
      normalizeBlock(
        await request(provider, "eth_getBlockByNumber", ["latest", false]),
        `${provider.providerId}.head`,
      ),
    ),
  );
  const lag = heads[0].number > heads[1].number
    ? heads[0].number - heads[1].number
    : heads[1].number - heads[0].number;
  if (lag > BigInt(descriptor.chain.finality.maximumProviderHeadLag)) {
    fail("PROVIDER_DIVERGENCE", "provider head lag exceeds the frozen limit");
  }
  const agreedNumber = heads[0].number < heads[1].number ? heads[0].number : heads[1].number;
  const agreedTag = toHex(agreedNumber);
  const agreedBlocks = await Promise.all(
    providers.map(async (provider) =>
      normalizeBlock(
        await request(provider, "eth_getBlockByNumber", [agreedTag, false]),
        `${provider.providerId}.agreedBlock`,
      ),
    ),
  );
  const agreedBlock = compareProviderValues(agreedBlocks, "canonical agreed block");

  const { addresses } = validateExactShardsReleaseDescriptor(descriptor);
  const codeTargets = [
    ...ARTIFACT_NAMES.map((name) => ({
      key: name,
      address: addresses[name],
      expected: descriptor.artifacts[name],
    })),
    ...descriptor.dependencies.map((dependency, index) => ({
      key: `dependency:${index}:${dependency.label}`,
      address: dependency.address,
      expected: dependency,
    })),
  ];
  const providerSnapshots = await Promise.all(
    providers.map(async (provider) => {
      const [confirmedNonce, pendingNonce, codes] = await Promise.all([
        request(provider, "eth_getTransactionCount", [addresses.deployer, agreedTag]),
        request(provider, "eth_getTransactionCount", [addresses.deployer, "pending"]),
        Promise.all(
          codeTargets.map((target) =>
            request(provider, "eth_getCode", [target.address, agreedTag]),
          ),
        ),
      ]);
      return {
        id: provider.providerId,
        confirmedNonce: quantity(confirmedNonce, `${provider.providerId}.confirmedNonce`).toString(),
        pendingNonce: quantity(pendingNonce, `${provider.providerId}.pendingNonce`).toString(),
        codes: Object.fromEntries(
          codeTargets.map((target, index) => [target.key, normalizeHex(codes[index], target.key)]),
        ),
      };
    }),
  );
  compareProviderValues(
    providerSnapshots.map((snapshot) => snapshot.confirmedNonce),
    "confirmed deployer nonce",
  );
  compareProviderValues(
    providerSnapshots.map((snapshot) => snapshot.pendingNonce),
    "pending deployer nonce",
  );
  for (const target of codeTargets) {
    compareProviderValues(
      providerSnapshots.map((snapshot) => snapshot.codes[target.key]),
      `${target.key} runtime`,
    );
  }
  const runtime = Object.fromEntries(
    ARTIFACT_NAMES.map((name) => [
      name,
      codeState(providerSnapshots[0].codes[name], descriptor.artifacts[name], name),
    ]),
  );
  for (const target of codeTargets.filter((target) => target.key.startsWith("dependency:"))) {
    const state = codeState(providerSnapshots[0].codes[target.key], target.expected, target.key);
    if (!state.occupied) {
      fail("DEPENDENCY_DRIFT", `${target.key} has no runtime`);
    }
  }
  const stage = detectStage(runtime);

  const evidence = {};
  if (checkpoint) {
    for (const stepName of STEP_NAMES) {
      const step = checkpoint.steps[stepName];
      if (step.status === "not-signed") continue;
      const transactions = await Promise.all(
        providers.map((provider) =>
          request(provider, "eth_getTransactionByHash", [step.transactionHash]),
        ),
      );
      const receipts = await Promise.all(
        providers.map((provider) =>
          request(provider, "eth_getTransactionReceipt", [step.transactionHash]),
        ),
      );
      evidence[stepName] = {
        transactions: transactions.map(normalizeTransaction),
        receipts: receipts.map(normalizeReceipt),
      };
    }
  }

  let readbacks = null;
  if (stage === 2) {
    const values = await Promise.all(
      providers.map(async (provider) =>
        Promise.all(
          descriptor.readbacks.map(async (readback) => ({
            label: readback.label,
            value: normalizeHex(
              await request(provider, "eth_call", [
                { to: readback.target, data: readback.data },
                agreedTag,
              ]),
              `${readback.label}.return`,
            ),
          })),
        ),
      ),
    );
    compareProviderValues(values, "mutual binding readbacks");
    for (const [index, readback] of descriptor.readbacks.entries()) {
      if (values[0][index].value !== normalizeHex(readback.expectedReturn, readback.label)) {
        fail("READBACK_DRIFT", `${readback.label} does not match the frozen descriptor`);
      }
    }
    readbacks = values[0];
  }

  return {
    providers: actualIdentities,
    heads: heads.map((head) => ({ number: head.number.toString(), hash: head.hash })),
    agreedBlock: { number: agreedBlock.number.toString(), hash: agreedBlock.hash },
    confirmedNonce: providerSnapshots[0].confirmedNonce,
    pendingNonce: providerSnapshots[0].pendingNonce,
    stage,
    runtime,
    evidence,
    readbacks,
  };
}

function validateExactTransactionEvidence(descriptor, stepName, transaction) {
  const index = STEP_NAMES.indexOf(stepName);
  const expected = descriptor.transactions[index];
  if (!transaction) return;
  if (
    transaction.from !== normalizeAddress(expected.from, `${stepName}.from`) ||
    transaction.to !== null ||
    BigInt(transaction.nonce) !== quantity(expected.nonce, `${stepName}.nonce`) ||
    transaction.input !== normalizeHex(expected.data, `${stepName}.data`) ||
    BigInt(transaction.value) !== 0n ||
    (transaction.chainId !== null &&
      BigInt(transaction.chainId) !== quantity(expected.chainId, `${stepName}.chainId`))
  ) {
    fail("TRANSACTION_DRIFT", `${stepName} transaction differs from the frozen descriptor`);
  }
}

function compareEventTopics(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((topic, index) => topic === expected[index])
  );
}

async function canonicalReceipt(descriptor, providers, stepName, evidence, agreedBlock) {
  const [transactionA, transactionB] = evidence.transactions;
  const [receiptA, receiptB] = evidence.receipts;
  if ((transactionA === null) !== (transactionB === null)) {
    return { state: "provider-wait" };
  }
  if (transactionA && transactionB) {
    compareProviderValues([transactionA, transactionB], `${stepName} transaction`);
    validateExactTransactionEvidence(descriptor, stepName, transactionA);
  }
  if ((receiptA === null) !== (receiptB === null)) {
    return { state: "provider-wait" };
  }
  if (!receiptA && !receiptB) {
    return { state: transactionA ? "pending" : "not-found" };
  }
  const receipt = compareProviderValues([receiptA, receiptB], `${stepName} receipt`);
  const index = STEP_NAMES.indexOf(stepName);
  const expectedAddress = normalizeAddress(
    descriptor.transactions[index].expectedContractAddress,
    `${stepName}.expectedContractAddress`,
  );
  if (
    receipt.status !== "1" ||
    receipt.transactionHash !== evidence.transactions[0]?.hash ||
    receipt.contractAddress !== expectedAddress ||
    receipt.from !== normalizeAddress(descriptor.deployer.address, "deployer.address") ||
    receipt.to !== null
  ) {
    fail("INVALID_RECEIPT", `${stepName} deployment receipt is invalid`, receipt);
  }
  if (stepName === "coordinator") {
    const expectedEvent = expectedExactShardsPairDeploymentEvent(descriptor);
    const matches = receipt.logs.filter(
      (log) =>
        log.address === expectedEvent.address &&
        compareEventTopics(log.topics, expectedEvent.topics) &&
        log.data === expectedEvent.data,
    );
    if (matches.length !== 1) {
      fail("INVALID_RECEIPT", "coordinator receipt does not contain exactly one frozen pair event");
    }
  }
  const canonicalBlocks = await Promise.all(
    providers.map(async (provider) =>
      normalizeBlock(
        await request(provider, "eth_getBlockByNumber", [toHex(BigInt(receipt.blockNumber)), false]),
        `${provider.providerId}.${stepName}.receiptBlock`,
      ),
    ),
  );
  const canonicalBlock = compareProviderValues(canonicalBlocks, `${stepName} canonical receipt block`);
  if (canonicalBlock.hash !== receipt.blockHash) {
    fail("REORG_DETECTED", `${stepName} receipt is no longer canonical`);
  }
  const confirmations = BigInt(agreedBlock.number) >= BigInt(receipt.blockNumber)
    ? BigInt(agreedBlock.number) - BigInt(receipt.blockNumber) + 1n
    : 0n;
  if (confirmations < BigInt(descriptor.chain.finality.minimumConfirmations)) {
    return { state: "finality-wait", receipt, confirmations: confirmations.toString() };
  }
  return { state: "finalized", receipt, confirmations: confirmations.toString() };
}

function assertNonceState(descriptor, agreement, checkpoint) {
  const expectedConfirmed =
    quantity(descriptor.deployer.startingNonce, "deployer.startingNonce") +
    BigInt(agreement.stage);
  if (BigInt(agreement.confirmedNonce) !== expectedConfirmed) {
    fail("NONCE_DRIFT", "confirmed deployer nonce left the exact two-transaction sequence", {
      expected: expectedConfirmed.toString(),
      actual: agreement.confirmedNonce,
    });
  }
  const activeStep = STEP_NAMES[agreement.stage];
  const activeStatus = activeStep ? checkpoint.steps[activeStep].status : null;
  const pending = BigInt(agreement.pendingNonce);
  const submittedWindow = activeStatus === "signed" || activeStatus === "submitted";
  if (
    (!submittedWindow && pending !== expectedConfirmed) ||
    (submittedWindow && pending !== expectedConfirmed && pending !== expectedConfirmed + 1n)
  ) {
    fail("NONCE_DRIFT", "pending deployer nonce left the exact transaction window", {
      expected: expectedConfirmed.toString(),
      actual: pending.toString(),
    });
  }
}

async function assertFinalizedCheckpointCanonical(descriptor, checkpoint, providers) {
  for (const stepName of STEP_NAMES) {
    const step = checkpoint.steps[stepName];
    if (step.status !== "finalized") continue;
    const blocks = await Promise.all(
      providers.map(async (provider) =>
        normalizeBlock(
          await request(provider, "eth_getBlockByNumber", [toHex(BigInt(step.blockNumber)), false]),
          `${provider.providerId}.${stepName}.checkpointBlock`,
        ),
      ),
    );
    const block = compareProviderValues(blocks, `${stepName} finalized checkpoint block`);
    if (block.hash !== step.blockHash) {
      fail("REORG_DETECTED", `${stepName} finalized checkpoint was reorganized`);
    }
  }
}

function completedCapture(descriptorDigest, agreement, checkpoint) {
  const capture = {
    schema: EXACT_SHARDS_RELEASE_CAPTURE_SCHEMA,
    descriptorDigest,
    activationAllowed: false,
    agreedBlock: agreement.agreedBlock,
    providers: agreement.providers,
    receipts: Object.fromEntries(
      STEP_NAMES.map((name) => [name, {
        transactionHash: checkpoint.steps[name].transactionHash,
        blockNumber: checkpoint.steps[name].blockNumber,
        blockHash: checkpoint.steps[name].blockHash,
      }]),
    ),
    runtimes: agreement.runtime,
    readbacks: agreement.readbacks,
    pairDeploymentEvent: agreement.evidence.coordinator.receipts[0].logs.find(
      (log) => log.topics[0] === EXACT_SHARDS_PAIR_DEPLOYED_TOPIC,
    ),
  };
  return { ...capture, captureDigest: canonicalSha256(capture) };
}

export async function inspectExactShardsTwoTransactionRelease({
  descriptor,
  checkpoint = null,
  providers,
}) {
  const { descriptorDigest } = validateExactShardsReleaseDescriptor(descriptor);
  let current = validateCheckpoint(checkpoint, descriptorDigest);
  if (!current) current = createEmptyExactShardsReleaseCheckpoint(descriptor);
  await assertFinalizedCheckpointCanonical(descriptor, current, providers);
  const agreement = await readAgreement(descriptor, current, providers);
  assertNonceState(descriptor, agreement, current);

  for (let index = 0; index < STEP_NAMES.length; index += 1) {
    const stepName = STEP_NAMES[index];
    const nextStage = index + 1;
    const step = current.steps[stepName];
    if (step.status === "not-signed") {
      if (agreement.stage >= nextStage) {
        fail("UNBOUND_DEPLOYMENT_EVIDENCE", `${stepName} runtime exists without a bound transaction checkpoint`);
      }
      break;
    }
    if (step.status === "finalized") {
      if (agreement.stage < nextStage) {
        fail("REORG_DETECTED", `${stepName} finalized runtime disappeared`);
      }
      continue;
    }
    const receiptState = await canonicalReceipt(
      descriptor,
      providers,
      stepName,
      agreement.evidence[stepName],
      agreement.agreedBlock,
    );
    if (receiptState.state === "provider-wait") {
      return {
        descriptorDigest,
        checkpoint: current,
        agreement,
        action: { type: "AWAITING_PROVIDER_AGREEMENT", step: stepName },
      };
    }
    if (
      receiptState.state === "not-found" &&
      (step.status === "signed" || step.status === "submitted")
    ) {
      if (agreement.pendingNonce !== agreement.confirmedNonce) {
        fail(
          "PENDING_REPLACEMENT_OR_UNKNOWN",
          `${stepName} exact hash is absent while the deployer nonce is occupied`,
        );
      }
      if (step.broadcastAttempts >= descriptor.release.maximumExactHashBroadcastAttempts) {
        return {
          descriptorDigest,
          checkpoint: current,
          agreement,
          action: { type: "BROADCAST_RETRY_EXHAUSTED", step: stepName },
        };
      }
      return {
        descriptorDigest,
        checkpoint: current,
        agreement,
        action: { type: "READY_REBROADCAST", step: stepName },
      };
    }
    if (receiptState.state === "not-found" || receiptState.state === "pending") {
      return {
        descriptorDigest,
        checkpoint: current,
        agreement,
        action: { type: "AWAITING_TRANSACTION", step: stepName },
      };
    }
    if (receiptState.state === "finality-wait") {
      return {
        descriptorDigest,
        checkpoint: current,
        agreement,
        action: {
          type: "AWAITING_FINALITY",
          step: stepName,
          confirmations: receiptState.confirmations,
          required: descriptor.chain.finality.minimumConfirmations,
        },
      };
    }
    if (agreement.stage < nextStage) {
      return {
        descriptorDigest,
        checkpoint: current,
        agreement,
        action: { type: "AWAITING_PROVIDER_AGREEMENT", step: stepName },
      };
    }
    current.steps[stepName] = {
      status: "finalized",
      transactionHash: step.transactionHash,
      blockNumber: receiptState.receipt.blockNumber,
      blockHash: receiptState.receipt.blockHash,
    };
  }

  if (agreement.stage === 2) {
    if (current.steps.coordinator.status !== "finalized") {
      fail("UNBOUND_DEPLOYMENT_EVIDENCE", "pair runtime exists without finalized coordinator evidence");
    }
    return {
      descriptorDigest,
      checkpoint: current,
      agreement,
      action: { type: "COMPLETE" },
      capture: completedCapture(descriptorDigest, agreement, current),
    };
  }

  const step = STEP_NAMES[agreement.stage];
  if (current.steps[step].status !== "not-signed") {
    fail("CHECKPOINT_DRIFT", `${step} checkpoint did not reconcile`);
  }
  const frozen = descriptor.release.freezeStatus === "FROZEN";
  const active = descriptor.release.activationAllowed === true;
  return {
    descriptorDigest,
    checkpoint: current,
    agreement,
    action:
      frozen && active
        ? {
            type: "READY_TO_SIGN",
            step,
            transaction: copy(descriptor.transactions[agreement.stage]),
            preparedDigest: canonicalSha256({
              descriptorDigest,
              step,
              transaction: descriptor.transactions[agreement.stage],
            }),
          }
        : {
            type: "BLOCKED_ACTIVATION",
            step,
            freezeStatus: descriptor.release.freezeStatus,
            activationAllowed: descriptor.release.activationAllowed,
          },
  };
}

function assertDecodedSignedTransaction(descriptor, stepName, decoded, transactionHash) {
  assertObject(decoded, "decoded signed transaction");
  const expected = descriptor.transactions[STEP_NAMES.indexOf(stepName)];
  if (
    normalizeBytes32(decoded.transactionHash, "signed.transactionHash") !== transactionHash ||
    normalizeAddress(decoded.signerAddress, "signed.signerAddress") !==
      normalizeAddress(expected.from, `${stepName}.from`) ||
    quantity(decoded.chainId, "signed.chainId") !== quantity(expected.chainId, `${stepName}.chainId`) ||
    quantity(decoded.nonce, "signed.nonce") !== quantity(expected.nonce, `${stepName}.nonce`) ||
    decoded.to !== null ||
    quantity(decoded.value, "signed.value") !== 0n ||
    normalizeHex(decoded.data, "signed.data") !== normalizeHex(expected.data, `${stepName}.data`) ||
    quantity(decoded.gas, "signed.gas") !== quantity(expected.gas, `${stepName}.gas`) ||
    quantity(decoded.maxFeePerGas, "signed.maxFeePerGas") !==
      quantity(expected.maxFeePerGas, `${stepName}.maxFeePerGas`) ||
    quantity(decoded.maxPriorityFeePerGas, "signed.maxPriorityFeePerGas") !==
      quantity(expected.maxPriorityFeePerGas, `${stepName}.maxPriorityFeePerGas`)
  ) {
    fail("SIGNED_TRANSACTION_DRIFT", `${stepName} signed transaction is not exact`);
  }
}

async function saveCheckpoint(checkpointStore, checkpoint) {
  if (!checkpointStore || typeof checkpointStore.save !== "function") {
    fail("CHECKPOINT_STORE_REQUIRED", "durable checkpointStore.save is required before signing or broadcast");
  }
  await checkpointStore.save(copy(checkpoint));
}

export async function signNextExactShardsTransaction({
  descriptor,
  checkpoint = null,
  providers,
  signerPort,
  signedTransactionVerifier,
  checkpointStore,
}) {
  const inspection = await inspectExactShardsTwoTransactionRelease({ descriptor, checkpoint, providers });
  if (inspection.action.type !== "READY_TO_SIGN") {
    fail("NOT_READY_TO_SIGN", `operator action is ${inspection.action.type}`);
  }
  if (!signerPort || typeof signerPort.signExactTransaction !== "function") {
    fail("SIGNER_PORT_REQUIRED", "signerPort.signExactTransaction is required");
  }
  if (!signedTransactionVerifier || typeof signedTransactionVerifier.verify !== "function") {
    fail("SIGNATURE_VERIFIER_REQUIRED", "signedTransactionVerifier.verify is required");
  }
  const signed = await signerPort.signExactTransaction({
    descriptorDigest: inspection.descriptorDigest,
    preparedDigest: inspection.action.preparedDigest,
    step: inspection.action.step,
    transaction: copy(inspection.action.transaction),
  });
  const signedPayloadRef = assertString(signed?.signedPayloadRef, "signedPayloadRef");
  const transactionHash = normalizeBytes32(signed?.transactionHash, "transactionHash");
  const decoded = await signedTransactionVerifier.verify({ signedPayloadRef, transactionHash });
  assertDecodedSignedTransaction(descriptor, inspection.action.step, decoded, transactionHash);
  const current = copy(inspection.checkpoint);
  current.steps[inspection.action.step] = {
    status: "signed",
    transactionHash,
    signedPayloadRef,
    preparedDigest: inspection.action.preparedDigest,
    broadcastAttempts: 0,
  };
  await saveCheckpoint(checkpointStore, current);
  return current;
}

export async function broadcastSignedExactShardsTransaction({
  descriptor,
  checkpoint,
  providers,
  signedTransactionVerifier,
  broadcasterPort,
  checkpointStore,
}) {
  const inspection = await inspectExactShardsTwoTransactionRelease({ descriptor, checkpoint, providers });
  if (inspection.action.type !== "READY_REBROADCAST") {
    fail("NOT_READY_TO_BROADCAST", `operator action is ${inspection.action.type}`);
  }
  const step = inspection.action.step;
  const signed = inspection.checkpoint.steps[step];
  if (!signedTransactionVerifier || typeof signedTransactionVerifier.verify !== "function") {
    fail("SIGNATURE_VERIFIER_REQUIRED", "signedTransactionVerifier.verify is required");
  }
  if (!broadcasterPort || typeof broadcasterPort.broadcastSignedTransaction !== "function") {
    fail("BROADCASTER_PORT_REQUIRED", "broadcasterPort.broadcastSignedTransaction is required");
  }
  const decoded = await signedTransactionVerifier.verify({
    signedPayloadRef: signed.signedPayloadRef,
    transactionHash: signed.transactionHash,
  });
  assertDecodedSignedTransaction(descriptor, step, decoded, signed.transactionHash);

  const beforeBroadcast = await inspectExactShardsTwoTransactionRelease({
    descriptor,
    checkpoint: inspection.checkpoint,
    providers,
  });
  if (beforeBroadcast.action.type !== "READY_REBROADCAST" || beforeBroadcast.action.step !== step) {
    fail("STATE_CHANGED_BEFORE_BROADCAST", "chain state changed after signed transaction verification");
  }
  const returnedHash = normalizeBytes32(
    await broadcasterPort.broadcastSignedTransaction({
      signedPayloadRef: signed.signedPayloadRef,
      transactionHash: signed.transactionHash,
    }),
    "broadcast transaction hash",
  );
  if (returnedHash !== signed.transactionHash) {
    fail("BROADCAST_HASH_MISMATCH", "broadcaster returned another transaction hash");
  }
  const current = copy(inspection.checkpoint);
  current.steps[step] = {
    ...current.steps[step],
    status: "submitted",
    broadcastAttempts: signed.broadcastAttempts + 1,
  };
  await saveCheckpoint(checkpointStore, current);
  return current;
}

export function createJsonRpcReadProvider({ identity, url, timeoutMs = 15_000, fetchImpl = fetch }) {
  const normalizedIdentity = normalizeProviderIdentity(identity, "provider.identity");
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    fail("PROVIDER_ERROR", `${normalizedIdentity.providerId} URL is invalid`);
  }
  if (endpoint.protocol !== "https:") {
    fail("PROVIDER_ERROR", `${normalizedIdentity.providerId} must use HTTPS`);
  }
  if (endpoint.origin.toLowerCase() !== normalizedIdentity.canonicalOrigin) {
    fail("PROVIDER_ERROR", `${normalizedIdentity.providerId} URL origin differs from its frozen identity`);
  }
  if (exactShardsRpcEndpointCommitment(endpoint.href) !== normalizedIdentity.endpointCommitment) {
    fail("PROVIDER_ERROR", `${normalizedIdentity.providerId} URL differs from its frozen endpoint commitment`);
  }
  return {
    ...normalizedIdentity,
    async request(method, params = []) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.error) throw new Error(payload.error.message ?? "RPC error");
      return payload?.result;
    },
  };
}
