#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const protocolCommit = "334bb26703a4dab18ce0fca8485c6275a879933a";
const protocolSpecId = "programmable-protocol/0.1.0-draft.1";
const zeroHash = `0x${"0".repeat(64)}`;
const termsEvidenceBoundary = "No owner-provided acceptance record or click-through acceptance action is present. Whether access to official documentation, public RPC, testnet or explorer services has legal effect under applicable Terms is not assessed here.";
const bootstrapDigestEvidenceClass = "LOCALLY_COMPUTED_SHA256_SNAPSHOT_OF_OFFICIAL_CDN_BYTES_NOT_AN_OFFICIAL_CHECKSUM";
const sourceKinds = [
  "OFFICIAL_NETWORK_DOCUMENTATION",
  "OFFICIAL_NODE_DOCUMENTATION",
  "OFFICIAL_TRANSACTION_FINALITY_DOCUMENTATION",
  "OFFICIAL_ETHEREUM_DIFFERENCES_DOCUMENTATION",
  "OFFICIAL_GAS_AND_FEES_DOCUMENTATION",
  "OFFICIAL_TERMS_OF_SERVICE",
  "OFFICIAL_CHAIN_INFO",
  "OFFICIAL_GENESIS",
  "CANONICAL_ARBSYS_INTERFACE"
];
const sharedRecordedSources = [
  ["OFFICIAL_NETWORK_DOCUMENTATION", "https://docs.robinhood.com/chain/connecting/", "accessedAt", "2026-08-29T13:48:50Z"],
  ["OFFICIAL_NODE_DOCUMENTATION", "https://docs.robinhood.com/chain/run-a-full-node/", "accessedAt", "2026-08-29T13:48:50Z"],
  ["OFFICIAL_TRANSACTION_FINALITY_DOCUMENTATION", "https://docs.robinhood.com/chain/transaction-finality/", "retrievedOn", "2026-08-29"],
  ["OFFICIAL_ETHEREUM_DIFFERENCES_DOCUMENTATION", "https://docs.robinhood.com/chain/differences-from-ethereum/", "retrievedOn", "2026-08-29"],
  ["OFFICIAL_GAS_AND_FEES_DOCUMENTATION", "https://docs.robinhood.com/chain/gas-and-fees/", "retrievedOn", "2026-08-29"],
  ["OFFICIAL_TERMS_OF_SERVICE", "https://docs.robinhood.com/chain/terms-of-service/", "retrievedOn", "2026-08-29"],
  ["CANONICAL_ARBSYS_INTERFACE", "https://github.com/OffchainLabs/nitro-precompile-interfaces/blob/main/ArbSys.sol", "accessedAt", "2026-08-29T14:00:00.373Z"]
];
const networks = new Map([
  [4663, {
    name: "mainnet",
    hex: "0x1237",
    caip2: "eip155:4663",
    blockZeroHash: "0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    statusPath: "deployments/dex/robinhood/4663/deployment-status.json",
    bootstrap: {
      chainInfo: {
        url: "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-chain-info.json",
        digest: "sha256:cf6c0aa2bc520a28fe8983f783676bc43de94cc25a57a1cdc9b1f0afc5208f0a"
      },
      customGenesis: {
        url: "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-genesis.json",
        digest: "sha256:353e6f6441b47695b41cee0c3645cde8dd7492d2f7f574bfb6aa4371e41bb6ba"
      }
    },
    recordedSources: [
      ["OFFICIAL_CHAIN_INFO", "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-chain-info.json", "accessedAt", "2026-08-29T13:48:50Z"],
      ["OFFICIAL_GENESIS", "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-genesis.json", "accessedAt", "2026-08-29T13:48:50Z"]
    ]
  }],
  [46630, {
    name: "testnet",
    hex: "0xb626",
    caip2: "eip155:46630",
    blockZeroHash: "0x829a42e6d68c872aafcef3abb2123fe371138fc415dd8b44381bbbf23049dd32",
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    statusPath: "deployments/dex/robinhood/46630/preparation-status.json",
    bootstrap: {
      chainInfo: {
        url: "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-chain-testnet-info.json",
        digest: "sha256:0ad167c746c2aa9169c84a252f8c863140cdbd4fc23b571fa1041f94cabaf745"
      }
    },
    recordedSources: [
      ["OFFICIAL_CHAIN_INFO", "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-chain-testnet-info.json", "accessedAt", "2026-08-29T13:48:50Z"]
    ]
  }]
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

function verifyProtocolReference(reference, label) {
  assert(reference?.path === "packages/dex-evm/binding/protocol-lock.json", `${label}: protocol lock path mismatch`);
  assert(reference.commit === protocolCommit, `${label}: protocol commit mismatch`);
  assert(reference.protocolSpecId === protocolSpecId, `${label}: Protocol Spec ID mismatch`);
  assert(reference.status === "draft", `${label}: Protocol status must remain draft`);
  assert(reference.productionEligible === false, `${label}: Protocol must remain non-production-eligible`);
}

function verifyNoDeploymentEvidence(record, label) {
  for (const field of [
    "canonicalNetworkDeploymentOccurred",
    "canonicalExplorerSourceVerificationOccurred",
    "canonicalDeploymentRuntimeReadbackOccurred",
  ]) {
    assert(record[field] === false, `${label}: ${field} must remain false without external evidence`);
  }
  assert(record.terminalState === "BLOCKED_BY_SPEC", `${label}: terminal state must remain BLOCKED_BY_SPEC`);
  assert(record.classification === "NONE", `${label}: deployment classification must remain NONE`);
}

function verifyTermsEvidenceAndNoCustodyAction(record, label) {
  assert(!Object.hasOwn(record, "externalTermsAcceptance"), `${label}: categorical externalTermsAcceptance claims are forbidden`);
  const terms = record.externalTermsEvidence;
  assert(terms !== null && typeof terms === "object" && !Array.isArray(terms), `${label}: externalTermsEvidence must be an object`);
  assert(
    JSON.stringify(Object.keys(terms).sort()) === JSON.stringify([
      "clickThroughAcceptanceAttempted",
      "evidenceBoundary",
      "legalEffectOfReadOnlyAccess",
      "ownerAcceptanceRecordPresent"
    ]),
    `${label}: externalTermsEvidence must preserve the exact factual schema`
  );
  assert(terms.ownerAcceptanceRecordPresent === false, `${label}: no owner-provided acceptance record may be claimed`);
  assert(terms.clickThroughAcceptanceAttempted === false, `${label}: click-through acceptance attempt boundary mismatch`);
  assert(terms.legalEffectOfReadOnlyAccess === "NOT_ASSESSED", `${label}: legal effect of service access must remain NOT_ASSESSED`);
  assert(terms.evidenceBoundary === termsEvidenceBoundary, `${label}: Terms evidence boundary mismatch`);
  assert(
    record.custodySafety?.deployForCustody === false,
    `${label}: custodySafety.deployForCustody must remain false`
  );
  assert(
    record.custodySafety?.fundCanonicalVaults === false,
    `${label}: custodySafety.fundCanonicalVaults must remain false`
  );
}

async function main() {
  const schema = await readJson("config/networks/robinhood-chain/network.schema.json");
  assert(schema.$schema === "https://json-schema.org/draft/2020-12/schema", "Network schema draft changed");
  assert(schema.$id === "urn:programmable:network-config:robinhood-chain:v1", "Network schema identity changed");
  assert(schema.properties?.schemaVersion?.const === "programmable.robinhood-network/v1", "Network schema version changed");
  assert(JSON.stringify(schema.$defs?.identity?.properties?.chainId?.enum) === JSON.stringify([4663, 46630]), "Network schema chain IDs changed");
  assert(schema.$defs?.corePortabilityPolicy?.properties?.runtimeCodeLimitBytes?.const === 24_576, "Network schema EIP-170 limit changed");
  assert(schema.$defs?.corePortabilityPolicy?.properties?.initCodeLimitBytes?.const === 49_152, "Network schema EIP-3860 limit changed");
  assert(schema.$defs?.contentAddressedResource?.properties?.digestEvidenceClass?.const === bootstrapDigestEvidenceClass, "Bootstrap digest evidence class changed");
  assert(JSON.stringify(schema.$defs?.source?.properties?.kind?.enum) === JSON.stringify(sourceKinds), "Network source-kind schema changed");

  const lock = await readJson("packages/dex-evm/binding/protocol-lock.json");
  assert(lock.schemaVersion === "programmable.dex-evm.protocol-lock/v1", "Protocol lock schema version mismatch");
  assert(lock.protocolCommit === protocolCommit, "Protocol lock commit mismatch");
  assert(lock.protocolSpecId === protocolSpecId, "Protocol lock Spec ID mismatch");
  assert(lock.status === "draft" && lock.productionEligible === false, "Protocol lock production status mismatch");

  for (const [chainId, expected] of networks) {
    const configPath = `config/networks/robinhood-chain/${chainId}.json`;
    const config = await readJson(configPath);
    assert(config.schemaVersion === "programmable.robinhood-network/v1", `${configPath}: schema version mismatch`);
    assert(config.network === expected.name, `${configPath}: network name mismatch`);
    assert(config.identity?.chainId === chainId, `${configPath}: chain ID mismatch`);
    assert(config.identity.chainIdHex === expected.hex, `${configPath}: hexadecimal chain ID mismatch`);
    assert(config.identity.caip2 === expected.caip2, `${configPath}: CAIP-2 identity mismatch`);
    assert(config.identity.nativeGasSymbol === "ETH", `${configPath}: gas asset mismatch`);
    assert(config.identity.architecture === "ARBITRUM_NITRO_L2", `${configPath}: architecture mismatch`);
    assert(config.identity.blockZero?.number === 0, `${configPath}: block-zero number mismatch`);
    assert(config.identity.blockZero.hash === expected.blockZeroHash, `${configPath}: block-zero hash mismatch`);
    assert(config.identity.blockZero.parentHash === zeroHash, `${configPath}: block-zero parent mismatch`);
    assert(config.identity.blockZero.timestamp === 0, `${configPath}: block-zero timestamp mismatch`);
    assert(config.operatorConfiguration?.publicRpcUrl === expected.rpcUrl, `${configPath}: public RPC mismatch`);
    assert(config.operatorConfiguration.publicRpcProductionSuitable === false, `${configPath}: public RPC must not be marked production-suitable`);

    const expectedBootstrapKeys = [...Object.keys(expected.bootstrap), "usesCustomGenesis"].sort();
    assert(JSON.stringify(Object.keys(config.bootstrap ?? {}).sort()) === JSON.stringify(expectedBootstrapKeys), `${configPath}: bootstrap key set mismatch`);
    assert(config.bootstrap.usesCustomGenesis === Object.hasOwn(expected.bootstrap, "customGenesis"), `${configPath}: custom-genesis policy mismatch`);
    for (const [resourceName, expectedResource] of Object.entries(expected.bootstrap)) {
      const resource = config.bootstrap[resourceName];
      assert(resource?.url === expectedResource.url, `${configPath}: ${resourceName} URL mismatch`);
      assert(resource.digest === expectedResource.digest, `${configPath}: ${resourceName} digest mismatch`);
      assert(resource.digestEvidenceClass === bootstrapDigestEvidenceClass, `${configPath}: ${resourceName} digest evidence class mismatch`);
      assert(JSON.stringify(Object.keys(resource).sort()) === JSON.stringify(["digest", "digestEvidenceClass", "url"]), `${configPath}: ${resourceName} exact key set mismatch`);
    }

    const expectedSources = [...sharedRecordedSources, ...expected.recordedSources];
    assert(Array.isArray(config.sources) && config.sources.length === expectedSources.length, `${configPath}: exact source inventory size mismatch`);
    assert(new Set(config.sources.map((source) => source.kind)).size === config.sources.length, `${configPath}: duplicate source kind`);
    for (const [kind, url, dateField, dateValue] of expectedSources) {
      const source = config.sources.find((entry) => entry.kind === kind);
      assert(source?.url === url, `${configPath}: ${kind} URL mismatch`);
      assert(source[dateField] === dateValue, `${configPath}: ${kind} retrieval date mismatch`);
      assert(source.retrievedOn === "2026-08-29", `${configPath}: ${kind} exact retrieval date mismatch`);
      const expectedSourceKeys = ["kind", "retrievedOn", "url"];
      if (dateField !== "retrievedOn") expectedSourceKeys.push(dateField);
      assert(
        JSON.stringify(Object.keys(source).sort()) === JSON.stringify(expectedSourceKeys.sort()),
        `${configPath}: ${kind} exact source schema mismatch`
      );
    }

    assert(config.corePortabilityPolicy?.requiresArbitrumPrecompile === false, `${configPath}: Core must not require an Arbitrum precompile`);
    assert(config.corePortabilityPolicy.treatsBlockNumberAsL2Counter === false, `${configPath}: Core must not interpret block.number as a permanent L2 counter`);
    assert(config.corePortabilityPolicy.usesBlockEntropy === false, `${configPath}: Core must not use block entropy`);
    assert(config.corePortabilityPolicy.assumesFirstComeFirstServedEliminatesMev === false, `${configPath}: MEV assumption mismatch`);
    assert(config.corePortabilityPolicy.treatsSequencerAcceptanceAsEthereumFinality === false, `${configPath}: finality assumption mismatch`);
    assert(config.corePortabilityPolicy.runtimeCodeLimitBytes === 24_576, `${configPath}: EIP-170 limit mismatch`);
    assert(config.corePortabilityPolicy.initCodeLimitBytes === 49_152, `${configPath}: EIP-3860 limit mismatch`);

    const finalized = config.observations?.filter((entry) => entry.kind === "FINALIZED_TAG_ANCHOR") ?? [];
    const runtime = config.observations?.filter((entry) => entry.kind === "RUNTIME_OBSERVATION") ?? [];
    assert(finalized.length === 1 && runtime.length === 1, `${configPath}: expected exactly one recorded finalized and runtime observation`);
    assert(finalized[0].rpcUrl === expected.rpcUrl && runtime[0].rpcUrl === expected.rpcUrl, `${configPath}: observation RPC mismatch`);
    assert(Number.parseInt(finalized[0].blockNumberHex, 16) === finalized[0].blockNumber, `${configPath}: finalized block number encoding mismatch`);

    const status = await readJson(expected.statusPath);
    assert(status.network?.chainId === chainId, `${expected.statusPath}: chain ID mismatch`);
    assert(status.network.chainReference === expected.caip2, `${expected.statusPath}: chain reference mismatch`);
    assert(status.network.configurationPath === configPath, `${expected.statusPath}: configuration path mismatch`);
    assert(status.network.blockZeroHash === expected.blockZeroHash, `${expected.statusPath}: block-zero hash mismatch`);
    verifyProtocolReference(status.protocolLock, expected.statusPath);
    verifyNoDeploymentEvidence(status, expected.statusPath);
    verifyTermsEvidenceAndNoCustodyAction(status, expected.statusPath);

    if (chainId === 46630) {
      assert(status.schemaVersion === "programmable.dex-evm.testnet-preparation-status/v1", `${expected.statusPath}: schema version mismatch`);
      assert(status.preparationState === "PRE_OWNER_GATE_READ_ONLY_PREPARATION", `${expected.statusPath}: preparation state mismatch`);
      assert(status.localForkSmoke?.classification === "DISPOSABLE_LOCAL_ONLY_SIMULATION", `${expected.statusPath}: local-fork classification mismatch`);
      assert(status.localForkSmoke?.canonicalNetworkTransactionBroadcast === false, `${expected.statusPath}: local-fork network-broadcast boundary mismatch`);
      for (const field of ["ownerGateClaimed", "ownerActionRequested", "unsignedTransactionPackageCreated", "ownerTransactionSigned", "canonicalNetworkTransactionBroadcast"]) {
        assert(status[field] === false, `${expected.statusPath}: ${field} must remain false`);
      }
      assert(status.network.recordedFinalizedAnchor?.blockNumber === finalized[0].blockNumber, `${expected.statusPath}: finalized block number drift`);
      assert(status.network.recordedFinalizedAnchor.blockHash === finalized[0].blockHash, `${expected.statusPath}: finalized block hash drift`);
    } else {
      assert(status.schemaVersion === "programmable.dex-evm.deployment-status/v1", `${expected.statusPath}: schema version mismatch`);
    }
  }

  process.stdout.write(
    "DEX EVM network/status records verified: schema identity, chain IDs, block zero, portability limits, "
      + "Draft Protocol lock, canonical-network no-deployment and no-custody-action boundaries, plus an exact factual "
      + "Terms-evidence boundary with the legal effect of service access NOT_ASSESSED.\n"
  );
}

main().catch((error) => {
  process.stderr.write(`DEX EVM network/status verification failed: ${error.message}\n`);
  process.exitCode = 1;
});
