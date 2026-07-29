#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  concatHex,
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  getCreateAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

const root = path.resolve(import.meta.dirname, "..", "..");
const contractsRoot = path.join(root, "contracts");
const appManifestPath = path.join(
  contractsRoot,
  "config",
  "app-deployments.v1.json",
);
const requireLive = process.argv.includes("--require-live");
const requestedNetwork =
  process.argv
    .find((argument) => argument.startsWith("--network="))
    ?.split("=")[1] ?? "all";
const hookMask = (1n << 14n) - 1n;
const requiredHookFlags = 8_396n;
const expectedTreasury = getAddress(
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
);
const initialCtoAuthority = getAddress(
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
);

const networkDefinitions = {
  mainnet: {
    chain: mainnet,
    environment: "production",
    releasePath: path.join(
      contractsRoot,
      "deployments",
      "mainnet-classic-v3.json",
    ),
    rpcUrls: [
      process.env.ETHEREUM_RPC_URL,
      "https://eth.drpc.org",
      "https://ethereum-rpc.publicnode.com",
    ].filter(Boolean),
  },
  sepolia: {
    chain: sepolia,
    environment: "rehearsal",
    releasePath: path.join(
      contractsRoot,
      "deployments",
      "sepolia-classic-v3.json",
    ),
    rpcUrls: [
      process.env.SEPOLIA_RPC_URL,
      "https://sepolia.drpc.org",
      "https://ethereum-sepolia-rpc.publicnode.com",
    ].filter(Boolean),
  },
};

const artifactPaths = {
  ctoAuthority: path.join(
    contractsRoot,
    "out",
    "ClassicCtoAuthorityV1.sol",
    "ClassicCtoAuthorityV1.json",
  ),
  rewardVaultFactory: path.join(
    contractsRoot,
    "out",
    "ClassicRewardVaultFactoryV1.sol",
    "ClassicRewardVaultFactoryV1.json",
  ),
  initialBuyVestingWalletFactory: path.join(
    contractsRoot,
    "out",
    "ClassicInitialBuyVestingWalletFactoryV1.sol",
    "ClassicInitialBuyVestingWalletFactoryV1.json",
  ),
  launchPolicy: path.join(
    contractsRoot,
    "out",
    "ClassicLaunchPolicyV1.sol",
    "ClassicLaunchPolicyV1.json",
  ),
  hookFactory: path.join(
    contractsRoot,
    "out",
    "EthCreatorFeeHookFactoryV3.sol",
    "EthCreatorFeeHookFactoryV3.json",
  ),
  feeHookTemplate: path.join(
    contractsRoot,
    "out",
    "EthCreatorFeeHookV3.sol",
    "EthCreatorFeeHookV3.json",
  ),
  launcherTemplate: path.join(
    contractsRoot,
    "out",
    "MemeLaunchV2.sol",
    "MemeLaunchV2.json",
  ),
};

const hookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function LAUNCHER_FEE_BPS() view returns (uint16)",
  "function MIN_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function MAX_TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function TOTAL_SWAP_FEE_STEP_BPS() view returns (uint16)",
  "function TRANSFER_TAX_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
]);
const launcherAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function rewardVaultFactory() view returns (address)",
  "function initialBuyVestingWalletFactory() view returns (address)",
  "function launchPolicy() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function MAX_REWARD_BENEFICIARIES() view returns (uint256)",
  "function REWARD_SHARE_BASIS_POINTS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
]);
const ctoAuthorityAbi = parseAbi([
  "function authority() view returns (address)",
]);
const rewardVaultFactoryAbi = parseAbi([
  "function ctoAuthority() view returns (address)",
]);
const custodyFactoryAbi = parseAbi([
  "function MIN_DURATION_DAYS() view returns (uint16)",
  "function MAX_DURATION_DAYS() view returns (uint16)",
]);
const launchPolicyAbi = parseAbi([
  "function MAX_TOKEN_NAME_BYTES() view returns (uint256)",
  "function MAX_TOKEN_SYMBOL_BYTES() view returns (uint256)",
  "function MAX_TOKEN_DESCRIPTION_BYTES() view returns (uint256)",
  "function MAX_METADATA_URL_BYTES() view returns (uint256)",
  "function MAX_SOCIAL_EXTRA_DATA_BYTES() view returns (uint256)",
  "function MAX_REWARD_BENEFICIARIES() view returns (uint256)",
  "function REWARD_SHARE_BASIS_POINTS() view returns (uint16)",
]);
const hookFactoryAbi = parseAbi([
  "function isFactoryHook(address hook) view returns (bool)",
]);
const positionFactoryAbi = parseAbi([
  "function positionManager() view returns (address)",
]);

function fail(message) {
  throw new Error(message);
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function validHash(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function unique(values) {
  return [...new Set(values)];
}

function artifactCreationCode(artifact, label) {
  const value = artifact?.bytecode?.object;
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    fail(`Missing creation bytecode for ${label}; run forge build first`);
  }
  return value;
}

function artifactRuntime(artifact, label) {
  const value = artifact?.deployedBytecode?.object;
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    fail(`Missing runtime bytecode for ${label}; run forge build first`);
  }
  return value;
}

async function loadArtifacts() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(artifactPaths).map(async ([name, artifactPath]) => [
        name,
        await readJson(artifactPath),
      ]),
    ),
  );
}

function sourceCommitment(release, artifacts) {
  const creationHashes = [
    "ctoAuthority",
    "rewardVaultFactory",
    "initialBuyVestingWalletFactory",
    "launchPolicy",
    "hookFactory",
    "feeHookTemplate",
    "launcherTemplate",
  ].map((name) =>
    keccak256(artifactCreationCode(artifacts[name], name)),
  );
  const bytecodeCommitment = keccak256(
    encodeAbiParameters(
      Array.from({ length: 7 }, () => ({ type: "bytes32" })),
      creationHashes,
    ),
  );
  const dependencyAddresses = [
    release.officialDependencies.poolManager.address,
    release.officialDependencies.positionManager.address,
    release.officialDependencies.stateView.address,
    release.officialDependencies.v4Quoter.address,
    release.officialDependencies.uerc20Factory.address,
    release.officialDependencies.permit2.address,
    release.officialDependencies.universalRouter.address,
    release.officialDependencies.positionForwarderFactory.address,
    expectedTreasury,
    initialCtoAuthority,
  ].map((address) => getAddress(address));
  const dependencyCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        ...dependencyAddresses.map(() => ({ type: "address" })),
      ],
      [BigInt(release.chainId), ...dependencyAddresses],
    ),
  );
  const feeCommitment = keccak256(
    encodeAbiParameters(
      [
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
        100n,
        1_000n,
        100n,
        0n,
        200n,
        keccak256(stringToHex("immutable-directional-buy-and-sell-fees")),
      ],
    ),
  );
  const rewardCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        5n,
        10_000n,
        keccak256(stringToHex("beneficiary-owned-historic-rewards")),
        keccak256(stringToHex("prospective-payout-wallet-change")),
        keccak256(stringToHex("programmable-approved-prospective-cto")),
      ],
    ),
  );
  const launchCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        600_000_000_000_000n,
        1_000_000_000n * 10n ** 18n,
        1n,
        3_650n,
        keccak256(
          stringToHex(
            "unlocked-fixed-lock-linear-and-cliff-linear-initial-buy-custody",
          ),
        ),
        keccak256(stringToHex("immutable-initial-buy-beneficiary")),
        keccak256(
          stringToHex("one-sided-permanently-locked-official-v4-position"),
        ),
      ],
    ),
  );
  const economicsCommitment = keccak256(
    encodeAbiParameters(
      Array.from({ length: 3 }, () => ({ type: "bytes32" })),
      [feeCommitment, rewardCommitment, launchCommitment],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      Array.from({ length: 4 }, () => ({ type: "bytes32" })),
      [
        keccak256(
          stringToHex("programmable.classic.infrastructure.v3.ethereum"),
        ),
        bytecodeCommitment,
        dependencyCommitment,
        economicsCommitment,
      ],
    ),
  );
}

function verifyArtifacts(release, artifacts) {
  for (const [name, expected] of Object.entries(
    release.artifactRuntime,
  )) {
    const artifactName =
      name === "feeHookTemplate"
        ? "feeHookTemplate"
        : name === "launcherTemplate"
          ? "launcherTemplate"
          : name;
    const runtime = artifactRuntime(artifacts[artifactName], artifactName);
    const bytes = (runtime.length - 2) / 2;
    const hash = keccak256(runtime);
    if (expected.bytes !== bytes || expected.codeHash !== hash) {
      fail(
        `${name} artifact drift: bytes ${bytes}/${expected.bytes}, hash ${hash}/${expected.codeHash}`,
      );
    }
  }
  if (release.artifactRuntime.launcherTemplate.bytes > 23_000) {
    fail("Classic launcher exceeds the reviewed 23,000-byte release ceiling");
  }
  const expectedSourceCommitment = sourceCommitment(release, artifacts);
  if (release.sourceCommitment !== expectedSourceCommitment) {
    fail(
      `Classic source commitment drift: ${release.sourceCommitment}/${expectedSourceCommitment}`,
    );
  }
}

function verifyCandidatePlan(release, feeHookCreationCode) {
  const candidate = release.candidatePlan;
  if (
    !candidate ||
    candidate.status !== "simulation-only-refresh-before-signing"
  ) {
    fail("Classic candidate plan is missing its simulation-only status");
  }
  if (
    !isAddress(candidate.deployer) ||
    !Number.isSafeInteger(candidate.startingNonce) ||
    candidate.startingNonce < 0 ||
    candidate.transactionCount !== 7 ||
    !validHash(candidate.hookSalt) ||
    !/^[0-9]+$/.test(candidate.estimatedGas) ||
    BigInt(candidate.estimatedGas) === 0n
  ) {
    fail("Classic candidate plan identity is invalid");
  }

  const deployer = getAddress(candidate.deployer);
  const createAddress = (offset) =>
    getCreateAddress({
      from: deployer,
      nonce: BigInt(candidate.startingNonce + offset),
    });
  const ctoAuthority = createAddress(0);
  const rewardVaultFactory = createAddress(1);
  const initialBuyVestingWalletFactory = createAddress(2);
  const launchPolicy = createAddress(3);
  const hookFactory = createAddress(4);
  const launcher = createAddress(6);
  const constructorArguments = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
    ],
    [
      getAddress(release.officialDependencies.poolManager.address),
      expectedTreasury,
      rewardVaultFactory,
    ],
  );
  const feeHook = getCreate2Address({
    from: hookFactory,
    salt: candidate.hookSalt,
    bytecodeHash: keccak256(
      concatHex([feeHookCreationCode, constructorArguments]),
    ),
  });

  const expected = {
    ctoAuthority,
    rewardVaultFactory,
    initialBuyVestingWalletFactory,
    launchPolicy,
    hookFactory,
    feeHook,
    launcher,
  };
  for (const [field, address] of Object.entries(expected)) {
    if (!sameAddress(candidate[field], address)) {
      fail(`Classic candidate ${field} is not deterministic`);
    }
  }
  if ((BigInt(feeHook) & hookMask) !== requiredHookFlags) {
    fail("Classic candidate hook has the wrong callback permission bits");
  }
}

async function verifyDependencies(release, clients) {
  for (const [name, dependency] of Object.entries(
    release.officialDependencies,
  )) {
    if (!isAddress(dependency.address) || !validHash(dependency.runtimeCodeHash)) {
      fail(`Classic dependency ${name} is malformed`);
    }
    const codes = await Promise.all(
      clients.map((client) =>
        client.getCode({ address: getAddress(dependency.address) }),
      ),
    );
    for (const code of codes) {
      if (!code || code === "0x") {
        fail(`Classic dependency ${name} has no runtime code`);
      }
      const actual = keccak256(code);
      if (actual !== dependency.runtimeCodeHash) {
        fail(
          `Classic dependency ${name} runtime drift: ${actual} != ${dependency.runtimeCodeHash}`,
        );
      }
    }
  }
}

const releaseFields = [
  "ctoAuthority",
  "rewardVaultFactory",
  "initialBuyVestingWalletFactory",
  "launchPolicy",
  "hookFactory",
  "feeHook",
  "launcher",
];
const appFieldByReleaseField = {
  ctoAuthority: "classicCtoAuthorityV1",
  rewardVaultFactory: "classicRewardVaultFactoryV1",
  initialBuyVestingWalletFactory:
    "classicInitialBuyVestingWalletFactoryV1",
  launchPolicy: "classicLaunchPolicyV1",
  hookFactory: "ethCreatorFeeHookFactoryV3",
  feeHook: "ethCreatorFeeHookV3",
  launcher: "memeLaunchV2",
};

function assertDisabled(release, appRelease) {
  for (const field of releaseFields) {
    if (
      release.addresses[field] !== null ||
      release.transactions[field] !== null ||
      release.runtimeCodeHashes[field] !== null
    ) {
      fail(`Undeployed Classic manifest contains a populated ${field}`);
    }
    const appField = appFieldByReleaseField[field];
    if (
      appRelease[appField] !== null ||
      appRelease.runtimeCodeHashes[appField] !== null ||
      appRelease.deploymentBlocks[appField] !== null
    ) {
      fail(`Application manifest contains a populated ${appField}`);
    }
  }
  if (appRelease.classicV3Status !== "not-deployed") {
    fail("Application manifest disagrees with the disabled Classic release");
  }
}

async function verifyLiveRelease(release, appRelease, clients) {
  if (release.status !== "deployment-source-and-lifecycle-verified") {
    fail(`Unsupported live Classic release status: ${release.status}`);
  }
  if (
    !/^[a-f0-9]{40}$/.test(release.releaseCommit ?? "") ||
    !Number.isSafeInteger(release.startingNonce) ||
    release.startingNonce < 0 ||
    !validHash(release.hookSalt) ||
    release.sourceVerification?.status !== "verified" ||
    release.lifecycleEvidence?.status !== "verified-current-release" ||
    release.lifecycleEvidence?.releaseEligible !== true
  ) {
    fail(
      "Live Classic release lacks commit, deterministic plan, source verification or lifecycle evidence",
    );
  }

  for (const field of releaseFields) {
    const appField = appFieldByReleaseField[field];
    const address = release.addresses[field];
    const expectedHash = release.runtimeCodeHashes[field];
    if (!isAddress(address) || !validHash(expectedHash)) {
      fail(`Live Classic manifest is missing ${field}`);
    }
    if (
      !sameAddress(address, appRelease[appField]) ||
      expectedHash !== appRelease.runtimeCodeHashes[appField]
    ) {
      fail(`Application Classic ${field} differs from the release manifest`);
    }
    const codes = await Promise.all(
      clients.map((client) => client.getCode({ address: getAddress(address) })),
    );
    for (const code of codes) {
      if (!code || keccak256(code) !== expectedHash) {
        fail(`Deployed Classic ${field} runtime does not match`);
      }
    }
  }
  if (appRelease.classicV3Status !== "ready") {
    fail("Application Classic release is not ready");
  }

  const primary = clients[0];
  const addresses = Object.fromEntries(
    Object.entries(release.addresses)
      .filter(([, value]) => isAddress(value))
      .map(([key, value]) => [key, getAddress(value)]),
  );
  const dependencies = release.officialDependencies;
  const reads = await Promise.all([
    primary.readContract({
      address: addresses.hookFactory,
      abi: hookFactoryAbi,
      functionName: "isFactoryHook",
      args: [addresses.feeHook],
    }),
    primary.readContract({
      address: addresses.feeHook,
      abi: hookAbi,
      functionName: "poolManager",
    }),
    primary.readContract({
      address: addresses.feeHook,
      abi: hookAbi,
      functionName: "launcherFeeRecipient",
    }),
    primary.readContract({
      address: addresses.feeHook,
      abi: hookAbi,
      functionName: "feeSplitVaultFactory",
    }),
    ...[
      "LAUNCHER_FEE_BPS",
      "MIN_TOTAL_SWAP_FEE_BPS",
      "MAX_TOTAL_SWAP_FEE_BPS",
      "TOTAL_SWAP_FEE_STEP_BPS",
      "TRANSFER_TAX_BPS",
      "LP_FEE_PIPS",
      "TICK_SPACING",
    ].map((functionName) =>
      primary.readContract({
        address: addresses.feeHook,
        abi: hookAbi,
        functionName,
      }),
    ),
    ...[
      "poolManager",
      "positionManager",
      "tokenFactory",
      "feeHook",
      "rewardVaultFactory",
      "initialBuyVestingWalletFactory",
      "launchPolicy",
      "positionForwarderFactory",
      "MIN_INITIAL_BUY_WEI",
      "TOKEN_SUPPLY",
      "MAX_REWARD_BENEFICIARIES",
      "REWARD_SHARE_BASIS_POINTS",
      "LP_FEE_PIPS",
      "TICK_SPACING",
    ].map((functionName) =>
      primary.readContract({
        address: addresses.launcher,
        abi: launcherAbi,
        functionName,
      }),
    ),
    primary.readContract({
      address: addresses.ctoAuthority,
      abi: ctoAuthorityAbi,
      functionName: "authority",
    }),
    primary.readContract({
      address: addresses.rewardVaultFactory,
      abi: rewardVaultFactoryAbi,
      functionName: "ctoAuthority",
    }),
    primary.readContract({
      address: addresses.initialBuyVestingWalletFactory,
      abi: custodyFactoryAbi,
      functionName: "MIN_DURATION_DAYS",
    }),
    primary.readContract({
      address: addresses.initialBuyVestingWalletFactory,
      abi: custodyFactoryAbi,
      functionName: "MAX_DURATION_DAYS",
    }),
    ...[
      "MAX_TOKEN_NAME_BYTES",
      "MAX_TOKEN_SYMBOL_BYTES",
      "MAX_TOKEN_DESCRIPTION_BYTES",
      "MAX_METADATA_URL_BYTES",
      "MAX_SOCIAL_EXTRA_DATA_BYTES",
      "MAX_REWARD_BENEFICIARIES",
      "REWARD_SHARE_BASIS_POINTS",
    ].map((functionName) =>
      primary.readContract({
        address: addresses.launchPolicy,
        abi: launchPolicyAbi,
        functionName,
      }),
    ),
    primary.readContract({
      address: getAddress(
        release.officialDependencies.positionForwarderFactory.address,
      ),
      abi: positionFactoryAbi,
      functionName: "positionManager",
    }),
  ]);

  const [
    factoryProvenance,
    hookPoolManager,
    hookTreasury,
    hookRewardFactory,
    launcherFee,
    minimumFee,
    maximumFee,
    feeStep,
    transferTax,
    hookLpFee,
    hookTickSpacing,
    launcherPoolManager,
    launcherPositionManager,
    tokenFactory,
    launcherHook,
    launcherRewardFactory,
    launcherCustodyFactory,
    launcherPolicy,
    launcherPositionFactory,
    minimumInitialBuy,
    tokenSupply,
    maxBeneficiaries,
    shareDenominator,
    launcherLpFee,
    launcherTickSpacing,
    currentCtoAuthority,
    rewardFactoryCtoBinding,
    minimumCustodyDays,
    maximumCustodyDays,
    maxNameBytes,
    maxSymbolBytes,
    maxDescriptionBytes,
    maxMetadataUrlBytes,
    maxSocialDataBytes,
    policyMaxBeneficiaries,
    policyShareDenominator,
    positionFactoryManager,
  ] = reads;

  const addressExpectations = [
    [hookPoolManager, dependencies.poolManager.address, "hook PoolManager"],
    [hookTreasury, expectedTreasury, "treasury"],
    [hookRewardFactory, addresses.rewardVaultFactory, "hook reward factory"],
    [
      launcherPoolManager,
      dependencies.poolManager.address,
      "launcher PoolManager",
    ],
    [
      launcherPositionManager,
      dependencies.positionManager.address,
      "launcher PositionManager",
    ],
    [tokenFactory, dependencies.uerc20Factory.address, "UERC20 factory"],
    [launcherHook, addresses.feeHook, "launcher hook"],
    [
      launcherRewardFactory,
      addresses.rewardVaultFactory,
      "launcher reward factory",
    ],
    [
      launcherCustodyFactory,
      addresses.initialBuyVestingWalletFactory,
      "launcher custody factory",
    ],
    [launcherPolicy, addresses.launchPolicy, "launcher policy"],
    [
      launcherPositionFactory,
      dependencies.positionForwarderFactory.address,
      "launcher position factory",
    ],
    [currentCtoAuthority, initialCtoAuthority, "current CTO authority"],
    [
      rewardFactoryCtoBinding,
      addresses.ctoAuthority,
      "reward factory CTO binding",
    ],
    [
      positionFactoryManager,
      dependencies.positionManager.address,
      "position factory PositionManager",
    ],
  ];
  for (const [actual, expected, label] of addressExpectations) {
    if (!sameAddress(actual, expected)) {
      fail(`Classic ${label} mismatch`);
    }
  }

  const numericExpectations = [
    [launcherFee, 10n, "launcher fee"],
    [minimumFee, 100n, "minimum fee"],
    [maximumFee, 1_000n, "maximum fee"],
    [feeStep, 100n, "fee step"],
    [transferTax, 0n, "transfer tax"],
    [hookLpFee, 0n, "hook LP fee"],
    [hookTickSpacing, 200n, "hook tick spacing"],
    [minimumInitialBuy, 600_000_000_000_000n, "minimum Initial Buy"],
    [tokenSupply, 1_000_000_000n * 10n ** 18n, "token supply"],
    [maxBeneficiaries, 5n, "maximum beneficiaries"],
    [shareDenominator, 10_000n, "share denominator"],
    [launcherLpFee, 0n, "launcher LP fee"],
    [launcherTickSpacing, 200n, "launcher tick spacing"],
    [minimumCustodyDays, 1n, "minimum custody duration"],
    [maximumCustodyDays, 3_650n, "maximum custody duration"],
    [maxNameBytes, 48n, "maximum name bytes"],
    [maxSymbolBytes, 12n, "maximum symbol bytes"],
    [maxDescriptionBytes, 280n, "maximum description bytes"],
    [maxMetadataUrlBytes, 2_048n, "maximum metadata URL bytes"],
    [maxSocialDataBytes, 1_200n, "maximum social data bytes"],
    [policyMaxBeneficiaries, 5n, "policy maximum beneficiaries"],
    [policyShareDenominator, 10_000n, "policy share denominator"],
  ];
  for (const [actual, expected, label] of numericExpectations) {
    if (BigInt(actual) !== expected) {
      fail(`Classic ${label} mismatch`);
    }
  }
  if (
    factoryProvenance !== true ||
    (BigInt(addresses.feeHook) & hookMask) !== requiredHookFlags
  ) {
    fail("Classic hook provenance or permission bits mismatch");
  }
}

const selectedNetworks =
  requestedNetwork === "all"
    ? Object.keys(networkDefinitions)
    : [requestedNetwork];
for (const name of selectedNetworks) {
  if (!networkDefinitions[name]) fail(`Unsupported network ${name}`);
}

const appManifest = await readJson(appManifestPath);
const artifacts = await loadArtifacts();
const feeHookCreationCode = artifactCreationCode(
  artifacts.feeHookTemplate,
  "feeHookTemplate",
);

for (const name of selectedNetworks) {
  const definition = networkDefinitions[name];
  const release = await readJson(definition.releasePath);
  if (
    release.schemaVersion !== 1 ||
    release.model !== "classic" ||
    release.internalContractRelease !== "classic-v3" ||
    release.chainId !== definition.chain.id
  ) {
    fail(`${name} Classic release identity is invalid`);
  }
  if (!sameAddress(release.addresses.treasury, expectedTreasury)) {
    fail(`${name} Classic treasury mismatch`);
  }

  const clients = unique(definition.rpcUrls)
    .slice(0, 2)
    .map((rpcUrl) =>
      createPublicClient({
        chain: definition.chain,
        transport: http(rpcUrl, { retryCount: 1, timeout: 15_000 }),
      }),
    );
  if (clients.length < 2) fail(`${name} requires two independent RPCs`);

  verifyArtifacts(release, artifacts);
  verifyCandidatePlan(release, feeHookCreationCode);
  await verifyDependencies(release, clients);

  const appRelease = appManifest[definition.environment];
  if (release.status === "not-deployed") {
    assertDisabled(release, appRelease);
    if (requireLive) {
      fail(`${name} Classic configurable release is not deployed`);
    }
    const currentNonce = await clients[0].getTransactionCount({
      address: getAddress(release.candidatePlan.deployer),
    });
    const freshness =
      currentNonce === release.candidatePlan.startingNonce
        ? "candidate nonce is current"
        : `candidate nonce is stale (${release.candidatePlan.startingNonce}/${currentNonce})`;
    console.log(
      `${name}: artifacts, source commitment, deterministic plan and two-RPC dependency hashes match; deployment disabled; ${freshness}.`,
    );
    continue;
  }

  await verifyLiveRelease(release, appRelease, clients);
  console.log(
    `${name}: live Classic release, app manifest and two-RPC runtime evidence match.`,
  );
}
