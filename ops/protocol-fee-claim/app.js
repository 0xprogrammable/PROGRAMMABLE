import {
  CLAIMS,
  MAINNET_CHAIN_ID,
  SELECTORS,
  TREASURY,
  decodeAddress,
  decodeUint256,
  claimData,
  formatEth,
  formatUnits,
  isTreasury,
  shortAddress,
  readAccruedData,
  toQuantityHex,
} from "./logic.mjs";

const state = {
  account: null,
  chainId: null,
  claims: new Map(),
  busy: false,
};

const elements = {
  action: document.querySelector("[data-action]"),
  actionDetail: document.querySelector("[data-action-detail]"),
  account: document.querySelector("[data-account]"),
  claimCount: document.querySelector("[data-claim-count]"),
  claimRows: document.querySelector("[data-claim-rows]"),
  error: document.querySelector("[data-error]"),
  network: document.querySelector("[data-network]"),
  refresh: document.querySelector("[data-refresh]"),
  status: document.querySelector("[data-status]"),
  total: document.querySelector("[data-total]"),
};

function provider() {
  if (!window.ethereum?.request) {
    throw new Error("Open this page in a browser with MetaMask installed");
  }

  return window.ethereum;
}

async function request(method, params = []) {
  return provider().request({ method, params });
}

function setError(message = "") {
  elements.error.textContent = message;
  elements.error.hidden = message.length === 0;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function statusLabel(claim) {
  if (claim.status === "loading") return "Connect to read";
  if (claim.status === "claiming") return "Confirm in wallet";
  if (claim.status === "pending") return "Confirming";
  if (claim.status === "claimed") return "Claimed";
  if (claim.status === "failed") return "Needs attention";
  if (!claim.recipientMatches) return "Wrong recipient";
  if (claim.amount === 0n) return "Nothing to claim";
  return "Ready";
}

function renderRows() {
  const claims = CLAIMS.map((claim) => ({
    ...claim,
    ...(state.claims.get(claim.id) ?? {
      amount: 0n,
      recipientMatches: false,
      status: "loading",
    }),
  })).filter((claim) => claim.kind === "native" || claim.amount > 0n);

  function buildRow(claim) {
    const row = document.createElement("li");
    row.className = "claim-row";
    row.dataset.state = claim.status;

    const identity = document.createElement("div");
    identity.className = "claim-identity";

    const name = document.createElement("strong");
    name.textContent = claim.name;

    const detail = document.createElement("span");
    detail.textContent = `${claim.detail} · ${shortAddress(claim.address)}`;

    identity.append(name, detail);

    const value = document.createElement("div");
    value.className = "claim-value";

    const amount = document.createElement("strong");
    amount.textContent = `${formatUnits(claim.amount, claim.decimals)} ${claim.unit}`;

    const status = document.createElement("span");
    status.textContent = statusLabel(claim);

    value.append(amount, status);
    row.append(identity, value);
    return row;
  }

  const nativeRows = claims.filter(({ kind }) => kind === "native").map(buildRow);
  const assetClaims = claims.filter(({ kind }) => kind === "asset");

  if (assetClaims.length === 0) {
    elements.claimRows.replaceChildren(...nativeRows);
    return;
  }

  const assetGroup = document.createElement("li");
  assetGroup.className = "asset-group";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const identity = document.createElement("span");
  identity.className = "asset-group-identity";
  const name = document.createElement("strong");
  name.textContent = "Stock-Paired";
  const detail = document.createElement("span");
  detail.textContent = "All releases";
  identity.append(name, detail);

  const value = document.createElement("span");
  value.className = "asset-group-value";
  const count = document.createElement("strong");
  count.textContent = `${assetClaims.length} asset ${assetClaims.length === 1 ? "balance" : "balances"}`;
  const hint = document.createElement("span");
  hint.textContent = "View details";
  value.append(count, hint);
  summary.append(identity, value);

  const assetList = document.createElement("ul");
  assetList.className = "asset-list";
  assetList.replaceChildren(...assetClaims.map(buildRow));
  details.append(summary, assetList);
  assetGroup.append(details);
  elements.claimRows.replaceChildren(...nativeRows, assetGroup);
}

function claimableClaims() {
  return CLAIMS.filter((claim) => {
    const current = state.claims.get(claim.id);
    return current?.recipientMatches === true && current.amount > 0n;
  });
}

function renderSummary() {
  const claimable = claimableClaims();
  const nativeTotal = claimable.filter(({ kind }) => kind === "native").reduce(
    (sum, claim) => sum + (state.claims.get(claim.id)?.amount ?? 0n),
    0n,
  );
  const assetCount = claimable.filter(({ kind }) => kind === "asset").length;

  elements.total.textContent = `${formatEth(nativeTotal)} ETH${assetCount > 0 ? ` + ${assetCount} assets` : ""}`;
  elements.claimCount.textContent = `${claimable.length} ${claimable.length === 1 ? "claim" : "claims"}`;
  elements.account.textContent = state.account ? shortAddress(state.account) : "Not connected";
  elements.network.textContent = state.chainId === MAINNET_CHAIN_ID ? "Ethereum" : "Wrong network";

  const connected = state.account !== null;
  const correctWallet = connected && isTreasury(state.account);
  const correctNetwork = state.chainId === MAINNET_CHAIN_ID;

  if (!connected) {
    elements.action.textContent = "Connect wallet";
    elements.actionDetail.textContent = "Connect the Programmable treasury";
    elements.action.disabled = state.busy;
  } else if (!correctNetwork) {
    elements.action.textContent = "Switch to Ethereum";
    elements.actionDetail.textContent = "Claims are available on Mainnet";
    elements.action.disabled = state.busy;
  } else if (!correctWallet) {
    elements.action.textContent = "Use treasury wallet";
    elements.actionDetail.textContent = shortAddress(TREASURY);
    elements.action.disabled = true;
  } else if (claimable.length === 0) {
    elements.action.textContent = "Nothing to claim";
    elements.actionDetail.textContent = "All known fee balances are empty";
    elements.action.disabled = true;
  } else {
    elements.action.textContent = "Claim all revenue";
    elements.actionDetail.textContent = `${claimable.length} wallet ${claimable.length === 1 ? "confirmation" : "confirmations"}`;
    elements.action.disabled = state.busy;
  }

  elements.refresh.disabled = state.busy || !connected;
  renderRows();
}

async function readClaim(claim, recipientPromise) {
  const [recipientWord, amountWord] = await Promise.all([
    recipientPromise,
    request("eth_call", [{ to: claim.address, data: readAccruedData(claim) }, "latest"]),
  ]);

  const recipient = decodeAddress(recipientWord);
  return {
    amount: decodeUint256(amountWord),
    recipient,
    recipientMatches: isTreasury(recipient),
    status: "ready",
  };
}

async function refreshClaims() {
  if (!state.account) return;

  setError();
  setStatus("Reading verified fee hooks");
  const recipientReads = new Map();
  for (const claim of CLAIMS) {
    const key = claim.address.toLowerCase();
    if (!recipientReads.has(key)) {
      recipientReads.set(
        key,
        request("eth_call", [{ to: claim.address, data: SELECTORS.launcherFeeRecipient }, "latest"]),
      );
    }
  }
  const results = await Promise.allSettled(
    CLAIMS.map((claim) => readClaim(claim, recipientReads.get(claim.address.toLowerCase()))),
  );

  results.forEach((result, index) => {
    const claim = CLAIMS[index];
    if (result.status === "fulfilled") {
      state.claims.set(claim.id, result.value);
      return;
    }

    state.claims.set(claim.id, {
      amount: 0n,
      recipientMatches: false,
      status: "failed",
    });
  });

  const failed = results.filter(({ status }) => status === "rejected").length;
  setStatus(failed === 0 ? "Balances are current" : `${failed} hooks could not be read`);
  renderSummary();
}

async function syncWallet({ requestAccounts = false } = {}) {
  const method = requestAccounts ? "eth_requestAccounts" : "eth_accounts";
  const [accounts, chainId] = await Promise.all([request(method), request("eth_chainId")]);
  state.account = Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : null;
  state.chainId = chainId;
  renderSummary();
  if (state.account) await refreshClaims();
}

async function switchToMainnet() {
  await request("wallet_switchEthereumChain", [{ chainId: MAINNET_CHAIN_ID }]);
  state.chainId = await request("eth_chainId");
  renderSummary();
  await refreshClaims();
}

async function waitForReceipt(hash) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5 * 60 * 1000) {
    const receipt = await request("eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error("The claim transaction reverted");
      return receipt;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 3500));
  }

  throw new Error("The transaction is still pending. Check MetaMask before retrying");
}

async function claimOne(claim) {
  const current = state.claims.get(claim.id);
  state.claims.set(claim.id, { ...current, status: "claiming" });
  renderSummary();

  const transaction = {
    from: state.account,
    to: claim.address,
    data: claimData(claim),
    value: "0x0",
  };

  const estimate = decodeUint256(await request("eth_estimateGas", [transaction]));
  const gas = (estimate * 120n) / 100n;
  const hash = await request("eth_sendTransaction", [{ ...transaction, gas: toQuantityHex(gas) }]);

  state.claims.set(claim.id, { ...current, status: "pending", transactionHash: hash });
  renderSummary();
  await waitForReceipt(hash);
  state.claims.set(claim.id, { ...current, amount: 0n, status: "claimed" });
  renderSummary();
}

async function claimAll() {
  await refreshClaims();
  const claims = claimableClaims();
  if (claims.length === 0) return;

  state.busy = true;
  setError();
  renderSummary();

  try {
    for (const [index, claim] of claims.entries()) {
      setStatus(`Claim ${index + 1} of ${claims.length} · ${claim.name} ${claim.detail}`);
      await claimOne(claim);
    }

    setStatus("All available ETH fees were claimed");
    await refreshClaims();
  } catch (error) {
    const message = error instanceof Error ? error.message : "The claim could not be completed";
    setError(message.includes("User rejected") ? "Claim cancelled in wallet" : message);
    setStatus("Claims stopped safely");
  } finally {
    state.busy = false;
    renderSummary();
  }
}

async function handlePrimaryAction() {
  try {
    setError();
    if (!state.account) {
      state.busy = true;
      renderSummary();
      await syncWallet({ requestAccounts: true });
      return;
    }

    if (state.chainId !== MAINNET_CHAIN_ID) {
      state.busy = true;
      renderSummary();
      await switchToMainnet();
      return;
    }

    if (isTreasury(state.account)) await claimAll();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet connection failed";
    setError(message.includes("User rejected") ? "Connection cancelled in wallet" : message);
  } finally {
    state.busy = false;
    renderSummary();
  }
}

elements.action.addEventListener("click", handlePrimaryAction);
elements.refresh.addEventListener("click", async () => {
  try {
    state.busy = true;
    renderSummary();
    await refreshClaims();
  } catch (error) {
    setError(error instanceof Error ? error.message : "Balances could not be refreshed");
  } finally {
    state.busy = false;
    renderSummary();
  }
});

if (window.ethereum?.on) {
  window.ethereum.on("accountsChanged", (accounts) => {
    state.account = Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : null;
    void syncWallet();
  });
  window.ethereum.on("chainChanged", (chainId) => {
    state.chainId = chainId;
    void syncWallet();
  });
}

renderSummary();
void syncWallet().catch(() => {
  setStatus("Connect MetaMask to read claimable fees");
  renderSummary();
});
