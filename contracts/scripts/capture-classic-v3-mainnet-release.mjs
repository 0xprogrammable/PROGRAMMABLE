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
import { mainnet } from "viem/chains";

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
  "mainnet-classic-v3.json",
);
const appManifestPath = path.join(
  root,
  "contracts",
  "config",
  "app-deployments.v1.json",
);
const deploymentEvidencePath = path.resolve(
  process.env.CLASSIC_V3_RELEASE_EVIDENCE_PATH ??
    path.join(root, "tmp/classic-v3-mainnet-release-evidence.json"),
);
const sourceEvidencePath = path.resolve(
  process.env.CLASSIC_V3_SOURCE_EVIDENCE_PATH ??
    path.join(root, "tmp/classic-v3-mainnet-source-evidence.json"),
);
const lifecycleEvidencePath = path.resolve(
  process.env.CLASSIC_V3_LIFECYCLE_EVIDENCE_PATH ??
    path.join(root, "tmp/classic-v3-mainnet-lifecycle-evidence.json"),
);
const rpcEndpoints = [
  process.env.CLASSIC_V3_RPC_A ??
    "https://ethereum-rpc.publicnode.com",
  process.env.CLASSIC_V3_RPC_B ??
    "https://eth-mainnet.public.blastapi.io",
];
const clients = rpcEndpoints.map((endpoint) =>
  createPublicClient({
    chain: mainnet,
    transport: http(endpoint, {
      retryCount: 3,
      retryDelay: 500,
      timeout: 15_000,
    }),
  }),
);

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

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJsonAtomic(file, value) {
  const temporaryPath = `${file}.${process.pid}.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(temporaryPath, file);
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
  const releasePlan = await loadClassicV3ReleasePlan(root, "mainnet");
  const [
    release,
    appManifest,
    sourceEvidence,
    lifecycle,
    fullCommit,
  ] = await Promise.all([
    readJson(releasePath),
    readJson(appManifestPath),
    readJson(sourceEvidencePath),
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
    deploymentEvidence.chainId === 1 &&
      deploymentEvidence.planDigest === releasePlan.planDigest,
    "Deployment evidence belongs to another release",
  );
  assert(
    sourceEvidence.status === "verified" &&
      sourceEvidence.chainId === 1 &&
      sourceEvidence.infrastructurePlanDigest === releasePlan.planDigest,
    "Source evidence is not verified for this release",
  );
  assert(
    lifecycle.status === "verified-current-release" &&
      lifecycle.chainId === 1 &&
      lifecycle.verification?.status === "verified",
    "Lifecycle evidence is not verified",
  );
  assert(
    lifecycle.infrastructurePlanDigest === releasePlan.planDigest,
    "Lifecycle evidence belongs to another deployment plan",
  );
  for (const flag of [
    "deploymentTransactionsVerified",
    "runtimeBindingsVerified",
    "positionLockVerified",
    "buyAndSellVerified",
    "creatorClaimVerified",
    "launcherClaimVerified",
  ]) {
    assert(
      lifecycle.verification[flag] === true,
      `Lifecycle verification is missing ${flag}`,
    );
  }
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
  assert(
    Object.keys(sourceEvidence.contracts ?? {}).length === 7,
    "Expected seven source-verification records",
  );
  for (const [field, record] of Object.entries(deploymentByField)) {
    const source = sourceEvidence.contracts[field];
    assert(source, `${field} source evidence is missing`);
    assert(
      source.status === "etherscan-exact-sourcify-match" &&
        source.etherscan?.status === "exact-match" &&
        source.sourcify?.status === "match",
      `${field} source verification is incomplete`,
    );
    assert(
      sameAddress(source.address, record.address) &&
        source.deploymentTransaction.toLowerCase() ===
          transactionHash(record) &&
        source.deploymentBlock === receiptBlock(record),
      `${field} source evidence differs from deployment evidence`,
    );
  }

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
      `${field} runtime differs across Mainnet RPCs`,
    );
    runtimeCodeHashes[field] = hashes[0];
  }

  const launcherClaim = lifecycle.transactions?.launcherClaim;
  assert(
    launcherClaim?.transactionHash,
    "Launcher claim transaction is missing",
  );
  const launcherClaimReceipt = await clients[0].getTransactionReceipt({
    hash: launcherClaim.transactionHash,
  });
  const launcherClaimEvents = launcherClaimReceipt.logs
    .filter(
      (log) =>
        log.address.toLowerCase() ===
        addresses.feeHook.toLowerCase(),
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
    launcherClaimEvents.length === 1,
    "Launcher claim event is missing",
  );
  const launcherClaimEvent = launcherClaimEvents[0];
  assert(
    sameAddress(
      launcherClaimEvent.args.treasury,
      releasePlan.launcherFeeRecipient,
    ) &&
      sameAddress(
        launcherClaimEvent.args.recipient,
        releasePlan.launcherFeeRecipient,
      ) &&
      sameAddress(
        launcherClaimEvent.args.caller,
        releasePlan.launcherFeeRecipient,
      ),
    "Launcher claim was not executed by and paid to the reviewed revenue wallet",
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
      launcherFeeRecipient: getAddress(
        releasePlan.launcherFeeRecipient,
      ),
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
      checkedAt: sourceEvidence.checkedAt,
      infrastructurePlanDigest: releasePlan.planDigest,
      primaryProvider: "Etherscan",
      secondaryProvider: "Sourcify",
      exactMatchContractCount: 7,
      contracts: sourceEvidence.contracts,
    },
    lifecycleEvidence: {
      status: "verified-current-release",
      releaseEligible: true,
      checkedAt: lifecycle.verification.checkedAt,
      verifier: "scripts/serve-classic-v3-lifecycle-canary.mjs",
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
        launcherClaimEvent.args.amount.toString(),
      transactions: lifecycleTransactions(lifecycle),
      blocks: lifecycleBlocks(lifecycle),
    },
  };

  const production = appManifest.production;
  production.classicV3Status = "ready";
  for (const [field, appField] of Object.entries(
    appFieldByReleaseField,
  )) {
    production[appField] = addresses[field];
    production.runtimeCodeHashes[appField] =
      runtimeCodeHashes[field];
    production.deploymentTransactions[appField] =
      deploymentTransactions[field];
    production.deploymentBlocks[appField] =
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
        launcherFeeRecipient:
          updatedRelease.addresses.launcherFeeRecipient,
        canaryToken: lifecycle.token,
        sourceContractsVerified: 7,
        lifecycleTransactions:
          Object.keys(lifecycle.transactions).length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
