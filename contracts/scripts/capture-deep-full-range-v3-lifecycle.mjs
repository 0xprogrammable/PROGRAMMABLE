#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
} from "viem";

import {
  DEEP_V3_CONFIRMATIONS,
  DEEP_V3_CANARY_INITIAL_BUY_WEI,
  DEEP_V3_ORACLE_MATURITY_SECONDS,
  assertDeepV3CanaryLaunchCalldata,
  assertDeepV3ReleaseSourcesMatchCommit,
  assertDeepV3RpcUrls,
  buildDeepV3CanaryIdentity,
  canonicalDeepV3EvidenceHash,
  decodeOneDeepV3Event,
  deepV3AutomationAbi,
  deepV3CandidateEvent,
  deepV3CompoundEvent,
  deepV3ConfiguredEvent,
  deepV3InitialBuyEvent,
  deepV3KeeperExecutorAbi,
  deepV3LaunchEvent,
  deepV3LauncherAbi,
  deepV3OracleEvent,
  deepV3VaultAbi,
  deepV3WorkEvent,
  normalizeDeepV3Hex,
  readDeepV3Manifest,
  validDeepV3Commit,
  validDeepV3TransactionHash,
} from "../../scripts/deep-v3-mainnet-operator-core.mjs";
import {
  DEEP_V3_FIXED_POLICY,
  DEEP_V3_LIFECYCLE_EVIDENCE_PATH,
  DEEP_V3_MANIFEST_PATH,
  DEEP_V3_RUNTIME_FIELDS,
  assertDeepV3ArtifactRuntimeBinding,
} from "./deep-full-range-release-v3-core.mjs";
import { writeDeepV3LifecycleFiles } from "./deep-v3-lifecycle-write.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const write = process.argv.includes("--write");
const rpcUrls = [
  process.env.ETHEREUM_RPC_URL,
  process.env.ETHEREUM_RPC_URL_SECONDARY ??
    process.env.ETHEREUM_RPC_URL_B,
].filter(Boolean);
const account = process.env.DEEP_V3_CANARY_ACCOUNT;
const canaryNonce = Number(process.env.DEEP_V3_CANARY_NONCE);
const idleBlock = Number(process.env.DEEP_V3_CANARY_IDLE_BLOCK);
const transactionHashes = Object.freeze({
  launch: process.env.DEEP_V3_CANARY_LAUNCH_TRANSACTION,
  oracle: process.env.DEEP_V3_CANARY_ORACLE_TRANSACTION,
  compound: process.env.DEEP_V3_CANARY_COMPOUND_TRANSACTION,
});
const REQUEST_TIMEOUT_MS = 15_000;

function fail(message) {
  throw new Error(message);
}

function quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function number(value, label) {
  const parsed = Number(BigInt(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail(`${label} is outside the reviewed integer range`);
  }
  return parsed;
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    fail(`${method} returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    fail(`${method} failed: ${payload.error.message}`);
  }
  return payload?.result;
}

async function contractRead(
  url,
  address,
  abi,
  functionName,
  args,
  blockNumber,
) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpc(url, "eth_call", [
    { to: address, data },
    quantity(blockNumber),
  ]);
  return decodeFunctionResult({
    abi,
    functionName,
    data: result,
  });
}

async function transactionRecord(url, hash) {
  const [transaction, receipt] = await Promise.all([
    rpc(url, "eth_getTransactionByHash", [hash]),
    rpc(url, "eth_getTransactionReceipt", [hash]),
  ]);
  if (!transaction || !receipt) {
    fail(`Lifecycle transaction ${hash} is not mined`);
  }
  return { transaction, receipt };
}

function comparableRecord(record) {
  return {
    transaction: {
      hash: normalizeDeepV3Hex(record.transaction.hash),
      from: normalizeDeepV3Hex(record.transaction.from),
      to: record.transaction.to
        ? normalizeDeepV3Hex(record.transaction.to)
        : null,
      nonce: number(record.transaction.nonce, "transaction nonce"),
      value: BigInt(record.transaction.value).toString(),
      input: normalizeDeepV3Hex(record.transaction.input),
      blockNumber: number(
        record.transaction.blockNumber,
        "transaction block",
      ),
      blockHash: normalizeDeepV3Hex(record.transaction.blockHash),
    },
    receipt: {
      status: normalizeDeepV3Hex(record.receipt.status),
      transactionHash: normalizeDeepV3Hex(
        record.receipt.transactionHash,
      ),
      blockNumber: number(record.receipt.blockNumber, "receipt block"),
      blockHash: normalizeDeepV3Hex(record.receipt.blockHash),
      to: record.receipt.to
        ? normalizeDeepV3Hex(record.receipt.to)
        : null,
      from: normalizeDeepV3Hex(record.receipt.from),
      logs: record.receipt.logs.map((log) => ({
        address: normalizeDeepV3Hex(log.address),
        topics: log.topics.map(normalizeDeepV3Hex),
        data: normalizeDeepV3Hex(log.data),
        logIndex: number(log.logIndex, "log index"),
      })),
    },
  };
}

function assertRecordAgreement(left, right, label) {
  if (
    JSON.stringify(comparableRecord(left)) !==
    JSON.stringify(comparableRecord(right))
  ) {
    fail(`Independent RPCs disagree on the ${label} transaction`);
  }
  const record = comparableRecord(left);
  if (
    record.receipt.status !== "0x1" ||
    record.receipt.transactionHash !== record.transaction.hash ||
    record.receipt.blockNumber !== record.transaction.blockNumber ||
    record.receipt.blockHash !== record.transaction.blockHash
  ) {
    fail(`${label} is not one successful canonical transaction`);
  }
  return record;
}

function decodeEvents(receipt, address, event) {
  const decoded = [];
  for (const log of receipt.logs) {
    if (normalizeDeepV3Hex(log.address) !== normalizeDeepV3Hex(address)) {
      continue;
    }
    try {
      decoded.push({
        log,
        args: decodeEventLog({
          abi: [event],
          topics: log.topics,
          data: log.data,
          strict: true,
        }).args,
      });
    } catch {
      // A contract can emit unrelated event signatures in the same receipt.
    }
  }
  return decoded;
}

function sourceBinding(manifest) {
  if (
    manifest.sourceVerification?.status !== "verified" ||
    !DEEP_V3_RUNTIME_FIELDS.every((field) => {
      const record = manifest.sourceVerification.contracts?.[field];
      const address = manifest.addresses?.[field];
      return (
        record?.status === "etherscan-exact-sourcify-match" &&
        record.etherscan?.status === "exact-match" &&
        record.etherscan.url ===
          `https://etherscan.io/address/${address}#code` &&
        record.sourcify?.status === "match" &&
        record.sourcify.url ===
          `https://sourcify.dev/server/v2/contract/1/${address}`
      );
    })
  ) {
    fail("The Deep V3 source-provider binding is incomplete");
  }
  return {
    status: manifest.sourceVerification.status,
    commitment: manifest.sourceCommitment,
    recordsHash: canonicalDeepV3EvidenceHash(
      manifest.sourceVerification.contracts,
    ),
  };
}

async function assertRuntimes(manifest) {
  const result = [];
  for (const [rpcIndex, url] of rpcUrls.entries()) {
    const runtimes = {};
    for (const field of DEEP_V3_RUNTIME_FIELDS) {
      const code = await rpc(url, "eth_getCode", [
        manifest.addresses[field],
        "latest",
      ]);
      if (
        normalizeDeepV3Hex(code) === "0x" ||
        normalizeDeepV3Hex(keccak256(code)) !==
          normalizeDeepV3Hex(manifest.runtimeCodeHashes[field])
      ) {
        fail(`${field} runtime differs on RPC ${rpcIndex + 1}`);
      }
      assertDeepV3ArtifactRuntimeBinding(
        field,
        code,
        manifest,
        root,
      );
      runtimes[field] = manifest.runtimeCodeHashes[field];
    }
    result.push(runtimes);
  }
  if (JSON.stringify(result[0]) !== JSON.stringify(result[1])) {
    fail("Independent RPCs disagree on the Deep V3 runtime set");
  }
  return canonicalDeepV3EvidenceHash(result[0]);
}

async function block(url, blockNumber) {
  const value = await rpc(url, "eth_getBlockByNumber", [
    quantity(blockNumber),
    false,
  ]);
  if (!value) fail(`Block ${blockNumber} is unavailable`);
  return {
    number: number(value.number, "block number"),
    hash: normalizeDeepV3Hex(value.hash),
    timestamp: number(value.timestamp, "block timestamp"),
  };
}

async function vaultState(url, manifest, vault, blockNumber) {
  const [poolId, token, action, lockedLiquidity, nativeAdded, tokenAdded, liquidityAdded, pendingNative] =
    await Promise.all([
      contractRead(
        url,
        vault,
        deepV3VaultAbi,
        "poolId",
        [],
        blockNumber,
      ),
      contractRead(
        url,
        vault,
        deepV3VaultAbi,
        "token",
        [],
        blockNumber,
      ),
      contractRead(
        url,
        manifest.addresses.automation,
        deepV3AutomationAbi,
        "checkVault",
        [vault],
        blockNumber,
      ),
      contractRead(
        url,
        vault,
        deepV3VaultAbi,
        "lockedLiquidity",
        [],
        blockNumber,
      ),
      contractRead(
        url,
        vault,
        deepV3VaultAbi,
        "totalNativeAddedToLiquidity",
        [],
        blockNumber,
      ),
      contractRead(
        url,
        vault,
        deepV3VaultAbi,
        "totalTokenAddedToLiquidity",
        [],
        blockNumber,
      ),
      contractRead(
        url,
        vault,
        deepV3VaultAbi,
        "totalLiquidityAdded",
        [],
        blockNumber,
      ),
      contractRead(
        url,
        vault,
        deepV3VaultAbi,
        "pendingGrowthNative",
        [],
        blockNumber,
      ),
    ]);
  return {
    poolId,
    token: getAddress(token),
    action: Number(action),
    lockedLiquidity: BigInt(lockedLiquidity).toString(),
    totalNativeAddedToLiquidity: BigInt(nativeAdded).toString(),
    totalTokenAddedToLiquidity: BigInt(tokenAdded).toString(),
    totalLiquidityAdded: BigInt(liquidityAdded).toString(),
    pendingGrowthNative: BigInt(pendingNative).toString(),
  };
}

function assertSame(left, right, label) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail(`Independent RPCs disagree on ${label}`);
  }
}

function exactTransactionEvidence(record) {
  return {
    transactionHash: record.transaction.hash,
    blockNumber: record.receipt.blockNumber,
    blockHash: record.receipt.blockHash,
    from: getAddress(record.transaction.from),
    to: record.transaction.to
      ? getAddress(record.transaction.to)
      : null,
    nonce: record.transaction.nonce,
    valueWei: record.transaction.value,
    calldataHash: keccak256(record.transaction.input),
  };
}

async function main() {
  assertDeepV3RpcUrls(rpcUrls);
  if (
    !isAddress(account ?? "") ||
    !Number.isSafeInteger(canaryNonce) ||
    canaryNonce < 0
  ) {
    fail("Deep V3 canary account and fixed launch nonce are required");
  }
  if (
    !Number.isSafeInteger(idleBlock) ||
    idleBlock <= 0
  ) {
    fail("DEEP_V3_CANARY_IDLE_BLOCK is required");
  }
  if (
    !Object.values(transactionHashes).every(
      validDeepV3TransactionHash,
    ) ||
    new Set(
      Object.values(transactionHashes).map(normalizeDeepV3Hex),
    ).size !== 3
  ) {
    fail("Three distinct Deep V3 lifecycle transaction hashes are required");
  }

  const manifest = readDeepV3Manifest(root);
  if (
    manifest.status === "not-deployed" ||
    !validDeepV3Commit(manifest.releaseCommit) ||
    !Number.isSafeInteger(manifest.startBlock) ||
    manifest.startBlock <= 0 ||
    manifest.storageSafety?.status !==
      "verified-empty-eip1967-slots"
  ) {
    fail("Deep V3 deployment evidence is incomplete");
  }
  execFileSync(
    process.execPath,
    [
      path.join(
        root,
        "contracts/scripts/verify-deep-full-range-release-v3-manifest.mjs",
      ),
      "--offline",
    ],
    { cwd: root, stdio: "ignore" },
  );
  assertDeepV3ReleaseSourcesMatchCommit(root, manifest.releaseCommit);
  const sources = sourceBinding(manifest);
  const runtimeSetHash = await assertRuntimes(manifest);
  const identity = buildDeepV3CanaryIdentity({
    releaseCommit: manifest.releaseCommit,
    account,
    nonce: canaryNonce,
  });

  const observations = await Promise.all(
    rpcUrls.map(async (url) => ({
      head: number(await rpc(url, "eth_blockNumber"), "RPC head"),
      launch: await transactionRecord(url, transactionHashes.launch),
      oracle: await transactionRecord(url, transactionHashes.oracle),
      compound: await transactionRecord(url, transactionHashes.compound),
    })),
  );
  const launchRecord = assertRecordAgreement(
    observations[0].launch,
    observations[1].launch,
    "launch",
  );
  const oracleRecord = assertRecordAgreement(
    observations[0].oracle,
    observations[1].oracle,
    "oracle",
  );
  const compoundRecord = assertRecordAgreement(
    observations[0].compound,
    observations[1].compound,
    "compound",
  );
  const latestLifecycleBlock = Math.max(
    launchRecord.receipt.blockNumber,
    oracleRecord.receipt.blockNumber,
    compoundRecord.receipt.blockNumber,
  );
  if (
    observations.some(
      (observation) =>
        BigInt(observation.head) <
        BigInt(latestLifecycleBlock) + DEEP_V3_CONFIRMATIONS,
    )
  ) {
    fail("The Deep V3 lifecycle has fewer than 12 confirmations");
  }

  if (
    launchRecord.transaction.to !==
      normalizeDeepV3Hex(manifest.addresses.launcher) ||
    launchRecord.transaction.from !== normalizeDeepV3Hex(account) ||
    launchRecord.transaction.nonce !== canaryNonce ||
    BigInt(launchRecord.transaction.value) !==
      DEEP_V3_CANARY_INITIAL_BUY_WEI
  ) {
    fail("The canary launch transaction envelope is not exact");
  }
  const launchBlock = await Promise.all(
    rpcUrls.map((url) => block(url, launchRecord.receipt.blockNumber)),
  );
  assertSame(launchBlock[0], launchBlock[1], "the launch block");
  const minimumPriceLimits = await Promise.all(
    rpcUrls.map((url) =>
      contractRead(
        url,
        manifest.addresses.launcher,
        deepV3LauncherAbi,
        "MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96",
        [],
        launchRecord.receipt.blockNumber,
      ),
    ),
  );
  if (BigInt(minimumPriceLimits[0]) !== BigInt(minimumPriceLimits[1])) {
    fail("Independent RPCs disagree on the launch price limit");
  }
  const launchParameters = assertDeepV3CanaryLaunchCalldata({
    transaction: launchRecord.transaction,
    identity,
    minimumPriceLimit: minimumPriceLimits[0],
    blockTimestamp: launchBlock[0].timestamp,
  });
  const launchEvent = decodeOneDeepV3Event(
    observations[0].launch.receipt,
    manifest.addresses.launcher,
    deepV3LaunchEvent,
    "Deep V3 launch",
  );
  const configuredEvent = decodeOneDeepV3Event(
    observations[0].launch.receipt,
    manifest.addresses.launcher,
    deepV3ConfiguredEvent,
    "Deep V3 configuration",
  );
  const initialBuyEvent = decodeOneDeepV3Event(
    observations[0].launch.receipt,
    manifest.addresses.launcher,
    deepV3InitialBuyEvent,
    "Deep V3 initial buy",
  );
  const token = getAddress(launchEvent.token);
  const vault = getAddress(launchEvent.growthVault);
  const poolId = launchEvent.poolId;
  if (
    getAddress(launchEvent.deployer) !== getAddress(account) ||
    getAddress(launchEvent.feeHook) !==
      getAddress(manifest.addresses.feeHook) ||
    configuredEvent.token !== token ||
    configuredEvent.totalSupply.toString() !==
      DEEP_V3_FIXED_POLICY.tokenSupplyWei ||
    Number(configuredEvent.totalHookFeeBps) !==
      DEEP_V3_FIXED_POLICY.totalSwapFeeBps ||
    Number(configuredEvent.growthFeeBps) !==
      DEEP_V3_FIXED_POLICY.growthFeeBps ||
    Number(configuredEvent.programmableFeeBps) !==
      DEEP_V3_FIXED_POLICY.programmableFeeBps ||
    initialBuyEvent.token !== token ||
    initialBuyEvent.poolId !== poolId ||
    initialBuyEvent.nativeAmount !== DEEP_V3_CANARY_INITIAL_BUY_WEI ||
    initialBuyEvent.tokenAmount <
      launchParameters.minimumInitialTokenOut ||
    initialBuyEvent.sqrtPriceLimitX96 !==
      BigInt(minimumPriceLimits[0])
  ) {
    fail("The Deep V3 launch events are not policy-exact");
  }
  const launchBindings = await Promise.all(
    rpcUrls.map(async (url) => {
      const blockTag = launchRecord.receipt.blockNumber;
      const [recordedVault, recordedHash, vaultPool, vaultToken, registered] =
        await Promise.all([
          contractRead(
            url,
            manifest.addresses.launcher,
            deepV3LauncherAbi,
            "growthVaultOf",
            [token],
            blockTag,
          ),
          contractRead(
            url,
            manifest.addresses.launcher,
            deepV3LauncherAbi,
            "launchHashOf",
            [token],
            blockTag,
          ),
          contractRead(
            url,
            vault,
            deepV3VaultAbi,
            "poolId",
            [],
            blockTag,
          ),
          contractRead(
            url,
            vault,
            deepV3VaultAbi,
            "token",
            [],
            blockTag,
          ),
          contractRead(
            url,
            manifest.addresses.automation,
            deepV3AutomationAbi,
            "isRegisteredVault",
            [vault],
            blockTag,
          ),
        ]);
      return {
        vault: getAddress(recordedVault),
        launchHash: recordedHash,
        poolId: vaultPool,
        token: getAddress(vaultToken),
        registered,
      };
    }),
  );
  assertSame(launchBindings[0], launchBindings[1], "launch bindings");
  if (
    launchBindings[0].vault !== vault ||
    launchBindings[0].launchHash !== launchEvent.launchHash ||
    launchBindings[0].poolId !== poolId ||
    launchBindings[0].token !== token ||
    launchBindings[0].registered !== true
  ) {
    fail("The launch event is not bound to the deployed Deep V3 graph");
  }

  if (
    oracleRecord.transaction.to !==
      normalizeDeepV3Hex(manifest.addresses.automation) ||
    oracleRecord.transaction.from !== normalizeDeepV3Hex(account) ||
    BigInt(oracleRecord.transaction.value) !== 0n
  ) {
    fail("The oracle transaction envelope is not exact");
  }
  let oracleCall;
  try {
    oracleCall = decodeFunctionData({
      abi: deepV3AutomationAbi,
      data: oracleRecord.transaction.input,
    });
  } catch {
    fail("The oracle transaction calldata is invalid");
  }
  if (
    oracleCall.functionName !== "stageOracleBatch" ||
    oracleCall.args[0].length === 0 ||
    oracleCall.args[0].length > 12 ||
    oracleCall.args[0].some(
      (candidate) => getAddress(candidate) !== vault,
    )
  ) {
    fail("The oracle transaction is not one bounded canary batch");
  }
  const oracleEvents = decodeEvents(
    observations[0].oracle.receipt,
    manifest.addresses.automation,
    deepV3OracleEvent,
  );
  if (
    oracleEvents.length !== oracleCall.args[0].length ||
    oracleEvents.some(
      ({ args }) =>
        getAddress(args.vault) !== vault ||
        args.poolId !== poolId ||
        getAddress(args.executor) !==
          getAddress(manifest.addresses.automation),
    ) ||
    Number(oracleEvents.at(-1).args.newCardinalityNext) !== 192
  ) {
    fail("The oracle receipt does not prove growth to 192");
  }
  for (let index = 1; index < oracleEvents.length; index += 1) {
    if (
      oracleEvents[index - 1].args.newCardinalityNext !==
      oracleEvents[index].args.previousCardinalityNext
    ) {
      fail("The oracle growth sequence is discontinuous");
    }
  }
  const oracleBlocks = await Promise.all(
    rpcUrls.map((url) => block(url, oracleRecord.receipt.blockNumber)),
  );
  assertSame(oracleBlocks[0], oracleBlocks[1], "the oracle block");

  if (
    compoundRecord.transaction.to !==
      normalizeDeepV3Hex(manifest.addresses.keeperExecutor) ||
    BigInt(compoundRecord.transaction.value) !== 0n
  ) {
    fail("The compound transaction envelope is not exact");
  }
  let compoundCall;
  try {
    compoundCall = decodeFunctionData({
      abi: deepV3KeeperExecutorAbi,
      data: compoundRecord.transaction.input,
    });
  } catch {
    fail("The compound calldata is invalid");
  }
  if (
    compoundCall.functionName !== "execute" ||
    compoundCall.args[0].length !== 1 ||
    getAddress(compoundCall.args[0][0].vault) !== vault ||
    Number(compoundCall.args[0][0].expectedAction) !== 1
  ) {
    fail("The compound is not one exact keeper candidate");
  }
  const candidate = decodeOneDeepV3Event(
    observations[0].compound.receipt,
    manifest.addresses.keeperExecutor,
    deepV3CandidateEvent,
    "keeper candidate result",
  );
  const work = decodeOneDeepV3Event(
    observations[0].compound.receipt,
    manifest.addresses.automation,
    deepV3WorkEvent,
    "automation work",
  );
  const compound = decodeOneDeepV3Event(
    observations[0].compound.receipt,
    vault,
    deepV3CompoundEvent,
    "vault compound",
  );
  if (
    getAddress(candidate.vault) !== vault ||
    getAddress(candidate.executor) !==
      getAddress(compoundRecord.transaction.from) ||
    Number(candidate.expectedAction) !== 1 ||
    Number(candidate.actualAction) !== 1 ||
    Number(candidate.outcome) !== 4 ||
    candidate.errorSelector !== "0x00000000" ||
    getAddress(work.vault) !== vault ||
    Number(work.action) !== 1 ||
    getAddress(work.executor) !==
      getAddress(manifest.addresses.keeperExecutor) ||
    getAddress(compound.keeper) !==
      getAddress(manifest.addresses.automation) ||
    compound.poolId !== poolId ||
    compound.budgetNative <
      BigInt(DEEP_V3_FIXED_POLICY.minimumCompoundNativeWei) ||
    compound.swapNative <= 0n ||
    compound.tokenAcquired <= 0n ||
    compound.nativeAdded <= 0n ||
    compound.tokenAdded <= 0n ||
    compound.liquidityAdded <= 0n
  ) {
    fail("The keeper receipt is not one productive Deep V3 compound");
  }
  const compoundBlocks = await Promise.all(
    rpcUrls.map((url) => block(url, compoundRecord.receipt.blockNumber)),
  );
  assertSame(compoundBlocks[0], compoundBlocks[1], "the compound block");
  if (
    BigInt(compoundBlocks[0].timestamp) <
    BigInt(oracleBlocks[0].timestamp) +
      DEEP_V3_ORACLE_MATURITY_SECONDS
  ) {
    fail("The 30-minute Deep V3 oracle window was not mature");
  }

  if (
    idleBlock < launchRecord.receipt.blockNumber ||
    idleBlock >= compoundRecord.receipt.blockNumber
  ) {
    fail("The idle keeper observation block is outside the canary window");
  }
  const [idleStates, preCompoundStates, postCompoundStates] =
    await Promise.all([
      Promise.all(
        rpcUrls.map((url) =>
          vaultState(url, manifest, vault, idleBlock),
        ),
      ),
      Promise.all(
        rpcUrls.map((url) =>
          vaultState(
            url,
            manifest,
            vault,
            compoundRecord.receipt.blockNumber - 1,
          ),
        ),
      ),
      Promise.all(
        rpcUrls.map((url) =>
          vaultState(
            url,
            manifest,
            vault,
            compoundRecord.receipt.blockNumber,
          ),
        ),
      ),
    ]);
  assertSame(idleStates[0], idleStates[1], "the idle keeper cycle");
  assertSame(
    preCompoundStates[0],
    preCompoundStates[1],
    "the actionable keeper pre-state",
  );
  assertSame(
    postCompoundStates[0],
    postCompoundStates[1],
    "the compound post-state",
  );
  if (
    idleStates[0].action !== 0 ||
    preCompoundStates[0].action !== 1 ||
    postCompoundStates[0].poolId !== poolId ||
    postCompoundStates[0].token !== token
  ) {
    fail("The idle or actionable keeper decision is not reproducible");
  }
  const delta = {
    lockedLiquidity:
      BigInt(postCompoundStates[0].lockedLiquidity) -
      BigInt(preCompoundStates[0].lockedLiquidity),
    native:
      BigInt(postCompoundStates[0].totalNativeAddedToLiquidity) -
      BigInt(preCompoundStates[0].totalNativeAddedToLiquidity),
    token:
      BigInt(postCompoundStates[0].totalTokenAddedToLiquidity) -
      BigInt(preCompoundStates[0].totalTokenAddedToLiquidity),
    liquidity:
      BigInt(postCompoundStates[0].totalLiquidityAdded) -
      BigInt(preCompoundStates[0].totalLiquidityAdded),
  };
  if (
    delta.lockedLiquidity !== compound.liquidityAdded ||
    delta.native !== compound.nativeAdded ||
    delta.token !== compound.tokenAdded ||
    delta.liquidity !== compound.liquidityAdded
  ) {
    fail("The compound event does not match permanent same-pool state");
  }

  const idleCycle = {
    status: "verified-no-transaction",
    outcome: "idle",
    readyVaults: 0,
    submittedTransaction: false,
    observedAtBlock: idleBlock,
    successfulCandidates: 0,
    transactionHash: null,
    blockNumber: null,
    state: idleStates[0],
  };
  const actionableCycle = {
    status: "verified-compound-confirmed",
    outcome: "confirmed-productive",
    readyVaults: 1,
    submittedTransaction: true,
    observedAtBlock: compoundRecord.receipt.blockNumber - 1,
    successfulCandidates: 1,
    transactionHash: compoundRecord.transaction.hash,
    blockNumber: compoundRecord.receipt.blockNumber,
    preState: preCompoundStates[0],
    postState: postCompoundStates[0],
  };
  const idleEvidenceHash = canonicalDeepV3EvidenceHash(idleCycle);
  const actionableEvidenceHash =
    canonicalDeepV3EvidenceHash(actionableCycle);
  const evidence = {
    schemaVersion: 1,
    releaseVersion: "deep-full-range-v3",
    releaseCommit: manifest.releaseCommit,
    sourceCommitment: manifest.sourceCommitment,
    chainId: 1,
    account: getAddress(account),
    launcher: getAddress(manifest.addresses.launcher),
    automation: getAddress(manifest.addresses.automation),
    feeHook: getAddress(manifest.addresses.feeHook),
    keeperExecutor: getAddress(manifest.addresses.keeperExecutor),
    canaryToken: token,
    canaryVault: vault,
    poolId,
    releaseBinding: {
      manifestPath: DEEP_V3_MANIFEST_PATH,
      deploymentTransactionsHash: canonicalDeepV3EvidenceHash(
        manifest.transactions,
      ),
      runtimeSetHash,
      source: sources,
    },
    launch: {
      ...exactTransactionEvidence(launchRecord),
      launchHash: launchEvent.launchHash,
      minimumInitialTokenOut:
        launchParameters.minimumInitialTokenOut.toString(),
      initialBuyTokenAmount: initialBuyEvent.tokenAmount.toString(),
      fixedPolicyHash: canonicalDeepV3EvidenceHash(
        DEEP_V3_FIXED_POLICY,
      ),
    },
    oracle: {
      ...exactTransactionEvidence(oracleRecord),
      firstCardinalityNext: Number(
        oracleEvents[0].args.previousCardinalityNext,
      ),
      finalCardinalityNext: Number(
        oracleEvents.at(-1).args.newCardinalityNext,
      ),
      growthCalls: oracleEvents.length,
      maturitySeconds:
        compoundBlocks[0].timestamp - oracleBlocks[0].timestamp,
    },
    compound: {
      ...exactTransactionEvidence(compoundRecord),
      budgetNative: compound.budgetNative.toString(),
      swapNative: compound.swapNative.toString(),
      tokenAcquired: compound.tokenAcquired.toString(),
      nativeAdded: compound.nativeAdded.toString(),
      tokenAdded: compound.tokenAdded.toString(),
      liquidityAdded: compound.liquidityAdded.toString(),
      samePoolStateDelta: {
        lockedLiquidity: delta.lockedLiquidity.toString(),
        native: delta.native.toString(),
        token: delta.token.toString(),
        liquidity: delta.liquidity.toString(),
      },
    },
    keeperCycles: {
      idle: {
        ...idleCycle,
        evidenceHash: idleEvidenceHash,
      },
      actionable: {
        ...actionableCycle,
        evidenceHash: actionableEvidenceHash,
      },
    },
    rpcEvidence: {
      independentRpcCount: 2,
      minimumConfirmations: Number(DEEP_V3_CONFIRMATIONS),
      heads: observations.map((observation, index) => ({
        rpc: index === 0 ? "A" : "B",
        blockNumber: observation.head,
      })),
    },
  };
  const evidenceOutput = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidenceHash = keccak256(
    `0x${Buffer.from(evidenceOutput).toString("hex")}`,
  );
  const updatedManifest = structuredClone(manifest);
  updatedManifest.lifecycleEvidence = {
    status: "verified-current-release",
    releaseEligible: true,
    requiredRelease: "deep-full-range-v3",
    evidencePath: DEEP_V3_LIFECYCLE_EVIDENCE_PATH,
    independentRpcCount: 2,
    canaryToken: token,
    canaryVault: vault,
    poolId,
    launchTransaction: launchRecord.transaction.hash,
    oracleTransaction: oracleRecord.transaction.hash,
    compoundTransaction: compoundRecord.transaction.hash,
    evidenceHash,
    noActionKeeperCycle: {
      status: idleCycle.status,
      outcome: idleCycle.outcome,
      readyVaults: 0,
      submittedTransaction: false,
      observedAtBlock: idleBlock,
      successfulCandidates: 0,
      transactionHash: null,
      blockNumber: null,
      evidenceHash: idleEvidenceHash,
    },
    actionableKeeperCycle: {
      status: actionableCycle.status,
      outcome: actionableCycle.outcome,
      readyVaults: 1,
      submittedTransaction: true,
      observedAtBlock: actionableCycle.observedAtBlock,
      successfulCandidates: 1,
      transactionHash: compoundRecord.transaction.hash,
      blockNumber: compoundRecord.receipt.blockNumber,
      evidenceHash: actionableEvidenceHash,
    },
  };
  updatedManifest.blockers = (updatedManifest.blockers ?? []).filter(
    (blocker) =>
      !String(blocker).includes("canary launch, oracle") &&
      !String(blocker).includes("atomic compound evidence"),
  );
  const manifestOutput = `${JSON.stringify(updatedManifest, null, 2)}\n`;
  if (!write) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          write: false,
          evidencePath: DEEP_V3_LIFECYCLE_EVIDENCE_PATH,
          evidenceHash,
          evidence,
          lifecycleManifestPatch: updatedManifest.lifecycleEvidence,
        },
        null,
        2,
      ),
    );
    console.error(
      "Dry run only. Re-run with an explicit --write after reviewing all lifecycle evidence.",
    );
    return;
  }
  const evidencePath = path.join(
    root,
    DEEP_V3_LIFECYCLE_EVIDENCE_PATH,
  );
  const manifestPath = path.join(root, DEEP_V3_MANIFEST_PATH);
  await writeDeepV3LifecycleFiles({
    evidencePath,
    manifestPath,
    evidenceOutput,
    manifestOutput,
  });
  console.log(`Wrote ${DEEP_V3_LIFECYCLE_EVIDENCE_PATH}`);
  console.log(`Updated ${DEEP_V3_MANIFEST_PATH}`);
  console.log(`Lifecycle evidence hash: ${evidenceHash}`);
}

main().catch((error) => {
  console.error(`Deep V3 lifecycle capture failed: ${error.message}`);
  process.exitCode = 1;
});
