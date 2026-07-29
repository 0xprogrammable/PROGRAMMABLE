import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress, keccak256 } from "viem";

const require = createRequire(import.meta.url);
const {
  LOCK_RECIPIENT_CREATION_BYTECODE,
  computeLbpPoolId,
  getLauncherAddresses,
  selectTokenFactory,
} = require("@uniswap/liquidity-launcher-sdk");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(path.join(root, relativePath), "utf8"),
  );
}

function assertEqual(actual, expected, label) {
  if (
    typeof actual !== "string" ||
    actual.toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error(
      `Official Uniswap Liquidity Launcher SDK drift detected for ${label}`,
    );
  }
}

const reviewed = await readJson(
  "config/uniswap-liquidity-launcher-sdk.v1.json",
);
const packageJson = await readJson("package.json");
const packageLock = await readJson("package-lock.json");
const installedPackage = await readJson(
  "node_modules/@uniswap/liquidity-launcher-sdk/package.json",
);
const lockEntry =
  packageLock.packages?.[
    "node_modules/@uniswap/liquidity-launcher-sdk"
  ];

assertEqual(
  packageJson.dependencies?.[reviewed.packageName],
  reviewed.packageVersion,
  "package.json version",
);
assertEqual(
  packageLock.packages?.[""]?.dependencies?.[reviewed.packageName],
  reviewed.packageVersion,
  "package-lock root version",
);
assertEqual(
  lockEntry?.version,
  reviewed.packageVersion,
  "package-lock installed version",
);
assertEqual(
  lockEntry?.resolved,
  reviewed.packageResolved,
  "npm tarball URL",
);
assertEqual(
  lockEntry?.integrity,
  reviewed.packageIntegrity,
  "npm tarball integrity",
);
assertEqual(
  installedPackage.version,
  reviewed.packageVersion,
  "installed package version",
);
assertEqual(
  installedPackage.repository,
  reviewed.packageRepository,
  "installed package repository",
);

const mainnet = getLauncherAddresses(1);
if (!mainnet) {
  throw new Error(
    "Official Uniswap Liquidity Launcher SDK has no Ethereum deployment",
  );
}
const tokenFactory = selectTokenFactory(mainnet);
if (!tokenFactory || !mainnet.positionManager) {
  throw new Error(
    "Official Uniswap Liquidity Launcher SDK is missing an Ethereum dependency",
  );
}

const runtimeMainnet = {
  liquidityLauncher: mainnet.liquidityLauncher,
  tokenFactory: tokenFactory.factory,
  tokenFactoryKind: tokenFactory.kind,
  positionManager: mainnet.positionManager,
  permit2: mainnet.permit2,
};
for (const [key, expected] of Object.entries(reviewed.mainnet)) {
  assertEqual(runtimeMainnet[key], expected, `mainnet.${key}`);
}

const runtimeBytecodeHashes = {
  timelock: keccak256(LOCK_RECIPIENT_CREATION_BYTECODE.TIMELOCK),
  feesForwarder: keccak256(
    LOCK_RECIPIENT_CREATION_BYTECODE.FEES_FORWARDER,
  ),
  buybackBurn: keccak256(
    LOCK_RECIPIENT_CREATION_BYTECODE.BUYBACK_BURN,
  ),
};
for (const [key, expected] of Object.entries(
  reviewed.lockRecipientBytecodeHashes,
)) {
  assertEqual(
    runtimeBytecodeHashes[key],
    expected,
    `${key} creation bytecode`,
  );
}

const fixture = reviewed.poolIdFixture;
assertEqual(
  computeLbpPoolId(
    getAddress(fixture.currency0),
    getAddress(fixture.currency1),
    fixture.fee,
    fixture.tickSpacing,
    getAddress(fixture.hooks),
  ),
  fixture.poolId,
  "canonical v4 PoolId fixture",
);

console.log(
  `Verified ${reviewed.packageName}@${reviewed.packageVersion} (${reviewed.packageGitHead})`,
);
console.log(
  `Lock recipients pinned to Uniswap/liquidity-launcher@${reviewed.lockRecipientUpstreamCommit}`,
);
