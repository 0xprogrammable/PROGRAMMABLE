import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const OFFICIAL_DEPLOYMENTS_URL =
  "https://developers.uniswap.org/deployments.json";
const EXPECTED_DATASET_REPOSITORY = "https://github.com/Uniswap/contracts";

const dependencyDirectory = fileURLToPath(
  new URL("../dependencies/", import.meta.url),
);

const networks = [
  {
    file: "ethereum-mainnet.json",
    requiredKeys: [
      "poolManager",
      "positionManager",
      "stateView",
      "v4Quoter",
      "feeOnTransferDetector",
      "erc7914Detector",
      "permit2",
      "universalRouter",
      "continuousClearingAuctionFactory",
      "liquidityLauncher",
      "lbpStrategy",
      "tokenSplitter",
      "uerc20Factory",
    ],
  },
  {
    file: "ethereum-sepolia.json",
    requiredKeys: [
      "poolManager",
      "positionManager",
      "stateView",
      "v4Quoter",
      "permit2",
      "universalRouter",
      "continuousClearingAuctionFactory",
      "liquidityLauncher",
      "lbpStrategy",
      "tokenSplitter",
      "uerc20Factory",
    ],
  },
];

const officialRecordByKey = {
  poolManager: { protocol: "v4", contract: "PoolManager" },
  positionManager: { protocol: "v4", contract: "PositionManager" },
  stateView: { protocol: "v4", contract: "StateView" },
  v4Quoter: { protocol: "v4", contract: "V4Quoter" },
  feeOnTransferDetector: {
    protocol: "v4",
    contract: "FeeOnTransferDetector",
  },
  erc7914Detector: { protocol: "v4", contract: "ERC7914Detector" },
  permit2: { protocol: "permit2", contract: "Permit2" },
  universalRouter: {
    protocol: "universal-router",
    contract: "UniversalRouter",
  },
  continuousClearingAuctionFactory: {
    protocol: "liquidity-launchpad",
    contract: "ContinuousClearingAuctionFactory",
  },
  liquidityLauncher: {
    protocol: "liquidity-launchpad",
    contract: "LiquidityLauncher",
  },
  lbpStrategy: {
    protocol: "liquidity-launchpad",
    contract: "LBPStrategy",
  },
  tokenSplitter: {
    protocol: "liquidity-launchpad",
    contract: "TokenSplitter",
  },
  uerc20Factory: {
    protocol: "liquidity-launchpad",
    contract: "UERC20Factory",
  },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeSourceRef(sourceRef) {
  return sourceRef
    .toLowerCase()
    .replace(/^(?:v4-core|v4-periphery)@/, "");
}

function versionMatches(sourceRef, version) {
  const normalizedVersion = version.replace(/^v/, "");
  const normalizedSourceRef = sourceRef.replace(/^v/, "");
  return (
    normalizedSourceRef === normalizedVersion ||
    normalizedSourceRef.startsWith(`${normalizedVersion}.`)
  );
}

const response = await fetch(OFFICIAL_DEPLOYMENTS_URL, {
  headers: { accept: "application/json" },
});

assert(
  response.ok,
  `Official deployment dataset returned HTTP ${response.status}`,
);

const dataset = await response.json();

assert(dataset.version === "1.0.0", `Unsupported dataset ${dataset.version}`);
assert(
  dataset.source?.repo === EXPECTED_DATASET_REPOSITORY,
  "Unexpected deployment dataset source repository",
);
assert(Array.isArray(dataset.records), "Deployment records are missing");

let verifiedCount = 0;

for (const network of networks) {
  const snapshot = JSON.parse(
    await readFile(`${dependencyDirectory}${network.file}`, "utf8"),
  );

  assert(
    snapshot.source?.deployments === OFFICIAL_DEPLOYMENTS_URL,
    `${network.file} points to an unexpected deployment source`,
  );
  assert(
    snapshot.source?.generatedAt === dataset.generatedAt,
    `${network.file} was generated from an older official dataset`,
  );
  assert(
    snapshot.source?.sourceCommit === dataset.source.commit,
    `${network.file} does not pin the current official dataset commit`,
  );

  for (const key of network.requiredKeys) {
    const local = snapshot.contracts[key];
    const identity = officialRecordByKey[key];

    assert(local, `${network.file} is missing ${key}`);
    assert(identity, `No official record mapping exists for ${key}`);

    const official = dataset.records.find(
      (record) =>
        record.chainId === snapshot.chainId &&
        record.protocol === identity.protocol &&
        record.contract === identity.contract,
    );

    assert(
      official,
      `No official ${identity.contract} record exists for chain ${snapshot.chainId}`,
    );
    assert(
      official.status === "active",
      `${official.id} is ${official.status}, not active`,
    );
    assert(
      official.address.toLowerCase() === local.address.toLowerCase(),
      `${key} address mismatch on ${network.file}`,
    );
    assert(
      official.sourceRepo?.startsWith("https://github.com/Uniswap/"),
      `${official.id} has an unexpected source repository`,
    );
    assert(
      official.sourceCodeUrl?.startsWith("https://github.com/Uniswap/"),
      `${official.id} has no official source code link`,
    );

    if (local.sourceRef) {
      assert(
        normalizeSourceRef(official.sourceRef) ===
          normalizeSourceRef(local.sourceRef),
        `${key} source reference mismatch on ${network.file}`,
      );
    }

    if (local.version) {
      assert(
        versionMatches(official.sourceRef, local.version),
        `${key} version mismatch on ${network.file}`,
      );
    }

    verifiedCount += 1;
  }
}

console.log(
  `Verified ${verifiedCount} active contracts against Uniswap deployments ${dataset.generatedAt}`,
);
console.log(`Dataset commit ${dataset.source.commit}`);
