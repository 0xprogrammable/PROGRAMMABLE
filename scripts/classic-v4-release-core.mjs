import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  getCreate2Address,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";
import {
  CLASSIC_V4_DIGEST_DOMAINS,
  digestJson,
} from "./classic-v4-digest.mjs";

export {
  CLASSIC_V4_DIGEST_DOMAINS,
  digestJson,
  stableStringify,
} from "./classic-v4-digest.mjs";

export const CLASSIC_V4_RELEASE = "classic-v4";
export const CLASSIC_V4_CHAIN_ID = 1;
export const CLASSIC_V4_CHAIN_ID_HEX = "0x1";
export const CLASSIC_V4_FINALITY_CONFIRMATIONS = 12;
export const CLASSIC_V4_REQUIRED_HOOK_FLAGS = 12_236n;
export const CLASSIC_V4_HOOK_ADDRESS_MASK = (1n << 14n) - 1n;
export const CLASSIC_V4_MAX_HOOK_SALT = 160_444n;
export const CLASSIC_V4_SOLC_VERSION = "0.8.26+commit.8a97fa7a";
export const CLASSIC_V4_LAUNCHER_FEE_RECIPIENT =
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const CLASSIC_V4_EXPECTED_CTO_AUTHORITY_OWNER =
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E";

export const CLASSIC_V4_OFFICIAL_DEPENDENCIES = Object.freeze({
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
  uerc20Factory: Object.freeze({
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

export const CLASSIC_V4_SHARED_DEPENDENCIES = Object.freeze({
  ctoAuthority: Object.freeze({
    address: "0x9746469Cd79fdDc5aA7218e7dd51c829ee518c0C",
    runtimeCodeHash:
      "0x7beafb575fba4ffce22da7b3f927df8248eebc6c33e77cb43ed967a91a36984c",
  }),
  rewardVaultFactory: Object.freeze({
    address: "0xF28967f9DFaC3Ca21384b59D6D75C8106b3eab2a",
    runtimeCodeHash:
      "0x874ec76f396807bfcbbdd88cc2fd534f10201242ad0479a05fe5d2ee937616ee",
  }),
  initialBuyVestingWalletFactory: Object.freeze({
    address: "0xDe21b9c0Cc0AfDB9be20e8236113f066BB8C66f4",
    runtimeCodeHash:
      "0x13b7578a8abd0bc0ba724b5815d9bd0aff0d07c2677c00d2577004e8c1f6d5f4",
  }),
  launchPolicy: Object.freeze({
    address: "0x53a4d1E6ab184389D3581085AB73CD3549B20d1a",
    runtimeCodeHash:
      "0xb6b31b6cf326784774e13f6d60f9b251dde118469a506fa3b1c124c9f11b49be",
  }),
  positionForwarderFactory: Object.freeze({
    address: "0x291a9ff1059d225d02B1659430804486404dB507",
    runtimeCodeHash:
      "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2",
  }),
});

export const CLASSIC_V4_ARTIFACT_PATHS = Object.freeze({
  hookFactory:
    "EthCreatorFeeHookFactoryV4.sol/EthCreatorFeeHookFactoryV4.json",
  feeHook: "EthCreatorFeeHookV4.sol/EthCreatorFeeHookV4.json",
  positionPlanner:
    "ClassicPositionPlannerV1.sol/ClassicPositionPlannerV1.json",
  graduationVault:
    "ClassicGraduationVaultV1.sol/ClassicGraduationVaultV1.json",
  graduationVaultFactory:
    "ClassicGraduationVaultFactoryV1.sol/ClassicGraduationVaultFactoryV1.json",
  launcher: "MemeLaunchV3.sol/MemeLaunchV3.json",
});

export const CLASSIC_V4_SOURCE_TARGETS = Object.freeze({
  hookFactory: Object.freeze({
    contractName: "EthCreatorFeeHookFactoryV4",
    fqcn: "src/EthCreatorFeeHookFactoryV4.sol:EthCreatorFeeHookFactoryV4",
  }),
  feeHook: Object.freeze({
    contractName: "EthCreatorFeeHookV4",
    fqcn: "src/EthCreatorFeeHookV4.sol:EthCreatorFeeHookV4",
  }),
  positionPlanner: Object.freeze({
    contractName: "ClassicPositionPlannerV1",
    fqcn: "src/ClassicPositionPlannerV1.sol:ClassicPositionPlannerV1",
  }),
  graduationVaultFactory: Object.freeze({
    contractName: "ClassicGraduationVaultFactoryV1",
    fqcn:
      "src/ClassicGraduationVaultFactoryV1.sol:ClassicGraduationVaultFactoryV1",
  }),
  launcher: Object.freeze({
    contractName: "MemeLaunchV3",
    fqcn: "src/MemeLaunchV3.sol:MemeLaunchV3",
  }),
});

export const CLASSIC_V4_NEW_CONTRACTS = Object.freeze([
  "hookFactory",
  "feeHook",
  "positionPlanner",
  "graduationVaultFactory",
  "launcher",
]);

export const CLASSIC_V4_BUILD_CONTRACTS = Object.freeze([
  "hookFactory",
  "feeHook",
  "positionPlanner",
  "graduationVault",
  "graduationVaultFactory",
  "launcher",
]);

export const CLASSIC_V4_LIFECYCLE_ACTIONS = Object.freeze([
  "launch",
  "buyExactInput",
  "buyExactOutput",
  "sellExactInput",
  "sellExactOutput",
  "creatorClaim",
  "launcherClaim",
]);

export const CLASSIC_V4_INDEXER_LAUNCHER_EVENTS = Object.freeze([
  "MemeTokenLaunchedV2",
  "MemeLiquidityConfiguredV2",
  "MemeCreatorInitialBuyV2",
  "MemeCreatorInitialBuyCustodyV2",
  "MemeBondingConfiguredV1",
]);

export const CLASSIC_V4_INDEXER_HOOK_EVENTS = Object.freeze([
  "PoolRegistered",
  "PoolFeeDisclosure",
  "NativeSwapFeesAccrued",
  "CreatorFeesClaimed",
  "LauncherFeesClaimed",
  "ClassicBondingConfigured",
  "ClassicBondingPositionActivated",
  "ClassicBondingReached",
  "ClassicGraduationBegun",
  "ClassicLiquidityGraduated",
]);

const hookFactoryAbi = parseAbi([
  "function deploy(bytes32 salt,address poolManager,address launcherFeeRecipient,address feeSplitVaultFactory) returns (address hook)",
]);
const classicV4LauncherAbi = parseAbi([
  "function launch((string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint8 liquidityPreset,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters) payable returns ((address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash) result)",
]);
const classicV4UniversalRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
const classicV4CreatorClaimAbi = parseAbi(["function claim() returns (uint256)"]);
const classicV4LauncherClaimAbi = parseAbi([
  "function claimLauncherFees() returns (uint256)",
]);
const CLASSIC_V4_POOL_KEY_TYPE = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
};
const CLASSIC_V4_EXACT_INPUT_SINGLE_TYPE = {
  type: "tuple",
  components: [
    { name: "poolKey", ...CLASSIC_V4_POOL_KEY_TYPE },
    { name: "zeroForOne", type: "bool" },
    { name: "amountIn", type: "uint128" },
    { name: "amountOutMinimum", type: "uint128" },
    { name: "hookData", type: "bytes" },
  ],
};
const CLASSIC_V4_EXACT_OUTPUT_SINGLE_TYPE = {
  type: "tuple",
  components: [
    { name: "poolKey", ...CLASSIC_V4_POOL_KEY_TYPE },
    { name: "zeroForOne", type: "bool" },
    { name: "amountOut", type: "uint128" },
    { name: "amountInMaximum", type: "uint128" },
    { name: "hookData", type: "bytes" },
  ],
};

const OFFICIAL_DEPENDENCY_COMPONENTS = [
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "bytes32" },
];
const SHARED_INPUT_COMPONENTS = Array.from({ length: 5 }, () => ({
  type: "address",
}));
const SHARED_HASH_COMPONENTS = Array.from({ length: 5 }, () => ({
  type: "bytes32",
}));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalizeHex(value) {
  return String(value ?? "").toLowerCase();
}

export function canonicalAddress(value, label = "address") {
  try {
    return getAddress(String(value).toLowerCase());
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

export function canonicalNonzeroAddress(value, label = "address") {
  const address = canonicalAddress(value, label);
  assert(BigInt(address) !== 0n, `Invalid ${label}`);
  return address;
}

export function assertBytes32(value, label = "bytes32") {
  assert(
    typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value),
    `Invalid ${label}`,
  );
  return value.toLowerCase();
}

export function assertTransactionHash(value, label = "transaction hash") {
  return assertBytes32(value, label);
}

function assertCommit(value, label = "release commit") {
  assert(
    typeof value === "string" &&
      /^[0-9a-f]{40}$/i.test(value) &&
      value !== "0".repeat(40),
    `Invalid ${label}`,
  );
  return value.toLowerCase();
}

function assertNonNegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `Invalid ${label}`);
  return value;
}

function assertIsoTimestamp(value, label) {
  const timestamp = Date.parse(value);
  assert(
    typeof value === "string" &&
      !Number.isNaN(timestamp) &&
      new Date(timestamp).toISOString() === value,
    `Invalid ${label}`,
  );
  return value;
}

function creationCode(artifact, label) {
  const bytecode = artifact?.bytecode?.object;
  assert(
    typeof bytecode === "string" && /^0x[0-9a-f]+$/i.test(bytecode),
    `${label} creation bytecode is unavailable`,
  );
  return bytecode;
}

function runtimeCode(artifact, label) {
  const bytecode = artifact?.deployedBytecode?.object;
  assert(
    typeof bytecode === "string" && /^0x[0-9a-f]+$/i.test(bytecode),
    `${label} runtime bytecode is unavailable`,
  );
  return bytecode;
}

function immutableRanges(artifact) {
  return Object.values(
    artifact?.deployedBytecode?.immutableReferences ?? {},
  ).flat();
}

export function normalizeRuntimeImmutables(bytecode, artifact) {
  assert(
    typeof bytecode === "string" && /^0x[0-9a-f]+$/i.test(bytecode),
    "Invalid runtime bytecode",
  );
  const bytes = bytecode.slice(2).toLowerCase().split("");
  for (const reference of immutableRanges(artifact)) {
    assert(
      Number.isSafeInteger(reference?.start) &&
        Number.isSafeInteger(reference?.length) &&
        reference.start >= 0 &&
        reference.length > 0 &&
        (reference.start + reference.length) * 2 <= bytes.length,
      "Invalid artifact immutable reference",
    );
    bytes.fill(
      "0",
      reference.start * 2,
      (reference.start + reference.length) * 2,
    );
  }
  return `0x${bytes.join("")}`;
}

export function artifactRuntimeDescriptor(artifact, label) {
  const runtime = runtimeCode(artifact, label);
  const normalized = normalizeRuntimeImmutables(runtime, artifact);
  return {
    bytes: (runtime.length - 2) / 2,
    creationCodeHash: keccak256(creationCode(artifact, label)),
    runtimeTemplateHash: keccak256(normalized),
    immutableReferenceCount: immutableRanges(artifact).length,
  };
}

function classicV4ArtifactOutputPaths(outputDirectory) {
  const root = path.resolve(outputDirectory);
  return Object.fromEntries(
    Object.entries(CLASSIC_V4_ARTIFACT_PATHS).map(([name, relativePath]) => [
      name,
      path.join(root, relativePath),
    ]),
  );
}

function validatedArtifactMetadata(artifact, name) {
  let metadata;
  try {
    metadata =
      typeof artifact.metadata === "string"
        ? JSON.parse(artifact.metadata)
        : artifact.metadata;
  } catch {
    throw new Error(`${name} artifact metadata is invalid`);
  }
  assert(
    metadata?.compiler?.version === CLASSIC_V4_SOLC_VERSION &&
      metadata?.settings?.optimizer?.enabled === true &&
      metadata?.settings?.optimizer?.runs === 1_000 &&
      metadata?.settings?.evmVersion === "cancun" &&
      metadata?.settings?.metadata?.bytecodeHash === "none" &&
      metadata?.settings?.metadata?.appendCBOR === false,
    `${name} artifact compiler settings differ from the reviewed release`,
  );
  assert(
    metadata.sources && typeof metadata.sources === "object",
    `${name} artifact source closure is unavailable`,
  );
  return metadata;
}

export async function loadClassicV4ArtifactsFromOutput(outputDirectory) {
  const artifactPaths = classicV4ArtifactOutputPaths(outputDirectory);
  const artifacts = Object.fromEntries(
    await Promise.all(
      Object.entries(artifactPaths).map(
        async ([name, artifactPath]) => [
          name,
          JSON.parse(await readFile(artifactPath, "utf8")),
        ],
      ),
    ),
  );
  for (const [name, artifact] of Object.entries(artifacts)) {
    validatedArtifactMetadata(artifact, name);
  }
  return artifacts;
}

export function computeClassicV4BuildCommitments(artifacts) {
  assertExactKeys(artifacts, CLASSIC_V4_BUILD_CONTRACTS, "build artifacts");
  const sources = new Map();
  const artifactDescriptors = {};
  for (const name of CLASSIC_V4_BUILD_CONTRACTS) {
    const artifact = artifacts[name];
    const metadata = validatedArtifactMetadata(artifact, name);
    artifactDescriptors[name] = artifactRuntimeDescriptor(artifact, name);
    for (const [sourcePath, source] of Object.entries(metadata.sources)) {
      assert(
        /^(?:src|lib\/[a-z0-9-]+)\/[A-Za-z0-9_./-]+\.sol$/.test(
          sourcePath,
        ) &&
          !sourcePath.split("/").includes(".."),
        `${name} artifact contains an invalid source path`,
      );
      const sourceHash = assertNonzeroBytes32(
        source?.keccak256,
        `${sourcePath} source hash`,
      );
      assert(
        !sources.has(sourcePath) || sources.get(sourcePath) === sourceHash,
        `${sourcePath} source hash differs across artifacts`,
      );
      sources.set(sourcePath, sourceHash);
    }
  }
  const dependencySources = [...sources]
    .filter(([sourcePath]) => sourcePath.startsWith("lib/"))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourcePath, sourceHash]) => ({ sourcePath, sourceHash }));
  assert(
    dependencySources.length > 0,
    "Classic V4 dependency source closure is empty",
  );
  return {
    buildArtifactsDigest: digestJson(
      artifactDescriptors,
      CLASSIC_V4_DIGEST_DOMAINS.buildArtifacts,
    ),
    dependencyClosureDigest: digestJson(
      dependencySources,
      CLASSIC_V4_DIGEST_DOMAINS.dependencyClosure,
    ),
    dependencySourceCount: dependencySources.length,
    dependencyRoots: [
      ...new Set(
        dependencySources.map(({ sourcePath }) => sourcePath.split("/")[1]),
      ),
    ].sort(),
  };
}

function officialDependencyTuple(dependencies) {
  const values = Object.values(dependencies);
  assert(values.length === 7, "Expected seven official dependencies");
  return [
    ...values.map((entry) => canonicalAddress(entry.address)),
    ...values.map((entry) => assertBytes32(entry.runtimeCodeHash)),
  ];
}

function sharedInputTuple(sharedDependencies) {
  const values = Object.values(sharedDependencies);
  assert(values.length === 5, "Expected five shared dependencies");
  return values.map((entry) => canonicalAddress(entry.address));
}

function sharedHashTuple(sharedDependencies) {
  return Object.values(sharedDependencies).map((entry) =>
    assertBytes32(entry.runtimeCodeHash),
  );
}

export function computeClassicV4EconomicsCommitment() {
  const feeCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "int256" },
        { type: "bytes32" },
      ],
      [
        10n,
        10n,
        1_000n,
        10n,
        0n,
        0n,
        200n,
        keccak256(stringToHex("immutable-directional-buy-and-sell-fees")),
      ],
    ),
  );
  const liquidityCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "int256" },
        { type: "int256" },
        { type: "int256" },
        { type: "int256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        1_000_000_000n * 10n ** 18n,
        800_000_000n * 10n ** 18n,
        200_000_000n * 10n ** 18n,
        204_200n,
        174_800n,
        9_800n,
        225_200n,
        0n,
        1n,
        keccak256(
          stringToHex(
            "standard-or-bonding-same-pool-with-ownerless-one-shot-graduation",
          ),
        ),
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [feeCommitment, liquidityCommitment],
    ),
  );
}

export function computeClassicV4SourceCommitment(
  artifacts,
  {
    officialDependencies = CLASSIC_V4_OFFICIAL_DEPENDENCIES,
    sharedDependencies = CLASSIC_V4_SHARED_DEPENDENCIES,
    launcherFeeRecipient = CLASSIC_V4_LAUNCHER_FEE_RECIPIENT,
  } = {},
) {
  const bytecodeCommitment = keccak256(
    encodeAbiParameters(
      Array.from({ length: CLASSIC_V4_BUILD_CONTRACTS.length }, () => ({
        type: "bytes32",
      })),
      CLASSIC_V4_BUILD_CONTRACTS.map((name) =>
        keccak256(creationCode(artifacts[name], name)),
      ),
    ),
  );
  const dependencyCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "tuple", components: OFFICIAL_DEPENDENCY_COMPONENTS },
        { type: "tuple", components: SHARED_INPUT_COMPONENTS },
        { type: "tuple", components: SHARED_HASH_COMPONENTS },
        { type: "address" },
      ],
      [
        1n,
        officialDependencyTuple(officialDependencies),
        sharedInputTuple(sharedDependencies),
        sharedHashTuple(sharedDependencies),
        canonicalAddress(launcherFeeRecipient),
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      Array.from({ length: 4 }, () => ({ type: "bytes32" })),
      [
        keccak256(
          stringToHex("programmable.classic.infrastructure.v4.ethereum"),
        ),
        bytecodeCommitment,
        dependencyCommitment,
        computeClassicV4EconomicsCommitment(),
      ],
    ),
  );
}

function mineHookAddress(factory, initCode, occupiedAddresses = []) {
  const occupied = new Set(occupiedAddresses.map(normalizeHex));
  const bytecodeHash = keccak256(initCode);
  for (let salt = 0n; salt < CLASSIC_V4_MAX_HOOK_SALT; salt += 1n) {
    const encodedSalt = `0x${salt.toString(16).padStart(64, "0")}`;
    const address = getCreate2Address({
      from: factory,
      salt: encodedSalt,
      bytecodeHash,
    });
    if (
      (BigInt(address) & CLASSIC_V4_HOOK_ADDRESS_MASK) ===
        CLASSIC_V4_REQUIRED_HOOK_FLAGS &&
      !occupied.has(normalizeHex(address))
    ) {
      return { address, salt: encodedSalt, initCodeHash: bytecodeHash };
    }
  }
  throw new Error("No vacant Classic V4 hook salt found");
}

export function buildClassicV4PreparationPlan({
  artifacts,
  deployer,
  startingNonce,
  releaseCommit,
  releaseTree,
  repositoryClean,
  observedAtBlock,
  observedAtBlockHash,
  preflight,
  occupiedAddresses = [],
}) {
  assert(
    repositoryClean === true,
    "Release preparation requires a clean worktree",
  );
  const canonicalDeployer = canonicalNonzeroAddress(deployer, "deployer");
  const nonce = assertNonNegativeInteger(startingNonce, "starting nonce");
  const commit = assertCommit(releaseCommit);
  const tree = assertCommit(releaseTree, "release tree");
  assertNonNegativeInteger(observedAtBlock, "observed block");
  assertBytes32(observedAtBlockHash, "observed block hash");

  const hookFactory = getContractAddress({
    from: canonicalDeployer,
    nonce: BigInt(nonce),
  });
  const hookConstructorArguments = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [
      CLASSIC_V4_OFFICIAL_DEPENDENCIES.poolManager.address,
      CLASSIC_V4_LAUNCHER_FEE_RECIPIENT,
      CLASSIC_V4_SHARED_DEPENDENCIES.rewardVaultFactory.address,
    ],
  );
  const hookInitCode =
    creationCode(artifacts.feeHook, "feeHook") +
    hookConstructorArguments.slice(2);
  const minedHook = mineHookAddress(
    hookFactory,
    hookInitCode,
    occupiedAddresses,
  );
  const positionPlanner = getContractAddress({
    from: canonicalDeployer,
    nonce: BigInt(nonce + 2),
  });
  const graduationVaultFactory = getContractAddress({
    from: canonicalDeployer,
    nonce: BigInt(nonce + 3),
  });
  const launcher = getContractAddress({
    from: canonicalDeployer,
    nonce: BigInt(nonce + 4),
  });
  const graduationVaultFactoryConstructorArguments = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [
      CLASSIC_V4_OFFICIAL_DEPENDENCIES.positionManager.address,
      CLASSIC_V4_SHARED_DEPENDENCIES.positionForwarderFactory.address,
    ],
  );
  const launcherConstructorArguments = encodeAbiParameters(
    Array.from({ length: 10 }, () => ({ type: "address" })),
    [
      CLASSIC_V4_OFFICIAL_DEPENDENCIES.poolManager.address,
      CLASSIC_V4_OFFICIAL_DEPENDENCIES.positionManager.address,
      CLASSIC_V4_OFFICIAL_DEPENDENCIES.uerc20Factory.address,
      minedHook.address,
      positionPlanner,
      CLASSIC_V4_SHARED_DEPENDENCIES.rewardVaultFactory.address,
      CLASSIC_V4_SHARED_DEPENDENCIES.initialBuyVestingWalletFactory.address,
      CLASSIC_V4_SHARED_DEPENDENCIES.launchPolicy.address,
      CLASSIC_V4_SHARED_DEPENDENCIES.positionForwarderFactory.address,
      graduationVaultFactory,
    ],
  );
  const transactionData = {
    hookFactory: creationCode(artifacts.hookFactory, "hookFactory"),
    feeHook: encodeFunctionData({
      abi: hookFactoryAbi,
      functionName: "deploy",
      args: [
        minedHook.salt,
        CLASSIC_V4_OFFICIAL_DEPENDENCIES.poolManager.address,
        CLASSIC_V4_LAUNCHER_FEE_RECIPIENT,
        CLASSIC_V4_SHARED_DEPENDENCIES.rewardVaultFactory.address,
      ],
    }),
    positionPlanner: creationCode(artifacts.positionPlanner, "positionPlanner"),
    graduationVaultFactory:
      creationCode(artifacts.graduationVaultFactory, "graduationVaultFactory") +
      graduationVaultFactoryConstructorArguments.slice(2),
    launcher:
      creationCode(artifacts.launcher, "launcher") +
      launcherConstructorArguments.slice(2),
  };
  const constructorArguments = {
    hookFactory: "0x",
    feeHook: hookConstructorArguments,
    positionPlanner: "0x",
    graduationVaultFactory: graduationVaultFactoryConstructorArguments,
    launcher: launcherConstructorArguments,
  };
  const addresses = {
    hookFactory,
    feeHook: minedHook.address,
    positionPlanner,
    graduationVaultFactory,
    launcher,
  };
  const transactionTypes = {
    hookFactory: "CREATE",
    feeHook: "CALL_CREATE2",
    positionPlanner: "CREATE",
    graduationVaultFactory: "CREATE",
    launcher: "CREATE",
  };
  const transactions = CLASSIC_V4_NEW_CONTRACTS.map((name, index) => ({
    name,
    transactionType: transactionTypes[name],
    from: canonicalDeployer,
    to: name === "feeHook" ? hookFactory : null,
    nonce: nonce + index,
    value: "0",
    predictedAddress: addresses[name],
    data: transactionData[name],
    dataHash: keccak256(transactionData[name]),
  }));
  const runtimeTemplates = Object.fromEntries(
    CLASSIC_V4_NEW_CONTRACTS.map((name) => [
      name,
      artifactRuntimeDescriptor(artifacts[name], name),
    ]),
  );
  for (const [name, descriptor] of Object.entries(runtimeTemplates)) {
    assert(
      descriptor.bytes <= 24_576,
      `${name} exceeds the EIP-170 runtime limit`,
    );
  }
  assert(
    runtimeTemplates.launcher.bytes <= 24_000,
    "launcher exceeds the reviewed runtime budget",
  );
  const sourceCommitment = computeClassicV4SourceCommitment(artifacts);
  const unsignedPlan = {
    schemaVersion: 1,
    status: "simulation-only",
    model: "classic",
    internalContractRelease: CLASSIC_V4_RELEASE,
    chainId: CLASSIC_V4_CHAIN_ID,
    releaseCommit: commit,
    releaseTree: tree,
    sourceCommitment,
    preflight,
    deployer: canonicalDeployer,
    startingNonce: nonce,
    observedAtBlock,
    observedAtBlockHash: observedAtBlockHash.toLowerCase(),
    predictedAddresses: addresses,
    hookSalt: minedHook.salt,
    hookInitCodeHash: minedHook.initCodeHash,
    launcherFeeRecipient: CLASSIC_V4_LAUNCHER_FEE_RECIPIENT,
    officialDependencies: CLASSIC_V4_OFFICIAL_DEPENDENCIES,
    sharedDependencies: CLASSIC_V4_SHARED_DEPENDENCIES,
    runtimeTemplates,
    constructorArguments,
    transactions,
    executionBoundary: {
      signs: false,
      broadcasts: false,
      writes: false,
      ownerApprovalRequiredForDeployment: true,
    },
  };
  return {
    ...unsignedPlan,
    planDigest: digestJson(
      unsignedPlan,
      CLASSIC_V4_DIGEST_DOMAINS.preparationPlan,
    ),
  };
}

export function validateClassicV4PreparationPlan(plan, artifacts) {
  assertExactKeys(
    plan,
    [
      "schemaVersion",
      "status",
      "model",
      "internalContractRelease",
      "chainId",
      "releaseCommit",
      "releaseTree",
      "sourceCommitment",
      "preflight",
      "deployer",
      "startingNonce",
      "observedAtBlock",
      "observedAtBlockHash",
      "predictedAddresses",
      "hookSalt",
      "hookInitCodeHash",
      "launcherFeeRecipient",
      "officialDependencies",
      "sharedDependencies",
      "runtimeTemplates",
      "constructorArguments",
      "transactions",
      "executionBoundary",
      "planDigest",
    ],
    "Classic V4 plan",
  );
  assert(plan?.schemaVersion === 1, "Classic V4 plan schema is invalid");
  assert(
    plan?.status === "simulation-only" &&
      plan?.model === "classic" &&
      plan?.internalContractRelease === CLASSIC_V4_RELEASE &&
      plan?.chainId === 1,
    "Classic V4 plan identity is invalid",
  );
  const deployer = canonicalNonzeroAddress(plan.deployer, "plan deployer");
  const nonce = assertNonNegativeInteger(
    plan.startingNonce,
    "plan starting nonce",
  );
  assertNonNegativeInteger(plan.observedAtBlock, "plan observed block");
  assert(plan.observedAtBlock > 0, "Plan observed block must be positive");
  assertNonzeroBytes32(plan.observedAtBlockHash, "plan observed block hash");
  assertCommit(plan.releaseCommit);
  assertCommit(plan.releaseTree, "plan release tree");
  assertBytes32(plan.hookSalt, "plan hook salt");
  assertBytes32(plan.hookInitCodeHash, "plan hook init code hash");
  assertBytes32(plan.planDigest, "plan digest");
  assertExactKeys(
    plan.preflight,
    [
      "independentRpcCount",
      "freshDeterministicBuild",
      "compilerVersion",
      "evmVersion",
      "optimizerRuns",
      "metadataBytecodeHash",
      "officialDependencyRuntimeVerified",
      "sharedDependencyRuntimeVerified",
      "sharedDependencyBindingsVerified",
      "predictedAddressesVacant",
      "deployerNonceReconciled",
      "foundryEnvironmentSanitized",
      "freshControlledOutput",
      "sourcePinsVerified",
      "sourcePinsDigest",
      "buildArtifactsDigest",
      "dependencyClosureDigest",
      "dependencySourceCount",
      "dependencyRoots",
    ],
    "preflight",
  );
  assert(
    plan.preflight.independentRpcCount === 2 &&
      plan.preflight.freshDeterministicBuild === true &&
      plan.preflight.compilerVersion === CLASSIC_V4_SOLC_VERSION &&
      plan.preflight.evmVersion === "cancun" &&
      plan.preflight.optimizerRuns === 1_000 &&
      plan.preflight.metadataBytecodeHash === "none" &&
      plan.preflight.officialDependencyRuntimeVerified === true &&
      plan.preflight.sharedDependencyRuntimeVerified === true &&
      plan.preflight.sharedDependencyBindingsVerified === true &&
      plan.preflight.predictedAddressesVacant === true &&
      plan.preflight.deployerNonceReconciled === true &&
      plan.preflight.foundryEnvironmentSanitized === true &&
      plan.preflight.freshControlledOutput === true &&
      plan.preflight.sourcePinsVerified === true,
    "Classic V4 preflight is incomplete",
  );
  assertNonzeroBytes32(plan.preflight.sourcePinsDigest, "source pins digest");
  const buildCommitments = computeClassicV4BuildCommitments(artifacts);
  assert(
    normalizeHex(plan.preflight.buildArtifactsDigest) ===
      normalizeHex(buildCommitments.buildArtifactsDigest) &&
      normalizeHex(plan.preflight.dependencyClosureDigest) ===
        normalizeHex(buildCommitments.dependencyClosureDigest) &&
      plan.preflight.dependencySourceCount ===
        buildCommitments.dependencySourceCount &&
      Array.isArray(plan.preflight.dependencyRoots) &&
      plan.preflight.dependencyRoots.length ===
        buildCommitments.dependencyRoots.length &&
      plan.preflight.dependencyRoots.every(
        (root, index) => root === buildCommitments.dependencyRoots[index],
      ),
    "Classic V4 build or dependency closure differs",
  );
  const computedSourceCommitment = computeClassicV4SourceCommitment(artifacts);
  assert(
    normalizeHex(plan.sourceCommitment) ===
      normalizeHex(computedSourceCommitment),
    "Classic V4 plan source commitment differs from current artifacts",
  );
  assert(
    normalizeHex(plan.launcherFeeRecipient) ===
      normalizeHex(CLASSIC_V4_LAUNCHER_FEE_RECIPIENT),
    "Classic V4 plan treasury differs",
  );
  for (const [groupName, expectedGroup] of [
    ["officialDependencies", CLASSIC_V4_OFFICIAL_DEPENDENCIES],
    ["sharedDependencies", CLASSIC_V4_SHARED_DEPENDENCIES],
  ]) {
    assertExactKeys(plan[groupName], Object.keys(expectedGroup), groupName);
    for (const [name, expected] of Object.entries(expectedGroup)) {
      const actual = plan[groupName][name];
      assert(
        normalizeHex(actual?.address) === normalizeHex(expected.address) &&
          normalizeHex(actual?.runtimeCodeHash) ===
            normalizeHex(expected.runtimeCodeHash),
        `Classic V4 plan drifted at ${groupName}.${name}`,
      );
    }
  }
  const hookFactory = getContractAddress({
    from: deployer,
    nonce: BigInt(nonce),
  });
  const positionPlanner = getContractAddress({
    from: deployer,
    nonce: BigInt(nonce + 2),
  });
  const graduationVaultFactory = getContractAddress({
    from: deployer,
    nonce: BigInt(nonce + 3),
  });
  const launcher = getContractAddress({
    from: deployer,
    nonce: BigInt(nonce + 4),
  });
  const hookConstructorArguments = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [
      CLASSIC_V4_OFFICIAL_DEPENDENCIES.poolManager.address,
      CLASSIC_V4_LAUNCHER_FEE_RECIPIENT,
      CLASSIC_V4_SHARED_DEPENDENCIES.rewardVaultFactory.address,
    ],
  );
  const hookInitCode =
    creationCode(artifacts.feeHook, "feeHook") +
    hookConstructorArguments.slice(2);
  const hookInitCodeHash = keccak256(hookInitCode);
  assert(
    normalizeHex(plan.hookInitCodeHash) === normalizeHex(hookInitCodeHash),
    "Classic V4 plan hook init code hash differs",
  );
  const feeHook = getCreate2Address({
    from: hookFactory,
    salt: plan.hookSalt,
    bytecodeHash: hookInitCodeHash,
  });
  assert(
    (BigInt(feeHook) & CLASSIC_V4_HOOK_ADDRESS_MASK) ===
      CLASSIC_V4_REQUIRED_HOOK_FLAGS,
    "Classic V4 plan hook flags differ",
  );
  const expectedAddresses = {
    hookFactory,
    feeHook,
    positionPlanner,
    graduationVaultFactory,
    launcher,
  };
  assertExactKeys(
    plan.predictedAddresses,
    CLASSIC_V4_NEW_CONTRACTS,
    "predicted addresses",
  );
  assertExactKeys(
    plan.runtimeTemplates,
    CLASSIC_V4_NEW_CONTRACTS,
    "runtime templates",
  );
  for (const name of CLASSIC_V4_NEW_CONTRACTS) {
    assert(
      normalizeHex(plan.predictedAddresses[name]) ===
        normalizeHex(expectedAddresses[name]),
      `Classic V4 plan predicted ${name} address differs`,
    );
    const expectedRuntime = artifactRuntimeDescriptor(artifacts[name], name);
    assertExactKeys(
      plan.runtimeTemplates[name],
      [
        "creationCodeHash",
        "runtimeTemplateHash",
        "bytes",
        "immutableReferenceCount",
      ],
      `${name} runtime template`,
    );
    assert(
      normalizeHex(plan.runtimeTemplates?.[name]?.creationCodeHash) ===
        normalizeHex(expectedRuntime.creationCodeHash) &&
        normalizeHex(plan.runtimeTemplates?.[name]?.runtimeTemplateHash) ===
          normalizeHex(expectedRuntime.runtimeTemplateHash) &&
        plan.runtimeTemplates?.[name]?.bytes === expectedRuntime.bytes &&
        plan.runtimeTemplates?.[name]?.immutableReferenceCount ===
          expectedRuntime.immutableReferenceCount,
      `Classic V4 plan ${name} artifact descriptor differs`,
    );
  }
  const graduationVaultFactoryArguments = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [
      CLASSIC_V4_OFFICIAL_DEPENDENCIES.positionManager.address,
      CLASSIC_V4_SHARED_DEPENDENCIES.positionForwarderFactory.address,
    ],
  );
  const launcherArguments = encodeAbiParameters(
    Array.from({ length: 10 }, () => ({ type: "address" })),
    [
      CLASSIC_V4_OFFICIAL_DEPENDENCIES.poolManager.address,
      CLASSIC_V4_OFFICIAL_DEPENDENCIES.positionManager.address,
      CLASSIC_V4_OFFICIAL_DEPENDENCIES.uerc20Factory.address,
      feeHook,
      positionPlanner,
      CLASSIC_V4_SHARED_DEPENDENCIES.rewardVaultFactory.address,
      CLASSIC_V4_SHARED_DEPENDENCIES.initialBuyVestingWalletFactory.address,
      CLASSIC_V4_SHARED_DEPENDENCIES.launchPolicy.address,
      CLASSIC_V4_SHARED_DEPENDENCIES.positionForwarderFactory.address,
      graduationVaultFactory,
    ],
  );
  const expectedData = {
    hookFactory: creationCode(artifacts.hookFactory, "hookFactory"),
    feeHook: encodeFunctionData({
      abi: hookFactoryAbi,
      functionName: "deploy",
      args: [
        plan.hookSalt,
        CLASSIC_V4_OFFICIAL_DEPENDENCIES.poolManager.address,
        CLASSIC_V4_LAUNCHER_FEE_RECIPIENT,
        CLASSIC_V4_SHARED_DEPENDENCIES.rewardVaultFactory.address,
      ],
    }),
    positionPlanner: creationCode(artifacts.positionPlanner, "positionPlanner"),
    graduationVaultFactory:
      creationCode(artifacts.graduationVaultFactory, "graduationVaultFactory") +
      graduationVaultFactoryArguments.slice(2),
    launcher:
      creationCode(artifacts.launcher, "launcher") + launcherArguments.slice(2),
  };
  const expectedConstructorArguments = {
    hookFactory: "0x",
    feeHook: hookConstructorArguments,
    positionPlanner: "0x",
    graduationVaultFactory: graduationVaultFactoryArguments,
    launcher: launcherArguments,
  };
  assertExactKeys(
    plan.constructorArguments,
    CLASSIC_V4_NEW_CONTRACTS,
    "constructor arguments",
  );
  for (const name of CLASSIC_V4_NEW_CONTRACTS) {
    assert(
      normalizeHex(plan.constructorArguments[name]) ===
        normalizeHex(expectedConstructorArguments[name]),
      `Classic V4 plan ${name} constructor arguments differ`,
    );
  }
  assert(
    Array.isArray(plan.transactions) && plan.transactions.length === 5,
    "Classic V4 plan must contain exactly five transactions",
  );
  const expectedTransactionTypes = {
    hookFactory: "CREATE",
    feeHook: "CALL_CREATE2",
    positionPlanner: "CREATE",
    graduationVaultFactory: "CREATE",
    launcher: "CREATE",
  };
  for (const [index, name] of CLASSIC_V4_NEW_CONTRACTS.entries()) {
    const transaction = plan.transactions[index];
    const expectedTo = name === "feeHook" ? hookFactory : null;
    assertExactKeys(
      transaction,
      [
        "name",
        "transactionType",
        "from",
        "to",
        "nonce",
        "value",
        "predictedAddress",
        "data",
        "dataHash",
      ],
      `${name} plan transaction`,
    );
    assert(
      transaction?.name === name &&
        transaction?.transactionType === expectedTransactionTypes[name] &&
        transaction?.nonce === nonce + index &&
        normalizeHex(transaction?.from) === normalizeHex(deployer) &&
        normalizeHex(transaction?.to) === normalizeHex(expectedTo) &&
        String(transaction?.value) === "0" &&
        normalizeHex(transaction?.predictedAddress) ===
          normalizeHex(expectedAddresses[name]) &&
        normalizeHex(transaction?.data) === normalizeHex(expectedData[name]) &&
        normalizeHex(transaction?.dataHash) ===
          normalizeHex(keccak256(expectedData[name])),
      `Classic V4 plan transaction ${name} differs`,
    );
  }
  assertExactKeys(
    plan.executionBoundary,
    [
      "signs",
      "broadcasts",
      "writes",
      "ownerApprovalRequiredForDeployment",
    ],
    "plan execution boundary",
  );
  assert(
    plan.executionBoundary.signs === false &&
      plan.executionBoundary.broadcasts === false &&
      plan.executionBoundary.writes === false &&
      plan.executionBoundary.ownerApprovalRequiredForDeployment === true,
    "Classic V4 plan execution boundary differs",
  );
  const unsigned = Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== "planDigest"),
  );
  assert(
    normalizeHex(
      digestJson(unsigned, CLASSIC_V4_DIGEST_DOMAINS.preparationPlan),
    ) === normalizeHex(plan.planDigest),
    "Classic V4 plan digest differs",
  );
  return plan;
}

function assertExactKeys(object, expectedKeys, label) {
  assert(object && typeof object === "object", `${label} is missing`);
  const actual = Object.keys(object).sort();
  const expected = [...expectedKeys].sort();
  assert(
    actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]),
    `${label} keys differ`,
  );
}

function assertEvidenceIdentity(evidence, plan, label) {
  assert(evidence?.schemaVersion === 1, `${label} schema is invalid`);
  assert(evidence?.chainId === 1, `${label} chain is invalid`);
  assert(
    normalizeHex(evidence?.planDigest) === normalizeHex(plan.planDigest),
    `${label} belongs to another plan`,
  );
  assert(
    normalizeHex(evidence?.sourceCommitment) ===
      normalizeHex(plan.sourceCommitment),
    `${label} source commitment differs`,
  );
}

export function validateClassicV4DeploymentEvidence(plan, evidence) {
  assertExactKeys(
    evidence,
    [
      "schemaVersion",
      "chainId",
      "planDigest",
      "sourceCommitment",
      "status",
      "checkedAt",
      "verificationBlock",
      "verificationBlockHash",
      "independentRpcCount",
      "deploymentLive",
      "runtimeCodeVerified",
      "constructorBindingsVerified",
      "contracts",
      "evidenceDigest",
    ],
    "Deployment evidence",
  );
  assertEvidenceIdentity(evidence, plan, "Deployment evidence");
  assertIsoTimestamp(evidence.checkedAt, "deployment checkedAt");
  assertBytes32(evidence.evidenceDigest, "deployment evidence digest");
  const unsignedEvidence = Object.fromEntries(
    Object.entries(evidence).filter(([key]) => key !== "evidenceDigest"),
  );
  assert(
    normalizeHex(
      digestJson(
        unsignedEvidence,
        CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence,
      ),
    ) ===
      normalizeHex(evidence.evidenceDigest),
    "Deployment evidence digest differs",
  );
  assert(
    evidence.status === "finalized" &&
      evidence.deploymentLive === true &&
      evidence.runtimeCodeVerified === true &&
      evidence.constructorBindingsVerified === true,
    "Deployment evidence is not fully verified",
  );
  assert(
    Number.isSafeInteger(evidence.independentRpcCount) &&
      evidence.independentRpcCount >= 2,
    "Deployment evidence requires two independent RPCs",
  );
  assertNonNegativeInteger(
    evidence.verificationBlock,
    "deployment verification block",
  );
  assert(
    evidence.verificationBlock > 0,
    "Deployment verification block must be positive",
  );
  assertBytes32(
    evidence.verificationBlockHash,
    "deployment verification block hash",
  );
  assertExactKeys(
    evidence.contracts,
    CLASSIC_V4_NEW_CONTRACTS,
    "Deployment contracts",
  );
  const blocks = [];
  const transactionHashes = new Set();
  for (const [index, name] of CLASSIC_V4_NEW_CONTRACTS.entries()) {
    const record = evidence.contracts[name];
    const transaction = plan.transactions[index];
    assertExactKeys(
      record,
      [
        "transactionHash",
        "blockNumber",
        "blockHash",
        "confirmations",
        "address",
        "nonce",
        "from",
        "to",
        "dataHash",
        "value",
        "runtimeCodeHash",
        "runtimeTemplateHash",
      ],
      `${name} deployment record`,
    );
    const transactionHash = assertNonzeroBytes32(
      record?.transactionHash,
      `${name} transaction hash`,
    );
    assert(
      !transactionHashes.has(transactionHash),
      "Deployment transaction hashes must be unique",
    );
    transactionHashes.add(transactionHash);
    assertNonNegativeInteger(record?.blockNumber, `${name} block number`);
    assert(record.blockNumber > 0, `${name} block number must be positive`);
    assertBytes32(record?.blockHash, `${name} block hash`);
    assert(
      record.confirmations ===
        evidence.verificationBlock - record.blockNumber + 1 &&
        record.confirmations >= CLASSIC_V4_FINALITY_CONFIRMATIONS,
      `${name} is not final`,
    );
    assert(
      normalizeHex(record.address) ===
        normalizeHex(plan.predictedAddresses[name]),
      `${name} address differs from the reviewed plan`,
    );
    assert(
      record.nonce === transaction.nonce &&
        normalizeHex(record.from) === normalizeHex(transaction.from) &&
        normalizeHex(record.to) === normalizeHex(transaction.to) &&
        normalizeHex(record.dataHash) === normalizeHex(transaction.dataHash) &&
        String(record.value) === "0",
      `${name} transaction differs from the reviewed plan`,
    );
    assertBytes32(record.runtimeCodeHash, `${name} runtime code hash`);
    assert(
      normalizeHex(record.runtimeTemplateHash) ===
        normalizeHex(plan.runtimeTemplates[name].runtimeTemplateHash),
      `${name} runtime template differs from source`,
    );
    blocks.push(record.blockNumber);
  }
  return { startBlock: Math.min(...blocks), deploymentBlocks: blocks };
}

export function validateClassicV4SourceEvidence(plan, deployment, evidence) {
  assertExactKeys(
    evidence,
    [
      "schemaVersion",
      "chainId",
      "planDigest",
      "sourceCommitment",
      "status",
      "checkedAt",
      "contracts",
      "evidenceDigest",
    ],
    "Source evidence",
  );
  assertEvidenceIdentity(evidence, plan, "Source evidence");
  assertIsoTimestamp(evidence.checkedAt, "source checkedAt");
  assertBytes32(evidence.evidenceDigest, "source evidence digest");
  assert(
    normalizeHex(
      digestJson(
        Object.fromEntries(
          Object.entries(evidence).filter(([key]) => key !== "evidenceDigest"),
        ),
        CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
      ),
    ) === normalizeHex(evidence.evidenceDigest),
    "Source evidence digest differs",
  );
  assert(evidence.status === "verified", "Source evidence is not verified");
  assertExactKeys(
    evidence.contracts,
    CLASSIC_V4_NEW_CONTRACTS,
    "Source contracts",
  );
  for (const name of CLASSIC_V4_NEW_CONTRACTS) {
    const source = evidence.contracts[name];
    const deployed = deployment.contracts[name];
    const target = CLASSIC_V4_SOURCE_TARGETS[name];
    assertExactKeys(
      source,
      [
        "address",
        "contractName",
        "fqcn",
        "encodedConstructorArguments",
        "deploymentTransaction",
        "deploymentBlock",
        "status",
        "providers",
      ],
      `${name} source record`,
    );
    assert(
      normalizeHex(source.address) === normalizeHex(deployed.address) &&
        normalizeHex(source.deploymentTransaction) ===
          normalizeHex(deployed.transactionHash) &&
        source.deploymentBlock === deployed.blockNumber,
      `${name} source evidence differs from deployment`,
    );
    assert(
      normalizeHex(source.encodedConstructorArguments) ===
        normalizeHex(plan.constructorArguments[name]),
      `${name} source constructor arguments differ from the reviewed plan`,
    );
    assert(
      source.contractName === target.contractName &&
        source.fqcn === target.fqcn,
      `${name} source identity differs from the reviewed target`,
    );
    const providerNames = source.providers?.map((provider) => provider.name);
    const expectedProviderNames = source.providers?.some(
      (provider) => provider.name === "Etherscan",
    )
      ? ["Sourcify", "Etherscan"]
      : ["Sourcify"];
    assert(
      source.status === "exact-match" &&
        Array.isArray(source.providers) &&
        providerNames.length === expectedProviderNames.length &&
        providerNames.every(
          (providerName, index) =>
            providerName === expectedProviderNames[index],
        ) &&
        source.providers.every(
          (provider) => {
            assertExactKeys(
              provider,
              ["name", "status", "url"],
              `${name} source provider`,
            );
            return (
              provider.status === "exact-match" &&
            (provider.name === "Sourcify" || provider.name === "Etherscan") &&
            normalizeHex(provider.url) ===
              normalizeHex(
                provider.name === "Sourcify"
                  ? `https://sourcify.dev/server/v2/contract/1/${deployed.address}`
                  : `https://etherscan.io/address/${deployed.address}#code`,
              )
            );
          },
        ),
      `${name} source verification is incomplete`,
    );
  }
  return evidence;
}

function assertNonzeroBytes32(value, label) {
  const normalized = assertBytes32(value, label);
  assert(BigInt(normalized) !== 0n, `Invalid ${label}`);
  return normalized;
}

function decimalBigInt(value, label, { signed = false, positive = false } = {}) {
  const expression = signed ? /^-?(0|[1-9][0-9]*)$/ : /^(0|[1-9][0-9]*)$/;
  assert(typeof value === "string" && expression.test(value), `Invalid ${label}`);
  const parsed = BigInt(value);
  assert(!positive || parsed > 0n, `Invalid ${label}`);
  return parsed;
}

function assertSameAddress(actual, expected, label) {
  assert(
    normalizeHex(canonicalAddress(actual, label)) ===
      normalizeHex(canonicalAddress(expected, label)),
    `${label} differs`,
  );
}

function lifecycleReleaseCandidate(plan, deployment, source) {
  return {
    internalContractRelease: CLASSIC_V4_RELEASE,
    chainId: 1,
    releaseCommit: plan.releaseCommit,
    sourceCommitment: plan.sourceCommitment,
    releaseBindingDigest: digestJson(
      {
        planDigest: plan.planDigest,
        deploymentEvidence: deployment,
        sourceEvidence: source,
      },
      CLASSIC_V4_DIGEST_DOMAINS.releaseBinding,
    ),
    addresses: {
      deployer: plan.deployer,
      launcherFeeRecipient: plan.launcherFeeRecipient,
      ...Object.fromEntries(
        Object.entries(plan.sharedDependencies).map(([name, value]) => [
          name,
          value.address,
        ]),
      ),
      ...plan.predictedAddresses,
    },
    officialDependencies: plan.officialDependencies,
    verification: {
      deploymentLive: true,
      runtimeCodeVerified: true,
      constructorBindingsVerified: true,
      sourceVerified: true,
    },
  };
}

function grossFeeSplit(gross, totalSwapFeeBps) {
  const total = (gross * BigInt(totalSwapFeeBps)) / 10_000n;
  const launcher = (gross * 10n) / 10_000n;
  return { creator: total - launcher, launcher, total };
}

function netFeeSplit(net, totalSwapFeeBps) {
  const denominator = 10_000n - BigInt(totalSwapFeeBps);
  const gross = (net * 10_000n + denominator - 1n) / denominator;
  const total = gross - net;
  const launcher = (gross * 10n) / 10_000n;
  return { creator: total - launcher, launcher, total, gross };
}

function assertEventIndices(events, expected, label) {
  assertExactKeys(events, expected, `${label} events`);
  for (const name of expected) {
    assertNonNegativeInteger(events[name], `${label} ${name} log index`);
  }
}

export function expectedLifecycleLaunchCalldata(canary) {
  return encodeFunctionData({
    abi: classicV4LauncherAbi,
    functionName: "launch",
    args: [
      {
        name: canary.launchFixture.name,
        symbol: canary.launchFixture.symbol,
        buySwapFeeBps: canary.launchFixture.buySwapFeeBps,
        sellSwapFeeBps: canary.launchFixture.sellSwapFeeBps,
        liquidityPreset: canary.launchFixture.liquidityPreset,
        creatorSalt: canary.launchFixture.creatorSalt,
        metadata: canary.launchFixture.metadata,
        rewardBeneficiaries: [canary.operatorWallet],
        rewardSharesBps: canary.launchFixture.beneficiarySharesBps,
        initialBuyCustody: {
          mode: 0,
          durationDays: 0,
          cliffDays: 0,
        },
      },
    ],
  });
}

export function expectedLifecycleSwapCalldata(
  canary,
  token,
  side,
  exactness,
  swap,
) {
  const exactInput = exactness === "exact-input";
  const inputBound = BigInt(swap.inputBound);
  const outputBound = BigInt(swap.outputBound);
  const poolKey = {
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: canonicalAddress(token, "canary token"),
    fee: 0,
    tickSpacing: 200,
    hooks: canary.feeHook,
  };
  const swapParameter = exactInput
    ? {
        poolKey,
        zeroForOne: side === "buy",
        amountIn: inputBound,
        amountOutMinimum: outputBound,
        hookData: "0x",
      }
    : {
        poolKey,
        zeroForOne: side === "buy",
        amountOut: outputBound,
        amountInMaximum: inputBound,
        hookData: "0x",
      };
  const inputCurrency =
    side === "buy"
      ? "0x0000000000000000000000000000000000000000"
      : canonicalAddress(token, "canary token");
  const outputCurrency =
    side === "buy"
      ? canonicalAddress(token, "canary token")
      : "0x0000000000000000000000000000000000000000";
  const innerActions = exactInput ? "0x060c0f" : "0x080c0f";
  const innerInputs = [
    encodeAbiParameters(
      [
        exactInput
          ? CLASSIC_V4_EXACT_INPUT_SINGLE_TYPE
          : CLASSIC_V4_EXACT_OUTPUT_SINGLE_TYPE,
      ],
      [swapParameter],
    ),
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [inputCurrency, inputBound],
    ),
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [outputCurrency, outputBound],
    ),
  ];
  const inputs = [
    encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      [innerActions, innerInputs],
    ),
  ];
  const exactOutputBuy = side === "buy" && !exactInput;
  if (exactOutputBuy) {
    inputs.push(
      encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        [
          "0x0000000000000000000000000000000000000000",
          canary.operatorWallet,
          0n,
        ],
      ),
    );
  }
  return encodeFunctionData({
    abi: classicV4UniversalRouterAbi,
    functionName: "execute",
    args: [
      exactOutputBuy ? "0x1004" : "0x10",
      inputs,
      BigInt(swap.routerDeadline),
    ],
  });
}

export function validateClassicV4LifecycleEvidence(
  plan,
  deployment,
  source,
  evidence,
) {
  assertEvidenceIdentity(evidence, plan, "Lifecycle evidence");
  assertExactKeys(
    evidence,
    [
      "schemaVersion",
      "chainId",
      "planDigest",
      "sourceCommitment",
      "status",
      "checkedAt",
      "independentRpcCount",
      "releaseEligible",
      "canaryPlanDigest",
      "releaseBindingDigest",
      "deploymentEvidenceDigest",
      "sourceEvidenceDigest",
      "verificationBlock",
      "verificationBlockHash",
      "latestLifecycleBlock",
      "confirmations",
      "operatorWallet",
      "launcher",
      "feeHook",
      "canaryToken",
      "rewardVault",
      "poolId",
      "positionRecipient",
      "finalPositionRecipient",
      "positionTokenId",
      "actions",
      "swaps",
      "claims",
      "postState",
      "feeConservation",
      "observations",
      "invariants",
      "evidenceDigest",
    ],
    "Lifecycle evidence",
  );
  validateClassicV4DeploymentEvidence(plan, deployment);
  validateClassicV4SourceEvidence(plan, deployment, source);
  assertIsoTimestamp(evidence.checkedAt, "lifecycle checkedAt");
  assertNonzeroBytes32(evidence.evidenceDigest, "lifecycle evidence digest");
  assert(
    normalizeHex(
      digestJson(
        Object.fromEntries(
          Object.entries(evidence).filter(([key]) => key !== "evidenceDigest"),
        ),
        CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
      ),
    ) === normalizeHex(evidence.evidenceDigest),
    "Lifecycle evidence digest differs",
  );
  assert(
    evidence.status === "verified-current-release" &&
      evidence.releaseEligible === true &&
      evidence.independentRpcCount === 2,
    "Lifecycle evidence is not verified",
  );

  const releaseCandidate = lifecycleReleaseCandidate(plan, deployment, source);
  const canary = buildClassicV4LifecycleCanaryPlan(
    releaseCandidate,
    evidence.operatorWallet,
  );
  assert(
    normalizeHex(evidence.releaseBindingDigest) ===
      normalizeHex(releaseCandidate.releaseBindingDigest) &&
      normalizeHex(evidence.canaryPlanDigest) ===
        normalizeHex(canary.planDigest) &&
      normalizeHex(evidence.deploymentEvidenceDigest) ===
        normalizeHex(deployment.evidenceDigest) &&
      normalizeHex(evidence.sourceEvidenceDigest) ===
        normalizeHex(source.evidenceDigest),
    "Lifecycle release binding differs",
  );
  assertSameAddress(evidence.operatorWallet, canary.operatorWallet, "Canary operator");
  assertSameAddress(evidence.launcher, canary.launcher, "Lifecycle launcher");
  assertSameAddress(evidence.feeHook, canary.feeHook, "Lifecycle fee hook");
  canonicalNonzeroAddress(evidence.canaryToken, "canary token");
  canonicalNonzeroAddress(evidence.rewardVault, "reward vault");
  canonicalNonzeroAddress(evidence.positionRecipient, "position recipient");
  canonicalNonzeroAddress(
    evidence.finalPositionRecipient,
    "final position recipient",
  );
  assertNonzeroBytes32(evidence.poolId, "canary pool id");
  decimalBigInt(evidence.positionTokenId, "position token ID", { positive: true });
  assertNonNegativeInteger(evidence.verificationBlock, "lifecycle verification block");
  assert(evidence.verificationBlock > 0, "Lifecycle verification block must be positive");
  assertNonzeroBytes32(
    evidence.verificationBlockHash,
    "lifecycle verification block hash",
  );

  assertExactKeys(
    evidence.actions,
    CLASSIC_V4_LIFECYCLE_ACTIONS,
    "Lifecycle actions",
  );
  const eventKeys = {
    launch: [
      "MemeTokenLaunchedV2",
      "MemeLiquidityConfiguredV2",
      "MemeCreatorInitialBuyV2",
      "MemeCreatorInitialBuyCustodyV2",
      "MemeBondingConfiguredV1",
      "PoolRegistered",
      "PoolFeeDisclosure",
      "ClassicBondingConfigured",
      "ClassicBondingPositionActivated",
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    buyExactInput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    buyExactOutput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    sellExactInput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    sellExactOutput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    creatorClaim: [
      "CreatorFeesClaimed",
      "CreatorFeesCheckpointed",
      "BeneficiaryFeesClaimed",
    ],
    launcherClaim: ["LauncherFeesClaimed"],
  };
  const swapIdentity = {
    buyExactInput: ["buy", "exact-input"],
    buyExactOutput: ["buy", "exact-output"],
    sellExactInput: ["sell", "exact-input"],
    sellExactOutput: ["sell", "exact-output"],
  };
  const latestDeploymentBlock = Math.max(
    ...Object.values(deployment.contracts).map((record) => record.blockNumber),
  );
  const transactionHashes = new Set();
  let previousBlock = latestDeploymentBlock;
  let previousOperatorNonce = -1;
  for (const action of CLASSIC_V4_LIFECYCLE_ACTIONS) {
    const record = evidence.actions[action];
    const isSwap = Object.hasOwn(swapIdentity, action);
    assertExactKeys(
      record,
      [
        "transactionHash",
        "inputHash",
        "blockNumber",
        "blockHash",
        "blockTimestamp",
        "transactionIndex",
        "nonce",
        "from",
        "to",
        "value",
        "confirmations",
        "success",
        "events",
        ...(isSwap ? ["side", "exactness"] : []),
      ],
      `${action} lifecycle action`,
    );
    const transactionHash = assertNonzeroBytes32(
      record.transactionHash,
      `${action} transaction hash`,
    );
    assert(!transactionHashes.has(transactionHash), "Lifecycle transaction hashes differ");
    transactionHashes.add(transactionHash);
    assertNonzeroBytes32(record.inputHash, `${action} input hash`);
    assertNonzeroBytes32(record.blockHash, `${action} block hash`);
    assertNonNegativeInteger(record.blockNumber, `${action} block number`);
    assertNonNegativeInteger(record.transactionIndex, `${action} transaction index`);
    assertNonNegativeInteger(record.nonce, `${action} nonce`);
    decimalBigInt(record.blockTimestamp, `${action} block timestamp`, {
      positive: true,
    });
    decimalBigInt(record.value, `${action} value`);
    assert(
      record.blockNumber > previousBlock &&
        record.blockNumber <= evidence.verificationBlock &&
        record.confirmations ===
          evidence.verificationBlock - record.blockNumber + 1 &&
        record.confirmations >= CLASSIC_V4_FINALITY_CONFIRMATIONS &&
        record.success === true,
      `${action} is not canonically ordered, finalized and successful`,
    );
    previousBlock = record.blockNumber;
    if (action !== "launcherClaim") {
      assert(
        record.nonce > previousOperatorNonce,
        `${action} operator nonce is not increasing`,
      );
      previousOperatorNonce = record.nonce;
    }
    const expectedFrom =
      action === "launcherClaim" ? canary.treasury : canary.operatorWallet;
    const expectedTo =
      action === "launch"
        ? canary.launcher
        : isSwap
          ? canary.dependencies.universalRouter
          : action === "creatorClaim"
            ? evidence.rewardVault
            : canary.feeHook;
    assertSameAddress(record.from, expectedFrom, `${action} signer`);
    assertSameAddress(record.to, expectedTo, `${action} target`);
    assertEventIndices(record.events, eventKeys[action], action);
    if (isSwap) {
      assert(
        record.side === swapIdentity[action][0] &&
          record.exactness === swapIdentity[action][1],
        `${action} quadrant differs`,
      );
    }
  }
  assert(
    evidence.latestLifecycleBlock ===
      evidence.actions.launcherClaim.blockNumber &&
      evidence.confirmations ===
        evidence.verificationBlock - evidence.latestLifecycleBlock + 1 &&
      evidence.confirmations >= CLASSIC_V4_FINALITY_CONFIRMATIONS,
    "Lifecycle finality summary differs",
  );
  const expectedStaticInputHashes = {
    launch: keccak256(expectedLifecycleLaunchCalldata(canary)),
    creatorClaim: keccak256(
      encodeFunctionData({
        abi: classicV4CreatorClaimAbi,
        functionName: "claim",
      }),
    ),
    launcherClaim: keccak256(
      encodeFunctionData({
        abi: classicV4LauncherClaimAbi,
        functionName: "claimLauncherFees",
      }),
    ),
  };
  for (const [action, expectedInputHash] of Object.entries(
    expectedStaticInputHashes,
  )) {
    assert(
      normalizeHex(evidence.actions[action].inputHash) ===
        normalizeHex(expectedInputHash),
      `${action} calldata differs from the canary plan`,
    );
  }

  assertExactKeys(
    evidence.swaps,
    Object.keys(swapIdentity),
    "Lifecycle swaps",
  );
  let swapCreatorTotal = 0n;
  let swapLauncherTotal = 0n;
  for (const [action, [side, exactness]] of Object.entries(swapIdentity)) {
    const swap = evidence.swaps[action];
    assertExactKeys(
      swap,
      [
        "side",
        "exactness",
        "poolAmount0",
        "poolAmount1",
        "grossNativeAmount",
        "creatorFee",
        "launcherFee",
        "totalFee",
        "appliedTotalSwapFeeBps",
        "inputBound",
        "outputBound",
        "routerDeadline",
        "executionPath",
        "quote",
      ],
      `${action} swap`,
    );
    const amount0 = decimalBigInt(swap.poolAmount0, `${action} pool amount0`, {
      signed: true,
    });
    const amount1 = decimalBigInt(swap.poolAmount1, `${action} pool amount1`, {
      signed: true,
    });
    const gross = decimalBigInt(
      swap.grossNativeAmount,
      `${action} gross native amount`,
      { positive: true },
    );
    const creatorFee = decimalBigInt(swap.creatorFee, `${action} creator fee`, {
      positive: true,
    });
    const launcherFee = decimalBigInt(swap.launcherFee, `${action} launcher fee`, {
      positive: true,
    });
    const totalFee = decimalBigInt(swap.totalFee, `${action} total fee`, {
      positive: true,
    });
    const inputBound = decimalBigInt(swap.inputBound, `${action} input bound`, {
      positive: true,
    });
    const outputBound = decimalBigInt(
      swap.outputBound,
      `${action} output bound`,
      { positive: true },
    );
    const deadline = decimalBigInt(
      swap.routerDeadline,
      `${action} router deadline`,
      { positive: true },
    );
    const blockTimestamp = decimalBigInt(
      evidence.actions[action].blockTimestamp,
      `${action} block timestamp`,
      { positive: true },
    );
    assert(
      swap.side === side &&
        swap.exactness === exactness &&
        swap.executionPath === "single-hop-all" &&
        swap.appliedTotalSwapFeeBps === (side === "buy" ? 100 : 200) &&
        creatorFee + launcherFee === totalFee &&
        deadline >= blockTimestamp &&
        deadline <= blockTimestamp + BigInt(canary.swapFixture.deadlineSeconds),
      `${action} swap binding differs`,
    );
    assert(
      normalizeHex(evidence.actions[action].inputHash) ===
        normalizeHex(
          keccak256(
            expectedLifecycleSwapCalldata(
              canary,
              evidence.canaryToken,
              side,
              exactness,
              swap,
            ),
          ),
        ),
      `${action} calldata differs from the canary plan`,
    );
    assert(
      side === "buy"
        ? amount0 < 0n &&
            amount1 > 0n &&
            -amount0 + totalFee === gross
        : amount0 > 0n && amount1 < 0n && amount0 === gross,
      `${action} pool deltas do not reconcile`,
    );
    const expectedFee =
      exactness === "exact-output"
        ? netFeeSplit(side === "buy" ? -amount0 : outputBound, side === "buy" ? 100 : 200)
        : grossFeeSplit(side === "buy" ? inputBound : amount0, side === "buy" ? 100 : 200);
    assert(
      creatorFee === expectedFee.creator &&
        launcherFee === expectedFee.launcher &&
        totalFee === expectedFee.total,
      `${action} exact fee split differs`,
    );
    assert(
      side === "buy" && exactness === "exact-input"
        ? gross === inputBound && amount1 >= outputBound
        : side === "buy" && exactness === "exact-output"
          ? amount1 === outputBound && gross <= inputBound
          : side === "sell" && exactness === "exact-input"
            ? -amount1 === inputBound && amount0 - totalFee >= outputBound
            : amount0 - totalFee === outputBound && -amount1 <= inputBound,
      `${action} exact amount semantics differ`,
    );

    const fixture = canary.swapFixture[action];
    const quote = swap.quote;
    assertExactKeys(
      quote,
      [
        "policy",
        "function",
        "blockNumber",
        "blockHash",
        "exactAmount",
        "quotedAmount",
        "gasEstimate",
        "slippageBps",
        "bound",
      ],
      `${action} quote`,
    );
    assertNonzeroBytes32(quote.blockHash, `${action} quote block hash`);
    const quotedAmount = decimalBigInt(
      quote.quotedAmount,
      `${action} quoted amount`,
      { positive: true },
    );
    decimalBigInt(quote.gasEstimate, `${action} quote gas estimate`, {
      positive: true,
    });
    const quoteBound = decimalBigInt(quote.bound, `${action} quote bound`, {
      positive: true,
    });
    const exactInput = exactness === "exact-input";
    const exactAmount = decimalBigInt(
      quote.exactAmount,
      `${action} quote exact amount`,
      { positive: true },
    );
    const expectedExactAmount = BigInt(
      exactInput ? fixture.amountIn : fixture.amountOut,
    );
    const expectedQuoteBound = exactInput
      ? (quotedAmount * 9_900n) / 10_000n
      : (quotedAmount * 10_100n + 9_999n) / 10_000n;
    assert(
      quote.policy === canary.swapFixture.quotePolicy &&
        quote.function ===
          `V4Quoter.${exactInput ? "quoteExactInputSingle" : "quoteExactOutputSingle"}` &&
        quote.blockNumber === evidence.actions[action].blockNumber - 1 &&
        quote.slippageBps === canary.swapFixture.slippageBps &&
        exactAmount === expectedExactAmount &&
        quoteBound === expectedQuoteBound &&
        quoteBound === (exactInput ? outputBound : inputBound),
      `${action} canonical quote binding differs`,
    );
    if (!exactInput) {
      assert(
        inputBound <= BigInt(fixture.hardMaximumAmountIn),
        `${action} hard maximum input exceeded`,
      );
    }
    const expectedValue = side === "buy" ? inputBound : 0n;
    assert(
      decimalBigInt(evidence.actions[action].value, `${action} value`) ===
        expectedValue,
      `${action} transaction value differs`,
    );
    swapCreatorTotal += creatorFee;
    swapLauncherTotal += launcherFee;
  }
  assert(
    decimalBigInt(evidence.actions.launch.value, "launch value") ===
      BigInt(canary.launchFixture.initialBuyWei) &&
      decimalBigInt(evidence.actions.creatorClaim.value, "creator claim value") ===
        0n &&
      decimalBigInt(evidence.actions.launcherClaim.value, "launcher claim value") ===
        0n,
    "Lifecycle non-swap transaction values differ",
  );

  assertExactKeys(evidence.claims, ["creator", "launcher"], "Lifecycle claims");
  assertExactKeys(
    evidence.claims.creator,
    ["amount", "vaultCheckpointAmount", "beneficiaryAmount"],
    "Creator claim",
  );
  assertExactKeys(evidence.claims.launcher, ["amount"], "Launcher claim");
  const creatorClaim = decimalBigInt(
    evidence.claims.creator.amount,
    "creator claim amount",
    { positive: true },
  );
  const creatorCheckpoint = decimalBigInt(
    evidence.claims.creator.vaultCheckpointAmount,
    "creator checkpoint amount",
    { positive: true },
  );
  const beneficiaryClaim = decimalBigInt(
    evidence.claims.creator.beneficiaryAmount,
    "beneficiary claim amount",
    { positive: true },
  );
  const launcherClaim = decimalBigInt(
    evidence.claims.launcher.amount,
    "launcher claim amount",
    { positive: true },
  );
  const initialFee = grossFeeSplit(
    BigInt(canary.launchFixture.initialBuyWei),
    canary.launchFixture.buySwapFeeBps,
  );
  assert(
    creatorClaim === creatorCheckpoint &&
      creatorClaim === beneficiaryClaim &&
      creatorClaim === swapCreatorTotal + initialFee.creator &&
      launcherClaim === swapLauncherTotal + initialFee.launcher,
    "Lifecycle claims do not equal exact canary accruals",
  );

  assertExactKeys(
    evidence.feeConservation,
    ["creatorAccrualTotal", "launcherAccrualTotal", "totalAccrual", "checkpoints"],
    "Fee conservation",
  );
  const creatorTotal = decimalBigInt(
    evidence.feeConservation.creatorAccrualTotal,
    "creator accrual total",
    { positive: true },
  );
  const launcherTotal = decimalBigInt(
    evidence.feeConservation.launcherAccrualTotal,
    "launcher accrual total",
    { positive: true },
  );
  const accrualTotal = decimalBigInt(
    evidence.feeConservation.totalAccrual,
    "total accrual",
    { positive: true },
  );
  assert(
    creatorTotal === creatorClaim &&
      launcherTotal === launcherClaim &&
      accrualTotal === creatorTotal + launcherTotal,
    "Fee conservation totals differ",
  );

  const checkpoints = evidence.feeConservation.checkpoints;
  assertExactKeys(
    checkpoints,
    [
      "preLaunch",
      "beforeCreatorClaim",
      "afterCreatorClaim",
      "beforeLauncherClaim",
      "final",
    ],
    "Fee checkpoints",
  );
  const expectedCheckpointBlocks = {
    preLaunch: evidence.actions.launch.blockNumber - 1,
    beforeCreatorClaim: evidence.actions.creatorClaim.blockNumber - 1,
    afterCreatorClaim: evidence.actions.creatorClaim.blockNumber,
    beforeLauncherClaim: evidence.actions.launcherClaim.blockNumber - 1,
    final: evidence.verificationBlock,
  };
  const hookKeys = [
    "rewardVault",
    "registrar",
    "buySwapFeeBps",
    "sellSwapFeeBps",
    "registered",
    "creatorFeesAccrued",
    "launcherFeesAccrued",
    "totalNativeFeesAccrued",
    "poolManagerNativeClaims",
    "poolManagerTokenClaims",
    "rawNativeBalance",
  ];
  const vaultKeys = [
    "totalCreatorFeesReceived",
    "totalCreatorFeesClaimed",
    "beneficiaryClaimed",
    "beneficiaryClaimable",
    "rawNativeBalance",
  ];
  for (const [name, checkpoint] of Object.entries(checkpoints)) {
    const hasVault = ["beforeCreatorClaim", "afterCreatorClaim", "final"].includes(
      name,
    );
    assertExactKeys(
      checkpoint,
      ["blockNumber", "hook", ...(hasVault ? ["vault"] : [])],
      `${name} checkpoint`,
    );
    assert(
      checkpoint.blockNumber === expectedCheckpointBlocks[name],
      `${name} checkpoint block differs`,
    );
    assertExactKeys(checkpoint.hook, hookKeys, `${name} hook checkpoint`);
    if (hasVault) {
      assertExactKeys(checkpoint.vault, vaultKeys, `${name} vault checkpoint`);
    }
  }
  const assertHookState = (
    snapshot,
    { registered, creator, launcher },
    label,
  ) => {
    const total = creator + launcher;
    assertSameAddress(
      snapshot.rewardVault,
      registered ? evidence.rewardVault : "0x0000000000000000000000000000000000000000",
      `${label} reward vault`,
    );
    assertSameAddress(
      snapshot.registrar,
      registered ? evidence.launcher : "0x0000000000000000000000000000000000000000",
      `${label} registrar`,
    );
    assert(
      snapshot.registered === registered &&
        snapshot.buySwapFeeBps === (registered ? 100 : 0) &&
        snapshot.sellSwapFeeBps === (registered ? 200 : 0) &&
        decimalBigInt(snapshot.creatorFeesAccrued, `${label} creator fees`) ===
          creator &&
        decimalBigInt(snapshot.launcherFeesAccrued, `${label} launcher fees`) ===
          launcher &&
        decimalBigInt(snapshot.totalNativeFeesAccrued, `${label} total fees`) ===
          total &&
        decimalBigInt(snapshot.poolManagerNativeClaims, `${label} native claims`) ===
          total &&
        decimalBigInt(snapshot.poolManagerTokenClaims, `${label} token claims`) ===
          0n &&
        decimalBigInt(snapshot.rawNativeBalance, `${label} raw native`) === 0n,
      `${label} hook accounting differs`,
    );
  };
  assertHookState(
    checkpoints.preLaunch.hook,
    { registered: false, creator: 0n, launcher: 0n },
    "Pre-launch",
  );
  assertHookState(
    checkpoints.beforeCreatorClaim.hook,
    { registered: true, creator: creatorTotal, launcher: launcherTotal },
    "Before creator claim",
  );
  assertHookState(
    checkpoints.afterCreatorClaim.hook,
    { registered: true, creator: 0n, launcher: launcherTotal },
    "After creator claim",
  );
  assertHookState(
    checkpoints.beforeLauncherClaim.hook,
    { registered: true, creator: 0n, launcher: launcherTotal },
    "Before launcher claim",
  );
  assertHookState(
    checkpoints.final.hook,
    { registered: true, creator: 0n, launcher: 0n },
    "Final",
  );
  const assertVaultState = (snapshot, expected, label) => {
    assert(
      decimalBigInt(snapshot.totalCreatorFeesReceived, `${label} received`) ===
        expected &&
        decimalBigInt(snapshot.totalCreatorFeesClaimed, `${label} claimed`) ===
          expected &&
        decimalBigInt(snapshot.beneficiaryClaimed, `${label} beneficiary claimed`) ===
          expected &&
        decimalBigInt(snapshot.beneficiaryClaimable, `${label} claimable`) ===
          0n &&
        decimalBigInt(snapshot.rawNativeBalance, `${label} raw balance`) === 0n,
      `${label} vault accounting differs`,
    );
  };
  assertVaultState(checkpoints.beforeCreatorClaim.vault, 0n, "Before creator claim");
  assertVaultState(checkpoints.afterCreatorClaim.vault, creatorTotal, "After creator claim");
  assertVaultState(checkpoints.final.vault, creatorTotal, "Final vault");

  const postState = evidence.postState;
  assertExactKeys(
    postState,
    [
      "launchMappings",
      "poolFeeConfig",
      "rewardVault",
      "bondingLifecycle",
      "positionLock",
      "tokenCustody",
      "derivedCodeHashes",
    ],
    "Lifecycle post-state",
  );
  assertExactKeys(
    postState.launchMappings,
    [
      "launchHash",
      "rewardVault",
      "initialBuyCustody",
      "graduationVault",
      "finalPositionRecipient",
    ],
    "Launch mappings",
  );
  assertNonzeroBytes32(postState.launchMappings.launchHash, "launch hash");
  assertSameAddress(
    postState.launchMappings.rewardVault,
    evidence.rewardVault,
    "Mapped reward vault",
  );
  assertSameAddress(
    postState.launchMappings.initialBuyCustody,
    "0x0000000000000000000000000000000000000000",
    "Initial buy custody",
  );
  assertSameAddress(
    postState.launchMappings.graduationVault,
    evidence.positionRecipient,
    "Mapped graduation vault",
  );
  assertSameAddress(
    postState.launchMappings.finalPositionRecipient,
    evidence.finalPositionRecipient,
    "Mapped final position recipient",
  );
  assertExactKeys(
    postState.poolFeeConfig,
    [
      "rewardVault",
      "registrar",
      "buySwapFeeBps",
      "sellSwapFeeBps",
      "registered",
      "creatorFeesAccrued",
    ],
    "Post-state pool fee config",
  );
  assertSameAddress(postState.poolFeeConfig.rewardVault, evidence.rewardVault, "Pool vault");
  assertSameAddress(postState.poolFeeConfig.registrar, evidence.launcher, "Pool registrar");
  assert(
    postState.poolFeeConfig.buySwapFeeBps === 100 &&
      postState.poolFeeConfig.sellSwapFeeBps === 200 &&
      postState.poolFeeConfig.registered === true &&
      decimalBigInt(postState.poolFeeConfig.creatorFeesAccrued, "final creator fees") ===
        0n,
    "Post-state pool fee config differs",
  );
  assertExactKeys(
    postState.rewardVault,
    [
      "configurationHash",
      "activeConfigurationHash",
      "configurationEpoch",
      "beneficiary",
      "shareBps",
    ],
    "Post-state reward vault",
  );
  assertNonzeroBytes32(postState.rewardVault.configurationHash, "vault configuration hash");
  assertNonzeroBytes32(
    postState.rewardVault.activeConfigurationHash,
    "active vault configuration hash",
  );
  assertSameAddress(
    postState.rewardVault.beneficiary,
    evidence.operatorWallet,
    "Vault beneficiary",
  );
  assert(
    postState.rewardVault.configurationEpoch === 1 &&
      postState.rewardVault.shareBps === 10_000,
    "Reward vault configuration differs",
  );
  assertExactKeys(
    postState.bondingLifecycle,
    [
      "graduationVault",
      "finalPositionRecipient",
      "factory",
      "factoryConfigurationHash",
      "poolId",
      "state",
      "progressBps",
      "tokenRemaining",
      "nativeRemainingNet",
      "graduated",
      "finalPositionTokenId",
    ],
    "Bonding lifecycle",
  );
  assertSameAddress(
    postState.bondingLifecycle.graduationVault,
    evidence.positionRecipient,
    "Graduation vault",
  );
  assertSameAddress(
    postState.bondingLifecycle.finalPositionRecipient,
    evidence.finalPositionRecipient,
    "Final position recipient",
  );
  assertSameAddress(
    postState.bondingLifecycle.factory,
    plan.predictedAddresses.graduationVaultFactory,
    "Graduation vault factory",
  );
  assertNonzeroBytes32(
    postState.bondingLifecycle.factoryConfigurationHash,
    "graduation vault factory configuration hash",
  );
  assertNonzeroBytes32(postState.bondingLifecycle.poolId, "Bonding pool ID");
  assert(
    normalizeHex(postState.bondingLifecycle.poolId) ===
      normalizeHex(evidence.poolId) &&
      postState.bondingLifecycle.state === "bonding" &&
      Number.isInteger(postState.bondingLifecycle.progressBps) &&
      postState.bondingLifecycle.progressBps > 0 &&
      postState.bondingLifecycle.progressBps < 10_000 &&
      decimalBigInt(
        postState.bondingLifecycle.tokenRemaining,
        "remaining Bonding tokens",
        { positive: true },
      ) > 0n &&
      decimalBigInt(
        postState.bondingLifecycle.nativeRemainingNet,
        "remaining Bonding principal",
        { positive: true },
      ) > 0n &&
      postState.bondingLifecycle.graduated === false &&
      decimalBigInt(
        postState.bondingLifecycle.finalPositionTokenId,
        "final position token ID",
      ) === 0n,
    "Bonding lifecycle state differs",
  );
  assertExactKeys(
    postState.positionLock,
    [
      "owner",
      "approved",
      "tokenId",
      "positionLiquidity",
      "activePoolLiquidity",
      "tickLower",
      "tickUpper",
      "finalPositionRecipient",
      "manager",
      "operator",
      "timelockBlockNumber",
      "feeRecipient",
      "factoryConfigurationHash",
    ],
    "Position lock",
  );
  assertSameAddress(postState.positionLock.owner, evidence.positionRecipient, "Position owner");
  assertSameAddress(
    postState.positionLock.finalPositionRecipient,
    evidence.finalPositionRecipient,
    "Final position recipient",
  );
  assertSameAddress(
    postState.positionLock.approved,
    "0x0000000000000000000000000000000000000000",
    "Position approval",
  );
  assertSameAddress(
    postState.positionLock.manager,
    canary.dependencies.positionManager,
    "Position manager",
  );
  assertSameAddress(
    postState.positionLock.operator,
    "0x0000000000000000000000000000000000000000",
    "Position operator",
  );
  assertSameAddress(
    postState.positionLock.feeRecipient,
    evidence.operatorWallet,
    "Position fee recipient",
  );
  assertNonzeroBytes32(
    postState.positionLock.factoryConfigurationHash,
    "position factory configuration hash",
  );
  assert(
    decimalBigInt(postState.positionLock.tokenId, "locked token ID", {
      positive: true,
    }) === decimalBigInt(evidence.positionTokenId, "position token ID") &&
      decimalBigInt(postState.positionLock.positionLiquidity, "position liquidity", {
        positive: true,
      }) > 0n &&
      decimalBigInt(postState.positionLock.activePoolLiquidity, "active pool liquidity", {
        positive: true,
      }) > 0n &&
      postState.positionLock.tickLower === 174_800 &&
      postState.positionLock.tickUpper === 204_200 &&
      decimalBigInt(postState.positionLock.timelockBlockNumber, "position timelock") ===
        (1n << 256n) - 1n,
    "Bonding position custody differs",
  );
  assertExactKeys(
    postState.tokenCustody,
    ["totalSupply", "lockedTokenDust", "launcherBalance", "positionManagerBalance"],
    "Token custody",
  );
  assert(
    decimalBigInt(postState.tokenCustody.totalSupply, "token supply") ===
      1_000_000_000n * 10n ** 18n &&
      decimalBigInt(postState.tokenCustody.lockedTokenDust, "locked token dust") >=
        0n &&
      decimalBigInt(postState.tokenCustody.launcherBalance, "launcher token balance") ===
        0n &&
      decimalBigInt(
        postState.tokenCustody.positionManagerBalance,
        "position manager token balance",
      ) === 0n,
    "Token custody differs",
  );
  assertExactKeys(
    postState.derivedCodeHashes,
    [
      "token",
      "rewardVault",
      "graduationVault",
      "positionForwarder",
      "rewardVaultPredeployed",
      "graduationVaultPredeployed",
      "positionForwarderPredeployed",
    ],
    "Derived code hashes",
  );
  for (const name of [
    "token",
    "rewardVault",
    "graduationVault",
    "positionForwarder",
  ]) {
    assertNonzeroBytes32(postState.derivedCodeHashes[name], `${name} code hash`);
  }
  assert(
    typeof postState.derivedCodeHashes.rewardVaultPredeployed === "boolean" &&
      typeof postState.derivedCodeHashes.graduationVaultPredeployed ===
        "boolean" &&
      typeof postState.derivedCodeHashes.positionForwarderPredeployed === "boolean",
    "Derived deployment provenance differs",
  );

  assertExactKeys(
    evidence.observations,
    ["exclusiveHookActivity", "sellApprovals"],
    "Lifecycle observations",
  );
  assertExactKeys(
    evidence.observations.exclusiveHookActivity,
    [
      "fromBlock",
      "toBlock",
      "nativeAccrualEvents",
      "creatorClaimEvents",
      "launcherClaimEvents",
    ],
    "Exclusive hook activity",
  );
  const exclusive = evidence.observations.exclusiveHookActivity;
  assert(
    exclusive.fromBlock === evidence.actions.launch.blockNumber &&
      exclusive.toBlock === evidence.verificationBlock &&
      exclusive.nativeAccrualEvents === 5 &&
      exclusive.creatorClaimEvents === 1 &&
      exclusive.launcherClaimEvents === 1,
    "Exclusive hook activity differs",
  );
  assertExactKeys(
    evidence.observations.sellApprovals,
    ["sellExactInput", "sellExactOutput"],
    "Sell approvals",
  );
  for (const action of ["sellExactInput", "sellExactOutput"]) {
    const approval = evidence.observations.sellApprovals[action];
    assertExactKeys(
      approval,
      [
        "blockNumber",
        "erc20AllowanceToPermit2",
        "permit2AllowanceToRouter",
        "permit2Expiration",
        "permit2Nonce",
        "requiredAmount",
      ],
      `${action} approval`,
    );
    const required = decimalBigInt(approval.requiredAmount, `${action} required approval`, {
      positive: true,
    });
    assert(
      approval.blockNumber === evidence.actions[action].blockNumber - 1 &&
        required === BigInt(evidence.swaps[action].inputBound) &&
        decimalBigInt(approval.erc20AllowanceToPermit2, `${action} ERC20 allowance`) >=
          required &&
        decimalBigInt(
          approval.permit2AllowanceToRouter,
          `${action} Permit2 allowance`,
        ) >= required &&
        decimalBigInt(approval.permit2Expiration, `${action} Permit2 expiration`) >=
          BigInt(evidence.actions[action].blockTimestamp) &&
        decimalBigInt(approval.permit2Nonce, `${action} Permit2 nonce`) >= 0n,
      `${action} approval evidence differs`,
    );
  }

  const invariantKeys = [
    "launchVerified",
    "bondingLifecycleVerified",
    "positionLockVerified",
    "buyExactInputVerified",
    "buyExactOutputVerified",
    "sellExactInputVerified",
    "sellExactOutputVerified",
    "creatorClaimVerified",
    "launcherClaimVerified",
    "feeConservationVerified",
  ];
  assertExactKeys(evidence.invariants, invariantKeys, "Lifecycle invariants");
  for (const invariant of invariantKeys) {
    assert(evidence.invariants[invariant] === true, `Missing ${invariant}`);
  }
  return evidence;
}

export function createClassicV4ReleaseManifest({
  plan,
  deploymentEvidence,
  sourceEvidence,
  lifecycleEvidence,
  capturedAt,
}) {
  const deployment = validateClassicV4DeploymentEvidence(
    plan,
    deploymentEvidence,
  );
  validateClassicV4SourceEvidence(plan, deploymentEvidence, sourceEvidence);
  validateClassicV4LifecycleEvidence(
    plan,
    deploymentEvidence,
    sourceEvidence,
    lifecycleEvidence,
  );
  assertIsoTimestamp(capturedAt, "capture timestamp");
  const addresses = {
    deployer: plan.deployer,
    launcherFeeRecipient: plan.launcherFeeRecipient,
    ...Object.fromEntries(
      Object.entries(plan.sharedDependencies).map(([name, value]) => [
        name,
        value.address,
      ]),
    ),
    ...plan.predictedAddresses,
  };
  const runtimeCodeHashes = {
    ...Object.fromEntries(
      Object.entries(plan.sharedDependencies).map(([name, value]) => [
        name,
        value.runtimeCodeHash,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(deploymentEvidence.contracts).map(([name, value]) => [
        name,
        value.runtimeCodeHash,
      ]),
    ),
  };
  const deploymentTransactions = Object.fromEntries(
    Object.entries(deploymentEvidence.contracts).map(([name, value]) => [
      name,
      value.transactionHash,
    ]),
  );
  const deploymentBlocks = Object.fromEntries(
    Object.entries(deploymentEvidence.contracts).map(([name, value]) => [
      name,
      value.blockNumber,
    ]),
  );
  const manifest = {
    schemaVersion: 1,
    model: "classic",
    internalContractRelease: CLASSIC_V4_RELEASE,
    releaseStatus: "deployment-source-and-lifecycle-verified",
    chainId: 1,
    releaseCommit: plan.releaseCommit,
    releaseTree: plan.releaseTree,
    sourceCommitment: plan.sourceCommitment,
    planDigest: plan.planDigest,
    capturedAt,
    startBlock: deployment.startBlock,
    addresses,
    deploymentTransactions,
    deploymentBlocks,
    deploymentVerification: {
      evidenceDigest: deploymentEvidence.evidenceDigest,
      checkedAt: deploymentEvidence.checkedAt,
      verificationBlock: deploymentEvidence.verificationBlock,
      verificationBlockHash: deploymentEvidence.verificationBlockHash,
      contractBlockHashes: Object.fromEntries(
        Object.entries(deploymentEvidence.contracts).map(([name, value]) => [
          name,
          value.blockHash,
        ]),
      ),
      confirmations: Object.fromEntries(
        Object.entries(deploymentEvidence.contracts).map(([name, value]) => [
          name,
          value.confirmations,
        ]),
      ),
    },
    runtimeCodeHashes,
    runtimeTemplateHashes: Object.fromEntries(
      Object.entries(plan.runtimeTemplates).map(([name, value]) => [
        name,
        value.runtimeTemplateHash,
      ]),
    ),
    officialDependencies: plan.officialDependencies,
    sharedDependencies: plan.sharedDependencies,
    verification: {
      deploymentLive: true,
      deploymentFinalized: true,
      independentRpcCount: deploymentEvidence.independentRpcCount,
      runtimeCodeVerified: true,
      constructorBindingsVerified: true,
      sourceVerified: true,
      lifecycleVerified: true,
      indexerActivated: false,
      publicAvailable: false,
    },
    sourceVerification: sourceEvidence,
    lifecycleEvidence,
    indexerHandoff: {
      schemaVersion: 1,
      chainId: 1,
      model: "classic",
      releaseVersion: CLASSIC_V4_RELEASE,
      releaseCommit: plan.releaseCommit,
      sourceCommitment: plan.sourceCommitment,
      startBlock: deployment.startBlock,
      sources: {
        launcher: {
          address: plan.predictedAddresses.launcher,
          startBlock: deploymentBlocks.launcher,
          events: [...CLASSIC_V4_INDEXER_LAUNCHER_EVENTS],
        },
        feeHook: {
          address: plan.predictedAddresses.feeHook,
          startBlock: deploymentBlocks.feeHook,
          events: [...CLASSIC_V4_INDEXER_HOOK_EVENTS],
        },
      },
      sourceVerified: true,
      lifecycleVerified: true,
      activationEligible: true,
      indexerBindingDigest: null,
      activated: false,
    },
  };
  return {
    ...manifest,
    manifestDigest: digestJson(
      manifest,
      CLASSIC_V4_DIGEST_DOMAINS.releaseManifest,
    ),
  };
}

export function buildClassicV4LifecycleCanaryPlan(manifest, wallet) {
  assert(
    manifest?.internalContractRelease === CLASSIC_V4_RELEASE &&
      manifest?.chainId === 1 &&
      manifest?.verification?.deploymentLive === true &&
      manifest?.verification?.runtimeCodeVerified === true &&
      manifest?.verification?.constructorBindingsVerified === true &&
      manifest?.verification?.sourceVerified === true,
    "Classic V4 deployment is not ready for a lifecycle canary",
  );
  const operatorWallet = canonicalNonzeroAddress(wallet, "canary wallet");
  const releaseBindingDigest = assertBytes32(
    manifest.manifestDigest ?? manifest.releaseBindingDigest,
    "release binding digest",
  );
  const creatorSalt = digestJson(
    {
      purpose: "programmable-classic-v4-mainnet-lifecycle-canary",
      releaseBindingDigest,
      operatorWallet,
    },
    CLASSIC_V4_DIGEST_DOMAINS.canaryCreatorSalt,
  );
  const plan = {
    schemaVersion: 1,
    status: "preparation-only",
    chainId: 1,
    releaseVersion: CLASSIC_V4_RELEASE,
    releaseCommit: manifest.releaseCommit,
    sourceCommitment: manifest.sourceCommitment,
    releaseBindingDigest,
    operatorWallet,
    launcher: manifest.addresses.launcher,
    feeHook: manifest.addresses.feeHook,
    treasury: manifest.addresses.launcherFeeRecipient,
    dependencies: {
      poolManager: manifest.officialDependencies.poolManager.address,
      positionManager: manifest.officialDependencies.positionManager.address,
      stateView: manifest.officialDependencies.stateView.address,
      v4Quoter: manifest.officialDependencies.v4Quoter.address,
      permit2: manifest.officialDependencies.permit2.address,
      universalRouter: manifest.officialDependencies.universalRouter.address,
    },
    universalRouterBinding: {
      version: "V2_0",
      sourceRef: "d2d9c4a",
      runtimeCodeHash:
        manifest.officialDependencies.universalRouter.runtimeCodeHash,
      executeSelector: "0x3593564c",
      v4SwapCommand: "0x10",
      exactInputSingleAction: "0x06",
      exactOutputSingleAction: "0x08",
      settleAllAction: "0x0c",
      takeAllAction: "0x0f",
    },
    launchFixture: {
      name: "Programmable Classic V4 Canary",
      symbol: "PCV4C",
      creatorSalt,
      metadata: {
        description: "Programmable Classic V4 Mainnet lifecycle canary",
        website: "https://programmable.market",
        image: "",
        extraData: "0x",
      },
      liquidityPreset: 1,
      buySwapFeeBps: 100,
      sellSwapFeeBps: 200,
      initialBuyWei: "600000000000000",
      custodyMode: "unlocked",
      beneficiarySharesBps: [10_000],
      reason:
        "Bonding exercises the finite 80/20 curve and non-minimum fees make both claim paths non-zero.",
    },
    swapFixture: {
      quotePolicy: "canonical-v4-quoter-at-parent-block",
      slippageBps: 100,
      deadlineSeconds: 300,
      buyExactInput: {
        amountIn: "100000000000000",
      },
      buyExactOutput: {
        amountOut: "1000000000000000000",
        hardMaximumAmountIn: "100000000000000",
        refund: "outer-native-sweep-to-operator",
      },
      sellExactInput: {
        amountIn: "1000000000000000000",
      },
      sellExactOutput: {
        amountOut: "1000000000",
        hardMaximumAmountIn: "10000000000000000000000",
        refund: "permit2-pulls-only-realized-debt",
      },
    },
    actions: [
      {
        key: "launch",
        kind: "launcher",
        requiredSigner: operatorWallet,
        requiresWalletSignature: true,
      },
      {
        key: "buyExactInput",
        kind: "universal-router",
        quote: "V4Quoter.quoteExactInputSingle",
        guard: "amountOutMinimum>0 and deadline<=5m",
        requiredSigner: operatorWallet,
        requiresWalletSignature: true,
      },
      {
        key: "buyExactOutput",
        kind: "universal-router",
        quote: "V4Quoter.quoteExactOutputSingle",
        guard: "amountInMaximum>0 and deadline<=5m",
        requiredSigner: operatorWallet,
        requiresWalletSignature: true,
      },
      {
        key: "sellExactInput",
        kind: "permit2-universal-router",
        quote: "V4Quoter.quoteExactInputSingle",
        guard: "amountOutMinimum>0 and deadline<=5m",
        requiredSigner: operatorWallet,
        requiresWalletSignature: true,
      },
      {
        key: "sellExactOutput",
        kind: "permit2-universal-router",
        quote: "V4Quoter.quoteExactOutputSingle",
        guard: "amountInMaximum>0 and deadline<=5m",
        requiredSigner: operatorWallet,
        requiresWalletSignature: true,
      },
      {
        key: "creatorClaim",
        kind: "reward-vault-claim",
        guard:
          "hook poolFeeConfig.creatorFeesAccrued>0 or reward vault claim() eth_call succeeds, and exact canary pool reward vault",
        requiredSigner: operatorWallet,
        requiresWalletSignature: true,
      },
      {
        key: "launcherClaim",
        kind: "hook-launcher-claim",
        guard: "caller and recipient equal immutable treasury",
        requiredSigner: manifest.addresses.launcherFeeRecipient,
        requiresWalletSignature: true,
      },
    ],
    requiredReadbacks: [
      "pool key and pool id",
      "bonding vault, position owner, final lock and liquidity",
      "all four swap receipts and HookSwap/HookFee reconciliation",
      "creator and launcher accrual before and after claims",
      "fee conservation across PoolManager claims and hook accounting",
      "two independent RPCs with at least 12 confirmations",
    ],
    executionBoundary: {
      signs: false,
      broadcasts: false,
      writes: false,
      humanWalletRequired: true,
    },
  };
  return {
    ...plan,
    planDigest: digestJson(
      plan,
      CLASSIC_V4_DIGEST_DOMAINS.lifecycleCanaryPlan,
    ),
  };
}
