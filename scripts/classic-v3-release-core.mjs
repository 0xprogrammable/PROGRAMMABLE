import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  getCreate2Address,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

export const EXPECTED_ACCOUNT =
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E";
export const TREASURY = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const INITIAL_CTO_AUTHORITY = EXPECTED_ACCOUNT;
export const REVIEWED_SOURCE_COMMITMENT =
  "0x58991ed1743aaba5f1988a4576d36eb10af70b96bdb61661ba96e1f80acc9800";
export const MAINNET_CHAIN_ID = 1;
export const MAINNET_CHAIN_ID_HEX = "0x1";
export const REQUIRED_HOOK_FLAGS = 8_396n;
export const HOOK_ADDRESS_MASK = (1n << 14n) - 1n;
export const FINALITY_CONFIRMATIONS = 12;
export const GAS_PADDING_BPS = 12_000n;
export const MAX_FEE_PER_GAS_WEI = 100_000_000_000n;
export const MAX_PRIORITY_FEE_PER_GAS_WEI = 5_000_000_000n;
export const MIN_PRIORITY_FEE_PER_GAS_WEI = 100_000_000n;

export const DEFAULT_RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];

export const MAINNET_DEPENDENCIES = {
  poolManager: {
    address: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    runtimeCodeHash:
      "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
  },
  positionManager: {
    address: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
    runtimeCodeHash:
      "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b",
  },
  stateView: {
    address: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
    runtimeCodeHash:
      "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878",
  },
  v4Quoter: {
    address: "0x52F0E24D1c21C8A0cb1e5a5DD6198556BD9E1203",
    runtimeCodeHash:
      "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441",
  },
  uerc20Factory: {
    address: "0x000000e200088D55C39a11F609E5F667729ad49b",
    runtimeCodeHash:
      "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
  },
  permit2: {
    address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    runtimeCodeHash:
      "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131",
  },
  universalRouter: {
    address: "0xd92A36B0000531EF3063dEd4De20A0783308446C",
    runtimeCodeHash:
      "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49",
  },
  positionForwarderFactory: {
    address: "0x291a9ff1059d225d02B1659430804486404dB507",
    runtimeCodeHash:
      "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2",
  },
};

const DEPLOYMENT_MANIFEST =
  "contracts/deployments/mainnet-classic-v3.json";
const FOUNDRY_DRY_RUN =
  "contracts/broadcast/DeployClassicV3InfrastructureV1.s.sol/1/dry-run/run-latest.json";
const ARTIFACTS = {
  ctoAuthority:
    "contracts/out/ClassicCtoAuthorityV1.sol/ClassicCtoAuthorityV1.json",
  rewardVaultFactory:
    "contracts/out/ClassicRewardVaultFactoryV1.sol/ClassicRewardVaultFactoryV1.json",
  initialBuyVestingWalletFactory:
    "contracts/out/ClassicInitialBuyVestingWalletFactoryV1.sol/ClassicInitialBuyVestingWalletFactoryV1.json",
  launchPolicy:
    "contracts/out/ClassicLaunchPolicyV1.sol/ClassicLaunchPolicyV1.json",
  hookFactory:
    "contracts/out/EthCreatorFeeHookFactoryV3.sol/EthCreatorFeeHookFactoryV3.json",
  feeHook: "contracts/out/EthCreatorFeeHookV3.sol/EthCreatorFeeHookV3.json",
  launcher: "contracts/out/MemeLaunchV2.sol/MemeLaunchV2.json",
};

const hookFactoryAbi = parseAbi([
  "function deploy(bytes32 salt,address poolManager,address launcherFeeRecipient,address feeSplitVaultFactory) returns (address hook)",
  "function isFactoryHook(address hook) view returns (bool)",
  "function ALL_HOOK_MASK() view returns (uint160)",
  "function REQUIRED_HOOK_FLAGS() view returns (uint160)",
]);
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
const initialBuyVestingWalletFactoryAbi = parseAbi([
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

function normalizeHex(value) {
  return String(value ?? "").toLowerCase();
}

function normalizeQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function canonicalAddress(value) {
  return getAddress(String(value).toLowerCase());
}

function assertHex(value, label, bytes) {
  const expression =
    bytes === undefined
      ? /^0x[0-9a-f]+$/i
      : new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`, "i");
  if (typeof value !== "string" || !expression.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.toLowerCase();
}

function addressResult(address) {
  return encodeAbiParameters([{ type: "address" }], [
    canonicalAddress(address),
  ]);
}

function uintResult(value, type = "uint256") {
  return encodeAbiParameters([{ type }], [BigInt(value)]);
}

function intResult(value, type = "int256") {
  return encodeAbiParameters([{ type }], [BigInt(value)]);
}

function boolResult(value) {
  return encodeAbiParameters([{ type: "bool" }], [value]);
}

function callCheck(label, target, abi, functionName, expected, args = []) {
  return {
    label,
    target: canonicalAddress(target),
    data: encodeFunctionData({ abi, functionName, args }),
    expected: normalizeHex(expected),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return typeof value === "bigint" ? value.toString() : value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function jsonDigest(value) {
  return keccak256(stringToHex(stableStringify(value)));
}

function artifactBytecode(artifact, label) {
  const value = artifact?.bytecode?.object;
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`${label} creation bytecode is unavailable`);
  }
  return value;
}

function artifactRuntime(artifact, label) {
  const value = artifact?.deployedBytecode?.object;
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`${label} runtime bytecode is unavailable`);
  }
  return value;
}

function dependencyAddresses() {
  return [
    MAINNET_DEPENDENCIES.poolManager.address,
    MAINNET_DEPENDENCIES.positionManager.address,
    MAINNET_DEPENDENCIES.stateView.address,
    MAINNET_DEPENDENCIES.v4Quoter.address,
    MAINNET_DEPENDENCIES.uerc20Factory.address,
    MAINNET_DEPENDENCIES.permit2.address,
    MAINNET_DEPENDENCIES.universalRouter.address,
    MAINNET_DEPENDENCIES.positionForwarderFactory.address,
    TREASURY,
    INITIAL_CTO_AUTHORITY,
  ];
}

export function computeClassicV3SourceCommitment(artifacts) {
  const creationCodeHashes = [
    keccak256(
      artifactBytecode(
        artifacts.ctoAuthority,
        "ClassicCtoAuthorityV1",
      ),
    ),
    keccak256(
      artifactBytecode(
        artifacts.rewardVaultFactory,
        "ClassicRewardVaultFactoryV1",
      ),
    ),
    keccak256(
      artifactBytecode(
        artifacts.initialBuyVestingWalletFactory,
        "ClassicInitialBuyVestingWalletFactoryV1",
      ),
    ),
    keccak256(
      artifactBytecode(artifacts.launchPolicy, "ClassicLaunchPolicyV1"),
    ),
    keccak256(
      artifactBytecode(
        artifacts.hookFactory,
        "EthCreatorFeeHookFactoryV3",
      ),
    ),
    keccak256(
      artifactBytecode(artifacts.feeHook, "EthCreatorFeeHookV3"),
    ),
    keccak256(artifactBytecode(artifacts.launcher, "MemeLaunchV2")),
  ];
  const bytecodeCommitment = keccak256(
    encodeAbiParameters(
      Array.from({ length: 7 }, () => ({ type: "bytes32" })),
      creationCodeHashes,
    ),
  );

  const addresses = dependencyAddresses();
  const dependencyCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        ...addresses.map(() => ({ type: "address" })),
      ],
      [1n, ...addresses.map(canonicalAddress)],
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

export function assertReviewedClassicV3SourceCommitment(
  artifacts,
  manifestSourceCommitment,
) {
  if (
    normalizeHex(manifestSourceCommitment) !==
    REVIEWED_SOURCE_COMMITMENT
  ) {
    throw new Error("Classic V3 manifest source commitment drifted");
  }
  const computedSourceCommitment =
    computeClassicV3SourceCommitment(artifacts);
  if (computedSourceCommitment !== REVIEWED_SOURCE_COMMITMENT) {
    throw new Error(
      "Current Classic V3 artifacts do not match the reviewed source commitment",
    );
  }
  return computedSourceCommitment;
}

function assertManifestDependencyPin(manifest) {
  for (const [name, expected] of Object.entries(MAINNET_DEPENDENCIES)) {
    const actual = manifest?.officialDependencies?.[name];
    if (
      normalizeHex(actual?.address) !== normalizeHex(expected.address) ||
      normalizeHex(actual?.runtimeCodeHash) !==
        normalizeHex(expected.runtimeCodeHash)
    ) {
      throw new Error(`Classic V3 manifest drifted at ${name}`);
    }
  }
}

function assertCandidateField(candidate, field, expected) {
  if (normalizeHex(candidate?.[field]) !== normalizeHex(expected)) {
    throw new Error(`Classic V3 candidate plan drifted at ${field}`);
  }
}

export async function loadClassicV3ReleasePlan(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const [
    manifest,
    broadcast,
    ctoAuthority,
    rewardVaultFactory,
    initialBuyVestingWalletFactory,
    launchPolicy,
    hookFactory,
    feeHook,
    launcher,
  ] = await Promise.all([
      readFile(path.join(root, DEPLOYMENT_MANIFEST), "utf8").then(JSON.parse),
      readFile(path.join(root, FOUNDRY_DRY_RUN), "utf8").then(JSON.parse),
      readFile(path.join(root, ARTIFACTS.ctoAuthority), "utf8").then(
        JSON.parse,
      ),
      readFile(path.join(root, ARTIFACTS.rewardVaultFactory), "utf8").then(
        JSON.parse,
      ),
      readFile(
        path.join(root, ARTIFACTS.initialBuyVestingWalletFactory),
        "utf8",
      ).then(JSON.parse),
      readFile(path.join(root, ARTIFACTS.launchPolicy), "utf8").then(
        JSON.parse,
      ),
      readFile(path.join(root, ARTIFACTS.hookFactory), "utf8").then(JSON.parse),
      readFile(path.join(root, ARTIFACTS.feeHook), "utf8").then(JSON.parse),
      readFile(path.join(root, ARTIFACTS.launcher), "utf8").then(JSON.parse),
    ]);
  const artifacts = {
    ctoAuthority,
    rewardVaultFactory,
    initialBuyVestingWalletFactory,
    launchPolicy,
    hookFactory,
    feeHook,
    launcher,
  };

  if (manifest.schemaVersion !== 1 || manifest.chainId !== MAINNET_CHAIN_ID) {
    throw new Error("Classic V3 release manifest is not for Ethereum Mainnet");
  }
  assertManifestDependencyPin(manifest);

  assertReviewedClassicV3SourceCommitment(
    artifacts,
    manifest.sourceCommitment,
  );

  if (
    broadcast.chain !== MAINNET_CHAIN_ID ||
    !Array.isArray(broadcast.transactions) ||
    broadcast.transactions.length !== 7
  ) {
    throw new Error(
      "Classic V3 Foundry simulation must contain exactly seven Mainnet transactions",
    );
  }
  if (
    !Array.isArray(broadcast.receipts) ||
    broadcast.receipts.length !== 0 ||
    !Array.isArray(broadcast.pending) ||
    broadcast.pending.length !== 0 ||
    broadcast.transactions.some((entry) => entry.hash !== null)
  ) {
    throw new Error(
      "Classic V3 plan must come from a simulation without broadcast receipts",
    );
  }

  const entries = broadcast.transactions;
  const expectedTypes = [
    "CREATE",
    "CREATE",
    "CREATE",
    "CREATE",
    "CREATE",
    "CALL",
    "CREATE",
  ];
  const expectedContracts = [
    "ClassicCtoAuthorityV1",
    "ClassicRewardVaultFactoryV1",
    "ClassicInitialBuyVestingWalletFactoryV1",
    "ClassicLaunchPolicyV1",
    "EthCreatorFeeHookFactoryV3",
    "EthCreatorFeeHookFactoryV3",
    "MemeLaunchV2",
  ];
  const startingNonce = Number(BigInt(entries[0]?.transaction?.nonce));
  if (!Number.isSafeInteger(startingNonce) || startingNonce < 0) {
    throw new Error("Invalid Classic V3 starting nonce");
  }

  for (const [index, entry] of entries.entries()) {
    const transaction = entry?.transaction ?? {};
    if (
      entry.transactionType !== expectedTypes[index] ||
      entry.contractName !== expectedContracts[index]
    ) {
      throw new Error(
        `Unexpected contract or transaction type at Classic V3 step ${index + 1}`,
      );
    }
    if (
      normalizeHex(transaction.from) !== normalizeHex(EXPECTED_ACCOUNT) ||
      normalizeHex(transaction.chainId) !== MAINNET_CHAIN_ID_HEX ||
      normalizeQuantity(transaction.value) !== "0x0" ||
      Number(BigInt(transaction.nonce)) !== startingNonce + index
    ) {
      throw new Error(
        `Classic V3 step ${index + 1} sender, chain, value or nonce drifted`,
      );
    }
    if (
      typeof transaction.input !== "string" ||
      !/^0x[0-9a-f]+$/i.test(transaction.input) ||
      BigInt(transaction.gas) <= 0n
    ) {
      throw new Error(`Classic V3 step ${index + 1} is incomplete`);
    }
  }

  const [
    ctoEntry,
    rewardVaultEntry,
    custodyFactoryEntry,
    launchPolicyEntry,
    factoryEntry,
    hookEntry,
    launcherEntry,
  ] = entries;
  const ctoAddress = canonicalAddress(ctoEntry.contractAddress);
  const rewardVaultFactoryAddress = canonicalAddress(
    rewardVaultEntry.contractAddress,
  );
  const custodyFactoryAddress = canonicalAddress(
    custodyFactoryEntry.contractAddress,
  );
  const launchPolicyAddress = canonicalAddress(
    launchPolicyEntry.contractAddress,
  );
  const factoryAddress = canonicalAddress(factoryEntry.contractAddress);
  const hookAddress = canonicalAddress(
    hookEntry.additionalContracts?.[0]?.address,
  );
  const launcherAddress = canonicalAddress(
    launcherEntry.contractAddress,
  );
  const hookSalt = manifest?.candidatePlan?.hookSalt;
  assertHex(hookSalt, "Classic V3 hook salt", 32);

  const expectedCreateAddresses = [
    getContractAddress({
      from: EXPECTED_ACCOUNT,
      nonce: BigInt(startingNonce),
    }),
    getContractAddress({
      from: EXPECTED_ACCOUNT,
      nonce: BigInt(startingNonce + 1),
    }),
    getContractAddress({
      from: EXPECTED_ACCOUNT,
      nonce: BigInt(startingNonce + 2),
    }),
    getContractAddress({
      from: EXPECTED_ACCOUNT,
      nonce: BigInt(startingNonce + 3),
    }),
    getContractAddress({
      from: EXPECTED_ACCOUNT,
      nonce: BigInt(startingNonce + 4),
    }),
    hookAddress,
    getContractAddress({
      from: EXPECTED_ACCOUNT,
      nonce: BigInt(startingNonce + 6),
    }),
  ];
  if (
    normalizeHex(ctoAddress) !== normalizeHex(expectedCreateAddresses[0]) ||
    normalizeHex(rewardVaultFactoryAddress) !==
      normalizeHex(expectedCreateAddresses[1]) ||
    normalizeHex(custodyFactoryAddress) !==
      normalizeHex(expectedCreateAddresses[2]) ||
    normalizeHex(launchPolicyAddress) !==
      normalizeHex(expectedCreateAddresses[3]) ||
    normalizeHex(factoryAddress) !== normalizeHex(expectedCreateAddresses[4]) ||
    normalizeHex(launcherAddress) !== normalizeHex(expectedCreateAddresses[6])
  ) {
    throw new Error("Classic V3 CREATE address prediction drifted");
  }

  const expectedCtoInput =
    artifactBytecode(ctoAuthority, "ClassicCtoAuthorityV1") +
    encodeAbiParameters(
      [{ type: "address" }],
      [canonicalAddress(INITIAL_CTO_AUTHORITY)],
    ).slice(2);
  const expectedRewardVaultFactoryInput =
    artifactBytecode(
      rewardVaultFactory,
      "ClassicRewardVaultFactoryV1",
    ) +
    encodeAbiParameters(
      [{ type: "address" }],
      [ctoAddress],
    ).slice(2);
  if (
    normalizeHex(ctoEntry.transaction.input) !==
      normalizeHex(expectedCtoInput) ||
    normalizeHex(rewardVaultEntry.transaction.input) !==
      normalizeHex(expectedRewardVaultFactoryInput) ||
    normalizeHex(custodyFactoryEntry.transaction.input) !==
      normalizeHex(
        artifactBytecode(
          initialBuyVestingWalletFactory,
          "ClassicInitialBuyVestingWalletFactoryV1",
        ),
      ) ||
    normalizeHex(launchPolicyEntry.transaction.input) !==
      normalizeHex(
        artifactBytecode(launchPolicy, "ClassicLaunchPolicyV1"),
      ) ||
    normalizeHex(factoryEntry.transaction.input) !==
      normalizeHex(
        artifactBytecode(hookFactory, "EthCreatorFeeHookFactoryV3"),
      )
  ) {
    throw new Error(
      "Classic V3 creation bytecode or constructor arguments differ from the reviewed artifacts",
    );
  }

  if (
    normalizeHex(hookEntry.transaction.to) !== normalizeHex(factoryAddress) ||
    hookEntry.function !== "deploy(bytes32,address,address,address)" ||
    hookEntry.additionalContracts?.length !== 1 ||
    hookEntry.additionalContracts[0]?.transactionType !== "CREATE2" ||
    hookEntry.additionalContracts[0]?.contractName !== "EthCreatorFeeHookV3"
  ) {
    throw new Error("Classic V3 hook deployment shape drifted");
  }
  const decodedHookCall = decodeFunctionData({
    abi: hookFactoryAbi,
    data: hookEntry.transaction.input,
  });
  const [
    decodedSalt,
    decodedPoolManager,
    decodedTreasury,
    decodedVaultFactory,
  ] = decodedHookCall.args;
  if (
    normalizeHex(decodedSalt) !== normalizeHex(hookSalt) ||
    normalizeHex(decodedPoolManager) !==
      normalizeHex(MAINNET_DEPENDENCIES.poolManager.address) ||
    normalizeHex(decodedTreasury) !== normalizeHex(TREASURY) ||
    normalizeHex(decodedVaultFactory) !==
      normalizeHex(rewardVaultFactoryAddress)
  ) {
    throw new Error("Classic V3 hook deployment arguments drifted");
  }
  const hookConstructorArguments = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
    ],
    [
      canonicalAddress(MAINNET_DEPENDENCIES.poolManager.address),
      TREASURY,
      rewardVaultFactoryAddress,
    ],
  );
  const expectedHookInitCode =
    artifactBytecode(feeHook, "EthCreatorFeeHookV3") +
    hookConstructorArguments.slice(2);
  if (
    normalizeHex(hookEntry.additionalContracts[0]?.initCode) !==
      normalizeHex(expectedHookInitCode) ||
    normalizeHex(
      getCreate2Address({
        from: factoryAddress,
        salt: hookSalt,
        bytecodeHash: keccak256(expectedHookInitCode),
      }),
    ) !== normalizeHex(hookAddress) ||
    (BigInt(hookAddress) & HOOK_ADDRESS_MASK) !== REQUIRED_HOOK_FLAGS
  ) {
    throw new Error("Classic V3 hook CREATE2 commitment drifted");
  }

  const expectedHookCall = encodeFunctionData({
    abi: hookFactoryAbi,
    functionName: "deploy",
    args: [
      hookSalt,
      canonicalAddress(MAINNET_DEPENDENCIES.poolManager.address),
      TREASURY,
      rewardVaultFactoryAddress,
    ],
  });
  if (
    normalizeHex(hookEntry.transaction.input) !==
    normalizeHex(expectedHookCall)
  ) {
    throw new Error("Classic V3 hook factory calldata drifted");
  }

  const launcherConstructorArguments = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
    ],
    [
      canonicalAddress(MAINNET_DEPENDENCIES.poolManager.address),
      canonicalAddress(MAINNET_DEPENDENCIES.positionManager.address),
      canonicalAddress(MAINNET_DEPENDENCIES.uerc20Factory.address),
      hookAddress,
      rewardVaultFactoryAddress,
      custodyFactoryAddress,
      launchPolicyAddress,
      canonicalAddress(
        MAINNET_DEPENDENCIES.positionForwarderFactory.address,
      ),
    ],
  );
  const expectedLauncherInput =
    artifactBytecode(launcher, "MemeLaunchV2") +
    launcherConstructorArguments.slice(2);
  if (
    normalizeHex(launcherEntry.transaction.input) !==
    normalizeHex(expectedLauncherInput)
  ) {
    throw new Error(
      "Classic V3 launcher creation bytecode or constructor arguments drifted",
    );
  }

  const returnValue = String(broadcast?.returns?.result?.value ?? "");
  if (
    !returnValue.toLowerCase().includes(REVIEWED_SOURCE_COMMITMENT) ||
    !returnValue.toLowerCase().includes(normalizeHex(hookSalt))
  ) {
    throw new Error(
      "Classic V3 simulation return does not contain the reviewed commitments",
    );
  }

  const candidate = manifest.candidatePlan;
  if (
    candidate?.transactionCount !== 7 ||
    candidate?.startingNonce !== startingNonce
  ) {
    throw new Error("Classic V3 candidate plan nonce or count drifted");
  }
  assertCandidateField(candidate, "deployer", EXPECTED_ACCOUNT);
  assertCandidateField(candidate, "ctoAuthority", ctoAddress);
  assertCandidateField(
    candidate,
    "rewardVaultFactory",
    rewardVaultFactoryAddress,
  );
  assertCandidateField(
    candidate,
    "initialBuyVestingWalletFactory",
    custodyFactoryAddress,
  );
  assertCandidateField(candidate, "launchPolicy", launchPolicyAddress);
  assertCandidateField(candidate, "hookFactory", factoryAddress);
  assertCandidateField(candidate, "feeHook", hookAddress);
  assertCandidateField(candidate, "launcher", launcherAddress);
  assertCandidateField(candidate, "hookSalt", hookSalt);

  const shared = {
    chainId: MAINNET_CHAIN_ID_HEX,
    from: EXPECTED_ACCOUNT,
    value: "0x0",
  };
  const transactions = [
    {
      ...shared,
      name: "ClassicCtoAuthorityV1",
      label: "CTO authority",
      transactionType: "CREATE",
      address: ctoAddress,
      to: null,
      nonce: normalizeQuantity(ctoEntry.transaction.nonce),
      data: ctoEntry.transaction.input,
      inputHash: keccak256(ctoEntry.transaction.input),
      reviewedGasLimit: normalizeQuantity(ctoEntry.transaction.gas),
      runtimeCodeHash: keccak256(
        artifactRuntime(ctoAuthority, "ClassicCtoAuthorityV1"),
      ),
      runtimeBytes:
        (artifactRuntime(
          ctoAuthority,
          "ClassicCtoAuthorityV1",
        ).length -
          2) /
        2,
      checks: [
        callCheck(
          "current CTO authority",
          ctoAddress,
          ctoAuthorityAbi,
          "authority",
          addressResult(INITIAL_CTO_AUTHORITY),
        ),
      ],
    },
    {
      ...shared,
      name: "ClassicRewardVaultFactoryV1",
      label: "Reward vault factory",
      transactionType: "CREATE",
      address: rewardVaultFactoryAddress,
      to: null,
      nonce: normalizeQuantity(rewardVaultEntry.transaction.nonce),
      data: rewardVaultEntry.transaction.input,
      inputHash: keccak256(rewardVaultEntry.transaction.input),
      reviewedGasLimit: normalizeQuantity(
        rewardVaultEntry.transaction.gas,
      ),
      runtimeCodeHash: null,
      runtimeBytes:
        (artifactRuntime(
          rewardVaultFactory,
          "ClassicRewardVaultFactoryV1",
        ).length -
          2) /
        2,
      checks: [
        callCheck(
          "CTO authority binding",
          rewardVaultFactoryAddress,
          rewardVaultFactoryAbi,
          "ctoAuthority",
          addressResult(ctoAddress),
        ),
      ],
    },
    {
      ...shared,
      name: "ClassicInitialBuyVestingWalletFactoryV1",
      label: "Initial Buy custody factory",
      transactionType: "CREATE",
      address: custodyFactoryAddress,
      to: null,
      nonce: normalizeQuantity(custodyFactoryEntry.transaction.nonce),
      data: custodyFactoryEntry.transaction.input,
      inputHash: keccak256(custodyFactoryEntry.transaction.input),
      reviewedGasLimit: normalizeQuantity(
        custodyFactoryEntry.transaction.gas,
      ),
      runtimeCodeHash: keccak256(
        artifactRuntime(
          initialBuyVestingWalletFactory,
          "ClassicInitialBuyVestingWalletFactoryV1",
        ),
      ),
      runtimeBytes:
        (artifactRuntime(
          initialBuyVestingWalletFactory,
          "ClassicInitialBuyVestingWalletFactoryV1",
        ).length -
          2) /
        2,
      checks: [
        callCheck(
          "minimum custody duration",
          custodyFactoryAddress,
          initialBuyVestingWalletFactoryAbi,
          "MIN_DURATION_DAYS",
          uintResult(1, "uint16"),
        ),
        callCheck(
          "maximum custody duration",
          custodyFactoryAddress,
          initialBuyVestingWalletFactoryAbi,
          "MAX_DURATION_DAYS",
          uintResult(3_650, "uint16"),
        ),
      ],
    },
    {
      ...shared,
      name: "ClassicLaunchPolicyV1",
      label: "Launch policy",
      transactionType: "CREATE",
      address: launchPolicyAddress,
      to: null,
      nonce: normalizeQuantity(launchPolicyEntry.transaction.nonce),
      data: launchPolicyEntry.transaction.input,
      inputHash: keccak256(launchPolicyEntry.transaction.input),
      reviewedGasLimit: normalizeQuantity(
        launchPolicyEntry.transaction.gas,
      ),
      runtimeCodeHash: keccak256(
        artifactRuntime(launchPolicy, "ClassicLaunchPolicyV1"),
      ),
      runtimeBytes:
        (artifactRuntime(launchPolicy, "ClassicLaunchPolicyV1").length -
          2) /
        2,
      checks: [
        callCheck(
          "token name bytes",
          launchPolicyAddress,
          launchPolicyAbi,
          "MAX_TOKEN_NAME_BYTES",
          uintResult(48),
        ),
        callCheck(
          "token symbol bytes",
          launchPolicyAddress,
          launchPolicyAbi,
          "MAX_TOKEN_SYMBOL_BYTES",
          uintResult(12),
        ),
        callCheck(
          "token description bytes",
          launchPolicyAddress,
          launchPolicyAbi,
          "MAX_TOKEN_DESCRIPTION_BYTES",
          uintResult(280),
        ),
        callCheck(
          "metadata URL bytes",
          launchPolicyAddress,
          launchPolicyAbi,
          "MAX_METADATA_URL_BYTES",
          uintResult(2_048),
        ),
        callCheck(
          "social metadata bytes",
          launchPolicyAddress,
          launchPolicyAbi,
          "MAX_SOCIAL_EXTRA_DATA_BYTES",
          uintResult(1_200),
        ),
        callCheck(
          "maximum reward recipients",
          launchPolicyAddress,
          launchPolicyAbi,
          "MAX_REWARD_BENEFICIARIES",
          uintResult(5),
        ),
        callCheck(
          "reward share denominator",
          launchPolicyAddress,
          launchPolicyAbi,
          "REWARD_SHARE_BASIS_POINTS",
          uintResult(10_000, "uint16"),
        ),
      ],
    },
    {
      ...shared,
      name: "EthCreatorFeeHookFactoryV3",
      label: "Creator fee hook factory",
      transactionType: "CREATE",
      address: factoryAddress,
      to: null,
      nonce: normalizeQuantity(factoryEntry.transaction.nonce),
      data: factoryEntry.transaction.input,
      inputHash: keccak256(factoryEntry.transaction.input),
      reviewedGasLimit: normalizeQuantity(factoryEntry.transaction.gas),
      runtimeCodeHash: keccak256(
        artifactRuntime(hookFactory, "EthCreatorFeeHookFactoryV3"),
      ),
      runtimeBytes:
        (artifactRuntime(hookFactory, "EthCreatorFeeHookFactoryV3").length -
          2) /
        2,
      checks: [
        callCheck(
          "hook mask",
          factoryAddress,
          hookFactoryAbi,
          "ALL_HOOK_MASK",
          uintResult(HOOK_ADDRESS_MASK, "uint160"),
        ),
        callCheck(
          "required hook flags",
          factoryAddress,
          hookFactoryAbi,
          "REQUIRED_HOOK_FLAGS",
          uintResult(REQUIRED_HOOK_FLAGS, "uint160"),
        ),
      ],
    },
    {
      ...shared,
      name: "EthCreatorFeeHookV3",
      label: "Configurable creator fee hook",
      transactionType: "CALL",
      address: hookAddress,
      to: factoryAddress,
      nonce: normalizeQuantity(hookEntry.transaction.nonce),
      data: hookEntry.transaction.input,
      inputHash: keccak256(hookEntry.transaction.input),
      reviewedGasLimit: normalizeQuantity(hookEntry.transaction.gas),
      runtimeCodeHash: null,
      runtimeBytes:
        (artifactRuntime(feeHook, "EthCreatorFeeHookV3").length - 2) / 2,
      checks: [
        callCheck(
          "factory provenance",
          factoryAddress,
          hookFactoryAbi,
          "isFactoryHook",
          boolResult(true),
          [hookAddress],
        ),
        callCheck(
          "PoolManager",
          hookAddress,
          hookAbi,
          "poolManager",
          addressResult(MAINNET_DEPENDENCIES.poolManager.address),
        ),
        callCheck(
          "treasury",
          hookAddress,
          hookAbi,
          "launcherFeeRecipient",
          addressResult(TREASURY),
        ),
        callCheck(
          "reward vault factory",
          hookAddress,
          hookAbi,
          "feeSplitVaultFactory",
          addressResult(rewardVaultFactoryAddress),
        ),
        callCheck(
          "launcher fee",
          hookAddress,
          hookAbi,
          "LAUNCHER_FEE_BPS",
          uintResult(10, "uint16"),
        ),
        callCheck(
          "minimum total fee",
          hookAddress,
          hookAbi,
          "MIN_TOTAL_SWAP_FEE_BPS",
          uintResult(100, "uint16"),
        ),
        callCheck(
          "maximum total fee",
          hookAddress,
          hookAbi,
          "MAX_TOTAL_SWAP_FEE_BPS",
          uintResult(1_000, "uint16"),
        ),
        callCheck(
          "fee step",
          hookAddress,
          hookAbi,
          "TOTAL_SWAP_FEE_STEP_BPS",
          uintResult(100, "uint16"),
        ),
        callCheck(
          "zero transfer tax",
          hookAddress,
          hookAbi,
          "TRANSFER_TAX_BPS",
          uintResult(0, "uint16"),
        ),
        callCheck(
          "zero LP fee",
          hookAddress,
          hookAbi,
          "LP_FEE_PIPS",
          uintResult(0, "uint24"),
        ),
        callCheck(
          "tick spacing",
          hookAddress,
          hookAbi,
          "TICK_SPACING",
          intResult(200, "int24"),
        ),
      ],
    },
    {
      ...shared,
      name: "MemeLaunchV2",
      label: "Classic launcher",
      transactionType: "CREATE",
      address: launcherAddress,
      to: null,
      nonce: normalizeQuantity(launcherEntry.transaction.nonce),
      data: launcherEntry.transaction.input,
      inputHash: keccak256(launcherEntry.transaction.input),
      reviewedGasLimit: normalizeQuantity(launcherEntry.transaction.gas),
      runtimeCodeHash: null,
      runtimeBytes:
        (artifactRuntime(launcher, "MemeLaunchV2").length - 2) / 2,
      checks: [
        callCheck(
          "PoolManager",
          launcherAddress,
          launcherAbi,
          "poolManager",
          addressResult(MAINNET_DEPENDENCIES.poolManager.address),
        ),
        callCheck(
          "PositionManager",
          launcherAddress,
          launcherAbi,
          "positionManager",
          addressResult(MAINNET_DEPENDENCIES.positionManager.address),
        ),
        callCheck(
          "UERC20 factory",
          launcherAddress,
          launcherAbi,
          "tokenFactory",
          addressResult(MAINNET_DEPENDENCIES.uerc20Factory.address),
        ),
        callCheck(
          "creator fee hook",
          launcherAddress,
          launcherAbi,
          "feeHook",
          addressResult(hookAddress),
        ),
        callCheck(
          "reward vault factory",
          launcherAddress,
          launcherAbi,
          "rewardVaultFactory",
          addressResult(rewardVaultFactoryAddress),
        ),
        callCheck(
          "Initial Buy custody factory",
          launcherAddress,
          launcherAbi,
          "initialBuyVestingWalletFactory",
          addressResult(custodyFactoryAddress),
        ),
        callCheck(
          "launch policy",
          launcherAddress,
          launcherAbi,
          "launchPolicy",
          addressResult(launchPolicyAddress),
        ),
        callCheck(
          "locked position factory",
          launcherAddress,
          launcherAbi,
          "positionForwarderFactory",
          addressResult(
            MAINNET_DEPENDENCIES.positionForwarderFactory.address,
          ),
        ),
        callCheck(
          "minimum Initial Buy",
          launcherAddress,
          launcherAbi,
          "MIN_INITIAL_BUY_WEI",
          uintResult(600_000_000_000_000n),
        ),
        callCheck(
          "token supply",
          launcherAddress,
          launcherAbi,
          "TOKEN_SUPPLY",
          uintResult(1_000_000_000n * 10n ** 18n),
        ),
        callCheck(
          "maximum beneficiaries",
          launcherAddress,
          launcherAbi,
          "MAX_REWARD_BENEFICIARIES",
          uintResult(5),
        ),
        callCheck(
          "reward share denominator",
          launcherAddress,
          launcherAbi,
          "REWARD_SHARE_BASIS_POINTS",
          uintResult(10_000, "uint16"),
        ),
        callCheck(
          "zero LP fee",
          launcherAddress,
          launcherAbi,
          "LP_FEE_PIPS",
          uintResult(0, "uint24"),
        ),
        callCheck(
          "tick spacing",
          launcherAddress,
          launcherAbi,
          "TICK_SPACING",
          intResult(200, "int24"),
        ),
      ],
    },
  ];

  const reviewedGas = transactions.reduce(
    (total, transaction) =>
      total + BigInt(transaction.reviewedGasLimit),
    0n,
  );
  if (BigInt(candidate.estimatedGas) !== reviewedGas) {
    throw new Error("Classic V3 candidate gas commitment drifted");
  }

  const planCommitment = {
    chainId: MAINNET_CHAIN_ID,
    expectedAccount: EXPECTED_ACCOUNT,
    sourceCommitment: REVIEWED_SOURCE_COMMITMENT,
    startingNonce,
    hookSalt: normalizeHex(hookSalt),
    transactions: transactions.map((transaction) => ({
      name: transaction.name,
      transactionType: transaction.transactionType,
      address: transaction.address,
      to: transaction.to,
      nonce: transaction.nonce,
      value: transaction.value,
      inputHash: transaction.inputHash,
      reviewedGasLimit: transaction.reviewedGasLimit,
    })),
  };

  return {
    schemaVersion: 1,
    release: "classic-v3",
    network: "Ethereum Mainnet",
    chainId: MAINNET_CHAIN_ID,
    chainIdHex: MAINNET_CHAIN_ID_HEX,
    explorer: "https://etherscan.io",
    expectedAccount: EXPECTED_ACCOUNT,
    treasury: TREASURY,
    sourceCommitment: REVIEWED_SOURCE_COMMITMENT,
    sourceArtifactCommitments: {
      ctoAuthority: keccak256(
        artifactBytecode(
          ctoAuthority,
          "ClassicCtoAuthorityV1",
        ),
      ),
      rewardVaultFactory: keccak256(
        artifactBytecode(
          rewardVaultFactory,
          "ClassicRewardVaultFactoryV1",
        ),
      ),
      initialBuyVestingWalletFactory: keccak256(
        artifactBytecode(
          initialBuyVestingWalletFactory,
          "ClassicInitialBuyVestingWalletFactoryV1",
        ),
      ),
      launchPolicy: keccak256(
        artifactBytecode(launchPolicy, "ClassicLaunchPolicyV1"),
      ),
      hookFactory: keccak256(
        artifactBytecode(hookFactory, "EthCreatorFeeHookFactoryV3"),
      ),
      feeHook: keccak256(
        artifactBytecode(feeHook, "EthCreatorFeeHookV3"),
      ),
      launcher: keccak256(
        artifactBytecode(launcher, "MemeLaunchV2"),
      ),
    },
    simulationCommit: String(broadcast.commit ?? ""),
    simulationTimestamp: broadcast.timestamp,
    simulationDigest: jsonDigest(
      transactions.map((transaction) => ({
        nonce: transaction.nonce,
        address: transaction.address,
        inputHash: transaction.inputHash,
        reviewedGasLimit: transaction.reviewedGasLimit,
      })),
    ),
    planDigest: jsonDigest(planCommitment),
    startingNonce,
    endingNonce: startingNonce + 7,
    hookSalt: normalizeHex(hookSalt),
    reviewedGas: reviewedGas.toString(),
    transactions,
  };
}

export function assertClassicV3SequenceState(plan, state) {
  const confirmedNonce = Number(BigInt(state.confirmedNonce));
  const pendingNonce = Number(BigInt(state.pendingNonce));
  if (confirmedNonce < plan.startingNonce) {
    throw new Error(
      "Confirmed nonce is outside the reviewed Classic V3 sequence",
    );
  }
  if (
    pendingNonce < confirmedNonce ||
    (confirmedNonce < plan.endingNonce && pendingNonce > plan.endingNonce)
  ) {
    throw new Error(
      "Pending nonce is outside the reviewed Classic V3 sequence",
    );
  }
  if (state.deployments.length !== plan.transactions.length) {
    throw new Error(
      "Deployment state does not match the seven reviewed transactions",
    );
  }

  const confirmedCount = Math.min(
    confirmedNonce - plan.startingNonce,
    plan.transactions.length,
  );
  if (
    confirmedNonce > plan.endingNonce &&
    state.deployments.some((deployment) => !deployment.verified)
  ) {
    throw new Error(
      "Deployment wallet moved past the sequence before all Classic V3 contracts verified",
    );
  }
  state.deployments.forEach((deployment, index) => {
    if (index < confirmedCount && !deployment.verified) {
      throw new Error(
        "A reviewed nonce confirmed without the expected Classic V3 deployment",
      );
    }
    if (index >= confirmedCount && deployment.verified) {
      throw new Error(
        "Expected Classic V3 code exists before its reviewed nonce",
      );
    }
  });
  return confirmedCount;
}

export function recommendFeePolicy(state) {
  const baseFee = BigInt(state.baseFeePerGas);
  const observedGasPrice = BigInt(state.gasPrice);
  let priority =
    observedGasPrice > baseFee
      ? observedGasPrice - baseFee
      : MIN_PRIORITY_FEE_PER_GAS_WEI;
  if (priority < MIN_PRIORITY_FEE_PER_GAS_WEI) {
    priority = MIN_PRIORITY_FEE_PER_GAS_WEI;
  }
  priority = (priority * 125n + 99n) / 100n;
  if (priority > MAX_PRIORITY_FEE_PER_GAS_WEI) {
    throw new Error("Observed Mainnet priority fee exceeds the release cap");
  }

  const marketBuffer = (observedGasPrice * 125n + 99n) / 100n;
  const baseFeeBuffer = baseFee * 2n + priority;
  const maxFee =
    marketBuffer > baseFeeBuffer ? marketBuffer : baseFeeBuffer;
  if (maxFee > MAX_FEE_PER_GAS_WEI) {
    throw new Error("Observed Mainnet fee exceeds the release cap");
  }
  return {
    maxFeePerGas: normalizeQuantity(maxFee),
    maxPriorityFeePerGas: normalizeQuantity(priority),
  };
}

export function classicV3CostRequirement(plan, state) {
  const confirmedCount = assertClassicV3SequenceState(plan, state);
  const feePolicy = recommendFeePolicy(state);
  const remainingGas = plan.transactions
    .slice(confirmedCount)
    .reduce(
      (total, item) => total + BigInt(item.reviewedGasLimit),
      0n,
    );
  const requiredBalance =
    remainingGas * BigInt(feePolicy.maxFeePerGas);
  const balance = BigInt(state.balance);
  return {
    remainingGas: normalizeQuantity(remainingGas),
    maxFeePerGas: feePolicy.maxFeePerGas,
    maxPriorityFeePerGas: feePolicy.maxPriorityFeePerGas,
    requiredBalance: normalizeQuantity(requiredBalance),
    balance: normalizeQuantity(balance),
    shortfall:
      balance < requiredBalance
        ? normalizeQuantity(requiredBalance - balance)
        : "0x0",
    sufficient: balance >= requiredBalance,
  };
}

export function prepareReviewedTransaction(plan, state, simulations) {
  const confirmedCount = assertClassicV3SequenceState(plan, state);
  if (state.confirmedNonce !== state.pendingNonce) {
    throw new Error("Another transaction is pending from the deployment wallet");
  }
  if (confirmedCount === plan.transactions.length) return null;
  if (!Array.isArray(simulations) || simulations.length !== 2) {
    throw new Error("Two independent live simulations are required");
  }

  const transaction = plan.transactions[confirmedCount];
  const simulationResults = simulations.map((simulation, index) => {
    if (
      normalizeHex(simulation.callResult) !==
      normalizeHex(simulations[0].callResult)
    ) {
      throw new Error("Independent Mainnet simulations disagree");
    }
    const gas = BigInt(simulation.estimatedGas);
    if (gas <= 21_000n) {
      throw new Error(`RPC ${index + 1} returned an invalid gas estimate`);
    }
    return gas;
  });
  const highEstimate = simulationResults.reduce((highest, current) =>
    current > highest ? current : highest,
  );
  const lowEstimate = simulationResults.reduce((lowest, current) =>
    current < lowest ? current : lowest,
  );
  if (highEstimate * 100n > lowEstimate * 105n) {
    throw new Error("Independent Mainnet gas estimates differ by more than 5%");
  }
  const paddedEstimate =
    (highEstimate * GAS_PADDING_BPS + 9_999n) / 10_000n;
  const reviewedGasLimit = BigInt(transaction.reviewedGasLimit);
  if (paddedEstimate > reviewedGasLimit) {
    throw new Error(
      `${transaction.name} live gas estimate exceeds its reviewed gas limit`,
    );
  }

  const cost = classicV3CostRequirement(plan, state);
  if (!cost.sufficient) {
    throw new Error(
      "Deployment wallet balance is below the current seven-step gas ceiling",
    );
  }

  const request = {
    from: EXPECTED_ACCOUNT,
    chainId: MAINNET_CHAIN_ID_HEX,
    nonce: transaction.nonce,
    value: transaction.value,
    data: transaction.data,
    gas: transaction.reviewedGasLimit,
    maxFeePerGas: cost.maxFeePerGas,
    maxPriorityFeePerGas: cost.maxPriorityFeePerGas,
    type: "0x2",
  };
  if (transaction.to) request.to = transaction.to;

  return {
    index: confirmedCount,
    name: transaction.name,
    label: transaction.label,
    address: transaction.address,
    inputHash: transaction.inputHash,
    liveEstimatedGas: normalizeQuantity(highEstimate),
    reviewedGasLimit: transaction.reviewedGasLimit,
    requiredBalance: cost.requiredBalance,
    request,
    preparedDigest: jsonDigest({
      planDigest: plan.planDigest,
      index: confirmedCount,
      request,
    }),
  };
}

function transactionComparison(transaction) {
  if (!transaction) return null;
  return {
    hash: normalizeHex(transaction.hash),
    from: normalizeHex(transaction.from),
    to: transaction.to ? normalizeHex(transaction.to) : null,
    nonce: normalizeQuantity(transaction.nonce),
    value: normalizeQuantity(transaction.value),
    input: normalizeHex(transaction.input),
    chainId: transaction.chainId
      ? normalizeQuantity(transaction.chainId)
      : null,
    gas: normalizeQuantity(transaction.gas),
    maxFeePerGas: transaction.maxFeePerGas
      ? normalizeQuantity(transaction.maxFeePerGas)
      : null,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
      ? normalizeQuantity(transaction.maxPriorityFeePerGas)
      : null,
    blockNumber: transaction.blockNumber
      ? normalizeQuantity(transaction.blockNumber)
      : null,
    blockHash: transaction.blockHash
      ? normalizeHex(transaction.blockHash)
      : null,
  };
}

function receiptComparison(receipt) {
  if (!receipt) return null;
  return {
    transactionHash: normalizeHex(receipt.transactionHash),
    status: normalizeQuantity(receipt.status),
    from: normalizeHex(receipt.from),
    to: receipt.to ? normalizeHex(receipt.to) : null,
    contractAddress: receipt.contractAddress
      ? normalizeHex(receipt.contractAddress)
      : null,
    blockNumber: normalizeQuantity(receipt.blockNumber),
    blockHash: normalizeHex(receipt.blockHash),
    transactionIndex: normalizeQuantity(receipt.transactionIndex),
    gasUsed: normalizeQuantity(receipt.gasUsed),
    effectiveGasPrice: receipt.effectiveGasPrice
      ? normalizeQuantity(receipt.effectiveGasPrice)
      : null,
  };
}

export function validateClassicV3TransactionRecord(
  plan,
  index,
  transaction,
  receipt,
) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= plan.transactions.length
  ) {
    throw new Error("Invalid Classic V3 transaction index");
  }
  const expected = plan.transactions[index];
  const actual = transactionComparison(transaction);
  if (!actual) throw new Error("Transaction is not visible on both Mainnet RPCs");
  assertHex(actual.hash, "transaction hash", 32);

  if (
    actual.from !== normalizeHex(EXPECTED_ACCOUNT) ||
    actual.to !== (expected.to ? normalizeHex(expected.to) : null) ||
    actual.nonce !== expected.nonce ||
    actual.value !== "0x0" ||
    actual.input !== normalizeHex(expected.data) ||
    actual.chainId !== MAINNET_CHAIN_ID_HEX
  ) {
    throw new Error(
      `${expected.name} transaction does not match the reviewed request`,
    );
  }
  if (BigInt(actual.gas) > BigInt(expected.reviewedGasLimit)) {
    throw new Error(`${expected.name} gas limit exceeds the reviewed ceiling`);
  }
  if (
    actual.maxFeePerGas === null ||
    BigInt(actual.maxFeePerGas) > MAX_FEE_PER_GAS_WEI ||
    actual.maxPriorityFeePerGas === null ||
    BigInt(actual.maxPriorityFeePerGas) >
      MAX_PRIORITY_FEE_PER_GAS_WEI
  ) {
    throw new Error(`${expected.name} fee policy exceeds the release cap`);
  }

  const normalizedReceipt = receiptComparison(receipt);
  if (!normalizedReceipt) {
    return {
      status: "pending",
      transaction: actual,
      receipt: null,
    };
  }
  if (
    normalizedReceipt.transactionHash !== actual.hash ||
    normalizedReceipt.status !== "0x1" ||
    normalizedReceipt.from !== normalizeHex(EXPECTED_ACCOUNT) ||
    normalizedReceipt.to !== (expected.to ? normalizeHex(expected.to) : null) ||
    normalizedReceipt.blockNumber !== actual.blockNumber ||
    normalizedReceipt.blockHash !== actual.blockHash
  ) {
    throw new Error(`${expected.name} receipt does not match the transaction`);
  }
  const expectedContractAddress =
    expected.transactionType === "CREATE"
      ? normalizeHex(expected.address)
      : null;
  if (normalizedReceipt.contractAddress !== expectedContractAddress) {
    throw new Error(`${expected.name} receipt has an unexpected contract address`);
  }

  return {
    status: "confirmed",
    transaction: actual,
    receipt: normalizedReceipt,
  };
}

export function createClassicV3Evidence(plan, now = new Date()) {
  return {
    schemaVersion: 1,
    release: "classic-v3",
    network: "Ethereum Mainnet",
    chainId: MAINNET_CHAIN_ID,
    expectedAccount: EXPECTED_ACCOUNT,
    treasury: TREASURY,
    sourceCommitment: plan.sourceCommitment,
    planDigest: plan.planDigest,
    simulationDigest: plan.simulationDigest,
    startingNonce: plan.startingNonce,
    endingNonce: plan.endingNonce,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    finalityConfirmations: FINALITY_CONFIRMATIONS,
    transactions: plan.transactions.map((transaction, index) => ({
      index,
      name: transaction.name,
      address: transaction.address,
      nonce: transaction.nonce,
      inputHash: transaction.inputHash,
      reviewedGasLimit: transaction.reviewedGasLimit,
      txHash: null,
      status: "not-submitted",
      confirmations: 0,
      transaction: null,
      receipt: null,
      deploymentVerified: false,
    })),
    receiptEvidenceReady: false,
  };
}

export function mergeClassicV3EvidenceRecord(
  evidence,
  plan,
  index,
  record,
  latestBlock,
  deploymentVerified,
  now = new Date(),
) {
  if (
    evidence.planDigest !== plan.planDigest ||
    evidence.sourceCommitment !== plan.sourceCommitment
  ) {
    throw new Error("Local release evidence belongs to a different plan");
  }
  const current = evidence.transactions[index];
  if (!current || current.inputHash !== plan.transactions[index].inputHash) {
    throw new Error("Local release evidence transaction shape drifted");
  }
  if (
    current.txHash &&
    current.txHash !== record.transaction.hash
  ) {
    throw new Error("A different transaction hash is already recorded");
  }

  let confirmations = 0;
  let status = record.status;
  if (record.receipt) {
    confirmations =
      Number(BigInt(latestBlock) - BigInt(record.receipt.blockNumber)) + 1;
    if (confirmations < 1) {
      throw new Error("Receipt block is ahead of the reconciled Mainnet head");
    }
    if (confirmations >= FINALITY_CONFIRMATIONS && deploymentVerified) {
      status = "finalized";
    }
  }

  evidence.transactions[index] = {
    ...current,
    txHash: record.transaction.hash,
    status,
    confirmations,
    transaction: record.transaction,
    receipt: record.receipt,
    deploymentVerified: Boolean(deploymentVerified),
  };
  evidence.updatedAt = now.toISOString();
  evidence.receiptEvidenceReady = evidence.transactions.every(
    (entry) =>
      entry.status === "finalized" &&
      entry.deploymentVerified &&
      entry.receipt?.status === "0x1",
  );
  return evidence;
}

export async function readClassicV3Evidence(filePath, plan) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (
      parsed.schemaVersion !== 1 ||
      parsed.release !== "classic-v3" ||
      parsed.planDigest !== plan.planDigest ||
      parsed.sourceCommitment !== plan.sourceCommitment ||
      !Array.isArray(parsed.transactions) ||
      parsed.transactions.length !== plan.transactions.length
    ) {
      throw new Error("Local Classic V3 evidence does not match this plan");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return createClassicV3Evidence(plan);
    throw error;
  }
}

export async function writeClassicV3Evidence(filePath, evidence) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, filePath);
}

export function publicPlan(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    release: plan.release,
    network: plan.network,
    chainId: plan.chainId,
    explorer: plan.explorer,
    expectedAccount: plan.expectedAccount,
    treasury: plan.treasury,
    sourceCommitment: plan.sourceCommitment,
    sourceArtifactCommitments: plan.sourceArtifactCommitments,
    simulationCommit: plan.simulationCommit,
    simulationTimestamp: plan.simulationTimestamp,
    simulationDigest: plan.simulationDigest,
    planDigest: plan.planDigest,
    startingNonce: plan.startingNonce,
    endingNonce: plan.endingNonce,
    hookSalt: plan.hookSalt,
    reviewedGas: plan.reviewedGas,
    transactions: plan.transactions.map((transaction) => ({
      name: transaction.name,
      label: transaction.label,
      transactionType: transaction.transactionType,
      address: transaction.address,
      to: transaction.to,
      nonce: transaction.nonce,
      value: transaction.value,
      inputHash: transaction.inputHash,
      reviewedGasLimit: transaction.reviewedGasLimit,
    })),
  };
}
