import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.LAUNCHER_DEPLOYER_PORT ?? 4173);
const EXPECTED_ACCOUNT =
  "0x2bb333d48dfaf1596d9036671d2e43168994249e";
const EXPECTED_CHAIN_ID = "0xaa36a7";

const EXPECTED_CONTRACTS = [
  {
    name: "PlatformFeeHookFactoryV1",
    address: "0x291a9ff1059d225d02b1659430804486404db507",
    nonce: "0x0",
  },
  {
    name: "LockedPositionFeeForwarderFactoryV1",
    address: "0xae3c324b742a7576863a546120c4280b7c9e8448",
    nonce: "0x1",
  },
  {
    name: "DirectLiquidityLauncherV1",
    address: "0x5fc6add062329742efefa9c4b11c355aae02fa1e",
    nonce: "0x2",
  },
  {
    name: "BoundedDynamicFeeHookFactoryV1",
    address: "0x51d702731db281ee223904a4663e05bfca26c775",
    nonce: "0x3",
  },
];

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const dryRunPath = path.join(
  repositoryRoot,
  "contracts",
  "broadcast",
  "DeploySepoliaInfrastructureV1.s.sol",
  "11155111",
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
  if (broadcast.transactions.length !== EXPECTED_CONTRACTS.length) {
    throw new Error(
      `Expected ${EXPECTED_CONTRACTS.length} deployment transactions, found ${broadcast.transactions.length}`,
    );
  }

  return broadcast.transactions.map((entry, index) => {
    const expected = EXPECTED_CONTRACTS[index];
    const transaction = entry.transaction ?? {};

    if (entry.transactionType !== "CREATE") {
      throw new Error(`${expected.name} is not a CREATE transaction`);
    }
    if (entry.contractName !== expected.name) {
      throw new Error(
        `Expected ${expected.name} at transaction ${index}, found ${entry.contractName}`,
      );
    }
    if (normalizeHex(entry.contractAddress) !== expected.address) {
      throw new Error(
        `${expected.name} address drifted from ${expected.address}`,
      );
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
    if (
      typeof transaction.input !== "string" ||
      !transaction.input.startsWith("0x") ||
      transaction.input.length < 4
    ) {
      throw new Error(`${expected.name} has no creation bytecode`);
    }

    return {
      name: expected.name,
      address: expected.address,
      from: EXPECTED_ACCOUNT,
      chainId: EXPECTED_CHAIN_ID,
      nonce: expected.nonce,
      value: "0x0",
      foundryGasLimit: transaction.gas,
      data: transaction.input,
    };
  });
}

function renderHtml(transactions) {
  const serialized = JSON.stringify({
    expectedAccount: EXPECTED_ACCOUNT,
    expectedChainId: EXPECTED_CHAIN_ID,
    transactions,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>Launcher Sepolia deployment</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0d0d0f;
        color: #f5f2f4;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: #0d0d0f; }
      main { width: min(920px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 72px; }
      .eyebrow { color: #d84f9c; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
      h1 { font-size: clamp(36px, 6vw, 58px); font-weight: 560; letter-spacing: -.055em; line-height: .98; margin: 14px 0 14px; }
      .intro { color: #aaa3a8; font-size: 16px; line-height: 1.55; max-width: 680px; }
      .panel { background: #171719; border: 1px solid #302c30; border-radius: 22px; margin-top: 28px; overflow: hidden; }
      .summary { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid #302c30; }
      .summary div { min-height: 104px; padding: 20px; }
      .summary div + div { border-left: 1px solid #302c30; }
      dt { color: #766f74; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
      dd { font-size: 14px; font-weight: 620; margin: 8px 0 0; overflow-wrap: anywhere; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; padding: 20px; }
      button { border: 0; border-radius: 13px; cursor: pointer; font: inherit; font-size: 14px; font-weight: 650; min-height: 46px; padding: 0 18px; }
      button.primary { background: #ee5daa; color: #1b0712; }
      button.secondary { background: #282529; color: #f5f2f4; border: 1px solid #3b373b; }
      button:disabled { cursor: not-allowed; opacity: .42; }
      .notice { border-top: 1px solid #302c30; color: #aaa3a8; font-size: 13px; line-height: 1.5; margin: 0; min-height: 54px; padding: 17px 20px; }
      .notice.error { color: #ffadad; }
      .notice.success { color: #77d9ad; }
      ol { list-style: none; margin: 0; padding: 0; }
      li { align-items: center; display: grid; gap: 14px; grid-template-columns: 32px minmax(0, 1fr) auto; min-height: 86px; padding: 16px 20px; }
      li + li { border-top: 1px solid #302c30; }
      .index { align-items: center; border: 1px solid #484247; border-radius: 50%; color: #aaa3a8; display: flex; font-size: 12px; height: 28px; justify-content: center; width: 28px; }
      li.done .index { background: #183b2a; border-color: #296244; color: #8ee2b8; }
      li.failed .index { background: #482127; border-color: #7b343e; color: #ffadad; }
      .contract strong { display: block; font-size: 14px; }
      .contract span { color: #766f74; display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; margin-top: 5px; overflow-wrap: anywhere; }
      .status { color: #766f74; font-size: 11px; text-align: right; }
      .hash { color: #d84f9c; text-decoration: none; }
      .warning { color: #d7b375; font-size: 12px; line-height: 1.5; margin-top: 18px; }
      @media (max-width: 660px) {
        main { padding-top: 28px; }
        .summary { grid-template-columns: 1fr; }
        .summary div { min-height: 82px; }
        .summary div + div { border-left: 0; border-top: 1px solid #302c30; }
        li { grid-template-columns: 28px minmax(0, 1fr); }
        .status { grid-column: 2; text-align: left; }
        .actions button { width: 100%; }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Sepolia only</p>
      <h1>Deploy Launcher infrastructure</h1>
      <p class="intro">
        This local page submits the four creation transactions produced by the latest Foundry dry run.
        It rejects any other account, chain, nonce or pre-existing target.
      </p>

      <section class="panel">
        <dl class="summary">
          <div><dt>Network</dt><dd id="network">Not connected</dd></div>
          <div><dt>Account</dt><dd id="account">Not connected</dd></div>
          <div><dt>Balance</dt><dd id="balance">Not connected</dd></div>
        </dl>
        <div class="actions">
          <button class="primary" id="connect">Connect MetaMask</button>
          <button class="secondary" id="deploy" disabled>Deploy next contract</button>
          <button class="secondary" id="refresh" disabled>Refresh state</button>
        </div>
        <p class="notice" id="notice">Connect the configured Sepolia deployment wallet to begin.</p>
        <ol id="transactions"></ol>
      </section>

      <p class="warning">
        Each transaction requires a separate MetaMask confirmation. Do not approve a prompt that names
        another network, account or value transfer.
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
      const deployButton = document.getElementById("deploy");
      const refreshButton = document.getElementById("refresh");
      const transactionList = document.getElementById("transactions");

      let provider;
      let account;
      let state = [];
      let busy = false;

      function shortAddress(value) {
        return value ? value.slice(0, 8) + "…" + value.slice(-6) : "Not connected";
      }

      function formatEther(hexValue) {
        const wei = BigInt(hexValue);
        const whole = wei / 10n ** 18n;
        const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
        return whole + "." + fraction + " Sepolia ETH";
      }

      function setNotice(message, type = "") {
        noticeElement.textContent = message;
        noticeElement.className = "notice" + (type ? " " + type : "");
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

      function renderTransactions() {
        transactionList.innerHTML = "";
        configuration.transactions.forEach((transaction, index) => {
          const itemState = state[index] ?? { status: "Pending" };
          const item = document.createElement("li");
          if (itemState.done) item.className = "done";
          if (itemState.failed) item.className = "failed";

          const marker = document.createElement("span");
          marker.className = "index";
          marker.textContent = itemState.done ? "✓" : String(index + 1);

          const contract = document.createElement("span");
          contract.className = "contract";
          const name = document.createElement("strong");
          name.textContent = transaction.name;
          const address = document.createElement("span");
          address.textContent = transaction.address;
          contract.append(name, address);

          const status = document.createElement("span");
          status.className = "status";
          if (itemState.hash) {
            const link = document.createElement("a");
            link.className = "hash";
            link.href = "https://sepolia.etherscan.io/tx/" + itemState.hash;
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

      async function ensureSepolia() {
        let chainId = (await request("eth_chainId")).toLowerCase();
        if (chainId !== configuration.expectedChainId) {
          try {
            await request("wallet_switchEthereumChain", [
              { chainId: configuration.expectedChainId },
            ]);
          } catch (error) {
            if (error?.code !== 4902) throw error;
            await request("wallet_addEthereumChain", [
              {
                chainId: configuration.expectedChainId,
                chainName: "Sepolia",
                nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
                blockExplorerUrls: ["https://sepolia.etherscan.io"],
              },
            ]);
          }
          chainId = (await request("eth_chainId")).toLowerCase();
        }
        if (chainId !== configuration.expectedChainId) {
          throw new Error("MetaMask is not connected to Sepolia");
        }
        networkElement.textContent = "Sepolia · 11155111";
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
        await ensureSepolia();
        await assertAccount();

        const [balance, pendingNonce] = await Promise.all([
          request("eth_getBalance", [account, "latest"]),
          request("eth_getTransactionCount", [account, "pending"]),
        ]);
        balanceElement.textContent = formatEther(balance);
        const nextNonce = Number(BigInt(pendingNonce));

        state = await Promise.all(
          configuration.transactions.map(async (transaction, index) => {
            const code = await request("eth_getCode", [transaction.address, "latest"]);
            const deployed = code !== "0x";
            if (deployed) {
              return { done: true, status: "Deployed" };
            }
            if (index < nextNonce) {
              return {
                failed: true,
                status: "Nonce used without expected code",
              };
            }
            return {
              status: index === nextNonce ? "Ready" : "Waiting",
            };
          }),
        );

        renderTransactions();
        const hasFailed = state.some((entry) => entry.failed);
        const complete = state.every((entry) => entry.done);
        const next = configuration.transactions[nextNonce];

        if (hasFailed) {
          deployButton.disabled = true;
          throw new Error(
            "A deployment nonce was used without the expected bytecode. Stop and inspect the receipt.",
          );
        }
        if (complete) {
          deployButton.disabled = true;
          setNotice("All four contracts are deployed at the expected addresses.", "success");
          return;
        }
        if (!next) {
          deployButton.disabled = true;
          throw new Error("The wallet nonce is outside the expected deployment sequence");
        }

        deployButton.disabled = busy;
        setNotice(next.name + " is ready for simulation and MetaMask review.");
      }

      async function connect() {
        if (busy) return;
        busy = true;
        connectButton.disabled = true;
        setNotice("Waiting for MetaMask.");
        try {
          provider = getMetaMaskProvider();
          if (!provider) throw new Error("MetaMask is not available in this browser");
          const accounts = await request("eth_requestAccounts");
          account = String(accounts[0] ?? "").toLowerCase();
          await ensureSepolia();
          await assertAccount();
          refreshButton.disabled = false;
          await refreshState();
          connectButton.textContent = "Connected";
        } catch (error) {
          account = undefined;
          deployButton.disabled = true;
          refreshButton.disabled = true;
          connectButton.disabled = false;
          setNotice(error?.message ?? String(error), "error");
        } finally {
          busy = false;
          if (account) {
            deployButton.disabled =
              state.every((entry) => entry.done) ||
              state.some((entry) => entry.failed);
          }
        }
      }

      async function waitForReceipt(hash) {
        for (;;) {
          const receipt = await request("eth_getTransactionReceipt", [hash]);
          if (receipt) return receipt;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      async function deployNext() {
        if (busy) return;
        busy = true;
        deployButton.disabled = true;
        refreshButton.disabled = true;
        let failureMessage;

        try {
          await ensureSepolia();
          await assertAccount();
          const pendingNonceHex = await request("eth_getTransactionCount", [
            account,
            "pending",
          ]);
          const nextNonce = Number(BigInt(pendingNonceHex));
          const transaction = configuration.transactions[nextNonce];
          if (!transaction) throw new Error("No deployment is expected at this nonce");

          const existingCode = await request("eth_getCode", [
            transaction.address,
            "latest",
          ]);
          if (existingCode !== "0x") {
            throw new Error(transaction.name + " is already deployed");
          }

          setNotice("Simulating " + transaction.name + " before opening MetaMask.");
          const estimatedGasHex = await request("eth_estimateGas", [
            {
              from: account,
              data: transaction.data,
              value: transaction.value,
            },
          ]);
          const estimatedGas = BigInt(estimatedGasHex);
          const foundryGasLimit = BigInt(transaction.foundryGasLimit);
          const paddedEstimate = (estimatedGas * 120n + 99n) / 100n;
          const gasLimit =
            foundryGasLimit > paddedEstimate ? foundryGasLimit : paddedEstimate;

          setNotice("Review " + transaction.name + " in MetaMask.");
          const hash = await request("eth_sendTransaction", [
            {
              from: account,
              data: transaction.data,
              value: transaction.value,
              nonce: transaction.nonce,
              gas: "0x" + gasLimit.toString(16),
            },
          ]);

          state[nextNonce] = { status: "Pending", hash };
          renderTransactions();
          setNotice("Waiting for " + transaction.name + " to confirm.");
          const receipt = await waitForReceipt(hash);
          if (receipt.status !== "0x1") {
            state[nextNonce] = { failed: true, status: "Reverted", hash };
            renderTransactions();
            throw new Error(transaction.name + " reverted. Do not continue.");
          }
          if (
            String(receipt.contractAddress ?? "").toLowerCase() !==
            transaction.address
          ) {
            state[nextNonce] = {
              failed: true,
              status: "Unexpected address",
              hash,
            };
            renderTransactions();
            throw new Error(transaction.name + " deployed to an unexpected address");
          }

          const runtimeCode = await request("eth_getCode", [
            transaction.address,
            "latest",
          ]);
          if (runtimeCode === "0x") {
            throw new Error(transaction.name + " has no runtime bytecode");
          }
          state[nextNonce] = { done: true, status: "Confirmed", hash };
          renderTransactions();
          setNotice(transaction.name + " confirmed at the expected address.", "success");
          await refreshState();
        } catch (error) {
          failureMessage = error?.message ?? String(error);
          setNotice(failureMessage, "error");
        } finally {
          busy = false;
          refreshButton.disabled = !account;
          if (account) await refreshState().catch((error) => {
            setNotice(error?.message ?? String(error), "error");
          });
          if (failureMessage) setNotice(failureMessage, "error");
        }
      }

      connectButton.addEventListener("click", connect);
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

async function main() {
  const broadcast = JSON.parse(await readFile(dryRunPath, "utf8"));
  const transactions = validateBroadcast(broadcast);
  const html = renderHtml(transactions);

  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
    response.end(html);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Launcher Sepolia MetaMask deployer: http://${HOST}:${PORT}`);
    console.log(`Loaded ${transactions.length} validated transactions from ${dryRunPath}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
