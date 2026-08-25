import {
  CLASSIC_LAUNCHERS,
  CLAIMS,
  CUSTOM_EVENT_TOPICS,
  CUSTOM_REGISTRY,
  CUSTOM_V2_POLICY,
  CUSTOM_V2_RELEASE_PATH,
  CUSTOM_V2_SELECTORS,
  HOOKS,
  LAUNCH_STAMP_ROUTER,
  LAUNCH_STAMP_SELECTORS,
  LAUNCH_STAMP_TOPICS,
  MAINNET_CHAIN_ID,
  ROUTER_CUSTOM_CLAIM_PROFILES,
  SELECTORS,
  TREASURY,
  atomicCapabilityStatus,
  buildWalletSendCalls,
  createRefreshQueue,
  customClaimDefinitionClassification,
  customLaunchClassification,
  customLaunchStateData,
  customV2Bytes32ReadData,
  customV2IndexedReadData,
  customV2SourceClassification,
  decodeAddress,
  decodeBool,
  decodeBytes4,
  decodeBytes32,
  decodeCustomLaunchState,
  decodeCustomV2SourceState,
  decodeLaunchStampProof,
  decodeLaunchStampRecord,
  decodeUint256,
  exactRouterFinalizedCheckpoint,
  formatEth,
  formatUnits,
  isTreasury,
  keccak256Hex,
  launchStampAddressReadData,
  launchStampBytes32ReadData,
  launchStampLogSetFingerprint,
  launchStampPoolReadData,
  normalizeBatchId,
  parseCustomV2Release,
  poolManagerBalanceOfData,
  readAccruedData,
  reduceClassicLaunchLogs,
  reduceCustomRegistryLogs,
  reduceLaunchStampLogs,
  requireAtomicClaimCapability,
  routerFinalizedBoundary,
  shortAddress,
  toQuantityHex,
  routerCustomClaimClassification,
  withTimeout,
} from "./logic.mjs";

const DEMO_MODE = new URLSearchParams(window.location.search).has("demo");
const EVENT_LOG_CHUNK_SIZE = 10_000n;
const MAX_ROUTER_LAUNCHES = 4_096;
const MAX_BATCH_CALLS = 64;
const ROUTER_QUORUM_RPC_URLS = Object.freeze([
  "https://eth.drpc.org",
  "https://rpc.mevblocker.io",
]);
const ROUTER_QUORUM_TIMEOUT_MS = 20_000;
const INTERACTIVE_WALLET_METHODS = new Set([
  "eth_requestAccounts",
  "wallet_switchEthereumChain",
  "wallet_sendCalls",
]);

const state = {
  account: null,
  chainId: null,
  blockTag: null,
  capability: null,
  claims: new Map(),
  hooks: new Map(),
  custom: {
    status: "idle",
    registryVerified: false,
    launches: [],
    error: null,
  },
  customV2: {
    status: "idle",
    release: null,
    sources: [],
    error: null,
  },
  router: {
    status: "idle",
    verified: false,
    finalizedBlock: null,
    launches: [],
    error: null,
  },
  classic: {
    status: "idle",
    launchersVerified: false,
    launches: [],
    error: null,
  },
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
  const operation = provider().request({ method, params });
  if (INTERACTIVE_WALLET_METHODS.has(method)) return operation;
  return withTimeout(
    operation,
    ROUTER_QUORUM_TIMEOUT_MS,
    `Wallet-RPC-Zeitlimit bei ${method} überschritten`,
  );
}

let publicRpcId = 1;

async function publicRpcRequest(url, method, params = []) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    ROUTER_QUORUM_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: publicRpcId++,
        method,
        params,
      }),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Router-Quorum-RPC antwortet mit HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.error || payload?.result === undefined)
      throw new Error(
        payload?.error?.message ?? "Router-Quorum-RPC-Antwort ist ungültig",
      );
    return payload.result;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function routerQuorumRequest(method, params = []) {
  return Promise.all([
    request(method, params),
    ...ROUTER_QUORUM_RPC_URLS.map((url) =>
      publicRpcRequest(url, method, params),
    ),
  ]);
}

function setError(message = "") {
  elements.error.textContent = message;
  elements.error.hidden = message.length === 0;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function disclosureIndicator() {
  const indicator = document.createElement("span");
  indicator.className = "disclosure-indicator";
  indicator.setAttribute("aria-hidden", "true");
  return indicator;
}

function hookVerified(claim) {
  if (claim.kind === "custom") {
    if (claim.origin === "launch-stamp-router")
      return (
        claim.provenanceVerified === true &&
        claim.runtimeVerified === true &&
        claim.claimBindingVerified === true
      );
    return claim.bindingVerified === true;
  }
  return state.hooks.get(claim.hookId)?.verified === true;
}

function claimHasOpenAmount(claim) {
  return (
    (typeof claim?.amount === "bigint" && claim.amount > 0n) ||
    (typeof claim?.secondaryAmount === "bigint" &&
      claim.secondaryAmount > 0n)
  );
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
  if (!claimHasOpenAmount(claim)) return "Nichts offen";
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

function customStatusLabel(launch) {
  const classification = customLaunchClassification(launch);
  if (launch.status === "claiming") return "In MetaMask bestätigen";
  if (launch.status === "pending") return "Wird bestätigt";
  if (launch.status === "claimed") return "Geclaimt";
  if (launch.status === "failed") return "Nicht verfügbar";
  if (classification === "ready") return "Bereit";
  if (classification === "empty") return "Nichts offen";
  if (classification === "no-market") return "Kein Fee-Markt";
  if (classification === "pending") return "Noch nicht finalisiert";
  if (classification === "revoked") return "Widerrufen";
  if (classification === "adapter-required")
    return "Claim-Adapter noch nicht live";
  return "Onchain-Bindung unvollständig";
}

function buildCustomRow(launch) {
  const current = state.claims.get(launch.id) ?? launch;
  const rendered = { ...launch, ...current };
  const row = document.createElement("li");
  row.className = "claim-row custom-row";
  row.dataset.state = ["claiming", "pending", "claimed", "failed"].includes(
    rendered.status,
  )
    ? rendered.status
    : customLaunchClassification(rendered);

  const identity = document.createElement("div");
  identity.className = "claim-identity";
  const name = document.createElement("strong");
  name.textContent = `Custom Launch ${launch.registrationSequence.toString()}`;
  const detail = document.createElement("span");
  detail.textContent = `${shortAddress(launch.launchId)} · ${shortAddress(launch.primaryContract)}`;
  identity.append(name, detail);

  const value = document.createElement("div");
  value.className = "claim-value";
  const fee = document.createElement("strong");
  fee.textContent =
    launch.standardClaimBindingVerified === true
      ? `${formatEth(rendered.amount)} ETH`
      : `${launch.feePolicy?.programmableShareBps ?? 0} bps`;
  const status = document.createElement("span");
  status.textContent = customStatusLabel(rendered);
  value.append(fee, status);
  row.append(identity, value);
  return row;
}

function customV2StatusLabel(source) {
  if (source.status === "claiming") return "In MetaMask bestätigen";
  if (source.status === "pending") return "Wird bestätigt";
  if (source.status === "claimed") return "Geclaimt";
  if (source.status === "failed") return "Nicht verfügbar";
  const classification = customV2SourceClassification(source);
  if (classification === "ready") return "Bereit";
  if (classification === "empty") return "Nichts offen";
  if (classification === "quarantined") return "Nicht ausführbar";
  return "Onchain-Bindung unvollständig";
}

function buildCustomV2Row(source) {
  const current = state.claims.get(source.id) ?? source;
  const rendered = { ...source, ...current };
  const row = document.createElement("li");
  row.className = "claim-row custom-row";
  row.dataset.state =
    ["claiming", "pending", "claimed", "failed"].includes(rendered.status)
      ? rendered.status
      : customV2SourceClassification(rendered);

  const identity = document.createElement("div");
  identity.className = "claim-identity";
  const name = document.createElement("strong");
  name.textContent = `Custom Launch ${source.index + 1}`;
  const detail = document.createElement("span");
  detail.textContent = `${shortAddress(source.launchId)} · ${shortAddress(source.address)}`;
  identity.append(name, detail);

  const value = document.createElement("div");
  value.className = "claim-value";
  const amount = document.createElement("strong");
  amount.textContent = `${formatEth(rendered.amount)} ETH`;
  const status = document.createElement("span");
  status.textContent = customV2StatusLabel(rendered);
  value.append(amount, status);
  row.append(identity, value);
  return row;
}

function routerCustomStatusLabel(source) {
  const current = state.claims.get(source.id) ?? source;
  if (current.status === "claiming") return "In MetaMask bestätigen";
  if (current.status === "pending") return "Wird bestätigt";
  if (current.status === "claimed") return "Geclaimt";
  const classification = routerCustomClaimClassification({
    ...source,
    ...current,
  });
  if (classification === "ready") return "Bereit";
  if (classification === "empty") return "Nichts offen";
  if (classification === "no-manual-claim")
    return "Gebühren werden direkt ausgezahlt";
  return "Claim-Profil fehlt · alles gesperrt";
}

function buildRouterCustomRow(source) {
  const current = state.claims.get(source.id) ?? source;
  const rendered = { ...source, ...current };
  const classification = routerCustomClaimClassification(rendered);
  const row = document.createElement("li");
  row.className = "claim-row custom-row router-custom-row";
  row.dataset.state = ["claiming", "pending", "claimed"].includes(
    rendered.status,
  )
    ? rendered.status
    : classification;

  const identity = document.createElement("div");
  identity.className = "claim-identity";
  const name = document.createElement("strong");
  name.textContent = `Custom · ${shortAddress(source.token)}`;
  const detail = document.createElement("span");
  detail.textContent = `Launch Router · ${shortAddress(source.hook)}`;
  identity.append(name, detail);

  const value = document.createElement("div");
  value.className = "claim-value";
  const amount = document.createElement("strong");
  if (classification === "no-manual-claim") {
    amount.textContent = "Direkt";
  } else {
    const amounts = [];
    if ((rendered.amount ?? 0n) > 0n)
      amounts.push(`${formatEth(rendered.amount)} ETH`);
    if ((rendered.secondaryAmount ?? 0n) > 0n)
      amounts.push(
        `${formatUnits(rendered.secondaryAmount, rendered.secondaryDecimals)} ${rendered.secondaryUnit}`,
      );
    amount.textContent = amounts.length > 0 ? amounts.join(" + ") : "0 ETH";
  }
  const status = document.createElement("span");
  status.textContent = routerCustomStatusLabel(rendered);
  value.append(amount, status);
  row.append(identity, value);
  return row;
}

function buildCustomGroup() {
  const routerCustoms = state.router.launches.filter(
    ({ launchKind }) => launchKind === 1,
  );
  const group = document.createElement("li");
  group.className = "asset-group custom-group";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const identity = document.createElement("span");
  identity.className = "asset-group-identity";
  const name = document.createElement("strong");
  name.textContent = "Custom-v4-Gebühren";
  const detail = document.createElement("span");
  detail.textContent = "Retired V1 + offizieller Launch Router";
  identity.append(name, detail);

  const value = document.createElement("span");
  value.className = "asset-group-value";
  const count = document.createElement("strong");
  const hint = document.createElement("span");
  if (state.account === null) {
    count.textContent = "Registry";
    hint.textContent = "Nach Verbindung";
  } else if (
    state.custom.status === "loading" ||
    state.customV2.status === "loading" ||
    state.router.status === "loading"
  ) {
    count.textContent = "Wird gelesen";
    hint.textContent = "Finalisierte Launches";
  } else if (state.custom.error || state.router.error) {
    count.textContent = "Nicht verfügbar";
    hint.textContent = "Claims gesperrt";
  } else {
    const feeBearing = state.custom.launches.filter(
      (launch) => customLaunchClassification(launch) === "adapter-required",
    ).length;
    const readyV1Count = state.custom.launches.filter(
      (launch) => customLaunchClassification(launch) === "ready",
    ).length;
    const sourceCount = state.customV2.sources.length;
    const routerReadyCount = routerCustoms.filter(
      (source) => routerCustomClaimClassification(source) === "ready",
    ).length;
    const routerBlockedCount = routerCustoms.filter(
      (source) => routerCustomClaimClassification(source) === "blocked",
    ).length;
    const readyCount =
      readyV1Count +
      routerReadyCount +
      state.customV2.sources.filter(
        (source) => customV2SourceClassification(source) === "ready",
      ).length;
    count.textContent = `${state.custom.launches.length + sourceCount + routerCustoms.length} erkannt`;
    if (state.customV2.error) hint.textContent = "V2-Release gesperrt";
    else if (routerBlockedCount > 0)
      hint.textContent = `${routerBlockedCount} unbekanntes Claim-Profil gesperrt`;
    else if (readyCount > 0)
      hint.textContent = `${readyCount} Custom-Claim${readyCount === 1 ? "" : "s"} offen`;
    else if (feeBearing > 0)
      hint.textContent = `${feeBearing} Legacy-Quelle${feeBearing === 1 ? "" : "n"} gesperrt`;
    else if (state.customV2.status === "hold")
      hint.textContent = "V2 wartet auf Mainnet-Release";
    else hint.textContent = "Keine Custom-Fees offen";
  }
  value.append(count, hint);
  summary.append(identity, value, disclosureIndicator());
  details.append(summary);

  if (
    state.custom.launches.length > 0 ||
    state.customV2.sources.length > 0 ||
    routerCustoms.length > 0
  ) {
    const list = document.createElement("ul");
    list.className = "asset-list";
    list.replaceChildren(
      ...state.customV2.sources.map(buildCustomV2Row),
      ...routerCustoms.map(buildRouterCustomRow),
      ...state.custom.launches.map(buildCustomRow),
    );
    details.append(list);
  }
  group.append(details);
  return group;
}

function buildClassicLaunchRow(launch) {
  const row = document.createElement("li");
  row.className = "claim-row classic-launch-row";
  const releaseName = launch.releaseName ?? "Launch Router";
  const covered = launch.claimMode !== "unsupported";
  row.dataset.state = covered ? "covered" : "blocked";

  const identity = document.createElement("div");
  identity.className = "claim-identity";
  const name = document.createElement("strong");
  name.textContent = launch.symbol || launch.name || "Classic Token";
  const detail = document.createElement("span");
  detail.textContent = `${releaseName} · ${shortAddress(launch.token)}`;
  identity.append(name, detail);

  const value = document.createElement("div");
  value.className = "claim-value";
  const coverage = document.createElement("strong");
  coverage.textContent = covered ? "Enthalten" : "Gesperrt";
  const status = document.createElement("span");
  status.textContent = covered
    ? `Im ${launch.claimProfile ?? releaseName}-Claim`
    : "Unbekannter Classic-Hook";
  value.append(coverage, status);
  row.append(identity, value);
  return row;
}

function buildClassicLaunchGroup() {
  const routerClassic = state.router.launches.filter(
    ({ launchKind }) => launchKind === 2,
  );
  const launches = [...routerClassic, ...state.classic.launches];
  const group = document.createElement("li");
  group.className = "asset-group classic-launch-group";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const identity = document.createElement("span");
  identity.className = "asset-group-identity";
  const name = document.createElement("strong");
  name.textContent = "Classic Launches";
  const detail = document.createElement("span");
  detail.textContent = "Launcher-Historie + offizieller Launch Router";
  identity.append(name, detail);

  const value = document.createElement("span");
  value.className = "asset-group-value";
  const count = document.createElement("strong");
  const hint = document.createElement("span");
  if (state.account === null) {
    count.textContent = "Onchain";
    hint.textContent = "Nach Verbindung";
  } else if (
    state.classic.status === "loading" ||
    state.router.status === "loading"
  ) {
    count.textContent = "Wird gelesen";
    hint.textContent = "V2 und V3";
  } else if (state.classic.error || state.router.error) {
    count.textContent = "Nicht verfügbar";
    hint.textContent = "Hook-Claim bleibt aktiv";
  } else {
    const unsupported = routerClassic.filter(
      ({ claimMode }) => claimMode === "unsupported",
    ).length;
    count.textContent = `${launches.length} erkannt`;
    hint.textContent = unsupported
      ? `${unsupported} neuer Hook gesperrt`
      : "Alle über Classic-Hooks abgedeckt";
  }
  value.append(count, hint);
  summary.append(identity, value, disclosureIndicator());
  details.append(summary);

  if (launches.length > 0) {
    const list = document.createElement("ul");
    list.className = "asset-list";
    list.replaceChildren(...launches.map(buildClassicLaunchRow));
    details.append(list);
  }
  group.append(details);
  return group;
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
  summary.append(identity, value, disclosureIndicator());
  details.append(summary);

  if (visibleAssetClaims.length > 0) {
    const assetList = document.createElement("ul");
    assetList.className = "asset-list";
    assetList.replaceChildren(...visibleAssetClaims.map(buildRow));
    details.append(assetList);
  }

  assetGroup.append(details);
  elements.claimRows.replaceChildren(
    ...nativeRows,
    buildClassicLaunchGroup(),
    assetGroup,
    buildCustomGroup(),
  );
}

function allClaimDefinitions() {
  return [
    ...CLAIMS,
    ...state.custom.launches.filter(
      ({ standardClaimBindingVerified }) =>
        standardClaimBindingVerified === true,
    ),
    ...state.customV2.sources,
    ...state.router.launches.filter(
      ({ launchKind, claimMode }) =>
        launchKind === 1 && claimMode === "manual",
    ),
  ];
}

function claimableClaims() {
  return allClaimDefinitions().filter((claim) => {
    const current = state.claims.get(claim.id);
    if (claim.kind === "custom") {
      const classification = customClaimDefinitionClassification(
        claim,
        current,
      );
      if (classification !== "ready") return false;
    }
    return (
      hookVerified(claim) &&
      current?.recipientMatches === true &&
      claimHasOpenAmount(current)
    );
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function claimSafetyError() {
  if (state.router.status !== "ready" || state.router.verified !== true)
    return "Der Launch-Stamp-Router ist nicht vollständig verifiziert";
  if (
    !["ready", "retired"].includes(state.custom.status) ||
    state.custom.registryVerified !== true
  )
    return "Die Custom Registry ist nicht vollständig verifiziert";
  if (!["ready", "hold"].includes(state.customV2.status))
    return "Das Custom-V2-Release ist nicht vollständig verifiziert";
  if (
    state.custom.launches.some((launch) =>
      ["adapter-required", "blocked"].includes(
        customLaunchClassification(launch),
      ),
    )
  )
    return "Mindestens eine Custom-V1-Feequelle ist nicht sicher claimbar";
  if (
    state.customV2.sources.some(
      (source) => customV2SourceClassification(source) === "blocked",
    )
  )
    return "Mindestens eine Custom-V2-Source-Bindung stimmt nicht";
  if (
    state.router.launches.some(
      (launch) =>
        (launch.launchKind === 1 &&
          routerCustomClaimClassification(launch) === "blocked") ||
        (launch.launchKind === 2 && launch.claimMode === "unsupported"),
    )
  )
    return "Mindestens ein Router-Launch hat noch kein freigegebenes Claim-Profil";
  if (HOOKS.some(({ id }) => state.hooks.get(id)?.verified !== true))
    return "Mindestens eine Classic- oder Stock-Bindung stimmt nicht";
  if (claimableClaims().length > MAX_BATCH_CALLS)
    return `Mehr als ${MAX_BATCH_CALLS} offene Claims passen nicht sicher in einen atomaren Batch`;
  return null;
}

function renderSummary() {
  const claimable = claimableClaims();
  const nativeTotal = claimable
    .filter(({ kind }) => kind === "native" || kind === "custom")
    .reduce(
      (sum, claim) => sum + (state.claims.get(claim.id)?.amount ?? 0n),
      0n,
    );
  const assetCount =
    claimable.filter(({ kind }) => kind === "asset").length +
    claimable.filter(
      (claim) => (state.claims.get(claim.id)?.secondaryAmount ?? 0n) > 0n,
    ).length;
  const verifiedHooks = HOOKS.filter(
    ({ id }) => state.hooks.get(id)?.verified === true,
  ).length;
  const customAdapterBlockers = state.custom.launches.filter(
    (launch) => customLaunchClassification(launch) === "adapter-required",
  );
  const customBindingBlockers = state.custom.launches.filter(
    (launch) => customLaunchClassification(launch) === "blocked",
  );
  const customV2BindingBlockers = state.customV2.sources.filter(
    (source) => customV2SourceClassification(source) === "blocked",
  );
  const routerBindingBlockers = state.router.launches.filter(
    (launch) =>
      (launch.launchKind === 1 &&
        routerCustomClaimClassification(launch) === "blocked") ||
      (launch.launchKind === 2 && launch.claimMode === "unsupported"),
  );

  elements.total.textContent = `${formatEth(nativeTotal)} ETH${assetCount > 0 ? ` + ${assetCount} Assets` : ""}`;
  elements.claimCount.textContent = `${claimable.length} ${claimable.length === 1 ? "Claim" : "Claims"}`;
  elements.account.textContent = state.account
    ? shortAddress(state.account)
    : "Nicht verbunden";
  elements.network.textContent = DEMO_MODE
    ? "Ethereum · QA"
    : state.chainId === MAINNET_CHAIN_ID
      ? "Ethereum"
      : state.account
        ? "Falsches Netzwerk"
        : "Ethereum";
  elements.batchMode.textContent = state.capability
    ? "Eine MetaMask-Bestätigung"
    : state.account
      ? "Nicht verfügbar"
      : "Batch wird geprüft";

  const connected = state.account !== null;
  const correctWallet = connected && isTreasury(state.account);
  const correctNetwork = state.chainId === MAINNET_CHAIN_ID;

  if (!connected) {
    elements.actionLabel.textContent = "Wallet verbinden";
    elements.actionDetail.textContent = "Nur 0x4957…376C";
    elements.action.disabled = state.busy;
  } else if (!correctNetwork) {
    elements.actionLabel.textContent = "Zu Ethereum wechseln";
    elements.actionDetail.textContent = "Mainnet erforderlich";
    elements.action.disabled = state.busy;
  } else if (!correctWallet) {
    elements.actionLabel.textContent = "Treasury-Wallet verwenden";
    elements.actionDetail.textContent = shortAddress(TREASURY);
    elements.action.disabled = true;
  } else if (
    state.custom.status === "loading" ||
    state.customV2.status === "loading" ||
    state.classic.status === "loading" ||
    state.router.status === "loading"
  ) {
    elements.actionLabel.textContent = "Scan läuft";
    elements.actionDetail.textContent =
      "Router, Registry, Codehashes und Guthaben werden geprüft";
    elements.action.disabled = true;
  } else if (
    state.custom.status === "failed" ||
    state.custom.registryVerified !== true
  ) {
    elements.actionLabel.textContent = "Custom Registry nicht verifiziert";
    elements.actionDetail.textContent = "Neu laden oder RPC-Verbindung prüfen";
    elements.action.disabled = true;
  } else if (state.customV2.status === "failed") {
    elements.actionLabel.textContent = "Custom V2 nicht verifiziert";
    elements.actionDetail.textContent = "Release-Bindung oder RPC-Verbindung prüfen";
    elements.action.disabled = true;
  } else if (state.router.status === "failed" || state.router.verified !== true) {
    elements.actionLabel.textContent = "Launch Router nicht verifiziert";
    elements.actionDetail.textContent = "Neu laden oder RPC-Verbindung prüfen";
    elements.action.disabled = true;
  } else if (customBindingBlockers.length > 0) {
    elements.actionLabel.textContent = "Custom-Quelle nicht verifiziert";
    elements.actionDetail.textContent = `${customBindingBlockers.length} Onchain-Bindung${customBindingBlockers.length === 1 ? "" : "en"} gesperrt`;
    elements.action.disabled = true;
  } else if (customV2BindingBlockers.length > 0) {
    elements.actionLabel.textContent = "Custom-V2-Quelle nicht verifiziert";
    elements.actionDetail.textContent = `${customV2BindingBlockers.length} Source-Bindung${customV2BindingBlockers.length === 1 ? "" : "en"} gesperrt`;
    elements.action.disabled = true;
  } else if (customAdapterBlockers.length > 0) {
    elements.actionLabel.textContent = "Custom-Claimadapter fehlt";
    elements.actionDetail.textContent = `${customAdapterBlockers.length} finalisierte Feequelle${customAdapterBlockers.length === 1 ? "" : "n"} gesperrt`;
    elements.action.disabled = true;
  } else if (routerBindingBlockers.length > 0) {
    elements.actionLabel.textContent = "Neues Claim-Profil erforderlich";
    elements.actionDetail.textContent = `${routerBindingBlockers.length} Router-Launch${routerBindingBlockers.length === 1 ? "" : "es"} sichtbar und gesperrt`;
    elements.action.disabled = true;
  } else if (verifiedHooks !== HOOKS.length) {
    elements.actionLabel.textContent = "Contract-Prüfung fehlgeschlagen";
    elements.actionDetail.textContent = `${verifiedHooks} von ${HOOKS.length} verifiziert`;
    elements.action.disabled = true;
  } else if (claimable.length > MAX_BATCH_CALLS) {
    elements.actionLabel.textContent = "Zu viele offene Claims";
    elements.actionDetail.textContent = `Sicheres Limit: ${MAX_BATCH_CALLS} pro atomarem Batch`;
    elements.action.disabled = true;
  } else if (claimable.length === 0) {
    elements.actionLabel.textContent = "Alles geclaimt";
    elements.actionDetail.textContent = "Aktuell sind keine Fees offen";
    elements.action.disabled = true;
  } else if (!state.capability) {
    elements.actionLabel.textContent = "Gemeinsamer Claim nicht verfügbar";
    elements.actionDetail.textContent =
      "MetaMask unterstützt keinen atomaren Batch";
    elements.action.disabled = true;
  } else {
    elements.actionLabel.textContent = "Alle verifizierten Fees claimen";
    const claimLabel = `${claimable.length} ${claimable.length === 1 ? "Claim" : "Claims"}`;
    elements.actionDetail.textContent = `${claimLabel} · 1 MetaMask-Bestätigung`;
    elements.action.disabled = state.busy;
  }

  elements.refresh.disabled = state.busy || !connected;
  renderRows();
}

async function readCustomRegistryLogs(blockTag) {
  const latest = BigInt(blockTag);
  const topics = [Object.values(CUSTOM_EVENT_TOPICS)];
  const logs = [];
  for (
    let fromBlock = CUSTOM_REGISTRY.startBlock;
    fromBlock <= latest;
    fromBlock += EVENT_LOG_CHUNK_SIZE
  ) {
    const toBlock =
      fromBlock + EVENT_LOG_CHUNK_SIZE - 1n < latest
        ? fromBlock + EVENT_LOG_CHUNK_SIZE - 1n
        : latest;
    logs.push(
      ...(await request("eth_getLogs", [
        {
          address: CUSTOM_REGISTRY.address,
          fromBlock: toQuantityHex(fromBlock),
          toBlock: toQuantityHex(toBlock),
          topics,
        },
      ])),
    );
  }
  return logs;
}

async function readClassicLauncherLogs(launcher, blockTag) {
  const latest = BigInt(blockTag);
  const logs = [];
  for (
    let fromBlock = launcher.startBlock;
    fromBlock <= latest;
    fromBlock += EVENT_LOG_CHUNK_SIZE
  ) {
    const toBlock =
      fromBlock + EVENT_LOG_CHUNK_SIZE - 1n < latest
        ? fromBlock + EVENT_LOG_CHUNK_SIZE - 1n
        : latest;
    logs.push(
      ...(await request("eth_getLogs", [
        {
          address: launcher.address,
          fromBlock: toQuantityHex(fromBlock),
          toBlock: toQuantityHex(toBlock),
          topics: [launcher.eventTopic],
        },
      ])),
    );
  }
  return logs;
}

async function readClassicLaunches(blockTag) {
  state.classic = {
    status: "loading",
    launchersVerified: false,
    launches: [],
    error: null,
  };
  renderSummary();
  try {
    const launcherResults = await Promise.all(
      CLASSIC_LAUNCHERS.map(async (launcher) => {
        const [runtimeCode, logs] = await Promise.all([
          request("eth_getCode", [launcher.address, blockTag]),
          readClassicLauncherLogs(launcher, blockTag),
        ]);
        if (
          keccak256Hex(runtimeCode).toLowerCase() !==
          launcher.runtimeCodeHash.toLowerCase()
        )
          throw new Error(`${launcher.name} Launcher stimmt nicht`);
        return logs.map((log) => ({ launcher, log }));
      }),
    );
    const launches = reduceClassicLaunchLogs(launcherResults.flat());
    state.classic = {
      status: "ready",
      launchersVerified: true,
      launches,
      error: null,
    };
  } catch (error) {
    state.classic = {
      status: "failed",
      launchersVerified: false,
      launches: [],
      error:
        error instanceof Error
          ? error.message
          : "Classic Launches konnten nicht gelesen werden",
    };
  }
}

async function readLaunchStampLogs(toBlock) {
  const logs = [];
  for (
    let fromBlock = LAUNCH_STAMP_ROUTER.startBlock;
    fromBlock <= toBlock;
    fromBlock += EVENT_LOG_CHUNK_SIZE
  ) {
    const chunkEnd =
      fromBlock + EVENT_LOG_CHUNK_SIZE - 1n < toBlock
        ? fromBlock + EVENT_LOG_CHUNK_SIZE - 1n
        : toBlock;
    const filter = {
      address: LAUNCH_STAMP_ROUTER.address,
      fromBlock: toQuantityHex(fromBlock),
      toBlock: toQuantityHex(chunkEnd),
      topics: [LAUNCH_STAMP_TOPICS.launchStamped],
    };
    const responses = await routerQuorumRequest("eth_getLogs", [filter]);
    const fingerprints = responses.map(launchStampLogSetFingerprint);
    if (new Set(fingerprints).size !== 1)
      throw new Error("Die Router-Loghistorie stimmt im RPC-Quorum nicht überein");
    logs.push(...responses[0]);
    if (logs.length > MAX_ROUTER_LAUNCHES)
      throw new Error("Die Router-Launchliste überschreitet das sichere Scan-Limit");
  }
  return logs;
}

async function readRouterQuorumBlock(blockTag) {
  const blocks = await routerQuorumRequest("eth_getBlockByNumber", [
    blockTag,
    false,
  ]);
  return exactRouterFinalizedCheckpoint(
    blocks,
    LAUNCH_STAMP_ROUTER.startBlock,
  );
}

async function readRouterFinalizedBoundary() {
  const blocks = await routerQuorumRequest("eth_getBlockByNumber", [
    LAUNCH_STAMP_ROUTER.finalizedTag,
    false,
  ]);
  return routerFinalizedBoundary(
    blocks,
    LAUNCH_STAMP_ROUTER.startBlock,
    LAUNCH_STAMP_ROUTER.maximumFinalizedSpread,
  );
}

async function verifyLaunchStampInfrastructure(blockTag) {
  const [
    routerCode,
    chainIdWord,
    permitAuthorityWord,
    permitAuthorityRuntimeWord,
    graphFactoryWord,
    graphFactoryRuntimeWord,
    poolManagerWord,
    poolManagerRuntimeWord,
  ] = await Promise.all([
    request("eth_getCode", [LAUNCH_STAMP_ROUTER.address, blockTag]),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.permitAuthority,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.permitAuthorityRuntimeCodeHash,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.graphFactory,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.graphFactoryRuntimeCodeHash,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.poolManager,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.poolManagerRuntimeCodeHash,
      blockTag,
    ),
  ]);
  const permitAuthority = decodeAddress(permitAuthorityWord);
  const graphFactory = decodeAddress(graphFactoryWord);
  const poolManager = decodeAddress(poolManagerWord);
  if (
    keccak256Hex(routerCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.runtimeCodeHash ||
    decodeUint256(chainIdWord) !== 1n ||
    permitAuthority.toLowerCase() !==
      LAUNCH_STAMP_ROUTER.permitAuthority.address.toLowerCase() ||
    decodeBytes32(permitAuthorityRuntimeWord) !==
      LAUNCH_STAMP_ROUTER.permitAuthority.runtimeCodeHash ||
    graphFactory.toLowerCase() !==
      LAUNCH_STAMP_ROUTER.graphFactory.address.toLowerCase() ||
    decodeBytes32(graphFactoryRuntimeWord) !==
      LAUNCH_STAMP_ROUTER.graphFactory.runtimeCodeHash ||
    poolManager.toLowerCase() !==
      LAUNCH_STAMP_ROUTER.poolManager.address.toLowerCase() ||
    decodeBytes32(poolManagerRuntimeWord) !==
      LAUNCH_STAMP_ROUTER.poolManager.runtimeCodeHash
  )
    throw new Error("Launch-Stamp-Router-Bindung stimmt nicht");

  const [permitCode, graphCode, poolManagerCode] = await Promise.all([
    request("eth_getCode", [permitAuthority, blockTag]),
    request("eth_getCode", [graphFactory, blockTag]),
    request("eth_getCode", [poolManager, blockTag]),
  ]);
  if (
    keccak256Hex(permitCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.permitAuthority.runtimeCodeHash ||
    keccak256Hex(graphCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.graphFactory.runtimeCodeHash ||
    keccak256Hex(poolManagerCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.poolManager.runtimeCodeHash
  )
    throw new Error("Launch-Stamp-Infrastruktur-Runtime stimmt nicht");
}

function routerProfileBindingMatches(launch, profile) {
  return profile.bindings.some(
    ({ launchId, source, runtimeCodeHash }) =>
      launch.launchId === launchId &&
      launch.hook.toLowerCase() === source.toLowerCase() &&
      launch.runtimeCodeHash === runtimeCodeHash,
  );
}

async function tryRouterClaimProfile(
  launch,
  runtimeCode,
  profile,
  blockTag,
) {
  if (!routerProfileBindingMatches(launch, profile)) return null;
  try {
    const [recipientWord, feeWord, accruedWord] = await Promise.all([
      readContractWord(launch.hook, profile.recipient, blockTag),
      readContractWord(launch.hook, profile.feeBps, blockTag),
      readContractWord(launch.hook, profile.accrued, blockTag),
    ]);
    const amount = decodeUint256(accruedWord);
    if (
      !isTreasury(decodeAddress(recipientWord)) ||
      decodeUint256(feeWord) !== profile.expectedFeeBps
    )
      return null;
    if (amount > 0n) {
      const simulated = await readContractWord(
        launch.hook,
        profile.claim,
        blockTag,
        TREASURY,
      );
      if (decodeUint256(simulated) !== amount)
        throw new Error("Custom-Claim-Simulation stimmt nicht");
    }
    return {
      ...launch,
      id: `router-custom:${launch.launchId}`,
      name: "Custom · Router",
      detail: shortAddress(launch.token),
      unit: "ETH",
      decimals: 18,
      kind: "custom",
      origin: "launch-stamp-router",
      address: launch.hook,
      claimMode: "manual",
      claimProfile: profile.id,
      readData: profile.accrued,
      claimData: profile.claim,
      claimBindingVerified: true,
      recipientMatches: true,
      amount,
      status: "ready",
    };
  } catch {
    return null;
  }
}

async function readRouterCustomClaim(launch, runtimeCode, blockTag) {
  for (const profile of [
    ROUTER_CUSTOM_CLAIM_PROFILES.nativeAccumulatorV1,
    ROUTER_CUSTOM_CLAIM_PROFILES.protocolFeeSourceV1,
  ]) {
    const claim = await tryRouterClaimProfile(
      launch,
      runtimeCode,
      profile,
      blockTag,
    );
    if (claim) return claim;
  }

  const redeemer = ROUTER_CUSTOM_CLAIM_PROFILES.dualCurrencyRedeemerV1;
  try {
    if (!routerProfileBindingMatches(launch, redeemer))
      throw new Error("Kein freigegebenes Mehrwährungs-Claim-Profil");
    const [
      recipientWord,
      feePipsWord,
      poolManagerWord,
      currency0Word,
      currency1Word,
      poolIdWord,
      nativeAmountWord,
      tokenAmountWord,
    ] = await Promise.all([
      readContractWord(launch.hook, redeemer.recipient, blockTag),
      readContractWord(launch.hook, redeemer.feePips, blockTag),
      readContractWord(launch.hook, redeemer.poolManager, blockTag),
      readContractWord(launch.hook, redeemer.currency0, blockTag),
      readContractWord(launch.hook, redeemer.currency1, blockTag),
      readContractWord(launch.hook, redeemer.poolId, blockTag),
      readContractWord(
        LAUNCH_STAMP_ROUTER.poolManager.address,
        poolManagerBalanceOfData(
          redeemer.balanceOf,
          launch.hook,
          CUSTOM_V2_POLICY.nativeAsset,
        ),
        blockTag,
      ),
      readContractWord(
        LAUNCH_STAMP_ROUTER.poolManager.address,
        poolManagerBalanceOfData(
          redeemer.balanceOf,
          launch.hook,
          launch.token,
        ),
        blockTag,
      ),
    ]);
    if (
      !isTreasury(decodeAddress(recipientWord)) ||
      decodeUint256(feePipsWord) !== redeemer.expectedFeePips ||
      decodeAddress(poolManagerWord).toLowerCase() !==
        LAUNCH_STAMP_ROUTER.poolManager.address.toLowerCase() ||
      decodeAddress(currency0Word).toLowerCase() !==
        CUSTOM_V2_POLICY.nativeAsset.toLowerCase() ||
      decodeAddress(currency1Word).toLowerCase() !==
        launch.token.toLowerCase() ||
      decodeBytes32(poolIdWord) !== launch.poolId
    )
      throw new Error("Mehrwährungs-Claim-Bindung stimmt nicht");
    const amount = decodeUint256(nativeAmountWord);
    const secondaryAmount = decodeUint256(tokenAmountWord);
    if (amount > 0n || secondaryAmount > 0n) {
      const simulated = await request("eth_call", [
        { from: TREASURY, to: launch.hook, data: redeemer.claim },
        blockTag,
      ]);
      if (simulated !== "0x")
        throw new Error("Mehrwährungs-Claim-Simulation stimmt nicht");
    }
    return {
      ...launch,
      id: `router-custom:${launch.launchId}`,
      name: "Custom · Router",
      detail: shortAddress(launch.token),
      unit: "ETH",
      decimals: 18,
      secondaryAsset: launch.token,
      secondaryUnit: redeemer.secondaryUnit,
      secondaryDecimals: redeemer.secondaryDecimals,
      kind: "custom",
      origin: "launch-stamp-router",
      address: launch.hook,
      claimMode: "manual",
      claimProfile: redeemer.id,
      claimData: redeemer.claim,
      claimBindingVerified: true,
      recipientMatches: true,
      amount,
      secondaryAmount,
      status: "ready",
    };
  } catch {
    // Continue to the explicit unsupported disposition below.
  }

  return {
    ...launch,
    id: `router-custom:${launch.launchId}`,
    name: "Custom · Router",
    detail: shortAddress(launch.token),
    unit: "ETH",
    decimals: 18,
    kind: "custom",
    origin: "launch-stamp-router",
    address: launch.hook,
    claimMode: "unsupported",
    claimProfile: null,
    claimBindingVerified: false,
    recipientMatches: false,
    amount: 0n,
    status: "failed",
  };
}

async function readVerifiedRouterLaunch(candidate, finalizedTag) {
  const [recordValue, tokenLaunchIdWord, poolLaunchIdWord, tokenProofValue] =
    await Promise.all([
    request("eth_call", [
      {
        to: LAUNCH_STAMP_ROUTER.address,
        data: launchStampBytes32ReadData(
          LAUNCH_STAMP_SELECTORS.launchStamp,
          candidate.launchId,
        ),
      },
      finalizedTag,
    ]),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      launchStampAddressReadData(
        LAUNCH_STAMP_SELECTORS.launchIdByToken,
        candidate.token,
      ),
      finalizedTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      launchStampPoolReadData(
        LAUNCH_STAMP_SELECTORS.launchIdByPool,
        candidate.poolManager,
        candidate.poolId,
      ),
      finalizedTag,
    ),
    request("eth_call", [
      {
        to: LAUNCH_STAMP_ROUTER.address,
        data: launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.stampProof,
          candidate.token,
        ),
      },
      finalizedTag,
    ]),
  ]);
  const record = decodeLaunchStampRecord(recordValue);
  const tokenProof = decodeLaunchStampProof(tokenProofValue);
  if (
    decodeBytes32(tokenLaunchIdWord) !== candidate.launchId ||
    decodeBytes32(poolLaunchIdWord) !== candidate.launchId ||
    tokenProof.launchId !== candidate.launchId ||
    tokenProof.stampHash !== candidate.stampHash ||
    record.token.toLowerCase() !== candidate.token.toLowerCase() ||
    record.hook.toLowerCase() !== candidate.hook.toLowerCase() ||
    record.poolManager.toLowerCase() !== candidate.poolManager.toLowerCase() ||
    record.poolId !== candidate.poolId ||
    record.stampHash !== candidate.stampHash
  )
    throw new Error("Launch-Stamp-Record stimmt nicht mit dem Event überein");

  const routeCode = await request("eth_getCode", [
    record.routeLauncher,
    finalizedTag,
  ]);
  if (
    keccak256Hex(routeCode).toLowerCase() !==
    record.routeLauncherRuntimeCodeHash
  )
    throw new Error("Launch-Route-Runtime ist gedriftet");

  const verified = {
    ...candidate,
    ...record,
    launchKind: record.kind,
    provenanceVerified: true,
    runtimeVerified: true,
  };
  if (record.kind === 2) {
    const knownHook = HOOKS.find(
      ({ address }) => address.toLowerCase() === record.hook.toLowerCase(),
    );
    return {
      ...verified,
      claimMode: knownHook ? "covered-by-known-hook" : "unsupported",
      claimProfile: knownHook?.id ?? null,
      claimBindingVerified: Boolean(knownHook),
      amount: 0n,
    };
  }

  const [hookLaunchIdWord, hookProofValue, recordedRuntimeWord, hookCode] =
    await Promise.all([
      readContractWord(
        LAUNCH_STAMP_ROUTER.address,
        launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.launchIdByComponent,
          record.hook,
        ),
        finalizedTag,
      ),
      request("eth_call", [
        {
          to: LAUNCH_STAMP_ROUTER.address,
          data: launchStampAddressReadData(
            LAUNCH_STAMP_SELECTORS.stampProof,
            record.hook,
          ),
        },
        finalizedTag,
      ]),
      readContractWord(
        LAUNCH_STAMP_ROUTER.address,
        launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.componentRuntimeCodeHash,
          record.hook,
        ),
        finalizedTag,
      ),
      request("eth_getCode", [record.hook, finalizedTag]),
    ]);
  const hookProof = decodeLaunchStampProof(hookProofValue);
  const recordedRuntime = decodeBytes32(recordedRuntimeWord);
  if (
    decodeBytes32(hookLaunchIdWord) !== candidate.launchId ||
    hookProof.launchId !== candidate.launchId ||
    hookProof.stampHash !== candidate.stampHash ||
    /^0x0{64}$/i.test(recordedRuntime) ||
    keccak256Hex(hookCode).toLowerCase() !== recordedRuntime
  )
    throw new Error("Custom-Hook-Stamp oder Runtime stimmt nicht");

  return readRouterCustomClaim(
    { ...verified, runtimeCodeHash: recordedRuntime },
    hookCode,
    finalizedTag,
  );
}

async function readLaunchStampRouter() {
  for (const key of state.claims.keys()) {
    if (key.startsWith("router-custom:")) state.claims.delete(key);
  }
  state.router = {
    status: "loading",
    verified: false,
    finalizedBlock: null,
    launches: [],
    error: null,
  };
  renderSummary();
  try {
    const finalizedBlock = await readRouterFinalizedBoundary();
    const finalizedTag = toQuantityHex(finalizedBlock);
    const openingBlock = await readRouterQuorumBlock(finalizedTag);
    await verifyLaunchStampInfrastructure(finalizedTag);
    const candidates = reduceLaunchStampLogs(
      await readLaunchStampLogs(finalizedBlock),
    );
    const launches = await mapWithConcurrency(candidates, 8, (candidate) =>
      readVerifiedRouterLaunch(candidate, finalizedTag),
    );
    const closingBlock = await readRouterQuorumBlock(finalizedTag);
    if (
      closingBlock.number !== openingBlock.number ||
      closingBlock.hash !== openingBlock.hash
    )
      throw new Error("Finalisierter Router-Block hat sich während des Scans geändert");
    for (const launch of launches) {
      if (launch.launchKind !== 1 || launch.claimMode !== "manual") continue;
      state.claims.set(launch.id, {
        amount: launch.amount,
        secondaryAmount: launch.secondaryAmount,
        recipientMatches: launch.recipientMatches,
        status: launch.status,
      });
    }
    state.router = {
      status: "ready",
      verified: true,
      finalizedBlock,
      launches,
      error: null,
    };
  } catch (error) {
    state.router = {
      status: "failed",
      verified: false,
      finalizedBlock: null,
      launches: [],
      error:
        error instanceof Error
          ? error.message
          : "Launch-Stamp-Router konnte nicht gelesen werden",
    };
  }
}

async function readCustomLaunch(launch, blockTag) {
  const [runtimeCode, launchStateWord] = await Promise.all([
    request("eth_getCode", [launch.primaryContract, blockTag]),
    request("eth_call", [
      {
        to: CUSTOM_REGISTRY.address,
        data: customLaunchStateData(launch.launchId),
      },
      blockTag,
    ]),
  ]);
  const current = decodeCustomLaunchState(launchStateWord);
  const base = {
    ...launch,
    currentStatus: current.status,
    stateVerified:
      current.feePolicyHash === launch.feePolicy?.feePolicyHash &&
      ((current.status === 2 && launch.finalized && !launch.revoked) ||
        (current.status === 3 && launch.revoked) ||
        (current.status === 1 && !launch.finalized && !launch.revoked)),
    runtimeVerified:
      typeof launch.primaryRuntimeCodeHash === "string" &&
      keccak256Hex(runtimeCode).toLowerCase() ===
        launch.primaryRuntimeCodeHash.toLowerCase(),
  };
  if (
    customLaunchClassification(base) === "no-market" ||
    base.currentStatus !== 2 ||
    base.stateVerified !== true ||
    base.runtimeVerified !== true
  )
    return base;

  try {
    const [recipientWord, accruedWord, totalClaimedWord, feeBpsWord] =
      await Promise.all([
        readContractWord(
          launch.primaryContract,
          CUSTOM_V2_SELECTORS.programmableFeeRecipient,
          blockTag,
        ),
        readContractWord(
          launch.primaryContract,
          readAccruedData({ kind: "custom" }),
          blockTag,
        ),
        readContractWord(
          launch.primaryContract,
          `${CUSTOM_V2_SELECTORS.totalProgrammableFeesClaimed}${"0".repeat(64)}`,
          blockTag,
        ),
        readContractWord(
          launch.primaryContract,
          `${CUSTOM_V2_SELECTORS.programmableFeeBps}${"0".repeat(64)}`,
          blockTag,
        ),
      ]);
    const amount = decodeUint256(accruedWord);
    const feeBps = decodeUint256(feeBpsWord);
    const standardClaimBindingVerified =
      isTreasury(decodeAddress(recipientWord)) &&
      isTreasury(launch.feePolicy.programmableRecipient) &&
      feeBps === BigInt(launch.feePolicy.programmableShareBps);
    return {
      ...base,
      id: `custom-v1-standard:${launch.launchId}`,
      hookId: "custom-v1-standard",
      name: `Custom Launch ${launch.registrationSequence.toString()}`,
      detail: shortAddress(launch.primaryContract),
      unit: "ETH",
      decimals: 18,
      kind: "custom",
      address: launch.primaryContract,
      asset: CUSTOM_V2_POLICY.nativeAsset,
      bindingVerified: standardClaimBindingVerified,
      standardClaimBindingVerified,
      registered: true,
      quarantined: false,
      executable: true,
      recipient: decodeAddress(recipientWord),
      recipientMatches: standardClaimBindingVerified,
      amount,
      totalClaimed: decodeUint256(totalClaimedWord),
      programmableFeeBps: feeBps,
      status: "ready",
    };
  } catch {
    return { ...base, standardClaimBindingVerified: false };
  }
}

async function readCustomRegistry(blockTag) {
  void blockTag;
  for (const key of state.claims.keys()) {
    if (key.startsWith("custom-v1-standard:")) state.claims.delete(key);
  }
  state.custom = {
    status: "retired",
    registryVerified: true,
    launches: [],
    error: null,
  };
  renderSummary();
}

async function readContractWord(address, data, blockTag, from = null) {
  const call = { to: address, data };
  if (from) call.from = from;
  const value = await request("eth_call", [call, blockTag]);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`Ungültige Contract-Antwort von ${shortAddress(address)}`);
  return value;
}

async function verifyCustomV2Infrastructure(release, blockTag) {
  if (release.startBlock > BigInt(blockTag))
    throw new Error("Custom-V2-Deployment-Block liegt in der Zukunft");
  const contractEntries = Object.values(release.contracts);
  const runtimeResults = await Promise.all(
    contractEntries.map(async (contract) => ({
      contract,
      actual: keccak256Hex(
        await request("eth_getCode", [contract.address, blockTag]),
      ).toLowerCase(),
    })),
  );
  if (
    runtimeResults.some(
      ({ contract, actual }) =>
        actual !== contract.runtimeCodeHash.toLowerCase(),
    )
  )
    throw new Error("Custom-V2-Contract-Runtime stimmt nicht");

  const { sourceRegistry, customRegistryV2, customRegistrar, launchStampRouter } =
    release.contracts;
  const [
    registrarChain,
    registrarSourceRegistry,
    registrarCustomRegistry,
    registrarLaunchStampRouter,
    registryChain,
    registryGeneration,
    registryFinality,
    registrySourceRegistry,
    launchStampChain,
    sourceChain,
    sourceDelay,
    sourceRewardWallet,
    sourceClaimSelector,
    sourceInterfaceId,
  ] = await Promise.all([
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.supportedChainId,
      blockTag,
    ),
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.sourceRegistry,
      blockTag,
    ),
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.customRegistryV2,
      blockTag,
    ),
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.launchStampRouter,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.registryGeneration,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.minimumFinalityBlocks,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.sourceRegistry,
      blockTag,
    ),
    readContractWord(
      launchStampRouter.address,
      CUSTOM_V2_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.minimumActivationDelayBlocks,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.rewardWallet,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.claimSelector,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.sourceInterfaceId,
      blockTag,
    ),
  ]);

  if (
    decodeUint256(registrarChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeAddress(registrarSourceRegistry).toLowerCase() !==
      sourceRegistry.address.toLowerCase() ||
    decodeAddress(registrarCustomRegistry).toLowerCase() !==
      customRegistryV2.address.toLowerCase() ||
    decodeAddress(registrarLaunchStampRouter).toLowerCase() !==
      launchStampRouter.address.toLowerCase() ||
    decodeUint256(registryChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeUint256(registryGeneration) <
      CUSTOM_V2_POLICY.minimumRegistryGeneration ||
    decodeUint256(registryFinality) < CUSTOM_V2_POLICY.minimumFinalityBlocks ||
    decodeAddress(registrySourceRegistry).toLowerCase() !==
      sourceRegistry.address.toLowerCase() ||
    decodeUint256(launchStampChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeUint256(sourceChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeUint256(sourceDelay) < CUSTOM_V2_POLICY.minimumFinalityBlocks ||
    !isTreasury(decodeAddress(sourceRewardWallet)) ||
    decodeBytes4(sourceClaimSelector) !== CUSTOM_V2_POLICY.claimSelector ||
    decodeBytes4(sourceInterfaceId) !== CUSTOM_V2_POLICY.sourceInterfaceId
  )
    throw new Error("Custom-V2-Infrastruktur-Bindung stimmt nicht");
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await mapper(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

async function readCustomV2Source(release, indexed, blockTag) {
  const sourceRegistry = release.contracts.sourceRegistry.address;
  const registrar = release.contracts.customRegistrar.address;
  const stateWord = await request("eth_call", [
    {
      to: sourceRegistry,
      data: customV2Bytes32ReadData(
        CUSTOM_V2_SELECTORS.sourceState,
        indexed.sourceId,
      ),
    },
    blockTag,
  ]);
  const source = decodeCustomV2SourceState(stateWord);
  const [
    executableWord,
    indexedLaunchWord,
    runtimeCode,
    recipientWord,
    accruedWord,
    totalClaimedWord,
    feeBpsWord,
  ] = await Promise.all([
    readContractWord(
      registrar,
      customV2Bytes32ReadData(
        CUSTOM_V2_SELECTORS.isFinalizedExecutable,
        indexed.launchId,
      ),
      blockTag,
    ),
    readContractWord(
      registrar,
      customV2Bytes32ReadData(
        CUSTOM_V2_SELECTORS.launchIdForSource,
        indexed.sourceId,
      ),
      blockTag,
    ),
    request("eth_getCode", [source.source, blockTag]),
    readContractWord(
      source.source,
      CUSTOM_V2_SELECTORS.programmableFeeRecipient,
      blockTag,
    ),
    readContractWord(source.source, readAccruedData({ kind: "custom" }), blockTag),
    readContractWord(
      source.source,
      `${CUSTOM_V2_SELECTORS.totalProgrammableFeesClaimed}${"0".repeat(64)}`,
      blockTag,
    ),
    readContractWord(
      source.source,
      `${CUSTOM_V2_SELECTORS.programmableFeeBps}${"0".repeat(64)}`,
      blockTag,
    ),
  ]);

  const executable = decodeBool(executableWord);
  const amount = decodeUint256(accruedWord);
  const bindingVerified =
    source.sourceId === indexed.sourceId &&
    decodeBytes32(indexedLaunchWord) === indexed.launchId &&
    source.registered &&
    source.asset.toLowerCase() === CUSTOM_V2_POLICY.nativeAsset &&
    source.claimSelector === CUSTOM_V2_POLICY.claimSelector &&
    isTreasury(source.recipient) &&
    source.activationBlock <= BigInt(blockTag) &&
    keccak256Hex(runtimeCode).toLowerCase() === source.runtimeCodeHash &&
    isTreasury(decodeAddress(recipientWord)) &&
    decodeUint256(feeBpsWord) === CUSTOM_V2_POLICY.programmableFeeBps;

  return Object.freeze({
    id: `custom-v2:${indexed.sourceId}`,
    hookId: "custom-v2",
    index: indexed.index,
    launchId: indexed.launchId,
    sourceId: indexed.sourceId,
    name: "Custom V2",
    detail: shortAddress(source.source),
    unit: "ETH",
    decimals: 18,
    kind: "custom",
    address: source.source,
    asset: CUSTOM_V2_POLICY.nativeAsset,
    runtimeCodeHash: source.runtimeCodeHash,
    activationBlock: source.activationBlock,
    registered: source.registered,
    quarantined: source.quarantined,
    executable,
    bindingVerified,
    amount,
    totalClaimed: decodeUint256(totalClaimedWord),
    recipientMatches: bindingVerified,
    status: bindingVerified ? "ready" : "failed",
  });
}

async function readCustomV2(blockTag) {
  for (const key of state.claims.keys()) {
    if (key.startsWith("custom-v2:")) state.claims.delete(key);
  }
  state.customV2 = {
    status: "loading",
    release: null,
    sources: [],
    error: null,
  };
  renderSummary();
  try {
    const response = await fetch(
      `${CUSTOM_V2_RELEASE_PATH}?block=${BigInt(blockTag).toString()}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("Custom-V2-Release-Datei fehlt");
    const release = parseCustomV2Release(await response.json());
    if (!release.active) {
      state.customV2 = {
        status: "hold",
        release,
        sources: [],
        error: null,
      };
      return;
    }

    await verifyCustomV2Infrastructure(release, blockTag);
    const count = decodeUint256(
      await readContractWord(
        release.contracts.customRegistrar.address,
        CUSTOM_V2_SELECTORS.finalizedSourceCount,
        blockTag,
      ),
    );
    if (count > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Custom-V2-Source-Liste ist zu groß");
    const indices = Array.from({ length: Number(count) }, (_, index) => index);
    const indexed = await mapWithConcurrency(indices, 24, async (index) => {
      const [sourceIdWord, launchIdWord] = await Promise.all([
        readContractWord(
          release.contracts.customRegistrar.address,
          customV2IndexedReadData(
            CUSTOM_V2_SELECTORS.finalizedSourceIdAt,
            BigInt(index),
          ),
          blockTag,
        ),
        readContractWord(
          release.contracts.customRegistrar.address,
          customV2IndexedReadData(
            CUSTOM_V2_SELECTORS.finalizedLaunchIdAt,
            BigInt(index),
          ),
          blockTag,
        ),
      ]);
      return {
        index,
        sourceId: decodeBytes32(sourceIdWord),
        launchId: decodeBytes32(launchIdWord),
      };
    });
    if (
      new Set(indexed.map(({ sourceId }) => sourceId)).size !== indexed.length ||
      new Set(indexed.map(({ launchId }) => launchId)).size !== indexed.length
    )
      throw new Error("Custom-V2-Registrar enthält doppelte Einträge");
    const sources = await mapWithConcurrency(indexed, 12, (entry) =>
      readCustomV2Source(release, entry, blockTag),
    );
    for (const source of sources)
      state.claims.set(source.id, {
        amount: source.amount,
        recipientMatches: source.recipientMatches,
        status: source.status,
      });
    state.customV2 = {
      status: "ready",
      release,
      sources,
      error: null,
    };
  } catch (error) {
    state.customV2 = {
      status: "failed",
      release: null,
      sources: [],
      error:
        error instanceof Error
          ? error.message
          : "Custom V2 konnte nicht gelesen werden",
    };
  }
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

async function refreshClaimsOnce() {
  if (!state.account || state.chainId !== MAINNET_CHAIN_ID) return;
  setError();
  setStatus("Contract-Bindungen und Guthaben werden geprüft");
  const blockTag = await request("eth_blockNumber");
  state.blockTag = blockTag;

  await Promise.all([
    readCustomRegistry(blockTag),
    readCustomV2(blockTag),
    readClassicLaunches(blockTag),
    readLaunchStampRouter(),
  ]);

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
  const errors = [];
  if (verified !== HOOKS.length)
    errors.push(
      "Mindestens eine Contract-Bindung stimmt nicht. Claims bleiben gesperrt.",
    );
  if (state.custom.error)
    errors.push(
      "Die Custom Registry konnte nicht vollständig verifiziert werden. Claims bleiben gesperrt.",
    );
  if (state.customV2.error)
    errors.push(
      "Das aktive Custom-V2-Release konnte nicht vollständig verifiziert werden. Claims bleiben gesperrt.",
    );
  if (state.classic.error)
    errors.push(
      "Die Classic-Launchliste konnte nicht vollständig gelesen werden. Der verifizierte gemeinsame Hook-Claim bleibt verfügbar.",
    );
  if (state.router.error)
    errors.push(
      "Der offizielle Launch-Stamp-Router konnte nicht vollständig verifiziert werden. Alle Claims bleiben gesperrt.",
    );
  setError(errors.join(" "));
  setStatus(
    state.custom.error || state.customV2.error || state.router.error
      ? "Ecosystem-Scan konnte nicht vollständig gelesen werden"
      : failedClaims === 0
        ? `Stand Block ${BigInt(blockTag).toString()} · ${state.classic.launches.length + state.router.launches.filter(({ launchKind }) => launchKind === 2).length} Classic · ${state.custom.launches.length + state.customV2.sources.length + state.router.launches.filter(({ launchKind }) => launchKind === 1).length} Custom`
        : `${failedClaims} Guthaben konnten nicht gelesen werden`,
  );
  renderSummary();
}

const refreshClaims = createRefreshQueue(refreshClaimsOnce);

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
  await refreshClaims();
}

async function switchToMainnet() {
  await request("wallet_switchEthereumChain", [{ chainId: MAINNET_CHAIN_ID }]);
  state.chainId = await request("eth_chainId");
  renderSummary();
  await refreshClaims();
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

async function preflightClaimBatch(claims) {
  if (claims.length > MAX_BATCH_CALLS)
    throw new Error(
      `Mehr als ${MAX_BATCH_CALLS} offene Claims passen nicht sicher in einen atomaren Batch`,
    );
  const batch = buildWalletSendCalls(state.account, claims);
  await Promise.all(
    batch.calls.map(({ to, data, value }) =>
      request("eth_call", [
        { from: state.account, to, data, value },
        "latest",
      ]),
    ),
  );
  return batch;
}

async function claimAll() {
  const expectedAccount = state.account?.toLowerCase();
  if (
    state.chainId !== MAINNET_CHAIN_ID ||
    !expectedAccount ||
    !isTreasury(expectedAccount)
  )
    throw new Error("Treasury-Wallet auf Ethereum Mainnet erforderlich");
  await refreshClaims();
  if (
    state.chainId !== MAINNET_CHAIN_ID ||
    state.account?.toLowerCase() !== expectedAccount ||
    !isTreasury(state.account)
  )
    throw new Error(
      "Wallet oder Netzwerk hat sich während des Scans geändert. Bitte erneut scannen.",
    );
  const safetyError = claimSafetyError();
  if (safetyError) throw new Error(`${safetyError}. Claims bleiben gesperrt.`);
  const claims = claimableClaims();
  if (claims.length === 0) return;
  requireAtomicClaimCapability(state.capability);
  state.busy = true;
  setError();
  renderSummary();

  try {
    setStatus(
      `${claims.length} Claims werden direkt vor MetaMask erneut simuliert`,
    );
    const batch = await preflightClaimBatch(claims);
    setStatus(
      `${claims.length} Claims werden in einer MetaMask-Bestätigung vorbereitet`,
    );
    const result = await request("wallet_sendCalls", [
      batch,
    ]);
    await waitForBatch(normalizeBatchId(result));
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
    if (DEMO_MODE) {
      setStatus(
        "QA-Vorschau: In der echten Ansicht öffnet dieser Button genau eine MetaMask-Bestätigung",
      );
      return;
    }
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
  if (DEMO_MODE) {
    setStatus("QA-Vorschau wurde neu geladen · keine Wallet-Aktion");
    return;
  }
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

function seedDemoState() {
  state.account = TREASURY;
  state.chainId = MAINNET_CHAIN_ID;
  state.blockTag = "0x189f510";
  state.capability = "ready";
  for (const hook of HOOKS) {
    state.hooks.set(hook.id, {
      actualCodeHash: hook.runtimeCodeHash,
      recipient: TREASURY,
      verified: true,
    });
  }
  const demoAmounts = new Map([
    ["classic-v3", 3_831_314_566_506_772n],
    ["classic-v2", 227_307_871_565_013_620n],
    ["classic-v1", 46_446_511_178_969n],
    ["stock-current-nvdaon", 84_200_000_000_000_000n],
  ]);
  for (const claim of CLAIMS) {
    state.claims.set(claim.id, {
      amount: demoAmounts.get(claim.id) ?? 0n,
      recipient: TREASURY,
      recipientMatches: true,
      status: "ready",
    });
  }
  state.custom = {
    status: "retired",
    registryVerified: true,
    launches: [],
    error: null,
  };
  state.customV2 = {
    status: "hold",
    release: null,
    sources: [],
    error: null,
  };
  state.classic = {
    status: "ready",
    launchersVerified: true,
    launches: [],
    error: null,
  };
  const fadeProfile = ROUTER_CUSTOM_CLAIM_PROFILES.nativeAccumulatorV1;
  const fadeBinding = fadeProfile.bindings[0];
  const fadeClaim = {
    id: `router-custom:${fadeBinding.launchId}`,
    launchId: fadeBinding.launchId,
    token: "0x69d278968abf120f878f2e1e016ab615d3686c19",
    hook: fadeBinding.source,
    runtimeCodeHash: fadeBinding.runtimeCodeHash,
    launchKind: 1,
    kind: "custom",
    origin: "launch-stamp-router",
    address: fadeBinding.source,
    unit: "ETH",
    decimals: 18,
    provenanceVerified: true,
    runtimeVerified: true,
    claimMode: "manual",
    claimProfile: fadeProfile.id,
    readData: fadeProfile.accrued,
    claimData: fadeProfile.claim,
    claimBindingVerified: true,
    recipientMatches: true,
    amount: 28_054_452_170_132_560n,
    status: "ready",
  };
  const pcanProfile = ROUTER_CUSTOM_CLAIM_PROFILES.dualCurrencyRedeemerV1;
  const pcanBinding = pcanProfile.bindings[0];
  const pcanClaim = {
    id: `router-custom:${pcanBinding.launchId}`,
    launchId: pcanBinding.launchId,
    token: "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce",
    hook: pcanBinding.source,
    runtimeCodeHash: pcanBinding.runtimeCodeHash,
    launchKind: 1,
    kind: "custom",
    origin: "launch-stamp-router",
    address: pcanBinding.source,
    unit: "ETH",
    decimals: 18,
    provenanceVerified: true,
    runtimeVerified: true,
    claimMode: "manual",
    claimProfile: pcanProfile.id,
    claimData: pcanProfile.claim,
    claimBindingVerified: true,
    recipientMatches: true,
    amount: 500_802_908_283_517n,
    secondaryAsset: "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce",
    secondaryAmount: 2_740_004_896_936_423_458_238n,
    secondaryUnit: pcanProfile.secondaryUnit,
    secondaryDecimals: pcanProfile.secondaryDecimals,
    status: "ready",
  };
  state.router = {
    status: "ready",
    verified: true,
    finalizedBlock: 25_827_076n,
    launches: [fadeClaim, pcanClaim],
    error: null,
  };
  state.claims.set(fadeClaim.id, {
    amount: fadeClaim.amount,
    recipientMatches: true,
    status: "ready",
  });
  state.claims.set(pcanClaim.id, {
    amount: pcanClaim.amount,
    secondaryAmount: pcanClaim.secondaryAmount,
    recipientMatches: true,
    status: "ready",
  });
  renderSummary();
  elements.status.textContent =
    "Sichere QA-Vorschau · Werte sind Testdaten · keine Wallet-Aktion";
}

if (DEMO_MODE) {
  seedDemoState();
} else {
  renderSummary();
  syncWallet().catch(() => {
    setStatus("MetaMask verbinden, um offene Fees zu lesen");
    renderSummary();
  });
}
