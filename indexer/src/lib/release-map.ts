export type ReleaseIdentity = {
  model: string;
  releaseVersion: string;
};

export type SourceRegistryEntry = {
  contractName: string;
  address: `0x${string}`;
  startBlock: number;
};

export const SOURCE_REGISTRY = [
  {
    contractName: "ClassicV2Hook",
    address: "0x025a386eaa79f6067d29848fd05ccc71beab20cc",
    startBlock: 25_624_130,
  },
  {
    contractName: "ClassicV2Launcher",
    address: "0xd240d06f8586eb799f20056054e5b527405e6bad",
    startBlock: 25_624_131,
  },
  {
    contractName: "ClassicV3RewardVaultFactory",
    address: "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a",
    startBlock: 25_639_538,
  },
  {
    contractName: "ClassicV3VestingWalletFactory",
    address: "0xde21b9c0cc0afdb9be20e8236113f066bb8c66f4",
    startBlock: 25_639_564,
  },
  {
    contractName: "ClassicV3Hook",
    address: "0x35fe236ea82f7cf525c9719d7df8f49f94d720cc",
    startBlock: 25_639_591,
  },
  {
    contractName: "ClassicV3Launcher",
    address: "0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770",
    startBlock: 25_639_596,
  },
  {
    contractName: "StockV1Launcher",
    address: "0x195750f33cad5ef2df857a53226b421297a1e79e",
    startBlock: 25_637_469,
  },
  {
    contractName: "StockV1EthCoordinator",
    address: "0xfa5f17389ca28d071781d59750b32c842ab6a54b",
    startBlock: 25_637_469,
  },
  {
    contractName: "StockV1Hook",
    address: "0x7773d183fe7b60d4f1885047fa42b815a62fe0cc",
    startBlock: 25_637_469,
  },
  {
    contractName: "StockV1RewardVaultFactory",
    address: "0xd430d9162c153afdf9e4caca6d2317e72a044441",
    startBlock: 25_637_469,
  },
  {
    contractName: "StockV2Launcher",
    address: "0x5ea6be24838061ba45dbe8d82de1b267dc240daf",
    startBlock: 25_640_338,
  },
  {
    contractName: "StockV2EthCoordinator",
    address: "0xfb9e1034df6161088e8f358502b19e7515c30fd2",
    startBlock: 25_640_338,
  },
  {
    contractName: "StockV2V3Hook",
    address: "0x90c67c1e866f86526f0e338459cd435e1f23a0cc",
    startBlock: 25_640_338,
  },
  {
    contractName: "StockV2V3RewardVaultFactory",
    address: "0x52d70971d6653a754c29385a2a6f241a481952d4",
    startBlock: 25_640_338,
  },
  {
    contractName: "StockV3Launcher",
    address: "0x0573879f72d8ee8b0e5a4ec5e8bcdb2fcab9e51c",
    startBlock: 25_642_745,
  },
  {
    contractName: "StockV3EthCoordinator",
    address: "0xddc3abbab0df7f1189310a4f70e7e365796b74e2",
    startBlock: 25_642_745,
  },
  {
    contractName: "CustomRegistryV1",
    address: "0x17e18c88bda9bfb73924cdc989c07b0707e72671",
    startBlock: 25_701_139,
  },
  {
    contractName: "CustomPartnerFactoryRegistryV1",
    address: "0xf8aef69201621ad20fa256da595426b7e6192dba",
    startBlock: 25_701_136,
  },
  {
    contractName: "CustomAtomicRegistrarV1",
    address: "0xcc916e5200d2626edfd918dc219bc4296629e997",
    startBlock: 25_701_142,
  },
] as const satisfies readonly SourceRegistryEntry[];

export function staticReleaseForContract(
  contractName: string,
): ReleaseIdentity | undefined {
  if (CLASSIC_V2_CONTRACTS.has(contractName)) {
    return { model: "classic", releaseVersion: "classic-v2" };
  }
  if (CLASSIC_V3_CONTRACTS.has(contractName)) {
    return { model: "classic", releaseVersion: "classic-v3" };
  }
  if (STOCK_V1_CONTRACTS.has(contractName)) {
    return { model: "stock-paired", releaseVersion: "stock-paired-v1" };
  }
  if (STOCK_V2_CONTRACTS.has(contractName)) {
    return { model: "stock-paired", releaseVersion: "stock-paired-v2" };
  }
  if (STOCK_V3_CONTRACTS.has(contractName)) {
    return { model: "stock-paired", releaseVersion: "stock-paired-v3" };
  }
  if (CUSTOM_REGISTRY_V1_CONTRACTS.has(contractName)) {
    return { model: "custom", releaseVersion: "custom-registry-v1" };
  }
  return undefined;
}

export function resolveRelease(input: {
  contractName: string;
  poolRelation?: ReleaseIdentity;
  vaultRelation?: ReleaseIdentity;
}): ReleaseIdentity {
  const staticRelease = staticReleaseForContract(input.contractName);
  if (staticRelease !== undefined) {
    return staticRelease;
  }
  if (input.poolRelation !== undefined) {
    return input.poolRelation;
  }
  if (input.vaultRelation !== undefined) {
    return input.vaultRelation;
  }
  return { model: "unresolved", releaseVersion: "unresolved" };
}

export function sourceStartBlock(contractName: string): number | undefined {
  return SOURCE_REGISTRY.find((source) => source.contractName === contractName)
    ?.startBlock;
}

const CLASSIC_V2_CONTRACTS = new Set([
  "ClassicV2Hook",
  "ClassicV2Launcher",
]);
const CLASSIC_V3_CONTRACTS = new Set([
  "ClassicV3Hook",
  "ClassicV3Launcher",
  "ClassicV3RewardVaultFactory",
  "ClassicV3VestingWalletFactory",
]);
const STOCK_V1_CONTRACTS = new Set([
  "StockV1Hook",
  "StockV1Launcher",
  "StockV1EthCoordinator",
  "StockV1RewardVaultFactory",
]);
const STOCK_V2_CONTRACTS = new Set([
  "StockV2Launcher",
  "StockV2EthCoordinator",
]);
const STOCK_V3_CONTRACTS = new Set([
  "StockV3Launcher",
  "StockV3EthCoordinator",
]);
const CUSTOM_REGISTRY_V1_CONTRACTS = new Set([
  "CustomRegistryV1",
  "CustomPartnerFactoryRegistryV1",
  "CustomAtomicRegistrarV1",
]);
