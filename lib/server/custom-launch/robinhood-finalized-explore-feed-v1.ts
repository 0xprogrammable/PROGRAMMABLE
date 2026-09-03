import "server-only";

import {
  createPublicClient,
  decodeEventLog,
  formatUnits,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  parseAbi,
  parseAbiItem,
  toEventSelector,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { mainnet } from "viem/chains";

// The public launch package is the canonical runtime validator for the closed
// V4 request shapes. It intentionally ships as ESM JavaScript today.
// @ts-expect-error -- packages/launch does not publish TypeScript declarations.
import { hashProjectMetadata, validateProjectMetadata } from "../../../packages/launch/src/project-metadata.mjs";
// @ts-expect-error -- packages/launch does not publish TypeScript declarations.
import { hashV4ChainDeployment, normalizeV4ChainDeployment, normalizeV4FundingIntent, normalizeV4LiquidityModel, normalizeV4ProfileRef } from "../../../packages/launch/src/v4-contract.mjs";

import {
  ROBINHOOD_MAINNET_RPC_URL,
  robinhoodChain,
} from "../../chains";
import {
  CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4,
} from "../../custom-launch/wallet-handoff-v4";
import { canonicalTokenExploreEntryV1 } from "../../explore-entry-v1";
import { uerc20ReadAbi } from "../../onchain/abis";
import { productionMainnetRpcPair } from
  "../../onchain/website-rpc-providers.server";
import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import { canonicalSha256 } from "../projection-target/hashing";
import {
  computeOfficialV4PoolId,
} from "../../uniswap/liquidity-launcher-sdk";
import type {
  CanonicalTokenExploreEntry,
  LaunchStampProvenanceV1,
  LauncherToken,
  ProjectMetadataLink,
  TokenLink,
} from "../../tokens";

export const ROBINHOOD_FINALIZED_EXPLORE_FEED_URL_V1 =
  "https://api.programmable.market/v4/chains/4663/finalized-custom-launches" as const;
export const ROBINHOOD_FINALIZED_EXPLORE_SOURCE_V1 =
  "robinhood-finalized-custom-launch-feed-v4" as const;
export const ROBINHOOD_FINALIZED_EXPLORE_LAUNCH_SOURCE_V1 =
  "robinhood-finalized-custom-launch-feed-v4+canonical-launch-stamp-router" as const;

const PAGE_LIMIT = 25;
const MAXIMUM_PAGES = 40;
const MAXIMUM_RECORDS = 1_000;
const MAXIMUM_PAGE_BYTES = 4 * 1_024 * 1_024;
const REQUEST_TIMEOUT_MS = 1_500;
const VERIFICATION_TIMEOUT_MS = 8_000;
const MAXIMUM_GENERATED_AGE_MS = 5 * 60_000;
const MAXIMUM_FUTURE_SKEW_MS = 60_000;
const FINALITY_CONFIRMATIONS = 64n;
const ROUTER_START_BLOCK = 50_469_365n;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BYTES32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const CURSOR = /^[A-Za-z0-9_-]{16,512}$/u;
const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"00".repeat(32)}`;
const L1_ROLLUP = "0x23A19d23e89166adedbDcB432518AB01e4272D94";
const L1_SEQUENCER_INBOX =
  "0xBd0D173EEb87D57A09521c24388a12789F33ba96";
const SEQUENCER_BATCH_DELIVERED_TOPIC =
  "0x7394f4a19a13c7b92b5bb71033245305946ef78452f7b4986ac1390b5df4ebd7";
const TRUSTED_IPFS_PROJECT_IMAGE_GATEWAY_V1 =
  "https://ipfs.io/ipfs/" as const;
const TRUSTED_ARWEAVE_PROJECT_IMAGE_GATEWAY_V1 =
  "https://arweave.net/" as const;
const SOURCE_AUTHORITY =
  "protected-hosted-build-finalized-transaction-bytecode";
const SOURCE_BINDING_SCHEMA =
  "programmable.robinhood-custom-launch.exact-byte-source-build-transaction-binding.v1";
const SOURCE_COVERED_EVIDENCE = Object.freeze([
  "protected-source-tree",
  "source-closure",
  "hosted-build-artifact",
  "standard-json-input",
  "compiler-binary",
  "compiler-settings",
  "finalized-creation-transaction",
  "creation-bytecode",
  "runtime-bytecode",
] as const);

const componentEvent = parseAbiItem(
  "event ProgrammableComponentStampedV1(bytes32 indexed launchId,address indexed component,uint8 indexed kind,bytes32 runtimeCodeHash)",
);
const routeEvent = parseAbiItem(
  "event ProgrammableLaunchRouteStampedV1(bytes32 indexed launchId,uint8 indexed kind,bytes32 indexed routePayloadHash,bytes32 expectedResultHash,bytes32 permitDigest)",
);
const launchEvent = parseAbiItem(
  "event ProgrammableLaunchStampedV1(bytes32 indexed launchId,address indexed token,address indexed hook,address poolManager,bytes32 poolId,bytes32 stampHash)",
);
const initializeEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
);
const sequencerBatchEvent = Object.freeze({
  type: "event",
  name: "SequencerBatchDelivered",
  inputs: Object.freeze([
    Object.freeze({ indexed: true, name: "batchSequenceNumber", type: "uint256" }),
    Object.freeze({ indexed: true, name: "beforeAcc", type: "bytes32" }),
    Object.freeze({ indexed: true, name: "afterAcc", type: "bytes32" }),
    Object.freeze({ indexed: false, name: "delayedAcc", type: "bytes32" }),
    Object.freeze({ indexed: false, name: "afterDelayedMessagesRead", type: "uint256" }),
    Object.freeze({
      indexed: false,
      name: "timeBounds",
      type: "tuple",
      components: Object.freeze([
        Object.freeze({ name: "delayBlocks", type: "uint64" }),
        Object.freeze({ name: "futureBlocks", type: "uint64" }),
        Object.freeze({ name: "delaySeconds", type: "uint64" }),
        Object.freeze({ name: "futureSeconds", type: "uint64" }),
      ]),
    }),
    Object.freeze({ indexed: false, name: "dataLocation", type: "uint8" }),
  ]),
} as const);
const componentTopic = toEventSelector(componentEvent);
const routeTopic = toEventSelector(routeEvent);
const launchTopic = toEventSelector(launchEvent);
const initializeTopic = toEventSelector(initializeEvent);
const routerReadAbi = parseAbi([
  "function CHAIN_ID() view returns (uint256)",
  "function POOL_MANAGER() view returns (address)",
  "function POOL_MANAGER_RUNTIME_CODE_HASH() view returns (bytes32)",
  "function GRAPH_FACTORY() view returns (address)",
  "function GRAPH_FACTORY_RUNTIME_CODE_HASH() view returns (bytes32)",
  "function PERMIT_AUTHORITY() view returns (address)",
  "function PERMIT_AUTHORITY_RUNTIME_CODE_HASH() view returns (bytes32)",
  "function launchStamp(bytes32 launchId) view returns ((uint8 kind,address launchWallet,address token,address hook,address poolManager,bytes32 poolId,bytes32 poolKeyHash,bytes32 componentSetHash,bytes32 routePayloadHash,address routeLauncher,bytes32 routeLauncherRuntimeCodeHash,bytes32 expectedResultHash,bytes32 permitDigest,bytes32 stampHash) record)",
  "function launchIdByToken(address token) view returns (bytes32 launchId)",
  "function launchIdByPool(address poolManager,bytes32 poolId) view returns (bytes32 launchId)",
  "function launchIdByComponent(address component) view returns (bytes32 launchId)",
  "function componentRuntimeCodeHash(address component) view returns (bytes32 runtimeCodeHash)",
  "function stampProof(address component) view returns (bytes32 launchId,bytes32 stampHash)",
  "function computePoolKeyHash((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey) pure returns (bytes32)",
]);

type FeedQualityV1 = Readonly<{
  status: "ready";
  sourceRowCount: number;
  publishedRowCount: number;
  quarantinedRowCount: 0;
}>;

type SourceComponentV1 = Readonly<{
  targetId: string;
  address: Address;
  updatedAt: string;
}>;

type ParsedLaunchV1 = Readonly<{
  launchId: string;
  routerLaunchId: Hex;
  projectMetadata: Readonly<{
    token: Readonly<{ name: string; symbol: string }>;
    description: string;
    imageUrl: string;
    links: readonly TokenLink[];
    projectMetadataLinks: readonly ProjectMetadataLink[];
    tokenTargetId: string;
  }>;
  l2: Readonly<{
    transactionHash: Hex;
    blockNumber: bigint;
    blockHash: Hex;
    blockTimestamp: bigint;
    routeLogIndex: number;
    launchLogIndex: number;
  }>;
  l1: Readonly<{
    posting: Readonly<{
      transactionHash: Hex;
      blockNumber: bigint;
      blockHash: Hex;
      logIndex: number;
      sequencerInbox: Address;
      batchNumber: bigint;
    }>;
    finalized: Readonly<{
      blockNumber: bigint;
      blockHash: Hex;
    }>;
  }>;
  evidenceDigest: `sha256:${string}`;
  finalizedAt: string;
  sourceUpdatedAt: string;
  sourceComponents: readonly SourceComponentV1[];
}>;

export type RobinhoodFinalizedExploreSnapshotV1 = Readonly<{
  source: typeof ROBINHOOD_FINALIZED_EXPLORE_SOURCE_V1;
  launchSource: typeof ROBINHOOD_FINALIZED_EXPLORE_LAUNCH_SOURCE_V1;
  generatedAt: string;
  asOfBlock: string;
  asOfBlockHash: Hex;
  identityCommitment: `sha256:${string}`;
  entries: readonly CanonicalTokenExploreEntry[];
  quality: FeedQualityV1;
  sourceVerification: readonly Readonly<{
    tokenAddress: Address;
    updatedAt: string;
  }>[];
}>;

export type RobinhoodFinalizedExploreReaderClientV1 = PublicClient;
export type RobinhoodFinalizedExploreEthereumClientV1 = PublicClient;

type ReaderDependenciesV1 = Readonly<{
  fetchFeed?: typeof fetch;
  client?: RobinhoodFinalizedExploreReaderClientV1;
  ethereumClients?: readonly [
    RobinhoodFinalizedExploreEthereumClientV1,
    RobinhoodFinalizedExploreEthereumClientV1,
  ];
  now?: () => number;
  signal?: AbortSignal;
  timeoutMs?: number;
  maximumPages?: number;
  verifyLaunch?: (
    launch: ParsedLaunchV1,
    context: Readonly<{
      client: RobinhoodFinalizedExploreReaderClientV1;
      latestBlock: Readonly<{ number: bigint; hash: Hex }>;
    }>,
  ) => Promise<CanonicalTokenExploreEntry>;
  verifyEthereumFinality?: (
    launch: ParsedLaunchV1,
    clients: readonly [
      RobinhoodFinalizedExploreEthereumClientV1,
      RobinhoodFinalizedExploreEthereumClientV1,
    ],
  ) => Promise<void>;
}>;

export async function readRobinhoodFinalizedExploreSnapshotV1(
  dependencies: ReaderDependenciesV1 = {},
): Promise<RobinhoodFinalizedExploreSnapshotV1> {
  const fetchFeed = dependencies.fetchFeed ?? fetch;
  const now = dependencies.now ?? Date.now;
  const timeoutMs = dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maximumPages = dependencies.maximumPages ?? MAXIMUM_PAGES;
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 5_000 ||
    !Number.isSafeInteger(maximumPages) || maximumPages < 1 ||
    maximumPages > MAXIMUM_PAGES
  ) throw new TypeError("Robinhood finalized feed bounds are invalid");

  const verificationSignal = dependencies.signal ??
    AbortSignal.timeout(VERIFICATION_TIMEOUT_MS);
  const feedSignal = AbortSignal.any([
    ...(dependencies.signal ? [dependencies.signal] : []),
    AbortSignal.timeout(timeoutMs),
  ]);
  const launches: ParsedLaunchV1[] = [];
  const cursors = new Set<string>();
  const launchIds = new Set<string>();
  let cursor: string | null = null;
  let generatedAt: string | null = null;
  let quality: FeedQualityV1 | null = null;

  for (let page = 0; page < maximumPages; page += 1) {
    const url = new URL(ROBINHOOD_FINALIZED_EXPLORE_FEED_URL_V1);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const response = await fetchFeed(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: feedSignal,
    });
    if (response.status !== 200) {
      throw new Error("Robinhood finalized feed is unavailable");
    }
    const parsed = parsePage(await readBoundedJson(response), now());
    // The backend timestamps each HTTP page independently. The first page is
    // the catalog timestamp; the keyset cursor and global quality totals bind
    // the compatible cross-page read instead of generatedAt equality.
    generatedAt ??= parsed.generatedAt;
    if (quality === null) quality = parsed.quality;
    else if (canonicalizeJson(quality) !== canonicalizeJson(parsed.quality)) {
      throw new Error("Robinhood finalized feed quality changed while paging");
    }
    for (const launch of parsed.launches) {
      const identity = launch.routerLaunchId.toLowerCase();
      if (launchIds.has(identity)) {
        throw new Error("Robinhood finalized feed contains duplicate launches");
      }
      launchIds.add(identity);
      launches.push(launch);
      if (launches.length > MAXIMUM_RECORDS) {
        throw new Error("Robinhood finalized feed exceeds its record bound");
      }
    }
    if (parsed.nextCursor === null) break;
    if (parsed.launches.length === 0 || cursors.has(parsed.nextCursor)) {
      throw new Error("Robinhood finalized feed cursor is invalid");
    }
    cursors.add(parsed.nextCursor);
    cursor = parsed.nextCursor;
    if (page === maximumPages - 1) {
      throw new Error("Robinhood finalized feed exceeds its page bound");
    }
  }

  if (
    quality === null || generatedAt === null ||
    quality.publishedRowCount === 0 ||
    launches.length !== quality.publishedRowCount
  ) throw new Error("Robinhood finalized feed is not publishable");

  const client = dependencies.client ?? createPublicClient({
    chain: robinhoodChain,
    transport: http(
      process.env.ROBINHOOD_RPC_URL?.trim() || ROBINHOOD_MAINNET_RPC_URL,
      { retryCount: 1, timeout: 2_500 },
    ),
  });
  const ethereumClients = dependencies.ethereumClients ??
    productionEthereumClientsV1();
  verificationSignal.throwIfAborted();
  const [robinhoodChainId, primaryEthereumChainId,
    secondaryEthereumChainId, latestNumber] = await Promise.all([
    client.getChainId(),
    ethereumClients[0].getChainId(),
    ethereumClients[1].getChainId(),
    client.getBlockNumber(),
  ]);
  if (robinhoodChainId !== 4663) {
    throw new Error("Robinhood Explore RPC is on the wrong chain");
  }
  if (primaryEthereumChainId !== 1 || secondaryEthereumChainId !== 1) {
    throw new Error("Robinhood finality RPC is on the wrong chain");
  }
  const latest = await canonicalBlock(client, latestNumber);
  const verifyLaunch = dependencies.verifyLaunch ?? verifyLaunchV1;
  const verifyEthereumFinality = dependencies.verifyEthereumFinality ??
    verifyEthereumFinalityV1;
  const finalityReads = new Map<string, Promise<void>>();
  const entries: CanonicalTokenExploreEntry[] = [];
  for (let offset = 0; offset < launches.length; offset += 3) {
    verificationSignal.throwIfAborted();
    entries.push(...await Promise.all(
      launches.slice(offset, offset + 3).map(async (launch) => {
        const finalityKey = [
          launch.l1.posting.transactionHash,
          launch.l1.posting.blockNumber.toString(),
          launch.l1.posting.blockHash,
          String(launch.l1.posting.logIndex),
          launch.l1.posting.batchNumber.toString(),
          launch.l1.finalized.blockNumber.toString(),
          launch.l1.finalized.blockHash,
        ].join("\0");
        let finalityRead = finalityReads.get(finalityKey);
        if (finalityRead === undefined) {
          finalityRead = verifyEthereumFinality(launch, ethereumClients);
          finalityReads.set(finalityKey, finalityRead);
        }
        const [entry] = await Promise.all([
          verifyLaunch(launch, { client, latestBlock: latest }),
          finalityRead,
        ]);
        return entry;
      }),
    ));
    verificationSignal.throwIfAborted();
  }
  const tokenAddresses = new Set<string>();
  for (const entry of entries) {
    const address = entry.tokenAddress.toLowerCase();
    if (tokenAddresses.has(address)) {
      throw new Error("Robinhood finalized feed resolves duplicate tokens");
    }
    tokenAddresses.add(address);
  }
  const frozenEntries = Object.freeze(entries);
  return Object.freeze({
    source: ROBINHOOD_FINALIZED_EXPLORE_SOURCE_V1,
    launchSource: ROBINHOOD_FINALIZED_EXPLORE_LAUNCH_SOURCE_V1,
    generatedAt,
    asOfBlock: latest.number.toString(),
    asOfBlockHash: latest.hash,
    identityCommitment: canonicalSha256(
      "programmable.robinhood-finalized-explore-snapshot.v1",
      {
        chainId: 4663,
        generatedAt,
        asOfBlock: latest.number.toString(),
        asOfBlockHash: latest.hash,
        entries: frozenEntries,
        finalizedEvidence: launches.map((launch) => ({
          routerLaunchId: launch.routerLaunchId,
          evidenceDigest: launch.evidenceDigest,
          l1: {
            posting: {
              ...launch.l1.posting,
              blockNumber: launch.l1.posting.blockNumber.toString(),
              batchNumber: launch.l1.posting.batchNumber.toString(),
            },
            finalized: {
              ...launch.l1.finalized,
              blockNumber: launch.l1.finalized.blockNumber.toString(),
            },
          },
        })),
      },
    ),
    entries: frozenEntries,
    quality,
    sourceVerification: Object.freeze(entries.map((entry, index) => ({
      tokenAddress: entry.tokenAddress,
      updatedAt: launches[index]!.sourceUpdatedAt,
    }))),
  });
}

async function verifyLaunchV1(
  launch: ParsedLaunchV1,
  context: Readonly<{
    client: RobinhoodFinalizedExploreReaderClientV1;
    latestBlock: Readonly<{ number: bigint; hash: Hex }>;
  }>,
) {
  if (context.latestBlock.number < launch.l2.blockNumber + FINALITY_CONFIRMATIONS) {
    throw new Error("Robinhood launch is outside the Explore confirmation boundary");
  }
  const [receipt, launchBlock] = await Promise.all([
    context.client.getTransactionReceipt({ hash: launch.l2.transactionHash }),
    canonicalBlock(context.client, launch.l2.blockNumber),
  ]);
  if (
    !sameHex(launchBlock.hash, launch.l2.blockHash) ||
    launchBlock.timestamp !== launch.l2.blockTimestamp
  ) throw new Error("Robinhood launch block evidence mismatch");
  const parsed = parseReceipt(launch, receipt);
  const roots = CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4;
  const router = roots.programmableLaunchStampRouter.address;
  const blockNumber = launch.l2.blockNumber;
  const [routerCode, poolCode, graphCode, permitCode, chainId, poolManager,
    poolManagerCodeHash, graphFactory, graphFactoryCodeHash, permitAuthority,
    permitAuthorityCodeHash, record, tokenLaunchId, poolLaunchId,
    computedPoolKeyHash, tokenName, tokenSymbol, tokenDecimals,
    tokenTotalSupply] = await Promise.all([
    context.client.getCode({ address: router, blockNumber }),
    context.client.getCode({ address: roots.poolManager.address, blockNumber }),
    context.client.getCode({ address: roots.graphFactory.address, blockNumber }),
    context.client.getCode({ address: roots.permitAuthority.address, blockNumber }),
    context.client.readContract({ address: router, abi: routerReadAbi, functionName: "CHAIN_ID", blockNumber }),
    context.client.readContract({ address: router, abi: routerReadAbi, functionName: "POOL_MANAGER", blockNumber }),
    context.client.readContract({ address: router, abi: routerReadAbi, functionName: "POOL_MANAGER_RUNTIME_CODE_HASH", blockNumber }),
    context.client.readContract({ address: router, abi: routerReadAbi, functionName: "GRAPH_FACTORY", blockNumber }),
    context.client.readContract({ address: router, abi: routerReadAbi, functionName: "GRAPH_FACTORY_RUNTIME_CODE_HASH", blockNumber }),
    context.client.readContract({ address: router, abi: routerReadAbi, functionName: "PERMIT_AUTHORITY", blockNumber }),
    context.client.readContract({ address: router, abi: routerReadAbi, functionName: "PERMIT_AUTHORITY_RUNTIME_CODE_HASH", blockNumber }),
    context.client.readContract({ address: router, abi: routerReadAbi, functionName: "launchStamp", args: [launch.routerLaunchId], blockNumber }),
    context.client.readContract({ address: router, abi: routerReadAbi, functionName: "launchIdByToken", args: [parsed.token], blockNumber }),
    context.client.readContract({ address: router, abi: routerReadAbi, functionName: "launchIdByPool", args: [roots.poolManager.address, parsed.poolId], blockNumber }),
    context.client.readContract({ address: router, abi: routerReadAbi, functionName: "computePoolKeyHash", args: [parsed.poolKey], blockNumber }),
    context.client.readContract({ address: parsed.token, abi: uerc20ReadAbi, functionName: "name", blockNumber }),
    context.client.readContract({ address: parsed.token, abi: uerc20ReadAbi, functionName: "symbol", blockNumber }),
    optionalRead(() => context.client.readContract({ address: parsed.token, abi: uerc20ReadAbi, functionName: "decimals", blockNumber })),
    optionalRead(() => context.client.readContract({ address: parsed.token, abi: uerc20ReadAbi, functionName: "totalSupply", blockNumber })),
  ]);
  assertCodeHash(routerCode, roots.programmableLaunchStampRouter.runtimeCodeHash, "Router");
  assertCodeHash(poolCode, roots.poolManager.runtimeCodeHash, "PoolManager");
  assertCodeHash(graphCode, roots.graphFactory.runtimeCodeHash, "Graph Factory");
  assertCodeHash(permitCode, roots.permitAuthority.runtimeCodeHash, "permit authority");
  if (
    chainId !== 4663n ||
    !isAddressEqual(poolManager, roots.poolManager.address) ||
    !sameHex(poolManagerCodeHash, roots.poolManager.runtimeCodeHash) ||
    !isAddressEqual(graphFactory, roots.graphFactory.address) ||
    !sameHex(graphFactoryCodeHash, roots.graphFactory.runtimeCodeHash) ||
    !isAddressEqual(permitAuthority, roots.permitAuthority.address) ||
    !sameHex(permitAuthorityCodeHash, roots.permitAuthority.runtimeCodeHash) ||
    !sameHex(tokenLaunchId, launch.routerLaunchId) ||
    !sameHex(poolLaunchId, launch.routerLaunchId) ||
    !sameHex(computedPoolKeyHash, record.poolKeyHash) ||
    record.kind !== 1 ||
    !isAddressEqual(record.token, parsed.token) ||
    !isAddressEqual(record.hook, parsed.hook) ||
    !isAddressEqual(record.poolManager, roots.poolManager.address) ||
    !sameHex(record.poolId, parsed.poolId) ||
    !sameHex(record.routePayloadHash, parsed.routePayloadHash) ||
    !sameHex(record.expectedResultHash, parsed.expectedResultHash) ||
    !sameHex(record.permitDigest, parsed.permitDigest) ||
    !sameHex(record.stampHash, parsed.stampHash) ||
    !isAddressEqual(record.routeLauncher, roots.graphFactory.address) ||
    !sameHex(record.routeLauncherRuntimeCodeHash, roots.graphFactory.runtimeCodeHash) ||
    sameHex(record.componentSetHash, ZERO_HASH) ||
    sameHex(record.poolKeyHash, ZERO_HASH) ||
    isAddressEqual(record.launchWallet, ZERO_ADDRESS)
  ) throw new Error("Robinhood Router binding does not match the finalized feed");

  const componentProofs = await Promise.all(parsed.components.map(async (component) => {
    const [code, launchId, runtimeCodeHash, proof] = await Promise.all([
      context.client.getCode({ address: component.address, blockNumber }),
      context.client.readContract({ address: router, abi: routerReadAbi, functionName: "launchIdByComponent", args: [component.address], blockNumber }),
      context.client.readContract({ address: router, abi: routerReadAbi, functionName: "componentRuntimeCodeHash", args: [component.address], blockNumber }),
      context.client.readContract({ address: router, abi: routerReadAbi, functionName: "stampProof", args: [component.address], blockNumber }),
    ]);
    assertCodeHash(code, component.runtimeCodeHash, `component ${component.address}`);
    if (
      !sameHex(launchId, launch.routerLaunchId) ||
      !sameHex(runtimeCodeHash, component.runtimeCodeHash) ||
      !sameHex(proof[0], launch.routerLaunchId) ||
      !sameHex(proof[1], parsed.stampHash)
    ) throw new Error("Robinhood component proof mismatch");
    return {
      address: component.address,
      kind: component.kind,
      scope: "exclusive" as const,
      runtimeCodeHash: component.runtimeCodeHash,
      logIndex: component.logIndex,
      exclusiveProof: {
        launchId: proof[0],
        stampHash: proof[1],
      },
    };
  }));
  const sourceAddresses = [...launch.sourceComponents]
    .map((component) => component.address.toLowerCase()).sort();
  const routerAddresses = componentProofs
    .map((component) => component.address.toLowerCase()).sort();
  const tokenSource = launch.sourceComponents.find(
    (component) => component.targetId === launch.projectMetadata.tokenTargetId,
  );
  if (
    canonicalizeJson(sourceAddresses) !== canonicalizeJson(routerAddresses) ||
    !tokenSource || !isAddressEqual(tokenSource.address, parsed.token) ||
    tokenName !== launch.projectMetadata.token.name ||
    tokenSymbol !== launch.projectMetadata.token.symbol
  ) throw new Error("Robinhood source or token metadata binding mismatch");

  const provenance: LaunchStampProvenanceV1 = {
    schemaVersion: "programmable.launch-stamp-provenance.v1",
    chainId: 4663,
    routerAddress: router,
    routerRuntimeCodeHash: roots.programmableLaunchStampRouter.runtimeCodeHash,
    routerStartBlock: ROUTER_START_BLOCK.toString(),
    finalityConfirmations: Number(FINALITY_CONFIRMATIONS),
    kind: "custom-graph",
    launchId: launch.routerLaunchId,
    stampHash: parsed.stampHash,
    launchWallet: record.launchWallet,
    transactionHash: launch.l2.transactionHash,
    blockNumber: launch.l2.blockNumber.toString(),
    blockHash: launch.l2.blockHash,
    transactionIndex: receipt.transactionIndex,
    routeLogIndex: launch.l2.routeLogIndex,
    launchLogIndex: launch.l2.launchLogIndex,
    finalizedAtBlockNumber: context.latestBlock.number.toString(),
    finalizedAtBlockHash: context.latestBlock.hash,
    poolManagerAddress: roots.poolManager.address,
    poolId: parsed.poolId,
    poolKey: parsed.poolKey,
    poolKeyHash: record.poolKeyHash,
    componentSetHash: record.componentSetHash,
    routePayloadHash: parsed.routePayloadHash,
    routeLauncherAddress: record.routeLauncher,
    routeLauncherRuntimeCodeHash: record.routeLauncherRuntimeCodeHash,
    expectedResultHash: parsed.expectedResultHash,
    permitDigest: parsed.permitDigest,
    components: componentProofs,
    tokenProof: {
      tokenAddress: parsed.token,
      launchId: launch.routerLaunchId,
      stampHash: parsed.stampHash,
    },
    poolProof: {
      poolManagerAddress: roots.poolManager.address,
      poolId: parsed.poolId,
      launchId: launch.routerLaunchId,
      stampHash: parsed.stampHash,
    },
  };
  const decimals = typeof tokenDecimals === "number" ? tokenDecimals : null;
  const supply = typeof tokenTotalSupply === "bigint" ? tokenTotalSupply : null;
  const token: LauncherToken = {
    id: `4663:${parsed.token.toLowerCase()}`,
    name: launch.projectMetadata.token.name,
    symbol: launch.projectMetadata.token.symbol,
    ...(launch.projectMetadata.description
      ? { description: launch.projectMetadata.description }
      : {}),
    imageUrl: launch.projectMetadata.imageUrl,
    ...(launch.projectMetadata.links.length
      ? { links: [...launch.projectMetadata.links] }
      : {}),
    projectMetadataLinks: [...launch.projectMetadata.projectMetadataLinks],
    projectMetadataStatus: "current",
    tokenAddress: parsed.token,
    hookAddress: parsed.hook,
    poolId: parsed.poolId,
    creatorAddress: record.launchWallet,
    launchBlockNumber: launch.l2.blockNumber.toString(),
    launchTransactionHash: launch.l2.transactionHash,
    launchTransactionIndex: receipt.transactionIndex,
    launchLogIndex: launch.l2.launchLogIndex,
    launchedAt: new Date(Number(launch.l2.blockTimestamp) * 1_000).toISOString(),
    ...(decimals === null ? {} : { tokenDecimals: decimals }),
    ...(supply === null ? {} : { totalSupplyRaw: supply.toString() }),
    ...(decimals === null || supply === null
      ? {}
      : { totalSupply: formatUnits(supply, decimals) }),
    totalSwapFeeBps: null,
    launchModel: "custom-graph",
    launchModelVersion: "programmable-launch-stamp-router-v1",
    liquidityPath: "programmable-v4",
    launchStampProvenance: provenance,
  };
  return canonicalTokenExploreEntryV1(token);
}

function productionEthereumClientsV1(): readonly [
  RobinhoodFinalizedExploreEthereumClientV1,
  RobinhoodFinalizedExploreEthereumClientV1,
] {
  const pair = productionMainnetRpcPair();
  return Object.freeze([
    createPublicClient({
      chain: mainnet,
      transport: http(pair.primary.url, { retryCount: 1, timeout: 2_500 }),
    }),
    createPublicClient({
      chain: mainnet,
      transport: http(pair.secondary.url, { retryCount: 1, timeout: 2_500 }),
    }),
  ]);
}

async function verifyEthereumFinalityV1(
  launch: ParsedLaunchV1,
  clients: readonly [
    RobinhoodFinalizedExploreEthereumClientV1,
    RobinhoodFinalizedExploreEthereumClientV1,
  ],
) {
  const posting = launch.l1.posting;
  const finalized = launch.l1.finalized;
  const observations = await Promise.all(clients.map(async (client) => {
    const [receipt, postingBlock, finalizedBlock, finalizedHead] =
      await Promise.all([
        client.getTransactionReceipt({ hash: posting.transactionHash }),
        ethereumBlockV1(client, posting.blockNumber),
        ethereumBlockV1(client, finalized.blockNumber),
        client.getBlock({ blockTag: "finalized" }),
      ]);
    if (
      receipt.status !== "success" ||
      !sameHex(receipt.transactionHash, posting.transactionHash) ||
      receipt.blockNumber !== posting.blockNumber ||
      !sameHex(receipt.blockHash, posting.blockHash)
    ) throw new Error("Robinhood L1 posting receipt is inconsistent");
    const postingLog = receipt.logs.find(
      (log) => logNumber(log.logIndex) && log.logIndex === posting.logIndex,
    );
    if (
      !postingLog ||
      !isAddressEqual(postingLog.address, posting.sequencerInbox) ||
      !isSequencerBatchDeliveredLogV1(postingLog, posting.batchNumber) ||
      postingLog.blockNumber !== posting.blockNumber ||
      !sameHex(postingLog.blockHash, posting.blockHash) ||
      !sameHex(postingBlock.hash, posting.blockHash) ||
      !sameHex(finalizedBlock.hash, finalized.blockHash) ||
      finalizedHead.number === null || finalizedHead.number < finalized.blockNumber ||
      !finalizedHead.hash ||
      (finalizedHead.number === finalized.blockNumber &&
        !sameHex(finalizedHead.hash, finalized.blockHash))
    ) throw new Error("Robinhood L1 finalized checkpoint is inconsistent");
    return true;
  }));
  if (observations.length !== 2 || observations.some((value) => value !== true)) {
    throw new Error("Robinhood L1 finality quorum is unavailable");
  }
}

function isSequencerBatchDeliveredLogV1(log: Log, batchNumber: bigint) {
  if (
    log.topics.length !== 4 ||
    !sameHex(log.topics[0], SEQUENCER_BATCH_DELIVERED_TOPIC) ||
    typeof log.topics[1] !== "string"
  ) return false;
  try {
    if (BigInt(log.topics[1]) !== batchNumber) return false;
    const decoded = decodeEventLog({
      abi: [sequencerBatchEvent],
      eventName: "SequencerBatchDelivered",
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    return (decoded.args as { batchSequenceNumber: bigint })
      .batchSequenceNumber === batchNumber;
  } catch {
    return false;
  }
}

async function ethereumBlockV1(
  client: RobinhoodFinalizedExploreEthereumClientV1,
  number: bigint,
) {
  const block = await client.getBlock({ blockNumber: number });
  if (block.number !== number || !block.hash || !isBytes32(block.hash)) {
    throw new Error("Robinhood L1 RPC returned an invalid canonical block");
  }
  return { number, hash: block.hash };
}

function parseReceipt(launch: ParsedLaunchV1, receipt: TransactionReceipt) {
  if (
    receipt.status !== "success" ||
    !sameHex(receipt.transactionHash, launch.l2.transactionHash) ||
    receipt.blockNumber !== launch.l2.blockNumber ||
    !sameHex(receipt.blockHash, launch.l2.blockHash) ||
    !Number.isSafeInteger(receipt.transactionIndex) ||
    receipt.transactionIndex < 0
  ) throw new Error("Robinhood receipt does not match the finalized feed");
  const roots = CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4;
  const ordered = [...receipt.logs].sort((left, right) =>
    logIndex(left) - logIndex(right)
  );
  const launchLog = ordered.find((log) =>
    logIndex(log) === launch.l2.launchLogIndex
  );
  const routeLog = ordered.find((log) =>
    logIndex(log) === launch.l2.routeLogIndex
  );
  if (
    !launchLog || !routeLog ||
    launch.l2.launchLogIndex !== launch.l2.routeLogIndex + 1 ||
    !isAddressEqual(launchLog.address, roots.programmableLaunchStampRouter.address) ||
    !isAddressEqual(routeLog.address, roots.programmableLaunchStampRouter.address) ||
    !sameHex(launchLog.topics[0] ?? "", launchTopic) ||
    !sameHex(routeLog.topics[0] ?? "", routeTopic)
  ) throw new Error("Robinhood Router event coordinates are invalid");
  const decodedLaunch = decodeEventLog({
    abi: [launchEvent], data: launchLog.data, topics: launchLog.topics, strict: true,
  }).args;
  const decodedRoute = decodeEventLog({
    abi: [routeEvent], data: routeLog.data, topics: routeLog.topics, strict: true,
  }).args;
  if (
    !sameHex(decodedLaunch.launchId, launch.routerLaunchId) ||
    !sameHex(decodedRoute.launchId, launch.routerLaunchId) ||
    Number(decodedRoute.kind) !== 1 ||
    !isAddressEqual(decodedLaunch.poolManager, roots.poolManager.address)
  ) throw new Error("Robinhood Router event identity is invalid");

  const components: Array<Readonly<{
    address: Address;
    kind: "token" | "hook" | "other";
    runtimeCodeHash: Hex;
    logIndex: number;
  }>> = [];
  for (let index = ordered.indexOf(routeLog) - 1; index >= 0; index -= 1) {
    const log = ordered[index]!;
    if (
      logIndex(log) !== launch.l2.routeLogIndex - components.length - 1 ||
      !isAddressEqual(log.address, roots.programmableLaunchStampRouter.address) ||
      !sameHex(log.topics[0] ?? "", componentTopic)
    ) break;
    const decoded = decodeEventLog({
      abi: [componentEvent], data: log.data, topics: log.topics, strict: true,
    }).args;
    if (!sameHex(decoded.launchId, launch.routerLaunchId)) {
      throw new Error("Robinhood Router component launch identity is invalid");
    }
    const kind = Number(decoded.kind);
    if (kind !== 0 && kind !== 1 && kind !== 2) {
      throw new Error("Robinhood Router component kind is invalid");
    }
    components.unshift({
      address: getAddress(decoded.component),
      kind: kind === 1 ? "token" : kind === 2 ? "hook" : "other",
      runtimeCodeHash: decoded.runtimeCodeHash,
      logIndex: logIndex(log),
    });
  }
  if (
    components.length < 2 || components.length > 16 ||
    components.filter((component) => component.kind === "token" &&
      isAddressEqual(component.address, decodedLaunch.token)).length !== 1 ||
    components.filter((component) => component.kind === "hook" &&
      isAddressEqual(component.address, decodedLaunch.hook)).length !== 1
  ) throw new Error("Robinhood Router component group is incomplete");

  const initializeLogs = ordered.filter((log) =>
    logIndex(log) < components[0]!.logIndex &&
    isAddressEqual(log.address, roots.poolManager.address) &&
    sameHex(log.topics[0] ?? "", initializeTopic) &&
    sameHex(log.topics[1] ?? "", decodedLaunch.poolId)
  );
  if (initializeLogs.length !== 1) {
    throw new Error("Robinhood pool initialization is unavailable");
  }
  const initialized = decodeEventLog({
    abi: [initializeEvent], data: initializeLogs[0]!.data,
    topics: initializeLogs[0]!.topics, strict: true,
  }).args;
  const poolKey = {
    currency0: getAddress(initialized.currency0),
    currency1: getAddress(initialized.currency1),
    fee: Number(initialized.fee),
    tickSpacing: Number(initialized.tickSpacing),
    hooks: getAddress(initialized.hooks),
  };
  if (
    !sameHex(computeOfficialV4PoolId(poolKey), decodedLaunch.poolId) ||
    !isAddressEqual(poolKey.hooks, decodedLaunch.hook)
  ) throw new Error("Robinhood PoolKey binding is invalid");
  return {
    token: getAddress(decodedLaunch.token),
    hook: getAddress(decodedLaunch.hook),
    poolId: decodedLaunch.poolId,
    stampHash: decodedLaunch.stampHash,
    poolKey,
    routePayloadHash: decodedRoute.routePayloadHash,
    expectedResultHash: decodedRoute.expectedResultHash,
    permitDigest: decodedRoute.permitDigest,
    components,
  };
}

function parsePage(value: JsonValue, now: number) {
  const page = exactRecord(value, [
    "schemaVersion", "apiVersion", "chainId", "caip2", "generatedAt",
    "quality", "launches", "nextCursor",
  ], "Robinhood finalized feed page");
  if (
    page.schemaVersion !== "programmable.custom-launch-list.v4" ||
    page.apiVersion !== "v4" || page.chainId !== "4663" ||
    page.caip2 !== "eip155:4663" || !Array.isArray(page.launches) ||
    page.launches.length > PAGE_LIMIT ||
    (page.nextCursor !== null &&
      (typeof page.nextCursor !== "string" || !CURSOR.test(page.nextCursor)))
  ) throw new Error("Robinhood finalized feed page is invalid");
  const generatedAt = timestamp(page.generatedAt, "feed generatedAt");
  const generatedMs = Date.parse(generatedAt);
  if (
    generatedMs > now + MAXIMUM_FUTURE_SKEW_MS ||
    now - generatedMs > MAXIMUM_GENERATED_AGE_MS
  ) throw new Error("Robinhood finalized feed page is stale");
  const qualityRecord = exactRecord(page.quality, [
    "status", "sourceRowCount", "publishedRowCount", "quarantinedRowCount",
  ], "Robinhood finalized feed quality");
  if (
    qualityRecord.status !== "ready" ||
    !count(qualityRecord.sourceRowCount) ||
    !count(qualityRecord.publishedRowCount) ||
    !count(qualityRecord.quarantinedRowCount) ||
    qualityRecord.sourceRowCount !== qualityRecord.publishedRowCount ||
    qualityRecord.quarantinedRowCount !== 0 ||
    page.launches.length > qualityRecord.publishedRowCount
  ) throw new Error("Robinhood finalized feed quality is not publishable");
  return {
    generatedAt,
    quality: qualityRecord as unknown as FeedQualityV1,
    launches: page.launches.map(parseLaunch),
    nextCursor: page.nextCursor as string | null,
  };
}

function parseLaunch(value: JsonValue): ParsedLaunchV1 {
  const launch = exactRecord(value, [
    "schemaVersion", "apiVersion", "launchId", "chainId", "caip2",
    "chainDeploymentId", "chainDeploymentDescriptorDigest", "chainDeployment",
    "profile", "platformId", "category", "projectMetadata", "funding",
    "liquidityModel", "commitments", "onchain", "sourceVerification",
    "createdAt", "finalizedAt",
  ], "Robinhood finalized launch");
  if (
    launch.schemaVersion !== "programmable.finalized-custom-launch-metadata.v4" ||
    launch.apiVersion !== "v4" || typeof launch.launchId !== "string" ||
    !UUID.test(launch.launchId) || launch.chainId !== "4663" ||
    launch.caip2 !== "eip155:4663" ||
    launch.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1" ||
    launch.platformId !== "programmable" || launch.category !== "custom" ||
    !isBytes32(launch.chainDeploymentDescriptorDigest)
  ) throw new Error("Robinhood finalized launch identity is invalid");
  const chainDeployment = normalizeV4ChainDeployment(launch.chainDeployment);
  if (
    canonicalizeJson(chainDeployment) !== canonicalizeJson(launch.chainDeployment) ||
    hashV4ChainDeployment(chainDeployment) !==
      launch.chainDeploymentDescriptorDigest
  ) throw new Error("Robinhood chain deployment binding is invalid");
  const profile = normalizeV4ProfileRef(launch.profile);
  const funding = normalizeV4FundingIntent(launch.funding);
  const liquidityModel = normalizeV4LiquidityModel(launch.liquidityModel);
  if (
    canonicalizeJson(profile) !== canonicalizeJson(launch.profile) ||
    canonicalizeJson(funding) !== canonicalizeJson(launch.funding) ||
    canonicalizeJson(liquidityModel) !== canonicalizeJson(launch.liquidityModel)
  ) throw new Error("Robinhood finalized launch contract is noncanonical");
  const commitments = parseCommitments(launch.commitments);
  const projectMetadata = parseProjectMetadata(
    launch.projectMetadata,
    commitments.metadata,
  );
  const onchain = parseOnchain(launch.onchain, {
    chainDeploymentId: launch.chainDeploymentId,
    chainDeploymentDescriptorDigest: launch.chainDeploymentDescriptorDigest,
    chainDeployment,
    profile,
    commitments,
  });
  const source = parseSourceVerification(
    launch.sourceVerification,
    projectMetadata.tokenTargetId,
  );
  const createdAt = timestamp(launch.createdAt, "launch createdAt");
  const finalizedAt = timestamp(launch.finalizedAt, "launch finalizedAt");
  if (Date.parse(createdAt) > Date.parse(finalizedAt)) {
    throw new Error("Robinhood finalized launch timestamps are invalid");
  }
  return {
    launchId: launch.launchId,
    routerLaunchId: onchain.routerLaunchId,
    projectMetadata,
    l2: onchain.l2,
    l1: onchain.l1,
    evidenceDigest: onchain.evidenceDigest,
    finalizedAt,
    sourceUpdatedAt: source.updatedAt,
    sourceComponents: source.components,
  };
}

function parseOnchain(
  value: JsonValue,
  launch: Readonly<{
    chainDeploymentId: JsonValue;
    chainDeploymentDescriptorDigest: JsonValue;
    chainDeployment: JsonValue;
    profile: JsonValue;
    commitments: JsonValue;
  }>,
) {
  const onchain = exactRecord(value, [
    "schemaVersion", "apiVersion", "chainId", "caip2", "chainDeploymentId",
    "chainDeploymentDescriptorDigest", "chainDeployment", "profile", "router",
    "routerRuntimeCodeHash", "routerLaunchId", "transactionHash", "blockNumber",
    "blockHash", "logIndex", "checkpointType", "l2Inclusion", "l1Posting",
    "l1FinalizedCheckpoint", "finalityPolicy", "commitments", "evidenceDigest",
    "terminal", "observedAt",
  ], "Robinhood onchain evidence");
  const roots = CUSTOM_LAUNCH_ROBINHOOD_TRUST_ROOTS_V4;
  const deployment = record(launch.chainDeployment, "Robinhood chain deployment");
  if (
    onchain.schemaVersion !== "programmable.custom-launch-onchain-evidence.v3" ||
    onchain.apiVersion !== "v4" || onchain.chainId !== "4663" ||
    onchain.caip2 !== "eip155:4663" ||
    onchain.chainDeploymentId !== launch.chainDeploymentId ||
    onchain.chainDeploymentDescriptorDigest !== launch.chainDeploymentDescriptorDigest ||
    canonicalizeJson(onchain.chainDeployment) !==
      canonicalizeJson(launch.chainDeployment) ||
    canonicalizeJson(onchain.profile) !== canonicalizeJson(launch.profile) ||
    canonicalizeJson(onchain.commitments) !== canonicalizeJson(launch.commitments) ||
    canonicalizeJson(onchain.finalityPolicy) !==
      canonicalizeJson(deployment.finality) ||
    !sameHex(onchain.router, roots.programmableLaunchStampRouter.address) ||
    !sameHex(onchain.routerRuntimeCodeHash,
      roots.programmableLaunchStampRouter.runtimeCodeHash) ||
    !isBytes32(onchain.routerLaunchId) || !isBytes32(onchain.transactionHash) ||
    // The backend verifies this digest before removing its private wallet
    // preimage hash. Public consumers can require and snapshot-bind it, but
    // cannot honestly recompute the intentionally redacted preimage.
    !isSha256(onchain.evidenceDigest) ||
    onchain.checkpointType !== "ethereum_finalized" || onchain.terminal !== true
  ) throw new Error("Robinhood onchain evidence identity is invalid");
  timestamp(onchain.observedAt, "onchain observedAt");
  const l2 = exactRecord(onchain.l2Inclusion, [
    "schemaVersion", "chainId", "caip2", "transactionHash", "blockNumber",
    "blockHash", "blockTimestamp", "receiptStatus", "launchEventLogIndex",
    "routeEventLogIndex",
  ], "Robinhood L2 inclusion");
  const blockNumber = positiveDecimal(l2.blockNumber, "L2 block number");
  const blockTimestamp = positiveDecimal(l2.blockTimestamp, "L2 block timestamp");
  if (
    l2.schemaVersion !== "programmable.custom-launch-l2-inclusion.v1" ||
    l2.chainId !== "4663" || l2.caip2 !== "eip155:4663" ||
    l2.receiptStatus !== "success" || !isBytes32(l2.transactionHash) ||
    !sameHex(onchain.transactionHash, l2.transactionHash) ||
    !isBytes32(l2.blockHash) || blockNumber < ROUTER_START_BLOCK ||
    !logNumber(l2.routeEventLogIndex) || !logNumber(l2.launchEventLogIndex) ||
    l2.launchEventLogIndex !== l2.routeEventLogIndex + 1
  ) throw new Error("Robinhood L2 inclusion is invalid");
  const l1Posting = exactRecord(onchain.l1Posting, [
    "schemaVersion", "chainId", "caip2", "rollup", "sequencerInbox",
    "batchNumber", "transactionHash", "blockNumber", "blockHash", "logIndex",
  ], "Robinhood L1 posting");
  const postingBlock = positiveDecimal(l1Posting.blockNumber, "L1 posting block");
  if (
    l1Posting.schemaVersion !== "programmable.custom-launch-l1-posting.v1" ||
    l1Posting.chainId !== "1" || l1Posting.caip2 !== "eip155:1" ||
    !sameHex(l1Posting.rollup, L1_ROLLUP) ||
    !sameHex(l1Posting.sequencerInbox, L1_SEQUENCER_INBOX) ||
    !isDecimal(l1Posting.batchNumber) || !isBytes32(l1Posting.transactionHash) ||
    !isBytes32(l1Posting.blockHash) || !logNumber(l1Posting.logIndex)
  ) throw new Error("Robinhood L1 posting is invalid");
  const finalized = exactRecord(onchain.l1FinalizedCheckpoint, [
    "schemaVersion", "chainId", "caip2", "consensusCheckpointTag",
    "blockNumber", "blockHash", "providerReadbacks",
  ], "Robinhood L1 finalized checkpoint");
  const finalizedBlock = positiveDecimal(finalized.blockNumber,
    "L1 finalized block");
  if (
    finalized.schemaVersion !==
      "programmable.custom-launch-l1-finalized-checkpoint.v1" ||
    finalized.chainId !== "1" || finalized.caip2 !== "eip155:1" ||
    finalized.consensusCheckpointTag !== "finalized" ||
    finalizedBlock < postingBlock || !isBytes32(finalized.blockHash) ||
    !Array.isArray(finalized.providerReadbacks) ||
    finalized.providerReadbacks.length !== 2
  ) throw new Error("Robinhood L1 finalized checkpoint is invalid");
  const expectedProviders = [
    ["drpc", "drpc.org"], ["quicknode", "quicknode.com"],
  ] as const;
  finalized.providerReadbacks.forEach((candidate, index) => {
    const readback = exactRecord(candidate, [
      "providerId", "trustDomain", "blockNumber", "blockHash",
    ], "Robinhood L1 provider readback");
    if (
      readback.providerId !== expectedProviders[index]![0] ||
      readback.trustDomain !== expectedProviders[index]![1] ||
      readback.blockNumber !== finalized.blockNumber ||
      !sameHex(readback.blockHash, finalized.blockHash)
    ) throw new Error("Robinhood L1 provider quorum is invalid");
  });
  if (
    onchain.blockNumber !== finalized.blockNumber ||
    !sameHex(onchain.blockHash, finalized.blockHash) ||
    onchain.logIndex !== l1Posting.logIndex
  ) throw new Error("Robinhood deprecated finality aliases are inconsistent");
  return {
    routerLaunchId: onchain.routerLaunchId as Hex,
    l2: {
      transactionHash: l2.transactionHash as Hex,
      blockNumber,
      blockHash: l2.blockHash as Hex,
      blockTimestamp,
      routeLogIndex: l2.routeEventLogIndex as number,
      launchLogIndex: l2.launchEventLogIndex as number,
    },
    l1: {
      posting: {
        transactionHash: l1Posting.transactionHash as Hex,
        blockNumber: postingBlock,
        blockHash: l1Posting.blockHash as Hex,
        logIndex: l1Posting.logIndex as number,
        sequencerInbox: getAddress(l1Posting.sequencerInbox as string),
        batchNumber: BigInt(l1Posting.batchNumber as string),
      },
      finalized: {
        blockNumber: finalizedBlock,
        blockHash: finalized.blockHash as Hex,
      },
    },
    evidenceDigest: onchain.evidenceDigest as `sha256:${string}`,
  };
}

function parseProjectMetadata(value: JsonValue, metadataCommitment: JsonValue) {
  const metadata = validateProjectMetadata(value, { requireComplete: true });
  if (
    canonicalizeJson(metadata) !== canonicalizeJson(value) ||
    hashProjectMetadata(metadata, { requireComplete: true }) !==
      metadataCommitment
  ) {
    throw new Error("Robinhood project metadata is noncanonical");
  }
  const presentation = metadata.presentation as Readonly<{
    description: string;
    image: Readonly<{ uri: string }>;
    links: readonly Readonly<{
      kind: ProjectMetadataLink["kind"];
      uri: string;
    }>[];
  }>;
  const projectMetadataLinks = presentation.links.map((link) => ({
    kind: link.kind,
    url: link.uri,
  }));
  const links = projectMetadataLinks.flatMap((link): TokenLink[] =>
    link.kind === "website" || link.kind === "x" || link.kind === "telegram"
      ? [{ kind: link.kind, url: link.url }]
      : []
  );
  return {
    token: {
      name: metadata.token.name as string,
      symbol: metadata.token.symbol as string,
    },
    description: presentation.description,
    imageUrl: projectImageUrl(presentation.image.uri),
    links,
    projectMetadataLinks,
    tokenTargetId: metadata.tokenMetadataBinding.tokenTargetId as string,
  };
}

function parseCommitments(value: JsonValue | undefined) {
  const commitments = exactRecord(value, [
    "sourceBuild", "graph", "metadata", "verification", "fundingPermit",
    "launchIntent",
  ], "Robinhood launch commitments");
  if (Object.values(commitments).some((digest) => !isSha256(digest))) {
    throw new Error("Robinhood launch commitments are invalid");
  }
  return commitments;
}

function parseSourceVerification(value: JsonValue, tokenTargetId: string) {
  const source = exactRecord(value, [
    "schemaVersion", "chainId", "caip2", "chainDeploymentId", "status",
    "components", "updatedAt",
  ], "Robinhood source verification");
  if (
    source.schemaVersion !== "programmable.source-verification-status.v4" ||
    source.chainId !== "4663" || source.caip2 !== "eip155:4663" ||
    source.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1" ||
    source.status !== "exact_match" || !Array.isArray(source.components) ||
    source.components.length < 1 || source.components.length > 16
  ) throw new Error("Robinhood source verification is incomplete");
  const updatedAt = timestamp(source.updatedAt, "source verification updatedAt");
  let previousTarget = "";
  const components = source.components.map((candidate) => {
    const component = exactRecord(candidate, [
      "targetId", "address", "status", "providerObservation",
      "exactSourceAuthority", "exactSourceBinding", "updatedAt",
    ], "Robinhood source component");
    if (
      typeof component.targetId !== "string" ||
      !TARGET_ID.test(component.targetId) ||
      component.targetId <= previousTarget || component.status !== "exact_match" ||
      typeof component.address !== "string" ||
      !/^0x[0-9a-f]{40}$/u.test(component.address) ||
      component.exactSourceAuthority !== SOURCE_AUTHORITY
    ) throw new Error("Robinhood source component is incomplete");
    previousTarget = component.targetId;
    const observation = exactRecord(component.providerObservation, [
      "provider", "classification", "match", "creationMatch", "runtimeMatch",
      "releaseAuthority", "evidenceDigest",
    ], "Robinhood source provider observation");
    const binding = exactRecord(component.exactSourceBinding, [
      "schemaVersion", "authority", "coveredEvidence", "bindingDigest",
    ], "Robinhood exact-source binding");
    if (
      observation.provider !== "sourcify-v2" ||
      observation.classification !== "PARTIAL_NO_CBOR_EXACT_BYTES" ||
      observation.match !== "match" || observation.creationMatch !== "match" ||
      observation.runtimeMatch !== "match" || observation.releaseAuthority !== false ||
      !isSha256(observation.evidenceDigest) ||
      binding.schemaVersion !== SOURCE_BINDING_SCHEMA ||
      binding.authority !== SOURCE_AUTHORITY ||
      canonicalizeJson(binding.coveredEvidence) !==
        canonicalizeJson(SOURCE_COVERED_EVIDENCE) ||
      !isSha256(binding.bindingDigest)
    ) throw new Error("Robinhood exact-source binding is incomplete");
    const componentUpdatedAt = timestamp(
      component.updatedAt,
      "source component updatedAt",
    );
    return {
      targetId: component.targetId,
      address: getAddress(component.address),
      updatedAt: componentUpdatedAt,
    };
  });
  if (components.at(-1) === undefined ||
    components.reduce((latest, component) =>
      component.updatedAt > latest ? component.updatedAt : latest,
    components[0]!.updatedAt) !== updatedAt) {
    throw new Error("Robinhood source verification timestamp is inconsistent");
  }
  if (!components.some((component) => component.targetId === tokenTargetId)) {
    throw new Error("Robinhood token source component is missing");
  }
  return { updatedAt, components };
}

async function canonicalBlock(client: RobinhoodFinalizedExploreReaderClientV1,
  number: bigint) {
  const block = await client.getBlock({ blockNumber: number });
  if (block.number !== number || !block.hash || !isBytes32(block.hash)) {
    throw new Error("Robinhood RPC returned an invalid canonical block");
  }
  return { number, hash: block.hash, timestamp: block.timestamp };
}

async function readBoundedJson(response: Response): Promise<JsonValue> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]
    ?.trim().toLowerCase();
  const cacheControl = response.headers.get("cache-control")?.trim().toLowerCase();
  if (
    contentType !== "application/json" ||
    cacheControl !== "public, max-age=15, stale-while-revalidate=300"
  ) {
    throw new Error("Robinhood finalized feed response headers are invalid");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) || declaredLength < 1 ||
      declaredLength > MAXIMUM_PAGE_BYTES
    ) throw new Error("Robinhood finalized feed page has an invalid size");
  }
  if (!response.body) throw new Error("Robinhood finalized feed page is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAXIMUM_PAGE_BYTES) {
        await reader.cancel();
        throw new Error("Robinhood finalized feed page is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Robinhood finalized")) {
      throw error;
    }
    throw new Error("Robinhood finalized feed page is invalid");
  }
  if (!text) throw new Error("Robinhood finalized feed page is empty");
  return parseStrictJson(text, { maximumBytes: MAXIMUM_PAGE_BYTES, maximumDepth: 64 });
}

function exactRecord(value: JsonValue | undefined, keys: readonly string[], label: string) {
  const candidate = record(value, label);
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) throw new Error(`${label} has unknown or missing fields`);
  return candidate;
}

function record(value: JsonValue | undefined, label: string) {
  if (value === null || value === undefined || Array.isArray(value) ||
    typeof value !== "object") throw new Error(`${label} must be an object`);
  return value as Readonly<Record<string, JsonValue>>;
}

function timestamp(value: JsonValue | undefined, label: string) {
  if (
    typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) throw new Error(`${label} is invalid`);
  return value;
}

function safeHttpsUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password || !url.hostname ||
    url.hash || url.hostname === "localhost" || url.hostname.endsWith(".local")
  ) throw new Error("Robinhood presentation URL is unsafe");
  return url.toString();
}

function projectImageUrl(value: string) {
  const url = new URL(value);
  if (url.protocol === "https:") return safeHttpsUrl(value);
  if (url.protocol === "ipfs:") {
    return `${TRUSTED_IPFS_PROJECT_IMAGE_GATEWAY_V1}${url.hostname}`;
  }
  if (url.protocol === "ar:") {
    return `${TRUSTED_ARWEAVE_PROJECT_IMAGE_GATEWAY_V1}${url.hostname}`;
  }
  throw new Error("Robinhood project image URL is invalid");
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && BYTES32.test(value);
}

function isSha256(value: unknown) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && UNSIGNED_DECIMAL.test(value);
}

function positiveDecimal(value: unknown, label: string) {
  if (!isDecimal(value) || value === "0") throw new Error(`${label} is invalid`);
  return BigInt(value);
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function logNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 &&
    value <= 2_147_483_647;
}

function logIndex(log: Log) {
  if (!logNumber(log.logIndex)) throw new Error("Robinhood receipt log index is invalid");
  return log.logIndex;
}

function sameHex(left: unknown, right: unknown) {
  return typeof left === "string" && typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase();
}

function assertCodeHash(code: Hex | undefined, expected: Hex, label: string) {
  if (!code || code === "0x" || !sameHex(keccak256(code), expected)) {
    throw new Error(`Robinhood ${label} runtime code hash mismatch`);
  }
}

async function optionalRead<T>(read: () => Promise<T>) {
  try {
    return await read();
  } catch {
    return null;
  }
}
