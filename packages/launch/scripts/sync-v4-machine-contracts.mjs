#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const publicSchemaRoot = path.join(repositoryRoot, "public/schemas/custom-launch/v4");
const openApiPath = path.join(repositoryRoot, "public/openapi/custom-launch-v4.json");
const packagedPackConfigPath = path.join(
  packageRoot,
  "schemas/programmable-launch-pack-config-v4.json",
);

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const documents = new Map(await Promise.all([1, 2, 3].map(async (version) => {
  const name = `custom-launch-v${version}.json`;
  return [name, await readJson(path.join(repositoryRoot, `public/openapi/${name}`))];
})));
const openapi = await readJson(openApiPath);
documents.set("custom-launch-v4.json", openapi);

const clone = (value) => structuredClone(value);
const closed = (required, properties, rest = {}) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
  ...rest,
});
const nullable = (schema) => ({ oneOf: [schema, { type: "null" }] });
const array = (items, rest = {}) => ({ type: "array", items, ...rest });
const tuple = (...prefixItems) => ({
  type: "array",
  prefixItems,
  items: false,
  minItems: prefixItems.length,
  maxItems: prefixItems.length,
});
const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const hex = { type: "string", pattern: "^0x(?:[0-9a-f]{2})*$" };
const hex32 = { type: "string", pattern: "^0x[0-9a-f]{64}$" };
const nonzeroHex32 = { type: "string", pattern: "^0x(?!0{64}$)[0-9a-f]{64}$" };
const sha256 = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const uint = { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" };
const positiveUint = { type: "string", pattern: "^[1-9][0-9]*$" };
const dateTime = { type: "string", format: "date-time" };
const millisecondDateTime = {
  type: "string",
  format: "date-time",
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
};
const identifier = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:@/+\\-]{0,255}$" };
const uuid = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
};
const opaqueListCursor = {
  type: "string",
  minLength: 16,
  maxLength: 512,
  pattern: "^[A-Za-z0-9_-]+$",
};

const finalityPolicy = closed(
  ["schemaVersion", "policyId", "policyRevision", "policyDigest"],
  {
    schemaVersion: { const: "programmable.custom-launch-finality-policy-ref.v1" },
    policyId: { type: "string", pattern: "^[a-z][a-z0-9._:-]{0,127}$" },
    policyRevision: { type: "integer", minimum: 1 },
    policyDigest: sha256,
  },
);
const contractNames = [
  "programmableLaunchStampRouter",
  "permitAuthority",
  "graphFactory",
  "poolManager",
  "positionManager",
  "stateView",
  "v4Quoter",
  "permit2",
  "universalRouter",
];
const pinnedContractBindings = Object.freeze({
  programmableLaunchStampRouter: Object.freeze({
    address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
    runtimeCodeHash: "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
  }),
  permitAuthority: Object.freeze({
    address: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
    runtimeCodeHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  }),
  graphFactory: Object.freeze({
    address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
    runtimeCodeHash: "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  }),
  poolManager: Object.freeze({
    address: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    runtimeCodeHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  }),
  positionManager: Object.freeze({
    address: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
    runtimeCodeHash: "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
  }),
  stateView: Object.freeze({
    address: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    runtimeCodeHash: "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6",
  }),
  v4Quoter: Object.freeze({
    address: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
    runtimeCodeHash: "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
  }),
  permit2: Object.freeze({
    address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    runtimeCodeHash: "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
  }),
  universalRouter: Object.freeze({
    address: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
    runtimeCodeHash: "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
  }),
});
const pinnedContractBinding = (name) => closed(["address", "runtimeCodeHash"], {
  address: { const: pinnedContractBindings[name].address },
  runtimeCodeHash: { const: pinnedContractBindings[name].runtimeCodeHash },
});
const permit2GenesisProviderReadback = (providerId, trustDomain) => closed(
  [
    "schemaVersion", "providerId", "trustDomain", "blockNumber", "blockHash",
    "runtimeCodeHash", "evidenceDigest",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-genesis-provider-readback.v1" },
    providerId: { const: providerId },
    trustDomain: { const: trustDomain },
    blockNumber: { const: "0" },
    blockHash: nonzeroHex32,
    runtimeCodeHash: {
      const: "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
    },
    evidenceDigest: sha256,
  },
);
const atomicDeploymentProviderReadback = (providerId, trustDomain) => closed(
  [
    "providerId", "trustDomain", "transactionHash", "transactionResponseDigest",
    "transactionReceiptDigest", "evidenceDigest",
  ],
  {
    providerId: { const: providerId },
    trustDomain: { const: trustDomain },
    transactionHash: nonzeroHex32,
    transactionResponseDigest: sha256,
    transactionReceiptDigest: sha256,
    evidenceDigest: sha256,
  },
);
const atomicRootTransitionProviderReadback = (
  providerId,
  trustDomain,
  contract,
  contractAddress,
  runtimeCodeHash,
) => closed(
  [
    "schemaVersion", "providerId", "trustDomain", "contract", "address",
    "preDeploymentBlockNumber", "preDeploymentBlockHash",
    "preDeploymentRuntimeCodeHash", "deploymentBlockNumber",
    "deploymentBlockHash", "deploymentRuntimeCodeHash", "evidenceDigest",
  ],
  {
    schemaVersion: {
      const: "programmable.robinhood-atomic-root-runtime-transition-provider-readback.v1",
    },
    providerId: { const: providerId },
    trustDomain: { const: trustDomain },
    contract: { const: contract },
    address: { const: contractAddress },
    preDeploymentBlockNumber: uint,
    preDeploymentBlockHash: nonzeroHex32,
    preDeploymentRuntimeCodeHash: {
      const: "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    },
    deploymentBlockNumber: positiveUint,
    deploymentBlockHash: nonzeroHex32,
    deploymentRuntimeCodeHash: { const: runtimeCodeHash },
    evidenceDigest: sha256,
  },
);
const atomicDeploymentResult = (contract, contractAddress, runtimeCodeHash) => closed(
  [
    "contract", "address", "runtimeCodeHash", "previousBlockRuntimeCodeHash",
    "providerReadbacks", "stateEvidenceDigest",
  ],
  {
    contract: { const: contract },
    address: { const: contractAddress },
    runtimeCodeHash: { const: runtimeCodeHash },
    previousBlockRuntimeCodeHash: {
      const: "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    },
    providerReadbacks: tuple(
      atomicRootTransitionProviderReadback(
        "quicknode", "quicknode.com", contract, contractAddress, runtimeCodeHash,
      ),
      atomicRootTransitionProviderReadback(
        "alchemy", "alchemy.com", contract, contractAddress, runtimeCodeHash,
      ),
    ),
    stateEvidenceDigest: sha256,
  },
);
const robinhoodUniswapRegistrySource = closed(
  ["repository", "commit", "path", "rawUrl", "sha256"],
  {
    repository: { const: "Uniswap/contracts" },
    commit: { const: "4cfc406c8e34da3ce04e60657a7825075b64fd22" },
    path: { const: "deployments/json/4663.json" },
    rawUrl: {
      const:
        "https://raw.githubusercontent.com/Uniswap/contracts/4cfc406c8e34da3ce04e60657a7825075b64fd22/deployments/json/4663.json",
    },
    sha256: {
      const: "sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15",
    },
  },
);
const externalRootProviderReadback = (
  providerId,
  trustDomain,
  transactionHash,
  startBlock,
  runtimeCodeHash,
) => closed(
  [
    "providerId", "trustDomain", "transactionHash", "rawTransactionDigest", "transactionDigest",
    "previousBlockNumber", "previousBlockHash", "previousBlockRuntimeCodeHash",
    "blockNumber", "blockHash", "runtimeCodeHash", "transactionReceiptDigest",
    "evidenceDigest",
  ],
  {
    providerId: { const: providerId },
    trustDomain: { const: trustDomain },
    transactionHash: { const: transactionHash },
    rawTransactionDigest: sha256,
    transactionDigest: sha256,
    previousBlockNumber: { const: (BigInt(startBlock) - 1n).toString(10) },
    previousBlockHash: nonzeroHex32,
    previousBlockRuntimeCodeHash: {
      const: "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    },
    blockNumber: { const: startBlock },
    blockHash: nonzeroHex32,
    runtimeCodeHash: { const: runtimeCodeHash },
    transactionReceiptDigest: sha256,
    evidenceDigest: sha256,
  },
);
const externalRootDeployment = (
  contract,
  contractAddress,
  runtimeCodeHash,
  transactionHash,
  startBlock,
) => closed(
  [
    "schemaVersion", "contract", "kind", "address", "runtimeCodeHash",
    "transactionHash", "previousBlockNumber", "previousBlockHash",
    "previousBlockRuntimeCodeHash", "startBlock", "blockHash",
    "registrySource", "providerReadbacks", "evidenceDigest",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-deployment-evidence.v1" },
    contract: { const: contract },
    kind: { const: "exact-observed-deployment" },
    address: { const: contractAddress },
    runtimeCodeHash: { const: runtimeCodeHash },
    transactionHash: { const: transactionHash },
    previousBlockNumber: { const: (BigInt(startBlock) - 1n).toString(10) },
    previousBlockHash: nonzeroHex32,
    previousBlockRuntimeCodeHash: {
      const: "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    },
    startBlock: { const: startBlock },
    blockHash: nonzeroHex32,
    registrySource: clone(robinhoodUniswapRegistrySource),
    providerReadbacks: tuple(
      externalRootProviderReadback(
        "quicknode", "quicknode.com", transactionHash, startBlock, runtimeCodeHash,
      ),
      externalRootProviderReadback(
        "alchemy", "alchemy.com", transactionHash, startBlock, runtimeCodeHash,
      ),
    ),
    evidenceDigest: sha256,
  },
  {
    "x-programmable-order": "previousBlockNumber + 1 == startBlock; "
      + "previousBlockNumber == providerReadbacks[*].previousBlockNumber; "
      + "previousBlockHash == providerReadbacks[*].previousBlockHash; "
      + "startBlock == providerReadbacks[*].blockNumber; "
      + "blockHash == providerReadbacks[*].blockHash; "
      + "providerReadbacks[0].rawTransactionDigest == providerReadbacks[1].rawTransactionDigest; "
      + "providerReadbacks[0].transactionDigest == providerReadbacks[1].transactionDigest; "
      + "providerReadbacks[0].transactionReceiptDigest == providerReadbacks[1].transactionReceiptDigest",
  },
);
const chainDeployment = closed(
  [
    "schemaVersion",
    "chainDeploymentId",
    "chainId",
    "caip2",
    "finality",
    "foundationSourceCommitment",
    "deploymentEvidence",
    "permit2GenesisProvenance",
    "permitAuthoritySourceProvenance",
    "externalRootDeploymentEvidence",
    "contracts",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-chain-deployment.v1" },
    chainDeploymentId: { const: "robinhood-mainnet-custom-launch-v1" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    finality: finalityPolicy,
    foundationSourceCommitment: {
      const: "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
    },
    deploymentEvidence: closed(
      [
        "schemaVersion", "deploymentId", "chainId", "coveredContracts", "transactionHash",
        "from", "to", "valueWei", "selector", "calldataHash", "calldataBytes",
        "nonce", "transactionIndex", "receiptStatus", "blockNumber", "blockHash",
        "receiptLogs", "receiptLogsDigest", "providerReadbacks", "resultingContracts",
        "ethereumFinalityEvidence", "evidenceDigest", "sourceVerification",
      ],
      {
        schemaVersion: {
          const: "programmable.robinhood-atomic-root-deployment-evidence.v1",
        },
        deploymentId: { const: "robinhood-mainnet-custom-launch-v1" },
        chainId: { const: "4663" },
        coveredContracts: {
          const: [
            "programmableLaunchStampRouter", "graphFactory", "permitAuthority",
          ],
        },
        transactionHash: nonzeroHex32,
        from: {
          enum: [
            "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
            "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
          ],
        },
        to: { const: "0xcA11bde05977b3631167028862bE2a173976CA11" },
        valueWei: { const: "0" },
        selector: { const: "0x82ad56cb" },
        calldataHash: {
          const: "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9",
        },
        calldataBytes: { const: 33_412 },
        nonce: uint,
        transactionIndex: uint,
        receiptStatus: { const: "1" },
        blockNumber: positiveUint,
        blockHash: nonzeroHex32,
        receiptLogs: array(
          closed(["address", "topics", "data", "logIndex"], {
            address,
            topics: array(nonzeroHex32, { maxItems: 4 }),
            data: hex,
            logIndex: uint,
          }),
          {
            maxItems: 1_024,
            "x-programmable-order": "strictly increasing logIndex; unique",
          },
        ),
        receiptLogsDigest: sha256,
        providerReadbacks: tuple(
          atomicDeploymentProviderReadback("quicknode", "quicknode.com"),
          atomicDeploymentProviderReadback("alchemy", "alchemy.com"),
        ),
        resultingContracts: tuple(
          atomicDeploymentResult(
            "permitAuthority",
            "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
            "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
          ),
          atomicDeploymentResult(
            "graphFactory",
            "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
            "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
          ),
          atomicDeploymentResult(
            "programmableLaunchStampRouter",
            "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
            "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
          ),
        ),
        ethereumFinalityEvidence: robinhoodEthereumFinalityEvidence(),
        evidenceDigest: sha256,
        sourceVerification: closed(
          [
            "sourcifyProviderMatchCoveredContracts",
            "exactByteSourceBuildTransactionCoveredContracts",
            "officialSourcePinnedCoveredContracts",
          ],
          {
            sourcifyProviderMatchCoveredContracts: {
              const: ["programmableLaunchStampRouter", "graphFactory"],
            },
            exactByteSourceBuildTransactionCoveredContracts: {
              const: ["programmableLaunchStampRouter", "graphFactory"],
            },
            officialSourcePinnedCoveredContracts: {
              const: ["permitAuthority"],
            },
          },
        ),
      },
      {
        "x-programmable-order":
          "resultingContracts providerReadbacks prove blockNumber - 1 -> blockNumber",
      },
    ),
    permit2GenesisProvenance: closed(
      [
        "schemaVersion", "kind", "address", "startBlock", "genesisSourceUrl",
        "genesisSourceDigest", "allocRuntimeCodeBytes", "providerReadbacks", "evidenceDigest",
      ],
      {
        schemaVersion: { const: "programmable.custom-launch-genesis-provenance.v1" },
        kind: { const: "genesis-predeploy" },
        address: { const: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
        startBlock: { const: "0" },
        genesisSourceUrl: {
          const: "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-genesis.json",
        },
        genesisSourceDigest: {
          const: "sha256:353e6f6441b47695b41cee0c3645cde8dd7492d2f7f574bfb6aa4371e41bb6ba",
        },
        allocRuntimeCodeBytes: { const: 9_152 },
        providerReadbacks: tuple(
          permit2GenesisProviderReadback("quicknode", "quicknode.com"),
          permit2GenesisProviderReadback("alchemy", "alchemy.com"),
        ),
        evidenceDigest: sha256,
      },
      {
        "x-programmable-order":
          "providerReadbacks[0].blockHash == providerReadbacks[1].blockHash",
      },
    ),
    permitAuthoritySourceProvenance: closed(
      [
        "schemaVersion", "kind", "address", "transactionHash", "blockNumber", "blockHash",
        "sourceCommitment", "evidenceDigest", "configurationEvidence",
      ],
      {
        schemaVersion: { const: "programmable.custom-launch-deployment-evidence.v1" },
        kind: { const: "official-source-pinned" },
        address: { const: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06" },
        transactionHash: nonzeroHex32,
        blockNumber: positiveUint,
        blockHash: nonzeroHex32,
        sourceCommitment: {
          const: "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb",
        },
        evidenceDigest: sha256,
        configurationEvidence: closed(
          [
            "schemaVersion", "finalized", "blockNumber", "blockHash", "proxyRuntimeCodeHash",
            "singleton", "fallbackHandler", "owners", "threshold", "nonce", "modules", "modulesNext", "guard",
            "fallbackHandlerRuntimeCodeHash", "singletonSlot", "fallbackHandlerSlot", "guardSlot", "primaryProvider",
            "secondaryProvider", "ethereumFinalityEvidence", "atomicRootStateEvidenceDigest",
            "evidenceDigest",
          ],
          {
            schemaVersion: { const: "programmable.safe-configuration-evidence.v1" },
            finalized: { const: true },
            blockNumber: positiveUint,
            blockHash: nonzeroHex32,
            proxyRuntimeCodeHash: {
              const: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
            },
            singleton: closed(["address", "runtimeCodeHash", "version", "sourceCommitment"], {
              address: { const: "0x41675C099F32341bf84BFc5382aF534df5C7461a" },
              runtimeCodeHash: {
                const: "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
              },
              version: { const: "1.4.1" },
              sourceCommitment: {
                const: "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb",
              },
            }),
            fallbackHandler: { const: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99" },
            fallbackHandlerRuntimeCodeHash: {
              const: "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9",
            },
            owners: {
              const: [
                "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
                "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
              ],
            },
            threshold: { const: 1 },
            nonce: { const: "0" },
            modules: { const: [] },
            modulesNext: { const: "0x0000000000000000000000000000000000000001" },
            guard: { const: null },
            singletonSlot: {
              const: "0x00000000000000000000000041675c099f32341bf84bfc5382af534df5c7461a",
            },
            fallbackHandlerSlot: {
              const: "0x000000000000000000000000fd0732dc9e303f09fcef3a7388ad10a83459ec99",
            },
            guardSlot: { const: `0x${"0".repeat(64)}` },
            primaryProvider: closed(["providerId", "trustDomain", "evidenceDigest"], {
              providerId: { const: "quicknode" },
              trustDomain: { const: "quicknode.com" },
              evidenceDigest: sha256,
            }),
            secondaryProvider: closed(["providerId", "trustDomain", "evidenceDigest"], {
              providerId: { const: "alchemy" },
              trustDomain: { const: "alchemy.com" },
              evidenceDigest: sha256,
            }),
            ethereumFinalityEvidence: robinhoodEthereumFinalityEvidence(),
            atomicRootStateEvidenceDigest: sha256,
            evidenceDigest: sha256,
          },
        ),
      },
    ),
    externalRootDeploymentEvidence: tuple(
      externalRootDeployment(
        "poolManager",
        "0x8366a39CC670B4001A1121B8F6A443A643e40951",
        "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
        "0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41",
        "9070",
      ),
      externalRootDeployment(
        "positionManager",
        "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
        "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
        "0x228c18ada6cb46b4fbcc18f4ec1519953415393e256fa8349aafbd5a2db037c8",
        "9073",
      ),
      externalRootDeployment(
        "stateView",
        "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
        "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6",
        "0x3d61e2c9eeb482385b1aa436b9e8f812167ea579cc390e4f93bc5abde00582f4",
        "9075",
      ),
      externalRootDeployment(
        "v4Quoter",
        "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
        "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
        "0x6bf436d72a17f87284ddcab43094689bd320dfb39b535213b9a0b669fabc4ab4",
        "9074",
      ),
      externalRootDeployment(
        "universalRouter",
        "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
        "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
        "0xdfb76494e158d8dea4376160315239271636a18515207fd4526e574bc7eeb456",
        "3347899",
      ),
    ),
    contracts: closed(
      contractNames,
      Object.fromEntries(contractNames.map((name) => [name, pinnedContractBinding(name)])),
    ),
  },
  {
    "x-programmable-order":
      "contracts bind atomic deployment, Permit2 genesis, Safe permit authority, and external root evidence; atomic deployment, Safe snapshot, and Ethereum finality agree; programmable Router != universal Router",
  },
);
function frozenProfileSchema() {
  return closed(
  [
    "schemaVersion",
    "structuralProfileId",
    "businessProfileId",
    "admissionDescriptorDigest",
    "admissionPolicyDigest",
    "admissionBindingDigest",
    "admissionSchemaDigest",
    "profileRevision",
    "profileVersion",
    "profileDigest",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-profile-ref.v4" },
    structuralProfileId: { const: "programmable.custom-launch.robinhood-mainnet.v1" },
    businessProfileId: { const: "robinhood-production-launch" },
    admissionDescriptorDigest: {
      const: "sha256:99b4ccabdaaf143bad28a8f6af441a1b93e1f113d0179236328b7fa594d1f948",
    },
    admissionPolicyDigest: {
      const: "sha256:31e6b286ca839b31cb1edfe30c05d9f334892f3d84377961dc10b93959c7e216",
    },
    admissionBindingDigest: {
      const: "sha256:f31643e6e9ff6d5409d59a2fc3ac7fb5ac9cfcb3af08e95c9478bc95ddfa66a2",
    },
    admissionSchemaDigest: {
      const: "sha256:a28a6de6208d6ba7b65b4b706174509570955ba9ce9714624bcb2046ab7beae7",
    },
    profileRevision: { const: 1 },
    profileVersion: { const: "4.0.0" },
    profileDigest: {
      const: "sha256:484b1dc6e9091804fabc230f2b3a7504940fa00264f8e66e82a66a951e71f1a0",
    },
  },
  );
}
const profile = frozenProfileSchema();

function robinhoodEthereumFinalityEvidence() {
  const provider = (providerId, trustDomain, includeConfirmations) => closed(
    includeConfirmations
      ? ["providerId", "trustDomain", "l1Confirmations"]
      : ["providerId", "trustDomain"],
    {
      providerId: { const: providerId },
      trustDomain: { const: trustDomain },
      ...(includeConfirmations ? { l1Confirmations: positiveUint } : {}),
    },
  );
  return closed(
    [
      "schemaVersion", "profile", "l2Checkpoint", "batchNumber", "l2Providers",
      "ethereumProviders", "rollup", "sequencerInbox", "postingTransactionHash",
      "postingBlockNumber", "postingBlockHash", "postingLogIndex",
      "ethereumFinalizedCheckpoint", "observedAt", "captureClosureDigest",
      "postingEventDigest", "l1EvidenceDigest", "evidenceDigest",
    ],
    {
      schemaVersion: {
        const: "programmable.robinhood-l2-checkpoint-ethereum-finality.v1",
      },
      profile: frozenProfileSchema(),
      l2Checkpoint: closed(["blockNumber", "blockHash"], {
        blockNumber: positiveUint,
        blockHash: nonzeroHex32,
      }),
      batchNumber: positiveUint,
      l2Providers: tuple(
        provider("quicknode", "quicknode.com", true),
        provider("alchemy", "alchemy.com", true),
      ),
      ethereumProviders: tuple(
        provider("drpc", "drpc.org", false),
        provider("quicknode", "quicknode.com", false),
      ),
      rollup: { const: "0x23A19d23e89166adedbDcB432518AB01e4272D94" },
      sequencerInbox: { const: "0xBd0D173EEb87D57A09521c24388a12789F33ba96" },
      postingTransactionHash: nonzeroHex32,
      postingBlockNumber: positiveUint,
      postingBlockHash: nonzeroHex32,
      postingLogIndex: uint,
      ethereumFinalizedCheckpoint: closed(["blockNumber", "blockHash", "tag"], {
        blockNumber: positiveUint,
        blockHash: nonzeroHex32,
        tag: { const: "finalized" },
      }),
      observedAt: dateTime,
      captureClosureDigest: sha256,
      postingEventDigest: sha256,
      l1EvidenceDigest: sha256,
      evidenceDigest: sha256,
    },
    {
      "x-programmable-order":
        "ethereumFinalizedCheckpoint.blockNumber >= postingBlockNumber",
    },
  );
}
const funding = closed(["schemaVersion", "mode", "valueWei"], {
  schemaVersion: { const: "programmable.custom-launch-funding-intent.v2" },
  mode: { enum: ["none", "wallet-transaction-value"] },
  valueWei: uint,
});
const liquidityModel = closed(["schemaVersion", "model", "declaredLaunchState", "targetIds"], {
  schemaVersion: { const: "programmable.custom-launch-liquidity-model.v1" },
  model: {
    enum: [
      "none-empty-pool",
      "project-provided-liquidity",
      "hook-owned-liquidity",
      "externally-managed-position",
      "custom-bonding-or-curve",
    ],
  },
  declaredLaunchState: {
    enum: [
      "pool-not-initialized",
      "pool-initialized-empty",
      "liquidity-required",
      "liquidity-provided-by-launch",
      "custom-settlement",
    ],
  },
  targetIds: array(identifier, { uniqueItems: true, maxItems: 16 }),
});
const commitments = closed(
  ["sourceBuild", "graph", "metadata", "verification", "fundingPermit", "launchIntent"],
  Object.fromEntries([
    "sourceBuild",
    "graph",
    "metadata",
    "verification",
    "fundingPermit",
    "launchIntent",
  ].map((name) => [name, sha256])),
);
const imageArtifact = closed(
  ["schemaVersion", "mediaType", "byteLength", "contentSha256", "base64"],
  {
    schemaVersion: { const: "programmable.project-metadata-image-artifact.v1" },
    mediaType: { enum: ["image/png", "image/gif"] },
    byteLength: { type: "string", pattern: "^[1-9][0-9]*$" },
    contentSha256: sha256,
    base64: {
      type: "string",
      pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
      maxLength: 6_990_508,
    },
  },
);
const externalImplementation = closed(
  ["address", "runtimeCodeHash", "sourceEvidenceDigest", "startBlock", "auditBlock"],
  {
    address,
    runtimeCodeHash: nonzeroHex32,
    sourceEvidenceDigest: sha256,
    startBlock: positiveUint,
    auditBlock: uint,
  },
);
const externalContract = closed(
  [
    "schemaVersion",
    "chainId",
    "caip2",
    "address",
    "runtimeCodeHash",
    "sourceEvidenceDigest",
    "role",
    "startBlock",
    "auditBlock",
    "locator",
    "mutability",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-external-contract.v1" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    address,
    runtimeCodeHash: nonzeroHex32,
    sourceEvidenceDigest: sha256,
    role: identifier,
    startBlock: positiveUint,
    auditBlock: uint,
    locator: closed(["targetId", "phase", "byteOffset", "encoding"], {
      targetId: identifier,
      phase: { enum: ["constructor", "initializer"] },
      byteOffset: { type: "integer", minimum: 0 },
      encoding: { enum: ["abi-address-word", "packed-address-20"] },
    }),
    mutability: closed(
      ["kind", "proxyType", "implementation", "adminAddress", "beaconAddress", "evidenceDigest"],
      {
        kind: { enum: ["immutable", "proxy"] },
        proxyType: nullable({
          enum: [
            "eip1967-transparent",
            "eip1967-uups",
            "eip1967-beacon",
            "eip1167-minimal",
          ],
        }),
        implementation: nullable(externalImplementation),
        adminAddress: nullable(address),
        beaconAddress: nullable(address),
        evidenceDigest: sha256,
      },
      {
        allOf: [{
          if: {
            properties: { kind: { const: "immutable" } },
            required: ["kind"],
          },
          then: {
            properties: {
              proxyType: { type: "null" },
              implementation: { type: "null" },
              adminAddress: { type: "null" },
              beaconAddress: { type: "null" },
            },
          },
          else: {
            properties: {
              proxyType: {
                enum: [
                  "eip1967-transparent", "eip1967-uups", "eip1967-beacon", "eip1167-minimal",
                ],
              },
              implementation: externalImplementation,
            },
            oneOf: [
              {
                properties: {
                  proxyType: { const: "eip1967-beacon" },
                  adminAddress: { type: "null" },
                  beaconAddress: address,
                },
              },
              {
                properties: {
                  proxyType: { const: "eip1967-transparent" },
                  beaconAddress: { type: "null" },
                },
              },
              {
                properties: {
                  proxyType: { enum: ["eip1967-uups", "eip1167-minimal"] },
                  adminAddress: { type: "null" },
                  beaconAddress: { type: "null" },
                },
              },
            ],
          },
        }],
      },
    ),
  },
);

function schemaAt(documentName, pointer) {
  let value = documents.get(documentName);
  for (const encoded of pointer.replace(/^#\//u, "").split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    value = value[segment];
  }
  return value;
}

function resolveSchema(value, documentName, stack = []) {
  if (Array.isArray(value)) return value.map((entry) => resolveSchema(entry, documentName, stack));
  if (value === null || typeof value !== "object") return value;
  if (typeof value.$ref === "string") {
    const split = value.$ref.indexOf("#");
    const documentPart = split < 0 ? value.$ref : value.$ref.slice(0, split);
    const pointer = split < 0 ? "" : `#${value.$ref.slice(split + 1)}`;
    const targetName = documentPart.length === 0
      ? documentName
      : documentPart.slice(documentPart.lastIndexOf("/") + 1);
    const key = `${targetName}${pointer}`;
    if (stack.includes(key)) throw new Error(`Cyclic schema reference ${key}`);
    const target = schemaAt(targetName, pointer);
    const siblings = Object.fromEntries(Object.entries(value).filter(([name]) => name !== "$ref"));
    return normalizeSchema({
      ...resolveSchema(target, targetName, [...stack, key]),
      ...resolveSchema(siblings, documentName, stack),
    });
  }
  return normalizeSchema(Object.fromEntries(
    Object.entries(value).map(([name, entry]) => [name, resolveSchema(entry, documentName, stack)]),
  ));
}

function normalizeSchema(schema) {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return schema;
  if (Array.isArray(schema.allOf)) {
    const pieces = schema.allOf.map((entry) => normalizeSchema(entry));
    const objectComposition = pieces.every((piece) =>
      piece.type === "object" || piece.properties !== undefined);
    if (objectComposition) {
      const base = Object.fromEntries(Object.entries(schema).filter(([name]) => name !== "allOf"));
      schema = pieces.reduce((result, piece) => mergeSchemaFragments(result, piece), base);
    } else {
      schema = { ...schema, allOf: pieces };
    }
  }
  schema = Object.fromEntries(Object.entries(schema).map(([name, value]) => [
    name,
    Array.isArray(value)
      ? value.map((entry) => normalizeSchema(entry))
      : normalizeSchema(value),
  ]));
  return schema;
}

function mergeSchemaFragments(left, right) {
  const leftBase = { ...left };
  if ((right.type !== undefined || right.properties !== undefined)
    && right.oneOf === undefined && right.anyOf === undefined) {
    delete leftBase.oneOf;
    delete leftBase.anyOf;
  }
  const merged = { ...leftBase, ...right };
  if (left.properties !== undefined || right.properties !== undefined) {
    merged.properties = { ...(left.properties ?? {}) };
    for (const [name, value] of Object.entries(right.properties ?? {})) {
      merged.properties[name] = merged.properties[name] === undefined
        ? value
        : mergeSchemaFragments(merged.properties[name], value);
    }
  }
  if (left.required !== undefined || right.required !== undefined) {
    merged.required = [...new Set([...(left.required ?? []), ...(right.required ?? [])])];
  }
  if (left.allOf !== undefined || right.allOf !== undefined) {
    merged.allOf = [...(left.allOf ?? []), ...(right.allOf ?? [])];
  }
  return merged;
}

const inherited = {
  sourceDescriptor: resolveSchema(
    documents.get("custom-launch-v2.json").components.schemas.DeterministicSourceBundleV2,
    "custom-launch-v2.json",
  ),
  sourceBundleManifest: resolveSchema(
    documents.get("custom-launch-v2.json").components.schemas.SourceBundleManifestV2,
    "custom-launch-v2.json",
  ),
  graphBundle: resolveSchema(
    documents.get("custom-launch-v3.json").components.schemas.CustomGraphBundleV3,
    "custom-launch-v3.json",
  ),
  projectMetadata: resolveSchema(
    documents.get("custom-launch-v3.json").components.schemas.CompleteProjectMetadataV1,
    "custom-launch-v3.json",
  ),
  behaviorScenarioInputs: resolveSchema(
    documents.get("custom-launch-v3.json").components.schemas.BehaviorScenarioInputsV1,
    "custom-launch-v3.json",
  ),
  verificationBundle: resolveSchema(
    documents.get("custom-launch-v2.json").components.schemas.ExactSourceVerificationBundleV2,
    "custom-launch-v2.json",
  ),
  agentAttestation: resolveSchema(
    documents.get("custom-launch-v2.json").components.schemas.AgentLaunchAttestationV2,
    "custom-launch-v2.json",
  ),
};
restrictMetadataImage(inherited.projectMetadata);

const createRequest = closed(
  [
    "schemaVersion",
    "chainId",
    "caip2",
    "chainDeployment",
    "chainDeploymentDescriptorDigest",
    "profile",
    "launchWallet",
    "nonce",
    "permitWindow",
    "sourceDescriptor",
    "sourceBundleManifest",
    "externalContracts",
    "graphBundle",
    "projectMetadata",
    "projectMetadataHash",
    "projectMetadataImageArtifact",
    "verificationBundle",
    "funding",
    "liquidityModel",
    "launchIntentHash",
    "agentAttestation",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-create-request.v4" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    chainDeployment,
    chainDeploymentDescriptorDigest: nonzeroHex32,
    profile,
    launchWallet: address,
    nonce: nonzeroHex32,
    permitWindow: closed(["validAfter", "deadline"], { validAfter: uint, deadline: uint }),
    sourceDescriptor: inherited.sourceDescriptor,
    sourceBundleManifest: inherited.sourceBundleManifest,
    externalContracts: array(externalContract, { maxItems: 64 }),
    graphBundle: inherited.graphBundle,
    projectMetadata: inherited.projectMetadata,
    projectMetadataHash: sha256,
    projectMetadataImageArtifact: imageArtifact,
    behaviorScenarioInputs: inherited.behaviorScenarioInputs,
    behaviorScenarioInputsHash: sha256,
    verificationBundle: inherited.verificationBundle,
    funding,
    liquidityModel,
    launchIntentHash: sha256,
    agentAttestation: inherited.agentAttestation,
  },
  {
    dependentRequired: {
      behaviorScenarioInputs: ["behaviorScenarioInputsHash"],
      behaviorScenarioInputsHash: ["behaviorScenarioInputs"],
    },
  },
);

const exactWallet = closed(
  [
    "schemaVersion",
    "chainId",
    "caip2",
    "apiVersion",
    "chainDeploymentId",
    "chainDeploymentDescriptorDigest",
    "chainDeployment",
    "profile",
    "finalityPolicy",
    "from",
    "to",
    "valueWei",
    "calldata",
    "selector",
    "transactionPreimageHash",
    "routerRuntimeCodeHash",
    "expiresAt",
    "commitments",
    "launchSummary",
  ],
  {
    schemaVersion: { const: "programmable.exact-wallet-transaction.v4" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    apiVersion: { const: "v4" },
    chainDeploymentId: { const: "robinhood-mainnet-custom-launch-v1" },
    chainDeploymentDescriptorDigest: nonzeroHex32,
    chainDeployment,
    profile,
    finalityPolicy,
    from: address,
    to: address,
    valueWei: uint,
    calldata: { type: "string", pattern: "^0xe5f6b8cd(?:[0-9a-f]{2})+$" },
    selector: { const: "0xe5f6b8cd" },
    transactionPreimageHash: sha256,
    routerRuntimeCodeHash: nonzeroHex32,
    expiresAt: dateTime,
    commitments,
    launchSummary: closed(
      ["chainName", "controller", "name", "symbol", "fundingMode", "valueWei"],
      {
        chainName: { const: "Robinhood Chain Mainnet" },
        controller: address,
        name: { type: "string", minLength: 1, maxLength: 256 },
        symbol: { type: "string", minLength: 1, maxLength: 64 },
        fundingMode: { enum: ["none", "wallet-transaction-value"] },
        valueWei: uint,
      },
    ),
  },
);

const finalityStage = {
  enum: ["sequencer_soft_confirmation", "ethereum_posted", "ethereum_finalized"],
};
const boundedLogIndex = { type: "integer", minimum: 0, maximum: 2_147_483_647 };
const l2Inclusion = closed(
  [
    "schemaVersion", "chainId", "caip2", "transactionHash", "blockNumber", "blockHash",
    "blockTimestamp", "receiptStatus", "launchEventLogIndex", "routeEventLogIndex",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-l2-inclusion.v1" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    transactionHash: nonzeroHex32,
    blockNumber: positiveUint,
    blockHash: nonzeroHex32,
    blockTimestamp: positiveUint,
    receiptStatus: { const: "success" },
    launchEventLogIndex: {
      ...boundedLogIndex,
      description:
        "Log index of the Router launch event; it must follow routeEventLogIndex in the same successful receipt.",
    },
    routeEventLogIndex: {
      ...boundedLogIndex,
      description:
        "Log index of the Router route event; it must precede launchEventLogIndex in the same successful receipt.",
    },
  },
  { "x-programmable-order": "routeEventLogIndex < launchEventLogIndex" },
);
const l1Posting = closed(
  [
    "schemaVersion", "chainId", "caip2", "rollup", "sequencerInbox", "batchNumber",
    "transactionHash", "blockNumber", "blockHash", "logIndex",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-l1-posting.v1" },
    chainId: { const: "1" },
    caip2: { const: "eip155:1" },
    rollup: { const: "0x23A19d23e89166adedbDcB432518AB01e4272D94" },
    sequencerInbox: { const: "0xBd0D173EEb87D57A09521c24388a12789F33ba96" },
    batchNumber: uint,
    transactionHash: nonzeroHex32,
    blockNumber: positiveUint,
    blockHash: nonzeroHex32,
    logIndex: boundedLogIndex,
  },
);
const l1FinalizedProviderReadback = (providerId, trustDomain) => closed(
  ["providerId", "trustDomain", "blockNumber", "blockHash"],
  {
    providerId: { const: providerId },
    trustDomain: { const: trustDomain },
    blockNumber: positiveUint,
    blockHash: nonzeroHex32,
  },
);
const l1FinalizedProviderReadbackSchema = {
  oneOf: [
    l1FinalizedProviderReadback("drpc", "drpc.org"),
    l1FinalizedProviderReadback("quicknode", "quicknode.com"),
  ],
};
const l1FinalizedCheckpoint = closed(
  [
    "schemaVersion", "chainId", "caip2", "consensusCheckpointTag", "blockNumber",
    "blockHash", "providerReadbacks",
  ],
  {
    schemaVersion: {
      const: "programmable.custom-launch-l1-finalized-checkpoint.v1",
    },
    chainId: { const: "1" },
    caip2: { const: "eip155:1" },
    consensusCheckpointTag: { const: "finalized" },
    blockNumber: positiveUint,
    blockHash: nonzeroHex32,
    providerReadbacks: tuple(
      l1FinalizedProviderReadback("drpc", "drpc.org"),
      l1FinalizedProviderReadback("quicknode", "quicknode.com"),
    ),
  },
);

const onchainEvidenceV2 = closed(
  [
    "schemaVersion",
    "apiVersion",
    "chainId",
    "caip2",
    "chainDeploymentId",
    "chainDeploymentDescriptorDigest",
    "chainDeployment",
    "profile",
    "router",
    "routerRuntimeCodeHash",
    "routerLaunchId",
    "transactionHash",
    "blockNumber",
    "blockHash",
    "logIndex",
    "checkpointType",
    "finalityPolicy",
    "commitments",
    "walletTransactionPreimageHash",
    "evidenceDigest",
    "terminal",
    "observedAt",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-onchain-evidence.v2" },
    apiVersion: { const: "v4" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    chainDeploymentId: { const: "robinhood-mainnet-custom-launch-v1" },
    chainDeploymentDescriptorDigest: nonzeroHex32,
    chainDeployment,
    profile,
    router: address,
    routerRuntimeCodeHash: nonzeroHex32,
    routerLaunchId: nonzeroHex32,
    transactionHash: nonzeroHex32,
    blockNumber: uint,
    blockHash: nonzeroHex32,
    logIndex: { type: "integer", minimum: 0 },
    checkpointType: finalityStage,
    finalityPolicy,
    commitments,
    walletTransactionPreimageHash: sha256,
    evidenceDigest: sha256,
    terminal: { type: "boolean" },
    observedAt: dateTime,
  },
);

const legacyCheckpointProjectionDescription =
  "Deprecated stage-checkpoint projection: l2Inclusion at sequencer_soft_confirmation, l1Posting at ethereum_posted, and l1FinalizedCheckpoint at ethereum_finalized. This is not a transaction locator; use the nested L2/L1 structures instead.";
const legacyLogIndexProjectionDescription =
  "Deprecated stage-checkpoint projection: l2Inclusion.launchEventLogIndex at sequencer_soft_confirmation, and l1Posting.logIndex at ethereum_posted or ethereum_finalized. A finalized checkpoint has no log index. Use the nested L2/L1 structures instead.";
const onchainEvidenceV3 = closed(
  [
    "schemaVersion",
    "apiVersion",
    "chainId",
    "caip2",
    "chainDeploymentId",
    "chainDeploymentDescriptorDigest",
    "chainDeployment",
    "profile",
    "router",
    "routerRuntimeCodeHash",
    "routerLaunchId",
    "transactionHash",
    "blockNumber",
    "blockHash",
    "logIndex",
    "checkpointType",
    "l2Inclusion",
    "l1Posting",
    "l1FinalizedCheckpoint",
    "finalityPolicy",
    "commitments",
    "walletTransactionPreimageHash",
    "evidenceDigest",
    "terminal",
    "observedAt",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-onchain-evidence.v3" },
    apiVersion: { const: "v4" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    chainDeploymentId: { const: "robinhood-mainnet-custom-launch-v1" },
    chainDeploymentDescriptorDigest: nonzeroHex32,
    chainDeployment,
    profile,
    router: address,
    routerRuntimeCodeHash: nonzeroHex32,
    routerLaunchId: nonzeroHex32,
    transactionHash: {
      ...nonzeroHex32,
      description:
        "Robinhood L2 transaction hash. It must equal l2Inclusion.transactionHash at every stage.",
    },
    blockNumber: {
      ...positiveUint,
      deprecated: true,
      description: legacyCheckpointProjectionDescription,
    },
    blockHash: {
      ...nonzeroHex32,
      deprecated: true,
      description: legacyCheckpointProjectionDescription,
    },
    logIndex: {
      ...boundedLogIndex,
      deprecated: true,
      description: legacyLogIndexProjectionDescription,
    },
    checkpointType: finalityStage,
    l2Inclusion,
    l1Posting: nullable(l1Posting),
    l1FinalizedCheckpoint: nullable(l1FinalizedCheckpoint),
    finalityPolicy,
    commitments,
    walletTransactionPreimageHash: sha256,
    evidenceDigest: sha256,
    terminal: { type: "boolean" },
    observedAt: dateTime,
  },
  {
    allOf: [
      {
        if: {
          properties: { checkpointType: { const: "sequencer_soft_confirmation" } },
          required: ["checkpointType"],
        },
        then: {
          properties: {
            l1Posting: { type: "null" },
            l1FinalizedCheckpoint: { type: "null" },
            terminal: { const: false },
          },
        },
      },
      {
        if: {
          properties: { checkpointType: { const: "ethereum_posted" } },
          required: ["checkpointType"],
        },
        then: {
          properties: {
            l1Posting,
            l1FinalizedCheckpoint: { type: "null" },
            terminal: { const: false },
          },
        },
      },
      {
        if: {
          properties: { checkpointType: { const: "ethereum_finalized" } },
          required: ["checkpointType"],
        },
        then: {
          properties: {
            l1Posting,
            l1FinalizedCheckpoint,
            terminal: { const: true },
          },
        },
      },
    ],
    "x-programmable-order":
      "chainDeploymentDescriptorDigest == keccak256(canonical chainDeployment); router and finalityPolicy match chainDeployment; transactionHash == l2Inclusion.transactionHash; L1 identities match chainDeployment ethereumFinalityEvidence; legacy checkpoint projection follows checkpointType; finalized provider readbacks equal checkpoint",
  },
);

const admissionReceipt = closed(
  [
    "schemaVersion", "apiVersion", "chainId", "requestHash", "rawRequestSha256",
    "chainDeploymentDescriptorDigest", "profileDigest", "commitments", "staticAnalysisDigest",
    "externalContractEvidenceDigest", "disposition", "evidenceTier", "hardBlockFindingCodes",
    "needsEvidenceFindingCodes", "warningFindingCodes", "issuedAt", "receiptDigest",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-admission-receipt.v4" },
    apiVersion: { const: "v4" },
    chainId: { const: "4663" },
    requestHash: sha256,
    rawRequestSha256: sha256,
    chainDeploymentDescriptorDigest: nonzeroHex32,
    profileDigest: sha256,
    commitments,
    staticAnalysisDigest: sha256,
    externalContractEvidenceDigest: sha256,
    disposition: { enum: ["supported", "supported_with_warnings", "needs_evidence", "unsupported"] },
    evidenceTier: {
      enum: [
        "launch_mechanics_verified",
        "standard_swap_compatible",
        "advanced_custom_accounting",
        "governed_external_trust",
      ],
    },
    hardBlockFindingCodes: array({ type: "string" }),
    needsEvidenceFindingCodes: array({ type: "string" }),
    warningFindingCodes: array({ type: "string" }),
    issuedAt: dateTime,
    receiptDigest: sha256,
  },
);
const simulationReceipt = closed(
  [
    "schemaVersion", "apiVersion", "kind", "chainId", "requestHash",
    "transactionPreimageHash", "chainDeploymentDescriptorDigest", "profileDigest",
    "providerEvidenceDigest", "passed", "reasonCode", "observedBlockNumber",
    "observedBlockHash", "issuedAt", "receiptDigest",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-simulation-receipt.v4" },
    apiVersion: { const: "v4" },
    kind: { enum: ["request_preflight", "exact_wallet_transaction"] },
    chainId: { const: "4663" },
    requestHash: sha256,
    transactionPreimageHash: nullable(sha256),
    chainDeploymentDescriptorDigest: nonzeroHex32,
    profileDigest: sha256,
    providerEvidenceDigest: sha256,
    passed: { type: "boolean" },
    reasonCode: nullable({ type: "string", minLength: 1, maxLength: 256 }),
    observedBlockNumber: nullable(uint),
    observedBlockHash: nullable(nonzeroHex32),
    issuedAt: dateTime,
    receiptDigest: sha256,
  },
);

const preparedArtifact = resolveSchema(
  documents.get("custom-launch-v3.json").components.schemas.PreparedLaunchArtifactV3,
  "custom-launch-v3.json",
);
restrictMetadataImage(preparedArtifact);
preparedArtifact.properties.permit.properties.chainId = { const: "4663" };
preparedArtifact.properties.unsignedRouterTransaction.properties.chainId = { const: "4663" };

const findingCode = { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,127}$" };
const findingCodes = array(findingCode, {
  uniqueItems: true,
  "x-programmable-order": "unique UTF-8 ascending",
});
const externalCheckpoint = closed(["blockNumber", "blockHash"], {
  blockNumber: uint,
  blockHash: nonzeroHex32,
});
const externalProvider = (role, providerId, trustDomain) => closed(
  ["role", "providerId", "trustDomain"],
  {
    role: { const: role },
    providerId: { const: providerId },
    trustDomain: { const: trustDomain },
  },
);
const externalProxyReadback = closed(
  [
    "kind", "proxyType", "implementationAddress", "adminAddress", "beaconAddress",
    "implementationSlotWord", "adminSlotWord", "beaconSlotWord", "minimalProxyImplementation",
  ],
  {
    kind: { enum: ["immutable", "proxy"] },
    proxyType: nullable({
      enum: [
        "eip1967-transparent", "eip1967-uups", "eip1967-beacon", "eip1167-minimal", "custom",
      ],
    }),
    implementationAddress: nullable(address),
    adminAddress: nullable(address),
    beaconAddress: nullable(address),
    implementationSlotWord: nullable(hex32),
    adminSlotWord: nullable(hex32),
    beaconSlotWord: nullable(hex32),
    minimalProxyImplementation: nullable(address),
  },
  {
    allOf: [{
      if: { properties: { kind: { const: "immutable" } }, required: ["kind"] },
      then: {
        properties: {
          proxyType: { type: "null" },
          implementationAddress: { type: "null" },
          adminAddress: { type: "null" },
          beaconAddress: { type: "null" },
          implementationSlotWord: { type: "null" },
          adminSlotWord: { type: "null" },
          beaconSlotWord: { type: "null" },
          minimalProxyImplementation: { type: "null" },
        },
      },
      else: {
        properties: {
          proxyType: {
            enum: [
              "eip1967-transparent", "eip1967-uups", "eip1967-beacon",
              "eip1167-minimal", "custom",
            ],
          },
        },
      },
    }],
  },
);
const externalProviderReadback = (role, providerId, trustDomain) => closed(
  [
    "role", "providerId", "trustDomain", "startCheckpoint", "auditCheckpoint",
    "finalizedCheckpoint", "startRuntimeCodeHash", "auditRuntimeCodeHash", "proxy",
    "implementationRuntimeCodeHash", "evidenceDigest",
  ],
  {
    role: { const: role },
    providerId: { const: providerId },
    trustDomain: { const: trustDomain },
    startCheckpoint: nullable(externalCheckpoint),
    auditCheckpoint: externalCheckpoint,
    finalizedCheckpoint: externalCheckpoint,
    startRuntimeCodeHash: nullable(nonzeroHex32),
    auditRuntimeCodeHash: nonzeroHex32,
    proxy: externalProxyReadback,
    implementationRuntimeCodeHash: nullable(nonzeroHex32),
    evidenceDigest: sha256,
  },
  {
    allOf: [{
      if: {
        properties: {
          proxy: {
            type: "object",
            properties: { kind: { const: "immutable" } },
            required: ["kind"],
          },
        },
        required: ["proxy"],
      },
      then: { properties: { implementationRuntimeCodeHash: { type: "null" } } },
    }],
  },
);
const sourceProviderReceipt = (provider) => closed(
  ["provider", "outcome", "responseSha256", "errorCode"],
  {
    provider: { const: provider },
    outcome: { enum: ["exact_match", "unavailable", "mismatch"] },
    responseSha256: nullable(sha256),
    errorCode: nullable(findingCode),
  },
  {
    allOf: [{
      if: { properties: { outcome: { const: "exact_match" } }, required: ["outcome"] },
      then: {
        properties: {
          responseSha256: sha256,
          errorCode: { type: "null" },
        },
      },
      else: { properties: { errorCode: findingCode } },
    }],
  },
);
const externalSourceReceipt = closed(
  [
    "address", "runtimeCodeHash", "sourceEvidenceDigest", "sourcify", "blockscout",
    "evidenceDigest",
  ],
  {
    address,
    runtimeCodeHash: nonzeroHex32,
    sourceEvidenceDigest: sha256,
    sourcify: sourceProviderReceipt("sourcify"),
    blockscout: sourceProviderReceipt("blockscout"),
    evidenceDigest: sha256,
  },
);
const externalEvidenceReference = closed(
  [
    "referenceDigest", "declaration", "startCheckpoint", "auditCheckpoint",
    "finalizedCheckpoint", "providerReadbacks", "sourceVerification", "verified",
    "findingCodes", "evidenceDigest",
  ],
  {
    referenceDigest: sha256,
    declaration: externalContract,
    startCheckpoint: nullable(externalCheckpoint),
    auditCheckpoint: nullable(externalCheckpoint),
    finalizedCheckpoint: nullable(externalCheckpoint),
    providerReadbacks: tuple(
      externalProviderReadback("primary", "drpc", "drpc.org"),
      externalProviderReadback("secondary", "alchemy", "alchemy.com"),
    ),
    sourceVerification: closed(["contract", "implementation"], {
      contract: externalSourceReceipt,
      implementation: nullable(externalSourceReceipt),
    }),
    verified: { type: "boolean" },
    findingCodes,
    evidenceDigest: sha256,
  },
);
const externalEvidenceReceipt = closed(
  [
    "schemaVersion", "chainId", "caip2", "deploymentId", "requestHash", "rawRequestSha256",
    "chainDeploymentDescriptorDigest", "profile", "profileDigest", "providers", "references",
    "verified", "findingCodes", "observedAt", "evidenceDigest",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-external-contract-evidence.v4" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    deploymentId: { const: "robinhood-mainnet-custom-launch-v1" },
    requestHash: sha256,
    rawRequestSha256: sha256,
    chainDeploymentDescriptorDigest: nonzeroHex32,
    profile,
    profileDigest: {
      const: "sha256:484b1dc6e9091804fabc230f2b3a7504940fa00264f8e66e82a66a951e71f1a0",
    },
    providers: tuple(
      externalProvider("primary", "drpc", "drpc.org"),
      externalProvider("secondary", "alchemy", "alchemy.com"),
    ),
    references: array(externalEvidenceReference, { maxItems: 64 }),
    verified: { type: "boolean" },
    findingCodes,
    observedAt: dateTime,
    evidenceDigest: sha256,
  },
);

const partnerAttribution = closed(
  ["schemaVersion", "partnerId", "name", "website", "attributionSource", "attributionVersion", "snapshotDigest"],
  {
    schemaVersion: { const: "programmable.launch-partner-attribution.v1" },
    partnerId: { type: "string", minLength: 1, maxLength: 256 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    website: nullable({ type: "string", format: "uri" }),
    attributionSource: { const: "authenticated-partner-api-key" },
    attributionVersion: { const: 1 },
    snapshotDigest: sha256,
  },
);

const exactSourceBindingCoveredEvidence = [
  "protected-source-tree",
  "source-closure",
  "hosted-build-artifact",
  "standard-json-input",
  "compiler-binary",
  "compiler-settings",
  "finalized-creation-transaction",
  "creation-bytecode",
  "runtime-bytecode",
];
const sourceVerificationProviderObservation = closed(
  [
    "provider", "classification", "match", "creationMatch", "runtimeMatch",
    "releaseAuthority", "evidenceDigest",
  ],
  {
    provider: { const: "sourcify-v2" },
    classification: { const: "PARTIAL_NO_CBOR_EXACT_BYTES" },
    creationMatch: { const: "match" },
    runtimeMatch: { const: "match" },
    match: { const: "match" },
    releaseAuthority: { const: false },
    evidenceDigest: sha256,
  },
);
const sourceVerificationExactSourceBinding = closed(
  ["schemaVersion", "authority", "coveredEvidence", "bindingDigest"],
  {
    schemaVersion: {
      const:
        "programmable.robinhood-custom-launch.exact-byte-source-build-transaction-binding.v1",
    },
    authority: { const: "protected-hosted-build-finalized-transaction-bytecode" },
    coveredEvidence: { const: exactSourceBindingCoveredEvidence },
    bindingDigest: sha256,
  },
);
const sourceVerificationExactComponent = closed(
  [
    "targetId", "address", "status", "providerObservation", "exactSourceAuthority",
    "exactSourceBinding", "updatedAt",
  ],
  {
    targetId: identifier,
    address: { type: "string", pattern: "^0x[0-9a-f]{40}$" },
    status: { const: "exact_match" },
    providerObservation: sourceVerificationProviderObservation,
    exactSourceAuthority: {
      const: "protected-hosted-build-finalized-transaction-bytecode",
    },
    exactSourceBinding: sourceVerificationExactSourceBinding,
    updatedAt: millisecondDateTime,
  },
);
const sourceVerificationComponent = {
  oneOf: [
    ...["queued", "retrying"].map((status) => closed(
      [
        "targetId", "address", "status", "providerObservation", "exactSourceAuthority",
        "exactSourceBinding", "updatedAt", "nextAttemptAt",
      ],
      {
        targetId: identifier,
        address: { type: "string", pattern: "^0x[0-9a-f]{40}$" },
        status: { const: status },
        providerObservation: { type: "null" },
        exactSourceAuthority: { type: "null" },
        exactSourceBinding: { type: "null" },
        updatedAt: millisecondDateTime,
        nextAttemptAt: millisecondDateTime,
      },
    )),
    sourceVerificationExactComponent,
    closed(
      [
        "targetId", "address", "status", "providerObservation", "exactSourceAuthority",
        "exactSourceBinding", "updatedAt",
      ],
      {
        targetId: identifier,
        address: { type: "string", pattern: "^0x[0-9a-f]{40}$" },
        status: { const: "needs_attention" },
        providerObservation: { type: "null" },
        exactSourceAuthority: { type: "null" },
        exactSourceBinding: { type: "null" },
        updatedAt: millisecondDateTime,
      },
    ),
  ],
};
const sourceVerificationComponents = array(sourceVerificationComponent, {
  minItems: 1,
  maxItems: 16,
  "x-programmable-order": "unique UTF-8 targetId ascending",
});
const sourceVerificationStatus = closed(
  [
    "schemaVersion", "chainId", "caip2", "chainDeploymentId", "status",
    "components", "updatedAt",
  ],
  {
    schemaVersion: { const: "programmable.source-verification-status.v4" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    chainDeploymentId: { const: "robinhood-mainnet-custom-launch-v1" },
    status: { enum: ["queued", "retrying", "exact_match", "needs_attention"] },
    components: sourceVerificationComponents,
    updatedAt: millisecondDateTime,
  },
  {
    description:
      "Server-authored post-finality exact-source state. Sourcify v2 match/match/match is explicitly non-authoritative provider observation; exact_match is emitted only after the independent protected-source/build/compiler/settings/finalized-transaction/bytecode composite binding closes. Provider retries and failures never alter launch finality.",
    "x-programmable-order": "updatedAt == max components[*].updatedAt",
    allOf: [
      {
        if: { properties: { status: { const: "exact_match" } }, required: ["status"] },
        then: {
          properties: {
            components: {
              type: "array",
              items: {
                type: "object",
                properties: { status: { const: "exact_match" } },
                required: ["status"],
              },
            },
          },
        },
      },
      {
        if: { properties: { status: { const: "needs_attention" } }, required: ["status"] },
        then: {
          properties: {
            components: {
              type: "array",
              contains: {
                type: "object",
                properties: { status: { const: "needs_attention" } },
                required: ["status"],
              },
            },
          },
        },
      },
      {
        if: { properties: { status: { const: "retrying" } }, required: ["status"] },
        then: {
          properties: {
            components: {
              type: "array",
              contains: {
                type: "object",
                properties: { status: { const: "retrying" } },
                required: ["status"],
              },
              not: {
                contains: {
                  type: "object",
                  properties: { status: { const: "needs_attention" } },
                  required: ["status"],
                },
              },
            },
          },
        },
      },
      {
        if: { properties: { status: { const: "queued" } }, required: ["status"] },
        then: {
          properties: {
            components: {
              type: "array",
              contains: {
                type: "object",
                properties: { status: { const: "queued" } },
                required: ["status"],
              },
              not: {
                contains: {
                  type: "object",
                  properties: {
                    status: { enum: ["needs_attention", "retrying"] },
                  },
                  required: ["status"],
                },
              },
            },
          },
        },
      },
    ],
  },
);

const resource = closed(
  [
    "schemaVersion", "apiVersion", "launchId", "requestId", "routeId", "chainId", "caip2",
    "chainDeploymentId", "chainDeploymentDescriptorDigest", "chainDeployment", "profile", "controller",
    "status", "requestHash", "rawRequestSha256", "sourceBuildCommitment", "graphCommitment",
    "metadataCommitment", "walletTransactionPreimageHash", "commitments", "projectMetadata", "funding",
    "liquidityModel", "walletTransaction", "preparedArtifact", "admissionReceipt", "simulationReceipt",
    "externalContractEvidenceReceipt", "onchain", "failure", "createdAt", "updatedAt",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch.v4" },
    apiVersion: { const: "v4" },
    launchId: uuid,
    requestId: uuid,
    routeId: { const: "custom-launch:create:v4" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    chainDeploymentId: { const: "robinhood-mainnet-custom-launch-v1" },
    chainDeploymentDescriptorDigest: nonzeroHex32,
    chainDeployment,
    profile,
    controller: closed(["namespace", "address"], {
      namespace: { const: "eip155:4663" },
      address,
    }),
    status: {
      enum: [
        "received", "validating", "action_required", "authorized",
        "awaiting_wallet_signature", "wallet_action_required", "submitted",
        "sequencer_soft_confirmed", "ethereum_posted", "finalized", "failed",
      ],
    },
    requestHash: sha256,
    rawRequestSha256: sha256,
    sourceBuildCommitment: sha256,
    graphCommitment: sha256,
    metadataCommitment: sha256,
    walletTransactionPreimageHash: nullable(sha256),
    commitments,
    projectMetadata: inherited.projectMetadata,
    funding,
    liquidityModel,
    walletTransaction: nullable(exactWallet),
    preparedArtifact: nullable(preparedArtifact),
    admissionReceipt: nullable(admissionReceipt),
    simulationReceipt: nullable(simulationReceipt),
    externalContractEvidenceReceipt: nullable(externalEvidenceReceipt),
    sourceVerification: {
      description:
        "Optional server-authored post-finality status. It is absent or null until verification jobs exist; clients never submit or infer it.",
      oneOf: [sourceVerificationStatus, { type: "null" }],
    },
    actionRequired: nullable(closed(["kind", "walletHandoffUrl", "expiresAt"], {
      kind: { const: "send-router-transaction" },
      walletHandoffUrl: { type: "string", format: "uri" },
      expiresAt: dateTime,
    })),
    walletHandoffUrl: nullable({ type: "string", format: "uri" }),
    expiresAt: nullable(dateTime),
    secondsRemaining: nullable({ type: "number", minimum: 0 }),
    onchain: nullable({ oneOf: [onchainEvidenceV2, onchainEvidenceV3] }),
    failure: nullable(closed(["code", "message", "retryable"], {
      code: { type: "string", minLength: 1, maxLength: 256 },
      message: { type: "string", minLength: 1, maxLength: 8192 },
      retryable: { type: "boolean" },
    })),
    partnerAttribution,
    createdAt: dateTime,
    updatedAt: dateTime,
  },
  {
    allOf: [
      {
        if: {
          properties: { status: { enum: ["received", "validating"] } },
          required: ["status"],
        },
        then: {
          properties: { externalContractEvidenceReceipt: { type: "null" } },
        },
        else: {
          properties: { externalContractEvidenceReceipt: externalEvidenceReceipt },
        },
      },
      {
        if: {
          properties: { status: { not: { const: "finalized" } } },
          required: ["status"],
        },
        then: {
          properties: { sourceVerification: { type: "null" } },
        },
      },
    ],
  },
);

const preflight = closed(
  [
    "schemaVersion", "apiVersion", "chainId", "caip2", "requestHash", "rawRequestSha256",
    "chainDeploymentId", "chainDeploymentDescriptorDigest", "profile", "serverTime", "disposition",
    "launchEligibility", "evidenceTier", "hardBlockFindingCodes", "needsEvidenceFindingCodes",
    "warningFindingCodes", "remediations", "gates", "quotaConsumed", "nonceAllocated", "persisted",
    "walletSignatureRequiredLater", "walletBroadcastByService",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-preflight.v2" },
    apiVersion: { const: "v4" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    requestHash: sha256,
    rawRequestSha256: sha256,
    chainDeploymentId: { const: "robinhood-mainnet-custom-launch-v1" },
    chainDeploymentDescriptorDigest: nonzeroHex32,
    profile,
    serverTime: dateTime,
    disposition: { enum: ["supported", "supported_with_warnings", "needs_evidence", "unsupported", "system_blocked"] },
    launchEligibility: closed(["deployable", "routable", "featured"], {
      deployable: { type: "boolean" },
      routable: { type: "boolean" },
      featured: { const: false },
    }),
    evidenceTier: admissionReceipt.properties.evidenceTier,
    hardBlockFindingCodes: array({ type: "string" }),
    needsEvidenceFindingCodes: array({ type: "string" }),
    warningFindingCodes: array({ type: "string" }),
    remediations: array(closed(["code", "requiredChange", "retryable"], {
      code: { type: "string" },
      requiredChange: { type: "string" },
      retryable: { type: "boolean" },
    })),
    gates: closed(
      [
        "chainBinding", "trustRoots", "sourceBuild", "graph", "metadata", "fundingSettlement",
        "deterministicValidation", "chainSimulation",
      ],
      Object.fromEntries([
        "chainBinding", "trustRoots", "sourceBuild", "graph", "metadata", "fundingSettlement",
        "deterministicValidation", "chainSimulation",
      ].map((name) => [name, { enum: ["passed", "failed"] }])),
    ),
    quotaConsumed: { const: false },
    nonceAllocated: { const: false },
    persisted: { const: false },
    walletSignatureRequiredLater: { const: true },
    walletBroadcastByService: { const: false },
  },
);

const capabilities = closed(
  [
    "schemaVersion", "apiVersion", "serverTime", "readinessUrl", "chain", "chainDeployment",
    "chainDeploymentDescriptorDigest", "profile", "routes", "authentication", "graph", "funding",
    "metadataImage", "toolchains", "readiness", "safety", "walletHandoff",
  ],
  {
    schemaVersion: { const: "programmable.custom-launch-capabilities.v2" },
    apiVersion: { const: "v4" },
    serverTime: dateTime,
    readinessUrl: { const: "/readyz" },
    chain: closed(["id", "caip2", "name"], {
      id: { const: "4663" },
      caip2: { const: "eip155:4663" },
      name: { const: "Robinhood Chain Mainnet" },
    }),
    chainDeployment: nullable(chainDeployment),
    chainDeploymentDescriptorDigest: nullable(nonzeroHex32),
    profile: nullable(profile),
    routes: closed(["capabilities", "create", "preflight", "list", "status", "finalizedMetadata"], {
      capabilities: { const: "/v4/chains/4663/capabilities" },
      create: { const: "/v4/chains/4663/custom-launches" },
      preflight: { const: "/v4/chains/4663/custom-launches/preflight" },
      list: { const: "/v4/chains/4663/custom-launches" },
      status: { const: "/v4/chains/4663/custom-launches/{launchId}" },
      finalizedMetadata: { const: "/v4/chains/4663/finalized-custom-launches" },
    }),
    authentication: closed(
      ["create", "preflight", "status", "finalizedMetadata", "capabilities", "requiredScopes", "apiKeyIsWallet"],
      {
        create: { const: "bearer-api-key" },
        preflight: { const: "bearer-api-key" },
        status: { const: "bearer-api-key" },
        finalizedMetadata: { const: "none" },
        capabilities: { const: "none" },
        requiredScopes: {
          type: "array",
          prefixItems: [{ const: "custom-launch:create" }, { const: "custom-launch:read" }],
          minItems: 2,
          maxItems: 2,
        },
        apiKeyIsWallet: { const: false },
      },
    ),
    graph: closed(["minimumTargets", "maximumTargets", "hookPermissionBits"], {
      minimumTargets: { const: 3 },
      maximumTargets: { const: 16 },
      hookPermissionBits: array({
        enum: [
          "beforeInitialize", "afterInitialize", "beforeAddLiquidity", "afterAddLiquidity",
          "beforeRemoveLiquidity", "afterRemoveLiquidity", "beforeSwap", "afterSwap",
          "beforeDonate", "afterDonate", "beforeSwapReturnDelta", "afterSwapReturnDelta",
          "afterAddLiquidityReturnDelta", "afterRemoveLiquidityReturnDelta",
        ],
      }, { uniqueItems: true }),
    }),
    funding: closed(["modes"], {
      modes: {
        type: "array",
        prefixItems: [{ const: "none" }, { const: "wallet-transaction-value" }],
        minItems: 2,
        maxItems: 2,
      },
    }),
    metadataImage: closed(
      ["schemaVersion", "mediaTypes", "maximumBytes", "maximumDimension", "maximumPixels", "gifFrames"],
      {
        schemaVersion: { const: "programmable.project-metadata-image-capability.v1" },
        mediaTypes: {
          type: "array",
          prefixItems: [{ const: "image/png" }, { const: "image/gif" }],
          minItems: 2,
          maxItems: 2,
        },
        maximumBytes: { const: 5_242_880 },
        maximumDimension: { const: 8_192 },
        maximumPixels: { const: 4_194_304 },
        gifFrames: { const: 1 },
      },
    ),
    toolchains: array(closed(["compiler", "version", "digest"], {
      compiler: { type: "string", minLength: 1, maxLength: 128 },
      version: { type: "string", minLength: 1, maxLength: 128 },
      digest: sha256,
    })),
    readiness: closed(["status", "reasonCodes"], {
      status: { enum: ["ready", "unavailable"] },
      reasonCodes: array({ type: "string" }),
    }),
    safety: closed(
      [
        "serverAuthoritative", "clientBypassAccepted", "walletSignatureProduced", "transactionBroadcast",
        "feeBehaviorClaim", "universalFeeBehaviorClaim", "genericClaimingLive",
      ],
      {
        serverAuthoritative: { const: true },
        clientBypassAccepted: { const: false },
        walletSignatureProduced: { const: false },
        transactionBroadcast: { const: false },
        feeBehaviorClaim: { const: false },
        universalFeeBehaviorClaim: { const: false },
        genericClaimingLive: { const: false },
      },
    ),
    walletHandoff: closed(
      ["schemaVersion", "walletHandoffBaseUrl", "separateWalletSignatureRequired"],
      {
      schemaVersion: { const: "programmable.exact-wallet-transaction.v4" },
      walletHandoffBaseUrl: { const: "https://programmable.market/developers/api-keys" },
      separateWalletSignatureRequired: { const: true },
      },
    ),
  },
);

const publicOnchainEvidence = clone(onchainEvidenceV3);
delete publicOnchainEvidence.properties.walletTransactionPreimageHash;
publicOnchainEvidence.required = publicOnchainEvidence.required.filter(
  (name) => name !== "walletTransactionPreimageHash",
);
publicOnchainEvidence.properties.checkpointType = { const: "ethereum_finalized" };
publicOnchainEvidence.properties.l1Posting = clone(l1Posting);
publicOnchainEvidence.properties.l1FinalizedCheckpoint = clone(l1FinalizedCheckpoint);
publicOnchainEvidence.properties.terminal = { const: true };
const finalizedSourceVerificationStatus = clone(sourceVerificationStatus);
finalizedSourceVerificationStatus.description =
  "Public finalized metadata is emitted only after every component has an authoritative exact source/build/compiler/settings/finalized-transaction/bytecode binding. Queued, retrying, and needs-attention source states remain authenticated history and are never public feed items.";
finalizedSourceVerificationStatus.properties.status = { const: "exact_match" };
finalizedSourceVerificationStatus.properties.components.items = clone(
  sourceVerificationExactComponent,
);
const finalizedMetadata = closed(
  [
    "schemaVersion", "apiVersion", "launchId", "chainId", "caip2", "chainDeploymentId",
    "chainDeploymentDescriptorDigest", "chainDeployment", "profile", "platformId", "category",
    "projectMetadata", "funding", "liquidityModel", "commitments", "onchain",
    "sourceVerification", "createdAt", "finalizedAt",
  ],
  {
    schemaVersion: { const: "programmable.finalized-custom-launch-metadata.v4" },
    apiVersion: { const: "v4" },
    launchId: uuid,
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    chainDeploymentId: { const: "robinhood-mainnet-custom-launch-v1" },
    chainDeploymentDescriptorDigest: nonzeroHex32,
    chainDeployment,
    profile,
    platformId: {
      const: "programmable",
      description: "Server-authored canonical platform identity; clients do not supply or infer it.",
    },
    category: {
      const: "custom",
      description: "Server-authored canonical launch category; clients do not supply or infer it.",
    },
    projectMetadata: inherited.projectMetadata,
    funding,
    liquidityModel,
    commitments,
    onchain: publicOnchainEvidence,
    sourceVerification: finalizedSourceVerificationStatus,
    createdAt: dateTime,
    finalizedAt: dateTime,
  },
  {
    "x-programmable-order":
      "chainDeploymentDescriptorDigest, chainDeployment, profile, and commitments equal onchain counterparts",
  },
);
const listEnvelope = closed(
  ["schemaVersion", "apiVersion", "chainId", "caip2", "generatedAt", "launches", "nextCursor"],
  {
    schemaVersion: { const: "programmable.custom-launch-list.v4" },
    apiVersion: { const: "v4" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    generatedAt: dateTime,
    launches: array(resource),
    nextCursor: nullable(clone(opaqueListCursor)),
  },
);
const finalizedListEnvelope = closed(
  ["schemaVersion", "apiVersion", "chainId", "caip2", "generatedAt", "quality", "launches", "nextCursor"],
  {
    schemaVersion: { const: "programmable.custom-launch-list.v4" },
    apiVersion: { const: "v4" },
    chainId: { const: "4663" },
    caip2: { const: "eip155:4663" },
    generatedAt: dateTime,
    quality: closed(
      ["status", "sourceRowCount", "publishedRowCount", "quarantinedRowCount"],
      {
        status: {
          const: "ready",
          description:
            "A successful finalized-feed response is complete and ready; malformed eligible V3 rows fail the request instead of producing a partial response.",
        },
        sourceRowCount: {
          type: "integer",
          minimum: 0,
          description:
            "Global number of canonical eligible V3-finalized and authoritatively source-verified rows in this finalized-dataset snapshot.",
        },
        publishedRowCount: {
          type: "integer",
          minimum: 0,
          description:
            "Global number of canonical eligible V3-finalized and authoritatively source-verified rows emittable under this public contract; it equals sourceRowCount, while the current page is a subset of this total.",
        },
        quarantinedRowCount: {
          const: 0,
          description:
            "Always zero on a successful response. A malformed eligible V3-finalized row fails the entire request and is never excluded row by row.",
        },
      },
      {
        description:
          "Quality counts are global finalized-dataset snapshot totals over canonical eligible V3-finalized and authoritatively source-verified rows, not current-page counts. A successful response publishes all eligible rows and quarantines none.",
        "x-programmable-order": "sourceRowCount == publishedRowCount",
      },
    ),
    launches: array(finalizedMetadata),
    nextCursor: nullable(clone(opaqueListCursor)),
  },
  { "x-programmable-order": "launches.length <= quality.publishedRowCount" },
);
const listPaginationParameters = [
  {
    name: "limit",
    in: "query",
    required: false,
    description: "Page size. Defaults to 10 and never exceeds 25.",
    schema: { type: "integer", minimum: 1, maximum: 25, default: 10 },
  },
  {
    name: "cursor",
    in: "query",
    required: false,
    description: "Opaque continuation cursor returned by nextCursor. Pass it back unchanged.",
    schema: clone(opaqueListCursor),
  },
];

const standalone = new Map([
  ["custom-launch-create-request.json", annotate("Custom Launch V4 create request", "custom-launch-create-request.json", createRequest)],
  ["custom-launch.json", annotate("Custom Launch resource V4", "custom-launch.json", resource)],
  ["source-verification-status.json", annotate("Custom Launch source-verification status V4", "source-verification-status.json", sourceVerificationStatus)],
  ["capabilities.json", annotate("Custom Launch capabilities V2 for API V4", "capabilities.json", capabilities)],
  ["preflight.json", annotate("Custom Launch preflight V2 for API V4", "preflight.json", preflight)],
  ["onchain-evidence.json", annotate("Custom Launch onchain evidence V3 for API V4", "onchain-evidence.json", onchainEvidenceV3)],
  ["exact-wallet-transaction.json", annotate("Exact wallet transaction V4", "exact-wallet-transaction.json", exactWallet)],
]);

for (const [name, schema] of standalone) {
  await writeFile(path.join(publicSchemaRoot, name), `${JSON.stringify(schema, null, 2)}\n`);
}

const packConfig = await readJson(packagedPackConfigPath);
packConfig.$defs.chainDeployment = clone(chainDeployment);
const packagedPackConfigSource = `${JSON.stringify(packConfig, null, 2)}\n`;
await writeFile(packagedPackConfigPath, packagedPackConfigSource);
await writeFile(path.join(publicSchemaRoot, "pack-config.json"), packagedPackConfigSource);
openapi.components.schemas = {
  ...openapi.components.schemas,
  PackConfigV4: packConfig,
  CustomLaunchCreateRequestV4: standalone.get("custom-launch-create-request.json"),
  CustomLaunchCapabilitiesV2: standalone.get("capabilities.json"),
  CustomLaunchPreflightV2: standalone.get("preflight.json"),
  CustomLaunchResourceV4: standalone.get("custom-launch.json"),
  SourceVerificationStatusV4: standalone.get("source-verification-status.json"),
  CustomLaunchL2InclusionV1: clone(l2Inclusion),
  CustomLaunchL1PostingV1: clone(l1Posting),
  CustomLaunchL1FinalizedProviderReadbackV1: clone(l1FinalizedProviderReadbackSchema),
  CustomLaunchL1FinalizedCheckpointV1: clone(l1FinalizedCheckpoint),
  CustomLaunchOnchainEvidenceV2: clone(onchainEvidenceV2),
  CustomLaunchOnchainEvidenceV3: standalone.get("onchain-evidence.json"),
  ExactWalletTransactionV4: standalone.get("exact-wallet-transaction.json"),
  CustomLaunchFinalizedMetadataV4: finalizedMetadata,
  CustomLaunchListV4: listEnvelope,
  CustomLaunchFinalizedListV4: finalizedListEnvelope,
};
openapi.$defs = clone(packConfig.$defs ?? {});

const listResponse = openapi.paths["/v4/chains/{chainId}/custom-launches"].get
  .responses["200"].content["application/json"];
listResponse.schema = { $ref: "#/components/schemas/CustomLaunchListV4" };
const finalizedResponse = openapi.paths["/v4/chains/{chainId}/finalized-custom-launches"].get
  .responses["200"].content["application/json"];
finalizedResponse.schema = { $ref: "#/components/schemas/CustomLaunchFinalizedListV4" };
for (const pathName of [
  "/v4/chains/{chainId}/custom-launches",
  "/v4/chains/{chainId}/finalized-custom-launches",
]) {
  const operation = openapi.paths[pathName].get;
  operation.parameters = [
    ...(operation.parameters ?? []).filter((parameter) => !(
      parameter.in === "query"
      && (parameter.name === "limit" || parameter.name === "cursor")
    )),
    ...clone(listPaginationParameters),
  ];
}

await writeFile(openApiPath, `${JSON.stringify(openapi, null, 2)}\n`);

function annotate(title, fileName, schema) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://programmable.market/schemas/custom-launch/v4/${fileName}`,
    title: `Programmable ${title}`,
    ...schema,
  };
}

function restrictMetadataImage(schema) {
  walk(schema, (value) => {
    if (value?.properties?.mediaType?.enum?.includes("image/png")) {
      value.properties.mediaType = { enum: ["image/png", "image/gif"] };
      if (value.properties.byteLength?.type === "integer") {
        value.properties.byteLength.maximum = 5_242_880;
      }
    }
  });
}

function walk(value, visit) {
  if (value === null || typeof value !== "object") return;
  visit(value);
  for (const entry of Object.values(value)) walk(entry, visit);
}
