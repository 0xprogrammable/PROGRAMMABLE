/* eslint-disable @typescript-eslint/no-explicit-any -- Pinned Developer reference; see README.md. */
import { createHash } from "node:crypto";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  keccak256,
  toEventSelector,
  toFunctionSelector,
  type Abi,
  type AbiEvent,
  type AbiFunction,
  type Address,
  type Hex,
} from "viem";

const DEFAULT_DISCOVERY_URL =
  "https://developers.programmable.family/.well-known/programmable.json";
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;

type Query =
  | { kind: "token" | "component"; address: Address }
  | { kind: "pool"; poolManager: Address; poolId: Hex };

type ReadClient = {
  call(parameters: {
    to: Address;
    data: Hex;
    blockNumber: bigint;
  }): Promise<{ data?: Hex }>;
  getBlock(
    parameters: { blockTag: "finalized" } | { blockNumber: bigint },
  ): Promise<{ number: bigint; hash: Hex }>;
  getBlockNumber(parameters?: { cacheTime?: number }): Promise<bigint>;
  getBytecode(parameters: {
    address: Address;
    blockNumber: bigint;
  }): Promise<Hex | undefined>;
  getChainId(): Promise<number>;
};

type GetterDescriptor = {
  signature: string;
  selector: Hex;
  result: string;
};

type EventDescriptor = {
  name: string;
  signature: string;
  topic0: Hex;
  indexedInputs: string[];
};

type RouterBindings = {
  permitAuthority: Address | null;
  permitAuthorityRuntimeCodeHash: Hex | null;
  graphFactory: Address | null;
  graphFactoryRuntimeCodeHash: Hex | null;
  poolManager: Address | null;
  poolManagerRuntimeCodeHash: Hex | null;
};

type ActiveRouterBindings = {
  [Key in keyof RouterBindings]: NonNullable<RouterBindings[Key]>;
};

type CanaryEvidence = {
  finality: "finalized";
  routeCoverage: {
    customGraphOnchainCanary: boolean;
    classicOnchainCanary: boolean;
  };
  source: {
    sourceRepository: string;
    sourceCommit: string;
    commitSubject: string;
  };
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  launchId: Hex;
  stampHash: Hex;
  launchKind: number;
  components: {
    initializer: Address;
    token: Address;
    hook: Address;
  };
  pool: {
    poolManager: Address;
    poolId: Hex;
    activeLiquidity: string;
  };
  lpPosition: {
    positionManager: Address;
    tokenId: string;
    owner: Address;
  };
  platformFee: {
    feePips: number;
    recipient: Address;
  };
  tokenTotalSupply: string;
  stampProofs: Array<{
    component: Address;
    launchId: Hex;
    stampHash: Hex;
  }>;
  evidenceFileSha256: string;
  evidenceLineSha256: string;
};

type ClassicCanaryEvidence = {
  finality: "finalized";
  source: {
    sourceRepository: string;
    releaseCommit: string;
    releaseTree: string;
    manifestPublication: {
      commit: string;
      tree: string;
      path: string;
      url: string;
      sha256: string;
    };
  };
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  transactionIndex: number;
  launchId: Hex;
  stampHash: Hex;
  launchKind: 2;
  route: {
    launcher: Address;
    launcherRuntimeCodeHash: Hex;
    routePayloadHash: Hex;
    expectedResultHash: Hex;
    permitDigest: Hex;
  };
  components: Array<{
    role: "positionRecipient" | "rewardVault" | "hook" | "token";
    kind: 0 | 1 | 2;
    address: Address;
    runtimeCodeHash: Hex;
  }>;
  pool: {
    poolManager: Address;
    poolId: Hex;
    activeLiquidity: string;
  };
  lpPosition: {
    positionManager: Address;
    tokenId: string;
    owner: Address;
  };
  platformFee: {
    rateBps: number;
    recipient: Address;
  };
  tokenTotalSupply: string;
  verification: {
    verificationBlock: string;
    verificationBlockHash: Hex;
    releaseManifestDigest: Hex;
    releaseBindingDigest: Hex;
    deploymentEvidenceDigest: Hex;
    sourceEvidenceDigest: Hex;
    lifecycleEvidenceDigest: Hex;
  };
};

type ClassicV4Deployment = {
  startBlock: string;
  contracts: {
    launcher: Address;
    hook: Address;
  };
  evidence: {
    sourceRepository: string;
    sourceCommit: string;
    launcherRuntimeCodeHash: Hex;
  };
};

type RouterManifest = {
  status: "prelaunch" | "planned" | "live" | "retired";
  supportsFutureCustom?: boolean;
  supportsFutureClassic?: boolean;
  deploymentEvidence?: { verificationStatus: string; deploymentTransactionHash: Hex; deploymentBlockNumber: string; deploymentBlockHash: Hex };
  address: Address | null;
  startBlock: string | null;
  endBlock: string | null;
  runtimeCodeHash: Hex | null;
  abiUrl: string;
  abiSha256: string | null;
  finalityConfirmations: number | null;
  canaryEvidence: CanaryEvidence | null;
  classicCanaryEvidence: ClassicCanaryEvidence | null;
  atomicSignature: string;
  atomicSelector: Hex;
  bindings: RouterBindings;
  events: {
    launchStamped: EventDescriptor | null;
    launchRouteStamped: EventDescriptor | null;
    componentStamped: EventDescriptor | null;
  };
  getters: Record<string, GetterDescriptor | null>;
};

export async function verifyLaunchStampWithViem({
  query,
  rpcUrl,
  chainId: selectedChainId = 1,
  discoveryUrl = DEFAULT_DISCOVERY_URL,
  block = "finalized",
  rpcFetch,
}: {
  query: Query;
  rpcUrl?: string;
  chainId?: number;
  discoveryUrl?: string;
  block?: "finalized" | bigint;
  rpcFetch?: typeof fetch;
}) {
  const discovery = await fetchJson(discoveryUrl);
  if (!Number.isSafeInteger(selectedChainId) || selectedChainId <= 0) {
    return result("indeterminate", "chain-id-invalid", query);
  }
  const selected = discovery.chains?.find((chain: { chainId: number }) => chain.chainId === selectedChainId);
  const manifestUrl = selected?.manifestUrl ?? (selectedChainId === 1 ? discovery.manifestUrl : null);
  if (!manifestUrl) return result("unavailable", "chain-not-discovered", query);
  const manifest = await fetchJson(manifestUrl);
  if (manifest.chainId !== selectedChainId ||
      (selectedChainId !== 1 && manifest.caip2 !== `eip155:${selectedChainId}`)) {
    return result("indeterminate", "manifest-chain-mismatch", query);
  }
  const router = manifest.launchStampRouter as RouterManifest | undefined;

  if (
    !router ||
    (router.status !== "live" && router.status !== "retired") ||
    !router.address ||
    !router.startBlock ||
    !router.runtimeCodeHash ||
    !router.abiSha256 ||
    typeof router.finalityConfirmations !== "number" ||
    !Number.isInteger(router.finalityConfirmations) ||
    router.finalityConfirmations <= 0 ||
    !router.atomicSignature ||
    !router.atomicSelector ||
    !completeBindings(router.bindings) ||
    !router.events.launchStamped ||
    !router.events.launchRouteStamped ||
    !router.events.componentStamped ||
    !router.getters.chainId ||
    !router.getters.permitAuthority ||
    !router.getters.permitAuthorityRuntimeCodeHash ||
    !router.getters.graphFactory ||
    !router.getters.graphFactoryRuntimeCodeHash ||
    !router.getters.poolManager ||
    !router.getters.poolManagerRuntimeCodeHash ||
    !router.getters.token ||
    !router.getters.pool ||
    !router.getters.component ||
    !router.getters.componentRuntimeCodeHash ||
    !router.getters.record ||
    !router.getters.stampProof ||
    !(manifest.chainId === 4663
      ? completeRobinhoodCanary(router, manifest)
      : completeCanaryEvidence(router.canaryEvidence, router) &&
        completeClassicCanaryEvidence(router.classicCanaryEvidence, router, manifest))
  ) {
    return result("unavailable", "router-prelaunch-or-incomplete", query);
  }
  if (!rpcUrl) return result("indeterminate", "missing-rpc-url", query);

  let checkedRpcUrl: URL;
  try {
    checkedRpcUrl = checkedHttpsOrLocalUrl(rpcUrl);
  } catch {
    return result("indeterminate", "rpc-https-required", query);
  }
  const client = createPublicClient({
    transport: http(checkedRpcUrl.toString(), { fetchFn: rpcFetch, timeout: 8_000, retryCount: 0 }),
  }) as unknown as ReadClient;
  try {
    const chainId = await client.getChainId();
    if (chainId !== manifest.chainId) {
      return result("indeterminate", "chain-mismatch", query);
    }

    const canonicalBlock =
      block === "finalized"
        ? await client.getBlock({ blockTag: "finalized" })
        : await client.getBlock({ blockNumber: block });
    const blockNumber = canonicalBlock.number;
    const blockHash = canonicalBlock.hash;
    if (block !== "finalized" && selectedChainId === 4663) {
      const finalized = await client.getBlock({ blockTag: "finalized" });
      if (!finalized.hash || blockNumber > finalized.number) {
        return result("indeterminate", "block-not-finalized", query);
      }
    } else if (block !== "finalized") {
      const chainHead = await client.getBlockNumber({ cacheTime: 0 });
      const requiredConfirmations = BigInt(router.finalityConfirmations);
      if (
        chainHead < blockNumber ||
        chainHead - blockNumber < requiredConfirmations
      ) {
        return result("indeterminate", "block-finality-insufficient", query);
      }
    }
    if (blockNumber < BigInt(router.startBlock)) {
      return result("unavailable", "block-before-router-start", query);
    }
    if (
      router.status === "retired" &&
      (!router.endBlock || blockNumber > BigInt(router.endBlock))
    ) {
      return result("unavailable", "block-outside-router-range", query);
    }

    const code = await client.getBytecode({
      address: router.address,
      blockNumber,
    });
    if (!code || keccak256(code) !== router.runtimeCodeHash) {
      return result("indeterminate", "router-runtime-mismatch", query);
    }

    const { abi, sha256 } = await fetchAbi(router.abiUrl);
    if (sha256 !== router.abiSha256) {
      return result("indeterminate", "router-abi-hash-mismatch", query);
    }
    validatePublishedAbi(abi, router);
    await validateImmutableBindings({
      abi,
      bindings: router.bindings,
      blockNumber,
      chainId,
      client,
      router,
      routerAddress: router.address,
    });

    const pointDescriptor = router.getters[query.kind]!;
    const pointFunction = describedFunction(abi, pointDescriptor);
    const pointArgs =
      query.kind === "pool"
        ? [query.poolManager, query.poolId]
        : [query.address];
    const launchId = (await callFunction({
      client,
      router: router.address,
      blockNumber,
      item: pointFunction,
      args: pointArgs,
    })) as Hex;

    if (launchId === ZERO_BYTES32) {
      await requireUnchangedBlock(client, blockNumber, blockHash);
      return {
        ...result("not-stamped", "zero-launch-id", query),
        chainId,
        router: router.address,
        blockNumber,
        blockHash: canonicalBlock.hash,
        launchId: null,
      };
    }

    const recordFunction = describedFunction(abi, router.getters.record);
    const decodedRecord = await callFunction({
      client,
      router: router.address,
      blockNumber,
      item: recordFunction,
      args: [launchId],
    });
    const record = namedOutputs(recordFunction, decodedRecord);
    const requiredRecordHashes = [
      "poolId",
      "poolKeyHash",
      "componentSetHash",
      "routePayloadHash",
      "routeLauncherRuntimeCodeHash",
      "expectedResultHash",
      "permitDigest",
      "stampHash",
    ];
    if (
      requiredRecordHashes.some(
        (field) => !nonzeroHash32(record[field]),
      ) ||
      ["launchWallet", "token", "hook", "poolManager", "routeLauncher"].some(
        (field) => normalizeAddress(record[field]) === null,
      )
    ) {
      return result("indeterminate", "stamp-record-empty", query);
    }
    if (
      query.kind === "token" &&
      normalizeAddress(record.token) !== query.address.toLowerCase()
    ) {
      return result("indeterminate", "stamp-record-token-mismatch", query);
    }
    if (
      query.kind === "pool" &&
      (normalizeAddress(record.poolManager) !== query.poolManager.toLowerCase() ||
        String(record.poolId).toLowerCase() !== query.poolId.toLowerCase())
    ) {
      return result("indeterminate", "stamp-record-pool-mismatch", query);
    }

    const classification = classifyLaunchKind(record.kind);
    if (selectedChainId === 4663 && classification?.category !== "custom") {
      return result("indeterminate", "launch-kind-not-supported-on-chain", query);
    }
    if (!classification) {
      return result("indeterminate", "launch-kind-unknown", query);
    }
    if (
      normalizeAddress(record.poolManager) !==
      normalizeAddress(router.bindings.poolManager)
    ) {
      return result("indeterminate", "stamp-record-pool-manager-mismatch", query);
    }
    if (
      classification.kind === "CustomGraph" &&
      (normalizeAddress(record.routeLauncher) !==
        normalizeAddress(router.bindings.graphFactory) ||
        String(record.routeLauncherRuntimeCodeHash).toLowerCase() !==
          router.bindings.graphFactoryRuntimeCodeHash?.toLowerCase())
    ) {
      return result("indeterminate", "custom-graph-route-binding-mismatch", query);
    }
    const routeCode = await client.getBytecode({
      address: record.routeLauncher as Address,
      blockNumber,
    });
    const observedRouteRuntime = routeCode ? keccak256(routeCode) : null;

    let componentRuntime = null;
    if (query.kind === "token" || query.kind === "component") {
      const proofFunction = describedFunction(abi, router.getters.stampProof);
      const decodedProof = await callFunction({
        client,
        router: router.address,
        blockNumber,
        item: proofFunction,
        args: [query.address],
      });
      const proof = namedOutputs(proofFunction, decodedProof);
      if (
        String(proof.launchId).toLowerCase() !== launchId.toLowerCase() ||
        String(proof.stampHash).toLowerCase() !==
          String(record.stampHash).toLowerCase()
      ) {
        return result("indeterminate", "stamp-proof-mismatch", query);
      }

      const runtimeFunction = describedFunction(
        abi,
        router.getters.componentRuntimeCodeHash,
      );
      const recorded = (await callFunction({
        client,
        router: router.address,
        blockNumber,
        item: runtimeFunction,
        args: [query.address],
      })) as Hex;
      if (!nonzeroHash32(recorded)) {
        return result("indeterminate", "component-runtime-record-missing", query);
      }
      const observedCode = await client.getBytecode({
        address: query.address,
        blockNumber,
      });
      componentRuntime = {
        recorded,
        observed: observedCode ? keccak256(observedCode) : null,
        matches: observedCode ? keccak256(observedCode) === recorded : null,
      };
    }

    await requireUnchangedBlock(client, blockNumber, blockHash);
    return {
      state: "stamped",
      reason: "canonical-router-record",
      chainId,
      router: router.address,
      routerStartBlock: router.startBlock,
      blockNumber,
      blockHash: canonicalBlock.hash,
      query,
      launchId,
      launchKind: classification.kind,
      category: classification.category,
      publicLabel: classification.publicLabel,
      stampHash: record.stampHash,
      route: {
        launcher: record.routeLauncher,
        recordedRuntimeCodeHash: record.routeLauncherRuntimeCodeHash,
        observedRuntimeCodeHash: observedRouteRuntime,
        runtimeMatches:
          observedRouteRuntime === null
            ? null
            : observedRouteRuntime === record.routeLauncherRuntimeCodeHash,
        routePayloadHash: record.routePayloadHash,
        expectedResultHash: record.expectedResultHash,
        permitDigest: record.permitDigest,
      },
      componentRuntime,
      claim: "provenance-only",
    };
  } catch {
    return result("indeterminate", "verification-failed", query);
  }
}

async function callFunction({
  client,
  router,
  blockNumber,
  item,
  args,
}: {
  client: ReadClient;
  router: Address;
  blockNumber: bigint;
  item: AbiFunction;
  args: readonly unknown[];
}) {
  const data = encodeFunctionData({
    abi: [item] as Abi,
    functionName: item.name,
    args,
  });
  const response = await client.call({ to: router, data, blockNumber });
  if (!response.data) throw new Error("empty eth_call result");
  return decodeFunctionResult({
    abi: [item] as Abi,
    functionName: item.name,
    data: response.data,
  });
}

function validatePublishedAbi(abi: Abi, router: RouterManifest) {
  for (const descriptor of Object.values(router.getters)) {
    if (descriptor) describedFunction(abi, descriptor);
  }
  for (const descriptor of Object.values(router.events)) {
    if (!descriptor) throw new Error("missing event descriptor");
    const item = abi.find(
      (candidate): candidate is AbiEvent =>
        candidate.type === "event" && eventSignature(candidate) === descriptor.signature,
    );
    if (!item || toEventSelector(item) !== descriptor.topic0) {
      throw new Error("event topic mismatch");
    }
    const indexedInputs = item.inputs
      .filter(({ indexed }) => indexed)
      .map(({ name }) => name);
    if (JSON.stringify(indexedInputs) !== JSON.stringify(descriptor.indexedInputs)) {
      throw new Error("event indexed layout mismatch");
    }
  }

  const atomic = abi.find(
    (candidate): candidate is AbiFunction =>
      candidate.type === "function" &&
      functionSignature(candidate) === router.atomicSignature,
  );
  if (
    !atomic ||
    atomic.stateMutability !== "payable" ||
    toFunctionSelector(atomic) !== router.atomicSelector
  ) {
    throw new Error("atomic selector mismatch");
  }
  const payableFunctions = abi.filter(
    (candidate): candidate is AbiFunction =>
      candidate.type === "function" && candidate.stateMutability === "payable",
  );
  if (payableFunctions.length !== 1 || payableFunctions[0] !== atomic) {
    throw new Error("unexpected payable Router function");
  }
}

async function validateImmutableBindings({
  abi,
  bindings,
  blockNumber,
  chainId,
  client,
  router,
  routerAddress,
}: {
  abi: Abi;
  bindings: ActiveRouterBindings;
  blockNumber: bigint;
  chainId: number;
  client: ReadClient;
  router: RouterManifest;
  routerAddress: Address;
}) {
  const expectations: Array<{
    getter: string;
    expected: Address | Hex | bigint;
    kind: "address" | "hash" | "uint";
  }> = [
    { getter: "chainId", expected: BigInt(chainId), kind: "uint" },
    {
      getter: "permitAuthority",
      expected: bindings.permitAuthority,
      kind: "address",
    },
    {
      getter: "permitAuthorityRuntimeCodeHash",
      expected: bindings.permitAuthorityRuntimeCodeHash,
      kind: "hash",
    },
    {
      getter: "graphFactory",
      expected: bindings.graphFactory,
      kind: "address",
    },
    {
      getter: "graphFactoryRuntimeCodeHash",
      expected: bindings.graphFactoryRuntimeCodeHash,
      kind: "hash",
    },
    {
      getter: "poolManager",
      expected: bindings.poolManager,
      kind: "address",
    },
    {
      getter: "poolManagerRuntimeCodeHash",
      expected: bindings.poolManagerRuntimeCodeHash,
      kind: "hash",
    },
  ];

  for (const { getter, expected, kind } of expectations) {
    const item = describedFunction(abi, router.getters[getter]);
    const observed = await callFunction({
      client,
      router: routerAddress,
      blockNumber,
      item,
      args: [],
    });
    const matches =
      kind === "uint"
        ? BigInt(observed as bigint) === expected
        : kind === "address"
          ? normalizeAddress(observed) === normalizeAddress(expected)
          : String(observed).toLowerCase() === String(expected).toLowerCase();
    if (!matches) throw new Error(`immutable ${getter} mismatch`);
  }

  for (const [addressKey, hashKey] of [
    ["permitAuthority", "permitAuthorityRuntimeCodeHash"],
    ["graphFactory", "graphFactoryRuntimeCodeHash"],
    ["poolManager", "poolManagerRuntimeCodeHash"],
  ] as const) {
    const code = await client.getBytecode({
      address: bindings[addressKey],
      blockNumber,
    });
    if (!code || keccak256(code) !== bindings[hashKey]) {
      throw new Error(`binding ${addressKey} runtime mismatch`);
    }
  }
}

async function requireUnchangedBlock(
  client: ReadClient,
  blockNumber: bigint,
  expectedHash: Hex,
) {
  const closingBlock = await client.getBlock({ blockNumber });
  if (closingBlock.hash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error("canonical block changed during verification");
  }
}

function describedFunction(abi: Abi, descriptor: GetterDescriptor | null) {
  if (!descriptor) throw new Error("missing getter descriptor");
  const item = abi.find(
    (candidate): candidate is AbiFunction =>
      candidate.type === "function" &&
      functionSignature(candidate) === descriptor.signature,
  );
  if (!item || toFunctionSelector(item) !== descriptor.selector) {
    throw new Error("getter selector mismatch");
  }
  return item;
}

function namedOutputs(item: AbiFunction, decoded: unknown) {
  if (item.outputs.length === 1 && item.outputs[0].type === "tuple") {
    return decoded as Record<string, unknown>;
  }
  if (!Array.isArray(decoded)) throw new Error("record output is not a tuple");
  return Object.fromEntries(
    item.outputs.map((output, index) => [output.name || String(index), decoded[index]]),
  );
}

function classifyLaunchKind(value: unknown) {
  const kind = BigInt(value as bigint);
  if (kind === 1n) {
    return {
      kind: "CustomGraph",
      category: "custom",
      publicLabel: "Programmable Custom",
    };
  }
  if (kind === 2n) {
    return {
      kind: "Classic",
      category: "classic",
      publicLabel: "Programmable Classic",
    };
  }
  return null;
}

function completeBindings(
  bindings: RouterBindings | undefined,
): bindings is ActiveRouterBindings {
  return Boolean(
    nonzeroAddress(bindings?.permitAuthority) &&
      nonzeroHash32(bindings?.permitAuthorityRuntimeCodeHash) &&
      nonzeroAddress(bindings?.graphFactory) &&
      nonzeroHash32(bindings?.graphFactoryRuntimeCodeHash) &&
      nonzeroAddress(bindings?.poolManager) &&
      nonzeroHash32(bindings?.poolManagerRuntimeCodeHash),
  );
}

function completeRobinhoodCanary(router: RouterManifest, manifest: any) {
  const direct = manifest.directChainIntegration;
  const evidence = router.canaryEvidence;
  const deployment = router.deploymentEvidence;
  return direct?.schemaVersion === "programmable.direct-chain-integration.v1" &&
    direct.status === "live" && direct.platformId === "programmable" &&
    direct.category === "custom" && direct.publicLabel === "Programmable Custom" &&
    direct.indexing === "direct-chain" && direct.publicWrites === false &&
    direct.finality?.mode === "rpc-finalized" &&
    direct.finality.explicitBlockRequiresFinalizedAncestor === true &&
    router.supportsFutureCustom === true && router.supportsFutureClassic === false &&
    deployment?.verificationStatus === "finalized-verified" &&
    nonzeroHash32(deployment.deploymentTransactionHash) && nonzeroHash32(deployment.deploymentBlockHash) &&
    decimal(deployment.deploymentBlockNumber) && deployment.deploymentBlockNumber === router.startBlock &&
    evidence?.finality === "finalized" &&
    nonzeroHash32(evidence.transactionHash) && nonzeroHash32(evidence.blockHash) &&
    nonzeroHash32(evidence.launchId) && decimal(evidence.blockNumber) &&
    BigInt(evidence.blockNumber) >= BigInt(router.startBlock);
}

function completeCanaryEvidence(
  value: CanaryEvidence | null | undefined,
  router: RouterManifest,
): value is CanaryEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as Partial<CanaryEvidence>;
  if (
    evidence.finality !== "finalized" ||
    evidence.routeCoverage?.customGraphOnchainCanary !== true ||
    evidence.routeCoverage?.classicOnchainCanary !== true ||
    !remoteHttpsUrl(evidence.source?.sourceRepository) ||
    !sourceCommit(evidence.source?.sourceCommit) ||
    typeof evidence.source?.commitSubject !== "string" ||
    evidence.source.commitSubject.trim().length === 0 ||
    !nonzeroHash32(evidence.transactionHash) ||
    !decimal(evidence.blockNumber) ||
    !decimal(router.startBlock) ||
    BigInt(evidence.blockNumber) < BigInt(router.startBlock) ||
    !nonzeroHash32(evidence.blockHash) ||
    !nonzeroHash32(evidence.launchId) ||
    !nonzeroHash32(evidence.stampHash) ||
    evidence.launchKind !== 1 ||
    !sha256Digest(evidence.evidenceFileSha256) ||
    !sha256Digest(evidence.evidenceLineSha256)
  ) {
    return false;
  }

  const componentAddresses = [
    evidence.components?.initializer,
    evidence.components?.token,
    evidence.components?.hook,
  ];
  const normalizedComponents = componentAddresses.map((component) =>
    nonzeroAddress(component) ? normalizeAddress(component) : null,
  );
  if (
    normalizedComponents.some((component) => component === null) ||
    new Set(normalizedComponents).size !== 3
  ) {
    return false;
  }

  if (
    !nonzeroAddress(evidence.pool?.poolManager) ||
    normalizeAddress(evidence.pool?.poolManager) !==
      normalizeAddress(router.bindings.poolManager) ||
    !nonzeroHash32(evidence.pool?.poolId) ||
    !positiveDecimal(evidence.pool?.activeLiquidity) ||
    !nonzeroAddress(evidence.lpPosition?.positionManager) ||
    !positiveDecimal(evidence.lpPosition?.tokenId) ||
    !nonzeroAddress(evidence.lpPosition?.owner) ||
    !Number.isSafeInteger(evidence.platformFee?.feePips) ||
    (evidence.platformFee?.feePips ?? -1) < 0 ||
    (evidence.platformFee?.feePips ?? 1_000_001) > 1_000_000 ||
    !nonzeroAddress(evidence.platformFee?.recipient) ||
    !positiveDecimal(evidence.tokenTotalSupply) ||
    !Array.isArray(evidence.stampProofs) ||
    evidence.stampProofs.length !== 3
  ) {
    return false;
  }

  const proofComponents: string[] = [];
  for (const proof of evidence.stampProofs) {
    const component = normalizeAddress(proof?.component);
    if (
      component === null ||
      !sameHash32(proof?.launchId, evidence.launchId) ||
      !sameHash32(proof?.stampHash, evidence.stampHash)
    ) {
      return false;
    }
    proofComponents.push(component);
  }
  return (
    new Set(proofComponents).size === 3 &&
    normalizedComponents.every(
      (component) => component !== null && proofComponents.includes(component),
    )
  );
}

function completeClassicCanaryEvidence(
  value: ClassicCanaryEvidence | null | undefined,
  router: RouterManifest,
  manifest: {
    deployments?: Array<Record<string, unknown>>;
    platformFee?: { rateBps?: unknown; recipient?: unknown };
  },
): value is ClassicCanaryEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as Partial<ClassicCanaryEvidence>;
  const release = activeClassicV4Deployment(manifest);
  if (!release || !decimal(router.startBlock)) return false;
  const publication = evidence.source?.manifestPublication;
  const expectedPublicationUrl = rawGithubUrl(
    evidence.source?.sourceRepository,
    publication?.commit,
    publication?.path,
  );

  if (
    evidence.finality !== "finalized" ||
    !remoteHttpsUrl(evidence.source?.sourceRepository) ||
    evidence.source?.sourceRepository !== release.evidence.sourceRepository ||
    !sourceCommit(evidence.source?.releaseCommit) ||
    evidence.source.releaseCommit !== release.evidence.sourceCommit ||
    !sourceCommit(evidence.source?.releaseTree) ||
    !sourceCommit(publication?.commit) ||
    !sourceCommit(publication?.tree) ||
    !releaseManifestPath(publication?.path) ||
    !remoteHttpsUrl(publication?.url) ||
    expectedPublicationUrl === null ||
    publication?.url !== expectedPublicationUrl ||
    !sha256Digest(publication?.sha256) ||
    !nonzeroHash32(evidence.transactionHash) ||
    !decimal(evidence.blockNumber) ||
    BigInt(evidence.blockNumber) < BigInt(router.startBlock) ||
    BigInt(evidence.blockNumber) < BigInt(release.startBlock) ||
    !nonzeroHash32(evidence.blockHash) ||
    !Number.isSafeInteger(evidence.transactionIndex) ||
    (evidence.transactionIndex ?? -1) < 0 ||
    !nonzeroHash32(evidence.launchId) ||
    !nonzeroHash32(evidence.stampHash) ||
    evidence.launchKind !== 2
  ) {
    return false;
  }

  if (
    !nonzeroAddress(evidence.route?.launcher) ||
    normalizeAddress(evidence.route.launcher) !==
      normalizeAddress(release.contracts.launcher) ||
    !nonzeroHash32(evidence.route.launcherRuntimeCodeHash) ||
    !sameHash32(
      evidence.route.launcherRuntimeCodeHash,
      release.evidence.launcherRuntimeCodeHash,
    ) ||
    !nonzeroHash32(evidence.route.routePayloadHash) ||
    !nonzeroHash32(evidence.route.expectedResultHash) ||
    !nonzeroHash32(evidence.route.permitDigest)
  ) {
    return false;
  }

  const expectedKinds = new Map<string, number>([
    ["positionRecipient", 0],
    ["rewardVault", 0],
    ["hook", 2],
    ["token", 1],
  ]);
  if (!Array.isArray(evidence.components) || evidence.components.length !== 4) {
    return false;
  }
  const componentsByRole = new Map<
    string,
    ClassicCanaryEvidence["components"][number]
  >();
  const componentAddresses = new Set<string>();
  for (const component of evidence.components) {
    const expectedKind = expectedKinds.get(component?.role);
    const normalized = normalizeAddress(component?.address);
    if (
      expectedKind === undefined ||
      component?.kind !== expectedKind ||
      normalized === null ||
      !nonzeroAddress(component.address) ||
      !nonzeroHash32(component.runtimeCodeHash) ||
      componentsByRole.has(component.role) ||
      componentAddresses.has(normalized)
    ) {
      return false;
    }
    componentsByRole.set(component.role, component);
    componentAddresses.add(normalized);
  }
  const hook = componentsByRole.get("hook");
  const token = componentsByRole.get("token");
  const positionRecipient = componentsByRole.get("positionRecipient");
  if (
    componentsByRole.size !== expectedKinds.size ||
    !hook ||
    !token ||
    !positionRecipient ||
    normalizeAddress(hook.address) !== normalizeAddress(release.contracts.hook) ||
    !nonzeroAddress(token.address)
  ) {
    return false;
  }

  const configuredFeeBps = manifest.platformFee?.rateBps;
  if (
    !nonzeroAddress(evidence.pool?.poolManager) ||
    normalizeAddress(evidence.pool.poolManager) !==
      normalizeAddress(router.bindings.poolManager) ||
    !nonzeroHash32(evidence.pool.poolId) ||
    !positiveDecimal(evidence.pool.activeLiquidity) ||
    !nonzeroAddress(evidence.lpPosition?.positionManager) ||
    !positiveDecimal(evidence.lpPosition.tokenId) ||
    !nonzeroAddress(evidence.lpPosition.owner) ||
    normalizeAddress(evidence.lpPosition.owner) !==
      normalizeAddress(positionRecipient.address) ||
    !Number.isSafeInteger(evidence.platformFee?.rateBps) ||
    (evidence.platformFee?.rateBps ?? -1) < 0 ||
    (evidence.platformFee?.rateBps ?? 10_001) > 10_000 ||
    !decimal(configuredFeeBps) ||
    BigInt(evidence.platformFee?.rateBps ?? -1) !== BigInt(configuredFeeBps) ||
    !nonzeroAddress(evidence.platformFee?.recipient) ||
    normalizeAddress(evidence.platformFee.recipient) !==
      normalizeAddress(manifest.platformFee?.recipient) ||
    !positiveDecimal(evidence.tokenTotalSupply)
  ) {
    return false;
  }

  if (
    !decimal(evidence.verification?.verificationBlock) ||
    BigInt(evidence.verification.verificationBlock) <
      BigInt(evidence.blockNumber) ||
    !nonzeroHash32(evidence.verification.verificationBlockHash) ||
    !nonzeroHash32(evidence.verification.releaseManifestDigest) ||
    !nonzeroHash32(evidence.verification.releaseBindingDigest) ||
    !nonzeroHash32(evidence.verification.deploymentEvidenceDigest) ||
    !nonzeroHash32(evidence.verification.sourceEvidenceDigest) ||
    !nonzeroHash32(evidence.verification.lifecycleEvidenceDigest)
  ) {
    return false;
  }
  return true;
}

function activeClassicV4Deployment(manifest: {
  deployments?: Array<Record<string, unknown>>;
}): ClassicV4Deployment | null {
  if (!Array.isArray(manifest.deployments)) return null;
  const matches = manifest.deployments.filter((deployment) => {
    const contracts = deployment.contracts as Record<string, unknown> | undefined;
    const evidence = deployment.evidence as Record<string, unknown> | undefined;
    return (
      deployment.category === "classic" &&
      deployment.modelId === "classic" &&
      deployment.modelVersion === "4" &&
      deployment.lifecycle === "current" &&
      deployment.discovery === "enabled" &&
      decimal(deployment.startBlock) &&
      nonzeroAddress(contracts?.launcher) &&
      nonzeroAddress(contracts?.hook) &&
      remoteHttpsUrl(evidence?.sourceRepository) &&
      sourceCommit(evidence?.sourceCommit) &&
      nonzeroHash32(evidence?.launcherRuntimeCodeHash)
    );
  });
  return matches.length === 1 ? (matches[0] as unknown as ClassicV4Deployment) : null;
}

function functionSignature(item: AbiFunction) {
  return `${item.name}(${item.inputs.map(canonicalType).join(",")})`;
}

function eventSignature(item: AbiEvent) {
  return `${item.name}(${item.inputs.map(canonicalType).join(",")})`;
}

function canonicalType(input: {
  type: string;
  components?: readonly unknown[];
}): string {
  if (!input.type.startsWith("tuple")) return input.type;
  const suffix = input.type.slice("tuple".length);
  const components = (input.components ?? []) as readonly {
    type: string;
    components?: readonly unknown[];
  }[];
  return `(${components.map(canonicalType).join(",")})${suffix}`;
}

async function fetchAbi(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`ABI HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    abi: JSON.parse(new TextDecoder().decode(bytes)) as Abi,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

async function fetchJson(url: string) {
  const parsed = checkedHttpsOrLocalUrl(url);
  const response = await fetch(parsed, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function checkedHttpsOrLocalUrl(value: string) {
  const parsed = new URL(value);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.username || parsed.password) throw new Error("credentials in URL");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    throw new Error("HTTPS required");
  }
  return parsed;
}

function normalizeAddress(value: unknown) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function nonzeroAddress(value: unknown): value is Address {
  const normalized = normalizeAddress(value);
  return normalized !== null && normalized !== `0x${"0".repeat(40)}`;
}

function nonzeroHash32(value: unknown): value is Hex {
  return (
    typeof value === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(value) &&
    value.toLowerCase() !== ZERO_BYTES32
  );
}

function sameHash32(left: unknown, right: unknown) {
  return (
    nonzeroHash32(left) &&
    nonzeroHash32(right) &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function decimal(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function positiveDecimal(value: unknown): value is string {
  return decimal(value) && BigInt(value) > 0n;
}

function sourceCommit(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function releaseManifestPath(value: unknown): value is string {
  return value === "contracts/deployments/mainnet-classic-v4.json";
}

function rawGithubUrl(
  sourceRepository: unknown,
  commit: unknown,
  path: unknown,
): string | null {
  if (!sourceCommit(commit) || !releaseManifestPath(path)) return null;
  const match =
    typeof sourceRepository === "string"
      ? /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(sourceRepository)
      : null;
  if (!match) return null;
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${commit}/${path}`;
}

function sha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function remoteHttpsUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.length > 0 &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function result(state: string, reason: string, query: Query) {
  return { state, reason, query, claim: "provenance-only" };
}
