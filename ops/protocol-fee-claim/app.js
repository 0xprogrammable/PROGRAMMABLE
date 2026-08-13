import {
  CLASSIC_LAUNCHERS,
  CLAIMS,
  CUSTOM_EVENT_TOPICS,
  CUSTOM_REGISTRY,
  CUSTOM_V2_POLICY,
  CUSTOM_V2_RELEASE_PATH,
  CUSTOM_V2_SELECTORS,
  HOOKS,
  MAINNET_CHAIN_ID,
  SELECTORS,
  TOKEN_SELECTORS,
  TREASURY,
  atomicCapabilityStatus,
  buildWalletSendCalls,
  customClaimDefinitionClassification,
  customLaunchClassification,
  customLaunchStateData,
  customV2Bytes32ReadData,
  customV2IndexedReadData,
  customV2SourceClassification,
  decodeAbiString,
  decodeAddress,
  decodeBool,
  decodeBytes4,
  decodeBytes32,
  decodeCustomLaunchState,
  decodeCustomV2SourceState,
  decodeUint256,
  formatEth,
  formatUnits,
  isTreasury,
  keccak256Hex,
  normalizeBatchId,
  parseCustomV2Release,
  readAccruedData,
  reduceClassicLaunchLogs,
  reduceCustomRegistryLogs,
  requireAtomicClaimCapability,
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
  return provider().request({ method, params });
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
  if (claim.kind === "custom") return claim.bindingVerified === true;
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

function buildCustomGroup() {
  const group = document.createElement("li");
  group.className = "asset-group custom-group";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const identity = document.createElement("span");
  identity.className = "asset-group-identity";
  const name = document.createElement("strong");
  name.textContent = "Custom-v4-Gebühren";
  const detail = document.createElement("span");
  detail.textContent = "Automatisch aus der Mainnet Registry";
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
    state.customV2.status === "loading"
  ) {
    count.textContent = "Wird gelesen";
    hint.textContent = "Finalisierte Launches";
  } else if (state.custom.error) {
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
    const readyCount = readyV1Count + state.customV2.sources.filter(
      (source) => customV2SourceClassification(source) === "ready",
    ).length;
    count.textContent = `${state.custom.launches.length + sourceCount} erkannt`;
    if (state.customV2.error) hint.textContent = "V2-Release gesperrt";
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

  if (state.custom.launches.length > 0 || state.customV2.sources.length > 0) {
    const list = document.createElement("ul");
    list.className = "asset-list";
    list.replaceChildren(
      ...state.customV2.sources.map(buildCustomV2Row),
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
  row.dataset.state = "covered";

  const identity = document.createElement("div");
  identity.className = "claim-identity";
  const name = document.createElement("strong");
  name.textContent = launch.symbol || launch.name || "Classic Token";
  const detail = document.createElement("span");
  detail.textContent = `${launch.releaseName} · ${shortAddress(launch.token)}`;
  identity.append(name, detail);

  const value = document.createElement("div");
  value.className = "claim-value";
  const coverage = document.createElement("strong");
  coverage.textContent = "Enthalten";
  const status = document.createElement("span");
  status.textContent = `Im ${launch.releaseName}-Claim`;
  value.append(coverage, status);
  row.append(identity, value);
  return row;
}

function buildClassicLaunchGroup() {
  const group = document.createElement("li");
  group.className = "asset-group classic-launch-group";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const identity = document.createElement("span");
  identity.className = "asset-group-identity";
  const name = document.createElement("strong");
  name.textContent = "Classic Launches";
  const detail = document.createElement("span");
  detail.textContent = "Neue Coins automatisch aus den Launchern";
  identity.append(name, detail);

  const value = document.createElement("span");
  value.className = "asset-group-value";
  const count = document.createElement("strong");
  const hint = document.createElement("span");
  if (state.account === null) {
    count.textContent = "Onchain";
    hint.textContent = "Nach Verbindung";
  } else if (state.classic.status === "loading") {
    count.textContent = "Wird gelesen";
    hint.textContent = "V2 und V3";
  } else if (state.classic.error) {
    count.textContent = "Nicht verfügbar";
    hint.textContent = "Hook-Claim bleibt aktiv";
  } else {
    count.textContent = `${state.classic.launches.length} erkannt`;
    hint.textContent = "Alle über Classic-Hooks abgedeckt";
  }
  value.append(count, hint);
  summary.append(identity, value, disclosureIndicator());
  details.append(summary);

  if (state.classic.launches.length > 0) {
    const list = document.createElement("ul");
    list.className = "asset-list";
    list.replaceChildren(...state.classic.launches.map(buildClassicLaunchRow));
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
      current.amount > 0n
    );
  });
}

function claimSafetyError() {
  if (
    state.custom.status !== "ready" ||
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
  if (HOOKS.some(({ id }) => state.hooks.get(id)?.verified !== true))
    return "Mindestens eine Classic- oder Stock-Bindung stimmt nicht";
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
  const assetCount = claimable.filter(({ kind }) => kind === "asset").length;
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
      ? "Nicht verfügbar"
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
  } else if (verifiedHooks !== HOOKS.length) {
    elements.actionLabel.textContent = "Contract-Prüfung fehlgeschlagen";
    elements.actionDetail.textContent = `${verifiedHooks} von ${HOOKS.length} verifiziert`;
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
    elements.actionLabel.textContent = "Scannen & alles claimen";
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
    fromBlock += 4_000n
  ) {
    const toBlock = fromBlock + 3_999n < latest ? fromBlock + 3_999n : latest;
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
    fromBlock += 4_000n
  ) {
    const toBlock = fromBlock + 3_999n < latest ? fromBlock + 3_999n : latest;
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

async function readTokenText(token, selector, blockTag) {
  return decodeAbiString(
    await request("eth_call", [{ to: token, data: selector }, blockTag]),
  );
}

async function readClassicLaunchMetadata(launch, blockTag) {
  const [name, symbol] = await Promise.allSettled([
    readTokenText(launch.token, TOKEN_SELECTORS.name, blockTag),
    readTokenText(launch.token, TOKEN_SELECTORS.symbol, blockTag),
  ]);
  return {
    ...launch,
    name: name.status === "fulfilled" ? name.value : null,
    symbol: symbol.status === "fulfilled" ? symbol.value : null,
  };
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
    const hydrated = await Promise.all(
      launches.map((launch) => readClassicLaunchMetadata(launch, blockTag)),
    );
    state.classic = {
      status: "ready",
      launchersVerified: true,
      launches: hydrated,
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
  for (const key of state.claims.keys()) {
    if (key.startsWith("custom-v1-standard:")) state.claims.delete(key);
  }
  state.custom = {
    status: "loading",
    registryVerified: false,
    launches: [],
    error: null,
  };
  renderSummary();
  try {
    const [registryCode, registrationCountWord, logs] = await Promise.all([
      request("eth_getCode", [CUSTOM_REGISTRY.address, blockTag]),
      request("eth_call", [
        {
          to: CUSTOM_REGISTRY.address,
          data: SELECTORS.customRegistrationCount,
        },
        blockTag,
      ]),
      readCustomRegistryLogs(blockTag),
    ]);
    const registryVerified =
      keccak256Hex(registryCode).toLowerCase() ===
      CUSTOM_REGISTRY.runtimeCodeHash.toLowerCase();
    const launches = reduceCustomRegistryLogs(logs);
    const registrationCount = decodeUint256(registrationCountWord);
    const scopedLaunches = launches.every(
      ({ chainId, registryGeneration }) =>
        chainId === 1n && registryGeneration === 1n,
    );
    if (
      !registryVerified ||
      !scopedLaunches ||
      BigInt(launches.length) !== registrationCount
    )
      throw new Error("Custom Registry oder Event-Historie stimmt nicht");

    const verifiedLaunches = await Promise.all(
      launches.map((launch) => readCustomLaunch(launch, blockTag)),
    );
    for (const launch of verifiedLaunches) {
      if (launch.standardClaimBindingVerified !== true) continue;
      state.claims.set(launch.id, {
        amount: launch.amount,
        recipient: launch.recipient,
        recipientMatches: true,
        status: "ready",
      });
    }
    state.custom = {
      status: "ready",
      registryVerified: true,
      launches: verifiedLaunches,
      error: null,
    };
  } catch (error) {
    state.custom = {
      status: "failed",
      registryVerified: false,
      launches: [],
      error:
        error instanceof Error
          ? error.message
          : "Custom Registry konnte nicht gelesen werden",
    };
  }
}

async function readContractWord(address, data, blockTag) {
  const value = await request("eth_call", [{ to: address, data }, blockTag]);
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

async function refreshClaims() {
  if (!state.account || state.chainId !== MAINNET_CHAIN_ID) return;
  setError();
  setStatus("Contract-Bindungen und Guthaben werden geprüft");
  const blockTag = await request("eth_blockNumber");
  state.blockTag = blockTag;

  await Promise.all([
    readCustomRegistry(blockTag),
    readCustomV2(blockTag),
    readClassicLaunches(blockTag),
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
  setError(errors.join(" "));
  setStatus(
    state.custom.error || state.customV2.error
      ? "Custom Registry konnte nicht vollständig gelesen werden"
      : failedClaims === 0
        ? `Stand Block ${BigInt(blockTag).toString()} · ${state.classic.launches.length} Classic · ${state.custom.launches.length + state.customV2.sources.length} Custom`
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

async function claimAll() {
  await refreshClaims();
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
      `${claims.length} Claims werden in einer MetaMask-Bestätigung vorbereitet`,
    );
    const result = await request("wallet_sendCalls", [
      buildWalletSendCalls(state.account, claims),
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
