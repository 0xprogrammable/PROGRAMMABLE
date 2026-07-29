#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";
import { sepolia } from "viem/chains";

import {
  loadClassicV3ReleasePlan,
  readClassicV3Evidence,
} from "../../scripts/classic-v3-release-core.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..", "..");
const releasePath = path.join(
  root,
  "contracts",
  "deployments",
  "sepolia-classic-v3.json",
);
const appManifestPath = path.join(
  root,
  "contracts",
  "config",
  "app-deployments.v1.json",
);
const deploymentEvidencePath = path.join(
  root,
  "tmp",
  "classic-v3-sepolia-release-evidence.json",
);
const lifecycleEvidencePath = path.join(
  root,
  "tmp",
  "classic-v3-sepolia-lifecycle-evidence.json",
);
const rpcEndpoints = [
  process.env.CLASSIC_V3_RPC_A ?? "https://sepolia.drpc.org",
  process.env.CLASSIC_V3_RPC_B ??
    "https://ethereum-sepolia-rpc.publicnode.com",
];
const clients = rpcEndpoints.map((endpoint) =>
  createPublicClient({
    chain: sepolia,
    transport: http(endpoint, {
      retryCount: 3,
      retryDelay: 500,
      timeout: 15_000,
    }),
  }),
);

const sourceTargets = {
  ctoAuthority: {
    contractName: "ClassicCtoAuthorityV1",
    jobId: "b288cd56-dd72-4400-9e4f-771d7dad4a38",
  },
  rewardVaultFactory: {
    contractName: "ClassicRewardVaultFactoryV1",
    jobId: "364a4675-e1bc-40d8-ba38-cc55199bd064",
  },
  initialBuyVestingWalletFactory: {
    contractName: "ClassicInitialBuyVestingWalletFactoryV1",
    jobId: "15159f30-444d-4304-96fa-c9a01feacee1",
  },
  launchPolicy: {
    contractName: "ClassicLaunchPolicyV1",
    jobId: "311809d3-5120-4891-988a-a133a31b9d73",
  },
  hookFactory: {
    contractName: "EthCreatorFeeHookFactoryV3",
    jobId: "2d37e0df-dced-4659-85d4-f8c3260d94ba",
  },
  feeHook: {
    contractName: "EthCreatorFeeHookV3",
    jobId: "9674d585-9c35-442f-8aed-2fd07e7cc6c4",
  },
  launcher: {
    contractName: "MemeLaunchV2",
    jobId: "34985b08-3e95-4f73-95e1-8d12ee223d61",
  },
};
const fieldByContractName = {
  ClassicCtoAuthorityV1: "ctoAuthority",
  ClassicRewardVaultFactoryV1: "rewardVaultFactory",
  ClassicInitialBuyVestingWalletFactoryV1:
    "initialBuyVestingWalletFactory",
  ClassicLaunchPolicyV1: "launchPolicy",
  EthCreatorFeeHookFactoryV3: "hookFactory",
  EthCreatorFeeHookV3: "feeHook",
  MemeLaunchV2: "launcher",
};
const appFieldByReleaseField = {
  ctoAuthority: "classicCtoAuthorityV1",
  rewardVaultFactory: "classicRewardVaultFactoryV1",
  initialBuyVestingWalletFactory:
    "classicInitialBuyVestingWalletFactoryV1",
  launchPolicy: "classicLaunchPolicyV1",
  hookFactory: "ethCreatorFeeHookFactoryV3",
  feeHook: "ethCreatorFeeHookV3",
  launcher: "memeLaunchV2",
};
const launcherClaimAbi = parseAbi([
  "event LauncherFeesClaimed(address indexed treasury,address indexed recipient,address indexed caller,uint256 amount)",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJsonAtomic(file, value) {
  const temporaryPath = `${file}.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
  );
  await fs.rename(temporaryPath, file);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function verifySource(field, address) {
  const target = sourceTargets[field];
  const jobUrl = `https://sourcify.dev/server/v2/verify/${target.jobId}`;
  const [job, blockscout, routescan] = await Promise.all([
    fetchJson(jobUrl),
    fetchJson(
      `https://eth-sepolia.blockscout.com/api/v2/smart-contracts/${address}`,
    ),
    fetchJson(
      `https://api.routescan.io/v2/network/testnet/evm/11155111/etherscan/api?module=contract&action=getsourcecode&chainid=11155111&address=${address}`,
    ),
  ]);
  assert(job.isJobCompleted === true, `${field} Sourcify job is pending`);
  assert(job.contract?.match === "match", `${field} Sourcify mismatch`);
  assert(
    job.contract.address.toLowerCase() === address.toLowerCase(),
    `${field} Sourcify address mismatch`,
  );
  assert(blockscout.is_verified === true, `${field} is not verified on Blockscout`);
  assert(
    blockscout.name === target.contractName,
    `${field} Blockscout contract-name mismatch`,
  );
  assert(routescan.status === "1", `${field} is not verified on Routescan`);
  assert(
    routescan.result?.[0]?.ContractName === target.contractName,
    `${field} Routescan contract-name mismatch`,
  );
  return {
    status: "verified",
    contractName: target.contractName,
    verifiedAt: job.contract.verifiedAt,
    sourcify: {
      match: job.contract.match,
      creationMatch: job.contract.creationMatch,
      runtimeMatch: job.contract.runtimeMatch,
      matchId: job.contract.matchId,
      jobId: target.jobId,
      url: jobUrl,
    },
    blockscout: {
      verified: true,
      url: `https://eth-sepolia.blockscout.com/address/${address}?tab=contract`,
    },
    routescan: {
      verified: true,
      url: `https://routescan.io/address/${address}?chainid=11155111`,
    },
    etherscan: {
      verified: false,
      reason:
        job.externalVerifications?.etherscan?.error ??
        "No Etherscan verification result",
    },
  };
}

function receiptBlock(record) {
  const block = record?.receipt?.blockNumber;
  assert(
    typeof block === "string" && /^0x[0-9a-f]+$/i.test(block),
    `${record?.name ?? "deployment"} receipt block is missing`,
  );
  return Number(BigInt(block));
}

function transactionHash(record) {
  assert(
    typeof record?.txHash === "string" &&
      /^0x[0-9a-f]{64}$/i.test(record.txHash),
    `${record?.name ?? "deployment"} transaction hash is missing`,
  );
  return record.txHash.toLowerCase();
}

function lifecycleTransactions(evidence) {
  return Object.fromEntries(
    Object.entries(evidence.transactions).map(([key, record]) => [
      key,
      record.transactionHash,
    ]),
  );
}

function lifecycleBlocks(evidence) {
  return Object.fromEntries(
    Object.entries(evidence.transactions).map(([key, record]) => [
      key,
      record.blockNumber,
    ]),
  );
}

async function main() {
  const releasePlan = await loadClassicV3ReleasePlan(root, "sepolia");
  const [release, appManifest, lifecycle, fullCommit] =
    await Promise.all([
      readJson(releasePath),
      readJson(appManifestPath),
      readJson(lifecycleEvidencePath),
      execFileAsync(
        "git",
        ["rev-parse", `${releasePlan.simulationCommit}^{commit}`],
        { cwd: root },
      ).then(({ stdout }) => stdout.trim()),
    ]);
  const deploymentEvidence = await readClassicV3Evidence(
    deploymentEvidencePath,
    releasePlan,
  );

  assert(
    deploymentEvidence.receiptEvidenceReady === true,
    "Deployment receipts have not reached finality",
  );
  assert(
    lifecycle.status === "verified-current-release" &&
      lifecycle.verification?.status === "verified",
    "Lifecycle evidence is not verified",
  );
  assert(
    lifecycle.infrastructurePlanDigest === releasePlan.planDigest,
    "Lifecycle evidence belongs to another deployment plan",
  );
  assert(
    /^[a-f0-9]{40}$/.test(fullCommit),
    "Release commit must be a full Git commit",
  );

  const deploymentByField = {};
  for (const record of deploymentEvidence.transactions) {
    const field = fieldByContractName[record.name];
    assert(field, `Unknown deployment record ${record.name}`);
    assert(
      record.status === "finalized" &&
        record.deploymentVerified === true,
      `${field} deployment is not finalized`,
    );
    deploymentByField[field] = record;
  }
  assert(
    Object.keys(deploymentByField).length === 7,
    "Expected seven deployment records",
  );

  const addresses = Object.fromEntries(
    Object.entries(deploymentByField).map(([field, record]) => [
      field,
      getAddress(record.address),
    ]),
  );
  const runtimeCodeHashes = {};
  for (const [field, address] of Object.entries(addresses)) {
    const codes = await Promise.all(
      clients.map((client) => client.getCode({ address })),
    );
    assert(
      codes.every((code) => code && code !== "0x"),
      `${field} has no runtime code`,
    );
    const hashes = codes.map((code) => keccak256(code));
    assert(
      hashes[0] === hashes[1],
      `${field} runtime differs across Sepolia RPCs`,
    );
    runtimeCodeHashes[field] = hashes[0];
  }

  const sourceEntries = Object.fromEntries(
    await Promise.all(
      Object.entries(addresses).map(async ([field, address]) => [
        field,
        await verifySource(field, address),
      ]),
    ),
  );
  const sourceCheckedAt = Object.values(sourceEntries)
    .map((entry) => entry.verifiedAt)
    .sort()
    .at(-1);
  assert(sourceCheckedAt, "Source-verification timestamp is missing");

  const launcherClaimHash =
    lifecycle.transactions.launcherClaim.transactionHash;
  const launcherClaimReceipt = await clients[0].getTransactionReceipt({
    hash: launcherClaimHash,
  });
  const launcherClaimEvent = launcherClaimReceipt.logs
    .filter(
      (log) =>
        log.address.toLowerCase() === addresses.feeHook.toLowerCase(),
    )
    .flatMap((log) => {
      try {
        const event = decodeEventLog({
          abi: launcherClaimAbi,
          data: log.data,
          topics: log.topics,
        });
        return event.eventName === "LauncherFeesClaimed"
          ? [event]
          : [];
      } catch {
        return [];
      }
    });
  assert(
    launcherClaimEvent.length === 1,
    "Launcher claim event is missing",
  );

  const deploymentBlocks = Object.fromEntries(
    Object.entries(deploymentByField).map(([field, record]) => [
      field,
      receiptBlock(record),
    ]),
  );
  const deploymentTransactions = Object.fromEntries(
    Object.entries(deploymentByField).map(([field, record]) => [
      field,
      transactionHash(record),
    ]),
  );
  const observations = lifecycle.verification.observations;
  const updatedRelease = {
    ...release,
    status: "deployment-source-and-lifecycle-verified",
    releaseCommit: fullCommit,
    startingNonce: deploymentEvidence.startingNonce,
    hookSalt: releasePlan.hookSalt,
    addresses: {
      ...release.addresses,
      deployer: getAddress(releasePlan.expectedAccount),
      ...addresses,
    },
    transactions: deploymentTransactions,
    deploymentBlocks,
    runtimeCodeHashes: {
      ...release.runtimeCodeHashes,
      ...runtimeCodeHashes,
    },
    sourceVerification: {
      status: "verified",
      checkedAt: sourceCheckedAt,
      primaryProvider: "Sourcify",
      secondaryExplorers: ["Blockscout", "Routescan"],
      etherscanStatus:
        "not-verified-provider-daily-submission-limit",
      ...sourceEntries,
    },
    lifecycleEvidence: {
      status: "verified-current-release",
      releaseEligible: true,
      checkedAt: lifecycle.verification.checkedAt,
      verifier:
        "scripts/serve-classic-v3-sepolia-canary.mjs",
      independentRpcCount:
        lifecycle.verification.independentRpcCount,
      deploymentTransactionsVerified:
        lifecycle.verification.deploymentTransactionsVerified,
      runtimeBindingsVerified:
        lifecycle.verification.runtimeBindingsVerified,
      positionLockVerified:
        lifecycle.verification.positionLockVerified,
      buyAndSellVerified:
        lifecycle.verification.buyAndSellVerified,
      creatorClaimVerified:
        lifecycle.verification.creatorClaimVerified,
      launcherClaimVerified:
        lifecycle.verification.launcherClaimVerified,
      canaryToken: getAddress(lifecycle.token),
      rewardVault: getAddress(lifecycle.rewardVault),
      poolId: lifecycle.poolId,
      positionRecipient: getAddress(
        lifecycle.launchResult.positionRecipient,
      ),
      positionTokenId: lifecycle.launchResult.positionTokenId,
      positionLiquidity: observations.positionLiquidity,
      buySwapFeeBps: observations.feeConfig.buySwapFeeBps,
      sellSwapFeeBps: observations.feeConfig.sellSwapFeeBps,
      creatorFeesClaimedWei:
        observations.totalCreatorFeesClaimed,
      launcherFeesClaimedWei:
        launcherClaimEvent[0].args.amount.toString(),
      transactions: lifecycleTransactions(lifecycle),
      blocks: lifecycleBlocks(lifecycle),
    },
  };

  const rehearsal = appManifest.rehearsal;
  rehearsal.classicV3Status = "ready";
  for (const [field, appField] of Object.entries(
    appFieldByReleaseField,
  )) {
    rehearsal[appField] = addresses[field];
    rehearsal.runtimeCodeHashes[appField] =
      runtimeCodeHashes[field];
    rehearsal.deploymentTransactions[appField] =
      deploymentTransactions[field];
    rehearsal.deploymentBlocks[appField] =
      deploymentBlocks[field];
  }

  await Promise.all([
    writeJsonAtomic(releasePath, updatedRelease),
    writeJsonAtomic(appManifestPath, appManifest),
  ]);
  console.log(
    JSON.stringify(
      {
        status: updatedRelease.status,
        releaseCommit: fullCommit,
        launcher: addresses.launcher,
        feeHook: addresses.feeHook,
        canaryToken: lifecycle.token,
        sourceContractsVerified: Object.keys(sourceEntries).length,
        lifecycleTransactions:
          Object.keys(lifecycle.transactions).length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
