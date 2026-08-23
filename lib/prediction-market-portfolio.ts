import {
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";

import {
  createPredictionMarketPublicClients,
  predictionMarketFactoryEventAbi,
  type PredictionMarketPublicClient,
  type PredictionMarketReleaseConfig,
} from "./prediction-market-chain";
import { predictionMarketErrorMessage } from "./prediction-market-errors";
import {
  readPredictionMarketSnapshot,
  readPredictionMarketsAtSnapshot,
  type PredictionMarketBatchFailure,
  type PredictionMarketView,
} from "./prediction-market-trading";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const FACE_SCALE = 10n;
const LOG_BLOCK_SPAN = 50_000n;
const LOG_ADDRESS_BATCH_SIZE = 32;

const marketCreatedEvent = predictionMarketFactoryEventAbi[0];
const marketComponentsEvent = predictionMarketFactoryEventAbi[1];

const outcomeBoughtEvent = {
  type: "event",
  name: "OutcomeBought",
  anonymous: false,
  inputs: [
    { name: "user", type: "address", indexed: true },
    { name: "vault", type: "address", indexed: true },
    { name: "yes", type: "bool", indexed: true },
    { name: "collateralInAtoms", type: "uint256", indexed: false },
    { name: "collateralRefundAtoms", type: "uint256", indexed: false },
    { name: "outcomeAtoms", type: "uint256", indexed: false },
  ],
} as const;

const outcomeSoldEvent = {
  type: "event",
  name: "OutcomeSold",
  anonymous: false,
  inputs: [
    { name: "user", type: "address", indexed: true },
    { name: "vault", type: "address", indexed: true },
    { name: "yes", type: "bool", indexed: true },
    { name: "outcomeInAtoms", type: "uint256", indexed: false },
    { name: "collateralAtoms", type: "uint256", indexed: false },
    { name: "soldRefundAtoms", type: "uint256", indexed: false },
    { name: "complementRefundAtoms", type: "uint256", indexed: false },
  ],
} as const;

const outcomeTransferEvent = {
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;

const predictionRedeemedEvent = {
  type: "event",
  name: "Redeemed",
  anonymous: false,
  inputs: [
    { name: "holder", type: "address", indexed: true },
    { name: "recipient", type: "address", indexed: true },
    { name: "yesAtoms", type: "uint256", indexed: false },
    { name: "noAtoms", type: "uint256", indexed: false },
    { name: "collateralAtoms", type: "uint256", indexed: false },
  ],
} as const;

export type PredictionPortfolioRequest = Readonly<{
  account: Address;
  requestKey: string;
}>;

export type PredictionPortfolioLifecycle =
  | "open"
  | "trading_closed"
  | "final_yes"
  | "final_no"
  | "final_invalid";

export type PredictionPortfolioResult = "pending" | "won" | "lost" | "neutral";

export type PredictionPortfolioPosition = Readonly<{
  finalOutcome: "YES" | "NO" | "INVALID" | null;
  lifecycle: PredictionPortfolioLifecycle;
  market: PredictionMarketView;
  noAtoms: bigint;
  redeemableAtoms: bigint;
  result: PredictionPortfolioResult;
  tradingClosed: boolean;
  yesAtoms: bigint;
}>;

type PredictionPortfolioHistoryBase = Readonly<{
  blockNumber: bigint;
  logIndex: number;
  market: PredictionMarketView;
  semanticKey: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  vault: Address;
}>;

export type PredictionPortfolioCreatedMarket = Readonly<{
  blockNumber: bigint;
  logIndex: number;
  market: PredictionMarketView;
  transactionHash: Hex;
  transactionIndex: number;
}>;

export type PredictionPortfolioHistoryEntry =
  | Readonly<
      PredictionPortfolioHistoryBase & {
        creator: Address;
        kind: "created";
      }
    >
  | Readonly<
      PredictionPortfolioHistoryBase & {
        collateralInAtoms: bigint;
        collateralRefundAtoms: bigint;
        kind: "bought";
        outcome: "YES" | "NO";
        outcomeAtoms: bigint;
      }
    >
  | Readonly<
      PredictionPortfolioHistoryBase & {
        collateralAtoms: bigint;
        complementRefundAtoms: bigint;
        kind: "sold";
        outcome: "YES" | "NO";
        outcomeAtoms: bigint;
        soldRefundAtoms: bigint;
      }
    >
  | Readonly<
      PredictionPortfolioHistoryBase & {
        direction: "in" | "out" | "self";
        from: Address;
        kind: "transfer";
        outcome: "YES" | "NO";
        outcomeAtoms: bigint;
        to: Address;
      }
    >
  | Readonly<
      PredictionPortfolioHistoryBase & {
        collateralAtoms: bigint;
        kind: "redeemed";
        noAtoms: bigint;
        recipient: Address;
        yesAtoms: bigint;
      }
    >;

export type PredictionPortfolioMarketFailure = PredictionMarketBatchFailure;

export type PredictionMarketPortfolio = Readonly<{
  blockNumber: bigint;
  blockTimestamp: bigint;
  created: readonly PredictionPortfolioCreatedMarket[];
  failures: readonly PredictionPortfolioMarketFailure[];
  history: readonly PredictionPortfolioHistoryEntry[];
  positions: readonly PredictionPortfolioPosition[];
  relevantMarketCount: number;
  request: PredictionPortfolioRequest;
  scannedMarketCount: bigint;
}>;

export class PredictionPortfolioReadError extends Error {
  readonly request: PredictionPortfolioRequest;

  constructor(request: PredictionPortfolioRequest, error: unknown) {
    super(
      predictionMarketErrorMessage(
        error,
        "Prediction portfolio history is unavailable",
      ),
    );
    this.name = "PredictionPortfolioReadError";
    this.request = request;
  }
}

export function createPredictionPortfolioRequest(
  account: string,
  requestKey: string,
): PredictionPortfolioRequest {
  if (!isAddress(account) || account.toLowerCase() === ZERO_ADDRESS) {
    throw new Error("The portfolio wallet address is invalid");
  }
  const normalizedKey = requestKey.trim();
  if (!normalizedKey || normalizedKey.length > 128) {
    throw new Error("The portfolio request key is invalid");
  }
  return { account: getAddress(account), requestKey: normalizedKey };
}

type PredictionPortfolioRequestCarrier =
  | PredictionPortfolioRequest
  | Readonly<{ request: PredictionPortfolioRequest }>;

export function isPredictionPortfolioRequestCurrent(
  candidate: PredictionPortfolioRequestCarrier,
  current: PredictionPortfolioRequest | null | undefined,
) {
  if (!current) return false;
  const request = "request" in candidate ? candidate.request : candidate;
  return (
    request.account.toLowerCase() === current.account.toLowerCase() &&
    request.requestKey === current.requestKey
  );
}

export function derivePredictionPortfolioPosition(
  market: PredictionMarketView,
): PredictionPortfolioPosition {
  const yesAtoms = market.yesBalanceAtoms;
  const noAtoms = market.noBalanceAtoms;
  if (yesAtoms < 0n || noAtoms < 0n || (yesAtoms === 0n && noAtoms === 0n)) {
    throw new Error("A prediction portfolio position needs a positive outcome balance");
  }

  if (market.state === "FINAL_YES") {
    return {
      finalOutcome: "YES",
      lifecycle: "final_yes",
      market,
      noAtoms,
      redeemableAtoms: yesAtoms * FACE_SCALE,
      result: yesAtoms > 0n ? "won" : "lost",
      tradingClosed: true,
      yesAtoms,
    };
  }
  if (market.state === "FINAL_NO") {
    return {
      finalOutcome: "NO",
      lifecycle: "final_no",
      market,
      noAtoms,
      redeemableAtoms: noAtoms * FACE_SCALE,
      result: noAtoms > 0n ? "won" : "lost",
      tradingClosed: true,
      yesAtoms,
    };
  }
  if (market.state === "FINAL_INVALID") {
    return {
      finalOutcome: "INVALID",
      lifecycle: "final_invalid",
      market,
      noAtoms,
      redeemableAtoms: (yesAtoms + noAtoms) * FACE_SCALE / 2n,
      result: "neutral",
      tradingClosed: true,
      yesAtoms,
    };
  }

  const tradingClosed = market.blockTimestamp >= market.cutoff;
  return {
    finalOutcome: null,
    lifecycle: tradingClosed ? "trading_closed" : "open",
    market,
    noAtoms,
    redeemableAtoms: 0n,
    result: "pending",
    tradingClosed,
    yesAtoms,
  };
}

type PredictionMarketClients = ReturnType<
  typeof createPredictionMarketPublicClients
>;

type ConfirmedPortfolioLog = Readonly<{
  address: Address;
  blockHash: Hex;
  blockNumber: bigint;
  data: Hex;
  logIndex: number;
  removed: boolean;
  topics: readonly Hex[];
  transactionHash: Hex;
  transactionIndex: number;
}>;

type PredictionPortfolioBlockRange = Readonly<{
  fromBlock: bigint;
  toBlock: bigint;
}>;

function predictionPortfolioBlockRanges(
  fromBlock: bigint,
  toBlock: bigint,
  span = LOG_BLOCK_SPAN,
): readonly PredictionPortfolioBlockRange[] {
  if (fromBlock < 0n || toBlock < fromBlock || span <= 0n) {
    throw new Error("The prediction portfolio log range is invalid");
  }
  const ranges: PredictionPortfolioBlockRange[] = [];
  for (let start = fromBlock; start <= toBlock; start += span) {
    const end = start + span - 1n;
    ranges.push({
      fromBlock: start,
      toBlock: end < toBlock ? end : toBlock,
    });
  }
  return ranges;
}

function comparePortfolioLogs(
  left: ConfirmedPortfolioLog,
  right: ConfirmedPortfolioLog,
) {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber < right.blockNumber ? -1 : 1;
  }
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex - right.transactionIndex;
  }
  return left.logIndex - right.logIndex;
}

function normalizedPortfolioLog(log: ConfirmedPortfolioLog) {
  if (
    log.removed ||
    log.blockHash === null ||
    log.blockNumber === null ||
    log.transactionHash === null ||
    log.transactionIndex === null ||
    log.logIndex === null
  ) {
    throw new Error("A prediction portfolio RPC returned a pending or removed log");
  }
  return {
    address: log.address.toLowerCase(),
    blockHash: log.blockHash.toLowerCase(),
    blockNumber: log.blockNumber.toString(),
    data: log.data.toLowerCase(),
    logIndex: log.logIndex,
    topics: log.topics.map((topic) => topic.toLowerCase()),
    transactionHash: log.transactionHash.toLowerCase(),
    transactionIndex: log.transactionIndex,
  };
}

async function readPredictionPortfolioLogs<Log extends ConfirmedPortfolioLog>({
  clients,
  fromBlock,
  read,
  toBlock,
}: {
  clients: PredictionMarketClients;
  fromBlock: bigint;
  read: (
    client: PredictionMarketPublicClient,
    range: PredictionPortfolioBlockRange,
  ) => Promise<readonly Log[]>;
  toBlock: bigint;
}): Promise<readonly Log[]> {
  const logs: Log[] = [];
  for (const range of predictionPortfolioBlockRanges(fromBlock, toBlock)) {
    const byClient = await Promise.all(
      clients.map((client) => read(client, range)),
    );
    const normalized = byClient.map((providerLogs) =>
      [...providerLogs]
        .sort(comparePortfolioLogs)
        .map(normalizedPortfolioLog),
    );
    if (JSON.stringify(normalized[0]) !== JSON.stringify(normalized[1])) {
      throw new Error(
        "The two Robinhood RPCs disagree about prediction portfolio history",
      );
    }
    logs.push(...[...byClient[0]].sort(comparePortfolioLogs));
  }
  return logs;
}

function predictionPortfolioAddressBatches(
  addresses: readonly Address[],
): readonly Address[][] {
  const batches: Address[][] = [];
  for (let index = 0; index < addresses.length; index += LOG_ADDRESS_BATCH_SIZE) {
    batches.push(addresses.slice(index, index + LOG_ADDRESS_BATCH_SIZE));
  }
  return batches;
}

function portfolioLogKey(log: ConfirmedPortfolioLog) {
  return `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
}

function dedupePortfolioLogs<Log extends ConfirmedPortfolioLog>(
  logs: readonly Log[],
) {
  const deduped = new Map<string, Log>();
  for (const log of logs) deduped.set(portfolioLogKey(log), log);
  return [...deduped.values()].sort(comparePortfolioLogs);
}

function filterPredictionOutcomeLogs<Log extends ConfirmedPortfolioLog>(
  logs: readonly Log[],
  allowedTokens: ReadonlySet<string>,
) {
  return logs.filter((log) => allowedTokens.has(log.address.toLowerCase()));
}

type PredictionMarketComponent = Readonly<{
  checkpoint: Address;
  cutoff: bigint;
  noToken: Address;
  observationTime: bigint;
  poolId: Hex;
  semanticKey: Hex;
  thresholdAtoms: bigint;
  vault: Address;
  yesToken: Address;
}>;

type PredictionMarketTokenIdentity = Readonly<{
  component: PredictionMarketComponent;
  outcome: "YES" | "NO";
}>;

type PredictionMarketComponentIndex = Readonly<{
  bySemanticKey: ReadonlyMap<string, PredictionMarketComponent>;
  byToken: ReadonlyMap<string, PredictionMarketTokenIdentity>;
  byVault: ReadonlyMap<string, PredictionMarketComponent>;
  failures: readonly PredictionPortfolioMarketFailure[];
}>;

function componentIdentity(component: PredictionMarketComponent) {
  return JSON.stringify(component, (_, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

function indexPredictionMarketComponents(
  components: readonly PredictionMarketComponent[],
): PredictionMarketComponentIndex {
  const bySemanticKey = new Map<string, PredictionMarketComponent>();
  const invalidKeys = new Set<string>();
  const reasons = new Map<string, string>();
  for (const component of components) {
    const key = component.semanticKey.toLowerCase();
    if (
      component.semanticKey.toLowerCase() === ZERO_BYTES32 ||
      component.poolId.toLowerCase() === ZERO_BYTES32 ||
      component.vault.toLowerCase() === ZERO_ADDRESS ||
      component.checkpoint.toLowerCase() === ZERO_ADDRESS ||
      component.yesToken.toLowerCase() === ZERO_ADDRESS ||
      component.noToken.toLowerCase() === ZERO_ADDRESS ||
      component.yesToken.toLowerCase() === component.noToken.toLowerCase() ||
      component.vault.toLowerCase() === component.yesToken.toLowerCase() ||
      component.vault.toLowerCase() === component.noToken.toLowerCase() ||
      component.cutoff <= 0n ||
      component.observationTime <= component.cutoff ||
      component.thresholdAtoms <= 0n
    ) {
      invalidKeys.add(key);
      reasons.set(key, "The market component event has invalid addresses");
      continue;
    }
    const existing = bySemanticKey.get(key);
    if (existing && componentIdentity(existing) !== componentIdentity(component)) {
      invalidKeys.add(key);
      reasons.set(key, "The factory emitted conflicting market components");
      continue;
    }
    bySemanticKey.set(key, component);
  }

  const addressOwners = new Map<string, string>();
  for (const [key, component] of bySemanticKey) {
    for (const address of [component.vault, component.yesToken, component.noToken]) {
      const normalized = address.toLowerCase();
      const existing = addressOwners.get(normalized);
      if (existing && existing !== key) {
        invalidKeys.add(existing);
        invalidKeys.add(key);
        reasons.set(existing, "Two markets claim the same vault or outcome token");
        reasons.set(key, "Two markets claim the same vault or outcome token");
      } else {
        addressOwners.set(normalized, key);
      }
    }
  }

  const validBySemanticKey = new Map<string, PredictionMarketComponent>();
  const byVault = new Map<string, PredictionMarketComponent>();
  const byToken = new Map<string, PredictionMarketTokenIdentity>();
  for (const [key, component] of bySemanticKey) {
    if (invalidKeys.has(key)) continue;
    validBySemanticKey.set(key, component);
    byVault.set(component.vault.toLowerCase(), component);
    byToken.set(component.yesToken.toLowerCase(), {
      component,
      outcome: "YES",
    });
    byToken.set(component.noToken.toLowerCase(), {
      component,
      outcome: "NO",
    });
  }

  return {
    bySemanticKey: validBySemanticKey,
    byToken,
    byVault,
    failures: [...invalidKeys].map((semanticKey) => ({
      reason: reasons.get(semanticKey) ?? "The market components are invalid",
      semanticKey: semanticKey as Hex,
    })),
  };
}

async function readOutcomeTransferLogs({
  account,
  allowedTokens,
  clients,
  direction,
  fromBlock,
  toBlock,
}: {
  account: Address;
  allowedTokens: ReadonlySet<string>;
  clients: PredictionMarketClients;
  direction: "from" | "to";
  fromBlock: bigint;
  toBlock: bigint;
}) {
  if (direction === "from") {
    return readPredictionPortfolioLogs({
      clients,
      fromBlock,
      read: (client, range) =>
        client
          .getLogs({
            args: { from: account },
            event: outcomeTransferEvent,
            fromBlock: range.fromBlock,
            strict: true,
            toBlock: range.toBlock,
          })
          .then((logs) =>
            filterPredictionOutcomeLogs(logs, allowedTokens),
          ),
      toBlock,
    });
  }
  return readPredictionPortfolioLogs({
    clients,
    fromBlock,
    read: (client, range) =>
      client
        .getLogs({
          args: { to: account },
          event: outcomeTransferEvent,
          fromBlock: range.fromBlock,
          strict: true,
          toBlock: range.toBlock,
      })
      .then((logs) =>
        filterPredictionOutcomeLogs(logs, allowedTokens),
      ),
    toBlock,
  });
}

async function readPredictionRedeemedLogs({
  account,
  addresses,
  clients,
  fromBlock,
  toBlock,
}: {
  account: Address;
  addresses: readonly Address[];
  clients: PredictionMarketClients;
  fromBlock: bigint;
  toBlock: bigint;
}) {
  const logs = [];
  for (const addressBatch of predictionPortfolioAddressBatches(addresses)) {
    logs.push(
      ...(await readPredictionPortfolioLogs({
        clients,
        fromBlock,
        read: (client, range) =>
          client.getLogs({
            address: addressBatch,
            args: { holder: account },
            event: predictionRedeemedEvent,
            fromBlock: range.fromBlock,
            strict: true,
            toBlock: range.toBlock,
          }),
        toBlock,
      })),
    );
  }
  return dedupePortfolioLogs(logs);
}

type PortfolioActivityPosition = Readonly<{
  blockNumber: bigint;
  logIndex: number;
  transactionIndex: number;
}>;

function compareActivityPosition(
  left: PortfolioActivityPosition,
  right: PortfolioActivityPosition,
) {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber < right.blockNumber ? -1 : 1;
  }
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex - right.transactionIndex;
  }
  return left.logIndex - right.logIndex;
}

function historyBase(
  log: ConfirmedPortfolioLog,
  market: PredictionMarketView,
  vault = market.vault,
): PredictionPortfolioHistoryBase {
  return {
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    market,
    semanticKey: market.semanticKey,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex,
    vault,
  };
}

async function readPredictionMarketPortfolioAtRequest({
  clients,
  config,
  request,
}: {
  clients: PredictionMarketClients;
  config: PredictionMarketReleaseConfig;
  request: PredictionPortfolioRequest;
}): Promise<PredictionMarketPortfolio> {
  const snapshot = await readPredictionMarketSnapshot({ clients, config });
  const fromBlock = config.deploymentBlock;
  const toBlock = snapshot.blockNumber;
  const componentLogs = await readPredictionPortfolioLogs({
    clients,
    fromBlock,
    read: (client, range) =>
      client.getLogs({
        address: config.factoryAddress,
        event: marketComponentsEvent,
        fromBlock: range.fromBlock,
        strict: true,
        toBlock: range.toBlock,
      }),
    toBlock,
  });
  if (BigInt(componentLogs.length) !== snapshot.marketCount) {
    throw new Error(
      "The prediction factory market count does not match its component history",
    );
  }
  const componentIndex = indexPredictionMarketComponents(
    componentLogs.map((log) => ({
      checkpoint: getAddress(log.args.checkpoint),
      cutoff: BigInt(log.args.cutoff),
      noToken: getAddress(log.args.noToken),
      observationTime: BigInt(log.args.observationTime),
      poolId: log.args.poolId,
      semanticKey: log.args.semanticKey,
      thresholdAtoms: log.args.threshold,
      vault: getAddress(log.args.vault),
      yesToken: getAddress(log.args.yesToken),
    })),
  );
  const vaultAddresses = [...componentIndex.byVault.values()].map(
    (component) => component.vault,
  );
  const allowedTokens = new Set(componentIndex.byToken.keys());

  const [createdLogs, boughtLogs, soldLogs, incomingTransfers, outgoingTransfers, redeemedLogs] =
    await Promise.all([
      readPredictionPortfolioLogs({
        clients,
        fromBlock,
        read: (client, range) =>
          client.getLogs({
            address: config.factoryAddress,
            args: { creator: request.account },
            event: marketCreatedEvent,
            fromBlock: range.fromBlock,
            strict: true,
            toBlock: range.toBlock,
          }),
        toBlock,
      }),
      readPredictionPortfolioLogs({
        clients,
        fromBlock,
        read: (client, range) =>
          client.getLogs({
            address: snapshot.router,
            args: { user: request.account },
            event: outcomeBoughtEvent,
            fromBlock: range.fromBlock,
            strict: true,
            toBlock: range.toBlock,
          }),
        toBlock,
      }),
      readPredictionPortfolioLogs({
        clients,
        fromBlock,
        read: (client, range) =>
          client.getLogs({
            address: snapshot.router,
            args: { user: request.account },
            event: outcomeSoldEvent,
            fromBlock: range.fromBlock,
            strict: true,
            toBlock: range.toBlock,
          }),
        toBlock,
      }),
      readOutcomeTransferLogs({
        account: request.account,
        allowedTokens,
        clients,
        direction: "to",
        fromBlock,
        toBlock,
      }),
      readOutcomeTransferLogs({
        account: request.account,
        allowedTokens,
        clients,
        direction: "from",
        fromBlock,
        toBlock,
      }),
      readPredictionRedeemedLogs({
        account: request.account,
        addresses: vaultAddresses,
        clients,
        fromBlock,
        toBlock,
      }),
    ]);
  const transferLogs = dedupePortfolioLogs([
    ...incomingTransfers,
    ...outgoingTransfers,
  ]);

  const candidateActivity = new Map<string, PortfolioActivityPosition>();
  const noteCandidate = (semanticKey: Hex, log: ConfirmedPortfolioLog) => {
    const key = semanticKey.toLowerCase();
    const next = {
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      transactionIndex: log.transactionIndex,
    };
    const current = candidateActivity.get(key);
    if (!current || compareActivityPosition(current, next) < 0) {
      candidateActivity.set(key, next);
    }
  };
  for (const log of createdLogs) noteCandidate(log.args.semanticKey, log);
  for (const log of [...boughtLogs, ...soldLogs]) {
    const component = componentIndex.byVault.get(log.args.vault.toLowerCase());
    if (component) noteCandidate(component.semanticKey, log);
  }
  for (const log of transferLogs) {
    const token = componentIndex.byToken.get(log.address.toLowerCase());
    if (token) noteCandidate(token.component.semanticKey, log);
  }
  for (const log of redeemedLogs) {
    const component = componentIndex.byVault.get(log.address.toLowerCase());
    if (component) noteCandidate(component.semanticKey, log);
  }

  const semanticKeys = [...candidateActivity.entries()]
    .sort((left, right) => compareActivityPosition(right[1], left[1]))
    .map(([semanticKey]) => semanticKey as Hex);
  const canonical = semanticKeys.length > 0
    ? await readPredictionMarketsAtSnapshot({
        account: request.account,
        clients,
        config,
        semanticKeys,
        snapshot,
      })
    : { failures: [], markets: [], snapshot };
  const marketsByKey = new Map(
    canonical.markets.map((market) => [market.semanticKey.toLowerCase(), market]),
  );
  const failureByKey = new Map<string, PredictionPortfolioMarketFailure>();
  for (const failure of [...componentIndex.failures, ...canonical.failures]) {
    failureByKey.set(failure.semanticKey.toLowerCase(), failure);
  }
  const addFailure = (semanticKey: Hex, reason: string) => {
    const key = semanticKey.toLowerCase();
    if (!failureByKey.has(key)) {
      failureByKey.set(key, { reason, semanticKey });
    }
  };
  const usableMarket = (semanticKey: Hex) => {
    const key = semanticKey.toLowerCase();
    return failureByKey.has(key) ? undefined : marketsByKey.get(key);
  };

  const history: PredictionPortfolioHistoryEntry[] = [];
  for (const log of createdLogs) {
    const market = usableMarket(log.args.semanticKey);
    if (!market) continue;
    if (
      market.vault.toLowerCase() !== log.args.vault.toLowerCase() ||
      market.checkpoint.toLowerCase() !== log.args.checkpoint.toLowerCase() ||
      market.poolId.toLowerCase() !== log.args.poolId.toLowerCase()
    ) {
      addFailure(
        log.args.semanticKey,
        "The market creation event does not match the canonical market",
      );
      continue;
    }
    history.push({
      ...historyBase(log, market),
      creator: getAddress(log.args.creator),
      kind: "created",
    });
  }
  for (const log of boughtLogs) {
    const component = componentIndex.byVault.get(log.args.vault.toLowerCase());
    if (!component) continue;
    const market = usableMarket(component.semanticKey);
    if (!market || market.vault.toLowerCase() !== log.args.vault.toLowerCase()) {
      if (market) addFailure(component.semanticKey, "The buy event vault is not canonical");
      continue;
    }
    history.push({
      ...historyBase(log, market),
      collateralInAtoms: log.args.collateralInAtoms,
      collateralRefundAtoms: log.args.collateralRefundAtoms,
      kind: "bought",
      outcome: log.args.yes ? "YES" : "NO",
      outcomeAtoms: log.args.outcomeAtoms,
    });
  }
  for (const log of soldLogs) {
    const component = componentIndex.byVault.get(log.args.vault.toLowerCase());
    if (!component) continue;
    const market = usableMarket(component.semanticKey);
    if (!market || market.vault.toLowerCase() !== log.args.vault.toLowerCase()) {
      if (market) addFailure(component.semanticKey, "The sell event vault is not canonical");
      continue;
    }
    history.push({
      ...historyBase(log, market),
      collateralAtoms: log.args.collateralAtoms,
      complementRefundAtoms: log.args.complementRefundAtoms,
      kind: "sold",
      outcome: log.args.yes ? "YES" : "NO",
      outcomeAtoms: log.args.outcomeInAtoms,
      soldRefundAtoms: log.args.soldRefundAtoms,
    });
  }
  for (const log of redeemedLogs) {
    const component = componentIndex.byVault.get(log.address.toLowerCase());
    if (!component) continue;
    const market = usableMarket(component.semanticKey);
    if (!market || market.vault.toLowerCase() !== log.address.toLowerCase()) {
      if (market) addFailure(component.semanticKey, "The redemption event vault is not canonical");
      continue;
    }
    history.push({
      ...historyBase(log, market),
      collateralAtoms: log.args.collateralAtoms,
      kind: "redeemed",
      noAtoms: log.args.noAtoms,
      recipient: getAddress(log.args.recipient),
      yesAtoms: log.args.yesAtoms,
    });
  }
  for (const log of transferLogs) {
    const token = componentIndex.byToken.get(log.address.toLowerCase());
    if (!token) continue;
    const market = usableMarket(token.component.semanticKey);
    const expectedToken = token.outcome === "YES" ? market?.yesToken : market?.noToken;
    if (!market || expectedToken?.toLowerCase() !== log.address.toLowerCase()) {
      if (market) addFailure(token.component.semanticKey, "The outcome transfer token is not canonical");
      continue;
    }
    const from = getAddress(log.args.from);
    const to = getAddress(log.args.to);
    const fromAccount = from.toLowerCase() === request.account.toLowerCase();
    const toAccount = to.toLowerCase() === request.account.toLowerCase();
    if (!fromAccount && !toAccount) continue;
    history.push({
      ...historyBase(log, market),
      direction: fromAccount && toAccount ? "self" : toAccount ? "in" : "out",
      from,
      kind: "transfer",
      outcome: token.outcome,
      outcomeAtoms: log.args.value,
      to,
    });
  }

  const invalidHistoryKeys = new Set(failureByKey.keys());
  const canonicalHistory = history.filter(
    (entry) => !invalidHistoryKeys.has(entry.semanticKey.toLowerCase()),
  );
  const richerTransactions = new Set(
    canonicalHistory
      .filter((entry) =>
        entry.kind === "bought" || entry.kind === "sold" || entry.kind === "redeemed",
      )
      .map(
        (entry) =>
          `${entry.transactionHash.toLowerCase()}:${entry.semanticKey.toLowerCase()}`,
      ),
  );
  const visibleHistory = canonicalHistory
    .filter(
      (entry) =>
        entry.kind !== "transfer" ||
        !richerTransactions.has(
          `${entry.transactionHash.toLowerCase()}:${entry.semanticKey.toLowerCase()}`,
        ),
    )
    .sort((left, right) => compareActivityPosition(right, left));
  const created = visibleHistory.flatMap((entry) =>
    entry.kind === "created"
      ? [{
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          market: entry.market,
          transactionHash: entry.transactionHash,
          transactionIndex: entry.transactionIndex,
        }]
      : [],
  );
  const positions = semanticKeys.flatMap((semanticKey) => {
    const market = usableMarket(semanticKey);
    return market && (market.yesBalanceAtoms > 0n || market.noBalanceAtoms > 0n)
      ? [derivePredictionPortfolioPosition(market)]
      : [];
  });

  return {
    blockNumber: snapshot.blockNumber,
    blockTimestamp: snapshot.blockTimestamp,
    created,
    failures: [...failureByKey.values()],
    history: visibleHistory,
    positions,
    relevantMarketCount: semanticKeys.length,
    request,
    scannedMarketCount: snapshot.marketCount,
  };
}

export async function readPredictionMarketPortfolio({
  clients = createPredictionMarketPublicClients(),
  config,
  request,
}: {
  clients?: PredictionMarketClients;
  config: PredictionMarketReleaseConfig;
  request: PredictionPortfolioRequest;
}): Promise<PredictionMarketPortfolio> {
  const normalizedRequest = createPredictionPortfolioRequest(
    request.account,
    request.requestKey,
  );
  try {
    return await readPredictionMarketPortfolioAtRequest({
      clients,
      config,
      request: normalizedRequest,
    });
  } catch (error) {
    if (error instanceof PredictionPortfolioReadError) throw error;
    throw new PredictionPortfolioReadError(normalizedRequest, error);
  }
}

export const predictionMarketPortfolioInternal = {
  dedupePortfolioLogs,
  filterPredictionOutcomeLogs,
  indexPredictionMarketComponents,
  marketComponentsEvent,
  marketCreatedEvent,
  outcomeBoughtEvent,
  outcomeSoldEvent,
  outcomeTransferEvent,
  predictionPortfolioBlockRanges,
  predictionRedeemedEvent,
  readPredictionPortfolioLogs,
} as const;
