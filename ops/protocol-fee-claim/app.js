import {
  CLAIMS,
  HOOKS,
  MAINNET_CHAIN_ID,
  SELECTORS,
  TREASURY,
  atomicCapabilityStatus,
  buildClaimTransaction,
  buildWalletSendCalls,
  decodeAddress,
  decodeUint256,
  formatEth,
  formatUnits,
  isTreasury,
  keccak256Hex,
  normalizeBatchId,
  readAccruedData,
  shortAddress,
  toQuantityHex,
} from "./logic.mjs";

const state = {
  account: null,
  chainId: null,
  blockTag: null,
  capability: null,
  claims: new Map(),
  hooks: new Map(),
  busy: false,
};

const elements = {
  action: document.querySelector("[data-action]"),
  actionLabel: document.querySelector("[data-action-label]"),
  actionDetail: document.querySelector("[data-action-detail]"),
  account: document.querySelector("[data-account]"),
  batchMode: document.querySelector("[data-batch-mode]"),
  claimCount: document.querySelector("[data-claim-count]"),
  claimRows: document.querySelector("[data-claim-rows]"),
  error: document.querySelector("[data-error]"),
  network: document.querySelector("[data-network]"),
  refresh: document.querySelector("[data-refresh]"),
  status: document.querySelector("[data-status]"),
  total: document.querySelector("[data-total]"),
};

function provider() {
  if (!window.ethereum?.request)
    throw new Error("MetaMask wurde in diesem Browser nicht gefunden");
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

function hookVerified(claim) {
  return state.hooks.get(claim.hookId)?.verified === true;
}

function statusLabel(claim) {
  if (claim.status === "disconnected") return "Nach Verbindung";
  if (claim.status === "loading") return "Wird gelesen";
  if (claim.status === "claiming") return "In MetaMask bestätigen";
  if (claim.status === "pending") return "Wird bestätigt";
  if (claim.status === "claimed") return "Geclaimt";
  if (claim.status === "failed") return "Nicht verfügbar";
  if (!hookVerified(claim)) return "Contract nicht verifiziert";
  if (!claim.recipientMatches) return "Falscher Empfänger";
  if (claim.amount === 0n) return "Nichts offen";
  return "Bereit";
}

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

function renderRows() {
  const claims = CLAIMS.map((claim) => ({
    ...claim,
    ...(state.claims.get(claim.id) ?? {
      amount: 0n,
      recipientMatches: false,
      status: "loading",
    }),
  }));

  const visibleAssetClaims =
    state.account === null
      ? claims.filter(({ kind }) => kind === "asset")
      : claims.filter(({ kind, amount }) => kind === "asset" && amount > 0n);

  if (state.account === null) {
    for (const claim of claims) claim.status = "disconnected";
  }

  const nativeRows = claims
    .filter(({ kind }) => kind === "native")
    .map(buildRow);

  const assetGroup = document.createElement("li");
  assetGroup.className = "asset-group";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const identity = document.createElement("span");
  identity.className = "asset-group-identity";
  const name = document.createElement("strong");
  name.textContent = "Stock-Asset-Gebühren";
  const detail = document.createElement("span");
  detail.textContent = "V1 und gemeinsamer V2/V3-Hook";
  identity.append(name, detail);

  const value = document.createElement("span");
  value.className = "asset-group-value";
  const count = document.createElement("strong");
  count.textContent =
    state.account === null
      ? `${claims.filter(({ kind }) => kind === "asset").length} geprüft`
      : `${visibleAssetClaims.length} offen`;
  const hint = document.createElement("span");
  hint.textContent =
    visibleAssetClaims.length > 0
      ? "Details anzeigen"
      : "Keine Asset-Fees offen";
  value.append(count, hint);
  summary.append(identity, value);
  details.append(summary);

  if (visibleAssetClaims.length > 0) {
    const assetList = document.createElement("ul");
    assetList.className = "asset-list";
    assetList.replaceChildren(...visibleAssetClaims.map(buildRow));
    details.append(assetList);
  }

  assetGroup.append(details);
  elements.claimRows.replaceChildren(...nativeRows, assetGroup);
}

function claimableClaims() {
  return CLAIMS.filter((claim) => {
    const current = state.claims.get(claim.id);
    return (
      hookVerified(claim) &&
      current?.recipientMatches === true &&
      current.amount > 0n
    );
  });
}

function renderSummary() {
  const claimable = claimableClaims();
  const nativeTotal = claimable
    .filter(({ kind }) => kind === "native")
    .reduce(
      (sum, claim) => sum + (state.claims.get(claim.id)?.amount ?? 0n),
      0n,
    );
  const assetCount = claimable.filter(({ kind }) => kind === "asset").length;
  const verifiedHooks = HOOKS.filter(
    ({ id }) => state.hooks.get(id)?.verified === true,
  ).length;

  elements.total.textContent = `${formatEth(nativeTotal)} ETH${assetCount > 0 ? ` + ${assetCount} Assets` : ""}`;
  elements.claimCount.textContent = `${claimable.length} ${claimable.length === 1 ? "Claim" : "Claims"}`;
  elements.account.textContent = state.account
    ? shortAddress(state.account)
    : "Nicht verbunden";
  elements.network.textContent =
    state.chainId === MAINNET_CHAIN_ID
      ? "Ethereum"
      : state.account
        ? "Falsches Netzwerk"
        : "Ethereum";
  elements.batchMode.textContent = state.capability
    ? "Eine MetaMask-Bestätigung"
    : state.account
      ? "Einzelbestätigungen"
      : "Batch wird geprüft";

  const connected = state.account !== null;
  const correctWallet = connected && isTreasury(state.account);
  const correctNetwork = state.chainId === MAINNET_CHAIN_ID;

  if (!connected) {
    elements.actionLabel.textContent = "Wallet verbinden";
    elements.actionDetail.textContent = "MetaMask · Programmable Treasury";
    elements.action.disabled = state.busy;
  } else if (!correctNetwork) {
    elements.actionLabel.textContent = "Zu Ethereum wechseln";
    elements.actionDetail.textContent = "Mainnet erforderlich";
    elements.action.disabled = state.busy;
  } else if (!correctWallet) {
    elements.actionLabel.textContent = "Treasury-Wallet verwenden";
    elements.actionDetail.textContent = shortAddress(TREASURY);
    elements.action.disabled = true;
  } else if (verifiedHooks !== HOOKS.length) {
    elements.actionLabel.textContent = "Contract-Prüfung fehlgeschlagen";
    elements.actionDetail.textContent = `${verifiedHooks} von ${HOOKS.length} verifiziert`;
    elements.action.disabled = true;
  } else if (claimable.length === 0) {
    elements.actionLabel.textContent = "Alles geclaimt";
    elements.actionDetail.textContent = "Aktuell sind keine Fees offen";
    elements.action.disabled = true;
  } else {
    elements.actionLabel.textContent = "Alle Fees claimen";
    elements.actionDetail.textContent = state.capability
      ? `${claimable.length} Claims · 1 Bestätigung`
      : `${claimable.length} einzelne Bestätigungen`;
    elements.action.disabled = state.busy;
  }

  elements.refresh.disabled = state.busy || !connected;
  renderRows();
}

async function readHook(hook, blockTag) {
  const [code, recipientWord] = await Promise.all([
    request("eth_getCode", [hook.address, blockTag]),
    request("eth_call", [
      { to: hook.address, data: SELECTORS.launcherFeeRecipient },
      blockTag,
    ]),
  ]);
  const actualCodeHash = keccak256Hex(code);
  const recipient = decodeAddress(recipientWord);
  return {
    actualCodeHash,
    recipient,
    verified:
      actualCodeHash.toLowerCase() === hook.runtimeCodeHash.toLowerCase() &&
      isTreasury(recipient),
  };
}

async function readClaim(claim, blockTag) {
  const amountWord = await request("eth_call", [
    { to: claim.address, data: readAccruedData(claim) },
    blockTag,
  ]);
  const hook = state.hooks.get(claim.hookId);
  return {
    amount: decodeUint256(amountWord),
    recipient: hook?.recipient,
    recipientMatches: hook?.verified === true,
    status: "ready",
  };
}

async function readCapabilities() {
  if (!state.account || state.chainId !== MAINNET_CHAIN_ID) {
    state.capability = null;
    return;
  }
  try {
    const capabilities = await request("wallet_getCapabilities", [
      state.account,
      [MAINNET_CHAIN_ID],
    ]);
    state.capability = atomicCapabilityStatus(capabilities);
  } catch {
    state.capability = null;
  }
}

async function refreshClaims() {
  if (!state.account || state.chainId !== MAINNET_CHAIN_ID) return;
  setError();
  setStatus("Contract-Bindungen und Guthaben werden geprüft");
  const blockTag = await request("eth_blockNumber");
  state.blockTag = blockTag;

  const hookResults = await Promise.allSettled(
    HOOKS.map((hook) => readHook(hook, blockTag)),
  );
  hookResults.forEach((result, index) => {
    const hook = HOOKS[index];
    state.hooks.set(
      hook.id,
      result.status === "fulfilled" ? result.value : { verified: false },
    );
  });

  const claimResults = await Promise.allSettled(
    CLAIMS.map((claim) => readClaim(claim, blockTag)),
  );
  claimResults.forEach((result, index) => {
    const claim = CLAIMS[index];
    state.claims.set(
      claim.id,
      result.status === "fulfilled"
        ? result.value
        : { amount: 0n, recipientMatches: false, status: "failed" },
    );
  });

  await readCapabilities();
  const verified = hookResults.filter(
    ({ status }, index) =>
      status === "fulfilled" && state.hooks.get(HOOKS[index].id)?.verified,
  ).length;
  const failedClaims = claimResults.filter(
    ({ status }) => status === "rejected",
  ).length;
  if (verified !== HOOKS.length)
    setError(
      "Mindestens eine Contract-Bindung stimmt nicht. Claims bleiben gesperrt.",
    );
  setStatus(
    failedClaims === 0
      ? `Stand Block ${BigInt(blockTag).toString()} · ${verified}/${HOOKS.length} Contracts verifiziert`
      : `${failedClaims} Guthaben konnten nicht gelesen werden`,
  );
  renderSummary();
}

async function syncWallet({ requestAccounts = false } = {}) {
  const method = requestAccounts ? "eth_requestAccounts" : "eth_accounts";
  const [accounts, chainId] = await Promise.all([
    request(method),
    request("eth_chainId"),
  ]);
  state.account =
    Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : null;
  state.chainId = chainId;
  renderSummary();
  if (state.account && chainId === MAINNET_CHAIN_ID) await refreshClaims();
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
      if (receipt.status !== "0x1")
        throw new Error("Eine Claim-Transaktion ist fehlgeschlagen");
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
  }
  throw new Error(
    "Die Transaktion ist noch offen. Vor einem neuen Versuch MetaMask prüfen.",
  );
}

async function waitForBatch(id) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5 * 60 * 1000) {
    const result = await request("wallet_getCallsStatus", [id]);
    if (result?.status === 200) {
      if (
        result.atomic !== true ||
        !Array.isArray(result.receipts) ||
        result.receipts.some(({ status }) => status !== "0x1")
      ) {
        throw new Error("Der atomare Claim-Batch ist fehlgeschlagen");
      }
      return result;
    }
    if (typeof result?.status === "number" && result.status >= 400)
      throw new Error("Der Claim-Batch wurde abgelehnt");
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
  }
  throw new Error(
    "Der Batch ist noch offen. Vor einem neuen Versuch MetaMask prüfen.",
  );
}

async function claimOne(claim) {
  const current = state.claims.get(claim.id);
  state.claims.set(claim.id, { ...current, status: "claiming" });
  renderSummary();
  const transaction = buildClaimTransaction(state.account, claim);
  const estimate = decodeUint256(
    await request("eth_estimateGas", [transaction]),
  );
  const hash = await request("eth_sendTransaction", [
    { ...transaction, gas: toQuantityHex((estimate * 120n) / 100n) },
  ]);
  state.claims.set(claim.id, {
    ...current,
    status: "pending",
    transactionHash: hash,
  });
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
    if (state.capability) {
      setStatus(
        `${claims.length} Claims werden als ein atomarer MetaMask-Batch vorbereitet`,
      );
      const result = await request("wallet_sendCalls", [
        buildWalletSendCalls(state.account, claims),
      ]);
      await waitForBatch(normalizeBatchId(result));
    } else {
      for (const [index, claim] of claims.entries()) {
        setStatus(
          `Claim ${index + 1} von ${claims.length} · ${claim.name} ${claim.detail}`,
        );
        await claimOne(claim);
      }
    }
    setStatus("Alle verfügbaren Fees wurden geclaimt");
    await refreshClaims();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Der Claim konnte nicht abgeschlossen werden";
    setError(
      /reject|denied|cancel/i.test(message)
        ? "Claim in MetaMask abgebrochen"
        : message,
    );
    setStatus("Claims wurden sicher gestoppt");
  } finally {
    state.busy = false;
    renderSummary();
  }
}

async function handlePrimaryAction() {
  try {
    setError();
    state.busy = true;
    renderSummary();
    if (!state.account) await syncWallet({ requestAccounts: true });
    else if (state.chainId !== MAINNET_CHAIN_ID) await switchToMainnet();
    else if (isTreasury(state.account)) await claimAll();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Wallet-Verbindung fehlgeschlagen";
    setError(
      /reject|denied|cancel/i.test(message)
        ? "Aktion in MetaMask abgebrochen"
        : message,
    );
  } finally {
    state.busy = false;
    renderSummary();
  }
}

elements.action.addEventListener("click", handlePrimaryAction);
elements.refresh.addEventListener("click", async () => {
  state.busy = true;
  renderSummary();
  try {
    await refreshClaims();
  } catch (error) {
    setError(
      error instanceof Error ? error.message : "Aktualisierung fehlgeschlagen",
    );
  } finally {
    state.busy = false;
    renderSummary();
  }
});

window.ethereum?.on?.("accountsChanged", () =>
  syncWallet().catch(() => undefined),
);
window.ethereum?.on?.("chainChanged", () =>
  syncWallet().catch(() => undefined),
);

renderSummary();
syncWallet().catch(() => {
  setStatus("MetaMask verbinden, um offene Fees zu lesen");
  renderSummary();
});
