import {
  LOCK_RECIPIENT_CREATION_BYTECODE,
  type TokenFactoryKind,
} from "@uniswap/liquidity-launcher-sdk";
import { getAddress, keccak256, type Hex } from "viem";

import reviewedSnapshot from "../../config/uniswap-liquidity-launcher-sdk.v1.json";
import {
  OfficialLauncherSdkError,
  getOfficialLauncherDependencies,
  type OfficialLauncherDependencies,
} from "./liquidity-launcher-sdk";

export type OfficialLauncherRuntimeSnapshot = {
  mainnet: OfficialLauncherDependencies;
  lockRecipientBytecodeHashes: {
    timelock: Hex;
    feesForwarder: Hex;
    buybackBurn: Hex;
  };
};

export function readOfficialLauncherRuntimeSnapshot(): OfficialLauncherRuntimeSnapshot {
  return {
    mainnet: getOfficialLauncherDependencies(1),
    lockRecipientBytecodeHashes: {
      timelock: keccak256(LOCK_RECIPIENT_CREATION_BYTECODE.TIMELOCK),
      feesForwarder: keccak256(
        LOCK_RECIPIENT_CREATION_BYTECODE.FEES_FORWARDER,
      ),
      buybackBurn: keccak256(
        LOCK_RECIPIENT_CREATION_BYTECODE.BUYBACK_BURN,
      ),
    },
  };
}

const expectedRuntimeSnapshot: OfficialLauncherRuntimeSnapshot = {
  mainnet: {
    liquidityLauncher: getAddress(
      reviewedSnapshot.mainnet.liquidityLauncher,
    ),
    tokenFactory: getAddress(reviewedSnapshot.mainnet.tokenFactory),
    tokenFactoryKind: reviewedSnapshot.mainnet
      .tokenFactoryKind as TokenFactoryKind,
    positionManager: getAddress(reviewedSnapshot.mainnet.positionManager),
    permit2: getAddress(reviewedSnapshot.mainnet.permit2),
  },
  lockRecipientBytecodeHashes: {
    timelock: reviewedSnapshot.lockRecipientBytecodeHashes.timelock as Hex,
    feesForwarder: reviewedSnapshot.lockRecipientBytecodeHashes
      .feesForwarder as Hex,
    buybackBurn: reviewedSnapshot.lockRecipientBytecodeHashes
      .buybackBurn as Hex,
  },
};

function assertEqual(
  actual: string,
  expected: string,
  label: string,
) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new OfficialLauncherSdkError(
      `Official Uniswap Liquidity Launcher SDK drift detected for ${label}`,
    );
  }
}

export function assertOfficialLauncherRuntimeSnapshot(
  actual: OfficialLauncherRuntimeSnapshot =
    readOfficialLauncherRuntimeSnapshot(),
) {
  assertEqual(
    actual.mainnet.liquidityLauncher,
    expectedRuntimeSnapshot.mainnet.liquidityLauncher,
    "mainnet.liquidityLauncher",
  );
  assertEqual(
    actual.mainnet.tokenFactory,
    expectedRuntimeSnapshot.mainnet.tokenFactory,
    "mainnet.tokenFactory",
  );
  assertEqual(
    actual.mainnet.tokenFactoryKind,
    expectedRuntimeSnapshot.mainnet.tokenFactoryKind,
    "mainnet.tokenFactoryKind",
  );
  assertEqual(
    actual.mainnet.positionManager,
    expectedRuntimeSnapshot.mainnet.positionManager,
    "mainnet.positionManager",
  );
  assertEqual(
    actual.mainnet.permit2,
    expectedRuntimeSnapshot.mainnet.permit2,
    "mainnet.permit2",
  );
  assertEqual(
    actual.lockRecipientBytecodeHashes.timelock,
    expectedRuntimeSnapshot.lockRecipientBytecodeHashes.timelock,
    "TIMELOCK creation bytecode",
  );
  assertEqual(
    actual.lockRecipientBytecodeHashes.feesForwarder,
    expectedRuntimeSnapshot.lockRecipientBytecodeHashes.feesForwarder,
    "FEES_FORWARDER creation bytecode",
  );
  assertEqual(
    actual.lockRecipientBytecodeHashes.buybackBurn,
    expectedRuntimeSnapshot.lockRecipientBytecodeHashes.buybackBurn,
    "BUYBACK_BURN creation bytecode",
  );
}
