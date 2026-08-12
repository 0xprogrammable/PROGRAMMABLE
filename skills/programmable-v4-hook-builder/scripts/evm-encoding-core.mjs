const MASK_64 = (1n << 64n) - 1n;
const ROTATION = Object.freeze([1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44]);
const PERMUTATION = Object.freeze([10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1]);
const ROUND_CONSTANTS = Object.freeze([
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
]);

export const UINT128_MAX = 340282366920938463463374607431768211455n;
export const UINT256_MAX = (1n << 256n) - 1n;
export const DYNAMIC_FEE_FLAG = 0x800000;

export function keccak256Bytes(value) {
  const input = Buffer.from(value);
  const rate = 136;
  const paddedLength = Math.ceil((input.length + 1) / rate) * rate;
  const padded = Buffer.alloc(paddedLength);
  input.copy(padded);
  padded[input.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const state = Array.from({ length: 25 }, () => 0n);

  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane += 1) {
      let word = 0n;
      for (let byte = 0; byte < 8; byte += 1) {
        word |= BigInt(padded[offset + lane * 8 + byte]) << BigInt(byte * 8);
      }
      state[lane] = (state[lane] ^ word) & MASK_64;
    }
    keccakF1600(state);
  }

  const output = Buffer.alloc(32);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number((state[Math.floor(index / 8)] >> BigInt((index % 8) * 8)) & 0xffn);
  }
  return output;
}

export function keccak256Hex(value) {
  return `0x${keccak256Bytes(value).toString("hex")}`;
}

export function keccak256HexBytes(value, label = "hex bytes") {
  return keccak256Hex(hexToBytes(value, label));
}

export function checksumAddress(value, { allowZero = false, label = "address" } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new TypeError(`${label} must be an exact Ethereum address`);
  }
  const lowercase = value.slice(2).toLowerCase();
  if (!allowZero && /^0{40}$/u.test(lowercase)) throw new TypeError(`${label} must not be zero`);
  const digest = keccak256Bytes(Buffer.from(lowercase, "ascii")).toString("hex");
  let checksummed = "";
  for (let index = 0; index < lowercase.length; index += 1) {
    checksummed += Number.parseInt(digest[index], 16) >= 8 ? lowercase[index].toUpperCase() : lowercase[index];
  }
  return `0x${checksummed}`;
}

export function encodeProgrammableTradeRequestV1(payload) {
  return encodeStaticWords([
    sha256Word(payload.manifestSha256, "tradeRequest.manifestSha256"),
    bytes32Word(hashText(payload.modeId), "tradeRequest.modeIdHash", false),
    uintWord(decimalUint(payload.chainId, "tradeRequest.chainId", UINT256_MAX, false)),
    sha256Word(payload.poolKeySha256, "tradeRequest.poolKeySha256"),
    sha256Word(payload.hookDataSha256, "tradeRequest.hookDataSha256"),
    addressWord(checksumAddress(payload.sender, { label: "tradeRequest.sender" })),
    addressWord(checksumAddress(payload.recipient, { label: "tradeRequest.recipient" })),
    uintWord(payload.direction === "zero-for-one" ? 1n : 0n),
    uintWord(payload.amountMode === "exact-input" ? 1n : 0n),
    uintWord(decimalUint(payload.amountSpecified, "tradeRequest.amountSpecified", UINT256_MAX, false)),
    uintWord(integerUint(payload.slippageBps, "tradeRequest.slippageBps", 9_999)),
    uintWord(decimalUint(payload.deadline, "tradeRequest.deadline", UINT256_MAX, false)),
    bytes32Word(hashText(payload.fundingProfileId), "tradeRequest.fundingProfileIdHash", false),
    sha256Word(payload.feeBehaviorSha256, "tradeRequest.feeBehaviorSha256")
  ]);
}

export function encodeProgrammableTradeQuoteV1(payload) {
  return encodeStaticWords([
    sha256Word(payload.requestSha256, "tradeQuote.requestSha256"),
    sha256Word(payload.manifestSha256, "tradeQuote.manifestSha256"),
    uintWord(decimalUint(payload.blockNumber, "tradeQuote.blockNumber")),
    bytes32Word(payload.blockHash, "tradeQuote.blockHash", false),
    uintWord(decimalUint(payload.amountSpecified, "tradeQuote.amountSpecified", UINT256_MAX, false)),
    uintWord(decimalUint(payload.amountQuoted, "tradeQuote.amountQuoted", UINT256_MAX, false)),
    sha256Word(payload.callDataSha256, "tradeQuote.callDataSha256"),
    sha256Word(payload.feeBehaviorSha256, "tradeQuote.feeBehaviorSha256")
  ]);
}

export function encodeProgrammableTradeExecutionEnvelopeV1(payload) {
  const calldata = hexToBytes(payload.calldata, "tradeExecution.calldata");
  if (calldata.length === 0) throw new TypeError("tradeExecution.calldata must not be empty");
  const head = encodeStaticWords([
    sha256Word(payload.requestSha256, "tradeExecution.requestSha256"),
    sha256Word(payload.quoteSha256, "tradeExecution.quoteSha256"),
    addressWord(checksumAddress(payload.target, { label: "tradeExecution.target" })),
    uintWord(decimalUint(payload.value, "tradeExecution.value")),
    uintWord(8n * 32n),
    uintWord(decimalUint(payload.deadline, "tradeExecution.deadline", UINT256_MAX, false)),
    sha256Word(payload.actionPlanSha256, "tradeExecution.actionPlanSha256"),
    sha256Word(payload.fundingWitnessSha256, "tradeExecution.fundingWitnessSha256")
  ]);
  const body = calldata.toString("hex").padEnd(Math.ceil(calldata.length / 32) * 64, "0");
  return `${head}${uintWord(BigInt(calldata.length))}${body}`;
}

export function encodeLaunchExecutorPoolConfigurationV1({
  currency0,
  currency1,
  fee,
  tickSpacing,
  hooks,
  minimumInitialLiquidity
}) {
  const normalizedCurrency0 = checksumAddress(currency0, { allowZero: true, label: "poolConfiguration.currency0" });
  const normalizedCurrency1 = checksumAddress(currency1, { allowZero: true, label: "poolConfiguration.currency1" });
  const normalizedHooks = checksumAddress(hooks, { label: "poolConfiguration.hooks" });
  if (BigInt(normalizedCurrency0) >= BigInt(normalizedCurrency1)) {
    throw new TypeError("poolConfiguration currencies must be distinct and canonically sorted");
  }
  if (!Number.isInteger(fee) || fee < 0 || fee > 0xff_ffff) {
    throw new TypeError("poolConfiguration.fee must be a uint24 integer");
  }
  if (!Number.isInteger(tickSpacing) || tickSpacing < 1 || tickSpacing > 0x7f_ffff) {
    throw new TypeError("poolConfiguration.tickSpacing must be a positive int24 integer");
  }
  const minimum = decimalUint(minimumInitialLiquidity, "poolConfiguration.minimumInitialLiquidity", UINT128_MAX, false);
  const encoded = encodeStaticWords([
    addressWord(normalizedCurrency0),
    addressWord(normalizedCurrency1),
    uintWord(BigInt(fee)),
    uintWord(BigInt(tickSpacing)),
    addressWord(normalizedHooks),
    uintWord(minimum)
  ]);
  return {
    decoded: {
      currency0: normalizedCurrency0,
      currency1: normalizedCurrency1,
      fee,
      tickSpacing,
      hooks: normalizedHooks,
      minimumInitialLiquidity: minimum.toString()
    },
    encoded
  };
}

export function hashExecutorLaunchParametersV1({ target, targetRuntimeCodeHash, refundRecipient, callData }) {
  return keccak256HexBytes(encodeStaticWords([
    addressWord(checksumAddress(target, { label: "launchCall.target" })),
    bytes32Word(targetRuntimeCodeHash, "launchCall.targetRuntimeCodeHash", false),
    addressWord(checksumAddress(refundRecipient, { label: "launchCall.refundRecipient" })),
    bytes32Word(keccak256HexBytes(callData, "launchCall.callData"), "launchCall.callDataHash", false)
  ]));
}

export function hashExecutorPoolConfigurationV1({ poolManager, hook, poolConfiguration }) {
  return keccak256HexBytes(encodeStaticWords([
    addressWord(checksumAddress(poolManager, { label: "launchCall.poolManager" })),
    addressWord(checksumAddress(hook, { label: "launchCall.hook" })),
    bytes32Word(keccak256HexBytes(poolConfiguration, "launchCall.poolConfiguration"), "launchCall.poolConfigurationPayloadHash", false)
  ]));
}

export function hashExecutorHookConfigurationV1({ hook, hookConfiguration }) {
  return keccak256HexBytes(encodeStaticWords([
    addressWord(checksumAddress(hook, { label: "launchCall.hook" })),
    bytes32Word(keccak256HexBytes(hookConfiguration, "launchCall.hookConfiguration"), "launchCall.hookConfigurationPayloadHash", false)
  ]));
}

export function hashV4PoolKey({ currency0, currency1, fee, tickSpacing, hooks }) {
  const normalizedCurrency0 = checksumAddress(currency0, { allowZero: true, label: "poolKey.currency0" });
  const normalizedCurrency1 = checksumAddress(currency1, { allowZero: true, label: "poolKey.currency1" });
  // Unhooked v4 pools use the zero address; callers that require a custom hook
  // enforce that separately from the canonical PoolKey/PoolId derivation.
  const normalizedHooks = checksumAddress(hooks, { allowZero: true, label: "poolKey.hooks" });
  if (BigInt(normalizedCurrency0) >= BigInt(normalizedCurrency1)) {
    throw new TypeError("poolKey currencies must be distinct and canonically sorted");
  }
  if (!Number.isInteger(fee) || fee < 0 || fee > 0xff_ffff) throw new TypeError("poolKey.fee must be a uint24 integer");
  if (!Number.isInteger(tickSpacing) || tickSpacing < -0x80_0000 || tickSpacing > 0x7f_ffff) {
    throw new TypeError("poolKey.tickSpacing must be an int24 integer");
  }
  return keccak256HexBytes(encodeStaticWords([
    addressWord(normalizedCurrency0),
    addressWord(normalizedCurrency1),
    uintWord(BigInt(fee)),
    signedWord(BigInt(tickSpacing), 24),
    addressWord(normalizedHooks)
  ]));
}

export function hashLaunchEvidenceBundle({ buildEvidenceSha256, configurationEvidenceSha256, feeConformanceEvidenceSha256 }) {
  return keccak256HexBytes(encodeStaticWords([
    bytes32Word(buildEvidenceSha256, "deploymentSpec.buildEvidenceSha256", false),
    bytes32Word(configurationEvidenceSha256, "deploymentSpec.configurationEvidenceSha256", false),
    bytes32Word(feeConformanceEvidenceSha256, "deploymentSpec.feeConformanceEvidenceSha256", false)
  ]));
}

export function hashDeploymentSourceBinding(spec) {
  return keccak256HexBytes(encodeStaticWords([
    fixedBytesWord(normalizeBytes20(spec.registry.registryCommit, "deploymentSpec.registry.registryCommit"), 20),
    bytes32Word(spec.registry.acceptanceSha256, "deploymentSpec.registry.acceptanceSha256", false),
    bytes32Word(hashText(spec.registry.acceptancePath), "deploymentSpec.registry.acceptancePathHash", false),
    bytes32Word(hashText(spec.registry.applicationId), "deploymentSpec.registry.applicationIdHash", false),
    uintWord(BigInt(spec.registry.applicationRevision)),
    bytes32Word(spec.registry.packageSha256, "deploymentSpec.registry.packageSha256", false),
    bytes32Word(hashText(spec.source.numericRepositoryId), "deploymentSpec.source.numericRepositoryIdHash", false),
    bytes32Word(hashText(spec.source.repositoryUri), "deploymentSpec.source.repositoryUriHash", false),
    fixedBytesWord(normalizeBytes20(spec.source.revisionObjectId, "deploymentSpec.source.revisionObjectId"), 20),
    fixedBytesWord(normalizeBytes20(spec.source.treeObjectId, "deploymentSpec.source.treeObjectId"), 20),
    bytes32Word(spec.source.reviewedSourceClosureHash, "deploymentSpec.source.reviewedSourceClosureHash", false)
  ]));
}

export function hashDeploymentArtifact(artifact) {
  return keccak256HexBytes(encodeStaticWords([
    bytes32Word(hashText(artifact.component), "artifact.componentHash", false),
    bytes32Word(hashText(artifact.codeMode), "artifact.codeModeHash", false),
    addressWord(checksumAddress(artifact.address, { label: "artifact.address" })),
    bytes32Word(artifact.constructorArgsHash, "artifact.constructorArgsHash", true),
    bytes32Word(artifact.initCodeHash, "artifact.initCodeHash", false),
    bytes32Word(artifact.runtimeCodeHash, "artifact.runtimeCodeHash", false)
  ]));
}

export function hashDeploymentArtifactSet(spec) {
  const artifactHashes = spec.artifacts.map(hashDeploymentArtifact);
  const head = [
    bytes32Word(hashText(spec.build.compiler), "deploymentSpec.build.compilerHash", false),
    bytes32Word(spec.build.settingsHash, "deploymentSpec.build.settingsHash", false),
    bytes32Word(spec.build.dependencyLockHash, "deploymentSpec.build.dependencyLockHash", false),
    bytes32Word(spec.build.buildInfoSha256, "deploymentSpec.build.buildInfoSha256", false),
    bytes32Word(spec.build.abiHash, "deploymentSpec.build.abiHash", false),
    uintWord(192n)
  ];
  const tail = [uintWord(BigInt(artifactHashes.length)), ...artifactHashes.map((value) => bytes32Word(value, "artifact hash", false))];
  return keccak256HexBytes(encodeStaticWords([...head, ...tail]));
}

export function hashDeploymentSpec(spec) {
  return keccak256HexBytes(encodeStaticWords([
    bytes32Word(hashDeploymentSourceBinding(spec), "deploymentSpec.sourceBindingHash", false),
    bytes32Word(hashDeploymentArtifactSet(spec), "deploymentSpec.artifactSetHash", false),
    bytes32Word(spec.evidenceBundleHash, "deploymentSpec.evidenceBundleHash", false),
    bytes32Word(spec.feeConformanceEvidenceSha256, "deploymentSpec.feeConformanceEvidenceSha256", false),
    addressWord(checksumAddress(spec.launch.authorityContract, { label: "deploymentSpec.launch.authorityContract" })),
    bytes32Word(spec.launch.authorityRuntimeCodeHash, "deploymentSpec.launch.authorityRuntimeCodeHash", false),
    addressWord(checksumAddress(spec.launch.launcher, { label: "deploymentSpec.launch.launcher" })),
    bytes32Word(spec.launch.launcherRuntimeCodeHash, "deploymentSpec.launch.launcherRuntimeCodeHash", false),
    addressWord(checksumAddress(spec.launch.launchCaller, { label: "deploymentSpec.launch.launchCaller" })),
    uintWord(decimalUint(spec.launch.nativeValue, "deploymentSpec.launch.nativeValue")),
    addressWord(checksumAddress(spec.launch.poolManager, { label: "deploymentSpec.launch.poolManager" })),
    bytes32Word(spec.launch.poolManagerRuntimeCodeHash, "deploymentSpec.launch.poolManagerRuntimeCodeHash", false),
    addressWord(checksumAddress(spec.launch.hook, { label: "deploymentSpec.launch.hook" })),
    bytes32Word(spec.launch.hookRuntimeCodeHash, "deploymentSpec.launch.hookRuntimeCodeHash", false),
    bytes32Word(spec.launch.launchParametersHash, "deploymentSpec.launch.launchParametersHash", false),
    bytes32Word(spec.launch.poolConfigurationHash, "deploymentSpec.launch.poolConfigurationHash", false),
    bytes32Word(spec.launch.hookConfigurationHash, "deploymentSpec.launch.hookConfigurationHash", false),
    uintWord(decimalUint(spec.launch.chainId, "deploymentSpec.launch.chainId")),
    addressWord(checksumAddress(spec.feeRecipient, { label: "deploymentSpec.feeRecipient" })),
    bytes32Word(spec.feePolicyHash, "deploymentSpec.feePolicyHash", false),
    uintWord(BigInt(spec.platformFeeHundredthsOfBip))
  ]));
}

export function normalizeBytes20(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value) || /^0x0{40}$/iu.test(value)) {
    throw new TypeError(`${label} must be a nonzero bytes20 value`);
  }
  return value.toLowerCase();
}

export function normalizeBytes32(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value) || (!allowZero && /^0x0{64}$/iu.test(value))) {
    throw new TypeError(`${label} must be ${allowZero ? "a" : "a nonzero"} bytes32 value`);
  }
  return value.toLowerCase();
}

export function normalizeHexBytes(value, label, maximumBytes) {
  const bytes = hexToBytes(value, label);
  if (bytes.length > maximumBytes) throw new TypeError(`${label} exceeds ${maximumBytes} bytes`);
  return `0x${bytes.toString("hex")}`;
}

export function decimalUint(value, label, maximum = UINT256_MAX, allowZero = true) {
  const source = typeof value === "bigint" ? value.toString() : value;
  if (typeof source !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(source)) {
    throw new TypeError(`${label} must be a canonical unsigned decimal string`);
  }
  const parsed = BigInt(source);
  if ((!allowZero && parsed === 0n) || parsed > maximum) throw new TypeError(`${label} is out of range`);
  return parsed;
}

function integerUint(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${label} must be an integer from 0 through ${maximum}`);
  }
  return BigInt(value);
}

function encodeStaticWords(words) {
  if (!Array.isArray(words) || words.some((word) => typeof word !== "string" || !/^[0-9a-f]{64}$/u.test(word))) {
    throw new TypeError("ABI static words are invalid");
  }
  return `0x${words.join("")}`;
}

function addressWord(address) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function bytes32Word(value, label, allowZero) {
  return normalizeBytes32(value, label, { allowZero }).slice(2);
}

function sha256Word(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a canonical sha256 digest`);
  }
  return bytes32Word(`0x${value.slice(7)}`, label, false);
}

function fixedBytesWord(value, byteLength) {
  const body = value.slice(2).toLowerCase();
  if (body.length !== byteLength * 2) throw new TypeError(`fixed bytes value must be ${byteLength} bytes`);
  return body.padEnd(64, "0");
}

function uintWord(value) {
  if (typeof value !== "bigint" || value < 0n || value > UINT256_MAX) throw new TypeError("ABI uint is out of range");
  return value.toString(16).padStart(64, "0");
}

function signedWord(value, bits) {
  const minimum = -(1n << BigInt(bits - 1));
  const maximum = (1n << BigInt(bits - 1)) - 1n;
  if (typeof value !== "bigint" || value < minimum || value > maximum) throw new TypeError(`ABI int${bits} is out of range`);
  return (value < 0n ? (1n << 256n) + value : value).toString(16).padStart(64, "0");
}

function hashText(value) {
  if (typeof value !== "string") throw new TypeError("hash text value must be a string");
  return keccak256Hex(Buffer.from(value, "utf8"));
}

function hexToBytes(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    throw new TypeError(`${label} must be canonical even-length hexadecimal bytes`);
  }
  return Buffer.from(value.slice(2), "hex");
}

function rotateLeft64(value, shift) {
  const distance = BigInt(shift);
  return ((value << distance) | (value >> (64n - distance))) & MASK_64;
}

function keccakF1600(state) {
  for (const roundConstant of ROUND_CONSTANTS) {
    const columns = Array.from({ length: 5 }, (_, x) => (
      state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
    ) & MASK_64);
    const deltas = Array.from({ length: 5 }, (_, x) => (
      columns[(x + 4) % 5] ^ rotateLeft64(columns[(x + 1) % 5], 1)
    ) & MASK_64);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) state[x + y * 5] = (state[x + y * 5] ^ deltas[x]) & MASK_64;
    }

    let carried = state[1];
    for (let index = 0; index < PERMUTATION.length; index += 1) {
      const target = PERMUTATION[index];
      const previous = state[target];
      state[target] = rotateLeft64(carried, ROTATION[index]);
      carried = previous;
    }

    for (let y = 0; y < 5; y += 1) {
      const row = state.slice(y * 5, y * 5 + 5);
      for (let x = 0; x < 5; x += 1) {
        state[x + y * 5] = (row[x] ^ ((~row[(x + 1) % 5]) & row[(x + 2) % 5])) & MASK_64;
      }
    }
    state[0] = (state[0] ^ roundConstant) & MASK_64;
  }
}
