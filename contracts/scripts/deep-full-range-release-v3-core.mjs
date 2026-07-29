import { readFileSync } from "node:fs";
import path from "node:path";

import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  getCreate2Address,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
} from "viem";

import {
  DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS,
  DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES,
  DEEP_V3_OPS_V2_SOURCE_PATHS,
  buildDeepV3OpsV2Projection,
  computeDeepV3OpsV2SourceCommitment,
} from "../../ops/deep-keeper-v3/source-commitment-v2.mjs";

export {
  DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS,
  DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES,
  DEEP_V3_OPS_V2_SOURCE_PATHS,
  buildDeepV3OpsV2Projection,
  computeDeepV3OpsV2SourceCommitment,
};

export const DEEP_V3_MANIFEST_PATH =
  "contracts/deployments/mainnet-deep-full-range-v3.json";
export const DEEP_V3_SCHEMA_PATH =
  "contracts/deployments/schema/deep-full-range-release-v3.schema.json";
export const DEEP_V3_LIFECYCLE_EVIDENCE_PATH =
  "contracts/deployments/evidence/deep-full-range-mainnet-canary-v3.json";

export const DEEP_V3_TRANSACTION_FIELDS = Object.freeze([
  "zapPlanner",
  "growthVaultFactory",
  "hookFactory",
  "feeHook",
  "launcher",
  "keeperExecutor",
]);

export const DEEP_V3_RUNTIME_FIELDS = Object.freeze([
  "zapPlanner",
  "growthVaultFactory",
  "growthVaultImplementation",
  "hookFactory",
  "feeHook",
  "launcher",
  "positionPlanner",
  "automation",
  "keeperExecutor",
]);

export const DEEP_V3_STACK = Object.freeze({
  treasury: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  lockedPositionFactory: "0x291a9ff1059d225d02B1659430804486404dB507",
});

export const DEEP_V3_STACK_RUNTIME_HASHES = Object.freeze({
  lockedPositionFactory:
    "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2",
});

export const DEEP_V3_OFFICIAL_DEPENDENCIES = Object.freeze({
  poolManager: Object.freeze({
    address: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    runtimeCodeHash:
      "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
    sourceRef: "v4-core@1.0.0",
  }),
  positionManager: Object.freeze({
    address: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
    runtimeCodeHash:
      "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b",
    sourceRef: "v4-periphery@2656054",
  }),
  stateView: Object.freeze({
    address: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
    runtimeCodeHash:
      "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878",
    sourceRef: "v4-periphery@2656054",
  }),
  v4Quoter: Object.freeze({
    address: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
    runtimeCodeHash:
      "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441",
    sourceRef: "v4-periphery@2656054",
  }),
  uerc20Factory: Object.freeze({
    address: "0x000000e200088D55C39a11F609E5F667729ad49b",
    runtimeCodeHash:
      "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
    sourceRef: "uerc20-factory@v2.0.0",
    deploymentSourceCommit: "de5bacd",
    reviewedSourcePin: "6f18f1c",
  }),
  permit2: Object.freeze({
    address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    runtimeCodeHash:
      "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131",
    sourceRef: "permit2",
  }),
  universalRouter: Object.freeze({
    address: "0xd92A36B0000531EF3063dEd4De20A0783308446C",
    runtimeCodeHash:
      "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49",
    sourceRef: "universal-router@d2d9c4a",
  }),
});

export const DEEP_V3_FIXED_POLICY = Object.freeze({
  tokenSupplyWei: "1000000000000000000000000000",
  totalSwapFeeBps: 100,
  growthFeeBps: 90,
  programmableFeeBps: 10,
  transferTaxBps: 0,
  lpFeePips: 0,
  tickSpacing: 200,
  initialTick: 204_200,
  fullRangeTickLower: -887_200,
  fullRangeTickUpper: 887_200,
  minimumInitialBuyWei: "600000000000000",
  minimumCompoundNativeWei: "2000000000000000",
  maximumCompoundNativeWei: "250000000000000000",
  compoundCooldownSeconds: 300,
  rollingExposureWindowSeconds: 1_800,
  rollingExposureRecordCapacity: 8,
  trustedDepthCycleCapBps: 25,
  maximumOptimizerIterations: 64,
  twapWindowSeconds: 1_800,
  shortTwapWindowSeconds: 300,
  oracleObservationCardinalityTarget: 192,
  maximumObservationTickDelta: 400,
  maximumRawTruncatedTwapDeltaTicks: 25,
  maximumShortLongTwapDeviationTicks: 50,
  maximumPreSpotTwapDeviationTicks: 100,
  maximumInternalSwapImpactTicks: 25,
  maximumPostSpotTwapDeviationTicks: 125,
});

export const DEEP_V3_KEEPER_GAS_MIXTURES = Object.freeze([
  Object.freeze({
    compoundCandidates: 0,
    oracleCandidates: 4,
    theoreticalGas: "7870636",
  }),
  Object.freeze({
    compoundCandidates: 1,
    oracleCandidates: 3,
    theoreticalGas: "10308732",
  }),
  Object.freeze({
    compoundCandidates: 2,
    oracleCandidates: 2,
    theoreticalGas: "12746828",
  }),
  Object.freeze({
    compoundCandidates: 3,
    oracleCandidates: 1,
    theoreticalGas: "15184924",
  }),
  Object.freeze({
    compoundCandidates: 4,
    oracleCandidates: 0,
    theoreticalGas: "17623020",
  }),
]);

export const DEEP_V3_KEEPER_POLICY = Object.freeze({
  enabled: false,
  transactionSubmission: false,
  executionPath: "/api/ops/deep-v3-keeper-v2",
  controlPath: "ops/deep-keeper-v3/control-v2.json",
  legacyControlPath: "ops/deep-keeper-v3/control-v1.json",
  controlSchemaVersion: 2,
  signerLaneCount: 1,
  confirmations: 12,
  independentReadRpcCount: 2,
  intervalMilliseconds: 300_000,
  scanPageSize: 32,
  maxScanPages: 2,
  maxCandidatesPerBatch: 4,
  maxNewSubmissionsPerTick: 1,
  maxActivePendingBatches: 8,
  maxOperatorIncidents: 8,
  maxHistoryEntries: 64,
  maximumTransactionGas: "18000000",
  maximumTotalGasPerTick: "18000000",
  maximumCompoundNativeWei: "250000000000000000",
  measuredCompoundGas: "2884090",
  reviewedPerVaultGasCeiling: "4428255",
  gasMixtures: DEEP_V3_KEEPER_GAS_MIXTURES,
  reviewedBindingPath:
    "ops/deep-keeper-v3/reviewed-ops-v2-binding.json",
});

export const DEEP_V3_ARTIFACTS = Object.freeze({
  zapPlanner: Object.freeze({
    fqcn: "src/LiquidityGrowthZapPlannerV3.sol:LiquidityGrowthZapPlannerV3",
    file: "contracts/out/LiquidityGrowthZapPlannerV3.sol/LiquidityGrowthZapPlannerV3.json",
  }),
  growthVaultFactory: Object.freeze({
    fqcn:
      "src/LiquidityGrowthFullRangeVaultFactoryV3.sol:LiquidityGrowthFullRangeVaultFactoryV3",
    file: "contracts/out/LiquidityGrowthFullRangeVaultFactoryV3.sol/LiquidityGrowthFullRangeVaultFactoryV3.json",
  }),
  growthVaultImplementation: Object.freeze({
    fqcn:
      "src/LiquidityGrowthFullRangeVaultV3.sol:LiquidityGrowthFullRangeVaultV3",
    file: "contracts/out/LiquidityGrowthFullRangeVaultV3.sol/LiquidityGrowthFullRangeVaultV3.json",
  }),
  hookFactory: Object.freeze({
    fqcn:
      "src/LiquidityGrowthFeeOracleHookFactoryV2.sol:LiquidityGrowthFeeOracleHookFactoryV2",
    file: "contracts/out/LiquidityGrowthFeeOracleHookFactoryV2.sol/LiquidityGrowthFeeOracleHookFactoryV2.json",
  }),
  feeHook: Object.freeze({
    fqcn:
      "src/LiquidityGrowthFeeOracleHookV2.sol:LiquidityGrowthFeeOracleHookV2",
    file: "contracts/out/LiquidityGrowthFeeOracleHookV2.sol/LiquidityGrowthFeeOracleHookV2.json",
  }),
  launcher: Object.freeze({
    fqcn:
      "src/LiquidityGrowthFullRangeLaunchV3.sol:LiquidityGrowthFullRangeLaunchV3",
    file: "contracts/out/LiquidityGrowthFullRangeLaunchV3.sol/LiquidityGrowthFullRangeLaunchV3.json",
  }),
  positionPlanner: Object.freeze({
    fqcn:
      "src/LiquidityGrowthFullRangePositionPlannerV3.sol:LiquidityGrowthFullRangePositionPlannerV3",
    file: "contracts/out/LiquidityGrowthFullRangePositionPlannerV3.sol/LiquidityGrowthFullRangePositionPlannerV3.json",
  }),
  automation: Object.freeze({
    fqcn:
      "src/LiquidityGrowthFullRangeAutomationV3.sol:LiquidityGrowthFullRangeAutomationV3",
    file: "contracts/out/LiquidityGrowthFullRangeAutomationV3.sol/LiquidityGrowthFullRangeAutomationV3.json",
  }),
  keeperExecutor: Object.freeze({
    fqcn: "src/DeepKeeperExecutorV2.sol:DeepKeeperExecutorV2",
    file: "contracts/out/DeepKeeperExecutorV2.sol/DeepKeeperExecutorV2.json",
  }),
});

const HASH = /^0x[0-9a-fA-F]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const REQUIRED_HOOK_FLAGS = 0x3aecn;
const MAX_ABS_TICK_DELTA = 400;
const MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96 =
  2_109_206_475_762_646_020_212_180_903_141_694n;

function artifact(root, field) {
  return JSON.parse(
    readFileSync(path.join(root, DEEP_V3_ARTIFACTS[field].file), "utf8"),
  );
}

function hashAbi(types, values) {
  return keccak256(
    encodeAbiParameters(parseAbiParameters(types.join(",")), values),
  );
}

function addressHashPairs(entries) {
  return hashAbi(
    entries.flatMap(() => ["address", "bytes32"]),
    entries.flatMap(([address, codeHash]) => [address, codeHash]),
  );
}

export function deepV3ArtifactRuntime(root) {
  return Object.fromEntries(
    DEEP_V3_RUNTIME_FIELDS.map((field) => {
      const data = artifact(root, field);
      const creation = data.bytecode.object;
      const runtime = data.deployedBytecode.object;
      return [
        field,
        {
          fqcn: DEEP_V3_ARTIFACTS[field].fqcn,
          creationBytes: (creation.length - 2) / 2,
          creationCodeHash: keccak256(creation),
          runtimeBytes: (runtime.length - 2) / 2,
          runtimeTemplateCodeHash: keccak256(runtime),
        },
      ];
    }),
  );
}

export function deepV3ConstructorBindings(manifest) {
  const addresses = manifest.addresses;
  return Object.freeze({
    zapPlanner: Object.freeze({ types: [], values: [] }),
    growthVaultFactory: Object.freeze({
      types: ["address"],
      values: [addresses.zapPlanner],
    }),
    growthVaultImplementation: Object.freeze({
      types: ["address"],
      values: [addresses.growthVaultFactory],
    }),
    hookFactory: Object.freeze({ types: [], values: [] }),
    feeHook: Object.freeze({
      types: ["address", "address", "address", "address", "int24"],
      values: [
        DEEP_V3_OFFICIAL_DEPENDENCIES.poolManager.address,
        DEEP_V3_STACK.treasury,
        addresses.growthVaultFactory,
        DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address,
        MAX_ABS_TICK_DELTA,
      ],
    }),
    launcher: Object.freeze({
      types: Array.from({ length: 6 }, () => "address"),
      values: [
        DEEP_V3_OFFICIAL_DEPENDENCIES.poolManager.address,
        DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address,
        DEEP_V3_OFFICIAL_DEPENDENCIES.uerc20Factory.address,
        addresses.feeHook,
        addresses.growthVaultFactory,
        DEEP_V3_STACK.lockedPositionFactory,
      ],
    }),
    positionPlanner: Object.freeze({ types: [], values: [] }),
    automation: Object.freeze({
      types: ["address", "address"],
      values: [addresses.growthVaultFactory, addresses.launcher],
    }),
    keeperExecutor: Object.freeze({
      types: ["address"],
      values: [addresses.automation],
    }),
  });
}

export function encodeDeepV3ConstructorArguments(field, manifest) {
  const binding = deepV3ConstructorBindings(manifest)[field];
  if (!binding) throw new Error(`Unknown Deep V3 constructor binding ${field}`);
  if (binding.types.length === 0) return "0x";
  return encodeAbiParameters(
    parseAbiParameters(binding.types.join(",")),
    binding.values,
  );
}

export function expectedDeepV3CreationInput(field, manifest, root) {
  const data = artifact(root, field);
  const argumentsHex = encodeDeepV3ConstructorArguments(field, manifest);
  return concatHex([data.bytecode.object, argumentsHex]);
}

export function expectedDeepV3HookDeploymentInput(manifest) {
  return encodeFunctionData({
    abi: parseAbi([
      "function deploy(bytes32 salt,address poolManager,address launcherFeeRecipient,address growthVaultFactory,address positionManager,int24 maxAbsTickDelta) returns (address hook)",
    ]),
    functionName: "deploy",
    args: [
      manifest.hookSalt,
      DEEP_V3_OFFICIAL_DEPENDENCIES.poolManager.address,
      DEEP_V3_STACK.treasury,
      manifest.addresses.growthVaultFactory,
      DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address,
      MAX_ABS_TICK_DELTA,
    ],
  });
}

export function expectedDeepV3TransactionInput(field, manifest, root) {
  if (field === "feeHook") return expectedDeepV3HookDeploymentInput(manifest);
  if (!DEEP_V3_TRANSACTION_FIELDS.includes(field)) {
    throw new Error(`${field} is not one of the six broadcaster transactions`);
  }
  return expectedDeepV3CreationInput(field, manifest, root);
}

function immutableExpectedWords(field, manifest) {
  const addresses = manifest.addresses;
  const words = {
    zapPlanner: [],
    growthVaultFactory: [
      ["address", addresses.growthVaultImplementation],
      ["address", addresses.zapPlanner],
    ],
    growthVaultImplementation: [["address", addresses.growthVaultFactory]],
    hookFactory: [],
    feeHook: [
      ["address", DEEP_V3_OFFICIAL_DEPENDENCIES.poolManager.address],
      ["address", DEEP_V3_STACK.treasury],
      ["address", addresses.growthVaultFactory],
      ["address", DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address],
      ["int24", MAX_ABS_TICK_DELTA],
    ],
    launcher: [
      ["uint160", MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96],
      ["address", DEEP_V3_OFFICIAL_DEPENDENCIES.poolManager.address],
      ["address", DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address],
      ["address", DEEP_V3_OFFICIAL_DEPENDENCIES.uerc20Factory.address],
      ["address", addresses.feeHook],
      ["address", addresses.growthVaultFactory],
      ["address", DEEP_V3_STACK.lockedPositionFactory],
      ["address", addresses.positionPlanner],
      ["address", addresses.automation],
    ],
    positionPlanner: [],
    automation: [
      ["address", addresses.growthVaultFactory],
      ["address", addresses.launcher],
    ],
    keeperExecutor: [["address", addresses.automation]],
  }[field];
  if (!words) throw new Error(`Unknown Deep V3 runtime binding ${field}`);
  return words
    .map(([type, value]) =>
      encodeAbiParameters(parseAbiParameters(type), [value]).toLowerCase(),
    )
    .sort();
}

export function assertDeepV3ArtifactRuntimeBinding(
  field,
  runtime,
  manifest,
  root,
) {
  const data = artifact(root, field);
  const template = data.deployedBytecode.object;
  if (
    typeof runtime !== "string" ||
    runtime === "0x" ||
    runtime.length !== template.length
  ) {
    throw new Error(`${field} runtime length does not match its artifact`);
  }
  const referenceGroups = Object.values(
    data.deployedBytecode.immutableReferences ?? {},
  );
  const expectedWords = immutableExpectedWords(field, manifest);
  if (referenceGroups.length !== expectedWords.length) {
    throw new Error(`${field} immutable reference count changed`);
  }
  const body = runtime.slice(2).toLowerCase();
  let reconstructed = template.slice(2).toLowerCase();
  const observedWords = [];
  for (const group of referenceGroups) {
    if (
      !Array.isArray(group) ||
      group.length === 0 ||
      group.some(
        ({ start, length }) =>
          !Number.isSafeInteger(start) || start < 0 || length !== 32,
      )
    ) {
      throw new Error(`${field} immutable references are malformed`);
    }
    const words = group.map(({ start, length }) =>
      body.slice(start * 2, (start + length) * 2),
    );
    if (new Set(words).size !== 1) {
      throw new Error(`${field} immutable slot group is inconsistent`);
    }
    const word = `0x${words[0]}`;
    observedWords.push(word);
    for (const { start, length } of group) {
      reconstructed =
        reconstructed.slice(0, start * 2) +
        word.slice(2) +
        reconstructed.slice((start + length) * 2);
    }
  }
  if (
    observedWords.sort().join(",") !== expectedWords.join(",") ||
    `0x${reconstructed}` !== runtime.toLowerCase()
  ) {
    throw new Error(`${field} runtime immutables do not match the six-tx graph`);
  }
  return keccak256(runtime);
}

export function computeDeepV3SourceCommitment(root) {
  const creationHashes = DEEP_V3_RUNTIME_FIELDS.map((field) =>
    keccak256(artifact(root, field).bytecode.object),
  );
  const bytecodeCommitment = hashAbi(
    creationHashes.map(() => "bytes32"),
    creationHashes,
  );
  const coreCommitment = addressHashPairs(
    ["poolManager", "positionManager", "stateView", "v4Quoter"].map(
      (field) => [
        DEEP_V3_OFFICIAL_DEPENDENCIES[field].address,
        DEEP_V3_OFFICIAL_DEPENDENCIES[field].runtimeCodeHash,
      ],
    ),
  );
  const routingCommitment = addressHashPairs(
    ["uerc20Factory", "permit2", "universalRouter"].map((field) => [
      DEEP_V3_OFFICIAL_DEPENDENCIES[field].address,
      DEEP_V3_OFFICIAL_DEPENDENCIES[field].runtimeCodeHash,
    ]),
  );
  const lockingCommitment = hashAbi(
    ["address", "bytes32", "address"],
    [
      DEEP_V3_STACK.lockedPositionFactory,
      DEEP_V3_STACK_RUNTIME_HASHES.lockedPositionFactory,
      DEEP_V3_STACK.treasury,
    ],
  );
  const dependencyCommitment = hashAbi(
    ["bytes32", "bytes32", "bytes32"],
    [coreCommitment, routingCommitment, lockingCommitment],
  );
  const marketPolicyCommitment = hashAbi(
    [
      "uint16",
      "uint16",
      "uint16",
      "uint24",
      "int24",
      "int24",
      "int24",
      "int24",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
    ],
    [
      100,
      90,
      10,
      0,
      200,
      204_200,
      -887_200,
      887_200,
      1_000_000_000n * 10n ** 18n,
      600_000_000_000_000n,
      2_000_000_000_000_000n,
      250_000_000_000_000_000n,
    ],
  );
  const automationPolicyCommitment = hashAbi(
    ["uint64", "uint64", "uint8", "uint16", "uint8", "bytes32", "bytes32"],
    [
      300n,
      1_800n,
      8,
      25,
      64,
      keccak256(stringToHex("programmable.deep.full-range.position.v3")),
      keccak256(stringToHex("programmable.deep.compound.v3")),
    ],
  );
  const oraclePolicyCommitment = hashAbi(
    [
      "uint64",
      "uint64",
      "uint16",
      "int24",
      "int24",
      "int24",
      "int24",
      "int24",
      "int24",
    ],
    [1_800n, 300n, 192, 400, 25, 50, 100, 25, 125],
  );
  const policyCommitment = hashAbi(
    ["bytes32", "bytes32", "bytes32"],
    [
      marketPolicyCommitment,
      automationPolicyCommitment,
      oraclePolicyCommitment,
    ],
  );
  const securityCommitment = hashAbi(
    Array.from({ length: 9 }, () => "bytes32"),
    [
      "exact-original-pool-id",
      "atomic-native-buy-and-permanent-add",
      "vault-only-transient-fee-exemption",
      "fixed-one-percent-ninety-ten-native-split",
      "staged-192-observation-thirty-minute-twap",
      "five-minute-minimum-cooldown",
      "bounded-rolling-exposure",
      "zero-admin-zero-withdrawal-zero-rescue",
      "permissionless-fail-closed-keeper",
    ].map((value) => keccak256(stringToHex(value))),
  );
  return hashAbi(
    ["bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
    [
      keccak256(
        stringToHex(
          "programmable.deep.full-range.infrastructure.v3.ethereum",
        ),
      ),
      bytecodeCommitment,
      dependencyCommitment,
      policyCommitment,
      securityCommitment,
    ],
  );
}

export function buildDeepV3DeploymentPlan(
  deployer,
  startingNonce,
  hookSalt,
  root,
) {
  if (
    !isAddress(deployer) ||
    !Number.isSafeInteger(startingNonce) ||
    startingNonce < 0 ||
    startingNonce > Number.MAX_SAFE_INTEGER - 6 ||
    !HASH.test(hookSalt ?? "") ||
    BigInt(hookSalt) === 0n
  ) {
    throw new Error("Deep V3 deployer, nonce, or hook salt is invalid");
  }
  const broadcaster = getAddress(deployer);
  const create = (offset) =>
    getContractAddress({
      from: broadcaster,
      nonce: BigInt(startingNonce + offset),
      opcode: "CREATE",
    });
  const zapPlanner = create(0);
  const growthVaultFactory = create(1);
  const hookFactory = create(2);
  const launcher = create(4);
  const addresses = {
    deployer: broadcaster,
    treasury: DEEP_V3_STACK.treasury,
    lockedPositionFactory: DEEP_V3_STACK.lockedPositionFactory,
    zapPlanner,
    growthVaultFactory,
    growthVaultImplementation: getContractAddress({
      from: growthVaultFactory,
      nonce: 1n,
      opcode: "CREATE",
    }),
    hookFactory,
    feeHook: undefined,
    launcher,
    positionPlanner: getContractAddress({
      from: launcher,
      nonce: 1n,
      opcode: "CREATE",
    }),
    automation: getContractAddress({
      from: launcher,
      nonce: 2n,
      opcode: "CREATE",
    }),
    keeperExecutor: create(5),
  };
  const hookArguments = encodeAbiParameters(
    parseAbiParameters("address,address,address,address,int24"),
    [
      DEEP_V3_OFFICIAL_DEPENDENCIES.poolManager.address,
      DEEP_V3_STACK.treasury,
      growthVaultFactory,
      DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address,
      MAX_ABS_TICK_DELTA,
    ],
  );
  const hookInitCode = concatHex([
    artifact(root, "feeHook").bytecode.object,
    hookArguments,
  ]);
  addresses.feeHook = getCreate2Address({
    from: hookFactory,
    salt: hookSalt,
    bytecodeHash: keccak256(hookInitCode),
  });
  const flags = BigInt(addresses.feeHook) & ((1n << 14n) - 1n);
  if (flags !== REQUIRED_HOOK_FLAGS) {
    throw new Error(
      `Deep V3 hook salt produces flags 0x${flags.toString(16)}, expected 0x${REQUIRED_HOOK_FLAGS.toString(16)}`,
    );
  }
  return Object.freeze({
    transactionCount: 6,
    startingNonce,
    hookSalt,
    ...addresses,
    sourceCommitment: computeDeepV3SourceCommitment(root),
  });
}

function validHash(value) {
  return typeof value === "string" && HASH.test(value);
}

function sameAddress(left, right) {
  return (
    isAddress(left ?? "") &&
    isAddress(right ?? "") &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function exactObject(actual, expected) {
  return (
    actual &&
    typeof actual === "object" &&
    !Array.isArray(actual) &&
    Object.keys(actual).sort().join(",") ===
      Object.keys(expected).sort().join(",") &&
    Object.entries(expected).every(([key, value]) => actual[key] === value)
  );
}

function exactGasMixtures(actual) {
  return (
    Array.isArray(actual) &&
    JSON.stringify(canonicalJson(actual)) ===
      JSON.stringify(canonicalJson(DEEP_V3_KEEPER_GAS_MIXTURES))
  );
}

function positiveUintString(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalJson(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function sameJson(left, right) {
  return (
    JSON.stringify(canonicalJson(left)) ===
    JSON.stringify(canonicalJson(right))
  );
}

export function parseDeepV3EtherscanStandardJson(sourceCode) {
  if (typeof sourceCode !== "string" || sourceCode.trim().length === 0) {
    throw new Error("Etherscan SourceCode is empty");
  }
  let normalized = sourceCode.trim();
  if (normalized.startsWith("{{") && normalized.endsWith("}}")) {
    normalized = normalized.slice(1, -1);
  }
  let input;
  try {
    input = JSON.parse(normalized);
  } catch {
    throw new Error("Etherscan SourceCode is not standard JSON");
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !==
      "language,settings,sources" ||
    input.language !== "Solidity" ||
    !input.sources ||
    typeof input.sources !== "object" ||
    Array.isArray(input.sources) ||
    !input.settings ||
    typeof input.settings !== "object" ||
    Array.isArray(input.settings)
  ) {
    throw new Error("Etherscan standard JSON has an invalid shape");
  }
  return input;
}

function assertPinnedDeepV3CompilerSettings(settings) {
  if (
    !sameJson(settings.optimizer, { enabled: true, runs: 1_000 }) ||
    settings.evmVersion !== "cancun" ||
    settings.viaIR !== false ||
    !sameJson(settings.libraries, {}) ||
    !sameJson(settings.metadata, {
      useLiteralContent: false,
      bytecodeHash: "none",
      appendCBOR: false,
    })
  ) {
    throw new Error("Etherscan compiler settings differ from the release pin");
  }
}

export function assertDeepV3EtherscanStandardJsonMatches(
  sourceCode,
  expectedInput,
) {
  const observed = parseDeepV3EtherscanStandardJson(sourceCode);
  if (
    !expectedInput ||
    typeof expectedInput !== "object" ||
    Array.isArray(expectedInput)
  ) {
    throw new Error("Expected standard JSON input is unavailable");
  }
  assertPinnedDeepV3CompilerSettings(expectedInput.settings);
  if (!sameJson(observed.settings, expectedInput.settings)) {
    throw new Error("Etherscan compiler settings differ from the local input");
  }
  if (
    observed.language !== expectedInput.language ||
    !sameJson(observed.sources, expectedInput.sources)
  ) {
    throw new Error("Etherscan source contents differ from the local input");
  }
  return observed;
}

export function assertDeepV3EtherscanBuildInput(
  field,
  sourceCode,
  expectedInput,
  root,
) {
  const observed = assertDeepV3EtherscanStandardJsonMatches(
    sourceCode,
    expectedInput,
  );
  if (!DEEP_V3_RUNTIME_FIELDS.includes(field)) {
    throw new Error(`Unknown Deep V3 artifact field: ${field}`);
  }
  const metadataSources = artifact(root, field).metadata?.sources;
  if (
    !metadataSources ||
    typeof metadataSources !== "object" ||
    Array.isArray(metadataSources) ||
    Object.keys(metadataSources).sort().join(",") !==
      Object.keys(expectedInput.sources).sort().join(",")
  ) {
    throw new Error(`${field} release artifact source set differs`);
  }
  const contractsRoot = path.resolve(root, "contracts");
  for (const sourcePath of Object.keys(metadataSources)) {
    const expectedSource = expectedInput.sources[sourcePath];
    if (
      !expectedSource ||
      typeof expectedSource.content !== "string" ||
      Object.keys(expectedSource).sort().join(",") !== "content"
    ) {
      throw new Error(`${field} source input is incomplete: ${sourcePath}`);
    }
    const localPath = path.resolve(contractsRoot, sourcePath);
    if (
      localPath !== contractsRoot &&
      !localPath.startsWith(`${contractsRoot}${path.sep}`)
    ) {
      throw new Error(`${field} source path escapes the contracts root`);
    }
    const localContent = readFileSync(localPath, "utf8");
    const contentHash = keccak256(stringToHex(expectedSource.content));
    if (
      observed.sources[sourcePath]?.content !== expectedSource.content ||
      localContent !== expectedSource.content ||
      metadataSources[sourcePath]?.keccak256 !== contentHash
    ) {
      throw new Error(
        `${field} source content or artifact hash differs: ${sourcePath}`,
      );
    }
  }
  return observed;
}

function deterministicPlanMatches(manifest, root) {
  const candidate = manifest?.candidatePlan;
  if (
    !["reviewed-at-signing", "receipt-reconstructed"].includes(candidate?.status) ||
    !isAddress(candidate.deployer ?? "") ||
    !Number.isSafeInteger(candidate.startingNonce) ||
    !validHash(candidate.hookSalt)
  ) {
    return false;
  }
  let plan;
  try {
    plan = buildDeepV3DeploymentPlan(
      candidate.deployer,
      candidate.startingNonce,
      candidate.hookSalt,
      root,
    );
  } catch {
    return false;
  }
  return (
    manifest.startingNonce === plan.startingNonce &&
    manifest.hookSalt === plan.hookSalt &&
    DEEP_V3_RUNTIME_FIELDS.every(
      (field) =>
        sameAddress(candidate[field], plan[field]) &&
        sameAddress(manifest.addresses?.[field], plan[field]),
    ) &&
    sameAddress(manifest.addresses?.deployer, plan.deployer)
  );
}

function exactDeploymentEvidence(manifest) {
  const primary = new Set(DEEP_V3_TRANSACTION_FIELDS);
  const parentByField = {
    growthVaultImplementation: "growthVaultFactory",
    positionPlanner: "launcher",
    automation: "launcher",
  };
  if (
    new Set(
      DEEP_V3_TRANSACTION_FIELDS.map((field) => manifest.transactions?.[field]),
    ).size !== 6
  ) {
    return false;
  }
  for (const field of DEEP_V3_RUNTIME_FIELDS) {
    const evidence = manifest.deploymentEvidence?.[field];
    const parent = parentByField[field] ?? field;
    if (
      !evidence ||
      evidence.receiptStatus !== "success" ||
      !validHash(evidence.transactionHash) ||
      evidence.transactionHash !== manifest.transactions?.[field] ||
      evidence.transactionHash !== manifest.transactions?.[parent] ||
      evidence.blockNumber !== manifest.deploymentBlocks?.[field] ||
      evidence.blockNumber !== manifest.deploymentBlocks?.[parent] ||
      !validHash(evidence.blockHash)
    ) {
      return false;
    }
    if (primary.has(field)) {
      const offset = DEEP_V3_TRANSACTION_FIELDS.indexOf(field);
      const expectedTo =
        field === "feeHook" ? manifest.addresses?.hookFactory : null;
      if (
        evidence.nonce !== manifest.startingNonce + offset ||
        !sameAddress(evidence.from, manifest.addresses?.deployer) ||
        (expectedTo === null
          ? evidence.to !== null
          : !sameAddress(evidence.to, expectedTo)) ||
        evidence.valueWei !== "0" ||
        !validHash(evidence.transactionInputHash)
      ) {
        return false;
      }
    }
  }
  return true;
}

function exactSourceRecord(record, address, fqcn) {
  return (
    record?.status === "etherscan-exact-sourcify-match" &&
    record?.fqcn === fqcn &&
    typeof record.encodedConstructorArguments === "string" &&
    /^0x([0-9a-fA-F]{2})*$/.test(record.encodedConstructorArguments) &&
    record.etherscan?.status === "exact-match" &&
    record.etherscan.url ===
      `https://etherscan.io/address/${address}#code` &&
    record.sourcify?.status === "match" &&
    record.sourcify.url ===
      `https://sourcify.dev/server/v2/contract/1/${address}`
  );
}

function exactSourceVerification(manifest) {
  return (
    manifest?.sourceVerification?.status === "verified" &&
    DEEP_V3_RUNTIME_FIELDS.every((field) =>
      exactSourceRecord(
        manifest.sourceVerification.contracts?.[field],
        manifest.addresses?.[field],
        DEEP_V3_ARTIFACTS[field].fqcn,
      ),
    )
  );
}

function validLifecycle(manifest) {
  const lifecycle = manifest?.lifecycleEvidence;
  return (
    lifecycle?.status === "verified-current-release" &&
    lifecycle.releaseEligible === true &&
    lifecycle.requiredRelease === "deep-full-range-v3" &&
    lifecycle.evidencePath === DEEP_V3_LIFECYCLE_EVIDENCE_PATH &&
    lifecycle.independentRpcCount === 2 &&
    isAddress(lifecycle.canaryToken ?? "") &&
    isAddress(lifecycle.canaryVault ?? "") &&
    validHash(lifecycle.poolId) &&
    validHash(lifecycle.launchTransaction) &&
    validHash(lifecycle.oracleTransaction) &&
    validHash(lifecycle.compoundTransaction) &&
    new Set([
      lifecycle.launchTransaction,
      lifecycle.oracleTransaction,
      lifecycle.compoundTransaction,
    ]).size === 3 &&
    validHash(lifecycle.evidenceHash) &&
    lifecycle.noActionKeeperCycle?.status === "verified-no-transaction" &&
    lifecycle.noActionKeeperCycle.outcome === "idle" &&
    lifecycle.noActionKeeperCycle.readyVaults === 0 &&
    lifecycle.noActionKeeperCycle.submittedTransaction === false &&
    Number.isSafeInteger(lifecycle.noActionKeeperCycle.observedAtBlock) &&
    lifecycle.noActionKeeperCycle.observedAtBlock > 0 &&
    validHash(lifecycle.noActionKeeperCycle.evidenceHash) &&
    lifecycle.actionableKeeperCycle?.status ===
      "verified-compound-confirmed" &&
    lifecycle.actionableKeeperCycle.outcome === "confirmed-productive" &&
    lifecycle.actionableKeeperCycle.submittedTransaction === true &&
    Number.isSafeInteger(lifecycle.actionableKeeperCycle.readyVaults) &&
    lifecycle.actionableKeeperCycle.readyVaults > 0 &&
    Number.isSafeInteger(
      lifecycle.actionableKeeperCycle.successfulCandidates,
    ) &&
    lifecycle.actionableKeeperCycle.successfulCandidates > 0 &&
    lifecycle.actionableKeeperCycle.transactionHash ===
      lifecycle.compoundTransaction &&
    Number.isSafeInteger(lifecycle.actionableKeeperCycle.blockNumber) &&
    lifecycle.actionableKeeperCycle.blockNumber > 0 &&
    validHash(lifecycle.actionableKeeperCycle.evidenceHash)
  );
}

export function assessDeepV3LiveManifest(manifest, root) {
  const reasons = [];
  const require = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };
  require(
    manifest?.schemaVersion === 3 &&
      manifest.model === "deep" &&
      manifest.internalContractRelease ===
        "liquidity-growth-full-range-v3" &&
      manifest.releaseVersion === "deep-full-range-v3" &&
      manifest.releaseManifest === DEEP_V3_MANIFEST_PATH &&
      manifest.keeperReleaseVersion === "deep-keeper-v3-ops-v2" &&
      manifest.chainId === 1 &&
      manifest.transactionCount === 6,
    "V3 release identity",
  );
  require(
    manifest?.status ===
      "deployment-source-lifecycle-and-keeper-verified" &&
      manifest.releaseEligible === true &&
      COMMIT.test(manifest.releaseCommit ?? "") &&
      Number.isSafeInteger(manifest.startBlock) &&
      manifest.startBlock > 0 &&
      Array.isArray(manifest.blockers) &&
      manifest.blockers.length === 0,
    "final release status",
  );
  require(
    deterministicPlanMatches(manifest, root),
    "deterministic six-transaction plan",
  );
  require(exactDeploymentEvidence(manifest), "six deployment receipts");
  require(
    DEEP_V3_RUNTIME_FIELDS.every((field) =>
      validHash(manifest.runtimeCodeHashes?.[field]),
    ),
    "nine runtime identities",
  );
  require(
    exactSourceVerification(manifest),
    "Etherscan exact and Sourcify match verification",
  );
  require(validLifecycle(manifest), "current-release canary evidence");
  require(
    exactObject(manifest?.fixedPolicy, DEEP_V3_FIXED_POLICY),
    "fixed V3 policy",
  );
  require(
    manifest?.storageSafety?.status === "verified-empty-eip1967-slots" &&
      manifest.storageSafety.proxyAdminBeaconSlotsEmpty === true &&
      DEEP_V3_RUNTIME_FIELDS.every(
        (field) => manifest.storageSafety.contracts?.[field] === true,
      ),
    "non-proxy storage safety",
  );
  require(
    manifest?.keeperPolicy?.status === "reviewed-active" &&
      manifest.keeperPolicy.enabled === true &&
      manifest.keeperPolicy.transactionSubmission === true &&
      sameAddress(
        manifest.keeperPolicy.keeperExecutor,
        manifest.addresses?.keeperExecutor,
      ) &&
      manifest.keeperPolicy.keeperExecutorRuntimeCodeHash ===
        manifest.runtimeCodeHashes?.keeperExecutor &&
      sameAddress(
        manifest.keeperPolicy.automation,
        manifest.addresses?.automation,
      ) &&
      manifest.keeperPolicy.automationRuntimeCodeHash ===
        manifest.runtimeCodeHashes?.automation &&
      isAddress(manifest.keeperPolicy.signerAddress ?? "") &&
      manifest.keeperPolicy.signingBackend === "privy-policy-wallet" &&
      Object.entries(DEEP_V3_KEEPER_POLICY).every(([key, expected]) =>
        key === "enabled" || key === "transactionSubmission"
          ? true
          : key === "gasMixtures"
            ? exactGasMixtures(manifest.keeperPolicy.gasMixtures)
            : manifest.keeperPolicy[key] === expected,
      ) &&
      Number.isSafeInteger(
        manifest.keeperPolicy.minGrowthToMaxGasRatioBps,
      ) &&
      manifest.keeperPolicy.minGrowthToMaxGasRatioBps > 0 &&
      manifest.keeperPolicy.minGrowthToMaxGasRatioBps <= 10_000_000 &&
      positiveUintString(manifest.keeperPolicy.maxFeePerGasWei) &&
      positiveUintString(
        manifest.keeperPolicy.maxTotalDebitWeiPerTick,
      ) &&
      positiveUintString(
        manifest.keeperPolicy.maxTotalDebitWeiPerDay,
      ) &&
      BigInt(manifest.keeperPolicy.maxTotalDebitWeiPerDay) >=
        BigInt(manifest.keeperPolicy.maxTotalDebitWeiPerTick) &&
      positiveUintString(
        manifest.keeperPolicy.signerBalanceFloorWei,
      ) &&
      validHash(manifest.keeperPolicy.opsSourceCommitment) &&
      manifest.keeperPolicy.opsSourceCommitment ===
        computeDeepV3OpsV2SourceCommitment(root) &&
      manifest.keeperPolicy.deploymentCommit ===
        manifest.releaseCommit,
    "keeper reviewed and active",
  );
  require(
    manifest?.activation?.appStatus === "ready" &&
      manifest.activation.keeperStatus === "ready" &&
      manifest.activation.requiresExactManifestMatch === true &&
      manifest.activation.productionTransactionSubmission === true,
    "release activation",
  );
  return Object.freeze({ ready: reasons.length === 0, reasons });
}

export function validDeepV3Hash(value) {
  return validHash(value);
}
