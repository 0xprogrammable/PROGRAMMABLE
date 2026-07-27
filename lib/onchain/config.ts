import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

import appDeploymentsJson from "../../contracts/config/app-deployments.v1.json";
import mainnetDependencies from "../../contracts/dependencies/ethereum-mainnet.json";
import sepoliaDependencies from "../../contracts/dependencies/ethereum-sepolia.json";

import type {
  DeploymentEnvironment,
  OnchainDeployment,
} from "./types";

type DeploymentEntry = {
  chainId: number;
  releaseVersion: "classic-v1" | "classic-v2";
  status: string;
  memeLaunchStatus: string;
  ethCreatorFeeHook?: string | null;
  memeLaunch?: string | null;
  runtimeCodeHashes?: {
    ethCreatorFeeHook?: string | null;
    memeLaunch?: string | null;
  };
  deploymentBlocks?: {
    memeLaunch?: number | null;
  };
};

type AppDeployments = {
  production: DeploymentEntry;
  rehearsal: DeploymentEntry;
};

function positiveBigInt(
  value: string | undefined,
  fallback: bigint,
  minimum: bigint,
  maximum: bigint,
) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = BigInt(value);
  return parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function asAddress(value: string | null | undefined): Address | null {
  return value && isAddress(value) ? getAddress(value) : null;
}

function asBytes32(value: string | null | undefined): Hex | null {
  return value && isHex(value) && value.length === 66
    ? (value as Hex)
    : null;
}

export function selectedDeploymentEnvironment(
  value = process.env.PROGRAMMABLE_ONCHAIN_NETWORK,
): DeploymentEnvironment {
  return value === "rehearsal" ? "rehearsal" : "production";
}

export function getOnchainDeployment(
  environment = selectedDeploymentEnvironment(),
): OnchainDeployment {
  const appDeployments =
    appDeploymentsJson as unknown as AppDeployments;
  const entry = appDeployments[environment];
  const dependencies =
    environment === "production"
      ? mainnetDependencies
      : sepoliaDependencies;
  const expectedChainId = environment === "production" ? 1 : 11_155_111;
  if (entry.chainId !== expectedChainId) {
    throw new Error(
      `Deployment manifest chain mismatch for ${environment}`,
    );
  }
  if (
    entry.releaseVersion !== "classic-v1" &&
    entry.releaseVersion !== "classic-v2"
  ) {
    throw new Error(
      `Deployment manifest release mismatch for ${environment}`,
    );
  }

  const common = {
    environment,
    releaseVersion: entry.releaseVersion,
    chainId: expectedChainId,
    stateView: getAddress(dependencies.contracts.stateView.address),
    stateViewRuntimeCodeHash: dependencies.contracts.stateView
      .runtimeCodeHash as Hex,
    rpcUrl:
      environment === "production"
        ? process.env.ETHEREUM_RPC_URL ?? "https://eth.drpc.org"
        : process.env.SEPOLIA_RPC_URL ?? "https://sepolia.drpc.org",
    confirmations: positiveBigInt(
      process.env.PROGRAMMABLE_CONFIRMATIONS,
      12n,
      12n,
      256n,
    ),
    logBlockRange: positiveBigInt(
      process.env.PROGRAMMABLE_LOG_BLOCK_RANGE,
      10_000n,
      1n,
      100_000n,
    ),
  } as const;

  if (entry.status !== "ready" || entry.memeLaunchStatus !== "ready") {
    return {
      ...common,
      status: "not-deployed",
      launcher: null,
      feeHook: null,
      launcherRuntimeCodeHash: null,
      feeHookRuntimeCodeHash: null,
      deploymentBlock: null,
    };
  }

  const launcher = asAddress(entry.memeLaunch);
  const feeHook = asAddress(entry.ethCreatorFeeHook);
  const launcherRuntimeCodeHash = asBytes32(
    entry.runtimeCodeHashes?.memeLaunch,
  );
  const feeHookRuntimeCodeHash = asBytes32(
    entry.runtimeCodeHashes?.ethCreatorFeeHook,
  );
  const deploymentBlockValue = entry.deploymentBlocks?.memeLaunch;
  const deploymentBlock =
    typeof deploymentBlockValue === "number" &&
    Number.isSafeInteger(deploymentBlockValue) &&
    deploymentBlockValue >= 0
      ? BigInt(deploymentBlockValue)
      : null;

  if (
    !launcher ||
    !feeHook ||
    !launcherRuntimeCodeHash ||
    !feeHookRuntimeCodeHash ||
    deploymentBlock === null
  ) {
    throw new Error(
      `Ready ${environment} deployment is missing verified indexing configuration`,
    );
  }

  return {
    ...common,
    status: "ready",
    launcher,
    feeHook,
    launcherRuntimeCodeHash,
    feeHookRuntimeCodeHash,
    deploymentBlock,
  };
}
