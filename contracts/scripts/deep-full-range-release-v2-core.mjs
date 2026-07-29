import { readFileSync } from "node:fs";
import path from "node:path";

import {
  encodeAbiParameters,
  getAddress,
  getContractAddress,
  isAddress,
  keccak256,
  padHex,
  parseAbiParameters,
  stringToHex,
} from "viem";

export const DEEP_V2_MANIFEST_PATH =
  "contracts/deployments/mainnet-deep-full-range-v2.json";
export const DEEP_V2_SCHEMA_PATH =
  "contracts/deployments/schema/deep-full-range-release-v2.schema.json";
export const DEEP_V2_LIFECYCLE_EVIDENCE_PATH =
  "contracts/deployments/evidence/deep-full-range-mainnet-canary-v2.json";
export const DEEP_V2_REVIEWED_BINDING_PATH =
  "ops/deep-keeper-v2/reviewed-release-binding.json";

export const DEEP_V2_SHARED_STACK = Object.freeze({
  treasury: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  feeSplitVaultFactory: "0xF15D4528Db481732Cdb94FC2558d04ce4D85Cb54",
  hookFactory: "0xb003a14Ef04D5022A8CfB4158b49f77e2e73b5E9",
  feeHook: "0x48dC3009eC1d3298BBA31f718A9A29d02fC9B0cC",
  rangeSourceFactory: "0xb2Ec2573bB6968b9fA85f1A0b82E33bB0A388a43",
  positionForwarderFactory:
    "0x291a9ff1059d225d02B1659430804486404dB507",
});

export const DEEP_V2_SHARED_RUNTIME_HASHES = Object.freeze({
  feeSplitVaultFactory:
    "0x6e0fed3c3598d32458b9c7ce04a97ae3e0cc847e4022e3dec5a14cd1f29c88fc",
  hookFactory:
    "0x786c4720eeb3583c6021794e39360369f52510d2d0b29b8212b99bb9e6efe5ae",
  feeHook:
    "0xda536944ead25d438a8a957ec1c7997115fb36d7e1af963d162b1ce99229b002",
  rangeSourceFactory:
    "0x3c909216b8f1200c19d6d01f65b332fe3eca4728e27d671a86a346089df69373",
  positionForwarderFactory:
    "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2",
});

export const DEEP_V2_OFFICIAL_DEPENDENCIES = Object.freeze({
  poolManager: Object.freeze({
    address: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    runtimeCodeHash:
      "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
  }),
  positionManager: Object.freeze({
    address: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
    runtimeCodeHash:
      "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b",
  }),
  stateView: Object.freeze({
    address: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
    runtimeCodeHash:
      "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878",
  }),
  v4Quoter: Object.freeze({
    address: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
    runtimeCodeHash:
      "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441",
  }),
  tokenFactory: Object.freeze({
    address: "0x000000e200088D55C39a11F609E5F667729ad49b",
    runtimeCodeHash:
      "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
  }),
  permit2: Object.freeze({
    address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    runtimeCodeHash:
      "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131",
  }),
  universalRouter: Object.freeze({
    address: "0xd92A36B0000531EF3063dEd4De20A0783308446C",
    runtimeCodeHash:
      "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49",
  }),
});

export const DEEP_V2_FIXED_POLICY = Object.freeze({
  tokenSupplyWei: "1000000000000000000000000000",
  tokenReserveTargetWei: "150000000000000000000000000",
  growthTargetNativeWei: "50000000000000000",
  totalSwapFeeBps: 100,
  creatorFeeBps: 90,
  programmableFeeBps: 10,
  minimumInitialBuyWei: "600000000000000",
  initialTick: 204_200,
  tickSpacing: 200,
  lpFeePips: 0,
  twapWindowSeconds: 1_800,
  oracleRangeHalfWidthTicks: 20_000,
  maximumSpotTwapDeviationTicks: 600,
  maximumAbsoluteTickDelta: 400,
  compoundCooldownSeconds: 300,
  rollingExposureWindowSeconds: 1_800,
  rollingExposureRecordCapacity: 8,
  minimumKeeperProcessNativeWei: "2000000000000000",
  oracleObservationCardinalityTarget: 192,
});

export const DEEP_V2_ARTIFACTS = Object.freeze({
  growthVaultFactory: Object.freeze({
    fqcn: "src/LiquidityGrowthFullRangeVaultFactoryV2.sol:LiquidityGrowthFullRangeVaultFactoryV2",
    file: "contracts/out/LiquidityGrowthFullRangeVaultFactoryV2.sol/LiquidityGrowthFullRangeVaultFactoryV2.json",
  }),
  growthVaultImplementation: Object.freeze({
    fqcn: "src/LiquidityGrowthFullRangeVaultV2.sol:LiquidityGrowthFullRangeVaultV2",
    file: "contracts/out/LiquidityGrowthFullRangeVaultV2.sol/LiquidityGrowthFullRangeVaultV2.json",
  }),
  launcher: Object.freeze({
    fqcn: "src/LiquidityGrowthFullRangeLaunchV2.sol:LiquidityGrowthFullRangeLaunchV2",
    file: "contracts/out/LiquidityGrowthFullRangeLaunchV2.sol/LiquidityGrowthFullRangeLaunchV2.json",
  }),
  automation: Object.freeze({
    fqcn: "src/LiquidityGrowthFullRangeAutomationV2.sol:LiquidityGrowthFullRangeAutomationV2",
    file: "contracts/out/LiquidityGrowthFullRangeAutomationV2.sol/LiquidityGrowthFullRangeAutomationV2.json",
  }),
  positionPlanner: Object.freeze({
    fqcn: "src/LiquidityGrowthFullRangePositionPlannerV2.sol:LiquidityGrowthFullRangePositionPlannerV2",
    file: "contracts/out/LiquidityGrowthFullRangePositionPlannerV2.sol/LiquidityGrowthFullRangePositionPlannerV2.json",
  }),
});

const HASH = /^0x[0-9a-fA-F]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const NEW_FIELDS = Object.freeze(Object.keys(DEEP_V2_ARTIFACTS));

function artifact(root, field) {
  return JSON.parse(
    readFileSync(path.join(root, DEEP_V2_ARTIFACTS[field].file), "utf8"),
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

export function deepV2ArtifactRuntime(root) {
  return Object.fromEntries(
    NEW_FIELDS.map((field) => {
      const data = artifact(root, field);
      const creation = data.bytecode.object;
      const runtime = data.deployedBytecode.object;
      return [
        field,
        {
          fqcn: DEEP_V2_ARTIFACTS[field].fqcn,
          creationBytes: (creation.length - 2) / 2,
          creationCodeHash: keccak256(creation),
          runtimeBytes: (runtime.length - 2) / 2,
          runtimeTemplateCodeHash: keccak256(runtime),
        },
      ];
    }),
  );
}

export function deepV2ConstructorBindings(manifest) {
  const addresses = manifest.addresses;
  return Object.freeze({
    growthVaultFactory: Object.freeze({
      types: ["address", "address", "address", "address", "address"],
      values: [
        addresses.hookFactory,
        addresses.feeSplitVaultFactory,
        DEEP_V2_OFFICIAL_DEPENDENCIES.positionManager.address,
        addresses.positionForwarderFactory,
        addresses.rangeSourceFactory,
      ],
    }),
    growthVaultImplementation: Object.freeze({
      types: ["address"],
      values: [addresses.growthVaultFactory],
    }),
    launcher: Object.freeze({
      types: Array.from({ length: 8 }, () => "address"),
      values: [
        DEEP_V2_OFFICIAL_DEPENDENCIES.poolManager.address,
        DEEP_V2_OFFICIAL_DEPENDENCIES.positionManager.address,
        DEEP_V2_OFFICIAL_DEPENDENCIES.tokenFactory.address,
        addresses.feeHook,
        addresses.feeSplitVaultFactory,
        addresses.rangeSourceFactory,
        addresses.growthVaultFactory,
        addresses.positionForwarderFactory,
      ],
    }),
    automation: Object.freeze({
      types: ["address", "address"],
      values: [addresses.growthVaultFactory, addresses.launcher],
    }),
    positionPlanner: Object.freeze({ types: [], values: [] }),
    keeperExecutor: Object.freeze({
      types: ["address"],
      values: [addresses.automation],
    }),
  });
}

export function encodeDeepV2ConstructorArguments(field, manifest) {
  const binding = deepV2ConstructorBindings(manifest)[field];
  if (!binding) throw new Error(`Unknown Deep V2 constructor binding ${field}`);
  if (binding.types.length === 0) return "0x";
  return encodeAbiParameters(
    parseAbiParameters(binding.types.join(",")),
    binding.values,
  );
}

export function expectedDeepV2CreationInput(field, manifest, root) {
  const data = artifact(root, field);
  const argumentsHex = encodeDeepV2ConstructorArguments(field, manifest);
  return `${data.bytecode.object}${argumentsHex.slice(2)}`;
}

function immutableExpectedAddresses(field, manifest) {
  const addresses = manifest.addresses;
  const values = {
    growthVaultFactory: [
      addresses.hookFactory,
      addresses.feeSplitVaultFactory,
      DEEP_V2_OFFICIAL_DEPENDENCIES.positionManager.address,
      DEEP_V2_OFFICIAL_DEPENDENCIES.poolManager.address,
      addresses.positionForwarderFactory,
      addresses.rangeSourceFactory,
      addresses.growthVaultImplementation,
    ],
    growthVaultImplementation: [addresses.growthVaultFactory],
    launcher: [
      DEEP_V2_OFFICIAL_DEPENDENCIES.poolManager.address,
      DEEP_V2_OFFICIAL_DEPENDENCIES.positionManager.address,
      DEEP_V2_OFFICIAL_DEPENDENCIES.tokenFactory.address,
      addresses.feeHook,
      addresses.feeSplitVaultFactory,
      addresses.rangeSourceFactory,
      addresses.growthVaultFactory,
      addresses.positionForwarderFactory,
      addresses.automation,
      addresses.positionPlanner,
    ],
    automation: [addresses.growthVaultFactory, addresses.launcher],
    positionPlanner: [],
  }[field];
  if (!values) throw new Error(`Unknown Deep V2 runtime binding ${field}`);
  return values.map((value) => padHex(value, { size: 32 }).toLowerCase());
}

/**
 * Reconstructs the expected deployed runtime from the reviewed artifact.
 * Immutable slots are accepted only when every slot group is internally
 * consistent and the complete multiset equals the reviewed constructor graph.
 */
export function assertDeepV2ArtifactRuntimeBinding(
  field,
  runtime,
  manifest,
  root,
) {
  const data = artifact(root, field);
  const template = data.deployedBytecode.object;
  if (
    typeof runtime !== "string" ||
    runtime.length !== template.length ||
    runtime === "0x"
  ) {
    throw new Error(`${field} runtime length does not match its artifact`);
  }
  const references = Object.values(
    data.deployedBytecode.immutableReferences ?? {},
  );
  const expectedWords = immutableExpectedAddresses(field, manifest).sort();
  if (references.length !== expectedWords.length) {
    throw new Error(`${field} immutable reference count changed`);
  }
  const runtimeBody = runtime.slice(2).toLowerCase();
  let reconstructed = template.slice(2).toLowerCase();
  const observedWords = [];
  for (const group of references) {
    if (
      !Array.isArray(group) ||
      group.length === 0 ||
      group.some(
        (reference) =>
          !Number.isSafeInteger(reference.start) ||
          reference.start < 0 ||
          reference.length !== 32,
      )
    ) {
      throw new Error(`${field} immutable references are malformed`);
    }
    const words = group.map(({ start, length }) =>
      runtimeBody.slice(start * 2, (start + length) * 2),
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
    throw new Error(`${field} runtime immutables do not match the reviewed graph`);
  }
  return keccak256(runtime);
}

export function computeDeepV2KeeperExecutorIdentity(
  root,
  automationAddress,
  automationRuntimeCodeHash,
) {
  const data = JSON.parse(
    readFileSync(
      path.join(
        root,
        "contracts/out/DeepKeeperExecutorV1.sol/DeepKeeperExecutorV1.json",
      ),
      "utf8",
    ),
  );
  const runtime = data.deployedBytecode.object;
  const references = Object.values(
    data.deployedBytecode.immutableReferences ?? {},
  ).flat();
  if (
    references.length === 0 ||
    references.some(
      (reference) =>
        !Number.isSafeInteger(reference.start) ||
        reference.start < 0 ||
        reference.length !== 32,
    )
  ) {
    throw new Error("Deep keeper executor immutable references are malformed");
  }
  const immutableWord = padHex(automationAddress, {
    size: 32,
  })
    .slice(2)
    .toLowerCase();
  let patched = runtime.slice(2).toLowerCase();
  for (const reference of references) {
    patched =
      patched.slice(0, reference.start * 2) +
      immutableWord +
      patched.slice((reference.start + reference.length) * 2);
  }
  const gasPolicyCommitment = hashAbi(
    Array.from({ length: 7 }, () => "uint256"),
    [8n, 150_000n, 700_000n, 220_000n, 450_000n, 25_000n, 25_000n],
  );
  const resultPolicyCommitment = keccak256(
    stringToHex(
      "one-result-per-candidate:fresh-assessment:skip-none-or-drift:bounded-per-action-call",
    ),
  );
  return Object.freeze({
    runtimeCodeHash: keccak256(`0x${patched}`),
    sourceCommitment: hashAbi(
      ["bytes32", "address", "bytes32", "bytes32", "bytes32"],
      [
        keccak256(data.bytecode.object),
        automationAddress,
        automationRuntimeCodeHash,
        gasPolicyCommitment,
        resultPolicyCommitment,
      ],
    ),
  });
}

export function computeDeepV2SourceCommitment(root) {
  const artifacts = Object.fromEntries(
    NEW_FIELDS.map((field) => [field, artifact(root, field)]),
  );
  const bytecodeCommitment = hashAbi(
    NEW_FIELDS.map(() => "bytes32"),
    NEW_FIELDS.map((field) =>
      keccak256(artifacts[field].bytecode.object),
    ),
  );
  const sharedCommitment = addressHashPairs([
    [
      DEEP_V2_SHARED_STACK.feeSplitVaultFactory,
      DEEP_V2_SHARED_RUNTIME_HASHES.feeSplitVaultFactory,
    ],
    [
      DEEP_V2_SHARED_STACK.hookFactory,
      DEEP_V2_SHARED_RUNTIME_HASHES.hookFactory,
    ],
    [
      DEEP_V2_SHARED_STACK.feeHook,
      DEEP_V2_SHARED_RUNTIME_HASHES.feeHook,
    ],
    [
      DEEP_V2_SHARED_STACK.rangeSourceFactory,
      DEEP_V2_SHARED_RUNTIME_HASHES.rangeSourceFactory,
    ],
  ]);
  const coreCommitment = addressHashPairs(
    ["poolManager", "positionManager", "stateView", "v4Quoter"].map(
      (field) => [
        DEEP_V2_OFFICIAL_DEPENDENCIES[field].address,
        DEEP_V2_OFFICIAL_DEPENDENCIES[field].runtimeCodeHash,
      ],
    ),
  );
  const routingCommitment = addressHashPairs(
    ["tokenFactory", "permit2", "universalRouter"].map((field) => [
      DEEP_V2_OFFICIAL_DEPENDENCIES[field].address,
      DEEP_V2_OFFICIAL_DEPENDENCIES[field].runtimeCodeHash,
    ]),
  );
  const lockingCommitment = hashAbi(
    ["address", "bytes32", "address"],
    [
      DEEP_V2_SHARED_STACK.positionForwarderFactory,
      DEEP_V2_SHARED_RUNTIME_HASHES.positionForwarderFactory,
      DEEP_V2_SHARED_STACK.treasury,
    ],
  );
  const dependencyCommitment = hashAbi(
    ["bytes32", "bytes32", "bytes32", "bytes32"],
    [
      sharedCommitment,
      coreCommitment,
      routingCommitment,
      lockingCommitment,
    ],
  );
  const marketPolicyCommitment = hashAbi(
    [
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "int256",
      "int256",
      "int256",
      "int256",
      "int256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
    ],
    [
      100n,
      90n,
      10n,
      0n,
      200n,
      204_200n,
      218_000n,
      -887_200n,
      887_200n,
      1_000_000_000n * 10n ** 18n,
      150_000_000n * 10n ** 18n,
      50_000_000_000_000_000n,
      600_000_000_000_000n,
    ],
  );
  const automationPolicyCommitment = hashAbi(
    Array.from({ length: 12 }, () => "uint256"),
    [
      2_000_000_000_000_000n,
      250_000_000_000_000_000n,
      300n,
      1_800n,
      8n,
      1_800n,
      600n,
      400n,
      25n,
      8_500n,
      192n,
      2_000_000_000_000_000n,
    ],
  );
  const policyCommitment = hashAbi(
    ["bytes32", "bytes32"],
    [marketPolicyCommitment, automationPolicyCommitment],
  );
  const securityCommitment = hashAbi(
    Array.from({ length: 7 }, () => "bytes32"),
    [
      "one-immutable-add-only-full-range-position",
      "v2-fixed-one-percent-ninety-ten-fee-split",
      "staged-192-observation-30-minute-twap",
      "fixed-window-start-trusted-depth-cap",
      "creator-bound-permanent-position-fee-forwarder",
      "permanently-locked-unused-reserve",
      "zero-admin-zero-withdrawal",
    ].map((value) => keccak256(stringToHex(value))),
  );
  return hashAbi(
    ["bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
    [
      keccak256(
        stringToHex(
          "programmable.deep.full-range.infrastructure.v2.ethereum",
        ),
      ),
      bytecodeCommitment,
      dependencyCommitment,
      policyCommitment,
      securityCommitment,
    ],
  );
}

export function buildDeepV2DeploymentPlan(deployer, startingNonce, root) {
  if (!isAddress(deployer) || !Number.isSafeInteger(startingNonce) || startingNonce < 0) {
    throw new Error("Deep V2 deployer and starting nonce are invalid");
  }
  const broadcaster = getAddress(deployer);
  const growthVaultFactory = getContractAddress({
    from: broadcaster,
    nonce: BigInt(startingNonce),
    opcode: "CREATE",
  });
  const launcher = getContractAddress({
    from: broadcaster,
    nonce: BigInt(startingNonce + 1),
    opcode: "CREATE",
  });
  return Object.freeze({
    transactionCount: 2,
    deployer: broadcaster,
    startingNonce,
    ...DEEP_V2_SHARED_STACK,
    growthVaultFactory,
    growthVaultImplementation: getContractAddress({
      from: growthVaultFactory,
      nonce: 1n,
      opcode: "CREATE",
    }),
    launcher,
    automation: getContractAddress({
      from: launcher,
      nonce: 1n,
      opcode: "CREATE",
    }),
    positionPlanner: getContractAddress({
      from: launcher,
      nonce: 2n,
      opcode: "CREATE",
    }),
    sourceCommitment: root
      ? computeDeepV2SourceCommitment(root)
      : undefined,
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

function exactSourceRecord(record, address, fqcn) {
  if (
    record?.status !== "exact-match" ||
    record?.fqcn !== fqcn ||
    typeof record?.encodedConstructorArguments !== "string" ||
    !/^0x([0-9a-fA-F]{2})*$/.test(record.encodedConstructorArguments) ||
    !isAddress(address ?? "")
  ) {
    return false;
  }
  return (
    record.etherscan?.status === "exact-match" &&
    record.etherscan.url ===
      `https://etherscan.io/address/${address}#code` &&
    record.sourcify?.status === "exact-match" &&
    record.sourcify.url ===
      `https://repo.sourcify.dev/contracts/full_match/1/${address}/`
  );
}

function exactDeploymentEvidence(manifest) {
  const evidence = manifest?.deploymentEvidence;
  const transactions = manifest?.transactions;
  const blocks = manifest?.deploymentBlocks;
  const factory = evidence?.growthVaultFactory;
  const launcher = evidence?.launcher;
  if (
    !validHash(transactions?.growthVaultFactory) ||
    !validHash(transactions?.launcher) ||
    transactions.growthVaultFactory === transactions.launcher ||
    !factory ||
    !launcher
  ) {
    return false;
  }
  const primary = [
    [factory, transactions.growthVaultFactory, blocks?.growthVaultFactory, 0],
    [launcher, transactions.launcher, blocks?.launcher, 1],
  ];
  if (
    !primary.every(
      ([entry, transactionHash, blockNumber, nonceOffset]) =>
        entry.receiptStatus === "success" &&
        entry.transactionHash === transactionHash &&
        entry.blockNumber === blockNumber &&
        entry.nonce === manifest.startingNonce + nonceOffset &&
        sameAddress(entry.from, manifest.addresses.deployer) &&
        entry.to === null &&
        entry.valueWei === "0" &&
        validHash(entry.blockHash) &&
        validHash(entry.transactionInputHash),
    )
  ) {
    return false;
  }
  for (const [field, parent] of [
    ["growthVaultImplementation", "growthVaultFactory"],
    ["automation", "launcher"],
    ["positionPlanner", "launcher"],
  ]) {
    const child = evidence?.[field];
    if (
      child?.receiptStatus !== "success" ||
      child.transactionHash !== transactions[parent] ||
      transactions[field] !== transactions[parent] ||
      child.blockNumber !== blocks[parent] ||
      blocks[field] !== blocks[parent] ||
      child.blockHash !== evidence[parent].blockHash
    ) {
      return false;
    }
  }
  return true;
}

function deterministicPlanMatches(manifest) {
  const candidate = manifest?.candidatePlan;
  if (
    !["reviewed-at-signing", "receipt-reconstructed"].includes(
      candidate?.status,
    ) ||
    !isAddress(candidate.deployer ?? "") ||
    !Number.isSafeInteger(candidate.startingNonce)
  ) {
    return false;
  }
  const plan = buildDeepV2DeploymentPlan(
    candidate.deployer,
    candidate.startingNonce,
  );
  return (
    candidate.startingNonce === manifest.startingNonce &&
    sameAddress(candidate.deployer, manifest.addresses?.deployer) &&
    ["growthVaultFactory", "growthVaultImplementation", "launcher", "automation", "positionPlanner"].every(
      (field) =>
        sameAddress(candidate[field], plan[field]) &&
        sameAddress(manifest.addresses?.[field], plan[field]),
    ) &&
    ["feeSplitVaultFactory", "hookFactory", "feeHook", "rangeSourceFactory"].every(
      (field) =>
        sameAddress(candidate[field], DEEP_V2_SHARED_STACK[field]) &&
        sameAddress(manifest.addresses?.[field], DEEP_V2_SHARED_STACK[field]),
    )
  );
}

function exactSourceVerification(manifest) {
  return (
    manifest?.sourceVerification?.status === "verified" &&
    NEW_FIELDS.every((field) =>
      exactSourceRecord(
        manifest.sourceVerification.contracts?.[field],
        manifest.addresses?.[field],
        DEEP_V2_ARTIFACTS[field].fqcn,
      ),
    ) &&
    exactSourceRecord(
      manifest.sourceVerification.contracts?.keeperExecutor,
      manifest.lifecycleEvidence?.keeperExecutor,
      "src/DeepKeeperExecutorV1.sol:DeepKeeperExecutorV1",
    )
  );
}

function validLifecycle(manifest) {
  const lifecycle = manifest?.lifecycleEvidence;
  return (
    lifecycle?.status === "verified-current-release" &&
    lifecycle.releaseEligible === true &&
    lifecycle.requiredRelease === "deep-full-range-v2" &&
    lifecycle.independentRpcCount === 2 &&
    lifecycle.evidencePath === DEEP_V2_LIFECYCLE_EVIDENCE_PATH &&
    isAddress(lifecycle.canaryToken ?? "") &&
    validHash(lifecycle.launchTransaction) &&
    validHash(lifecycle.oracleTransaction) &&
    validHash(lifecycle.feeProcessCompoundTransaction) &&
    new Set([
      lifecycle.launchTransaction,
      lifecycle.oracleTransaction,
      lifecycle.feeProcessCompoundTransaction,
    ]).size === 3 &&
    isAddress(lifecycle.keeperExecutor ?? "") &&
    validHash(lifecycle.keeperExecutorRuntimeCodeHash) &&
    validHash(lifecycle.keeperExecutorDeploymentTransaction) &&
    Number.isSafeInteger(lifecycle.keeperExecutorDeploymentBlock) &&
    lifecycle.keeperExecutorDeploymentBlock > 0 &&
    validHash(lifecycle.evidenceHash) &&
    lifecycle.noActionKeeperCycle?.status ===
      "verified-no-transaction" &&
    lifecycle.noActionKeeperCycle.outcome === "idle" &&
    lifecycle.noActionKeeperCycle.readyVaults === 0 &&
    lifecycle.noActionKeeperCycle.submittedTransaction === false &&
    Number.isSafeInteger(
      lifecycle.noActionKeeperCycle.observedAtBlock,
    ) &&
    lifecycle.noActionKeeperCycle.observedAtBlock > 0 &&
    validHash(lifecycle.noActionKeeperCycle.evidenceHash) &&
    lifecycle.actionableKeeperCycle?.status ===
      "verified-compound-confirmed" &&
    lifecycle.actionableKeeperCycle.outcome ===
      "confirmed-productive" &&
    Number.isSafeInteger(
      lifecycle.actionableKeeperCycle.readyVaults,
    ) &&
    lifecycle.actionableKeeperCycle.readyVaults > 0 &&
    Number.isSafeInteger(
      lifecycle.actionableKeeperCycle.successfulCandidates,
    ) &&
    lifecycle.actionableKeeperCycle.successfulCandidates > 0 &&
    lifecycle.actionableKeeperCycle.transactionHash ===
      lifecycle.feeProcessCompoundTransaction &&
    Number.isSafeInteger(
      lifecycle.actionableKeeperCycle.blockNumber,
    ) &&
    lifecycle.actionableKeeperCycle.blockNumber > 0 &&
    validHash(lifecycle.actionableKeeperCycle.evidenceHash)
  );
}

export function assessDeepV2LiveManifest(manifest) {
  const reasons = [];
  const require = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };
  require(
    manifest?.schemaVersion === 2 &&
      manifest.model === "deep" &&
      manifest.internalContractRelease ===
        "liquidity-growth-full-range-v2" &&
      manifest.releaseVersion === "deep-full-range-v2" &&
      manifest.releaseManifest === DEEP_V2_MANIFEST_PATH &&
      manifest.chainId === 1 &&
      manifest.transactionCount === 2,
    "V2 release identity",
  );
  require(
    manifest?.status ===
      "deployment-source-and-lifecycle-verified" &&
      manifest.releaseEligible === true &&
      COMMIT.test(manifest.releaseCommit ?? "") &&
      Number.isSafeInteger(manifest.startBlock) &&
      manifest.startBlock > 0 &&
      Array.isArray(manifest.blockers) &&
      manifest.blockers.length === 0,
    "final deployment status",
  );
  require(deterministicPlanMatches(manifest), "deterministic two-transaction plan");
  require(exactDeploymentEvidence(manifest), "two deployment receipts");
  require(
    NEW_FIELDS.every((field) =>
      validHash(manifest?.runtimeCodeHashes?.[field]),
    ),
    "V2 runtime hashes",
  );
  require(exactSourceVerification(manifest), "exact source verification");
  require(validLifecycle(manifest), "current-release lifecycle evidence");
  require(
    exactObject(manifest?.fixedPolicy, DEEP_V2_FIXED_POLICY),
    "fixed V2 policy",
  );
  require(
    manifest?.keeperPolicy?.status ===
      "verified-ready-disabled-by-default" &&
      manifest.keeperPolicy.enabled === false &&
      manifest.keeperPolicy.transactionSubmission === false &&
      sameAddress(
        manifest.keeperPolicy.coordinator,
        manifest.lifecycleEvidence?.keeperExecutor,
      ) &&
      manifest.keeperPolicy.coordinatorRuntimeCodeHash ===
        manifest.lifecycleEvidence?.keeperExecutorRuntimeCodeHash &&
      validHash(manifest.keeperPolicy.coordinatorSourceCommitment) &&
      sameAddress(
        manifest.keeperPolicy.automation,
        manifest.addresses?.automation,
      ) &&
      manifest.keeperPolicy.automationRuntimeCodeHash ===
        manifest.runtimeCodeHashes?.automation &&
      isAddress(manifest.keeperPolicy.signerAddress ?? "") &&
      manifest.keeperPolicy.signingBackend === "privy-policy-wallet" &&
      manifest.keeperPolicy.executionPath === "/api/ops/deep-v2-keeper" &&
      manifest.keeperPolicy.confirmations === 12 &&
      manifest.keeperPolicy.independentReadRpcCount === 2 &&
      manifest.keeperPolicy.intervalMilliseconds === 300_000 &&
      manifest.keeperPolicy.defaultMaxBatchSize === 4 &&
      manifest.keeperPolicy.defaultMaxGas === "4500000" &&
      manifest.keeperPolicy.maximumOperationalBatchSize === 8 &&
      manifest.keeperPolicy.extendedBatchMinimumGas === "9000000" &&
      manifest.keeperPolicy.vaultSubsidyCapWei ===
        "30000000000000000",
    "keeper release policy",
  );
  require(
    manifest?.activation?.appStatus === "ready" &&
      manifest.activation.keeperStatus === "ready" &&
      manifest.activation.requiresExactManifestMatch === true,
    "release activation",
  );
  return Object.freeze({ ready: reasons.length === 0, reasons });
}

export const deepV2NewDeploymentFields = NEW_FIELDS;
