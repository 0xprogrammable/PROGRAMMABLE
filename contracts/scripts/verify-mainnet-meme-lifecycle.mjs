#!/usr/bin/env node

import {
  createPublicClient,
  decodeFunctionData,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
} from "viem";
import { mainnet } from "viem/chains";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  MAINNET_CANARY_GAS_LIMITS,
  MAINNET_CANARY_MAX_GAS_PRICE_WEI,
  maximumMainnetCanaryOutflowWei,
} from "../../scripts/mainnet-canary-policy.mjs";

const DEFAULT_EVIDENCE_PATH =
  "contracts/release/mainnet-classic-v2-canary-evidence.json";
const DEFAULT_RPCS = [
  "https://rpc.mevblocker.io",
  "https://mainnet.gateway.tenderly.co",
];
const MIN_CONFIRMATIONS = Number(
  process.env.MAINNET_CANARY_CONFIRMATIONS ?? 12,
);
const TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;
const FINAL_TOKEN_BALANCE = 30_000n * 10n ** 18n;
const SEPARATE_BUY_WEI = 100_000_000_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"00".repeat(32)}`;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;

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

const launcherAbi = parseAbi([
  "function launch((string name,string symbol,uint16 totalSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata) parameters) payable returns ((address token,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,bytes32 poolId,bytes32 launchHash,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount) result)",
  "function predictTokenAddress(string name,string symbol,address creator,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function launchHashOf(address token) view returns (bytes32)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
  "event MemeTokenLaunched(address indexed creator,address indexed token,bytes32 indexed poolId,address feeHook,address positionRecipient,uint256 positionTokenId,uint16 totalSwapFeeBps,bytes32 launchHash)",
  "event MemeLiquidityConfigured(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
  "event MemeCreatorInitialBuy(address indexed creator,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
]);
const hookAbi = parseAbi([
  "function launcherFeeRecipient() view returns (address)",
  "function poolFeeConfig(bytes32 poolId) view returns (address creator,address registrar,uint16 totalSwapFeeBps,bool registered,uint256 creatorFeesAccrued)",
  "function feeDisclosure(bytes32 poolId) view returns (uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 creatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
  "function launcherFeesAccrued() view returns (uint256)",
  "function totalNativeFeesAccrued() view returns (uint256)",
  "function claimCreatorFees(bytes32 poolId)",
  "function claimLauncherFees()",
  "event PoolRegistered(bytes32 indexed poolId,address indexed token,address indexed creator,address registrar,uint16 totalSwapFeeBps)",
  "event PoolFeeDisclosure(bytes32 indexed poolId,address indexed token,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
  "event CreatorFeesClaimed(bytes32 indexed poolId,address indexed creator,address indexed recipient,address caller,uint256 amount)",
  "event LauncherFeesClaimed(address indexed treasury,address indexed recipient,address indexed caller,uint256 amount)",
]);
const approvalAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
]);
const permit2ApprovalAbi = parseAbi([
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
const universalRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function creator() view returns (address)",
  "function graffiti() view returns (bytes32)",
  "function metadata() view returns (string description,string website,string image,bytes extraData)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const uerc20FactoryAbi = parseAbi([
  "function getUERC20Address(string name,string symbol,uint8 decimals,address creator,bytes32 graffiti) view returns (address)",
]);
const positionManagerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
]);
const forwarderFactoryAbi = parseAbi([
  "function configurationHashOf(address forwarder) view returns (bytes32)",
]);
const forwarderAbi = parseAbi([
  "function positionManager() view returns (address)",
  "function operator() view returns (address)",
  "function timelockBlockNumber() view returns (uint256)",
  "function feeRecipient() view returns (address)",
]);
const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
]);
const erc6909Abi = parseAbi([
  "function balanceOf(address owner,uint256 id) view returns (uint256)",
]);

function stringify(value) {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameHex(actual, expected, label) {
  assert(
    typeof actual === "string" &&
      actual.toLowerCase() === expected.toLowerCase(),
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function requiredHash(value, label) {
  assert(
    typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
    `${label} must be a 32-byte hash`,
  );
  return value.toLowerCase();
}

function decodeEvents(receipt, abi, address) {
  return receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== address.toLowerCase()) return [];
    try {
      return [
        decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics,
        }),
      ];
    } catch {
      return [];
    }
  });
}

function eventByName(events, eventName) {
  const matches = events.filter((event) => event.eventName === eventName);
  assert(matches.length === 1, `Expected one ${eventName} event`);
  return matches[0].args;
}

function createClients() {
  const endpoints = (
    process.env.MAINNET_RPC_URLS ?? DEFAULT_RPCS.join(",")
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  assert(endpoints.length >= 2, "At least two Mainnet RPC URLs are required");
  assert(new Set(endpoints).size >= 2, "Mainnet RPC URLs must be distinct");
  return endpoints.slice(0, 2).map((endpoint) => ({
    endpoint,
    client: createPublicClient({
      chain: mainnet,
      transport: http(endpoint, { retryCount: 4, timeout: 15_000 }),
    }),
  }));
}

async function loadConfiguration(evidencePath) {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  assert(evidence.schemaVersion === 1, "Unsupported evidence schema");
  assert(evidence.chainId === 1, "Canary evidence must target Mainnet");
  const deployment = JSON.parse(
    await readFile(resolve(evidence.deployment), "utf8"),
  );
  const fixture = JSON.parse(await readFile(resolve(evidence.fixture), "utf8"));
  assert(deployment.chainId === 1, "Deployment chain mismatch");
  assert(
    deployment.status === "deployment-and-source-verified",
    "Mainnet V2 deployment is not source verified",
  );
  assert(fixture.chainId === 1, "Fixture chain mismatch");
  assert(
    fixture.requiredRelease === "classic-v2",
    "Fixture is not bound to Classic V2",
  );

  const addresses = {
    account: getAddress(evidence.account),
    treasury: getAddress(evidence.treasury),
    launcher: getAddress(evidence.launcher),
    hook: getAddress(evidence.feeHook),
    token: getAddress(evidence.predictedToken),
    hookFactory: getAddress(deployment.addresses.hookFactory),
    forwarderFactory: getAddress(
      deployment.addresses.positionForwarderFactory,
    ),
  };
  sameHex(
    addresses.account,
    deployment.addresses.deployer,
    "evidence account",
  );
  sameHex(addresses.treasury, deployment.addresses.treasury, "treasury");
  sameHex(addresses.launcher, deployment.addresses.memeLauncher, "launcher");
  sameHex(addresses.hook, deployment.addresses.feeHook, "fee hook");

  const poolId = requiredHash(evidence.poolId, "poolId");
  const creatorSalt = keccak256(toHex(fixture.launch.creatorSaltSeed));
  const poolKey = {
    currency0: ZERO_ADDRESS,
    currency1: addresses.token,
    fee: 0,
    tickSpacing: 200,
    hooks: addresses.hook,
  };
  const computedPoolId = keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
      ],
      [poolKey],
    ),
  );
  sameHex(poolId, computedPoolId, "computed poolId");
  assert(
    Number.isSafeInteger(evidence.startingNonce) &&
      evidence.startingNonce >= 0,
    "startingNonce is invalid",
  );

  return {
    evidence,
    deployment,
    fixture,
    addresses,
    poolId,
    creatorSalt,
  };
}

async function verifyConfiguration(client, configuration, requireVacantToken) {
  const { deployment, fixture, addresses, poolId, creatorSalt } = configuration;
  const runtimeEntries = [
    ...Object.entries(OFFICIAL),
    [
      "hookFactory",
      {
        address: addresses.hookFactory,
        runtimeCodeHash: deployment.runtimeCodeHashes.hookFactory,
      },
    ],
    [
      "feeHook",
      {
        address: addresses.hook,
        runtimeCodeHash: deployment.runtimeCodeHashes.feeHook,
      },
    ],
    [
      "memeLauncher",
      {
        address: addresses.launcher,
        runtimeCodeHash: deployment.runtimeCodeHashes.memeLauncher,
      },
    ],
    [
      "positionForwarderFactory",
      {
        address: addresses.forwarderFactory,
        runtimeCodeHash:
          deployment.runtimeCodeHashes.positionForwarderFactory,
      },
    ],
  ];
  const runtimeHashes = Object.fromEntries(
    await Promise.all(
      runtimeEntries.map(async ([name, contract]) => {
        const code = await client.getCode({ address: contract.address });
        assert(code && code !== "0x", `${name} runtime code is missing`);
        const hash = keccak256(code);
        sameHex(hash, contract.runtimeCodeHash, `${name} runtime hash`);
        return [name, hash];
      }),
    ),
  );
  const [predictedToken, tokenCode, confirmedNonce] = await Promise.all([
    client.readContract({
      address: addresses.launcher,
      abi: launcherAbi,
      functionName: "predictTokenAddress",
      args: [
        fixture.token.name,
        fixture.token.symbol,
        addresses.account,
        creatorSalt,
      ],
    }),
    client.getCode({ address: addresses.token }),
    client.getTransactionCount({
      address: addresses.account,
      blockTag: "latest",
    }),
  ]);
  sameHex(predictedToken[0], addresses.token, "predicted token");
  if (requireVacantToken) {
    assert(
      tokenCode === undefined || tokenCode === "0x",
      "The Mainnet canary token already exists",
    );
    assert(
      confirmedNonce === configuration.evidence.startingNonce,
      "The canary account nonce changed after preflight",
    );
  }
  return {
    runtimeHashes,
    predictedToken: predictedToken[0],
    tokenCode: tokenCode ?? "0x",
    confirmedNonce,
    poolId,
  };
}

function expectedTransactions(configuration) {
  const { fixture, addresses } = configuration;
  return {
    launch: {
      required: true,
      actionId: "launch",
      to: addresses.launcher,
      value: BigInt(fixture.launch.initialBuyWei),
    },
    buy: {
      required: true,
      actionId: "buy",
      to: OFFICIAL.universalRouter.address,
      value: SEPARATE_BUY_WEI,
    },
    tokenApproval: {
      required: false,
      actionId: "token-approval",
      to: addresses.token,
      value: 0n,
    },
    routerApproval: {
      required: true,
      actionId: "router-approval",
      to: OFFICIAL.permit2.address,
      value: 0n,
    },
    sell: {
      required: true,
      actionId: "sell",
      to: OFFICIAL.universalRouter.address,
      value: 0n,
    },
    creatorClaim: {
      required: true,
      actionId: "creator-claim",
      to: addresses.hook,
      value: 0n,
    },
    launcherClaim: {
      required: true,
      actionId: "launcher-claim",
      to: addresses.hook,
      value: 0n,
    },
  };
}

async function readTransactions(client, configuration) {
  const expected = expectedTransactions(configuration);
  const entries = [];
  for (const [name, specification] of Object.entries(expected)) {
    const recorded = configuration.evidence.transactions?.[name];
    if (!recorded) {
      assert(!specification.required, `Missing ${name} transaction evidence`);
      continue;
    }
    const hash = requiredHash(
      recorded.transactionHash,
      `${name}.transactionHash`,
    );
    const recordedInputHash = requiredHash(
      recorded.inputHash,
      `${name}.inputHash`,
    );
    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
    ]);
    assert(receipt.status === "success", `${name} transaction failed`);
    sameHex(transaction.from, configuration.addresses.account, `${name}.from`);
    sameHex(receipt.from, configuration.addresses.account, `${name}.receipt.from`);
    sameHex(transaction.to, specification.to, `${name}.to`);
    sameHex(receipt.to, specification.to, `${name}.receipt.to`);
    assert(transaction.value === specification.value, `${name}.value changed`);
    sameHex(
      keccak256(transaction.input),
      recordedInputHash,
      `${name}.inputHash`,
    );
    assert(
      Number(receipt.blockNumber) === recorded.blockNumber,
      `${name}.blockNumber changed`,
    );
    sameHex(receipt.blockHash, recorded.blockHash, `${name}.blockHash`);
    assert(transaction.nonce === recorded.nonce, `${name}.nonce changed`);
    assert(
      transaction.gas <= MAINNET_CANARY_GAS_LIMITS[specification.actionId],
      `${name} gas limit exceeded`,
    );
    assert(
      receipt.gasUsed <= MAINNET_CANARY_GAS_LIMITS[specification.actionId],
      `${name} gas used exceeded`,
    );
    assert(
      receipt.effectiveGasPrice <= MAINNET_CANARY_MAX_GAS_PRICE_WEI,
      `${name} gas price exceeded`,
    );
    entries.push([
      name,
      {
        transaction,
        receipt,
        actionId: specification.actionId,
      },
    ]);
  }
  const transactions = Object.fromEntries(entries);
  const ordered = Object.entries(transactions).sort(
    ([, left], [, right]) => left.transaction.nonce - right.transaction.nonce,
  );
  ordered.forEach(([name, value], index) => {
    assert(
      value.transaction.nonce ===
        configuration.evidence.startingNonce + index,
      `${name} nonce is not contiguous`,
    );
  });
  return transactions;
}

async function validateTransactionInputs(client, configuration, transactions) {
  const { fixture, addresses, creatorSalt, poolId } = configuration;
  const expectedLaunchInput = encodeFunctionData({
    abi: launcherAbi,
    functionName: "launch",
    args: [
      {
        name: fixture.token.name,
        symbol: fixture.token.symbol,
        totalSwapFeeBps: fixture.launch.totalSwapFeeBps,
        creatorSalt,
        metadata: {
          description: fixture.token.description,
          website: fixture.token.website,
          image: fixture.token.image,
          extraData: toHex(JSON.stringify(fixture.token.extraData)),
        },
      },
    ],
  });
  sameHex(
    transactions.launch.transaction.input,
    expectedLaunchInput,
    "launch calldata",
  );

  if (transactions.tokenApproval) {
    const approval = decodeFunctionData({
      abi: approvalAbi,
      data: transactions.tokenApproval.transaction.input,
    });
    assert(approval.functionName === "approve", "Token approval selector changed");
    sameHex(approval.args[0], OFFICIAL.permit2.address, "approval spender");
    assert(approval.args[1] === MAX_UINT256, "Token approval amount changed");
  }

  const routerApproval = decodeFunctionData({
    abi: permit2ApprovalAbi,
    data: transactions.routerApproval.transaction.input,
  });
  assert(
    routerApproval.functionName === "approve",
    "Permit2 approval selector changed",
  );
  sameHex(routerApproval.args[0], addresses.token, "Permit2 approval token");
  sameHex(
    routerApproval.args[1],
    OFFICIAL.universalRouter.address,
    "Permit2 approval spender",
  );
  assert(
    routerApproval.args[2] === MAX_UINT160,
    "Permit2 approval amount changed",
  );
  const approvalBlock = await client.getBlock({
    blockNumber: transactions.routerApproval.receipt.blockNumber,
  });
  assert(
    BigInt(routerApproval.args[3]) > approvalBlock.timestamp + 80_000n &&
      BigInt(routerApproval.args[3]) <= approvalBlock.timestamp + 90_000n,
    "Permit2 approval expiration changed",
  );

  for (const action of ["buy", "sell"]) {
    const swap = decodeFunctionData({
      abi: universalRouterAbi,
      data: transactions[action].transaction.input,
    });
    assert(
      swap.functionName === "execute",
      `${action} Universal Router selector changed`,
    );
    assert(
      swap.args[0] !== "0x" && swap.args[1].length > 0,
      `${action} Universal Router plan is empty`,
    );
    const swapBlock = await client.getBlock({
      blockNumber: transactions[action].receipt.blockNumber,
    });
    assert(
      swap.args[2] >= swapBlock.timestamp &&
        swap.args[2] <= swapBlock.timestamp + 3_900n,
      `${action} deadline changed`,
    );
  }

  const creatorClaim = decodeFunctionData({
    abi: hookAbi,
    data: transactions.creatorClaim.transaction.input,
  });
  assert(
    creatorClaim.functionName === "claimCreatorFees",
    "Creator claim selector changed",
  );
  sameHex(creatorClaim.args[0], poolId, "Creator claim poolId");
  const launcherClaim = decodeFunctionData({
    abi: hookAbi,
    data: transactions.launcherClaim.transaction.input,
  });
  assert(
    launcherClaim.functionName === "claimLauncherFees",
    "Launcher claim selector changed",
  );
}

function validateFeeAccrual(fees, poolId, totalSwapFeeBps, label) {
  sameHex(fees.poolId, poolId, `${label}.poolId`);
  const totalFee =
    (fees.grossNativeAmount * BigInt(totalSwapFeeBps)) / 10_000n;
  const launcherFee = (fees.grossNativeAmount * 10n) / 10_000n;
  assert(fees.launcherFee === launcherFee, `${label} Launcher fee changed`);
  assert(
    fees.creatorFee === totalFee - launcherFee,
    `${label} creator fee changed`,
  );
}

function transactionCost(receipt) {
  return receipt.gasUsed * receipt.effectiveGasPrice;
}

async function balanceDelta(client, address, transaction) {
  const blockNumber = transaction.receipt.blockNumber;
  const [before, after] = await Promise.all([
    client.getBalance({ address, blockNumber: blockNumber - 1n }),
    client.getBalance({ address, blockNumber }),
  ]);
  return after - before;
}

async function verifyLifecycle(client, configuration, verificationBlock) {
  const { fixture, addresses, poolId } = configuration;
  const transactions = await readTransactions(client, configuration);
  await validateTransactionInputs(client, configuration, transactions);
  const latestLifecycleBlock = Object.values(transactions).reduce(
    (latest, item) =>
      item.receipt.blockNumber > latest ? item.receipt.blockNumber : latest,
    0n,
  );
  assert(
    verificationBlock - latestLifecycleBlock >= BigInt(MIN_CONFIRMATIONS),
    `Canary lifecycle needs ${MIN_CONFIRMATIONS} confirmations`,
  );

  const launchEvents = decodeEvents(
    transactions.launch.receipt,
    launcherAbi,
    addresses.launcher,
  );
  const launch = eventByName(launchEvents, "MemeTokenLaunched");
  const liquidity = eventByName(
    launchEvents,
    "MemeLiquidityConfigured",
  );
  const initialBuy = eventByName(
    launchEvents,
    "MemeCreatorInitialBuy",
  );
  sameHex(launch.creator, addresses.account, "launch.creator");
  sameHex(launch.token, addresses.token, "launch.token");
  sameHex(launch.poolId, poolId, "launch.poolId");
  sameHex(launch.feeHook, addresses.hook, "launch.feeHook");
  assert(
    launch.totalSwapFeeBps === fixture.launch.totalSwapFeeBps,
    "Launch fee changed",
  );
  assert(liquidity.totalSupply === TOKEN_SUPPLY, "Launch supply changed");
  assert(
    liquidity.tokenLiquidityAmount + liquidity.lockedTokenDust ===
      TOKEN_SUPPLY,
    "Launch supply accounting does not close",
  );
  assert(liquidity.initialTick === 204_200, "Opening tick changed");
  assert(liquidity.tickLower === -887_200, "Lower tick changed");
  assert(liquidity.tickUpper === 204_200, "Upper tick changed");
  assert(liquidity.lpFeePips === 0, "LP fee changed");
  sameHex(liquidity.launchHash, launch.launchHash, "liquidity launchHash");
  sameHex(initialBuy.creator, addresses.account, "initialBuy.creator");
  sameHex(initialBuy.token, addresses.token, "initialBuy.token");
  sameHex(initialBuy.poolId, poolId, "initialBuy.poolId");
  assert(
    initialBuy.nativeAmount === BigInt(fixture.launch.initialBuyWei),
    "Atomic Dev Buy amount changed",
  );
  assert(initialBuy.tokenAmount > 0n, "Atomic Dev Buy returned no tokens");
  sameHex(initialBuy.launchHash, launch.launchHash, "initialBuy.launchHash");

  const launchHookEvents = decodeEvents(
    transactions.launch.receipt,
    hookAbi,
    addresses.hook,
  );
  const registration = eventByName(launchHookEvents, "PoolRegistered");
  const disclosure = eventByName(launchHookEvents, "PoolFeeDisclosure");
  sameHex(registration.poolId, poolId, "registration.poolId");
  sameHex(registration.token, addresses.token, "registration.token");
  sameHex(registration.creator, addresses.account, "registration.creator");
  sameHex(registration.registrar, addresses.launcher, "registration.registrar");
  assert(
    registration.totalSwapFeeBps === fixture.launch.totalSwapFeeBps,
    "Registered fee changed",
  );
  sameHex(disclosure.poolId, poolId, "disclosure.poolId");
  sameHex(disclosure.token, addresses.token, "disclosure.token");
  assert(
    disclosure.buySwapFeeBps === fixture.expectedDisclosure.buyHookFeeBps &&
      disclosure.sellSwapFeeBps === fixture.expectedDisclosure.sellHookFeeBps,
    "Buy or sell disclosure changed",
  );
  assert(
    disclosure.launcherFeeBps ===
      fixture.expectedDisclosure.launcherFeeBps,
    "Launcher disclosure changed",
  );
  assert(
    disclosure.transferTaxBps ===
      fixture.expectedDisclosure.transferTaxBps,
    "Transfer tax disclosure changed",
  );
  assert(
    disclosure.lpFeePips === fixture.expectedDisclosure.lpFeePips,
    "LP fee disclosure changed",
  );

  const feeEvents = {
    initialBuy: eventByName(
      launchHookEvents,
      "NativeSwapFeesAccrued",
    ),
    buy: eventByName(
      decodeEvents(transactions.buy.receipt, hookAbi, addresses.hook),
      "NativeSwapFeesAccrued",
    ),
    sell: eventByName(
      decodeEvents(transactions.sell.receipt, hookAbi, addresses.hook),
      "NativeSwapFeesAccrued",
    ),
  };
  for (const [label, fees] of Object.entries(feeEvents)) {
    validateFeeAccrual(
      fees,
      poolId,
      fixture.launch.totalSwapFeeBps,
      label,
    );
  }
  assert(
    feeEvents.initialBuy.grossNativeAmount ===
      BigInt(fixture.launch.initialBuyWei),
    "Atomic Dev Buy fee base changed",
  );
  assert(
    feeEvents.buy.grossNativeAmount === SEPARATE_BUY_WEI,
    "Separate buy fee base changed",
  );

  const creatorClaim = eventByName(
    decodeEvents(
      transactions.creatorClaim.receipt,
      hookAbi,
      addresses.hook,
    ),
    "CreatorFeesClaimed",
  );
  const launcherClaim = eventByName(
    decodeEvents(
      transactions.launcherClaim.receipt,
      hookAbi,
      addresses.hook,
    ),
    "LauncherFeesClaimed",
  );
  const expectedCreatorClaim = Object.values(feeEvents).reduce(
    (total, fees) => total + fees.creatorFee,
    0n,
  );
  const expectedLauncherClaim = Object.values(feeEvents).reduce(
    (total, fees) => total + fees.launcherFee,
    0n,
  );
  sameHex(creatorClaim.poolId, poolId, "creatorClaim.poolId");
  sameHex(creatorClaim.creator, addresses.account, "creatorClaim.creator");
  sameHex(
    creatorClaim.recipient,
    addresses.account,
    "creatorClaim.recipient",
  );
  assert(
    creatorClaim.amount === expectedCreatorClaim,
    "Creator claim does not reconcile",
  );
  sameHex(
    launcherClaim.treasury,
    addresses.treasury,
    "launcherClaim.treasury",
  );
  sameHex(
    launcherClaim.recipient,
    addresses.treasury,
    "launcherClaim.recipient",
  );
  assert(
    launcherClaim.amount === expectedLauncherClaim,
    "Launcher claim does not reconcile",
  );

  const read = (
    address,
    abi,
    functionName,
    args = [],
    blockNumber = verificationBlock,
  ) =>
    client.readContract({
      address,
      abi,
      functionName,
      args,
      blockNumber,
    });
  const [
    tokenName,
    tokenSymbol,
    tokenDecimals,
    totalSupply,
    tokenCreator,
    graffiti,
    metadata,
    finalTokenBalance,
    recordedLaunchHash,
    minimumInitialBuy,
    feeConfiguration,
    feeDisclosure,
    launcherFees,
    totalNativeFees,
    hookNativeClaims,
    hookEthBalance,
    launcherFeeRecipient,
    positionOwner,
    positionLiquidity,
    forwarderProvenance,
    forwarderPositionManager,
    forwarderOperator,
    forwarderTimelock,
    forwarderFeeRecipient,
    slot0,
    confirmedNonce,
  ] = await Promise.all([
    read(addresses.token, tokenAbi, "name"),
    read(addresses.token, tokenAbi, "symbol"),
    read(addresses.token, tokenAbi, "decimals"),
    read(addresses.token, tokenAbi, "totalSupply"),
    read(addresses.token, tokenAbi, "creator"),
    read(addresses.token, tokenAbi, "graffiti"),
    read(addresses.token, tokenAbi, "metadata"),
    read(addresses.token, tokenAbi, "balanceOf", [addresses.account]),
    read(addresses.launcher, launcherAbi, "launchHashOf", [addresses.token]),
    read(addresses.launcher, launcherAbi, "MIN_INITIAL_BUY_WEI"),
    read(addresses.hook, hookAbi, "poolFeeConfig", [poolId]),
    read(addresses.hook, hookAbi, "feeDisclosure", [poolId]),
    read(addresses.hook, hookAbi, "launcherFeesAccrued"),
    read(addresses.hook, hookAbi, "totalNativeFeesAccrued"),
    read(OFFICIAL.poolManager.address, erc6909Abi, "balanceOf", [
      addresses.hook,
      0n,
    ]),
    client.getBalance({
      address: addresses.hook,
      blockNumber: verificationBlock,
    }),
    read(addresses.hook, hookAbi, "launcherFeeRecipient"),
    read(OFFICIAL.positionManager.address, positionManagerAbi, "ownerOf", [
      launch.positionTokenId,
    ]),
    read(
      OFFICIAL.positionManager.address,
      positionManagerAbi,
      "getPositionLiquidity",
      [launch.positionTokenId],
    ),
    read(
      addresses.forwarderFactory,
      forwarderFactoryAbi,
      "configurationHashOf",
      [launch.positionRecipient],
    ),
    read(launch.positionRecipient, forwarderAbi, "positionManager"),
    read(launch.positionRecipient, forwarderAbi, "operator"),
    read(launch.positionRecipient, forwarderAbi, "timelockBlockNumber"),
    read(launch.positionRecipient, forwarderAbi, "feeRecipient"),
    read(OFFICIAL.stateView.address, stateViewAbi, "getSlot0", [poolId]),
    client.getTransactionCount({
      address: addresses.account,
      blockNumber: verificationBlock,
    }),
  ]);
  assert(tokenName === fixture.token.name, "Token name changed");
  assert(tokenSymbol === fixture.token.symbol, "Token symbol changed");
  assert(tokenDecimals === 18, "Token decimals changed");
  assert(totalSupply === TOKEN_SUPPLY, "Token supply changed");
  sameHex(tokenCreator, addresses.launcher, "token.creator");
  assert(metadata[0] === fixture.token.description, "Token description changed");
  assert(metadata[1] === fixture.token.website, "Token website changed");
  assert(metadata[2] === fixture.token.image, "Token image changed");
  sameHex(
    metadata[3],
    toHex(JSON.stringify(fixture.token.extraData)),
    "Token extraData",
  );
  const reproducedToken = await read(
    OFFICIAL.uerc20Factory.address,
    uerc20FactoryAbi,
    "getUERC20Address",
    [
      tokenName,
      tokenSymbol,
      tokenDecimals,
      addresses.launcher,
      graffiti,
    ],
  );
  sameHex(reproducedToken, addresses.token, "official token provenance");
  assert(
    finalTokenBalance === FINAL_TOKEN_BALANCE,
    "Final creator token balance changed",
  );
  sameHex(recordedLaunchHash, launch.launchHash, "recorded launchHash");
  assert(
    minimumInitialBuy === BigInt(fixture.launch.initialBuyWei),
    "Minimum Dev Buy changed",
  );
  sameHex(feeConfiguration[0], addresses.account, "feeConfig.creator");
  sameHex(feeConfiguration[1], addresses.launcher, "feeConfig.registrar");
  assert(
    feeConfiguration[2] === fixture.launch.totalSwapFeeBps,
    "Final total swap fee changed",
  );
  assert(feeConfiguration[3], "Pool registration is inactive");
  assert(feeConfiguration[4] === 0n, "Creator fees remain unclaimed");
  assert(
    feeDisclosure[0] === fixture.expectedDisclosure.buyHookFeeBps &&
      feeDisclosure[1] === fixture.expectedDisclosure.sellHookFeeBps &&
      feeDisclosure[2] === fixture.expectedDisclosure.creatorFeeBps &&
      feeDisclosure[3] === fixture.expectedDisclosure.launcherFeeBps &&
      feeDisclosure[4] === fixture.expectedDisclosure.transferTaxBps &&
      feeDisclosure[5] === fixture.expectedDisclosure.lpFeePips,
    "Final fee disclosure changed",
  );
  assert(launcherFees === 0n, "Launcher fees remain unclaimed");
  assert(totalNativeFees === 0n, "Native fee accounting remains open");
  assert(hookNativeClaims === 0n, "Hook still owns native claims");
  assert(hookEthBalance === 0n, "Hook holds raw ETH");
  sameHex(
    launcherFeeRecipient,
    addresses.treasury,
    "launcherFeeRecipient",
  );
  sameHex(positionOwner, launch.positionRecipient, "locked position owner");
  assert(positionLiquidity > 0n, "Locked position has no liquidity");
  assert(forwarderProvenance !== ZERO_HASH, "Forwarder provenance is missing");
  sameHex(
    forwarderPositionManager,
    OFFICIAL.positionManager.address,
    "forwarder.positionManager",
  );
  sameHex(forwarderOperator, ZERO_ADDRESS, "forwarder.operator");
  assert(forwarderTimelock === MAX_UINT256, "Forwarder is not permanent");
  sameHex(
    forwarderFeeRecipient,
    addresses.account,
    "forwarder.feeRecipient",
  );
  assert(slot0[3] === 0, "Final LP fee is not zero");

  const orderedTransactions = Object.values(transactions).sort(
    (left, right) => left.transaction.nonce - right.transaction.nonce,
  );
  assert(
    confirmedNonce >=
      orderedTransactions.at(-1).transaction.nonce + 1,
    "Lifecycle transactions are not all confirmed",
  );

  const [
    preLaunchCode,
    launchTokenBalance,
    postBuyTokenBalance,
    soldTokenBalance,
  ] = await Promise.all([
    client.getCode({
      address: addresses.token,
      blockNumber: transactions.launch.receipt.blockNumber - 1n,
    }),
    read(
      addresses.token,
      tokenAbi,
      "balanceOf",
      [addresses.account],
      transactions.launch.receipt.blockNumber,
    ),
    read(
      addresses.token,
      tokenAbi,
      "balanceOf",
      [addresses.account],
      transactions.buy.receipt.blockNumber,
    ),
    read(
      addresses.token,
      tokenAbi,
      "balanceOf",
      [addresses.account],
      transactions.sell.receipt.blockNumber,
    ),
  ]);
  assert(
    preLaunchCode === undefined || preLaunchCode === "0x",
    "Predicted token existed before launch",
  );
  assert(
    launchTokenBalance === initialBuy.tokenAmount,
    "Atomic Dev Buy token output does not reconcile",
  );
  assert(
    postBuyTokenBalance > launchTokenBalance,
    "Separate buy did not increase the token balance",
  );
  assert(
    soldTokenBalance === FINAL_TOKEN_BALANCE,
    "Sell did not retain the target balance",
  );

  const balanceDeltas = {};
  for (const [name, transaction] of Object.entries(transactions)) {
    balanceDeltas[name] = await balanceDelta(
      client,
      addresses.account,
      transaction,
    );
  }
  const treasuryDelta = await balanceDelta(
    client,
    addresses.treasury,
    transactions.launcherClaim,
  );
  assert(
    balanceDeltas.launch ===
      -BigInt(fixture.launch.initialBuyWei) -
        transactionCost(transactions.launch.receipt),
    "Launch ETH balance delta does not reconcile",
  );
  assert(
    balanceDeltas.buy ===
      -SEPARATE_BUY_WEI - transactionCost(transactions.buy.receipt),
    "Buy ETH balance delta does not reconcile",
  );
  for (const approval of ["tokenApproval", "routerApproval"]) {
    if (transactions[approval]) {
      assert(
        balanceDeltas[approval] ===
          -transactionCost(transactions[approval].receipt),
        `${approval} ETH balance delta does not reconcile`,
      );
    }
  }
  const sellNetNative =
    feeEvents.sell.grossNativeAmount -
    feeEvents.sell.creatorFee -
    feeEvents.sell.launcherFee;
  assert(
    balanceDeltas.sell ===
      sellNetNative - transactionCost(transactions.sell.receipt),
    "Sell ETH balance delta does not reconcile",
  );
  assert(
    balanceDeltas.creatorClaim ===
      creatorClaim.amount -
        transactionCost(transactions.creatorClaim.receipt),
    "Creator claim ETH balance delta does not reconcile",
  );
  assert(
    balanceDeltas.launcherClaim ===
      -transactionCost(transactions.launcherClaim.receipt),
    "Launcher claim caller balance does not reconcile",
  );
  assert(
    treasuryDelta === launcherClaim.amount,
    "Treasury balance delta does not reconcile",
  );

  const actualGrossDebit = Object.values(transactions).reduce(
    (total, item) =>
      total + item.transaction.value + transactionCost(item.receipt),
    0n,
  );
  const maximumGrossDebit = maximumMainnetCanaryOutflowWei(
    BigInt(fixture.launch.initialBuyWei),
    SEPARATE_BUY_WEI,
  );
  assert(
    actualGrossDebit <= maximumGrossDebit,
    "Canary gross debit exceeded the approved maximum",
  );

  return {
    verificationBlock,
    latestLifecycleBlock,
    confirmations: verificationBlock - latestLifecycleBlock,
    transactionHashes: Object.fromEntries(
      Object.entries(transactions).map(([name, item]) => [
        name,
        item.transaction.hash,
      ]),
    ),
    token: addresses.token,
    poolId,
    launchHash: launch.launchHash,
    positionRecipient: launch.positionRecipient,
    positionTokenId: launch.positionTokenId,
    positionLiquidity,
    initialBuyTokenOutput: launchTokenBalance,
    separateBuyTokenOutput: postBuyTokenBalance - launchTokenBalance,
    sellTokenInput: postBuyTokenBalance - soldTokenBalance,
    sellGrossNativeOutput: feeEvents.sell.grossNativeAmount,
    creatorFeesClaimed: creatorClaim.amount,
    launcherFeesClaimed: launcherClaim.amount,
    finalTokenBalance,
    finalTick: slot0[1],
    actualGrossDebit,
    maximumGrossDebit,
    treasuryDelta,
  };
}

async function main() {
  assert(
    Number.isInteger(MIN_CONFIRMATIONS) && MIN_CONFIRMATIONS >= 2,
    "MAINNET_CANARY_CONFIRMATIONS must be at least 2",
  );
  const checkConfiguration = process.argv.includes("--check-config");
  const evidenceArgument = process.argv.find(
    (argument) => argument.endsWith(".json"),
  );
  const evidencePath = resolve(evidenceArgument ?? DEFAULT_EVIDENCE_PATH);
  const configuration = await loadConfiguration(evidencePath);
  const clients = createClients();
  const chainIds = await Promise.all(
    clients.map(({ client }) => client.getChainId()),
  );
  assert(chainIds.every((chainId) => chainId === 1), "RPC chain ID mismatch");

  const configurationStates = await Promise.all(
    clients.map(({ client }) =>
      verifyConfiguration(client, configuration, checkConfiguration),
    ),
  );
  assert(
    stringify(configurationStates[0]) ===
      stringify(configurationStates[1]),
    "Independent RPCs disagree on Mainnet canary configuration",
  );

  if (checkConfiguration) {
    const recorded = Object.values(
      configuration.evidence.transactions ?? {},
    ).filter(Boolean);
    assert(
      recorded.length === 0,
      "Canary transaction evidence already exists",
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ready-for-owner-approved-canary",
          chainId: 1,
          independentRpcCount: clients.length,
          account: configuration.addresses.account,
          confirmedNonce: configurationStates[0].confirmedNonce,
          token: configuration.addresses.token,
          poolId: configuration.poolId,
          maximumLifecycleOutflowWei:
            maximumMainnetCanaryOutflowWei(
              BigInt(configuration.fixture.launch.initialBuyWei),
              SEPARATE_BUY_WEI,
            ).toString(),
          transactionsSubmitted: 0,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const heads = await Promise.all(
    clients.map(({ client }) => client.getBlockNumber()),
  );
  const verificationBlock = heads.reduce((minimum, head) =>
    head < minimum ? head : minimum,
  );
  const results = await Promise.all(
    clients.map(({ client }) =>
      verifyLifecycle(client, configuration, verificationBlock),
    ),
  );
  assert(
    stringify(results[0]) === stringify(results[1]),
    "Independent RPCs disagree on Mainnet canary lifecycle evidence",
  );

  configuration.evidence.status = "verified-current-release";
  configuration.evidence.verification = {
    status: "verified-current-release",
    releaseEligible: true,
    independentRpcCount: clients.length,
    confirmations: Number(results[0].confirmations),
    checkedAt: new Date().toISOString(),
    summary: JSON.parse(stringify(results[0])),
  };
  const temporaryPath = `${evidencePath}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(configuration.evidence, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rename(temporaryPath, evidencePath);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "verified-current-release",
        chainId: 1,
        independentRpcCount: clients.length,
        ...JSON.parse(stringify(results[0])),
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error(`Mainnet canary verification failed: ${error.message}`);
  process.exitCode = 1;
});
