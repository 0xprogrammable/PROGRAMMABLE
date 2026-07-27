import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

const appDeployments = JSON.parse(
  await readFile(
    new URL(
      "../contracts/config/app-deployments.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const fixturePath = process.env.MEME_LAUNCH_FIXTURE_JSON;
const fixture = fixturePath
  ? JSON.parse(await readFile(fixturePath, "utf8"))
  : null;
const IS_MAINNET = process.env.MEME_LAUNCH_NETWORK === "mainnet";
const deployment = IS_MAINNET
  ? appDeployments.production
  : appDeployments.rehearsal;
const chain = IS_MAINNET ? mainnet : sepolia;
const NETWORK_NAME = IS_MAINNET ? "Ethereum Mainnet" : "Sepolia";
const NETWORK_SHORT_NAME = IS_MAINNET ? "Ethereum" : "Sepolia";
const pendingLifecycle =
  deployment?.status === "ready" &&
  deployment?.memeLaunchStatus === "lifecycle-pending" &&
  deployment?.lifecycleEvidence?.status === "pending-current-release";
const verifiedLifecycle =
  deployment?.status === "ready" &&
  deployment?.memeLaunchStatus === "ready" &&
  deployment?.lifecycleEvidence?.status ===
    "verified-current-release" &&
  deployment?.lifecycleEvidence?.releaseEligible === true;
if (
  fixture &&
  (fixture.schemaVersion !== 1 ||
    fixture.chainId !== chain.id ||
    fixture.requiredRelease !== deployment?.releaseVersion)
) {
  throw new Error(
    `${NETWORK_NAME} fixture requires ${fixture?.requiredRelease ?? "an unknown release"}; refusing to prepare it against ${deployment?.releaseVersion ?? "an unversioned deployment"}`,
  );
}
if (
  deployment?.chainId !== chain.id ||
  (!pendingLifecycle && !verifiedLifecycle)
) {
  throw new Error(
    `${NETWORK_NAME} Classic requires verified infrastructure and coherent lifecycle evidence; refusing to prepare transactions`,
  );
}

const require = createRequire(import.meta.url);
const { Actions, V4Planner } = require("@uniswap/v4-sdk");
const { CommandType, RoutePlanner } = require(
  "@uniswap/universal-router-sdk",
);

const HOST = "127.0.0.1";
const PORT = Number(process.env.MEME_LAUNCH_TEST_PORT ?? 4174);
const EXPECTED_CHAIN_ID = toHex(deployment.chainId);
const EXPECTED_ACCOUNT = getAddress(deployment.deployer).toLowerCase();
const LAUNCHER = getAddress(deployment.memeLaunch).toLowerCase();
const EXPECTED_LAUNCHER_CODE_HASH =
  deployment.runtimeCodeHashes.memeLaunch.toLowerCase();
const FEE_HOOK = getAddress(
  deployment.ethCreatorFeeHook,
).toLowerCase();
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const UNIVERSAL_ROUTER = IS_MAINNET
  ? "0xd92A36B0000531EF3063dEd4De20A0783308446C"
  : "0x470ffc67b1feEEC31D16c46ac7545c98716a194c";
const V4_QUOTER = IS_MAINNET
  ? "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203"
  : "0x61b3f2011a92d183c7dbadbda940a7555ccf9227";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BUY_AMOUNT = 100_000_000_000_000n;
const INITIAL_BUY_AMOUNT = fixture
  ? BigInt(fixture.launch.initialBuyWei)
  : 600_000_000_000_000n;
const TARGET_TOKEN_BALANCE = 30_000n * 10n ** 18n;
const UINT160_MAX = (1n << 160n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const TOKEN_NAME = fixture?.token?.name ?? "Test";
const TOKEN_SYMBOL = fixture?.token?.symbol ?? "TEST";
const TOKEN_EXTRA_DATA = toHex(
  JSON.stringify(
    fixture?.token?.extraData ?? {
      v: 1,
      x: IS_MAINNET
        ? "https://x.com/0xProgrammable"
        : "https://x.com/elonmusk",
    },
  ),
);
const CREATOR_SALT = keccak256(
  toHex(
    fixture?.launch?.creatorSaltSeed ??
      (IS_MAINNET
        ? "programmable-mainnet-classic-v1-test-2026-07-27"
        : "programmable-sepolia-test-metadata-v1-2026-07-27"),
  ),
);
const TOTAL_SWAP_FEE_BPS =
  fixture?.launch?.totalSwapFeeBps ?? 100;
const RPC_ENDPOINTS = IS_MAINNET
  ? ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"]
  : [
      "https://sepolia.drpc.org",
      "https://sepolia.gateway.tenderly.co",
    ];

const launchAbi = parseAbi([
  "function launch((string name,string symbol,uint16 totalSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata) parameters) payable returns ((address token,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,bytes32 poolId,bytes32 launchHash,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount) result)",
  "function predictTokenAddress(string name,string symbol,address creator,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
]);
const tokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);
const permit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
const feeHookAbi = parseAbi([
  "function poolFeeConfig(bytes32 poolId) view returns (address creator,address registrar,uint16 totalSwapFeeBps,bool registered,uint256 creatorFeesAccrued)",
  "function launcherFeesAccrued() view returns (uint256)",
  "function claimCreatorFees(bytes32 poolId)",
  "function claimLauncherFees()",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
const universalRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);

const launchData = encodeFunctionData({
  abi: launchAbi,
  functionName: "launch",
  args: [
    {
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      totalSwapFeeBps: TOTAL_SWAP_FEE_BPS,
      creatorSalt: CREATOR_SALT,
      metadata: {
        description:
          fixture?.token?.description ?? "This is a test.",
        website:
          fixture?.token?.website ??
          (IS_MAINNET
            ? "https://programmable.family"
            : "https://www.forbes.com/"),
        image:
          fixture?.token?.image ??
          "https://programmable.family/brand/programmable-token-fallback-01-dawn.webp",
        extraData: TOKEN_EXTRA_DATA,
      },
    },
  ],
});

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_ENDPOINTS[0]),
});
const [predictedToken] = await publicClient.readContract({
  address: getAddress(LAUNCHER),
  abi: launchAbi,
  functionName: "predictTokenAddress",
  args: [
    TOKEN_NAME,
    TOKEN_SYMBOL,
    getAddress(EXPECTED_ACCOUNT),
    CREATOR_SALT,
  ],
});
const PREDICTED_TOKEN = getAddress(predictedToken).toLowerCase();
const poolKey = {
  currency0: ZERO_ADDRESS,
  currency1: getAddress(PREDICTED_TOKEN),
  fee: 0,
  tickSpacing: 200,
  hooks: getAddress(FEE_HOOK),
};
const POOL_ID = keccak256(
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

function buildSwapData({
  zeroForOne,
  amountIn,
  amountOutMinimum,
  deadline,
}) {
  const planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [
    {
      poolKey,
      zeroForOne,
      amountIn: amountIn.toString(),
      amountOutMinimum: amountOutMinimum.toString(),
      hookData: "0x",
    },
  ]);
  planner.addAction(Actions.SETTLE_ALL, [
    zeroForOne ? ZERO_ADDRESS : getAddress(PREDICTED_TOKEN),
    amountIn.toString(),
  ]);
  planner.addAction(Actions.TAKE_ALL, [
    zeroForOne ? getAddress(PREDICTED_TOKEN) : ZERO_ADDRESS,
    amountOutMinimum.toString(),
  ]);

  const route = new RoutePlanner();
  route.addCommand(CommandType.V4_SWAP, [planner.finalize()]);
  return encodeFunctionData({
    abi: universalRouterAbi,
    functionName: "execute",
    args: [route.commands, route.inputs, deadline],
  });
}

async function quoteExactInput(zeroForOne, amountIn) {
  const [amountOut] = await publicClient.readContract({
    address: getAddress(V4_QUOTER),
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey,
        zeroForOne,
        exactAmount: amountIn,
        hookData: "0x",
      },
    ],
  });
  return amountOut;
}

async function buildLifecycleAction() {
  const block = await publicClient.getBlock();
  const [tokenBalance, tokenAllowance, permitAllowance, feeConfig, launcherFees] =
    await Promise.all([
      publicClient.readContract({
        address: getAddress(PREDICTED_TOKEN),
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [getAddress(EXPECTED_ACCOUNT)],
      }),
      publicClient.readContract({
        address: getAddress(PREDICTED_TOKEN),
        abi: tokenAbi,
        functionName: "allowance",
        args: [getAddress(EXPECTED_ACCOUNT), getAddress(PERMIT2)],
      }),
      publicClient.readContract({
        address: getAddress(PERMIT2),
        abi: permit2Abi,
        functionName: "allowance",
        args: [
          getAddress(EXPECTED_ACCOUNT),
          getAddress(PREDICTED_TOKEN),
          getAddress(UNIVERSAL_ROUTER),
        ],
      }),
      publicClient.readContract({
        address: getAddress(FEE_HOOK),
        abi: feeHookAbi,
        functionName: "poolFeeConfig",
        args: [POOL_ID],
      }),
      publicClient.readContract({
        address: getAddress(FEE_HOOK),
        abi: feeHookAbi,
        functionName: "launcherFeesAccrued",
      }),
    ]);
  const deadline = block.timestamp + 3_600n;

  if (tokenBalance === 0n) {
    const amountOut = await quoteExactInput(true, BUY_AMOUNT);
    const amountOutMinimum = (amountOut * 95n) / 100n;
    return {
      id: "buy",
      label: "Buy with 0.0001 ETH",
      detail:
        "The official Uniswap Universal Router will swap 0.0001 native ETH for at least " +
        (Number(amountOutMinimum) / 1e18).toFixed(2) +
        ` ${TOKEN_SYMBOL}.`,
      transaction: {
        to: UNIVERSAL_ROUTER,
        data: buildSwapData({
          zeroForOne: true,
          amountIn: BUY_AMOUNT,
          amountOutMinimum,
          deadline,
        }),
        value: BUY_AMOUNT.toString(),
      },
    };
  }

  if (tokenBalance > TARGET_TOKEN_BALANCE) {
    const sellAmount = tokenBalance - TARGET_TOKEN_BALANCE;
    if (tokenAllowance < sellAmount) {
      return {
        id: "token-approval",
        label: "Approve Permit2",
        detail:
          `Approve the canonical Permit2 contract to move ${TOKEN_SYMBOL} for the reviewed sell.`,
        transaction: {
          to: PREDICTED_TOKEN,
          data: encodeFunctionData({
            abi: tokenAbi,
            functionName: "approve",
            args: [getAddress(PERMIT2), UINT256_MAX],
          }),
          value: "0",
        },
      };
    }

    const [permitAmount, permitExpiration] = permitAllowance;
    if (
      permitAmount < sellAmount ||
      BigInt(permitExpiration) <= block.timestamp + 600n
    ) {
      return {
        id: "router-approval",
        label: "Approve Universal Router",
        detail:
          "Authorize the official Universal Router through Permit2 for one day.",
        transaction: {
          to: PERMIT2,
          data: encodeFunctionData({
            abi: permit2Abi,
            functionName: "approve",
            args: [
              getAddress(PREDICTED_TOKEN),
              getAddress(UNIVERSAL_ROUTER),
              UINT160_MAX,
              Number(block.timestamp + 86_400n),
            ],
          }),
          value: "0",
        },
      };
    }

    const amountOut = await quoteExactInput(false, sellAmount);
    const amountOutMinimum = (amountOut * 95n) / 100n;
    return {
      id: "sell",
      label: "Sell back to ETH",
      detail:
        `Sell ${TOKEN_SYMBOL} through the same v4 pool and receive at least ` +
        (Number(amountOutMinimum) / 1e18).toFixed(8) +
        " native ETH.",
      transaction: {
        to: UNIVERSAL_ROUTER,
        data: buildSwapData({
          zeroForOne: false,
          amountIn: sellAmount,
          amountOutMinimum,
          deadline,
        }),
        value: "0",
      },
    };
  }

  const creatorFees = feeConfig[4];
  if (creatorFees > 0n) {
    return {
      id: "creator-claim",
      label: "Claim creator fees",
      detail:
        "Claim " +
        (Number(creatorFees) / 1e18).toFixed(9) +
        " native ETH to the token creator.",
      transaction: {
        to: FEE_HOOK,
        data: encodeFunctionData({
          abi: feeHookAbi,
          functionName: "claimCreatorFees",
          args: [POOL_ID],
        }),
        value: "0",
      },
    };
  }

  if (launcherFees > 0n) {
    return {
      id: "launcher-claim",
      label: "Claim Programmable fees",
      detail:
        "Claim " +
        (Number(launcherFees) / 1e18).toFixed(9) +
        " native ETH to the immutable Programmable treasury.",
      transaction: {
        to: FEE_HOOK,
        data: encodeFunctionData({
          abi: feeHookAbi,
          functionName: "claimLauncherFees",
        }),
        value: "0",
      },
    };
  }

  return {
    id: "complete",
    label: "Lifecycle complete",
    detail:
      "The signed launch, buy, sell and both native fee claims are complete.",
    transaction: null,
  };
}

function assertRpcHex(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]*$/i.test(value)) {
    throw new Error(`Invalid ${label} from ${NETWORK_NAME} RPC`);
  }
  return value.toLowerCase();
}

async function readRpcState(endpoint) {
  const requests = [
    ["eth_getTransactionCount", [EXPECTED_ACCOUNT, "latest"]],
    ["eth_getTransactionCount", [EXPECTED_ACCOUNT, "pending"]],
    ["eth_getBalance", [EXPECTED_ACCOUNT, "latest"]],
    ["eth_getCode", [LAUNCHER, "latest"]],
    ["eth_getCode", [PREDICTED_TOKEN, "latest"]],
  ];
  const payload = await Promise.all(
    requests.map(async ([method, params], index) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: index + 1,
          method,
          params,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`${NETWORK_NAME} RPC returned HTTP ${response.status}`);
      }
      return response.json();
    }),
  );
  const results = new Map(payload.map((entry) => [entry.id, entry]));
  for (let id = 1; id <= requests.length; id += 1) {
    if (results.get(id)?.error) {
      throw new Error(`${NETWORK_NAME} RPC request ${id} failed`);
    }
  }

  const launcherCode = assertRpcHex(
    results.get(4)?.result,
    "launcher bytecode",
  );
  return {
    confirmedNonce: assertRpcHex(
      results.get(1)?.result,
      "confirmed nonce",
    ),
    pendingNonce: assertRpcHex(results.get(2)?.result, "pending nonce"),
    balance: assertRpcHex(results.get(3)?.result, "balance"),
    launcherCodeHash:
      launcherCode === "0x" ? null : keccak256(launcherCode),
    tokenCode: assertRpcHex(results.get(5)?.result, "token bytecode"),
  };
}

async function readVerifiedState() {
  const states = await Promise.all(
    RPC_ENDPOINTS.map((endpoint) => readRpcState(endpoint)),
  );
  const [reference, ...others] = states;
  if (
    others.some(
      (state) =>
        state.confirmedNonce !== reference.confirmedNonce ||
        state.pendingNonce !== reference.pendingNonce ||
        state.balance !== reference.balance ||
        state.launcherCodeHash !== reference.launcherCodeHash ||
        state.tokenCode !== reference.tokenCode,
    )
  ) {
    throw new Error(`Independent ${NETWORK_NAME} RPCs disagree`);
  }
  if (reference.launcherCodeHash !== EXPECTED_LAUNCHER_CODE_HASH) {
    throw new Error("MemeLaunchV1 runtime bytecode does not match");
  }
  return reference;
}

function renderHtml() {
  const configuration = JSON.stringify({
    expectedAccount: EXPECTED_ACCOUNT,
    expectedChainId: EXPECTED_CHAIN_ID,
    launcher: LAUNCHER,
    predictedToken: PREDICTED_TOKEN,
    launchData,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Programmable ${NETWORK_NAME} token launch</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #fbfafb;
        color: #211b20;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 10% 0%, rgba(246, 192, 222, .48), transparent 30rem),
          radial-gradient(circle at 92% 8%, rgba(235, 220, 255, .5), transparent 34rem),
          #fbfafb;
      }
      main { width: min(760px, calc(100% - 32px)); margin: 0 auto; padding: 52px 0 64px; }
      .brand { align-items: center; display: flex; gap: 10px; margin-bottom: 38px; }
      .mark { align-items: center; background: #f4c0dc; border-radius: 10px; color: #7e2d59; display: flex; font-size: 18px; font-weight: 760; height: 34px; justify-content: center; width: 34px; }
      .brand strong { font-size: 15px; letter-spacing: -.02em; }
      .eyebrow { color: #a44b79; font-size: 11px; font-weight: 720; letter-spacing: .11em; text-transform: uppercase; }
      h1 { font-size: clamp(36px, 7vw, 56px); font-weight: 590; letter-spacing: -.055em; line-height: 1; margin: 13px 0 15px; }
      .intro { color: #71676d; font-size: 16px; line-height: 1.6; margin: 0; max-width: 660px; }
      .panel { background: rgba(255,255,255,.88); border: 1px solid #e7dfe4; border-radius: 24px; box-shadow: 0 22px 60px rgba(72,46,62,.08); margin-top: 30px; overflow: hidden; }
      dl { display: grid; grid-template-columns: repeat(3, 1fr); margin: 0; border-bottom: 1px solid #ece5e9; }
      dl div { min-height: 100px; padding: 20px; }
      dl div + div { border-left: 1px solid #ece5e9; }
      dt { color: #91878e; font-size: 10px; font-weight: 680; letter-spacing: .09em; text-transform: uppercase; }
      dd { font-size: 14px; font-weight: 640; margin: 8px 0 0; overflow-wrap: anywhere; }
      .token { padding: 22px 20px; }
      .token strong { display: block; font-size: 19px; letter-spacing: -.025em; }
      .token p { color: #71676d; font-size: 13px; line-height: 1.55; margin: 7px 0 0; }
      .token code { color: #8f858b; display: block; font-size: 10px; margin-top: 11px; overflow-wrap: anywhere; }
      .actions { border-top: 1px solid #ece5e9; display: flex; flex-wrap: wrap; gap: 10px; padding: 20px; }
      button { border: 0; border-radius: 13px; cursor: pointer; font: inherit; font-size: 14px; font-weight: 680; min-height: 46px; padding: 0 18px; }
      button.primary { background: #eaa6ca; color: #341423; }
      button.secondary { background: #f7f2f5; border: 1px solid #e4dade; color: #3b3439; }
      button:disabled { cursor: not-allowed; opacity: .48; }
      .notice { border-top: 1px solid #ece5e9; color: #71676d; font-size: 13px; line-height: 1.55; margin: 0; min-height: 58px; padding: 18px 20px; }
      .notice.error { color: #a33e4c; }
      .notice.success { color: #23704e; }
      .warning { color: #8c7352; font-size: 12px; line-height: 1.55; margin: 17px 2px 0; }
      @media (max-width: 620px) {
        main { padding-top: 30px; }
        dl { grid-template-columns: 1fr; }
        dl div { min-height: auto; }
        dl div + div { border-left: 0; border-top: 1px solid #ece5e9; }
        .actions { align-items: stretch; flex-direction: column; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="mark">P</span><strong>Programmable</strong></div>
      <p class="eyebrow">${NETWORK_NAME} lifecycle test</p>
      <h1>Verify the complete token lifecycle</h1>
      <p class="intro">Each step is derived from current onchain state. The test covers launch, a real Uniswap v4 buy and sell, and both native ETH fee claims.</p>
      <section class="panel" aria-label="Test launch status">
        <dl>
          <div><dt>Network</dt><dd id="network">Not connected</dd></div>
          <div><dt>Account</dt><dd id="account">Not connected</dd></div>
          <div><dt>Balance</dt><dd id="balance">Not connected</dd></div>
        </dl>
        <div class="token">
          <strong>${TOKEN_NAME} · $${TOKEN_SYMBOL}</strong>
          <p>One billion tokens · 1.00% total swap fee · 0.0006 ETH Dev Buy</p>
          <code>${PREDICTED_TOKEN}</code>
        </div>
        <div class="actions">
          <button class="secondary" id="connect">Connect MetaMask</button>
          <button class="primary" id="launch" disabled>Prepare next step</button>
          <button class="secondary" id="refresh" disabled>Refresh state</button>
        </div>
        <p class="notice" id="notice" role="status">Connect the configured ${NETWORK_NAME} wallet to prepare the next verified step.</p>
      </section>
      <p class="warning" id="warning">Every transaction is simulated before wallet review.</p>
    </main>
    <script>
      const configuration = ${configuration};
      const connectButton = document.getElementById("connect");
      const launchButton = document.getElementById("launch");
      const refreshButton = document.getElementById("refresh");
      const networkValue = document.getElementById("network");
      const accountValue = document.getElementById("account");
      const balanceValue = document.getElementById("balance");
      const notice = document.getElementById("notice");
      const warning = document.getElementById("warning");

      let provider;
      let account;
      let busy = false;
      let transactionParameters;
      let preparedAction;

      function setNotice(message, tone) {
        notice.textContent = message;
        notice.className = "notice" + (tone ? " " + tone : "");
      }

      function getProvider() {
        const injected = window.ethereum;
        if (!injected) return null;
        if (Array.isArray(injected.providers)) {
          return (
            injected.providers.find((candidate) => candidate.isMetaMask) ??
            injected.providers[0]
          );
        }
        return injected;
      }

      async function request(method, params = []) {
        if (!provider) throw new Error("MetaMask is not available");
        return provider.request({ method, params });
      }

      async function ensureSepolia() {
        const chainId = String(await request("eth_chainId")).toLowerCase();
        if (chainId !== configuration.expectedChainId) {
          await request("wallet_switchEthereumChain", [
            { chainId: configuration.expectedChainId },
          ]);
        }
        const verified = String(await request("eth_chainId")).toLowerCase();
        if (verified !== configuration.expectedChainId) {
          throw new Error("Switch MetaMask to ${NETWORK_NAME}");
        }
        networkValue.textContent = "${NETWORK_SHORT_NAME} · ${chain.id}";
      }

      async function assertAccount() {
        const accounts = await request("eth_accounts");
        account = String(accounts[0] ?? "").toLowerCase();
        if (account !== configuration.expectedAccount) {
          throw new Error("Select the configured ${NETWORK_NAME} deployment wallet");
        }
        accountValue.textContent =
          account.slice(0, 8) + "…" + account.slice(-6);
      }

      async function readState() {
        const response = await fetch("/network-state", { cache: "no-store" });
        const state = await response.json();
        if (!response.ok) {
          throw new Error(state.error ?? "${NETWORK_NAME} state is unavailable");
        }
        return state;
      }

      async function readLifecycleAction() {
        const response = await fetch("/lifecycle-action", {
          cache: "no-store",
        });
        const action = await response.json();
        if (!response.ok) {
          throw new Error(action.error ?? "The lifecycle state is unavailable");
        }
        return action;
      }

      function formatEth(value) {
        const wei = BigInt(value);
        const whole = wei / 10n ** 18n;
        const fraction = (wei % 10n ** 18n)
          .toString()
          .padStart(18, "0")
          .slice(0, 6);
        return whole + "." + fraction + " ETH";
      }

      function updateButtons() {
        connectButton.disabled = busy || Boolean(account);
        refreshButton.disabled = busy || !account;
        launchButton.disabled = busy || !account || !transactionParameters;
      }

      async function prepareTransaction() {
        await ensureSepolia();
        await assertAccount();
        const state = await readState();
        balanceValue.textContent = formatEth(state.balance);
        transactionParameters = undefined;
        preparedAction = undefined;

        if (state.confirmedNonce !== state.pendingNonce) {
          throw new Error("A transaction is currently pending on ${NETWORK_NAME}");
        }

        const action =
          state.tokenCode === "0x"
            ? {
                id: "launch",
                label: "Launch test token",
                detail:
                  "Create ${TOKEN_SYMBOL}, initialize its v4 pool, lock the complete supply and execute the 0.0006 ETH Dev Buy atomically.",
                transaction: {
                  to: configuration.launcher,
                  data: configuration.launchData,
                  value: "${INITIAL_BUY_AMOUNT.toString()}",
                },
              }
            : await readLifecycleAction();

        if (!action.transaction) {
          launchButton.textContent = action.label;
          warning.textContent =
            "All signed lifecycle transactions are confirmed on ${NETWORK_NAME}.";
          setNotice(action.detail, "success");
          updateButtons();
          return;
        }

        const value = BigInt(action.transaction.value);
        const transaction = {
          from: account,
          to: action.transaction.to,
          data: action.transaction.data,
          value: "0x" + value.toString(16),
          nonce: state.confirmedNonce,
        };
        const [estimateHex, quotedGasPriceHex] = await Promise.all([
          request("eth_estimateGas", [transaction]),
          request("eth_gasPrice"),
        ]);
        const estimatedGas = BigInt(estimateHex);
        const gasLimit = (estimatedGas * 120n + 99n) / 100n;
        const gasPrice =
          (BigInt(quotedGasPriceHex) * 125n + 99n) / 100n;
        const gasCeiling = gasLimit * gasPrice + value;
        if (BigInt(state.balance) < gasCeiling) {
          throw new Error(
            "The wallet balance is below the conservative transaction ceiling",
          );
        }

        transactionParameters = {
          ...transaction,
          gas: "0x" + gasLimit.toString(16),
          gasPrice: "0x" + gasPrice.toString(16),
        };
        preparedAction = action;
        launchButton.textContent = action.label;
        warning.textContent =
          "Review only this ${NETWORK_NAME} call: " +
          action.transaction.to +
          " · value " +
          formatEth(action.transaction.value);
        setNotice(action.detail + " Simulation succeeded.", "success");
        updateButtons();
      }

      async function connect() {
        if (busy) return;
        busy = true;
        updateButtons();
        setNotice("Waiting for MetaMask.");
        try {
          provider = getProvider();
          if (!provider) throw new Error("MetaMask is not available in this browser");
          const accounts = await request("eth_accounts");
          if (!accounts.length) {
            await request("eth_requestAccounts");
          }
          await prepareTransaction();
          connectButton.textContent = "Connected";
        } catch (error) {
          account = undefined;
          transactionParameters = undefined;
          preparedAction = undefined;
          connectButton.textContent = "Connect MetaMask";
          setNotice(error?.message ?? String(error), "error");
        } finally {
          busy = false;
          updateButtons();
        }
      }

      async function waitForReceipt(hash) {
        for (let attempt = 0; attempt < 300; attempt += 1) {
          const receipt = await request("eth_getTransactionReceipt", [hash]);
          if (receipt) return receipt;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        throw new Error("The transaction is still pending after ten minutes");
      }

      async function waitForIndependentState() {
        let latestError;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          try {
            return await readState();
          } catch (error) {
            latestError = error;
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
        throw latestError ?? new Error("Independent ${NETWORK_NAME} RPC state is delayed");
      }

      async function executeNextStep() {
        if (busy || !transactionParameters || !preparedAction) return;
        busy = true;
        updateButtons();
        try {
          await prepareTransaction();
          if (!transactionParameters || !preparedAction) return;
          const reviewedAction = preparedAction;
          const reviewedTransaction = transactionParameters;
          setNotice(
            "Review " + reviewedAction.label + " in MetaMask on ${NETWORK_NAME}.",
          );
          const hash = await request("eth_sendTransaction", [
            reviewedTransaction,
          ]);
          transactionParameters = undefined;
          preparedAction = undefined;
          setNotice("Waiting for " + reviewedAction.label + " to confirm.");
          const receipt = await waitForReceipt(hash);
          if (receipt.status !== "0x1") {
            throw new Error(reviewedAction.label + " reverted");
          }
          if (
            String(receipt.from ?? "").toLowerCase() !==
              configuration.expectedAccount ||
            String(receipt.to ?? "").toLowerCase() !==
              String(reviewedAction.transaction.to).toLowerCase()
          ) {
            throw new Error("The receipt does not match the reviewed call");
          }
          await new Promise((resolve) => setTimeout(resolve, 2500));
          const state = await waitForIndependentState();
          balanceValue.textContent = formatEth(state.balance);
          setNotice(
            reviewedAction.label + " confirmed. Transaction " + hash,
            "success",
          );
        } catch (error) {
          setNotice(error?.message ?? String(error), "error");
        } finally {
          busy = false;
          await prepareTransaction().catch(() => {});
          updateButtons();
        }
      }

      connectButton.addEventListener("click", connect);
      launchButton.addEventListener("click", executeNextStep);
      refreshButton.addEventListener("click", () => {
        prepareTransaction().catch((error) => {
          setNotice(error?.message ?? String(error), "error");
        });
      });
    </script>
  </body>
</html>`;
}

async function main() {
  const html = renderHtml();
  const server = createServer(async (request, response) => {
    const headers = {
      "cache-control": "no-store",
      "cross-origin-resource-policy": "same-origin",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    };

    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, {
        ...headers,
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(html);
      return;
    }

    if (request.method === "GET" && request.url === "/network-state") {
      try {
        const state = await readVerifiedState();
        response.writeHead(200, {
          ...headers,
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(state));
      } catch (error) {
        response.writeHead(503, {
          ...headers,
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: error?.message ?? String(error) }));
      }
      return;
    }

    if (request.method === "GET" && request.url === "/lifecycle-action") {
      try {
        const state = await readVerifiedState();
        if (state.tokenCode === "0x") {
          throw new Error("The test token has not been launched");
        }
        const action = await buildLifecycleAction();
        response.writeHead(200, {
          ...headers,
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(action));
      } catch (error) {
        response.writeHead(503, {
          ...headers,
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: error?.message ?? String(error) }));
      }
      return;
    }

    response.writeHead(404, {
      ...headers,
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
  });

  server.listen(PORT, HOST, () => {
    console.log(`Programmable ${NETWORK_NAME} token launch: http://${HOST}:${PORT}`);
    console.log(`Predicted token: ${PREDICTED_TOKEN}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
