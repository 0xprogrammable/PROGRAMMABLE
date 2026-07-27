import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { keccak256 } from "viem";

const HOST = "127.0.0.1";
const PORT = Number(process.env.LAUNCHER_DEPLOYER_PORT ?? 4173);
const EXPECTED_ACCOUNT =
  "0x2bb333d48dfaf1596d9036671d2e43168994249e";
const EXPECTED_CHAIN_ID = "0x1";
const EXPECTED_START_NONCE = 0;
const MAX_HASH_REQUEST_BYTES = 100_000;
const MAINNET_RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];

const POSITION_FORWARDER_FACTORY =
  "0x291a9ff1059d225d02b1659430804486404db507";
const HOOK_FACTORY = "0xae3c324b742a7576863a546120c4280b7c9e8448";
const FEE_HOOK = "0x48bb2672c7fd2a12e7fb5d46c441ccd3726520cc";
const MEME_LAUNCHER = "0x51d702731db281ee223904a4663e05bfca26c775";
const POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90";
const POSITION_MANAGER = "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e";
const TOKEN_FACTORY = "0x000000e200088d55c39a11f609e5f667729ad49b";
const LAUNCHER_TREASURY =
  "0x4957f49620aff3adbbe8195a4f633e49cc93376c";

function addressWord(address) {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

const EXPECTED_TRANSACTIONS = [
  {
    name: "LockedPositionFeeForwarderFactoryV1",
    label: "Locked position forwarder factory",
    transactionType: "CREATE",
    entryContractName: "LockedPositionFeeForwarderFactoryV1",
    entryContractAddress: POSITION_FORWARDER_FACTORY,
    deployedAddress: POSITION_FORWARDER_FACTORY,
    to: null,
    nonce: "0x0",
    inputHash:
      "0x89cb54539d29d133369969d5e7de786a0b53d74de739fe3681c5f73432ce2487",
    runtimeCodeHash:
      "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2",
    checks: [
      {
        label: "PositionManager",
        target: POSITION_FORWARDER_FACTORY,
        data: "0x791b98bc",
        expected: addressWord(POSITION_MANAGER),
      },
    ],
  },
  {
    name: "EthCreatorFeeHookFactoryV1",
    label: "Creator fee hook factory",
    transactionType: "CREATE",
    entryContractName: "EthCreatorFeeHookFactoryV1",
    entryContractAddress: HOOK_FACTORY,
    deployedAddress: HOOK_FACTORY,
    to: null,
    nonce: "0x1",
    inputHash:
      "0xd6973bf2aae7f3461d6d627b893bedb93cc1df601f5a3f8246d0ff0067ea3762",
    runtimeCodeHash:
      "0x3014de1f275dc60ae289f7a3a8ab038fdf76929aff19e0efdb19138e4ce8e0d5",
    checks: [],
  },
  {
    name: "EthCreatorFeeHookV1",
    label: "Shared ETH fee hook",
    transactionType: "CALL",
    entryContractName: "EthCreatorFeeHookFactoryV1",
    entryContractAddress: HOOK_FACTORY,
    function: "deploy(bytes32,address,address)",
    deployedAddress: FEE_HOOK,
    to: HOOK_FACTORY,
    nonce: "0x2",
    inputHash:
      "0xf71e1f979b4204d99acaec66b974350eb04c695f29257c4a757a9bad59960797",
    runtimeCodeHash:
      "0x60fd96af952730792036d43d806046675817a5a2de609d87c06203a8d6037650",
    create2: {
      transactionType: "CREATE2",
      contractName: "EthCreatorFeeHookV1",
      address: FEE_HOOK,
    },
    checks: [
      {
        label: "PoolManager",
        target: FEE_HOOK,
        data: "0xdc4c90d3",
        expected: addressWord(POOL_MANAGER),
      },
      {
        label: "Launcher treasury",
        target: FEE_HOOK,
        data: "0x4c50e2c4",
        expected: addressWord(LAUNCHER_TREASURY),
      },
      {
        label: "Factory provenance",
        target: HOOK_FACTORY,
        data:
          "0xb6eda14f00000000000000000000000048bb2672c7fd2a12e7fb5d46c441ccd3726520cc",
        expected:
          "0x7d8fe035023b4364925ee0785b8e05698bc716939bb78a6045a1b9e89f0156a6",
      },
    ],
  },
  {
    name: "MemeLaunchV1",
    label: "Meme token launcher",
    transactionType: "CREATE",
    entryContractName: "MemeLaunchV1",
    entryContractAddress: MEME_LAUNCHER,
    deployedAddress: MEME_LAUNCHER,
    to: null,
    nonce: "0x3",
    inputHash:
      "0x5cd8feacfaed787484100d58668d904cfbf2016a46402d9dc155d37d180f68cd",
    runtimeCodeHash:
      "0xa459ee6574d8bbd40ddcf9737dc5d1063adb3abbc11d9f367350c7f2a3cf738b",
    checks: [
      {
        label: "PoolManager",
        target: MEME_LAUNCHER,
        data: "0xdc4c90d3",
        expected: addressWord(POOL_MANAGER),
      },
      {
        label: "PositionManager",
        target: MEME_LAUNCHER,
        data: "0x791b98bc",
        expected: addressWord(POSITION_MANAGER),
      },
      {
        label: "UERC20Factory",
        target: MEME_LAUNCHER,
        data: "0xe77772fe",
        expected: addressWord(TOKEN_FACTORY),
      },
      {
        label: "Fee hook",
        target: MEME_LAUNCHER,
        data: "0xf11f4461",
        expected: addressWord(FEE_HOOK),
      },
      {
        label: "Position forwarder factory",
        target: MEME_LAUNCHER,
        data: "0x2e482c45",
        expected: addressWord(POSITION_FORWARDER_FACTORY),
      },
      {
        label: "Minimum Dev Buy",
        target: MEME_LAUNCHER,
        data: "0x367e97f9",
        expected:
          "0x000000000000000000000000000000000000000000000000000221b262dd8000",
      },
    ],
  },
];

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const dryRunPath = path.join(
  repositoryRoot,
  "contracts",
  "broadcast",
  "DeployMainnetMemeInfrastructureV1.s.sol",
  "1",
  "dry-run",
  "run-latest.json",
);

function normalizeHex(value) {
  return String(value ?? "").toLowerCase();
}

function validateBroadcast(broadcast) {
  if (!Array.isArray(broadcast.transactions)) {
    throw new Error("The Foundry dry run does not contain transactions");
  }
  if (broadcast.transactions.length !== EXPECTED_TRANSACTIONS.length) {
    throw new Error(
      `Expected ${EXPECTED_TRANSACTIONS.length} deployment transactions, found ${broadcast.transactions.length}`,
    );
  }

  return broadcast.transactions.map((entry, index) => {
    const expected = EXPECTED_TRANSACTIONS[index];
    const transaction = entry.transaction ?? {};

    if (entry.transactionType !== expected.transactionType) {
      throw new Error(
        `${expected.name} must be a ${expected.transactionType} transaction`,
      );
    }
    if (entry.contractName !== expected.entryContractName) {
      throw new Error(
        `Expected ${expected.entryContractName} at transaction ${index}, found ${entry.contractName}`,
      );
    }
    if (
      normalizeHex(entry.contractAddress) !==
      expected.entryContractAddress
    ) {
      throw new Error(`${expected.name} has an unexpected contract target`);
    }
    if (normalizeHex(transaction.from) !== EXPECTED_ACCOUNT) {
      throw new Error(`${expected.name} has an unexpected sender`);
    }
    if (normalizeHex(transaction.chainId) !== EXPECTED_CHAIN_ID) {
      throw new Error(`${expected.name} has an unexpected chain`);
    }
    if (normalizeHex(transaction.nonce) !== expected.nonce) {
      throw new Error(`${expected.name} has an unexpected nonce`);
    }
    if (normalizeHex(transaction.value) !== "0x0") {
      throw new Error(`${expected.name} unexpectedly transfers value`);
    }

    const actualTo = transaction.to
      ? normalizeHex(transaction.to)
      : null;
    if (actualTo !== expected.to) {
      throw new Error(`${expected.name} has an unexpected transaction target`);
    }
    if (
      typeof transaction.input !== "string" ||
      !/^0x[0-9a-f]+$/i.test(transaction.input)
    ) {
      throw new Error(`${expected.name} has invalid transaction data`);
    }
    if (keccak256(transaction.input) !== expected.inputHash) {
      throw new Error(
        `${expected.name} transaction data does not match the reviewed build`,
      );
    }

    if (expected.function && entry.function !== expected.function) {
      throw new Error(`${expected.name} has an unexpected function call`);
    }
    if (expected.create2) {
      if (
        !Array.isArray(entry.additionalContracts) ||
        entry.additionalContracts.length !== 1
      ) {
        throw new Error(`${expected.name} must create exactly one hook`);
      }
      const created = entry.additionalContracts[0];
      if (
        created.transactionType !== expected.create2.transactionType ||
        created.contractName !== expected.create2.contractName ||
        normalizeHex(created.address) !== expected.create2.address
      ) {
        throw new Error(`${expected.name} CREATE2 deployment drifted`);
      }
    } else if (
      Array.isArray(entry.additionalContracts) &&
      entry.additionalContracts.length !== 0
    ) {
      throw new Error(`${expected.name} creates unexpected extra contracts`);
    }

    if (
      typeof transaction.gas !== "string" ||
      !/^0x[0-9a-f]+$/i.test(transaction.gas) ||
      BigInt(transaction.gas) === 0n
    ) {
      throw new Error(`${expected.name} has an invalid Foundry gas limit`);
    }

    return {
      name: expected.name,
      label: expected.label,
      address: expected.deployedAddress,
      from: EXPECTED_ACCOUNT,
      chainId: EXPECTED_CHAIN_ID,
      nonce: expected.nonce,
      to: expected.to,
      transactionType: expected.transactionType,
      value: "0x0",
      foundryGasLimit: transaction.gas,
      data: transaction.input,
      inputHash: expected.inputHash,
      runtimeCodeHash: expected.runtimeCodeHash,
      checks: expected.checks,
    };
  });
}

function renderHtml(transactions) {
  const serialized = JSON.stringify({
    expectedAccount: EXPECTED_ACCOUNT,
    expectedChainId: EXPECTED_CHAIN_ID,
    expectedStartNonce: EXPECTED_START_NONCE,
    transactions,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Programmable Mainnet deployment</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #fbfafb;
        color: #1d191d;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 14% 2%, rgba(248, 197, 226, .42), transparent 31rem),
          radial-gradient(circle at 92% 12%, rgba(239, 219, 255, .46), transparent 34rem),
          #fbfafb;
      }
      button, a { -webkit-tap-highlight-color: transparent; }
      button:focus-visible, a:focus-visible { outline: 3px solid rgba(224, 103, 165, .34); outline-offset: 3px; }
      main { width: min(900px, calc(100% - 32px)); margin: 0 auto; padding: 52px 0 64px; }
      .brand { align-items: center; display: flex; gap: 10px; margin: 0 0 38px; }
      .mark { align-items: center; background: #f4c0dc; border-radius: 10px; color: #7e2d59; display: flex; font-size: 18px; font-weight: 750; height: 34px; justify-content: center; letter-spacing: -.08em; width: 34px; }
      .brand-name { font-size: 15px; font-weight: 690; letter-spacing: -.02em; }
      .eyebrow { color: #aa4d7d; font-size: 11px; font-weight: 720; letter-spacing: .11em; margin: 0; text-transform: uppercase; }
      h1 { font-size: clamp(36px, 6vw, 58px); font-weight: 590; letter-spacing: -.055em; line-height: 1; margin: 13px 0 15px; }
      .intro { color: #6f676d; font-size: 16px; line-height: 1.6; margin: 0; max-width: 700px; }
      .panel { background: rgba(255, 255, 255, .86); border: 1px solid #e7dfe4; border-radius: 24px; box-shadow: 0 22px 60px rgba(72, 46, 62, .08); margin-top: 30px; overflow: hidden; }
      .summary { display: grid; grid-template-columns: repeat(3, 1fr); margin: 0; border-bottom: 1px solid #ece5e9; }
      .summary div { min-height: 104px; padding: 21px; }
      .summary div + div { border-left: 1px solid #ece5e9; }
      dt { color: #91878e; font-size: 10px; font-weight: 680; letter-spacing: .09em; text-transform: uppercase; }
      dd { font-size: 14px; font-weight: 640; margin: 8px 0 0; overflow-wrap: anywhere; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; padding: 20px; }
      button { border: 0; border-radius: 13px; cursor: pointer; font: inherit; font-size: 14px; font-weight: 670; min-height: 46px; padding: 0 18px; }
      button.primary { background: #eaa6ca; color: #341423; }
      button.secondary { background: #f7f2f5; color: #3b3439; border: 1px solid #e4dade; }
      button:hover:not(:disabled) { filter: brightness(.985); transform: translateY(-1px); }
      button:active:not(:disabled) { transform: translateY(0); }
      button:disabled { cursor: not-allowed; opacity: .48; }
      .notice { border-top: 1px solid #ece5e9; color: #6f676d; font-size: 13px; line-height: 1.55; margin: 0; min-height: 57px; padding: 18px 20px; }
      .notice.error { color: #a33e4c; }
      .notice.success { color: #23704e; }
      ol { list-style: none; margin: 0; padding: 0; }
      li { align-items: center; display: grid; gap: 14px; grid-template-columns: 34px minmax(0, 1fr) auto; min-height: 92px; padding: 17px 20px; }
      li + li { border-top: 1px solid #ece5e9; }
      .index { align-items: center; border: 1px solid #d9cfd5; border-radius: 50%; color: #857b82; display: flex; font-size: 12px; font-weight: 680; height: 30px; justify-content: center; width: 30px; }
      li.done .index { background: #e6f5ed; border-color: #b8dec9; color: #28704e; }
      li.failed .index { background: #fae9eb; border-color: #e8bdc2; color: #a33e4c; }
      .contract strong { display: block; font-size: 14px; letter-spacing: -.01em; }
      .contract small { color: #91878e; display: block; font-size: 11px; margin-top: 3px; }
      .contract code { color: #8f858b; display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; margin-top: 6px; overflow-wrap: anywhere; }
      .status { color: #857b82; font-size: 11px; text-align: right; }
      .hash { color: #a94d7d; text-decoration: none; }
      .warning { color: #756b71; font-size: 12px; line-height: 1.55; margin: 18px 2px 0; max-width: 710px; }
      @media (prefers-reduced-motion: no-preference) {
        button { transition: filter 140ms ease, transform 140ms ease; }
      }
      @media (max-width: 660px) {
        main { padding-top: 28px; }
        .brand { margin-bottom: 30px; }
        .summary { grid-template-columns: 1fr; }
        .summary div { min-height: 80px; }
        .summary div + div { border-left: 0; border-top: 1px solid #ece5e9; }
        li { grid-template-columns: 30px minmax(0, 1fr); }
        .status { grid-column: 2; text-align: left; }
        .actions button { width: 100%; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">
        <span class="mark" aria-hidden="true">P</span>
        <span class="brand-name">Programmable</span>
      </div>
      <p class="eyebrow">Ethereum Mainnet</p>
      <h1>Deploy Classic V1</h1>
      <p class="intro">
        Four reviewed transactions deploy the locked-position factory, fee-hook factory, shared ETH fee hook and token launcher.
        Every call is fixed to Ethereum Mainnet, the configured deployment wallet and zero ETH value.
      </p>

      <section class="panel" aria-labelledby="deployment-status">
        <h2 id="deployment-status" hidden>Deployment status</h2>
        <dl class="summary">
          <div><dt>Network</dt><dd id="network">Not connected</dd></div>
          <div><dt>Account</dt><dd id="account">Not connected</dd></div>
          <div><dt>Balance</dt><dd id="balance">Not connected</dd></div>
        </dl>
        <div class="actions">
          <button class="primary" id="connect">Connect MetaMask</button>
          <button class="secondary" id="switch-network">Switch to Mainnet</button>
          <button class="secondary" id="deploy" disabled>Deploy next contract</button>
          <button class="secondary" id="refresh" disabled>Refresh state</button>
        </div>
        <p class="notice" id="notice" role="status" aria-live="polite">
          Connect the configured Mainnet deployment wallet to begin.
        </p>
        <ol id="transactions"></ol>
      </section>

      <p class="warning">
        MetaMask shows one confirmation per transaction. Approve only Ethereum Mainnet calls from the displayed wallet
        with zero ETH value. The panel stops on any nonce, bytecode, address or dependency mismatch.
      </p>
    </main>
    <script id="deployment-data" type="application/json">${serialized}</script>
    <script>
      const configuration = JSON.parse(document.getElementById("deployment-data").textContent);
      const networkElement = document.getElementById("network");
      const accountElement = document.getElementById("account");
      const balanceElement = document.getElementById("balance");
      const noticeElement = document.getElementById("notice");
      const connectButton = document.getElementById("connect");
      const switchNetworkButton = document.getElementById("switch-network");
      const deployButton = document.getElementById("deploy");
      const refreshButton = document.getElementById("refresh");
      const transactionList = document.getElementById("transactions");

      let provider;
      let account;
      let state = [];
      let busy = false;
      let readyIndex = null;

      function shortAddress(value) {
        return value ? value.slice(0, 8) + "…" + value.slice(-6) : "Not connected";
      }

      function formatEther(hexValue) {
        const wei = BigInt(hexValue);
        const whole = wei / 10n ** 18n;
        const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
        return whole + "." + fraction + " ETH";
      }

      function setNotice(message, type = "") {
        noticeElement.textContent = message;
        noticeElement.className = "notice" + (type ? " " + type : "");
      }

      function updateButtons() {
        deployButton.disabled = busy || readyIndex === null;
        refreshButton.disabled = busy || !account;
        connectButton.disabled = busy || Boolean(account);
        switchNetworkButton.disabled = busy;
      }

      function getMetaMaskProvider() {
        const injected = window.ethereum;
        if (!injected) return null;
        if (Array.isArray(injected.providers)) {
          return injected.providers.find((candidate) => candidate.isMetaMask) ?? null;
        }
        return injected.isMetaMask ? injected : null;
      }

      async function request(method, params = []) {
        return provider.request({ method, params });
      }

      async function readMainnetState() {
        const response = await fetch("/mainnet-state", {
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "The independent Mainnet state check failed");
        }
        return result;
      }

      async function hashRuntimeCode(code) {
        const response = await fetch("/keccak256", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hex: code }),
        });
        if (!response.ok) {
          throw new Error("The local runtime-code hash check failed");
        }
        const result = await response.json();
        return String(result.hash ?? "").toLowerCase();
      }

      async function verifyDeployment(transaction) {
        const code = await request("eth_getCode", [transaction.address, "latest"]);
        if (code === "0x") return false;

        const codeHash = await hashRuntimeCode(code);
        if (codeHash !== transaction.runtimeCodeHash) {
          throw new Error(transaction.name + " runtime bytecode does not match the reviewed build");
        }

        for (const check of transaction.checks) {
          const actual = String(
            await request("eth_call", [{ to: check.target, data: check.data }, "latest"]),
          ).toLowerCase();
          if (actual !== check.expected) {
            throw new Error(transaction.name + " failed its " + check.label + " check");
          }
        }
        return true;
      }

      function renderTransactions() {
        transactionList.innerHTML = "";
        configuration.transactions.forEach((transaction, index) => {
          const itemState = state[index] ?? { status: "Waiting" };
          const item = document.createElement("li");
          if (itemState.done) item.className = "done";
          if (itemState.failed) item.className = "failed";

          const marker = document.createElement("span");
          marker.className = "index";
          marker.textContent = itemState.done ? "✓" : String(index + 1);

          const contract = document.createElement("span");
          contract.className = "contract";
          const name = document.createElement("strong");
          name.textContent = transaction.label;
          const technicalName = document.createElement("small");
          technicalName.textContent = transaction.name;
          const address = document.createElement("code");
          address.textContent = transaction.address;
          contract.append(name, technicalName, address);

          const status = document.createElement("span");
          status.className = "status";
          if (itemState.hash) {
            const link = document.createElement("a");
            link.className = "hash";
            link.href = "https://etherscan.io/tx/" + itemState.hash;
            link.target = "_blank";
            link.rel = "noreferrer";
            link.textContent = itemState.status;
            status.append(link);
          } else {
            status.textContent = itemState.status;
          }

          item.append(marker, contract, status);
          transactionList.append(item);
        });
      }

      async function ensureMainnet() {
        let chainId = (await request("eth_chainId")).toLowerCase();
        if (chainId !== configuration.expectedChainId) {
          try {
            await request("wallet_switchEthereumChain", [
              { chainId: configuration.expectedChainId },
            ]);
          } catch (error) {
            throw error;
          }
          chainId = (await request("eth_chainId")).toLowerCase();
        }
        if (chainId !== configuration.expectedChainId) {
          throw new Error("MetaMask is not connected to Ethereum Mainnet");
        }
        networkElement.textContent = "Ethereum · 1";
      }

      async function assertAccount() {
        const accounts = await request("eth_accounts");
        const selected = String(accounts[0] ?? "").toLowerCase();
        if (selected !== configuration.expectedAccount) {
          throw new Error(
            "Select the configured deployment wallet " + configuration.expectedAccount,
          );
        }
        account = selected;
        accountElement.textContent = shortAddress(account);
      }

      async function refreshState() {
        if (!provider || !account) return;
        await ensureMainnet();
        await assertAccount();

        const {
          balance,
          confirmedNonce: confirmedNonceHex,
          pendingNonce: pendingNonceHex,
        } = await readMainnetState();
        balanceElement.textContent = formatEther(balance);

        const confirmedNonce = Number(BigInt(confirmedNonceHex));
        const pendingNonce = Number(BigInt(pendingNonceHex));
        const startNonce = configuration.expectedStartNonce;
        const endNonce = startNonce + configuration.transactions.length;
        if (confirmedNonce < startNonce || confirmedNonce > endNonce) {
          throw new Error("The confirmed wallet nonce is outside the reviewed deployment sequence");
        }
        if (pendingNonce < confirmedNonce || pendingNonce > endNonce) {
          throw new Error("The pending wallet nonce is outside the reviewed deployment sequence");
        }

        const confirmedIndex = confirmedNonce - startNonce;
        const pendingIndex = pendingNonce - startNonce;
        state = [];
        readyIndex = null;

        for (let index = 0; index < configuration.transactions.length; index += 1) {
          const transaction = configuration.transactions[index];
          let hasExpectedDeployment = false;
          try {
            hasExpectedDeployment = await verifyDeployment(transaction);
          } catch (error) {
            state[index] = { failed: true, status: "Verification failed" };
            renderTransactions();
            throw error;
          }

          if (index < confirmedIndex) {
            if (!hasExpectedDeployment) {
              state[index] = {
                failed: true,
                status: "Nonce confirmed without expected code",
              };
            } else {
              state[index] = { done: true, status: "Verified" };
            }
            continue;
          }

          if (hasExpectedDeployment) {
            state[index] = {
              failed: true,
              status: "Code exists before expected nonce",
            };
            continue;
          }
          if (index < pendingIndex) {
            state[index] = { status: "Pending in wallet" };
            continue;
          }
          if (index === confirmedIndex && pendingIndex === confirmedIndex) {
            state[index] = { status: "Ready" };
            readyIndex = index;
            continue;
          }
          state[index] = { status: "Waiting" };
        }

        renderTransactions();
        const hasFailed = state.some((entry) => entry.failed);
        const complete = confirmedNonce === endNonce && state.every((entry) => entry.done);

        if (hasFailed) {
          readyIndex = null;
          throw new Error("Deployment state does not match the reviewed transaction sequence");
        }
        if (complete) {
          readyIndex = null;
          deployButton.textContent = "Deployment complete";
          setNotice(
            "All four contracts are deployed with the expected runtime bytecode and dependencies.",
            "success",
          );
          updateButtons();
          return;
        }
        if (pendingNonce !== confirmedNonce) {
          readyIndex = null;
          deployButton.textContent = "Waiting for confirmation";
          setNotice("A deployment transaction is pending. Wait for its receipt before continuing.");
          updateButtons();
          return;
        }
        if (readyIndex === null) {
          throw new Error("No reviewed deployment transaction is ready");
        }

        const next = configuration.transactions[readyIndex];
        deployButton.textContent = "Deploy " + next.label;
        setNotice(next.label + " is ready for simulation and MetaMask review.");
        updateButtons();
      }

      async function connect() {
        if (busy) return;
        busy = true;
        updateButtons();
        setNotice("Waiting for MetaMask.");
        try {
          provider = getMetaMaskProvider();
          if (!provider) throw new Error("MetaMask is not available in this browser");
          const connectedAccounts = await request("eth_accounts");
          if (!connectedAccounts.length) {
            await request("eth_requestAccounts");
          }
          await ensureMainnet();
          await assertAccount();
          await refreshState();
          connectButton.textContent = "Connected";
        } catch (error) {
          account = undefined;
          readyIndex = null;
          connectButton.textContent = "Connect MetaMask";
          setNotice(error?.message ?? String(error), "error");
        } finally {
          busy = false;
          updateButtons();
        }
      }

      async function switchToMainnet() {
        if (busy) return;
        busy = true;
        updateButtons();
        setNotice("Open MetaMask and approve the switch to Ethereum Mainnet.");

        try {
          provider = getMetaMaskProvider();
          if (!provider) throw new Error("MetaMask is not available in this browser");
          await ensureMainnet();

          const accounts = await request("eth_accounts");
          if (!accounts.length) {
            setNotice("Ethereum Mainnet is selected. Connect MetaMask to continue.", "success");
            return;
          }

          await assertAccount();
          await refreshState();
          connectButton.textContent = "Connected";
        } catch (error) {
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

      async function deployNext() {
        if (busy || readyIndex === null) return;
        busy = true;
        updateButtons();
        let failureMessage;

        try {
          await ensureMainnet();
          await assertAccount();
          const {
            confirmedNonce: confirmedNonceHex,
            pendingNonce: pendingNonceHex,
          } = await readMainnetState();
          if (confirmedNonceHex !== pendingNonceHex) {
            throw new Error("A transaction is currently pending on Ethereum Mainnet");
          }

          const nextNonce = Number(BigInt(confirmedNonceHex));
          const expectedIndex = nextNonce - configuration.expectedStartNonce;
          if (expectedIndex !== readyIndex) {
            throw new Error("The wallet nonce changed. Refresh before continuing");
          }
          const transaction = configuration.transactions[readyIndex];
          if (!transaction || normalizeNonce(transaction.nonce) !== nextNonce) {
            throw new Error("No reviewed deployment is expected at this nonce");
          }
          if (await verifyDeployment(transaction)) {
            throw new Error(transaction.name + " is already deployed");
          }

          setNotice("Simulating " + transaction.label + " before opening MetaMask.");
          const transactionRequest = {
            from: account,
            data: transaction.data,
            value: transaction.value,
            nonce: transaction.nonce,
          };
          if (transaction.to) transactionRequest.to = transaction.to;

          const [estimatedGasHex, networkState, gasPriceHex] = await Promise.all([
            request("eth_estimateGas", [transactionRequest]),
            readMainnetState(),
            request("eth_gasPrice"),
          ]);
          const estimatedGas = BigInt(estimatedGasHex);
          const foundryGasLimit = BigInt(transaction.foundryGasLimit);
          const paddedEstimate = (estimatedGas * 120n + 99n) / 100n;
          const gasLimit =
            foundryGasLimit > paddedEstimate ? foundryGasLimit : paddedEstimate;
          const transactionGasPrice =
            (BigInt(gasPriceHex) * 125n + 99n) / 100n;
          const conservativeCost = gasLimit * transactionGasPrice;
          if (BigInt(networkState.balance) < conservativeCost) {
            throw new Error(
              "The wallet balance is below the conservative gas ceiling for this transaction",
            );
          }

          setNotice("Review " + transaction.label + " in MetaMask. The ETH value must be zero.");
          const hash = await request("eth_sendTransaction", [
            {
              ...transactionRequest,
              gas: "0x" + gasLimit.toString(16),
              gasPrice: "0x" + transactionGasPrice.toString(16),
            },
          ]);

          state[readyIndex] = { status: "Pending", hash };
          readyIndex = null;
          renderTransactions();
          setNotice("Waiting for " + transaction.label + " to confirm.");
          const receipt = await waitForReceipt(hash);
          if (receipt.status !== "0x1") {
            throw new Error(transaction.name + " reverted. Do not continue");
          }
          if (String(receipt.from ?? "").toLowerCase() !== account) {
            throw new Error(transaction.name + " receipt has an unexpected sender");
          }
          const receiptTo = receipt.to ? String(receipt.to).toLowerCase() : null;
          if (receiptTo !== transaction.to) {
            throw new Error(transaction.name + " receipt has an unexpected target");
          }
          const receiptContract = receipt.contractAddress
            ? String(receipt.contractAddress).toLowerCase()
            : null;
          const expectedReceiptContract =
            transaction.transactionType === "CREATE" ? transaction.address : null;
          if (receiptContract !== expectedReceiptContract) {
            throw new Error(transaction.name + " deployed to an unexpected address");
          }
          if (!(await verifyDeployment(transaction))) {
            throw new Error(transaction.name + " has no runtime bytecode");
          }

          state[expectedIndex] = { done: true, status: "Verified", hash };
          renderTransactions();
          setNotice(transaction.label + " confirmed and verified.", "success");
        } catch (error) {
          failureMessage = error?.message ?? String(error);
          setNotice(failureMessage, "error");
        } finally {
          busy = false;
          if (account) {
            await refreshState().catch((error) => {
              if (!failureMessage) failureMessage = error?.message ?? String(error);
            });
          }
          if (failureMessage) setNotice(failureMessage, "error");
          updateButtons();
        }
      }

      function normalizeNonce(value) {
        return Number(BigInt(value));
      }

      connectButton.addEventListener("click", connect);
      switchNetworkButton.addEventListener("click", switchToMainnet);
      deployButton.addEventListener("click", deployNext);
      refreshButton.addEventListener("click", () => {
        refreshState().catch((error) => {
          setNotice(error?.message ?? String(error), "error");
        });
      });
      renderTransactions();
    </script>
  </body>
</html>`;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_HASH_REQUEST_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertRpcHex(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`Invalid ${label} from Mainnet RPC`);
  }
  return value.toLowerCase();
}

async function readMainnetRpcState(endpoint) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionCount",
        params: [EXPECTED_ACCOUNT, "latest"],
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "eth_getTransactionCount",
        params: [EXPECTED_ACCOUNT, "pending"],
      },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "eth_getBalance",
        params: [EXPECTED_ACCOUNT, "latest"],
      },
    ]),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Mainnet RPC returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Mainnet RPC returned an invalid batch");
  }
  const results = new Map(payload.map((entry) => [entry.id, entry]));
  for (const id of [1, 2, 3]) {
    if (results.get(id)?.error) {
      throw new Error(`Mainnet RPC request ${id} failed`);
    }
  }

  return {
    confirmedNonce: assertRpcHex(results.get(1)?.result, "confirmed nonce"),
    pendingNonce: assertRpcHex(results.get(2)?.result, "pending nonce"),
    balance: assertRpcHex(results.get(3)?.result, "balance"),
  };
}

async function readVerifiedMainnetState() {
  const states = await Promise.all(
    MAINNET_RPC_ENDPOINTS.map((endpoint) => readMainnetRpcState(endpoint)),
  );
  const [reference, ...others] = states;
  if (
    others.some(
      (state) =>
        state.confirmedNonce !== reference.confirmedNonce ||
        state.pendingNonce !== reference.pendingNonce ||
        state.balance !== reference.balance,
    )
  ) {
    throw new Error("Independent Mainnet RPCs disagree");
  }
  return reference;
}

async function main() {
  const broadcast = JSON.parse(await readFile(dryRunPath, "utf8"));
  const transactions = validateBroadcast(broadcast);
  const html = renderHtml(transactions);

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

    if (request.method === "POST" && request.url === "/keccak256") {
      try {
        const body = await readJsonBody(request);
        if (
          typeof body.hex !== "string" ||
          !/^0x[0-9a-f]*$/i.test(body.hex) ||
          body.hex.length % 2 !== 0
        ) {
          throw new Error("Invalid hex value");
        }
        response.writeHead(200, {
          ...headers,
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ hash: keccak256(body.hex) }));
      } catch (error) {
        response.writeHead(400, {
          ...headers,
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: error?.message ?? String(error) }));
      }
      return;
    }

    if (request.method === "GET" && request.url === "/mainnet-state") {
      try {
        const state = await readVerifiedMainnetState();
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

    response.writeHead(404, {
      ...headers,
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
  });

  server.listen(PORT, HOST, () => {
    console.log(`Programmable Mainnet deployer: http://${HOST}:${PORT}`);
    console.log(
      `Loaded ${transactions.length} reviewed transactions from ${dryRunPath}`,
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
