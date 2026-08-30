import {
  HOOK_PERMISSIONS,
  ROBINHOOD_CAIP2,
  ROBINHOOD_CHAIN_DEPLOYMENT_ID,
  ROBINHOOD_CHAIN_ID,
} from "../../src/constants.mjs";
import {
  customLaunchRequestHashV4,
  hashV4ChainDeployment,
} from "../../src/v4-contract.mjs";
import { canonicalizeJson } from "../../src/canonical-json.mjs";
import { sha256Digest } from "../../src/io.mjs";
import { getAddress, hashTypedData } from "viem";
import {
  buildCanonicalCustomGraphRouteV4,
  encodeLaunchAndStampCalldataV4,
  recomputeArtifactHashesV4,
} from "../../src/wallet-transaction-v4.mjs";

export const V4_LAUNCH_ID = "70000000-0000-4000-8000-000000000007";
export const V4_REQUEST_ID = "70000000-0000-4000-8000-000000000008";
export const V4_API_KEY = "pm_live_v4_publictest_secretvalue";

const address = (digit) => `0x${digit.repeat(40)}`;
const codeHash = (digit) => `0x${digit.repeat(64)}`;
const framedSha256Json = (domain, value) => sha256Digest(Buffer.concat([
  Buffer.from(domain, "utf8"),
  Buffer.from([0]),
  Buffer.from(canonicalizeJson(value), "utf8"),
]));
const storageWord = (addressValue) => `0x${"0".repeat(24)}${addressValue.slice(2).toLowerCase()}`;

const v4ProfilePreimage = Object.freeze({
  schemaVersion: "programmable.custom-launch-profile-ref.v4",
  structuralProfileId: "programmable.custom-launch.robinhood-mainnet.v1",
  businessProfileId: "robinhood-production-launch",
  admissionDescriptorDigest:
    "sha256:99b4ccabdaaf143bad28a8f6af441a1b93e1f113d0179236328b7fa594d1f948",
  admissionPolicyDigest:
    "sha256:31e6b286ca839b31cb1edfe30c05d9f334892f3d84377961dc10b93959c7e216",
  admissionBindingDigest:
    "sha256:f31643e6e9ff6d5409d59a2fc3ac7fb5ac9cfcb3af08e95c9478bc95ddfa66a2",
  admissionSchemaDigest:
    "sha256:a28a6de6208d6ba7b65b4b706174509570955ba9ce9714624bcb2046ab7beae7",
  profileRevision: 1,
  profileVersion: "4.0.0",
});

export const v4Profile = Object.freeze({
  ...v4ProfilePreimage,
  profileDigest: framedSha256Json(
    "programmable.custom-launch-profile-ref.v4",
    v4ProfilePreimage,
  ),
});

const safeEthereumFinalityPreimage = Object.freeze({
  schemaVersion: "programmable.robinhood-l2-checkpoint-ethereum-finality.v1",
  profile: v4Profile,
  l2Checkpoint: {
    blockNumber: "49209973",
    blockHash: codeHash("4"),
  },
  batchNumber: "153046",
  l2Providers: [
    { providerId: "quicknode", trustDomain: "quicknode.com", l1Confirmations: "12" },
    { providerId: "alchemy", trustDomain: "alchemy.com", l1Confirmations: "12" },
  ],
  ethereumProviders: [
    { providerId: "drpc", trustDomain: "drpc.org" },
    { providerId: "quicknode", trustDomain: "quicknode.com" },
  ],
  rollup: "0x23A19d23e89166adedbDcB432518AB01e4272D94",
  sequencerInbox: "0xBd0D173EEb87D57A09521c24388a12789F33ba96",
  postingTransactionHash: codeHash("a"),
  postingBlockNumber: "24000000",
  postingBlockHash: codeHash("b"),
  postingLogIndex: "7",
  ethereumFinalizedCheckpoint: {
    blockNumber: "24000012",
    blockHash: codeHash("c"),
    tag: "finalized",
  },
  observedAt: "2026-08-29T12:00:00.000Z",
  captureClosureDigest: `sha256:${"7".repeat(64)}`,
  postingEventDigest: `sha256:${"8".repeat(64)}`,
  l1EvidenceDigest: `sha256:${"9".repeat(64)}`,
});

const safeEthereumFinalityEvidence = Object.freeze({
  ...safeEthereumFinalityPreimage,
  evidenceDigest: framedSha256Json(
    "programmable.robinhood-l2-checkpoint-ethereum-finality.v1",
    safeEthereumFinalityPreimage,
  ),
});

const atomicDeploymentBlockNumber = "49209973";
const atomicPreDeploymentBlockNumber = "49209972";
const atomicDeploymentBlockHash = codeHash("4");
const atomicPreDeploymentBlockHash = codeHash("3");
const emptyRuntimeCodeHash =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const atomicResultingContracts = Object.freeze([
  ["permitAuthority", "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
    "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c"],
  ["graphFactory", "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
    "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8"],
  ["programmableLaunchStampRouter", "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
    "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388"],
].map(([contract, contractAddress, runtimeCodeHash]) => {
  const providerReadbacks = Object.freeze([
    ["quicknode", "quicknode.com"],
    ["alchemy", "alchemy.com"],
  ].map(([providerId, trustDomain]) => {
    const preimage = Object.freeze({
      schemaVersion:
        "programmable.robinhood-atomic-root-runtime-transition-provider-readback.v1",
      providerId,
      trustDomain,
      contract,
      address: contractAddress,
      preDeploymentBlockNumber: atomicPreDeploymentBlockNumber,
      preDeploymentBlockHash: atomicPreDeploymentBlockHash,
      preDeploymentRuntimeCodeHash: emptyRuntimeCodeHash,
      deploymentBlockNumber: atomicDeploymentBlockNumber,
      deploymentBlockHash: atomicDeploymentBlockHash,
      deploymentRuntimeCodeHash: runtimeCodeHash,
    });
    return Object.freeze({
      ...preimage,
      evidenceDigest: framedSha256Json(preimage.schemaVersion, preimage),
    });
  }));
  const preimage = Object.freeze({
    contract,
    address: contractAddress,
    runtimeCodeHash,
    previousBlockRuntimeCodeHash: emptyRuntimeCodeHash,
    providerReadbacks,
  });
  return Object.freeze({
    ...preimage,
    stateEvidenceDigest: framedSha256Json(
      "programmable.robinhood-atomic-root-deployment-result-state.v1",
      preimage,
    ),
  });
}));

const safeConfigurationEvidencePreimage = Object.freeze({
  schemaVersion: "programmable.safe-configuration-evidence.v1",
  finalized: true,
  blockNumber: "49209973",
  blockHash: codeHash("4"),
  proxyRuntimeCodeHash:
    "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  singleton: {
    address: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    runtimeCodeHash:
      "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
    version: "1.4.1",
    sourceCommitment:
      "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb",
  },
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
  fallbackHandlerRuntimeCodeHash:
    "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9",
  owners: [
    "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
    "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
  ],
  threshold: 1,
  nonce: "0",
  modules: [],
  modulesNext: "0x0000000000000000000000000000000000000001",
  guard: null,
  singletonSlot: storageWord("0x41675C099F32341bf84BFc5382aF534df5C7461a"),
  fallbackHandlerSlot: storageWord("0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99"),
  guardSlot: codeHash("0"),
  primaryProvider: {
    providerId: "quicknode",
    trustDomain: "quicknode.com",
    evidenceDigest: `sha256:${"5".repeat(64)}`,
  },
  secondaryProvider: {
    providerId: "alchemy",
    trustDomain: "alchemy.com",
    evidenceDigest: `sha256:${"6".repeat(64)}`,
  },
  atomicRootStateEvidenceDigest: atomicResultingContracts[0].stateEvidenceDigest,
  ethereumFinalityEvidence: safeEthereumFinalityEvidence,
});

const safeConfigurationEvidence = Object.freeze({
  ...safeConfigurationEvidencePreimage,
  evidenceDigest: framedSha256Json(
    "programmable.safe-configuration-evidence.v1",
    safeConfigurationEvidencePreimage,
  ),
});

const permit2ProviderReadbacks = Object.freeze([
  ["quicknode", "quicknode.com"],
  ["alchemy", "alchemy.com"],
].map(([providerId, trustDomain]) => {
  const preimage = Object.freeze({
    schemaVersion: "programmable.custom-launch-genesis-provider-readback.v1",
    providerId,
    trustDomain,
    blockNumber: "0",
    blockHash: codeHash("d"),
    runtimeCodeHash:
      "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
  });
  return Object.freeze({
    ...preimage,
    evidenceDigest: framedSha256Json(preimage.schemaVersion, preimage),
  });
}));

const permit2GenesisPreimage = Object.freeze({
  schemaVersion: "programmable.custom-launch-genesis-provenance.v1",
  kind: "genesis-predeploy",
  address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  startBlock: "0",
  genesisSourceUrl:
    "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-genesis.json",
  genesisSourceDigest:
    "sha256:353e6f6441b47695b41cee0c3645cde8dd7492d2f7f574bfb6aa4371e41bb6ba",
  allocRuntimeCodeBytes: 9_152,
  providerReadbacks: permit2ProviderReadbacks,
});

const permit2GenesisProvenance = Object.freeze({
  ...permit2GenesisPreimage,
  evidenceDigest: framedSha256Json(permit2GenesisPreimage.schemaVersion, permit2GenesisPreimage),
});

const atomicReceiptLogs = Object.freeze([]);
const atomicReceiptLogsDigest = framedSha256Json(
  "programmable.robinhood-atomic-root-deployment-receipt-logs.v1",
  atomicReceiptLogs,
);
const atomicProviderReadbacks = Object.freeze([
  ["quicknode", "quicknode.com", "1", "2"],
  ["alchemy", "alchemy.com", "3", "4"],
].map(([providerId, trustDomain, responseDigit, receiptDigit]) => {
  const preimage = Object.freeze({
    providerId,
    trustDomain,
    transactionHash: codeHash("e"),
    transactionResponseDigest: `sha256:${responseDigit.repeat(64)}`,
    transactionReceiptDigest: `sha256:${receiptDigit.repeat(64)}`,
  });
  return Object.freeze({
    ...preimage,
    evidenceDigest: framedSha256Json(
      "programmable.robinhood-atomic-root-deployment-provider-readback.v1",
      preimage,
    ),
  });
}));

const atomicDeploymentEvidencePreimage = Object.freeze({
  schemaVersion: "programmable.robinhood-atomic-root-deployment-evidence.v1",
  deploymentId: ROBINHOOD_CHAIN_DEPLOYMENT_ID,
  chainId: ROBINHOOD_CHAIN_ID,
  coveredContracts: [
    "programmableLaunchStampRouter",
    "graphFactory",
    "permitAuthority",
  ],
  transactionHash: codeHash("e"),
  from: "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
  to: "0xcA11bde05977b3631167028862bE2a173976CA11",
  valueWei: "0",
  selector: "0x82ad56cb",
  calldataHash: "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9",
  calldataBytes: 33_412,
  nonce: "17",
  transactionIndex: "2",
  receiptStatus: "1",
  blockNumber: atomicDeploymentBlockNumber,
  blockHash: atomicDeploymentBlockHash,
  receiptLogs: atomicReceiptLogs,
  receiptLogsDigest: atomicReceiptLogsDigest,
  providerReadbacks: atomicProviderReadbacks,
  resultingContracts: atomicResultingContracts,
  ethereumFinalityEvidence: safeEthereumFinalityEvidence,
  sourceVerification: {
    sourcifyProviderMatchCoveredContracts: [
      "programmableLaunchStampRouter", "graphFactory",
    ],
    exactByteSourceBuildTransactionCoveredContracts: [
      "programmableLaunchStampRouter", "graphFactory",
    ],
    officialSourcePinnedCoveredContracts: ["permitAuthority"],
  },
});

const atomicDeploymentEvidence = Object.freeze({
  ...atomicDeploymentEvidencePreimage,
  evidenceDigest: framedSha256Json(
    atomicDeploymentEvidencePreimage.schemaVersion,
    atomicDeploymentEvidencePreimage,
  ),
});

const permitAuthorityProvenancePreimage = Object.freeze({
  schemaVersion: "programmable.custom-launch-deployment-evidence.v1",
  kind: "official-source-pinned",
  address: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
  transactionHash: codeHash("e"),
  blockNumber: "49209973",
  blockHash: codeHash("4"),
  sourceCommitment:
    "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb",
  configurationEvidence: safeConfigurationEvidence,
});

const permitAuthoritySourceProvenance = Object.freeze({
  ...permitAuthorityProvenancePreimage,
  evidenceDigest: framedSha256Json(
    permitAuthorityProvenancePreimage.schemaVersion,
    permitAuthorityProvenancePreimage,
  ),
});

const uniswapRegistrySource = Object.freeze({
  repository: "Uniswap/contracts",
  commit: "4cfc406c8e34da3ce04e60657a7825075b64fd22",
  path: "deployments/json/4663.json",
  rawUrl:
    "https://raw.githubusercontent.com/Uniswap/contracts/4cfc406c8e34da3ce04e60657a7825075b64fd22/deployments/json/4663.json",
  sha256: "sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15",
});

const externalRootDeploymentEvidence = Object.freeze([
  ["poolManager", "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
    "0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41", "9070"],
  ["positionManager", "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
    "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
    "0x228c18ada6cb46b4fbcc18f4ec1519953415393e256fa8349aafbd5a2db037c8", "9073"],
  ["stateView", "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6",
    "0x3d61e2c9eeb482385b1aa436b9e8f812167ea579cc390e4f93bc5abde00582f4", "9075"],
  ["v4Quoter", "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
    "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
    "0x6bf436d72a17f87284ddcab43094689bd320dfb39b535213b9a0b669fabc4ab4", "9074"],
  ["universalRouter", "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
    "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
    "0xdfb76494e158d8dea4376160315239271636a18515207fd4526e574bc7eeb456", "3347899"],
].map(([contract, contractAddress, runtimeCodeHash, transactionHash, startBlock], index) => {
  const blockHash = codeHash(String((index + 5) % 10));
  const previousBlockHash = codeHash(String((index + 4) % 10));
  const previousBlockNumber = (BigInt(startBlock) - 1n).toString(10);
  const providerReadbacks = Object.freeze([
    ["quicknode", "quicknode.com"],
    ["alchemy", "alchemy.com"],
  ].map(([providerId, trustDomain]) => {
    const preimage = Object.freeze({
      providerId,
      trustDomain,
      transactionHash,
      rawTransactionDigest: `sha256:${"0".repeat(64)}`,
      transactionDigest: `sha256:${"1".repeat(64)}`,
      previousBlockNumber,
      previousBlockHash,
      previousBlockRuntimeCodeHash:
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      blockNumber: startBlock,
      blockHash,
      runtimeCodeHash,
      transactionReceiptDigest: `sha256:${"2".repeat(64)}`,
    });
    return Object.freeze({
      ...preimage,
      evidenceDigest: framedSha256Json(
        "programmable.custom-launch-deployment-provider-readback.v2",
        preimage,
      ),
    });
  }));
  const preimage = Object.freeze({
    schemaVersion: "programmable.custom-launch-deployment-evidence.v1",
    contract,
    kind: "exact-observed-deployment",
    address: contractAddress,
    runtimeCodeHash,
    transactionHash,
    previousBlockNumber,
    previousBlockHash,
    previousBlockRuntimeCodeHash:
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    startBlock,
    blockHash,
    registrySource: uniswapRegistrySource,
    providerReadbacks,
  });
  return Object.freeze({
    ...preimage,
    evidenceDigest: framedSha256Json(preimage.schemaVersion, preimage),
  });
}));

export const v4ChainDeployment = Object.freeze({
  schemaVersion: "programmable.custom-launch-chain-deployment.v1",
  chainDeploymentId: ROBINHOOD_CHAIN_DEPLOYMENT_ID,
  chainId: ROBINHOOD_CHAIN_ID,
  caip2: ROBINHOOD_CAIP2,
  finality: {
    schemaVersion: "programmable.custom-launch-finality-policy-ref.v1",
    policyId: "robinhood-stage-finality-v1",
    policyRevision: 1,
    policyDigest: "sha256:537d531423d1285a3808556a57303ec68f1e6bdeea3c9aaf6320f9e5a0e47153",
  },
  foundationSourceCommitment:
    "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
  deploymentEvidence: atomicDeploymentEvidence,
  permit2GenesisProvenance,
  permitAuthoritySourceProvenance,
  externalRootDeploymentEvidence,
  contracts: {
    programmableLaunchStampRouter: {
      address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
      runtimeCodeHash: "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
    },
    permitAuthority: {
      address: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
      runtimeCodeHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
    },
    graphFactory: {
      address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
      runtimeCodeHash: "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
    },
    poolManager: {
      address: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
      runtimeCodeHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
    },
    positionManager: {
      address: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
      runtimeCodeHash: "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
    },
    stateView: {
      address: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
      runtimeCodeHash: "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6",
    },
    v4Quoter: {
      address: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
      runtimeCodeHash: "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
    },
    permit2: {
      address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      runtimeCodeHash: "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
    },
    universalRouter: {
      address: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
      runtimeCodeHash: "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
    },
  },
});

export function validV4Request(overrides = {}) {
  return {
    schemaVersion: "programmable.custom-launch-create-request.v4",
    chainId: ROBINHOOD_CHAIN_ID,
    caip2: ROBINHOOD_CAIP2,
    chainDeployment: v4ChainDeployment,
    chainDeploymentDescriptorDigest: hashV4ChainDeployment(v4ChainDeployment),
    profile: v4Profile,
    launchWallet: address("a"),
    nonce: `0x${"b".repeat(64)}`,
    fixtureCommitment: `sha256:${"c".repeat(64)}`,
    ...overrides,
  };
}

export function validV4ExternalContractDeclaration(overrides = {}) {
  return {
    schemaVersion: "programmable.custom-launch-external-contract.v1",
    chainId: ROBINHOOD_CHAIN_ID,
    caip2: ROBINHOOD_CAIP2,
    address: address("1"),
    runtimeCodeHash: codeHash("2"),
    sourceEvidenceDigest: `sha256:${"3".repeat(64)}`,
    role: "oracle",
    startBlock: "49209900",
    auditBlock: "49209950",
    locator: {
      targetId: "token",
      phase: "constructor",
      byteOffset: 0,
      encoding: "abi-address-word",
    },
    mutability: {
      kind: "immutable",
      proxyType: null,
      implementation: null,
      adminAddress: null,
      beaconAddress: null,
      evidenceDigest: `sha256:${"4".repeat(64)}`,
    },
    ...overrides,
  };
}

export function validV4ExternalProxyContractDeclaration(overrides = {}) {
  return validV4ExternalContractDeclaration({
    mutability: {
      kind: "proxy",
      proxyType: "eip1967-uups",
      implementation: {
        address: address("5"),
        runtimeCodeHash: codeHash("6"),
        sourceEvidenceDigest: `sha256:${"7".repeat(64)}`,
        startBlock: "49209800",
        auditBlock: "49209950",
      },
      adminAddress: null,
      beaconAddress: null,
      evidenceDigest: `sha256:${"8".repeat(64)}`,
    },
    ...overrides,
  });
}

export function v4RequestBytes(request = validV4Request()) {
  return Buffer.from(canonicalizeJson(request), "utf8");
}

export function validV4Capabilities(overrides = {}) {
  return {
    schemaVersion: "programmable.custom-launch-capabilities.v2",
    apiVersion: "v4",
    serverTime: "2026-08-29T12:00:00.000Z",
    readinessUrl: "/readyz",
    chain: {
      id: ROBINHOOD_CHAIN_ID,
      caip2: ROBINHOOD_CAIP2,
      name: "Robinhood Chain Mainnet",
    },
    chainDeployment: v4ChainDeployment,
    chainDeploymentDescriptorDigest: hashV4ChainDeployment(v4ChainDeployment),
    profile: v4Profile,
    routes: {
      capabilities: "/v4/chains/4663/capabilities",
      create: "/v4/chains/4663/custom-launches",
      preflight: "/v4/chains/4663/custom-launches/preflight",
      list: "/v4/chains/4663/custom-launches",
      status: "/v4/chains/4663/custom-launches/{launchId}",
      finalizedMetadata: "/v4/chains/4663/finalized-custom-launches",
    },
    authentication: {
      create: "bearer-api-key",
      preflight: "bearer-api-key",
      status: "bearer-api-key",
      finalizedMetadata: "none",
      capabilities: "none",
      requiredScopes: ["custom-launch:create", "custom-launch:read"],
      apiKeyIsWallet: false,
    },
    graph: {
      minimumTargets: 3,
      maximumTargets: 16,
      hookPermissionBits: HOOK_PERMISSIONS,
    },
    funding: { modes: ["none", "wallet-transaction-value"] },
    metadataImage: {
      schemaVersion: "programmable.project-metadata-image-capability.v1",
      mediaTypes: ["image/png", "image/gif"],
      maximumBytes: 5_242_880,
      maximumDimension: 8_192,
      maximumPixels: 4_194_304,
      gifFrames: 1,
    },
    toolchains: [{
      compiler: "solc",
      version: "0.8.26+commit.8a97fa7a",
      digest: `sha256:${"d".repeat(64)}`,
    }],
    readiness: { status: "ready", reasonCodes: [] },
    safety: {
      serverAuthoritative: true,
      clientBypassAccepted: false,
      walletSignatureProduced: false,
      transactionBroadcast: false,
      feeBehaviorClaim: false,
      universalFeeBehaviorClaim: false,
      genericClaimingLive: false,
    },
    walletHandoff: {
      schemaVersion: "programmable.exact-wallet-transaction.v4",
      separateWalletSignatureRequired: true,
      walletHandoffBaseUrl: "https://programmable.market/developers/api-keys",
    },
    ...overrides,
  };
}

export function validV4Preflight(request = validV4Request(), rawBytes = v4RequestBytes(request)) {
  return {
    schemaVersion: "programmable.custom-launch-preflight.v2",
    apiVersion: "v4",
    chainId: ROBINHOOD_CHAIN_ID,
    caip2: ROBINHOOD_CAIP2,
    requestHash: customLaunchRequestHashV4(request),
    rawRequestSha256: sha256Digest(rawBytes),
    chainDeploymentId: ROBINHOOD_CHAIN_DEPLOYMENT_ID,
    chainDeploymentDescriptorDigest: hashV4ChainDeployment(v4ChainDeployment),
    profile: v4Profile,
    serverTime: "2026-08-29T12:00:01.000Z",
    disposition: "supported",
    launchEligibility: { deployable: true, routable: true, featured: false },
    evidenceTier: "launch_mechanics_verified",
    hardBlockFindingCodes: [],
    needsEvidenceFindingCodes: [],
    warningFindingCodes: [],
    remediations: [],
    gates: {
      chainBinding: "passed",
      trustRoots: "passed",
      sourceBuild: "passed",
      graph: "passed",
      metadata: "passed",
      fundingSettlement: "passed",
      deterministicValidation: "passed",
      chainSimulation: "passed",
    },
    quotaConsumed: false,
    nonceAllocated: false,
    persisted: false,
    walletSignatureRequiredLater: true,
    walletBroadcastByService: false,
  };
}

export function validExactWalletTransaction(overrides = {}) {
  const calldata = validV4WalletCalldata();
  const transaction = {
    schemaVersion: "programmable.exact-wallet-transaction.v4",
    chainId: ROBINHOOD_CHAIN_ID,
    caip2: ROBINHOOD_CAIP2,
    apiVersion: "v4",
    chainDeploymentId: ROBINHOOD_CHAIN_DEPLOYMENT_ID,
    chainDeploymentDescriptorDigest: hashV4ChainDeployment(v4ChainDeployment),
    chainDeployment: v4ChainDeployment,
    profile: v4Profile,
    finalityPolicy: v4ChainDeployment.finality,
    from: address("a"),
    to: v4ChainDeployment.contracts.programmableLaunchStampRouter.address,
    valueWei: "0",
    calldata,
    selector: "0xe5f6b8cd",
    routerRuntimeCodeHash:
      v4ChainDeployment.contracts.programmableLaunchStampRouter.runtimeCodeHash,
    expiresAt: "2026-08-29T12:20:00.000Z",
    commitments: {
      sourceBuild: `sha256:${"2".repeat(64)}`,
      graph: `sha256:${"3".repeat(64)}`,
      metadata: `sha256:${"4".repeat(64)}`,
      verification: `sha256:${"5".repeat(64)}`,
      fundingPermit: `sha256:${"6".repeat(64)}`,
      launchIntent: `sha256:${"7".repeat(64)}`,
    },
    launchSummary: {
      chainName: "Robinhood Chain Mainnet",
      controller: address("a"),
      name: "Robinhood V4 Test",
      symbol: "RHV4",
      fundingMode: "none",
      valueWei: "0",
    },
    ...overrides,
  };
  const { transactionPreimageHash: supplied, ...preimage } = transaction;
  return {
    ...transaction,
    transactionPreimageHash: supplied ?? sha256Digest(Buffer.concat([
      Buffer.from("programmable.exact-wallet-transaction-preimage.v4", "utf8"),
      Buffer.from([0]),
      Buffer.from(canonicalizeJson(preimage), "utf8"),
    ])),
  };
}

export function validV4WalletArtifact() {
  return buildV4WalletVector().artifact;
}

function buildV4WalletVector({ initializerCalldataByIndex = {} } = {}) {
  const routeNonce = `0x${"b".repeat(64)}`;
  const { route, routePayload } = buildCanonicalCustomGraphRouteV4({
    chainId: ROBINHOOD_CHAIN_ID,
    router: v4ChainDeployment.contracts.programmableLaunchStampRouter.address,
    graphFactory: v4ChainDeployment.contracts.graphFactory.address,
    routeNamespace: `0x${"1".repeat(64)}`,
    routeNonce,
    topologyHash: `0x${"2".repeat(64)}`,
    targets: [0, 1, 2].map((index) => ({
      targetIdHash: `0x${String(index + 3).repeat(64)}`,
      applicantSalt: `0x${String(index + 6).repeat(64)}`,
      deploymentValue: 0n,
      initializerValue: 0n,
      initCode: `0x600${index}`,
      initializerCalldata: initializerCalldataByIndex[index] ?? "0x",
      runtimeCodeHash: `0x${String(index + 1).repeat(64)}`,
    })),
  });
  const kinds = new Map([[0, 1], [1, 2], [2, 0]]);
  const components = route.expectedOutputs.map((output) => ({
    resultIndex: output.targetIndex,
    account: output.account,
    runtimeCodeHash: output.runtimeCodeHash,
    kind: kinds.get(output.targetIndex),
    scope: 1,
  })).sort((left, right) => BigInt(left.account) < BigInt(right.account) ? -1 : 1);
  const token = components.find(({ kind }) => kind === 1);
  const hook = components.find(({ kind }) => kind === 2);
  const stampRequest = {
    launchId: `0x${"a".repeat(64)}`,
    token: token.account,
    tokenRuntimeCodeHash: token.runtimeCodeHash,
    poolKey: {
      currency0: address("0"),
      currency1: token.account,
      fee: 3_000,
      tickSpacing: 60,
      hooks: hook.account,
    },
    hookRuntimeCodeHash: hook.runtimeCodeHash,
    components,
  };
  const hashes = recomputeArtifactHashesV4({
    routePayload,
    stampRequest,
    chainId: ROBINHOOD_CHAIN_ID,
    router: v4ChainDeployment.contracts.programmableLaunchStampRouter.address,
    graphFactory: v4ChainDeployment.contracts.graphFactory.address,
  });
  const permit = {
    chainId: ROBINHOOD_CHAIN_ID,
    router: v4ChainDeployment.contracts.programmableLaunchStampRouter.address,
    launchWallet: getAddress(address("a")),
    kind: 1,
    routePayloadHash: hashes.routePayloadHash,
    expectedResultHash: hashes.expectedResultHash,
    stampRequestHash: hashes.stampRequestHash,
    nonce: routeNonce,
    validAfter: "1788004800",
    deadline: "1788006000",
    valueWei: "0",
  };
  return {
    route,
    routeDetails: hashes.route,
    artifact: {
    permit,
    stampRequest,
    routePayload,
    permitSignature: `0x${"ab".repeat(65)}`,
    },
  };
}

export function validV4WalletCalldata() {
  const artifact = validV4WalletArtifact();
  return encodeLaunchAndStampCalldataV4({
    permit: artifact.permit,
    stampRequest: artifact.stampRequest,
    routePayload: artifact.routePayload,
    signature: artifact.permitSignature,
  });
}

export function validPreparedArtifactV4(
  commitments = validExactWalletTransaction().commitments,
  vector = buildV4WalletVector(),
) {
  const { artifact, routeDetails } = vector;
  const chainBindings = {
    chainId: ROBINHOOD_CHAIN_ID,
    router: v4ChainDeployment.contracts.programmableLaunchStampRouter.address,
    routerRuntimeCodeHash:
      v4ChainDeployment.contracts.programmableLaunchStampRouter.runtimeCodeHash,
    permitAuthority: v4ChainDeployment.contracts.permitAuthority.address,
    permitAuthorityRuntimeCodeHash:
      v4ChainDeployment.contracts.permitAuthority.runtimeCodeHash,
    graphFactory: v4ChainDeployment.contracts.graphFactory.address,
    graphFactoryRuntimeCodeHash: v4ChainDeployment.contracts.graphFactory.runtimeCodeHash,
    poolManager: v4ChainDeployment.contracts.poolManager.address,
    poolManagerRuntimeCodeHash: v4ChainDeployment.contracts.poolManager.runtimeCodeHash,
  };
  const emptyCalldata = encodeLaunchAndStampCalldataV4({
    permit: artifact.permit,
    stampRequest: artifact.stampRequest,
    routePayload: artifact.routePayload,
    signature: "0x",
  });
  const unsignedPreimage = {
    chainId: ROBINHOOD_CHAIN_ID,
    from: artifact.permit.launchWallet,
    to: artifact.permit.router,
    valueWei: artifact.permit.valueWei,
    functionName: "launchAndStampV1",
    selector: "0xe5f6b8cd",
    calldataWithEmptySignature: emptyCalldata,
    signatureState: "permit-authority-signature-required",
  };
  const componentsByIndex = new Map(
    artifact.stampRequest.components.map((component) => [component.resultIndex, component]),
  );
  const preimage = {
    schemaVersion: "programmable.prepared-custom-graph-launch.v1",
    verificationBundleHash: commitments.verification,
    unboundGraphBundleHash: `sha256:${"8".repeat(64)}`,
    projectMetadata: validV4ProjectMetadata(),
    projectMetadataHash: commitments.metadata,
    graphBundleHash: commitments.graph,
    sourceBundleSha256: `sha256:${"9".repeat(64)}`,
    chainBindings,
    callerConstraints: {
      transactionSender: artifact.permit.launchWallet,
      factoryAuthorizedLauncher: artifact.permit.router,
      fixedRouterTarget: artifact.permit.router,
      fixedFunctionSelector: "0xe5f6b8cd",
      arbitraryTargetAccepted: false,
      arbitraryCalldataAccepted: false,
    },
    timing: {
      validAfter: artifact.permit.validAfter,
      deadline: artifact.permit.deadline,
      maximumLifetimeSeconds: "3600",
    },
    route: {
      routeNamespace: routeDetails.routeNamespace,
      routeNonce: routeDetails.routeNonce,
      topologyHash: routeDetails.topologyHash,
      graphCommitment: routeDetails.graphCommitment,
      totalValueWei: routeDetails.totalValueWei,
      routePayload: artifact.routePayload,
      routePayloadHash: artifact.permit.routePayloadHash,
      expectedGraphDeploymentHash: routeDetails.expectedGraphDeploymentHash,
      targets: routeDetails.targets.map((target, index) => ({
        targetIndex: target.targetIndex,
        targetId: ["token", "hook", "initializer"][index],
        targetIdHash: target.targetIdHash,
        applicantSalt: target.applicantSalt,
        effectiveSalt: target.effectiveSalt,
        deploymentValueWei: target.deploymentValueWei,
        initializerValueWei: target.initializerValueWei,
        initCode: target.initCode,
        initializerCalldata: target.initializerCalldata,
        initCodeHash: target.initCodeHash,
        initializerCalldataHash: target.initializerCalldataHash,
        targetCommitment: target.targetCommitment,
        predictedAddress: target.predictedAddress,
        expectedRuntimeCodeHash: target.expectedRuntimeCodeHash,
      })),
    },
    predictedComponents: routeDetails.expectedOutputs.map((output, index) => {
      const component = componentsByIndex.get(index);
      return {
        targetIndex: index,
        targetId: ["token", "hook", "initializer"][index],
        account: output.account,
        expectedRuntimeCodeHash: output.runtimeCodeHash,
        componentKind: component.kind === 1 ? "token" : component.kind === 2 ? "hook" : "other",
        effectiveSalt: routeDetails.targets[index].effectiveSalt,
        initCodeHash: routeDetails.targets[index].initCodeHash,
        addressHookPermissionMask: Number(BigInt(output.account) & 0x3fffn),
        declaredHookPermissionMask: component.kind === 2
          ? Number(BigInt(output.account) & 0x3fffn)
          : null,
      };
    }),
    market: {
      token: artifact.stampRequest.token,
      hook: artifact.stampRequest.poolKey.hooks,
      poolKey: artifact.stampRequest.poolKey,
      poolId: `0x${"c".repeat(64)}`,
      poolKeyHash: `0x${"d".repeat(64)}`,
    },
    stampRequest: artifact.stampRequest,
    stampRequestHash: artifact.permit.stampRequestHash,
    permit: artifact.permit,
    permitDigest: hashTypedData({
      domain: {
        name: "ProgrammableLaunchStampRouter",
        version: "1",
        chainId: BigInt(ROBINHOOD_CHAIN_ID),
        verifyingContract: artifact.permit.router,
      },
      primaryType: "ProgrammableLaunchPermitV1",
      types: {
        ProgrammableLaunchPermitV1: [
          { name: "chainId", type: "uint256" },
          { name: "router", type: "address" },
          { name: "launchWallet", type: "address" },
          { name: "kind", type: "uint8" },
          { name: "routePayloadHash", type: "bytes32" },
          { name: "expectedResultHash", type: "bytes32" },
          { name: "stampRequestHash", type: "bytes32" },
          { name: "nonce", type: "bytes32" },
          { name: "validAfter", type: "uint64" },
          { name: "deadline", type: "uint64" },
          { name: "value", type: "uint256" },
        ],
      },
      message: {
        chainId: BigInt(artifact.permit.chainId),
        router: artifact.permit.router,
        launchWallet: artifact.permit.launchWallet,
        kind: artifact.permit.kind,
        routePayloadHash: artifact.permit.routePayloadHash,
        expectedResultHash: artifact.permit.expectedResultHash,
        stampRequestHash: artifact.permit.stampRequestHash,
        nonce: artifact.permit.nonce,
        validAfter: BigInt(artifact.permit.validAfter),
        deadline: BigInt(artifact.permit.deadline),
        value: BigInt(artifact.permit.valueWei),
      },
    }),
    unsignedRouterTransaction: {
      ...unsignedPreimage,
      preimageHash: sha256Digest(Buffer.from(canonicalizeJson(unsignedPreimage), "utf8")),
    },
    claims: {
      provenance: "prepared-for-atomic-router-stamp",
      safety: "not-asserted",
      approval: "not-asserted",
    },
  };
  return {
    ...preimage,
    artifactHash: sha256Digest(Buffer.from(canonicalizeJson(preimage), "utf8")),
  };
}

export function validCoordinatedGraphSubstitutionV4(commitments) {
  const vector = buildV4WalletVector({ initializerCalldataByIndex: { 2: "0x00" } });
  const preparedArtifact = validPreparedArtifactV4(commitments, vector);
  const calldata = encodeLaunchAndStampCalldataV4({
    permit: vector.artifact.permit,
    stampRequest: vector.artifact.stampRequest,
    routePayload: vector.artifact.routePayload,
    signature: vector.artifact.permitSignature,
  });
  const walletTransaction = validExactWalletTransaction({ calldata, commitments });
  return { preparedArtifact, walletTransaction };
}

export function validAdmissionReceiptV4(resource) {
  const externalEvidence = validExternalContractEvidenceReceiptV4(resource);
  const preimage = {
    schemaVersion: "programmable.custom-launch-admission-receipt.v4",
    apiVersion: "v4",
    chainId: ROBINHOOD_CHAIN_ID,
    requestHash: resource.requestHash,
    rawRequestSha256: resource.rawRequestSha256,
    chainDeploymentDescriptorDigest: resource.chainDeploymentDescriptorDigest,
    profileDigest: resource.profile.profileDigest,
    commitments: resource.commitments,
    staticAnalysisDigest: `sha256:${"e".repeat(64)}`,
    externalContractEvidenceDigest: externalEvidence.evidenceDigest,
    disposition: "supported",
    evidenceTier: "launch_mechanics_verified",
    hardBlockFindingCodes: [],
    needsEvidenceFindingCodes: [],
    warningFindingCodes: [],
    issuedAt: "2026-08-29T12:00:02.000Z",
  };
  return { ...preimage, receiptDigest: framedSha256(preimage.schemaVersion, preimage) };
}

export function validExternalContractEvidenceReceiptV4(resource) {
  const evidencePreimage = {
    schemaVersion: "programmable.custom-launch-external-contract-evidence.v4",
    chainId: ROBINHOOD_CHAIN_ID,
    caip2: ROBINHOOD_CAIP2,
    deploymentId: ROBINHOOD_CHAIN_DEPLOYMENT_ID,
    requestHash: resource.requestHash,
    rawRequestSha256: resource.rawRequestSha256,
    chainDeploymentDescriptorDigest: resource.chainDeploymentDescriptorDigest,
    profile: resource.profile,
    profileDigest: resource.profile.profileDigest,
    providers: [
      { role: "primary", providerId: "drpc", trustDomain: "drpc.org" },
      { role: "secondary", providerId: "alchemy", trustDomain: "alchemy.com" },
    ],
    references: [],
    verified: true,
    findingCodes: [],
    observedAt: "2026-08-29T12:00:02.000Z",
  };
  return {
    ...evidencePreimage,
    evidenceDigest: framedSha256(
      "programmable.custom-launch-external-contract-evidence.v4",
      evidencePreimage,
    ),
  };
}

export function validSimulationReceiptV4(resource) {
  const preimage = {
    schemaVersion: "programmable.custom-launch-simulation-receipt.v4",
    apiVersion: "v4",
    kind: "exact_wallet_transaction",
    chainId: ROBINHOOD_CHAIN_ID,
    requestHash: resource.requestHash,
    transactionPreimageHash: resource.walletTransactionPreimageHash,
    chainDeploymentDescriptorDigest: resource.chainDeploymentDescriptorDigest,
    profileDigest: resource.profile.profileDigest,
    providerEvidenceDigest: `sha256:${"1".repeat(64)}`,
    passed: true,
    reasonCode: null,
    observedBlockNumber: "49210000",
    observedBlockHash: `0x${"e".repeat(64)}`,
    issuedAt: "2026-08-29T12:00:03.000Z",
  };
  return { ...preimage, receiptDigest: framedSha256(preimage.schemaVersion, preimage) };
}

function framedSha256(domain, value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

export function validV4SourceVerificationStatus(overrides = {}) {
  const exactEvidence = (providerDigestDigit, bindingDigestDigit) => ({
    providerObservation: {
      provider: "sourcify-v2",
      classification: "PARTIAL_NO_CBOR_EXACT_BYTES",
      match: "match",
      creationMatch: "match",
      runtimeMatch: "match",
      releaseAuthority: false,
      evidenceDigest: `sha256:${providerDigestDigit.repeat(64)}`,
    },
    exactSourceAuthority: "protected-hosted-build-finalized-transaction-bytecode",
    exactSourceBinding: {
      schemaVersion:
        "programmable.robinhood-custom-launch.exact-byte-source-build-transaction-binding.v1",
      authority: "protected-hosted-build-finalized-transaction-bytecode",
      coveredEvidence: [
        "protected-source-tree",
        "source-closure",
        "hosted-build-artifact",
        "standard-json-input",
        "compiler-binary",
        "compiler-settings",
        "finalized-creation-transaction",
        "creation-bytecode",
        "runtime-bytecode",
      ],
      bindingDigest: `sha256:${bindingDigestDigit.repeat(64)}`,
    },
  });
  const components = overrides.components ?? [
    {
      targetId: "hook",
      address: "0x2222222222222222222222222222222222222222",
      status: "exact_match",
      ...exactEvidence("8", "a"),
      updatedAt: "2026-08-29T12:31:00.000Z",
    },
    {
      targetId: "initializer",
      address: "0x3333333333333333333333333333333333333333",
      status: "retrying",
      providerObservation: null,
      exactSourceAuthority: null,
      exactSourceBinding: null,
      updatedAt: "2026-08-29T12:32:00.000Z",
      nextAttemptAt: "2026-08-29T12:34:00.000Z",
    },
    {
      targetId: "token",
      address: "0x1111111111111111111111111111111111111111",
      status: "exact_match",
      ...exactEvidence("9", "b"),
      updatedAt: "2026-08-29T12:30:00.000Z",
    },
  ];
  const status = components.every((component) => component.status === "exact_match")
    ? "exact_match"
    : components.some((component) => component.status === "needs_attention")
      ? "needs_attention"
      : components.some((component) => component.status === "retrying")
        ? "retrying"
        : "queued";
  const updatedAt = components
    .map((component) => component.updatedAt)
    .reduce((latest, current) => current > latest ? current : latest);
  return {
    schemaVersion: "programmable.source-verification-status.v4",
    chainId: ROBINHOOD_CHAIN_ID,
    caip2: ROBINHOOD_CAIP2,
    chainDeploymentId: ROBINHOOD_CHAIN_DEPLOYMENT_ID,
    status,
    components,
    updatedAt,
    ...overrides,
  };
}

export function validV4Resource(
  request = validV4Request(),
  rawBytes = v4RequestBytes(request),
  overrides = {},
) {
  const fundingPermitCommitment = request.funding === undefined
      || request.nonce === undefined
      || request.permitWindow === undefined
    ? `sha256:${"6".repeat(64)}`
    : framedSha256Json("programmable.custom-launch-funding-permit.v4", {
      funding: request.funding,
      nonce: request.nonce,
      permitWindow: request.permitWindow,
    });
  const verificationCommitment = request.verificationBundle === undefined
    ? `sha256:${"5".repeat(64)}`
    : framedSha256Json(request.verificationBundle.schemaVersion, request.verificationBundle);
  return {
    schemaVersion: "programmable.custom-launch.v4",
    apiVersion: "v4",
    launchId: V4_LAUNCH_ID,
    requestId: V4_REQUEST_ID,
    routeId: "custom-launch:create:v4",
    chainId: ROBINHOOD_CHAIN_ID,
    caip2: ROBINHOOD_CAIP2,
    chainDeploymentId: ROBINHOOD_CHAIN_DEPLOYMENT_ID,
    chainDeploymentDescriptorDigest: hashV4ChainDeployment(v4ChainDeployment),
    chainDeployment: v4ChainDeployment,
    profile: v4Profile,
    controller: {
      namespace: ROBINHOOD_CAIP2,
      address: request.launchWallet,
    },
    status: "received",
    requestHash: customLaunchRequestHashV4(request),
    rawRequestSha256: sha256Digest(rawBytes),
    sourceBuildCommitment: `sha256:${"2".repeat(64)}`,
    graphCommitment: `sha256:${"3".repeat(64)}`,
    metadataCommitment: `sha256:${"4".repeat(64)}`,
    walletTransactionPreimageHash: null,
    commitments: {
      sourceBuild: `sha256:${"2".repeat(64)}`,
      graph: `sha256:${"3".repeat(64)}`,
      metadata: `sha256:${"4".repeat(64)}`,
      verification: verificationCommitment,
      fundingPermit: fundingPermitCommitment,
      launchIntent: request.launchIntentHash ?? `sha256:${"7".repeat(64)}`,
    },
    projectMetadata: validV4ProjectMetadata(),
    funding: request.funding ?? {
      schemaVersion: "programmable.custom-launch-funding-intent.v2",
      mode: "none",
      valueWei: "0",
    },
    liquidityModel: request.liquidityModel ?? {
      schemaVersion: "programmable.custom-launch-liquidity-model.v1",
      model: "none-empty-pool",
      declaredLaunchState: "pool-initialized-empty",
      targetIds: [],
    },
    walletTransaction: null,
    preparedArtifact: null,
    admissionReceipt: null,
    simulationReceipt: null,
    externalContractEvidenceReceipt: null,
    onchain: null,
    failure: null,
    createdAt: "2026-08-29T12:00:00.000Z",
    updatedAt: "2026-08-29T12:00:00.000Z",
    ...overrides,
  };
}

export function validV4ProjectMetadata() {
  return {
    schemaVersion: "programmable.project-metadata.v1",
    token: { name: "Robinhood V4 Test", symbol: "RHV4" },
    presentation: {
      schemaVersion: "programmable.launch-presentation-draft.v1",
      description: "Deterministic Robinhood Chain V4 launch metadata fixture",
      image: {
        uri: "https://example.com/token.png",
        contentSha256: "sha256:431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
        mediaType: "image/png",
        byteLength: 68,
        width: 1,
        height: 1,
      },
      links: [
        { kind: "website", uri: "https://example.com/" },
        { kind: "x", uri: "https://x.com/programmable" },
      ],
    },
    tokenMetadataBinding: {
      schemaVersion: "programmable.project-token-metadata-binding.v1",
      tokenTargetId: "token",
      declarationBinding: "request-and-launch-id",
      standardReadModel: { name: true, symbol: true },
      name: {
        staticSource: "not-deterministically-extractable",
        argumentIndex: null,
        argumentName: null,
      },
      symbol: {
        staticSource: "not-deterministically-extractable",
        argumentIndex: null,
        argumentName: null,
      },
      postDeploymentReadback: "required",
    },
  };
}

export function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}
