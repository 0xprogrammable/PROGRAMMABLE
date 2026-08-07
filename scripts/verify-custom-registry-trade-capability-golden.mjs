import {
  encodeAbiParameters,
  keccak256,
  stringToHex,
} from "viem";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FIELD_TYPES = Object.freeze({
  tradeRoute: Object.freeze([
    ["marketId", "bytes32"],
    ["marketPathId", "bytes32"],
    ["mode", "uint8"],
    ["activationBlock", "uint64"],
    ["paused", "bool"],
    ["retired", "bool"],
    ["adapterId", "bytes32"],
    ["adapterVersion", "bytes32"],
    ["executionTarget", "address"],
    ["executionTargetRuntimeCodeHash", "bytes32"],
    ["proxy", "bool"],
    ["proxyKind", "uint8"],
    ["proxyBindingEvidenceHash", "bytes32"],
    ["proxyPolicyHash", "bytes32"],
    ["implementation", "address"],
    ["implementationRuntimeCodeHash", "bytes32"],
    ["admin", "address"],
    ["adminRuntimeCodeHash", "bytes32"],
    ["beacon", "address"],
    ["beaconRuntimeCodeHash", "bytes32"],
    ["executionSelector", "bytes4"],
    ["interfaceId", "bytes4"],
    ["poolManager", "address"],
    ["poolManagerRuntimeCodeHash", "bytes32"],
    ["permit2", "address"],
    ["permit2RuntimeCodeHash", "bytes32"],
    ["quoteSupported", "bool"],
    ["simulationSupported", "bool"],
    ["quoter", "address"],
    ["quoterRuntimeCodeHash", "bytes32"],
    ["readSupported", "bool"],
    ["stateView", "address"],
    ["stateViewRuntimeCodeHash", "bytes32"],
    ["hook", "address"],
    ["hookRuntimeCodeHash", "bytes32"],
    ["hookPermissionsHash", "bytes32"],
    ["hookReviewEvidenceHash", "bytes32"],
    ["beforeSwapReturnDeltaEnabled", "bool"],
    ["callerAllowlistHash", "bytes32"],
    ["plannerCommandPolicyHash", "bytes32"],
    ["hookDataPolicyHash", "bytes32"],
    ["calldataPolicyHash", "bytes32"],
    ["valuePolicyHash", "bytes32"],
    ["recipientPolicyHash", "bytes32"],
    ["deadlinePolicyHash", "bytes32"],
    ["slippagePolicyHash", "bytes32"],
    ["permit2PolicyHash", "bytes32"],
    ["deltaAccountingPolicyHash", "bytes32"],
    ["settlementPolicyHash", "bytes32"],
    ["nonstandardTokenPolicyHash", "bytes32"],
    ["dependencyRuntimeCodeSetHash", "bytes32"],
    ["configurationHash", "bytes32"],
    ["evidenceHash", "bytes32"],
  ]),
  marketDataSource: Object.freeze([
    ["marketId", "bytes32"],
    ["sourceId", "bytes32"],
    ["kind", "uint8"],
    ["emitter", "address"],
    ["emitterRuntimeCodeHash", "bytes32"],
    ["proxy", "bool"],
    ["proxyKind", "uint8"],
    ["proxyBindingEvidenceHash", "bytes32"],
    ["proxyPolicyHash", "bytes32"],
    ["implementation", "address"],
    ["implementationRuntimeCodeHash", "bytes32"],
    ["admin", "address"],
    ["adminRuntimeCodeHash", "bytes32"],
    ["beacon", "address"],
    ["beaconRuntimeCodeHash", "bytes32"],
    ["startBlock", "uint64"],
    ["topic0", "bytes32"],
    ["eventAbiHash", "bytes32"],
    ["filterHash", "bytes32"],
    ["metricsHash", "bytes32"],
    ["metricIds", "bytes32[]"],
    ["derivationPolicyHash", "bytes32"],
    ["stateView", "address"],
    ["stateViewRuntimeCodeHash", "bytes32"],
    ["readSelector", "bytes4"],
    ["configurationHash", "bytes32"],
    ["evidenceHash", "bytes32"],
  ]),
});

const DOMAIN_PREIMAGES = Object.freeze({
  tradeCapability: "programmable.trade-capability.v1",
  tradeRoute: "programmable.trade-route.v1",
  tradeRouteSet: "programmable.trade-route-set.v1",
  marketIdentity: "programmable.trade-market-identity.v1",
  marketSet: "programmable.trade-market-set.v1",
  marketDataSource: "programmable.market-data-source.v1",
  marketDataSourceSet: "programmable.market-data-source-set.v1",
  marketDataMetricSet: "programmable.market-data-metric-set.v1",
  revocationPolicy:
    "programmable.trade-capability.runtime-drift-revokes-execution.v1",
  marketEventAbi: "programmable.market-event-abi.v1",
  marketEventFilter: "programmable.market-event-filter.v1",
  marketDataDerivation: "programmable.market-data-derivation.v1",
});

const METRIC_PREIMAGES = Object.freeze({
  charting: "programmable.market-data-metric.charting.v1",
  price: "programmable.market-data-metric.price.v1",
  volume: "programmable.market-data-metric.volume.v1",
  liquidity: "programmable.market-data-metric.liquidity.v1",
});

const EVENT_SIGNATURES = Object.freeze({
  summary:
    "CustomLaunchExecutionPolicyBoundV2(bytes32,bytes32,bytes32,bytes32,uint32,bytes32,uint32,bool,bytes32,bytes32)",
  route:
    "CustomLaunchExecutionRouteBoundV2(bytes32,bytes32,uint32,bytes32,bytes32,uint8,bytes32,address,bytes32,bytes32,bytes32,bytes32,bytes32)",
  source:
    "CustomLaunchMarketDataSourceBoundV2(bytes32,bytes32,uint32,bytes32,bytes32,uint8,address,bytes32,uint64,bytes32,bytes32,bytes32,bytes32)",
  metrics:
    "CustomLaunchMarketDataMetricsBoundV2(bytes32,bytes32,uint32,bytes32,bytes32[])",
});

export function assertTradeCapabilityGoldenRoundTrip(vectors) {
  if (!vectors || typeof vectors !== "object") fail("document", "missing");
  equal(
    vectors.schemaVersion,
    "programmable.trade-capability-golden-vectors.v1",
    "schemaVersion",
  );
  equal(vectors.abiEncoding, "Solidity abi.encode; Keccak-256", "abiEncoding");
  deepEqual(
    vectors.ordering,
    {
      routes: [
        "marketId",
        "marketPathId",
        "mode",
        "executionTarget",
        "adapterId",
        "executionSelector",
        "configurationHash",
        "routeHash",
      ],
      marketIdentityDeduplication: ["marketId", "marketPathId"],
      marketDataSources: [
        "marketId",
        "sourceId",
        "kind",
        "emitter",
        "stateView",
        "configurationHash",
        "sourceHash",
      ],
    },
    "ordering",
  );
  assertDomainHashes(vectors);
  assertSelectors(vectors);

  const preimages = vectors.preimages;
  const hashes = vectors.hashes;
  if (!preimages || !hashes) fail("preimages", "missing");

  const computedMetricIds = Object.fromEntries(
    Object.entries(METRIC_PREIMAGES).map(([key, value]) => [key, hashText(value)]),
  );
  for (const [key, value] of Object.entries(computedMetricIds)) {
    equal(preimages.metricIds?.[key], value, `metricIds.${key}`);
  }
  const directMetricIds = [
    computedMetricIds.charting,
    computedMetricIds.price,
    computedMetricIds.volume,
    computedMetricIds.liquidity,
  ];
  const proxyMetricIds = [computedMetricIds.price, computedMetricIds.liquidity];
  deepEqual(preimages.directMetricIds, directMetricIds, "directMetricIds");
  deepEqual(preimages.proxyMetricIds, proxyMetricIds, "proxyMetricIds");

  const directMetricSetHash = metricSetHash(vectors, directMetricIds);
  const proxyMetricSetHash = metricSetHash(vectors, proxyMetricIds);
  const emptyMetricSetHash = metricSetHash(vectors, []);
  equal(hashes.directMetricSetHash, directMetricSetHash, "directMetricSetHash");
  equal(hashes.proxyMetricSetHash, proxyMetricSetHash, "proxyMetricSetHash");
  equal(hashes.emptyMetricSetHash, emptyMetricSetHash, "emptyMetricSetHash");

  const helperHashes = assertMarketHelperPreimages(vectors, directMetricSetHash);
  const route = preimages.route;
  assertTupleOrder(vectors, "tradeRoute", route);
  const routeHash = structHash(vectors.domains.tradeRoute, FIELD_TYPES.tradeRoute, route);
  equal(hashes.routeHash, routeHash, "routeHash");
  const routeSetHash = hashValues(
    ["bytes32", "bytes32[]"],
    [vectors.domains.tradeRouteSet, [routeHash]],
  );
  equal(hashes.routeSetHash, routeSetHash, "routeSetHash");
  const marketIdentityHash = hashValues(
    ["bytes32", "bytes32", "bytes32"],
    [vectors.domains.marketIdentity, route.marketId, route.marketPathId],
  );
  equal(hashes.marketIdentityHash, marketIdentityHash, "marketIdentityHash");
  const marketSetHash = hashValues(
    ["bytes32", "bytes32[]"],
    [vectors.domains.marketSet, [marketIdentityHash]],
  );
  const emptyMarketSetHash = hashValues(
    ["bytes32", "bytes32[]"],
    [vectors.domains.marketSet, []],
  );
  equal(hashes.marketSetHash, marketSetHash, "marketSetHash");
  equal(hashes.emptyMarketSetHash, emptyMarketSetHash, "emptyMarketSetHash");

  const directSource = preimages.directSource;
  const proxySource = preimages.proxySource;
  assertTupleOrder(vectors, "marketDataSource", directSource);
  assertTupleOrder(vectors, "marketDataSource", proxySource);
  deepEqual(directSource.metricIds, directMetricIds, "directSource.metricIds");
  deepEqual(proxySource.metricIds, proxyMetricIds, "proxySource.metricIds");
  equal(directSource.metricsHash, directMetricSetHash, "directSource.metricsHash");
  equal(proxySource.metricsHash, proxyMetricSetHash, "proxySource.metricsHash");
  equal(directSource.topic0, helperHashes.topic0, "directSource.topic0");
  equal(directSource.eventAbiHash, helperHashes.eventAbiHash, "directSource.eventAbiHash");
  equal(directSource.filterHash, helperHashes.filterHash, "directSource.filterHash");
  equal(
    directSource.derivationPolicyHash,
    helperHashes.derivationPolicyHash,
    "directSource.derivationPolicyHash",
  );

  const directSourceHash = structHash(
    vectors.domains.marketDataSource,
    FIELD_TYPES.marketDataSource,
    directSource,
  );
  const proxySourceHash = structHash(
    vectors.domains.marketDataSource,
    FIELD_TYPES.marketDataSource,
    proxySource,
  );
  equal(hashes.directSourceHash, directSourceHash, "directSourceHash");
  equal(hashes.proxySourceHash, proxySourceHash, "proxySourceHash");
  const sourceSetHash = hashValues(
    ["bytes32", "bytes32[]"],
    [vectors.domains.marketDataSourceSet, [directSourceHash, proxySourceHash]],
  );
  equal(hashes.sourceSetHash, sourceSetHash, "sourceSetHash");

  const routeProxyBindingHash = proxyBindingHash(route, true);
  const directSourceProxyBindingHash = proxyBindingHash(directSource, false);
  equal(hashes.proxyBindingHash, routeProxyBindingHash, "proxyBindingHash");
  equal(
    hashes.directSourceProxyBindingHash,
    directSourceProxyBindingHash,
    "directSourceProxyBindingHash",
  );
  const directSourceIdentityHash = sourceIdentityHash(
    directSource,
    directSourceProxyBindingHash,
  );
  equal(
    hashes.directSourceIdentityHash,
    directSourceIdentityHash,
    "directSourceIdentityHash",
  );

  const capability = preimages.capability;
  assertFieldSetFromTupleOrder(vectors, "tradeCapability", capability);
  deepEqual(capability.routes, [route], "capability.routes");
  deepEqual(
    capability.marketDataSources,
    [directSource, proxySource],
    "capability.marketDataSources",
  );
  equal(capability.routeSetHash, routeSetHash, "capability.routeSetHash");
  equal(capability.marketSetHash, marketSetHash, "capability.marketSetHash");
  equal(
    capability.marketDataSourceSetHash,
    sourceSetHash,
    "capability.marketDataSourceSetHash",
  );
  equal(
    capability.revocationPolicyHash,
    vectors.domains.revocationPolicy,
    "capability.revocationPolicyHash",
  );
  const capabilityHash = hashValues(
    [
      "bytes32",
      "uint256",
      "uint64",
      "bytes32",
      "bytes32",
      "bool",
      "bytes32",
      "uint32",
      "bytes32",
      "uint32",
      "bytes32",
      "bytes32",
    ],
    [
      vectors.domains.tradeCapability,
      capability.chainId,
      capability.registryGeneration,
      capability.launchId,
      capability.marketSetHash,
      capability.executionEnabled,
      capability.routeSetHash,
      capability.routes.length,
      capability.marketDataSourceSetHash,
      capability.marketDataSources.length,
      capability.evidenceHash,
      capability.revocationPolicyHash,
    ],
  );
  equal(hashes.capabilityHash, capabilityHash, "capabilityHash");

  assertEventVectors({
    vectors,
    route,
    directSource,
    routeHash,
    routeProxyBindingHash,
    directSourceHash,
    directSourceIdentityHash,
    capabilityHash,
    directMetricIds,
    directMetricSetHash,
    routeSetHash,
    marketSetHash,
    sourceSetHash,
  });

  return Object.freeze({
    routeHash,
    routeSetHash,
    marketIdentityHash,
    marketSetHash,
    directMetricSetHash,
    proxyMetricSetHash,
    directSourceHash,
    proxySourceHash,
    sourceSetHash,
    capabilityHash,
  });
}

function assertDomainHashes(vectors) {
  for (const [key, preimage] of Object.entries(DOMAIN_PREIMAGES)) {
    equal(vectors.domains?.[key], hashText(preimage), `domains.${key}`);
  }
  deepEqual(
    Object.keys(vectors.domains ?? {}).sort(),
    Object.keys(DOMAIN_PREIMAGES).sort(),
    "domain key set",
  );
}

function assertSelectors(vectors) {
  for (const [key, preimage] of Object.entries(vectors.selectorPreimages ?? {})) {
    const selector = hashText(preimage).slice(0, 10);
    equal(vectors.selectors?.[key], selector, `selectors.${key}`);
  }
  deepEqual(
    Object.keys(vectors.selectors ?? {}).sort(),
    Object.keys(vectors.selectorPreimages ?? {}).sort(),
    "selector key set",
  );
}

function assertMarketHelperPreimages(vectors, directMetricSetHash) {
  const eventAbi = vectors.preimages.marketEventAbi;
  equal(eventAbi.domain, DOMAIN_PREIMAGES.marketEventAbi, "marketEventAbi.domain");
  equal(eventAbi.domainHash, vectors.domains.marketEventAbi, "marketEventAbi.domainHash");
  const topic0 = hashText(eventAbi.eventSignature);
  equal(eventAbi.topic0, topic0, "marketEventAbi.topic0");
  const eventAbiHash = hashValues(
    ["bytes32", "bytes32", "bytes32", "bytes32"],
    [
      eventAbi.domainHash,
      topic0,
      eventAbi.abiContentHash,
      eventAbi.abiVersionHash,
    ],
  );
  equal(eventAbi.eventAbiHash, eventAbiHash, "marketEventAbi.eventAbiHash");

  const filter = vectors.preimages.marketEventFilter;
  equal(filter.domain, DOMAIN_PREIMAGES.marketEventFilter, "marketEventFilter.domain");
  equal(
    filter.domainHash,
    vectors.domains.marketEventFilter,
    "marketEventFilter.domainHash",
  );
  const filterHash = hashValues(
    ["bytes32", "bytes32", "bytes32", "bytes32", "address", "bytes32[]", "bytes32"],
    [
      filter.domainHash,
      filter.marketId,
      filter.marketPathId,
      filter.poolId,
      filter.poolAddress,
      filter.indexedValues,
      filter.filterVersionHash,
    ],
  );
  equal(filter.filterHash, filterHash, "marketEventFilter.filterHash");

  const derivation = vectors.preimages.marketDataDerivation;
  equal(
    derivation.domain,
    DOMAIN_PREIMAGES.marketDataDerivation,
    "marketDataDerivation.domain",
  );
  equal(
    derivation.domainHash,
    vectors.domains.marketDataDerivation,
    "marketDataDerivation.domainHash",
  );
  equal(
    derivation.metricsHash,
    directMetricSetHash,
    "marketDataDerivation.metricsHash",
  );
  const derivationPolicyHash = hashValues(
    ["bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
    [
      derivation.domainHash,
      derivation.metricsHash,
      derivation.formulaHash,
      derivation.calldataPolicyHash,
      derivation.derivationVersionHash,
    ],
  );
  equal(
    derivation.derivationPolicyHash,
    derivationPolicyHash,
    "marketDataDerivation.derivationPolicyHash",
  );
  equal(vectors.hashes.eventAbiHash, eventAbiHash, "hashes.eventAbiHash");
  equal(vectors.hashes.eventFilterHash, filterHash, "hashes.eventFilterHash");
  equal(
    vectors.hashes.derivationPolicyHash,
    derivationPolicyHash,
    "hashes.derivationPolicyHash",
  );
  return { topic0, eventAbiHash, filterHash, derivationPolicyHash };
}

function assertEventVectors(context) {
  const { vectors, capabilityHash, route, directSource } = context;
  const capability = vectors.preimages.capability;
  const launchId = capability.launchId;
  const routeIndex = 0;
  const sourceIndex = 0;
  const sourceTarget = directSource.kind === 0
    ? directSource.emitter
    : directSource.stateView;
  const sourceRuntimeCodeHash = directSource.kind === 0
    ? directSource.emitterRuntimeCodeHash
    : directSource.stateViewRuntimeCodeHash;

  assertEvent(
    vectors.events.summary,
    ["bytes32", "bytes32", "bytes32"],
    [launchId, capabilityHash, context.routeSetHash],
    ["bytes32", "uint32", "bytes32", "uint32", "bool", "bytes32", "bytes32"],
    [
      context.marketSetHash,
      capability.routes.length,
      context.sourceSetHash,
      capability.marketDataSources.length,
      capability.executionEnabled,
      capability.evidenceHash,
      capability.revocationPolicyHash,
    ],
    "events.summary",
  );
  assertEvent(
    vectors.events.route,
    ["bytes32", "bytes32", "uint32"],
    [launchId, capabilityHash, routeIndex],
    [
      "bytes32",
      "bytes32",
      "uint8",
      "bytes32",
      "address",
      "bytes32",
      "bytes32",
      "bytes32",
      "bytes32",
      "bytes32",
    ],
    [
      route.marketId,
      route.marketPathId,
      route.mode,
      route.adapterId,
      route.executionTarget,
      route.executionTargetRuntimeCodeHash,
      route.configurationHash,
      route.dependencyRuntimeCodeSetHash,
      context.routeProxyBindingHash,
      context.routeHash,
    ],
    "events.route",
  );
  assertEvent(
    vectors.events.source,
    ["bytes32", "bytes32", "uint32"],
    [launchId, capabilityHash, sourceIndex],
    [
      "bytes32",
      "bytes32",
      "uint8",
      "address",
      "bytes32",
      "uint64",
      "bytes32",
      "bytes32",
      "bytes32",
      "bytes32",
    ],
    [
      directSource.marketId,
      directSource.sourceId,
      directSource.kind,
      sourceTarget,
      sourceRuntimeCodeHash,
      directSource.startBlock,
      context.directSourceIdentityHash,
      directSource.metricsHash,
      directSource.configurationHash,
      context.directSourceHash,
    ],
    "events.source",
  );
  assertEvent(
    vectors.events.metrics,
    ["bytes32", "bytes32", "uint32"],
    [launchId, capabilityHash, sourceIndex],
    ["bytes32", "bytes32[]"],
    [context.directMetricSetHash, context.directMetricIds],
    "events.metrics",
  );
}

function assertEvent(event, indexedTypes, indexedValues, dataTypes, dataValues, label) {
  const eventKey = label.slice("events.".length);
  equal(event.signature, EVENT_SIGNATURES[eventKey], `${label}.signature`);
  equal(event.topic0, hashText(event.signature), `${label}.topic0`);
  const topics = [
    event.topic0,
    ...indexedTypes.map((type, index) =>
      encodeAbiParameters([{ type }], [indexedValues[index]]),
    ),
  ];
  deepEqual(event.topics, topics, `${label}.topics`);
  equal(
    event.data,
    encodeAbiParameters(dataTypes.map((type) => ({ type })), dataValues),
    `${label}.data`,
  );
}

function metricSetHash(vectors, metricIds) {
  return hashValues(
    ["bytes32", "bytes32[]"],
    [vectors.domains.marketDataMetricSet, metricIds],
  );
}

function structHash(domain, fields, value) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        {
          type: "tuple",
          components: fields.map(([name, type]) => ({ name, type })),
        },
      ],
      [domain, value],
    ),
  );
}

function proxyBindingHash(value, route) {
  const fields = route
    ? [
        ["proxy", "bool"],
        ["proxyKind", "uint8"],
        ["proxyBindingEvidenceHash", "bytes32"],
        ["proxyPolicyHash", "bytes32"],
        ["implementation", "address"],
        ["implementationRuntimeCodeHash", "bytes32"],
        ["admin", "address"],
        ["adminRuntimeCodeHash", "bytes32"],
        ["beacon", "address"],
        ["beaconRuntimeCodeHash", "bytes32"],
        ["adapterVersion", "bytes32"],
        ["executionSelector", "bytes4"],
        ["interfaceId", "bytes4"],
      ]
    : [
        ["proxy", "bool"],
        ["proxyKind", "uint8"],
        ["proxyBindingEvidenceHash", "bytes32"],
        ["proxyPolicyHash", "bytes32"],
        ["implementation", "address"],
        ["implementationRuntimeCodeHash", "bytes32"],
        ["admin", "address"],
        ["adminRuntimeCodeHash", "bytes32"],
        ["beacon", "address"],
        ["beaconRuntimeCodeHash", "bytes32"],
      ];
  return hashValues(
    fields.map(([, type]) => type),
    fields.map(([name]) => value[name]),
  );
}

function sourceIdentityHash(source, sourceProxyBindingHash) {
  return hashValues(
    ["bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes4", "bytes32"],
    [
      source.topic0,
      source.eventAbiHash,
      source.filterHash,
      source.metricsHash,
      source.derivationPolicyHash,
      source.readSelector,
      sourceProxyBindingHash,
    ],
  );
}

function assertTupleOrder(vectors, key, value) {
  const expected = FIELD_TYPES[key].map(([name]) => name);
  deepEqual(vectors.tupleOrder?.[key], expected, `tupleOrder.${key}`);
  const actual = Object.keys(value);
  deepEqual([...actual].sort(), [...expected].sort(), `${key} field set`);
}

function assertFieldSetFromTupleOrder(vectors, key, value) {
  const expected = vectors.tupleOrder?.[key];
  if (!Array.isArray(expected)) fail(`tupleOrder.${key}`, "missing");
  deepEqual(Object.keys(value).sort(), [...expected].sort(), `${key} field set`);
}

function hashValues(types, values) {
  return keccak256(
    encodeAbiParameters(types.map((type) => ({ type })), values),
  );
}

function hashText(value) {
  return keccak256(stringToHex(value));
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(label, `${String(actual)} != ${String(expected)}`);
}

function deepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(label, "nested value mismatch");
  }
}

function fail(label, detail) {
  throw new Error(`Generation 2 golden roundtrip drift at ${label}: ${detail}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const vectors = JSON.parse(
    readFileSync(
      new URL(
        "../docs/security/CUSTOM_REGISTRY_TRADE_CAPABILITY_V1_GOLDEN_VECTORS.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const hashes = assertTradeCapabilityGoldenRoundTrip(vectors);
  console.log(
    `verified Generation 2 trade-capability golden roundtrip ${hashes.capabilityHash}`,
  );
}
