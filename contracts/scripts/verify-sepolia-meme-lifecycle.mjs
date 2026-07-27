import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";
import { sepolia } from "viem/chains";

const RPC_ENDPOINTS = [
  "https://sepolia.drpc.org",
  "https://sepolia.gateway.tenderly.co",
];

const ADDRESSES = {
  account: getAddress("0x2Bb333d48DFAF1596D9036671d2E43168994249E"),
  treasury: getAddress("0x4957f49620AFf3Adbbe8195a4f633E49cc93376c"),
  hookFactory: getAddress("0xb974A9EF7B75650428389b63fa6C4906450ABcE0"),
  hook: getAddress("0x0c9De2721F537C311e05ad3671A17136C14a20Cc"),
  launcher: getAddress("0x6Ae84F188468722d8b5970Bc3924C9C31b75FF4e"),
  token: getAddress("0x6f71a3cda868d613552f8230790274bbebb5d771"),
  positionRecipient: getAddress(
    "0xbdb2d2F49771Ec34d37DF9fADCBad058e96Db8DC",
  ),
  poolManager: getAddress("0xE03A1074c86CFeDd5C142C4F04F1a1536e203543"),
  positionManager: getAddress(
    "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
  ),
  stateView: getAddress("0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C"),
  uerc20Factory: getAddress(
    "0x000000e200088D55C39a11F609E5F667729ad49b",
  ),
  permit2: getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"),
  universalRouter: getAddress(
    "0x470FFC67b1feEEC31D16C46AC7545C98716a194c",
  ),
};

const RUNTIME_CODE_HASHES = {
  hookFactory:
    "0x8dd7205952dba3efad6f58a4b0193171c4ed825145319c908bc47dab1911c128",
  hook: "0xa1094bdd6c3bd1ba4d17d8f321f0e52a95a6247fae287aae90b008a7eacb05b7",
  launcher:
    "0xf9977ba3a5c859d34beff333d129ae135190423a20e2a6ec5cb19588ff552e5f",
  uerc20Factory:
    "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
};
const SOURCE_VERIFICATION = [
  [ADDRESSES.hookFactory, "EthCreatorFeeHookFactoryV2", 1_000, "cancun"],
  [ADDRESSES.hook, "EthCreatorFeeHookV2", 1_000, "cancun"],
  [ADDRESSES.launcher, "MemeLaunchV1", 1_000, "cancun"],
  [ADDRESSES.token, "UERC20", 50_000_000, "prague"],
];

const TRANSACTIONS = {
  launch: {
    hash: "0xd15b074027a3516ce6ee65fab94df3a2ebbc5170ec7669f6420052a60b82c141",
    blockNumber: 11_361_308n,
    nonce: 34,
    to: ADDRESSES.launcher,
    value: 600_000_000_000_000n,
  },
  permit2Approval: {
    hash: "0x32eff8ce7751eb811dcc94259c3867dd0d4e76c7617e9e6e1b62970bf73a9f41",
    blockNumber: 11_361_309n,
    nonce: 35,
    to: ADDRESSES.permit2,
    value: 0n,
  },
  sell: {
    hash: "0x258278cb5662ab9d10966c9c48fe1849cff9e8162d73170f85471add0e7ff4d5",
    blockNumber: 11_361_331n,
    nonce: 36,
    to: ADDRESSES.universalRouter,
    value: 0n,
  },
  creatorClaim: {
    hash: "0x0f3aebde7e6bff6b41e19b3e26d3705c637a0f99b6de07fc5e4644e7c1e2ed71",
    blockNumber: 11_361_333n,
    nonce: 37,
    to: ADDRESSES.hook,
    value: 0n,
  },
  launcherClaim: {
    hash: "0x57a58b6dd721d87430e51ad894da48d24bb0dc261bed8019e0fdf4f27b14a428",
    blockNumber: 11_361_341n,
    nonce: 38,
    to: ADDRESSES.hook,
    value: 0n,
  },
};

const POOL_ID =
  "0x541eca58f02c9bee85cf4edbbc2ecfd8cbd6691c275b232f2f9b9c77ef8f82a6";
const LAUNCH_HASH =
  "0x3d33fc925bdb72a7f4b4e3e71495dcd82575271f07361ef2db40b43f54b97fcc";
const POSITION_TOKEN_ID = 37_835n;
const TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;
const FINAL_TOKEN_BALANCE = 30_000n * 10n ** 18n;
const POSITION_TOKEN_AMOUNT = 999_999_999_999_999_999_999_987_736n;
const LOCKED_TOKEN_DUST = 12_264n;
const EXPECTED_POSITION_LIQUIDITY = 36_819_258_015_569_838_458_222n;
const EXPECTED_FINAL_TICK = 204_199;
const EXPECTED_TOKEN_METADATA = {
  description: "This is a test.",
  website: "https://www.forbes.com/",
  image:
    "https://programmable.family/brand/programmable-token-fallback-01-dawn.webp",
  extraData:
    "0x7b2276223a312c2278223a2268747470733a2f2f782e636f6d2f656c6f6e6d75736b227d",
};
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;

const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function creator() view returns (address)",
  "function graffiti() view returns (bytes32)",
  "function metadata() view returns (string description,string website,string image,bytes extraData)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
]);
const uerc20FactoryAbi = parseAbi([
  "function getUERC20Address(string name,string symbol,uint8 decimals,address creator,bytes32 graffiti) view returns (address)",
]);
const permit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
]);
const hookAbi = parseAbi([
  "function launcherFeeRecipient() view returns (address)",
  "function poolFeeConfig(bytes32 poolId) view returns (address creator,address registrar,uint16 totalSwapFeeBps,bool registered,uint256 creatorFeesAccrued)",
  "function launcherFeesAccrued() view returns (uint256)",
  "function totalNativeFeesAccrued() view returns (uint256)",
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
  "event CreatorFeesClaimed(bytes32 indexed poolId,address indexed creator,address indexed recipient,address caller,uint256 amount)",
  "event LauncherFeesClaimed(address indexed treasury,address indexed recipient,address indexed caller,uint256 amount)",
]);
const launcherAbi = parseAbi([
  "function launchHashOf(address token) view returns (bytes32)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
]);
const erc6909Abi = parseAbi([
  "function balanceOf(address owner,uint256 id) view returns (uint256)",
]);
const positionManagerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)",
]);
const positionRecipientAbi = parseAbi([
  "function positionManager() view returns (address)",
  "function operator() view returns (address)",
  "function timelockBlockNumber() view returns (uint256)",
  "function feeRecipient() view returns (address)",
]);
const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
]);
const launchEventsAbi = parseAbi([
  "event MemeTokenLaunched(address indexed creator,address indexed token,bytes32 indexed poolId,address feeHook,address positionRecipient,uint256 positionTokenId,uint16 totalSwapFeeBps,bytes32 launchHash)",
  "event MemeLiquidityConfigured(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
  "event MemeCreatorInitialBuy(address indexed creator,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertAddress(actual, expected, label) {
  assert(
    actual?.toLowerCase() === expected.toLowerCase(),
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function decodeEvents(receipt, abi, address) {
  return receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== address.toLowerCase()) {
      return [];
    }
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

function transactionCost(receipt) {
  return receipt.gasUsed * receipt.effectiveGasPrice;
}

function rateLimitedHttp(endpoint) {
  const baseTransport = http(endpoint, {
    retryCount: 5,
    retryDelay: 750,
  });
  return (configuration) => {
    const transport = baseTransport(configuration);
    let queue = Promise.resolve();
    return {
      ...transport,
      request(parameters, options) {
        const current = queue.then(() =>
          transport.request(parameters, options),
        );
        queue = current.then(
          () => new Promise((resolve) => setTimeout(resolve, 100)),
          () => new Promise((resolve) => setTimeout(resolve, 100)),
        );
        return current;
      },
    };
  };
}

async function readEvidence(client) {
  const transactionEntries = await Promise.all(
    Object.entries(TRANSACTIONS).map(async ([name, expected]) => {
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash: expected.hash }),
        client.getTransactionReceipt({ hash: expected.hash }),
      ]);
      assert(receipt.status === "success", `${name} receipt failed`);
      assertAddress(transaction.from, ADDRESSES.account, `${name}.from`);
      assertAddress(transaction.to, expected.to, `${name}.to`);
      assert(
        transaction.blockNumber === expected.blockNumber,
        `${name}.blockNumber changed`,
      );
      assert(transaction.nonce === expected.nonce, `${name}.nonce changed`);
      assert(transaction.value === expected.value, `${name}.value changed`);
      assert(
        receipt.blockNumber === expected.blockNumber,
        `${name} receipt block changed`,
      );
      return [name, { transaction, receipt }];
    }),
  );
  const transactions = Object.fromEntries(transactionEntries);
  const permit2ApprovalBlock = await client.getBlock({
    blockNumber: TRANSACTIONS.permit2Approval.blockNumber,
  });

  const [
    hookFactoryCode,
    hookCode,
    launcherCode,
    uerc20FactoryCode,
    tokenName,
    tokenSymbol,
    tokenDecimals,
    totalSupply,
    tokenCreator,
    tokenGraffiti,
    tokenMetadata,
    finalTokenBalance,
    tokenAllowance,
    permit2Allowance,
    feeConfig,
    launcherFees,
    totalNativeFees,
    hookClaimBalance,
    hookEthBalance,
    launcherFeeRecipient,
    recordedLaunchHash,
    minimumInitialBuy,
    positionOwner,
    positionLiquidity,
    forwarderPositionManager,
    forwarderOperator,
    forwarderTimelock,
    forwarderFeeRecipient,
    slot0,
    confirmedNonce,
  ] = await Promise.all([
    client.getCode({ address: ADDRESSES.hookFactory }),
    client.getCode({ address: ADDRESSES.hook }),
    client.getCode({ address: ADDRESSES.launcher }),
    client.getCode({ address: ADDRESSES.uerc20Factory }),
    client.readContract({
      address: ADDRESSES.token,
      abi: tokenAbi,
      functionName: "name",
    }),
    client.readContract({
      address: ADDRESSES.token,
      abi: tokenAbi,
      functionName: "symbol",
    }),
    client.readContract({
      address: ADDRESSES.token,
      abi: tokenAbi,
      functionName: "decimals",
    }),
    client.readContract({
      address: ADDRESSES.token,
      abi: tokenAbi,
      functionName: "totalSupply",
    }),
    client.readContract({
      address: ADDRESSES.token,
      abi: tokenAbi,
      functionName: "creator",
    }),
    client.readContract({
      address: ADDRESSES.token,
      abi: tokenAbi,
      functionName: "graffiti",
    }),
    client.readContract({
      address: ADDRESSES.token,
      abi: tokenAbi,
      functionName: "metadata",
    }),
    client.readContract({
      address: ADDRESSES.token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [ADDRESSES.account],
    }),
    client.readContract({
      address: ADDRESSES.token,
      abi: tokenAbi,
      functionName: "allowance",
      args: [ADDRESSES.account, ADDRESSES.permit2],
    }),
    client.readContract({
      address: ADDRESSES.permit2,
      abi: permit2Abi,
      functionName: "allowance",
      args: [
        ADDRESSES.account,
        ADDRESSES.token,
        ADDRESSES.universalRouter,
      ],
    }),
    client.readContract({
      address: ADDRESSES.hook,
      abi: hookAbi,
      functionName: "poolFeeConfig",
      args: [POOL_ID],
    }),
    client.readContract({
      address: ADDRESSES.hook,
      abi: hookAbi,
      functionName: "launcherFeesAccrued",
    }),
    client.readContract({
      address: ADDRESSES.hook,
      abi: hookAbi,
      functionName: "totalNativeFeesAccrued",
    }),
    client.readContract({
      address: ADDRESSES.poolManager,
      abi: erc6909Abi,
      functionName: "balanceOf",
      args: [ADDRESSES.hook, 0n],
    }),
    client.getBalance({ address: ADDRESSES.hook }),
    client.readContract({
      address: ADDRESSES.hook,
      abi: hookAbi,
      functionName: "launcherFeeRecipient",
    }),
    client.readContract({
      address: ADDRESSES.launcher,
      abi: launcherAbi,
      functionName: "launchHashOf",
      args: [ADDRESSES.token],
    }),
    client.readContract({
      address: ADDRESSES.launcher,
      abi: launcherAbi,
      functionName: "MIN_INITIAL_BUY_WEI",
    }),
    client.readContract({
      address: ADDRESSES.positionManager,
      abi: positionManagerAbi,
      functionName: "ownerOf",
      args: [POSITION_TOKEN_ID],
    }),
    client.readContract({
      address: ADDRESSES.positionManager,
      abi: positionManagerAbi,
      functionName: "getPositionLiquidity",
      args: [POSITION_TOKEN_ID],
    }),
    client.readContract({
      address: ADDRESSES.positionRecipient,
      abi: positionRecipientAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: ADDRESSES.positionRecipient,
      abi: positionRecipientAbi,
      functionName: "operator",
    }),
    client.readContract({
      address: ADDRESSES.positionRecipient,
      abi: positionRecipientAbi,
      functionName: "timelockBlockNumber",
    }),
    client.readContract({
      address: ADDRESSES.positionRecipient,
      abi: positionRecipientAbi,
      functionName: "feeRecipient",
    }),
    client.readContract({
      address: ADDRESSES.stateView,
      abi: stateViewAbi,
      functionName: "getSlot0",
      args: [POOL_ID],
    }),
    client.getTransactionCount({
      address: ADDRESSES.account,
      blockTag: "latest",
    }),
  ]);

  assert(keccak256(hookFactoryCode) === RUNTIME_CODE_HASHES.hookFactory, "Hook factory runtime hash changed");
  assert(keccak256(hookCode) === RUNTIME_CODE_HASHES.hook, "Hook runtime hash changed");
  assert(keccak256(launcherCode) === RUNTIME_CODE_HASHES.launcher, "Launcher runtime hash changed");
  assert(
    keccak256(uerc20FactoryCode) === RUNTIME_CODE_HASHES.uerc20Factory,
    "Official UERC20Factory runtime hash changed",
  );
  assert(tokenName === "Test2", "Unexpected token name");
  assert(tokenSymbol === "TEST2", "Unexpected token symbol");
  assert(tokenDecimals === 18, "Unexpected token decimals");
  assert(totalSupply === TOKEN_SUPPLY, "Unexpected token supply");
  assertAddress(tokenCreator, ADDRESSES.launcher, "token.creator");
  assert(
    tokenMetadata[0] === EXPECTED_TOKEN_METADATA.description,
    "Unexpected token metadata description",
  );
  assert(
    tokenMetadata[1] === EXPECTED_TOKEN_METADATA.website,
    "Unexpected token metadata website",
  );
  assert(
    tokenMetadata[2] === EXPECTED_TOKEN_METADATA.image,
    "Unexpected token metadata image",
  );
  assert(
    tokenMetadata[3] === EXPECTED_TOKEN_METADATA.extraData,
    "Unexpected token metadata extraData",
  );
  const reproducedTokenAddress = await client.readContract({
    address: ADDRESSES.uerc20Factory,
    abi: uerc20FactoryAbi,
    functionName: "getUERC20Address",
    args: [
      tokenName,
      tokenSymbol,
      tokenDecimals,
      ADDRESSES.launcher,
      tokenGraffiti,
    ],
  });
  assertAddress(
    reproducedTokenAddress,
    ADDRESSES.token,
    "official UERC20Factory provenance",
  );
  assert(finalTokenBalance === FINAL_TOKEN_BALANCE, "Unexpected final creator token balance");
  assert(tokenAllowance === MAX_UINT256, "Token Permit2 allowance is not canonical max");
  assert(permit2Allowance[0] === MAX_UINT160, "Universal Router Permit2 allowance is not max");
  assert(
    permit2Allowance[1] > permit2ApprovalBlock.timestamp + 80_000n,
    "Universal Router Permit2 approval did not cover the reviewed one-day window",
  );
  assertAddress(feeConfig[0], ADDRESSES.account, "feeConfig.creator");
  assertAddress(feeConfig[1], ADDRESSES.launcher, "feeConfig.registrar");
  assert(feeConfig[2] === 100, "Unexpected total swap fee");
  assert(feeConfig[3] === true, "Pool is not registered");
  assert(feeConfig[4] === 0n, "Creator fees remain unclaimed");
  assert(launcherFees === 0n, "Launcher fees remain unclaimed");
  assert(totalNativeFees === 0n, "Hook still accounts native fees");
  assert(hookClaimBalance === 0n, "Hook still owns native ERC-6909 claims");
  assert(hookEthBalance === 0n, "Hook unexpectedly holds direct ETH");
  assertAddress(launcherFeeRecipient, ADDRESSES.treasury, "launcherFeeRecipient");
  assert(recordedLaunchHash === LAUNCH_HASH, "Recorded launch hash changed");
  assert(
    minimumInitialBuy === TRANSACTIONS.launch.value,
    "Mandatory atomic Dev Buy changed",
  );
  assertAddress(positionOwner, ADDRESSES.positionRecipient, "position.owner");
  assert(
    positionLiquidity === EXPECTED_POSITION_LIQUIDITY,
    "Permanent position liquidity changed",
  );
  assertAddress(
    forwarderPositionManager,
    ADDRESSES.positionManager,
    "forwarder.positionManager",
  );
  assertAddress(
    forwarderOperator,
    "0x0000000000000000000000000000000000000000",
    "forwarder.operator",
  );
  assert(forwarderTimelock === MAX_UINT256, "Forwarder timelock is not permanent");
  assertAddress(
    forwarderFeeRecipient,
    ADDRESSES.account,
    "forwarder.feeRecipient",
  );
  assert(slot0[3] === 0, "Pool LP fee is not zero");
  assert(slot0[1] === EXPECTED_FINAL_TICK, "Final pool tick changed");
  assert(confirmedNonce >= 39, "Lifecycle transactions are not all confirmed");

  const launchEvents = decodeEvents(
    transactions.launch.receipt,
    launchEventsAbi,
    ADDRESSES.launcher,
  );
  const launchEvent = eventByName(launchEvents, "MemeTokenLaunched");
  const liquidityEvent = eventByName(
    launchEvents,
    "MemeLiquidityConfigured",
  );
  const initialBuyEvent = eventByName(
    launchEvents,
    "MemeCreatorInitialBuy",
  );
  assertAddress(launchEvent.creator, ADDRESSES.account, "launch.creator");
  assertAddress(launchEvent.token, ADDRESSES.token, "launch.token");
  assert(launchEvent.poolId === POOL_ID, "Launch pool ID changed");
  assertAddress(launchEvent.feeHook, ADDRESSES.hook, "launch.feeHook");
  assertAddress(
    launchEvent.positionRecipient,
    ADDRESSES.positionRecipient,
    "launch.positionRecipient",
  );
  assert(launchEvent.positionTokenId === POSITION_TOKEN_ID, "Position token ID changed");
  assert(launchEvent.totalSwapFeeBps === 100, "Launch fee changed");
  assert(launchEvent.launchHash === LAUNCH_HASH, "Launch event hash changed");
  assert(liquidityEvent.totalSupply === TOKEN_SUPPLY, "Liquidity event supply changed");
  assert(
    liquidityEvent.tokenLiquidityAmount === POSITION_TOKEN_AMOUNT,
    "Liquidity token amount changed",
  );
  assert(liquidityEvent.lockedTokenDust === LOCKED_TOKEN_DUST, "Locked token dust changed");
  assert(
    POSITION_TOKEN_AMOUNT + LOCKED_TOKEN_DUST === TOKEN_SUPPLY,
    "Launch supply accounting does not close",
  );
  assert(liquidityEvent.initialTick === 204_200, "Opening tick changed");
  assert(liquidityEvent.tickLower === -887_200, "Position lower tick changed");
  assert(liquidityEvent.tickUpper === 204_200, "Position upper tick changed");
  assert(liquidityEvent.lpFeePips === 0, "Position LP fee changed");
  assertAddress(initialBuyEvent.creator, ADDRESSES.account, "initialBuy.creator");
  assertAddress(initialBuyEvent.token, ADDRESSES.token, "initialBuy.token");
  assert(initialBuyEvent.poolId === POOL_ID, "Initial Buy pool ID changed");
  assert(
    initialBuyEvent.nativeAmount === TRANSACTIONS.launch.value,
    "Initial Buy native amount changed",
  );
  assert(initialBuyEvent.tokenAmount > FINAL_TOKEN_BALANCE, "Initial Buy output is too small");
  assert(initialBuyEvent.launchHash === LAUNCH_HASH, "Initial Buy launch hash changed");

  const initialBuyFees = eventByName(
    decodeEvents(transactions.launch.receipt, hookAbi, ADDRESSES.hook),
    "NativeSwapFeesAccrued",
  );
  const sellFees = eventByName(
    decodeEvents(transactions.sell.receipt, hookAbi, ADDRESSES.hook),
    "NativeSwapFeesAccrued",
  );
  for (const [label, fees] of [
    ["initialBuy", initialBuyFees],
    ["sell", sellFees],
  ]) {
    assert(fees.poolId === POOL_ID, `${label} fee pool ID changed`);
    const totalFee = (fees.grossNativeAmount * 100n) / 10_000n;
    const launcherFee = (fees.grossNativeAmount * 10n) / 10_000n;
    assert(fees.launcherFee === launcherFee, `${label} Launcher fee changed`);
    assert(
      fees.creatorFee === totalFee - launcherFee,
      `${label} creator fee changed`,
    );
  }
  assert(
    initialBuyFees.grossNativeAmount === TRANSACTIONS.launch.value,
    "Initial Buy gross native amount differs from launch value",
  );

  const creatorClaim = eventByName(
    decodeEvents(
      transactions.creatorClaim.receipt,
      hookAbi,
      ADDRESSES.hook,
    ),
    "CreatorFeesClaimed",
  );
  const launcherClaim = eventByName(
    decodeEvents(
      transactions.launcherClaim.receipt,
      hookAbi,
      ADDRESSES.hook,
    ),
    "LauncherFeesClaimed",
  );
  const expectedCreatorClaim =
    initialBuyFees.creatorFee + sellFees.creatorFee;
  const expectedLauncherClaim =
    initialBuyFees.launcherFee + sellFees.launcherFee;
  assert(creatorClaim.amount === expectedCreatorClaim, "Creator claim does not reconcile");
  assert(launcherClaim.amount === expectedLauncherClaim, "Launcher claim does not reconcile");
  assertAddress(creatorClaim.creator, ADDRESSES.account, "claim.creator");
  assertAddress(creatorClaim.recipient, ADDRESSES.account, "claim.recipient");
  assertAddress(launcherClaim.treasury, ADDRESSES.treasury, "claim.treasury");
  assertAddress(launcherClaim.recipient, ADDRESSES.treasury, "claim.launcherRecipient");

  const balanceChecks = await Promise.all(
    [
      ["launch", ADDRESSES.account],
      ["permit2Approval", ADDRESSES.account],
      ["sell", ADDRESSES.account],
      ["creatorClaim", ADDRESSES.account],
      ["launcherClaim", ADDRESSES.account],
      ["launcherTreasury", ADDRESSES.treasury],
    ].map(async ([name, address]) => {
      const transactionName =
        name === "launcherTreasury" ? "launcherClaim" : name;
      const blockNumber = TRANSACTIONS[transactionName].blockNumber;
      const [before, after] = await Promise.all([
        client.getBalance({ address, blockNumber: blockNumber - 1n }),
        client.getBalance({ address, blockNumber }),
      ]);
      return [name, { before, after }];
    }),
  );
  const balances = Object.fromEntries(balanceChecks);
  assert(
    balances.launch.after - balances.launch.before ===
      -TRANSACTIONS.launch.value - transactionCost(transactions.launch.receipt),
    "Atomic launch and Dev Buy ETH balance delta does not reconcile",
  );
  assert(
    balances.permit2Approval.after - balances.permit2Approval.before ===
      -transactionCost(transactions.permit2Approval.receipt),
    "Permit2 approval gas does not reconcile",
  );
  const sellNetNative =
    sellFees.grossNativeAmount - sellFees.creatorFee - sellFees.launcherFee;
  assert(
    balances.sell.after - balances.sell.before ===
      sellNetNative - transactionCost(transactions.sell.receipt),
    "Sell ETH balance delta does not reconcile",
  );
  assert(
    balances.creatorClaim.after - balances.creatorClaim.before ===
      creatorClaim.amount - transactionCost(transactions.creatorClaim.receipt),
    "Creator claim ETH balance delta does not reconcile",
  );
  assert(
    balances.launcherClaim.after - balances.launcherClaim.before ===
      -transactionCost(transactions.launcherClaim.receipt),
    "Launcher claim caller gas does not reconcile",
  );
  assert(
    balances.launcherTreasury.after - balances.launcherTreasury.before ===
      launcherClaim.amount,
    "Treasury balance delta does not reconcile",
  );

  const [preLaunchTokenCode, launchTokenBalance, soldTokenBalance] =
    await Promise.all([
      client.getCode({
        address: ADDRESSES.token,
        blockNumber: TRANSACTIONS.launch.blockNumber - 1n,
      }),
      client.readContract({
        address: ADDRESSES.token,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [ADDRESSES.account],
        blockNumber: TRANSACTIONS.launch.blockNumber,
      }),
      client.readContract({
        address: ADDRESSES.token,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [ADDRESSES.account],
        blockNumber: TRANSACTIONS.sell.blockNumber,
      }),
    ]);
  assert(
    preLaunchTokenCode === undefined || preLaunchTokenCode === "0x",
    "Predicted token address already contained code before launch",
  );
  assert(
    launchTokenBalance === initialBuyEvent.tokenAmount,
    "Atomic Dev Buy token output does not reconcile",
  );
  assert(
    soldTokenBalance === FINAL_TOKEN_BALANCE,
    "Sell did not retain the target balance",
  );

  return {
    latestBlock: (await client.getBlockNumber()).toString(),
    confirmedNonce,
    transactionBlocks: Object.fromEntries(
      Object.entries(TRANSACTIONS).map(([name, transaction]) => [
        name,
        Number(transaction.blockNumber),
      ]),
    ),
    transactionGasUsed: Object.fromEntries(
      Object.entries(transactions).map(([name, value]) => [
        name,
        value.receipt.gasUsed.toString(),
      ]),
    ),
    initialBuyNativeInput: initialBuyEvent.nativeAmount,
    initialBuyTokenOutput: launchTokenBalance,
    sellTokenInput: launchTokenBalance - soldTokenBalance,
    sellGrossNativeOutput: sellFees.grossNativeAmount,
    sellNetNativeOutput: sellNetNative,
    creatorFeesClaimed: creatorClaim.amount,
    launcherFeesClaimed: launcherClaim.amount,
    finalTokenBalance,
    finalTick: slot0[1],
    finalSqrtPriceX96: slot0[0],
    positionLiquidity,
    treasuryBalanceDelta:
      balances.launcherTreasury.after - balances.launcherTreasury.before,
  };
}

const clients = RPC_ENDPOINTS.map((endpoint) =>
  createPublicClient({
    chain: sepolia,
    transport: rateLimitedHttp(endpoint),
  }),
);
const evidence = await Promise.all(clients.map((client) => readEvidence(client)));
const [reference, comparison] = evidence;
const verifiedSources = await Promise.all(
  SOURCE_VERIFICATION.map(async ([address, name, optimizerRuns, evmVersion]) => {
    const response = await fetch(
      `https://eth-sepolia.blockscout.com/api/v2/smart-contracts/${address}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    assert(response.ok, `${name} source verification returned HTTP ${response.status}`);
    const contract = await response.json();
    assert(contract.name === name, `${name} source verification is missing`);
    assert(contract.optimization_enabled === true, `${name} optimizer is disabled`);
    assert(contract.optimization_runs === optimizerRuns, `${name} optimizer runs changed`);
    assert(contract.evm_version === evmVersion, `${name} EVM version changed`);
    return name;
  }),
);

for (const field of [
  "confirmedNonce",
  "initialBuyNativeInput",
  "initialBuyTokenOutput",
  "sellTokenInput",
  "sellGrossNativeOutput",
  "sellNetNativeOutput",
  "creatorFeesClaimed",
  "launcherFeesClaimed",
  "finalTokenBalance",
  "finalTick",
  "finalSqrtPriceX96",
  "positionLiquidity",
  "treasuryBalanceDelta",
]) {
  assert(reference[field] === comparison[field], `Independent RPCs disagree on ${field}`);
}

const serializable = JSON.parse(
  JSON.stringify(reference, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  ),
);
console.log(
  JSON.stringify(
    {
      verifiedRpcCount: RPC_ENDPOINTS.length,
      verifiedSourceCount: verifiedSources.length,
      token: ADDRESSES.token,
      poolId: POOL_ID,
      positionRecipient: ADDRESSES.positionRecipient,
      positionTokenId: POSITION_TOKEN_ID.toString(),
      transactions: Object.fromEntries(
        Object.entries(TRANSACTIONS).map(([name, transaction]) => [
          name,
          transaction.hash,
        ]),
      ),
      ...serializable,
    },
    null,
    2,
  ),
);
