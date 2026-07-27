#!/usr/bin/env node

import {
  concatHex,
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  getCreate2Address,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";
import { mainnet } from "viem/chains";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACTS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_RPCS = [
  "https://rpc.mevblocker.io",
  "https://mainnet.gateway.tenderly.co",
];
const MIN_CONFIRMATIONS = Number(process.env.MAINNET_MIN_CONFIRMATIONS ?? 12);
const REQUIRE_SOURCE_VERIFICATION =
  process.env.REQUIRE_SOURCE_VERIFICATION !== "0";

const OFFICIAL = {
  poolManager: {
    address: getAddress("0x000000000004444c5dc75cB358380D2e3dE08A90"),
    runtimeCodeHash:
      "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
  },
  positionManager: {
    address: getAddress("0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e"),
    runtimeCodeHash:
      "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b",
  },
  stateView: {
    address: getAddress("0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227"),
    runtimeCodeHash:
      "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878",
  },
  v4Quoter: {
    address: getAddress("0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203"),
    runtimeCodeHash:
      "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441",
  },
  uerc20Factory: {
    address: getAddress("0x000000e200088D55C39a11F609E5F667729ad49b"),
    runtimeCodeHash:
      "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
  },
  permit2: {
    address: getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"),
    runtimeCodeHash:
      "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131",
  },
  universalRouter: {
    address: getAddress("0xd92A36B0000531EF3063dEd4De20A0783308446C"),
    runtimeCodeHash:
      "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49",
  },
};

const TREASURY = getAddress("0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");
const REQUIRED_HOOK_FLAGS = 8396n;
const ALL_HOOK_MASK = (1n << 14n) - 1n;

const artifactDefinitions = {
  positionForwarderFactory: {
    contractName: "LockedPositionFeeForwarderFactoryV1",
    sourceName: "src/LockedPositionFeeForwarderFactoryV1.sol",
  },
  hookFactory: {
    contractName: "EthCreatorFeeHookFactoryV1",
    sourceName: "src/EthCreatorFeeHookFactoryV1.sol",
  },
  feeHook: {
    contractName: "EthCreatorFeeHookV1",
    sourceName: "src/EthCreatorFeeHookV1.sol",
  },
  memeLauncher: {
    contractName: "MemeLaunchV1",
    sourceName: "src/MemeLaunchV1.sol",
  },
};

const forwarderFactoryAbi = parseAbi([
  "function positionManager() view returns (address)",
  "function OPERATOR() view returns (address)",
  "function TIMELOCK_BLOCK() view returns (uint256)",
]);
const hookFactoryAbi = parseAbi([
  "function deploy(bytes32 salt,address poolManager,address launcherFeeRecipient) returns (address hook)",
  "function ALL_HOOK_MASK() view returns (uint160)",
  "function REQUIRED_HOOK_FLAGS() view returns (uint160)",
  "function configurationHashOf(address hook) view returns (bytes32)",
  "function isFactoryHook(address hook) view returns (bool)",
  "event EthCreatorFeeHookDeployed(address indexed hook,address indexed poolManager,address indexed launcherFeeRecipient,bytes32 salt,bytes32 configurationHash)",
]);
const feeHookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function LAUNCHER_FEE_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
  "function totalNativeFeesAccrued() view returns (uint256)",
  "function launcherFeesAccrued() view returns (uint256)",
]);
const memeLauncherAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
]);
const poolManagerClaimsAbi = parseAbi([
  "function balanceOf(address owner,uint256 id) view returns (uint256)",
]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sameHex(actual, expected, label) {
  assert(
    typeof actual === "string" &&
      actual.toLowerCase() === expected.toLowerCase(),
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function requiredHex(value, bytes, label) {
  assert(
    typeof value === "string" &&
      new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value),
    `${label} must be ${bytes} bytes`,
  );
  return value;
}

function requiredAddress(value, label) {
  try {
    return getAddress(value);
  } catch {
    fail(`${label} must be a valid address`);
  }
}

function stringify(value) {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

function help() {
  process.stdout.write(`Usage:
  MAINNET_RPC_URLS=https://rpc-a,https://rpc-b \\
  node contracts/scripts/verify-mainnet-meme-deployment.mjs <deployment.json>

Required deployment.json fields:
{
  "schemaVersion": 1,
  "chainId": 1,
  "deploymentBlock": 123,
  "startingNonce": 7,
  "sourceCommitment": "0x...",
  "hookSalt": "0x...",
  "addresses": {
    "deployer": "0x...",
    "positionForwarderFactory": "0x...",
    "hookFactory": "0x...",
    "feeHook": "0x...",
    "memeLauncher": "0x..."
  },
  "transactions": {
    "positionForwarderFactory": "0x...",
    "hookFactory": "0x...",
    "feeHook": "0x...",
    "memeLauncher": "0x..."
  },
  "runtimeCodeHashes": {
    "positionForwarderFactory": "0x...",
    "hookFactory": "0x...",
    "feeHook": "0x...",
    "memeLauncher": "0x..."
  }
}

The verifier is read-only. It requires two agreeing RPCs, confirmed successful
receipts, exact local creation calldata, exact immutable configuration, runtime
hash commitments, and (unless REQUIRE_SOURCE_VERIFICATION=0) a Sourcify full
match or verified Etherscan source for every owned contract.
`);
}

async function loadArtifact(definition) {
  const path = resolve(
    CONTRACTS_ROOT,
    "out",
    `${definition.contractName}.sol`,
    `${definition.contractName}.json`,
  );
  const artifact = JSON.parse(await readFile(path, "utf8"));
  const bytecode = artifact?.bytecode?.object;
  assert(
    typeof bytecode === "string" && bytecode.startsWith("0x"),
    `Missing compiled bytecode for ${definition.contractName}; run forge build`,
  );
  const settings = artifact?.metadata?.settings;
  assert(
    artifact?.metadata?.compiler?.version === "0.8.26+commit.8a97fa7a",
    `${definition.contractName} compiler drift`,
  );
  assert(
    settings?.optimizer?.enabled === true && settings?.optimizer?.runs === 1000,
    `${definition.contractName} optimizer drift`,
  );
  assert(
    settings?.evmVersion === "cancun",
    `${definition.contractName} EVM version drift`,
  );
  assert(
    settings?.metadata?.bytecodeHash === "none" &&
      settings?.metadata?.appendCBOR === false,
    `${definition.contractName} metadata settings drift`,
  );
  return { ...definition, artifact, bytecode };
}

function parseEvidence(raw) {
  assert(raw?.schemaVersion === 1, "Unsupported deployment schemaVersion");
  assert(raw?.chainId === 1, "deployment chainId must be 1");
  assert(
    Number.isSafeInteger(raw.deploymentBlock) && raw.deploymentBlock > 0,
    "deploymentBlock must be a positive safe integer",
  );
  assert(
    Number.isSafeInteger(raw.startingNonce) && raw.startingNonce >= 0,
    "startingNonce must be a non-negative safe integer",
  );

  const addresses = Object.fromEntries(
    [
      "deployer",
      "positionForwarderFactory",
      "hookFactory",
      "feeHook",
      "memeLauncher",
    ].map((key) => [
      key,
      requiredAddress(raw?.addresses?.[key], `addresses.${key}`),
    ]),
  );
  const transactions = Object.fromEntries(
    [
      "positionForwarderFactory",
      "hookFactory",
      "feeHook",
      "memeLauncher",
    ].map((key) => [
      key,
      requiredHex(raw?.transactions?.[key], 32, `transactions.${key}`),
    ]),
  );
  const runtimeCodeHashes = Object.fromEntries(
    [
      "positionForwarderFactory",
      "hookFactory",
      "feeHook",
      "memeLauncher",
    ].map((key) => [
      key,
      requiredHex(
        raw?.runtimeCodeHashes?.[key],
        32,
        `runtimeCodeHashes.${key}`,
      ),
    ]),
  );

  return {
    ...raw,
    addresses,
    transactions,
    runtimeCodeHashes,
    hookSalt: requiredHex(raw.hookSalt, 32, "hookSalt"),
    sourceCommitment: requiredHex(
      raw.sourceCommitment,
      32,
      "sourceCommitment",
    ),
  };
}

function createClients() {
  const endpoints = (process.env.MAINNET_RPC_URLS ?? DEFAULT_RPCS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  assert(endpoints.length >= 2, "At least two independent RPC URLs are required");
  assert(new Set(endpoints).size === endpoints.length, "RPC URLs must be distinct");

  return endpoints.slice(0, 2).map((endpoint) => ({
    endpoint,
    client: createPublicClient({
      chain: mainnet,
      transport: http(endpoint, { retryCount: 3, timeout: 15_000 }),
    }),
  }));
}

function constructorArgsAndInputs(evidence, artifacts) {
  const forwarderArgs = encodeAbiParameters(
    [{ type: "address" }],
    [OFFICIAL.positionManager.address],
  );
  const hookArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [OFFICIAL.poolManager.address, TREASURY],
  );
  const launcherArgs = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
    ],
    [
      OFFICIAL.poolManager.address,
      OFFICIAL.positionManager.address,
      OFFICIAL.uerc20Factory.address,
      evidence.addresses.feeHook,
      evidence.addresses.positionForwarderFactory,
    ],
  );

  const feeHookInitCode = concatHex([artifacts.feeHook.bytecode, hookArgs]);
  const predictedFeeHook = getCreate2Address({
    from: evidence.addresses.hookFactory,
    salt: evidence.hookSalt,
    bytecodeHash: keccak256(feeHookInitCode),
  });
  sameHex(
    predictedFeeHook,
    evidence.addresses.feeHook,
    "CREATE2 fee hook address",
  );

  return {
    expectedInputs: {
      positionForwarderFactory: concatHex([
        artifacts.positionForwarderFactory.bytecode,
        forwarderArgs,
      ]),
      hookFactory: artifacts.hookFactory.bytecode,
      feeHook: encodeFunctionData({
        abi: hookFactoryAbi,
        functionName: "deploy",
        args: [
          evidence.hookSalt,
          OFFICIAL.poolManager.address,
          TREASURY,
        ],
      }),
      memeLauncher: concatHex([artifacts.memeLauncher.bytecode, launcherArgs]),
    },
    sourceVerificationInputs: [
      {
        key: "positionForwarderFactory",
        fullyQualifiedName:
          "src/LockedPositionFeeForwarderFactoryV1.sol:LockedPositionFeeForwarderFactoryV1",
        constructorArgs: forwarderArgs,
      },
      {
        key: "hookFactory",
        fullyQualifiedName:
          "src/EthCreatorFeeHookFactoryV1.sol:EthCreatorFeeHookFactoryV1",
        constructorArgs: "0x",
      },
      {
        key: "feeHook",
        fullyQualifiedName: "src/EthCreatorFeeHookV1.sol:EthCreatorFeeHookV1",
        constructorArgs: hookArgs,
      },
      {
        key: "memeLauncher",
        fullyQualifiedName: "src/MemeLaunchV1.sol:MemeLaunchV1",
        constructorArgs: launcherArgs,
      },
    ].map((entry) => ({
      ...entry,
      address: evidence.addresses[entry.key],
      compilerVersion: "0.8.26",
      optimizerRuns: 1000,
      evmVersion: "cancun",
    })),
  };
}

function computeSourceCommitment(artifacts) {
  const creationHashes = [
    "positionForwarderFactory",
    "hookFactory",
    "feeHook",
    "memeLauncher",
  ].map((key) => keccak256(artifacts[key].bytecode));
  const bytecodeCommitment = keccak256(
    encodeAbiParameters(
      creationHashes.map(() => ({ type: "bytes32" })),
      creationHashes,
    ),
  );
  const dependencyAddresses = [
    OFFICIAL.poolManager.address,
    OFFICIAL.positionManager.address,
    OFFICIAL.stateView.address,
    OFFICIAL.v4Quoter.address,
    OFFICIAL.uerc20Factory.address,
    OFFICIAL.permit2.address,
    OFFICIAL.universalRouter.address,
    TREASURY,
  ];
  const dependencyCommitment = keccak256(
    encodeAbiParameters(
      dependencyAddresses.map(() => ({ type: "address" })),
      dependencyAddresses,
    ),
  );
  const economicsCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "int256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
      ],
      [
        10n,
        0n,
        200n,
        1_000_000_000n * 10n ** 18n,
        keccak256(
          stringToHex("creator-selected-atomic-dev-buy-at-or-above-minimum"),
        ),
        600_000_000_000_000n,
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        keccak256(
          stringToHex("programmable.meme.infrastructure.v1.ethereum"),
        ),
        bytecodeCommitment,
        dependencyCommitment,
        economicsCommitment,
      ],
    ),
  );
}

async function codeHashes(client, evidence) {
  const entries = [
    ...Object.entries(OFFICIAL).map(([key, item]) => [
      `official.${key}`,
      item.address,
      item.runtimeCodeHash,
    ]),
    ...[
      "positionForwarderFactory",
      "hookFactory",
      "feeHook",
      "memeLauncher",
    ].map((key) => [
      `owned.${key}`,
      evidence.addresses[key],
      evidence.runtimeCodeHashes[key],
    ]),
  ];
  const codes = await Promise.all(
    entries.map(([, address]) =>
      client.getCode({ address, blockTag: "latest" }),
    ),
  );
  return Object.fromEntries(
    entries.map(([key, address, expected], index) => {
      const code = codes[index];
      assert(code && code !== "0x", `${key} has no runtime code at ${address}`);
      const actual = keccak256(code);
      sameHex(actual, expected, `${key} runtime hash`);
      return [key, actual];
    }),
  );
}

async function transactionEvidence(client, evidence) {
  const entries = Object.entries(evidence.transactions);
  const resolved = await Promise.all(
    entries.map(async ([key, hash]) => {
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash }),
        client.getTransactionReceipt({ hash }),
      ]);
      assert(receipt.status === "success", `${key} deployment receipt failed`);
      return [key, { transaction, receipt }];
    }),
  );
  return Object.fromEntries(resolved);
}

function normalizedTransactionEvidence(resolved) {
  return Object.fromEntries(
    Object.entries(resolved).map(([key, { transaction, receipt }]) => [
      key,
      {
        hash: transaction.hash,
        from: transaction.from,
        to: transaction.to,
        nonce: transaction.nonce,
        value: transaction.value,
        input: transaction.input,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        status: receipt.status,
        contractAddress: receipt.contractAddress,
      },
    ]),
  );
}

function validateTransactions(evidence, resolved, expectedInputs, safeHead) {
  const order = [
    "positionForwarderFactory",
    "hookFactory",
    "feeHook",
    "memeLauncher",
  ];
  const expectedCreateAddresses = {
    positionForwarderFactory: getContractAddress({
      from: evidence.addresses.deployer,
      nonce: BigInt(evidence.startingNonce),
    }),
    hookFactory: getContractAddress({
      from: evidence.addresses.deployer,
      nonce: BigInt(evidence.startingNonce + 1),
    }),
    memeLauncher: getContractAddress({
      from: evidence.addresses.deployer,
      nonce: BigInt(evidence.startingNonce + 3),
    }),
  };

  for (const [index, key] of order.entries()) {
    const { transaction, receipt } = resolved[key];
    sameHex(transaction.from, evidence.addresses.deployer, `${key}.from`);
    assert(
      transaction.nonce === evidence.startingNonce + index,
      `${key}.nonce changed`,
    );
    assert(transaction.value === 0n, `${key}.value must be zero`);
    sameHex(transaction.input, expectedInputs[key], `${key}.input`);
    assert(
      receipt.blockNumber <= safeHead,
      `${key} has fewer than ${MIN_CONFIRMATIONS} confirmations`,
    );
  }

  assert(
    resolved.positionForwarderFactory.transaction.to === null,
    "positionForwarderFactory must be CREATE",
  );
  assert(resolved.hookFactory.transaction.to === null, "hookFactory must be CREATE");
  assert(resolved.memeLauncher.transaction.to === null, "memeLauncher must be CREATE");
  sameHex(
    resolved.feeHook.transaction.to,
    evidence.addresses.hookFactory,
    "feeHook.to",
  );

  for (const key of [
    "positionForwarderFactory",
    "hookFactory",
    "memeLauncher",
  ]) {
    sameHex(
      expectedCreateAddresses[key],
      evidence.addresses[key],
      `${key} predicted address`,
    );
    sameHex(
      resolved[key].receipt.contractAddress,
      evidence.addresses[key],
      `${key} receipt contract address`,
    );
  }
  assert(
    resolved.feeHook.receipt.contractAddress === null,
    "feeHook factory call must not report a top-level CREATE address",
  );

  const deploymentEvents = resolved.feeHook.receipt.logs.flatMap((log) => {
    if (
      log.address.toLowerCase() !== evidence.addresses.hookFactory.toLowerCase()
    ) {
      return [];
    }
    try {
      return [
        decodeEventLog({
          abi: hookFactoryAbi,
          data: log.data,
          topics: log.topics,
        }),
      ];
    } catch {
      return [];
    }
  });
  const event = deploymentEvents.find(
    (candidate) => candidate.eventName === "EthCreatorFeeHookDeployed",
  );
  assert(event, "Missing EthCreatorFeeHookDeployed event");
  sameHex(event.args.hook, evidence.addresses.feeHook, "fee hook event address");
  sameHex(
    event.args.poolManager,
    OFFICIAL.poolManager.address,
    "fee hook event PoolManager",
  );
  sameHex(
    event.args.launcherFeeRecipient,
    TREASURY,
    "fee hook event treasury",
  );
  sameHex(event.args.salt, evidence.hookSalt, "fee hook event salt");
}

async function readConfiguration(client, evidence) {
  const read = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args });

  const [
    forwarderPositionManager,
    forwarderOperator,
    forwarderTimelock,
    allHookMask,
    requiredHookFlags,
    hookConfigurationHash,
    isFactoryHook,
    hookPoolManager,
    hookTreasury,
    launcherFeeBps,
    hookLpFee,
    hookTickSpacing,
    totalNativeFees,
    launcherFees,
    launcherPoolManager,
    launcherPositionManager,
    launcherTokenFactory,
    launcherHook,
    launcherForwarderFactory,
    tokenSupply,
    launcherLpFee,
    launcherTickSpacing,
    poolManagerNativeClaims,
    hookEthBalance,
  ] = await Promise.all([
    read(
      evidence.addresses.positionForwarderFactory,
      forwarderFactoryAbi,
      "positionManager",
    ),
    read(
      evidence.addresses.positionForwarderFactory,
      forwarderFactoryAbi,
      "OPERATOR",
    ),
    read(
      evidence.addresses.positionForwarderFactory,
      forwarderFactoryAbi,
      "TIMELOCK_BLOCK",
    ),
    read(evidence.addresses.hookFactory, hookFactoryAbi, "ALL_HOOK_MASK"),
    read(
      evidence.addresses.hookFactory,
      hookFactoryAbi,
      "REQUIRED_HOOK_FLAGS",
    ),
    read(
      evidence.addresses.hookFactory,
      hookFactoryAbi,
      "configurationHashOf",
      [evidence.addresses.feeHook],
    ),
    read(evidence.addresses.hookFactory, hookFactoryAbi, "isFactoryHook", [
      evidence.addresses.feeHook,
    ]),
    read(evidence.addresses.feeHook, feeHookAbi, "poolManager"),
    read(evidence.addresses.feeHook, feeHookAbi, "launcherFeeRecipient"),
    read(evidence.addresses.feeHook, feeHookAbi, "LAUNCHER_FEE_BPS"),
    read(evidence.addresses.feeHook, feeHookAbi, "LP_FEE_PIPS"),
    read(evidence.addresses.feeHook, feeHookAbi, "TICK_SPACING"),
    read(evidence.addresses.feeHook, feeHookAbi, "totalNativeFeesAccrued"),
    read(evidence.addresses.feeHook, feeHookAbi, "launcherFeesAccrued"),
    read(evidence.addresses.memeLauncher, memeLauncherAbi, "poolManager"),
    read(evidence.addresses.memeLauncher, memeLauncherAbi, "positionManager"),
    read(evidence.addresses.memeLauncher, memeLauncherAbi, "tokenFactory"),
    read(evidence.addresses.memeLauncher, memeLauncherAbi, "feeHook"),
    read(
      evidence.addresses.memeLauncher,
      memeLauncherAbi,
      "positionForwarderFactory",
    ),
    read(evidence.addresses.memeLauncher, memeLauncherAbi, "TOKEN_SUPPLY"),
    read(evidence.addresses.memeLauncher, memeLauncherAbi, "LP_FEE_PIPS"),
    read(evidence.addresses.memeLauncher, memeLauncherAbi, "TICK_SPACING"),
    read(OFFICIAL.poolManager.address, poolManagerClaimsAbi, "balanceOf", [
      evidence.addresses.feeHook,
      0n,
    ]),
    client.getBalance({
      address: evidence.addresses.feeHook,
      blockTag: "latest",
    }),
  ]);

  sameHex(
    forwarderPositionManager,
    OFFICIAL.positionManager.address,
    "forwarderFactory.positionManager",
  );
  sameHex(forwarderOperator, "0x0000000000000000000000000000000000000000", "forwarderFactory.OPERATOR");
  assert(
    forwarderTimelock === (1n << 256n) - 1n,
    "forwarderFactory.TIMELOCK_BLOCK changed",
  );
  assert(allHookMask === ALL_HOOK_MASK, "hookFactory ALL_HOOK_MASK changed");
  assert(
    requiredHookFlags === REQUIRED_HOOK_FLAGS,
    "hookFactory REQUIRED_HOOK_FLAGS changed",
  );
  assert(
    hookConfigurationHash !== `0x${"00".repeat(32)}`,
    "fee hook lacks factory provenance",
  );
  assert(isFactoryHook === true, "hookFactory does not recognize fee hook");
  assert(
    (BigInt(evidence.addresses.feeHook) & ALL_HOOK_MASK) ===
      REQUIRED_HOOK_FLAGS,
    "fee hook address permission bits changed",
  );
  sameHex(hookPoolManager, OFFICIAL.poolManager.address, "feeHook.poolManager");
  sameHex(hookTreasury, TREASURY, "feeHook.launcherFeeRecipient");
  assert(launcherFeeBps === 10, "feeHook LAUNCHER_FEE_BPS changed");
  assert(hookLpFee === 0, "feeHook LP_FEE_PIPS changed");
  assert(hookTickSpacing === 200, "feeHook TICK_SPACING changed");
  assert(
    totalNativeFees === poolManagerNativeClaims,
    "PoolManager native claims do not equal hook accounting",
  );
  assert(
    launcherFees <= totalNativeFees,
    "launcher fees exceed total native fees",
  );
  assert(hookEthBalance === 0n, "fee hook unexpectedly holds raw ETH");

  sameHex(
    launcherPoolManager,
    OFFICIAL.poolManager.address,
    "memeLauncher.poolManager",
  );
  sameHex(
    launcherPositionManager,
    OFFICIAL.positionManager.address,
    "memeLauncher.positionManager",
  );
  sameHex(
    launcherTokenFactory,
    OFFICIAL.uerc20Factory.address,
    "memeLauncher.tokenFactory",
  );
  sameHex(launcherHook, evidence.addresses.feeHook, "memeLauncher.feeHook");
  sameHex(
    launcherForwarderFactory,
    evidence.addresses.positionForwarderFactory,
    "memeLauncher.positionForwarderFactory",
  );
  assert(
    tokenSupply === 1_000_000_000n * 10n ** 18n,
    "memeLauncher TOKEN_SUPPLY changed",
  );
  assert(launcherLpFee === 0, "memeLauncher LP_FEE_PIPS changed");
  assert(launcherTickSpacing === 200, "memeLauncher TICK_SPACING changed");

  return {
    forwarderPositionManager,
    forwarderOperator,
    forwarderTimelock,
    allHookMask,
    requiredHookFlags,
    hookConfigurationHash,
    hookPoolManager,
    hookTreasury,
    launcherFeeBps,
    totalNativeFees,
    launcherFees,
    poolManagerNativeClaims,
    hookEthBalance,
    launcherPoolManager,
    launcherPositionManager,
    launcherTokenFactory,
    launcherHook,
    launcherForwarderFactory,
    tokenSupply,
  };
}

async function checkSourcify(address) {
  const url = `https://sourcify.dev/server/v2/contract/1/${address}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const payload = response.ok ? await response.json() : null;
    const fullMatch =
      response.ok &&
      payload?.creationMatch === "match" &&
      payload?.runtimeMatch === "match";
    return {
      checked: true,
      fullMatch,
      match: payload?.match,
      creationMatch: payload?.creationMatch,
      runtimeMatch: payload?.runtimeMatch,
      verifiedAt: payload?.verifiedAt,
      url,
    };
  } catch (error) {
    return {
      checked: true,
      fullMatch: false,
      url,
      error: error.message,
    };
  }
}

async function checkEtherscan(address, expectedContractName) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) return { checked: false, verified: false };
  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", "1");
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getsourcecode");
  url.searchParams.set("address", address);
  url.searchParams.set("apikey", apiKey);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const payload = await response.json();
    const source = payload?.result?.[0];
    const verified =
      response.ok &&
      payload?.status === "1" &&
      typeof source?.SourceCode === "string" &&
      source.SourceCode.length > 0 &&
      source.ContractName === expectedContractName &&
      source.CompilerVersion?.includes("0.8.26") &&
      source.OptimizationUsed === "1" &&
      source.Runs === "1000";
    return {
      checked: true,
      verified,
      contractName: source?.ContractName,
      compilerVersion: source?.CompilerVersion,
      optimizerRuns: source?.Runs,
    };
  } catch (error) {
    return { checked: true, verified: false, error: error.message };
  }
}

async function sourceVerification(evidence) {
  return Promise.all(
    Object.entries(artifactDefinitions).map(async ([key, definition]) => {
      const address = evidence.addresses[key];
      const [sourcify, etherscan] = await Promise.all([
        checkSourcify(address),
        checkEtherscan(address, definition.contractName),
      ]);
      const verified = sourcify.fullMatch || etherscan.verified;
      if (REQUIRE_SOURCE_VERIFICATION) {
        assert(verified, `${definition.contractName} source is not verified`);
      }
      return {
        key,
        address,
        verified,
        sourcify,
        etherscan,
      };
    }),
  );
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    help();
    return;
  }
  const evidencePath =
    process.argv[2] ?? process.env.MAINNET_MEME_DEPLOYMENT_JSON;
  assert(evidencePath, "Pass deployment.json or set MAINNET_MEME_DEPLOYMENT_JSON");

  const evidence = parseEvidence(
    JSON.parse(await readFile(resolve(evidencePath), "utf8")),
  );
  const artifactEntries = await Promise.all(
    Object.entries(artifactDefinitions).map(async ([key, definition]) => [
      key,
      await loadArtifact(definition),
    ]),
  );
  const artifacts = Object.fromEntries(artifactEntries);
  sameHex(
    computeSourceCommitment(artifacts),
    evidence.sourceCommitment,
    "deployment source commitment",
  );

  const { expectedInputs, sourceVerificationInputs } =
    constructorArgsAndInputs(evidence, artifacts);
  const clients = createClients();
  const chainIds = await Promise.all(
    clients.map(({ client }) => client.getChainId()),
  );
  assert(chainIds.every((chainId) => chainId === 1), "RPC chain ID mismatch");

  const heads = await Promise.all(
    clients.map(({ client }) => client.getBlockNumber()),
  );
  const safeHead =
    heads.reduce((minimum, head) => (head < minimum ? head : minimum)) -
    BigInt(MIN_CONFIRMATIONS);
  assert(
    safeHead >= BigInt(evidence.deploymentBlock),
    `Deployment has fewer than ${MIN_CONFIRMATIONS} confirmations`,
  );

  const [hashSets, transactionSets, configurations] = await Promise.all([
    Promise.all(
      clients.map(({ client }) => codeHashes(client, evidence)),
    ),
    Promise.all(
      clients.map(({ client }) => transactionEvidence(client, evidence)),
    ),
    Promise.all(
      clients.map(({ client }) => readConfiguration(client, evidence)),
    ),
  ]);

  assert(
    stringify(hashSets[0]) === stringify(hashSets[1]),
    "Independent RPCs disagree on runtime hashes",
  );
  const normalizedTransactions = transactionSets.map(
    normalizedTransactionEvidence,
  );
  assert(
    stringify(normalizedTransactions[0]) ===
      stringify(normalizedTransactions[1]),
    "Independent RPCs disagree on deployment transactions",
  );
  assert(
    stringify(configurations[0]) === stringify(configurations[1]),
    "Independent RPCs disagree on immutable configuration",
  );
  validateTransactions(
    evidence,
    transactionSets[0],
    expectedInputs,
    safeHead,
  );

  const verification = await sourceVerification(evidence);
  const ready =
    verification.every((entry) => entry.verified) &&
    safeHead >= BigInt(evidence.deploymentBlock);

  process.stdout.write(
    `${stringify({
      ok: true,
      ready,
      chainId: 1,
      rpcEndpoints: clients.map(({ endpoint }) => endpoint),
      heads,
      safeHead,
      confirmationsRequired: MIN_CONFIRMATIONS,
      deploymentBlock: evidence.deploymentBlock,
      sourceCommitment: evidence.sourceCommitment,
      addresses: evidence.addresses,
      runtimeCodeHashes: hashSets[0],
      configuration: configurations[0],
      sourceVerification: verification,
      sourceVerificationInputs,
      note:
        "This proves deployment provenance and current onchain configuration. It is not an audit or a guarantee against contract vulnerabilities.",
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${stringify({ ok: false, error: error.message, stack: error.stack })}\n`,
  );
  process.exitCode = 1;
});
