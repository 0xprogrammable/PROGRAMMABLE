#!/usr/bin/env node

import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
} from "viem";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_FINALITY_CONFIRMATIONS,
  CLASSIC_V4_LIFECYCLE_ACTIONS,
  CLASSIC_V4_NEW_CONTRACTS,
  buildClassicV4LifecycleCanaryPlan,
  canonicalAddress,
  canonicalNonzeroAddress,
  digestJson,
  normalizeHex,
  validateClassicV4DeploymentEvidence,
  validateClassicV4LifecycleEvidence,
  validateClassicV4PreparationPlan,
  validateClassicV4SourceEvidence,
} from "../../scripts/classic-v4-release-core.mjs";
import { loadClassicV4SealedBuild } from "./prepare-classic-v4-mainnet-release.mjs";
import { verifyClassicV4ReleasePrerequisites } from "./verify-classic-v4-release-prerequisites.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const REQUEST_TIMEOUT_MS = 15_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"00".repeat(32)}`;
const UINT256_MAX = (1n << 256n) - 1n;
const TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;

const universalRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
const launcherReadAbi = parseAbi([
  "function launchHashOf(address token) view returns (bytes32)",
  "function rewardVaultOf(address token) view returns (address)",
  "function initialBuyCustodyOf(address token) view returns (address)",
  "function poolKey(address token) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
  "function predictTokenAddress(string name,string symbol,address deployer,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
]);
const hookReadAbi = parseAbi([
  "function poolFeeConfig(bytes32 poolId) view returns (address rewardVault,address registrar,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bool registered,uint256 creatorFeesAccrued)",
  "function feeDisclosure(bytes32 poolId) view returns (uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips,address rewardVault)",
  "function launcherFeesAccrued() view returns (uint256)",
  "function totalNativeFeesAccrued() view returns (uint256)",
  "function claimLauncherFees() returns (uint256)",
  "function claimLauncherFeesTo(address recipient) returns (uint256)",
]);
const rewardVaultAbi = parseAbi([
  "function claim() returns (uint256)",
  "function feeHook() view returns (address)",
  "function poolManager() view returns (address)",
  "function ctoAuthority() view returns (address)",
  "function poolId() view returns (bytes32)",
  "function configurationHash() view returns (bytes32)",
  "function configurationEpoch() view returns (uint64)",
  "function activeConfigurationHash() view returns (bytes32)",
  "function beneficiaryCount() view returns (uint256)",
  "function beneficiaryAt(uint256 index) view returns (address)",
  "function shareBpsAt(uint256 index) view returns (uint16)",
  "function totalCreatorFeesReceived() view returns (uint256)",
  "function totalCreatorFeesClaimed() view returns (uint256)",
  "function claimedBy(address beneficiary) view returns (uint256)",
  "function claimable(address beneficiary) view returns (uint256)",
  "event CreatorFeesCheckpointed(bytes32 indexed poolId,uint64 indexed configurationEpoch,uint256 amount,uint256 totalCreatorFeesReceived)",
  "event BeneficiaryFeesClaimed(address indexed beneficiary,uint256 amount,uint256 beneficiaryTotalClaimed,uint256 vaultTotalReceived)",
]);
const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function graffiti() view returns (bytes32)",
  "function metadata() view returns (string description,string website,string image,bytes extraData)",
  "function creator() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
]);
const positionManagerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,uint256 info)",
  "function isApprovedForAll(address owner,address operator) view returns (bool)",
]);
const forwarderFactoryAbi = parseAbi([
  "function configurationHashOf(address forwarder) view returns (bytes32)",
  "event LockedPositionFeeForwarderDeployed(address indexed forwarder,address indexed feeRecipient,bytes32 indexed salt,bytes32 configurationHash,address positionManager)",
]);
const forwarderAbi = parseAbi([
  "function positionManager() view returns (address)",
  "function operator() view returns (address)",
  "function timelockBlockNumber() view returns (uint256)",
  "function feeRecipient() view returns (address)",
]);
const rewardVaultFactoryAbi = parseAbi([
  "function configurationHashOf(address vault) view returns (bytes32)",
  "event ClassicRewardVaultDeployed(address indexed vault,bytes32 indexed poolId,address indexed feeHook,bytes32 salt,bytes32 configurationHash)",
]);
const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
const erc6909Abi = parseAbi([
  "function balanceOf(address owner,uint256 id) view returns (uint256)",
]);
const permit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
]);
const poolManagerEventAbi = parseAbi([
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
]);
const v4QuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
  "function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountIn,uint256 gasEstimate)",
]);

const poolKeyType = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
};
const singleSwapFields = [
  { name: "poolKey", ...poolKeyType },
  { name: "zeroForOne", type: "bool" },
];
const exactInputSingleType = {
  type: "tuple",
  components: [
    ...singleSwapFields,
    { name: "amountIn", type: "uint128" },
    { name: "amountOutMinimum", type: "uint128" },
    { name: "hookData", type: "bytes" },
  ],
};
const exactOutputSingleType = {
  type: "tuple",
  components: [
    ...singleSwapFields,
    { name: "amountOut", type: "uint128" },
    { name: "amountInMaximum", type: "uint128" },
    { name: "hookData", type: "bytes" },
  ],
};

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseArguments(argv) {
  const forbidden = argv.find((argument) => {
    const value = argument.toLowerCase();
    return ["--broadcast", "--send", "--sign", "--private-key", "--mnemonic"].some(
      (flag) => value === flag || value.startsWith(`${flag}=`),
    );
  });
  if (forbidden) {
    fail(
      `${forbidden.split("=", 1)[0]} is forbidden; verifier never signs or broadcasts`,
    );
  }
  const result = {
    plan: null,
    deploymentEvidence: null,
    sourceEvidence: null,
    canaryPlan: null,
    transactions: null,
    verificationBlock: null,
    rpcA: null,
    rpcB: null,
    write: false,
    output: null,
    wallet: null,
    acknowledgement: null,
  };
  const flags = {
    "--plan": "plan",
    "--deployment-evidence": "deploymentEvidence",
    "--source-evidence": "sourceEvidence",
    "--canary-plan": "canaryPlan",
    "--transactions": "transactions",
    "--rpc-a": "rpcA",
    "--rpc-b": "rpcB",
    "--output": "output",
    "--wallet": "wallet",
    "--acknowledge-evidence-digest": "acknowledgement",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      result.write = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inline = separator === -1 ? null : argument.slice(separator + 1);
    if (key === "--verification-block") {
      const value = inline ?? argv[++index];
      result.verificationBlock = Number(value);
      continue;
    }
    if (!flags[key]) fail("Unknown argument");
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    result[flags[key]] = value;
  }
  for (const [field, flag] of [
    ["plan", "--plan"],
    ["deploymentEvidence", "--deployment-evidence"],
    ["sourceEvidence", "--source-evidence"],
    ["canaryPlan", "--canary-plan"],
    ["transactions", "--transactions"],
  ]) {
    if (!result[field] || !path.isAbsolute(result[field])) {
      fail(`${flag} must be an absolute path`);
    }
  }
  if (
    !Number.isSafeInteger(result.verificationBlock) ||
    result.verificationBlock <= 0
  ) {
    fail("--verification-block must be a positive integer");
  }
  if (!result.rpcA || !result.rpcB) fail("--rpc-a and --rpc-b are required");
  return result;
}

function assertEndpoints(endpoints) {
  const hosts = new Set();
  for (const endpoint of endpoints) {
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch {
      fail("Invalid RPC URL");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      fail("RPC URLs must be credential-free HTTPS URLs");
    }
    hosts.add(parsed.hostname.toLowerCase());
  }
  if (hosts.size !== 2) fail("Two independent RPC hostnames are required");
}

async function rpc(endpoint, method, params = []) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    fail(`RPC ${method} request failed`);
  }
  if (!response.ok) fail(`RPC ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error || payload?.result === undefined) fail(`RPC ${method} failed`);
  return payload.result;
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

function sameHex(actual, expected, label) {
  assert(
    typeof actual === "string" &&
      typeof expected === "string" &&
      normalizeHex(actual) === normalizeHex(expected),
    `${label} differs`,
  );
}

function sameAddress(actual, expected, label) {
  sameHex(canonicalAddress(actual, label), canonicalAddress(expected, label), label);
}

function nonzeroHash(value, label) {
  assert(
    typeof value === "string" &&
      /^0x[0-9a-f]{64}$/i.test(value) &&
      normalizeHex(value) !== ZERO_HASH,
    `Invalid ${label}`,
  );
  return value.toLowerCase();
}

function hexInteger(value, label) {
  assert(typeof value === "string" && /^0x[0-9a-f]+$/i.test(value), label);
  const parsed = BigInt(value);
  assert(parsed <= BigInt(Number.MAX_SAFE_INTEGER), `${label} is too large`);
  return Number(parsed);
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  assert(
    actual.length === wanted.length &&
      actual.every((key, index) => key === wanted[index]),
    `${label} keys differ`,
  );
}

function validateTransactionHashes(value) {
  exactKeys(value, CLASSIC_V4_LIFECYCLE_ACTIONS, "Lifecycle transactions");
  const entries = CLASSIC_V4_LIFECYCLE_ACTIONS.map((action) => [
    action,
    nonzeroHash(value[action], `${action} transaction hash`),
  ]);
  assert(
    new Set(entries.map(([, hash]) => hash)).size === entries.length,
    "Lifecycle transaction hashes must be unique",
  );
  return Object.fromEntries(entries);
}

function releaseCandidate(plan, deploymentEvidence, sourceEvidence) {
  return {
    internalContractRelease: "classic-v4",
    chainId: 1,
    releaseCommit: plan.releaseCommit,
    sourceCommitment: plan.sourceCommitment,
    releaseBindingDigest: digestJson(
      {
        planDigest: plan.planDigest,
        deploymentEvidence,
        sourceEvidence,
      },
      CLASSIC_V4_DIGEST_DOMAINS.releaseBinding,
    ),
    addresses: {
      deployer: plan.deployer,
      launcherFeeRecipient: plan.launcherFeeRecipient,
      ...Object.fromEntries(
        Object.entries(plan.sharedDependencies).map(([name, value]) => [
          name,
          value.address,
        ]),
      ),
      ...plan.predictedAddresses,
    },
    officialDependencies: plan.officialDependencies,
    verification: {
      deploymentLive: true,
      runtimeCodeVerified: true,
      constructorBindingsVerified: true,
      sourceVerified: true,
    },
  };
}

function reconstructCanary(plan, deploymentEvidence, sourceEvidence, supplied) {
  const expected = buildClassicV4LifecycleCanaryPlan(
    releaseCandidate(plan, deploymentEvidence, sourceEvidence),
    supplied?.operatorWallet,
  );
  sameHex(supplied?.planDigest, expected.planDigest, "Canary plan digest");
  assert(
    digestJson(supplied, CLASSIC_V4_DIGEST_DOMAINS.lifecycleCanaryPlan) ===
      digestJson(expected, CLASSIC_V4_DIGEST_DOMAINS.lifecycleCanaryPlan),
    "Canary plan differs from the reconstructed release-bound plan",
  );
  return expected;
}

async function readContract(endpoint, blockTag, address, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpc(endpoint, "eth_call", [{ to: address, data }, blockTag]);
  return decodeFunctionResult({ abi, functionName, data: result });
}

function decodeEvents(receipt, abi, address) {
  return receipt.logs.flatMap((log) => {
    if (normalizeHex(log.address) !== normalizeHex(address)) return [];
    try {
      return [
        {
          ...decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true }),
          logIndex: hexInteger(log.logIndex, "Invalid log index"),
          transactionHash: nonzeroHash(
            log.transactionHash,
            "event transaction hash",
          ),
          blockHash: nonzeroHash(log.blockHash, "event block hash"),
          blockNumber: hexInteger(log.blockNumber, "Invalid event block number"),
          transactionIndex: hexInteger(
            log.transactionIndex,
            "Invalid event transaction index",
          ),
        },
      ];
    } catch {
      return [];
    }
  });
}

function oneEvent(events, name, label, predicate = () => true) {
  const matches = events.filter(
    (event) => event.eventName === name && predicate(event.args),
  );
  assert(matches.length === 1, `Expected exactly one ${label}`);
  return matches[0];
}

function poolIdFor(poolKey) {
  return keccak256(encodeAbiParameters([poolKeyType], [poolKey]));
}

function isBefore(left, right) {
  return (
    left.blockNumber < right.blockNumber ||
    (left.blockNumber === right.blockNumber &&
      left.transactionIndex < right.transactionIndex)
  );
}

export async function loadClassicV4BlockAtExactNumber(
  endpoint,
  blockNumber,
  label,
  rpcClient = rpc,
) {
  const block = await rpcClient(endpoint, "eth_getBlockByNumber", [
    blockTag(blockNumber),
    false,
  ]);
  assert(block, `${label} block is unavailable`);
  assert(
    hexInteger(block.number, `${label} block number`) === blockNumber,
    `${label} block number differs from the requested tag`,
  );
  return block;
}

async function readTransactions(
  endpoint,
  hashes,
  verificationBlock,
  canary,
  deploymentEvidence,
) {
  const signers = Object.fromEntries(
    canary.actions.map((action) => [action.key, action.requiredSigner]),
  );
  exactKeys(signers, CLASSIC_V4_LIFECYCLE_ACTIONS, "Canary action signers");
  const latestDeploymentBlock = Math.max(
    ...CLASSIC_V4_NEW_CONTRACTS.map(
      (name) => deploymentEvidence.contracts[name].blockNumber,
    ),
  );
  const records = {};
  for (const action of CLASSIC_V4_LIFECYCLE_ACTIONS) {
    const hash = hashes[action];
    const [transaction, receipt] = await Promise.all([
      rpc(endpoint, "eth_getTransactionByHash", [hash]),
      rpc(endpoint, "eth_getTransactionReceipt", [hash]),
    ]);
    assert(transaction && receipt, `${action} transaction is unavailable`);
    const blockNumber = hexInteger(receipt.blockNumber, `${action} block number`);
    const transactionIndex = hexInteger(
      receipt.transactionIndex,
      `${action} transaction index`,
    );
    const block = await loadClassicV4BlockAtExactNumber(
      endpoint,
      blockNumber,
      `${action} canonical`,
    );
    const confirmations = verificationBlock - blockNumber + 1;
    assert(
      blockNumber > latestDeploymentBlock && blockNumber <= verificationBlock,
      `${action} is outside the release lifecycle window`,
    );
    assert(
      confirmations >= CLASSIC_V4_FINALITY_CONFIRMATIONS,
      `${action} is not final at the verification block`,
    );
    sameHex(transaction.hash, hash, `${action} transaction hash`);
    sameHex(receipt.transactionHash, hash, `${action} receipt hash`);
    sameHex(transaction.blockHash, receipt.blockHash, `${action} transaction block`);
    sameHex(receipt.blockHash, block.hash, `${action} canonical block`);
    assert(
      hexInteger(transaction.blockNumber, `${action} transaction block`) ===
        blockNumber &&
        hexInteger(transaction.transactionIndex, `${action} transaction index`) ===
          transactionIndex &&
        normalizeHex(receipt.status) === "0x1",
      `${action} transaction inclusion or status differs`,
    );
    assert(
      typeof transaction.input === "string" && /^0x[0-9a-f]+$/i.test(transaction.input),
      `${action} transaction input is missing`,
    );
    for (const log of receipt.logs) {
      sameHex(log.blockHash, receipt.blockHash, `${action} log block hash`);
      sameHex(log.blockNumber, receipt.blockNumber, `${action} log block number`);
      sameHex(log.transactionHash, hash, `${action} log transaction hash`);
      sameHex(
        log.transactionIndex,
        receipt.transactionIndex,
        `${action} log transaction index`,
      );
    }
    sameAddress(transaction.from, signers[action], `${action} signer`);
    sameAddress(receipt.from, signers[action], `${action} receipt signer`);
    assert(transaction.to && receipt.to, `${action} destination is missing`);
    sameAddress(transaction.to, receipt.to, `${action} receipt destination`);
    const destination =
      action === "launch"
        ? canary.launcher
        : action.startsWith("buy") || action.startsWith("sell")
          ? canary.dependencies.universalRouter
          : action === "launcherClaim"
            ? canary.feeHook
            : null;
    if (destination) sameAddress(transaction.to, destination, `${action} destination`);
    records[action] = {
      transaction,
      receipt,
      blockTimestamp: BigInt(block.timestamp),
      blockParentHash: nonzeroHash(block.parentHash, `${action} parent block hash`),
      anchor: {
        transactionHash: hash,
        inputHash: keccak256(transaction.input),
        blockNumber,
        blockHash: receipt.blockHash.toLowerCase(),
        blockTimestamp: BigInt(block.timestamp).toString(),
        transactionIndex,
        nonce: hexInteger(transaction.nonce, `${action} nonce`),
        from: canonicalAddress(transaction.from),
        to: canonicalAddress(transaction.to),
        value: BigInt(transaction.value).toString(),
        confirmations,
        success: true,
        events: {},
      },
    };
  }
  for (let index = 1; index < CLASSIC_V4_LIFECYCLE_ACTIONS.length; index += 1) {
    assert(
      isBefore(
        records[CLASSIC_V4_LIFECYCLE_ACTIONS[index - 1]].anchor,
        records[CLASSIC_V4_LIFECYCLE_ACTIONS[index]].anchor,
      ),
      "Lifecycle transactions are not in canonical action order",
    );
    assert(
      records[CLASSIC_V4_LIFECYCLE_ACTIONS[index - 1]].anchor.blockNumber <
        records[CLASSIC_V4_LIFECYCLE_ACTIONS[index]].anchor.blockNumber,
      "Lifecycle actions must use distinct increasing blocks for historical readbacks",
    );
  }
  return records;
}

function validateAccrual(args, expected, label) {
  sameHex(args.poolId, expected.poolId, `${label} fee pool`);
  sameAddress(args.swapSender, expected.sender, `${label} fee sender`);
  assert(args.isBuy === (expected.side === "buy"), `${label} direction differs`);
  assert(
    Number(args.appliedTotalSwapFeeBps) === expected.feeBps &&
      args.grossNativeAmount > 0n &&
      args.creatorFee + args.launcherFee > 0n,
    `${label} fee accrual differs`,
  );
}

function validateHookFee(hookFee, hookSwap, accrual, sender, poolId, label) {
  const total = accrual.creatorFee + accrual.launcherFee;
  sameHex(hookFee.poolId, poolId, `${label} HookFee pool`);
  sameAddress(hookFee.sender, sender, `${label} HookFee sender`);
  assert(
    hookFee.feeAmount0 === total && hookFee.feeAmount1 === 0n,
    `${label} HookFee amount differs`,
  );
  sameHex(hookSwap.id, poolId, `${label} HookSwap pool`);
  sameAddress(hookSwap.sender, sender, `${label} HookSwap sender`);
  assert(
    hookSwap.amount0 === -total &&
      hookSwap.amount1 === 0n &&
      Number(hookSwap.swapFee) === Number(accrual.appliedTotalSwapFeeBps) * 100,
    `${label} HookSwap accounting differs`,
  );
}

function expectedFeeSplit(nativeAmount, feeBps, amountIsNet) {
  const bps = BigInt(feeBps);
  const grossNativeAmount = amountIsNet
    ? (nativeAmount * 10_000n + (10_000n - bps) - 1n) / (10_000n - bps)
    : nativeAmount;
  const totalFee = amountIsNet
    ? grossNativeAmount - nativeAmount
    : (grossNativeAmount * bps) / 10_000n;
  let launcherFee = (grossNativeAmount * 10n) / 10_000n;
  if (feeBps === 10 || launcherFee > totalFee) launcherFee = totalFee;
  return {
    grossNativeAmount,
    creatorFee: totalFee - launcherFee,
    launcherFee,
    totalFee,
  };
}

function assertExactFeeSplit(accrual, nativeAmount, feeBps, amountIsNet, label) {
  const expected = expectedFeeSplit(nativeAmount, feeBps, amountIsNet);
  assert(
    accrual.grossNativeAmount === expected.grossNativeAmount &&
      accrual.creatorFee === expected.creatorFee &&
      accrual.launcherFee === expected.launcherFee,
    `${label} exact fee split differs`,
  );
  return expected;
}

function assertOnlyUrc2HookSwap(events, label) {
  assert(
    events.filter(
      (event) =>
        event.eventName === "HookSwap" && !Object.hasOwn(event.args, "swapFee"),
    ).length === 0,
    `${label} emitted an inherited HookSwap event`,
  );
}

function validateLaunch(action, canary, artifacts, plan) {
  assert(
    BigInt(action.transaction.value) === BigInt(canary.launchFixture.initialBuyWei),
    "Launch initial buy differs from the canary plan",
  );
  const call = decodeFunctionData({
    abi: artifacts.launcher.abi,
    data: action.transaction.input,
  });
  assert(call.functionName === "launch", "Launch selector differs");
  const input = call.args[0];
  assert(
    input.name === canary.launchFixture.name &&
      input.symbol === canary.launchFixture.symbol &&
      normalizeHex(input.creatorSalt) ===
        normalizeHex(canary.launchFixture.creatorSalt) &&
      input.metadata.description === canary.launchFixture.metadata.description &&
      input.metadata.website === canary.launchFixture.metadata.website &&
      input.metadata.image === canary.launchFixture.metadata.image &&
      normalizeHex(input.metadata.extraData) ===
        normalizeHex(canary.launchFixture.metadata.extraData),
    "Launch identity or metadata differs from the canary plan",
  );
  assert(
    Number(input.liquidityPreset) === 1 &&
      Number(input.buySwapFeeBps) === 100 &&
      Number(input.sellSwapFeeBps) === 200,
    "Launch Deep30 or directional fees differ",
  );
  assert(
    input.rewardBeneficiaries.length === 1 &&
      input.rewardSharesBps.length === 1 &&
      Number(input.rewardSharesBps[0]) === 10_000,
    "Canary reward allocation differs",
  );
  sameAddress(input.rewardBeneficiaries[0], canary.operatorWallet, "Beneficiary");
  assert(
    Number(input.initialBuyCustody.mode) === 0 &&
      Number(input.initialBuyCustody.durationDays) === 0 &&
      Number(input.initialBuyCustody.cliffDays) === 0,
    "Initial buy custody is not unlocked",
  );

  const launcherEvents = decodeEvents(action.receipt, artifacts.launcher.abi, canary.launcher);
  const launched = oneEvent(
    launcherEvents,
    "MemeTokenLaunchedV2",
    "MemeTokenLaunchedV2 event",
  );
  const liquidity = oneEvent(
    launcherEvents,
    "MemeLiquidityConfiguredV2",
    "MemeLiquidityConfiguredV2 event",
  );
  const initialBuy = oneEvent(
    launcherEvents,
    "MemeCreatorInitialBuyV2",
    "MemeCreatorInitialBuyV2 event",
  );
  const custody = oneEvent(
    launcherEvents,
    "MemeCreatorInitialBuyCustodyV2",
    "MemeCreatorInitialBuyCustodyV2 event",
  );
  sameAddress(launched.args.deployer, canary.operatorWallet, "Launch deployer");
  const token = canonicalNonzeroAddress(launched.args.token, "canary token");
  const rewardVault = canonicalNonzeroAddress(launched.args.rewardVault, "reward vault");
  const positionRecipient = canonicalNonzeroAddress(
    launched.args.positionRecipient,
    "position recipient",
  );
  const poolId = nonzeroHash(launched.args.poolId, "canary pool id");
  const launchHash = nonzeroHash(launched.args.launchHash, "launch hash");
  const rewardConfigurationHash = nonzeroHash(
    launched.args.rewardConfigurationHash,
    "reward configuration hash",
  );
  assert(launched.args.positionTokenId > 0n, "Position token ID is zero");
  sameAddress(launched.args.feeHook, canary.feeHook, "Launch hook");
  assert(
    Number(launched.args.buySwapFeeBps) === 100 &&
      Number(launched.args.sellSwapFeeBps) === 200,
    "Launch event fees differ",
  );
  const poolKey = {
    currency0: ZERO_ADDRESS,
    currency1: token,
    fee: 0,
    tickSpacing: 200,
    hooks: canary.feeHook,
  };
  sameHex(poolIdFor(poolKey), poolId, "Computed pool ID");
  sameAddress(liquidity.args.token, token, "Liquidity token");
  assert(
    liquidity.args.totalSupply === TOKEN_SUPPLY &&
      liquidity.args.tokenLiquidityAmount > 0n &&
      liquidity.args.tokenLiquidityAmount + liquidity.args.lockedTokenDust ===
        TOKEN_SUPPLY &&
      Number(liquidity.args.initialTick) === 204_200 &&
      Number(liquidity.args.tickLower) === 174_800 &&
      Number(liquidity.args.tickUpper) === 204_200 &&
      Number(liquidity.args.lpFeePips) === 0,
    "Deep30 liquidity evidence differs",
  );
  sameHex(liquidity.args.launchHash, launchHash, "Liquidity launch hash");
  sameAddress(initialBuy.args.deployer, canary.operatorWallet, "Initial buy deployer");
  sameAddress(initialBuy.args.token, token, "Initial buy token");
  sameHex(initialBuy.args.poolId, poolId, "Initial buy pool");
  assert(
    initialBuy.args.nativeAmount === BigInt(canary.launchFixture.initialBuyWei) &&
      initialBuy.args.tokenAmount > 0n,
    "Initial buy amounts differ",
  );
  sameHex(initialBuy.args.launchHash, launchHash, "Initial buy launch hash");
  sameAddress(custody.args.deployer, canary.operatorWallet, "Custody deployer");
  sameAddress(custody.args.token, token, "Custody token");
  sameAddress(custody.args.custody, ZERO_ADDRESS, "Custody address");
  assert(
    Number(custody.args.mode) === 0 &&
      Number(custody.args.durationDays) === 0 &&
      Number(custody.args.cliffDays) === 0,
    "Custody event differs",
  );
  sameHex(custody.args.launchHash, launchHash, "Custody launch hash");
  const expectedCustodyHash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint8" },
        { type: "uint16" },
        { type: "uint16" },
      ],
      [
        1n,
        canary.launcher,
        token,
        canary.operatorWallet,
        0,
        0,
        0,
      ],
    ),
  );
  sameHex(
    custody.args.configurationHash,
    expectedCustodyHash,
    "Unlocked custody configuration hash",
  );

  const hookEvents = decodeEvents(action.receipt, artifacts.feeHook.abi, canary.feeHook);
  const registered = oneEvent(hookEvents, "PoolRegistered", "PoolRegistered event");
  const disclosure = oneEvent(
    hookEvents,
    "PoolFeeDisclosure",
    "PoolFeeDisclosure event",
  );
  const accrual = oneEvent(
    hookEvents,
    "NativeSwapFeesAccrued",
    "launch fee event",
  );
  const hookFee = oneEvent(hookEvents, "HookFee", "launch HookFee event");
  const hookSwap = oneEvent(
    hookEvents,
    "HookSwap",
    "launch URC-2 HookSwap event",
    (args) => Object.hasOwn(args, "swapFee"),
  );
  assertOnlyUrc2HookSwap(hookEvents, "Initial buy");
  sameHex(registered.args.poolId, poolId, "Registered pool");
  sameAddress(registered.args.token, token, "Registered token");
  sameAddress(registered.args.rewardVault, rewardVault, "Registered vault");
  sameAddress(registered.args.registrar, canary.launcher, "Registrar");
  assert(
    Number(registered.args.buySwapFeeBps) === 100 &&
      Number(registered.args.sellSwapFeeBps) === 200,
    "Registered fees differ",
  );
  sameHex(
    registered.args.rewardConfigurationHash,
    rewardConfigurationHash,
    "Registered vault configuration",
  );
  sameHex(disclosure.args.poolId, poolId, "Disclosure pool");
  sameAddress(disclosure.args.token, token, "Disclosure token");
  sameAddress(disclosure.args.rewardVault, rewardVault, "Disclosure vault");
  assert(
    Number(disclosure.args.buySwapFeeBps) === 100 &&
      Number(disclosure.args.sellSwapFeeBps) === 200 &&
      Number(disclosure.args.buyCreatorFeeBps) === 90 &&
      Number(disclosure.args.sellCreatorFeeBps) === 190 &&
      Number(disclosure.args.launcherFeeBps) === 10 &&
      Number(disclosure.args.transferTaxBps) === 0 &&
      Number(disclosure.args.lpFeePips) === 0,
    "Fee disclosure differs",
  );
  validateAccrual(
    accrual.args,
    { poolId, sender: canary.launcher, side: "buy", feeBps: 100 },
    "Initial buy",
  );
  assert(
    accrual.args.grossNativeAmount === BigInt(canary.launchFixture.initialBuyWei),
    "Initial buy gross amount differs",
  );
  const initialFee = assertExactFeeSplit(
    accrual.args,
    BigInt(canary.launchFixture.initialBuyWei),
    100,
    false,
    "Initial buy",
  );
  validateHookFee(
    hookFee.args,
    hookSwap.args,
    accrual.args,
    canary.launcher,
    poolId,
    "Initial buy",
  );
  const poolSwap = oneEvent(
    decodeEvents(
      action.receipt,
      poolManagerEventAbi,
      canary.dependencies.poolManager,
    ),
    "Swap",
    "initial buy PoolManager Swap event",
  );
  sameHex(poolSwap.args.id, poolId, "Initial buy PoolManager pool");
  sameAddress(poolSwap.args.sender, canary.launcher, "Initial buy PoolManager sender");
  assert(
    poolSwap.args.amount0 < 0n &&
      poolSwap.args.amount1 > 0n &&
      Number(poolSwap.args.fee) === 0 &&
      -poolSwap.args.amount0 + initialFee.totalFee ===
        BigInt(canary.launchFixture.initialBuyWei) &&
      poolSwap.args.amount1 === initialBuy.args.tokenAmount,
    "Initial buy PoolManager deltas do not reconcile",
  );
  const rewardVaultDeployments = decodeEvents(
    action.receipt,
    rewardVaultFactoryAbi,
    plan.sharedDependencies.rewardVaultFactory.address,
  ).filter((event) => event.eventName === "ClassicRewardVaultDeployed");
  const forwarderDeployments = decodeEvents(
    action.receipt,
    forwarderFactoryAbi,
    plan.sharedDependencies.positionForwarderFactory.address,
  ).filter((event) => event.eventName === "LockedPositionFeeForwarderDeployed");
  assert(
    rewardVaultDeployments.length <= 1 && forwarderDeployments.length <= 1,
    "Launch contains duplicate derived factory deployments",
  );
  if (rewardVaultDeployments.length === 1) {
    const deployment = rewardVaultDeployments[0].args;
    sameAddress(deployment.vault, rewardVault, "Deployed reward vault");
    sameHex(deployment.poolId, poolId, "Deployed reward vault pool");
    sameAddress(deployment.feeHook, canary.feeHook, "Deployed reward vault hook");
    sameHex(
      deployment.configurationHash,
      rewardConfigurationHash,
      "Deployed reward vault configuration",
    );
  }
  if (forwarderDeployments.length === 1) {
    const deployment = forwarderDeployments[0].args;
    sameAddress(
      deployment.forwarder,
      positionRecipient,
      "Deployed position forwarder",
    );
    sameAddress(
      deployment.feeRecipient,
      canary.operatorWallet,
      "Deployed forwarder fee recipient",
    );
    sameAddress(
      deployment.positionManager,
      canary.dependencies.positionManager,
      "Deployed forwarder manager",
    );
    nonzeroHash(
      deployment.configurationHash,
      "deployed forwarder configuration hash",
    );
  }
  action.anchor.events = {
    MemeTokenLaunchedV2: launched.logIndex,
    MemeLiquidityConfiguredV2: liquidity.logIndex,
    MemeCreatorInitialBuyV2: initialBuy.logIndex,
    MemeCreatorInitialBuyCustodyV2: custody.logIndex,
    PoolRegistered: registered.logIndex,
    PoolFeeDisclosure: disclosure.logIndex,
    NativeSwapFeesAccrued: accrual.logIndex,
    HookFee: hookFee.logIndex,
    HookSwap: hookSwap.logIndex,
    PoolManagerSwap: poolSwap.logIndex,
  };
  return {
    token,
    rewardVault,
    positionRecipient,
    positionTokenId: launched.args.positionTokenId,
    poolId,
    poolKey,
    launchHash,
    rewardConfigurationHash,
    totalSupply: liquidity.args.totalSupply,
    tokenLiquidityAmount: liquidity.args.tokenLiquidityAmount,
    lockedTokenDust: liquidity.args.lockedTokenDust,
    initialBuyTokenAmount: initialBuy.args.tokenAmount,
    rewardVaultDeployedDuringLaunch: rewardVaultDeployments.length === 1,
    positionForwarderDeployedDuringLaunch: forwarderDeployments.length === 1,
    forwarderDeploymentConfigurationHash:
      forwarderDeployments[0]?.args.configurationHash ?? null,
    initialFee: accrual.args,
  };
}

function parseSwap(action, expected, launch, canary) {
  const binding = canary.universalRouterBinding;
  assert(
    binding.version === "V2_0" &&
      normalizeHex(binding.executeSelector) === "0x3593564c" &&
      normalizeHex(binding.v4SwapCommand) === "0x10" &&
      normalizeHex(binding.exactInputSingleAction) === "0x06" &&
      normalizeHex(binding.exactOutputSingleAction) === "0x08" &&
      normalizeHex(binding.settleAllAction) === "0x0c" &&
      normalizeHex(binding.takeAllAction) === "0x0f",
    "Universal Router binding differs from the reviewed V2_0 path",
  );
  const decoded = decodeFunctionData({
    abi: universalRouterAbi,
    data: action.transaction.input,
  });
  assert(decoded.functionName === "execute", `${expected.key} selector differs`);
  const [commands, inputs, deadline] = decoded.args;
  const exactOutputBuy =
    expected.side === "buy" && expected.exactness === "exact-output";
  assert(
    normalizeHex(commands) === (exactOutputBuy ? "0x1004" : "0x10") &&
      inputs.length === (exactOutputBuy ? 2 : 1),
    `${expected.key} outer command sequence differs`,
  );
  if (exactOutputBuy) {
    const [sweepCurrency, sweepRecipient, sweepMinimum] = decodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      inputs[1],
    );
    sameAddress(sweepCurrency, ZERO_ADDRESS, `${expected.key} refund currency`);
    sameAddress(
      sweepRecipient,
      canary.operatorWallet,
      `${expected.key} refund recipient`,
    );
    assert(sweepMinimum === 0n, `${expected.key} refund minimum differs`);
  }
  assert(
    deadline >= action.blockTimestamp && deadline <= action.blockTimestamp + 300n,
    `${expected.key} deadline is outside five minutes`,
  );
  const [actions, params] = decodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    inputs[0],
  );
  const bytes = actions
    .slice(2)
    .match(/.{2}/g)
    ?.map((value) => Number.parseInt(value, 16));
  const manualAction = expected.exactness === "exact-input" ? 0x06 : 0x08;
  assert(
    bytes?.length === 3 &&
      bytes[0] === manualAction &&
      bytes[1] === 0x0c &&
      bytes[2] === 0x0f &&
      params.length === 3,
    `${expected.key} V4 action sequence differs`,
  );
  const inputCurrency = expected.side === "buy" ? ZERO_ADDRESS : launch.token;
  const outputCurrency = expected.side === "buy" ? launch.token : ZERO_ADDRESS;
  let swap;
  [swap] = decodeAbiParameters(
    [
      expected.exactness === "exact-input"
        ? exactInputSingleType
        : exactOutputSingleType,
    ],
    params[0],
  );
  const [settleCurrency, settleBound] = decodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    params[1],
  );
  const [takeCurrency, takeBound] = decodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    params[2],
  );
  sameAddress(
    swap.poolKey.currency0,
    launch.poolKey.currency0,
    `${expected.key} currency0`,
  );
  sameAddress(
    swap.poolKey.currency1,
    launch.poolKey.currency1,
    `${expected.key} currency1`,
  );
  sameAddress(swap.poolKey.hooks, launch.poolKey.hooks, `${expected.key} hook`);
  assert(
    Number(swap.poolKey.fee) === 0 &&
      Number(swap.poolKey.tickSpacing) === 200 &&
      swap.zeroForOne === (expected.side === "buy") &&
      swap.hookData === "0x",
    `${expected.key} single-pool route differs`,
  );
  sameAddress(settleCurrency, inputCurrency, `${expected.key} settle currency`);
  sameAddress(takeCurrency, outputCurrency, `${expected.key} take currency`);
  const inputBound =
    expected.exactness === "exact-input" ? swap.amountIn : swap.amountInMaximum;
  const outputBound =
    expected.exactness === "exact-input" ? swap.amountOutMinimum : swap.amountOut;
  assert(inputBound > 0n && outputBound > 0n, `${expected.key} has a zero bound`);
  assert(
    settleBound === inputBound && takeBound === outputBound,
    `${expected.key} settlement bounds differ`,
  );
  assert(
    expected.side === "buy"
      ? BigInt(action.transaction.value) === inputBound
      : BigInt(action.transaction.value) === 0n,
    `${expected.key} transaction value differs`,
  );
  return {
    deadline,
    swap,
    inputBound,
    outputBound,
    executionPath: "single-hop-all",
  };
}

function validateSwap(action, expected, launch, canary, artifacts) {
  const parsed = parseSwap(action, expected, launch, canary);
  const hookEvents = decodeEvents(action.receipt, artifacts.feeHook.abi, canary.feeHook);
  const accrual = oneEvent(
    hookEvents,
    "NativeSwapFeesAccrued",
    `${expected.key} fee event`,
  );
  const hookFee = oneEvent(hookEvents, "HookFee", `${expected.key} HookFee event`);
  const hookSwap = oneEvent(
    hookEvents,
    "HookSwap",
    `${expected.key} URC-2 HookSwap event`,
    (args) => Object.hasOwn(args, "swapFee"),
  );
  assertOnlyUrc2HookSwap(hookEvents, expected.key);
  validateAccrual(
    accrual.args,
    {
      poolId: launch.poolId,
      sender: canary.dependencies.universalRouter,
      side: expected.side,
      feeBps: expected.side === "buy" ? 100 : 200,
    },
    expected.key,
  );
  validateHookFee(
    hookFee.args,
    hookSwap.args,
    accrual.args,
    canary.dependencies.universalRouter,
    launch.poolId,
    expected.key,
  );
  const poolSwap = oneEvent(
    decodeEvents(
      action.receipt,
      poolManagerEventAbi,
      canary.dependencies.poolManager,
    ),
    "Swap",
    `${expected.key} PoolManager Swap event`,
  );
  sameHex(poolSwap.args.id, launch.poolId, `${expected.key} PoolManager pool`);
  sameAddress(
    poolSwap.args.sender,
    canary.dependencies.universalRouter,
    `${expected.key} PoolManager sender`,
  );
  const totalFee = accrual.args.creatorFee + accrual.args.launcherFee;
  assert(Number(poolSwap.args.fee) === 0, `${expected.key} LP fee differs`);
  assert(
    expected.side === "buy"
      ? poolSwap.args.amount0 < 0n &&
          poolSwap.args.amount1 > 0n &&
          -poolSwap.args.amount0 + totalFee === accrual.args.grossNativeAmount
      : poolSwap.args.amount0 > 0n &&
          poolSwap.args.amount1 < 0n &&
          poolSwap.args.amount0 === accrual.args.grossNativeAmount,
    `${expected.key} pool deltas do not reconcile`,
  );
  const nativeFeeBasis =
    expected.exactness === "exact-output"
      ? expected.side === "buy"
        ? -poolSwap.args.amount0
        : parsed.swap.amountOut
      : expected.side === "buy"
        ? parsed.swap.amountIn
        : poolSwap.args.amount0;
  assertExactFeeSplit(
    accrual.args,
    nativeFeeBasis,
    expected.side === "buy" ? 100 : 200,
    expected.exactness === "exact-output",
    expected.key,
  );
  if (expected.side === "buy" && expected.exactness === "exact-input") {
    assert(
      accrual.args.grossNativeAmount === parsed.swap.amountIn &&
        poolSwap.args.amount1 >= parsed.swap.amountOutMinimum,
      `${expected.key} exact-input amounts differ`,
    );
  }
  if (expected.side === "buy" && expected.exactness === "exact-output") {
    assert(
      poolSwap.args.amount1 === parsed.swap.amountOut &&
        accrual.args.grossNativeAmount <= parsed.swap.amountInMaximum,
      `${expected.key} exact-output amounts differ`,
    );
  }
  if (expected.side === "sell" && expected.exactness === "exact-input") {
    assert(
      -poolSwap.args.amount1 === parsed.swap.amountIn &&
        poolSwap.args.amount0 - totalFee >= parsed.swap.amountOutMinimum,
      `${expected.key} exact-input amounts differ`,
    );
  }
  if (expected.side === "sell" && expected.exactness === "exact-output") {
    assert(
      poolSwap.args.amount0 - totalFee === parsed.swap.amountOut &&
        -poolSwap.args.amount1 <= parsed.swap.amountInMaximum,
      `${expected.key} exact-output amounts differ`,
    );
  }
  action.anchor.side = expected.side;
  action.anchor.exactness = expected.exactness;
  action.anchor.events = {
    NativeSwapFeesAccrued: accrual.logIndex,
    HookFee: hookFee.logIndex,
    HookSwap: hookSwap.logIndex,
    PoolManagerSwap: poolSwap.logIndex,
  };
  return {
    side: expected.side,
    exactness: expected.exactness,
    poolAmount0: poolSwap.args.amount0.toString(),
    poolAmount1: poolSwap.args.amount1.toString(),
    grossNativeAmount: accrual.args.grossNativeAmount.toString(),
    creatorFee: accrual.args.creatorFee.toString(),
    launcherFee: accrual.args.launcherFee.toString(),
    totalFee: totalFee.toString(),
    appliedTotalSwapFeeBps: Number(accrual.args.appliedTotalSwapFeeBps),
    inputBound: parsed.inputBound.toString(),
    outputBound: parsed.outputBound.toString(),
    routerDeadline: parsed.deadline.toString(),
    executionPath: parsed.executionPath,
  };
}

async function verifySwapQuote(endpoint, action, expected, swap, launch, canary) {
  assert(
    canary.swapFixture.quotePolicy === "canonical-v4-quoter-at-parent-block" &&
      canary.swapFixture.slippageBps === 100 &&
      canary.swapFixture.deadlineSeconds === 300,
    "Canary quote policy differs",
  );
  const fixture = canary.swapFixture[expected.key];
  const exactInput = expected.exactness === "exact-input";
  const exactAmount = BigInt(exactInput ? fixture.amountIn : fixture.amountOut);
  assert(
    BigInt(exactInput ? swap.inputBound : swap.outputBound) === exactAmount,
    `${expected.key} exact amount differs from the canary plan`,
  );
  const quoteBlockNumber = action.anchor.blockNumber - 1;
  const quoteBlock = await loadClassicV4BlockAtExactNumber(
    endpoint,
    quoteBlockNumber,
    `${expected.key} quote`,
  );
  sameHex(quoteBlock.hash, action.blockParentHash, `${expected.key} quote parent block`);
  const functionName = exactInput
    ? "quoteExactInputSingle"
    : "quoteExactOutputSingle";
  const [quotedAmount, gasEstimate] = await readContract(
    endpoint,
    blockTag(quoteBlockNumber),
    canary.dependencies.v4Quoter,
    v4QuoterAbi,
    functionName,
    [
      {
        poolKey: launch.poolKey,
        zeroForOne: expected.side === "buy",
        exactAmount,
        hookData: "0x",
      },
    ],
  );
  assert(quotedAmount > 0n && gasEstimate > 0n, `${expected.key} quote is zero`);
  const bound = exactInput
    ? (quotedAmount * 9_900n) / 10_000n
    : (quotedAmount * 10_100n + 9_999n) / 10_000n;
  assert(bound > 0n, `${expected.key} slippage bound is zero`);
  assert(
    BigInt(exactInput ? swap.outputBound : swap.inputBound) === bound,
    `${expected.key} calldata bound differs from its parent-block quote`,
  );
  if (!exactInput) {
    assert(
      bound <= BigInt(fixture.hardMaximumAmountIn),
      `${expected.key} exceeds its hard maximum input`,
    );
  }
  return {
    policy: canary.swapFixture.quotePolicy,
    function: `V4Quoter.${functionName}`,
    blockNumber: quoteBlockNumber,
    blockHash: quoteBlock.hash.toLowerCase(),
    exactAmount: exactAmount.toString(),
    quotedAmount: quotedAmount.toString(),
    gasEstimate: gasEstimate.toString(),
    slippageBps: canary.swapFixture.slippageBps,
    bound: bound.toString(),
  };
}

function validateClaims(actions, launch, canary, artifacts) {
  const creator = actions.creatorClaim;
  sameAddress(creator.transaction.to, launch.rewardVault, "Creator claim destination");
  assert(BigInt(creator.transaction.value) === 0n, "Creator claim value is nonzero");
  const creatorCall = decodeFunctionData({
    abi: rewardVaultAbi,
    data: creator.transaction.input,
  });
  assert(creatorCall.functionName === "claim", "Creator claim is not vault.claim()");
  sameHex(
    creator.transaction.input,
    encodeFunctionData({ abi: rewardVaultAbi, functionName: "claim" }),
    "Creator claim calldata",
  );
  const hookClaim = oneEvent(
    decodeEvents(creator.receipt, artifacts.feeHook.abi, canary.feeHook),
    "CreatorFeesClaimed",
    "CreatorFeesClaimed event",
  );
  sameHex(hookClaim.args.poolId, launch.poolId, "Creator claim pool");
  sameAddress(hookClaim.args.rewardVault, launch.rewardVault, "Creator claim vault");
  sameAddress(hookClaim.args.caller, launch.rewardVault, "Creator hook caller");
  assert(hookClaim.args.amount > 0n, "Creator hook claim is zero");
  const vaultEvents = decodeEvents(creator.receipt, rewardVaultAbi, launch.rewardVault);
  const checkpoint = oneEvent(
    vaultEvents,
    "CreatorFeesCheckpointed",
    "CreatorFeesCheckpointed event",
  );
  const beneficiary = oneEvent(
    vaultEvents,
    "BeneficiaryFeesClaimed",
    "BeneficiaryFeesClaimed event",
  );
  sameHex(checkpoint.args.poolId, launch.poolId, "Checkpoint pool");
  sameAddress(beneficiary.args.beneficiary, canary.operatorWallet, "Claim beneficiary");
  assert(
    Number(checkpoint.args.configurationEpoch) === 1 &&
      checkpoint.args.amount === hookClaim.args.amount &&
      checkpoint.args.totalCreatorFeesReceived === hookClaim.args.amount &&
      beneficiary.args.amount === hookClaim.args.amount &&
      beneficiary.args.beneficiaryTotalClaimed === hookClaim.args.amount &&
      beneficiary.args.vaultTotalReceived === hookClaim.args.amount,
    "Creator claim events do not reconcile",
  );
  creator.anchor.events = {
    CreatorFeesClaimed: hookClaim.logIndex,
    CreatorFeesCheckpointed: checkpoint.logIndex,
    BeneficiaryFeesClaimed: beneficiary.logIndex,
  };

  const launcher = actions.launcherClaim;
  assert(BigInt(launcher.transaction.value) === 0n, "Launcher claim value is nonzero");
  const launcherCall = decodeFunctionData({
    abi: hookReadAbi,
    data: launcher.transaction.input,
  });
  assert(
    launcherCall.functionName === "claimLauncherFees",
    "Launcher claim must use claimLauncherFees()",
  );
  sameHex(
    launcher.transaction.input,
    encodeFunctionData({ abi: hookReadAbi, functionName: "claimLauncherFees" }),
    "Launcher claim calldata",
  );
  const launcherClaim = oneEvent(
    decodeEvents(launcher.receipt, artifacts.feeHook.abi, canary.feeHook),
    "LauncherFeesClaimed",
    "LauncherFeesClaimed event",
  );
  sameAddress(launcherClaim.args.treasury, canary.treasury, "Claim treasury");
  sameAddress(launcherClaim.args.recipient, canary.treasury, "Claim recipient");
  sameAddress(launcherClaim.args.caller, canary.treasury, "Claim caller");
  assert(launcherClaim.args.amount > 0n, "Launcher claim is zero");
  launcher.anchor.events = { LauncherFeesClaimed: launcherClaim.logIndex };
  return {
    creator: {
      hookAmount: hookClaim.args.amount,
      vaultCheckpointAmount: checkpoint.args.amount,
      beneficiaryAmount: beneficiary.args.amount,
    },
    launcher: { amount: launcherClaim.args.amount },
  };
}

async function verifyExclusiveHookActivity(
  endpoint,
  verificationBlock,
  actions,
  launch,
  canary,
  artifacts,
) {
  const fromBlock = actions.launch.anchor.blockNumber;
  const logs = await rpc(endpoint, "eth_getLogs", [
    {
      address: canary.feeHook,
      fromBlock: blockTag(fromBlock),
      toBlock: blockTag(verificationBlock),
    },
  ]);
  const events = decodeEvents({ logs }, artifacts.feeHook.abi, canary.feeHook);
  const accruals = events.filter(
    (event) => event.eventName === "NativeSwapFeesAccrued",
  );
  const creatorClaims = events.filter(
    (event) => event.eventName === "CreatorFeesClaimed",
  );
  const launcherClaims = events.filter(
    (event) => event.eventName === "LauncherFeesClaimed",
  );
  const expectedAccrualHashes = [
    "launch",
    "buyExactInput",
    "buyExactOutput",
    "sellExactInput",
    "sellExactOutput",
  ].map((key) => actions[key].anchor.transactionHash);
  assert(
    accruals.length === 5 &&
      creatorClaims.length === 1 &&
      launcherClaims.length === 1 &&
      new Set(accruals.map((event) => event.transactionHash)).size === 5 &&
      expectedAccrualHashes.every((hash) =>
        accruals.some(
          (event) => normalizeHex(event.transactionHash) === normalizeHex(hash),
        ),
      ) &&
      normalizeHex(creatorClaims[0].transactionHash) ===
        normalizeHex(actions.creatorClaim.anchor.transactionHash) &&
      normalizeHex(launcherClaims[0].transactionHash) ===
        normalizeHex(actions.launcherClaim.anchor.transactionHash),
    "Foreign fee activity exists in the canary verification window",
  );
  for (const event of [...accruals, ...creatorClaims]) {
    sameHex(event.args.poolId, launch.poolId, "Exclusive hook activity pool");
  }
  return {
    fromBlock,
    toBlock: verificationBlock,
    nativeAccrualEvents: accruals.length,
    creatorClaimEvents: creatorClaims.length,
    launcherClaimEvents: launcherClaims.length,
  };
}

function blockTag(blockNumber) {
  assert(Number.isSafeInteger(blockNumber) && blockNumber >= 0, "Invalid block tag");
  return `0x${blockNumber.toString(16)}`;
}

async function readHookAccounting(endpoint, atBlock, launch, canary) {
  const tag = blockTag(atBlock);
  const [
    config,
    launcherFees,
    totalFees,
    managerBalance,
    managerTokenBalance,
    rawBalance,
  ] =
    await Promise.all([
      readContract(
        endpoint,
        tag,
        canary.feeHook,
        hookReadAbi,
        "poolFeeConfig",
        [launch.poolId],
      ),
      readContract(endpoint, tag, canary.feeHook, hookReadAbi, "launcherFeesAccrued"),
      readContract(endpoint, tag, canary.feeHook, hookReadAbi, "totalNativeFeesAccrued"),
      readContract(
        endpoint,
        tag,
        canary.dependencies.poolManager,
        erc6909Abi,
        "balanceOf",
        [canary.feeHook, 0n],
      ),
      readContract(
        endpoint,
        tag,
        canary.dependencies.poolManager,
        erc6909Abi,
        "balanceOf",
        [canary.feeHook, BigInt(launch.token)],
      ),
      rpc(endpoint, "eth_getBalance", [canary.feeHook, tag]).then(BigInt),
    ]);
  return {
    rewardVault: canonicalAddress(config[0]),
    registrar: canonicalAddress(config[1]),
    buySwapFeeBps: Number(config[2]),
    sellSwapFeeBps: Number(config[3]),
    registered: config[4],
    creatorFeesAccrued: config[5].toString(),
    launcherFeesAccrued: launcherFees.toString(),
    totalNativeFeesAccrued: totalFees.toString(),
    poolManagerNativeClaims: managerBalance.toString(),
    poolManagerTokenClaims: managerTokenBalance.toString(),
    rawNativeBalance: rawBalance.toString(),
  };
}

async function readVaultAccounting(endpoint, atBlock, launch, canary) {
  const tag = blockTag(atBlock);
  const [received, claimed, beneficiaryClaimed, claimable, rawBalance] =
    await Promise.all([
      readContract(
        endpoint,
        tag,
        launch.rewardVault,
        rewardVaultAbi,
        "totalCreatorFeesReceived",
      ),
      readContract(
        endpoint,
        tag,
        launch.rewardVault,
        rewardVaultAbi,
        "totalCreatorFeesClaimed",
      ),
      readContract(
        endpoint,
        tag,
        launch.rewardVault,
        rewardVaultAbi,
        "claimedBy",
        [canary.operatorWallet],
      ),
      readContract(
        endpoint,
        tag,
        launch.rewardVault,
        rewardVaultAbi,
        "claimable",
        [canary.operatorWallet],
      ),
      rpc(endpoint, "eth_getBalance", [launch.rewardVault, tag]).then(BigInt),
    ]);
  return {
    totalCreatorFeesReceived: received.toString(),
    totalCreatorFeesClaimed: claimed.toString(),
    beneficiaryClaimed: beneficiaryClaimed.toString(),
    beneficiaryClaimable: claimable.toString(),
    rawNativeBalance: rawBalance.toString(),
  };
}

function assertHookAccounting(snapshot, expectedCreator, expectedLauncher, label) {
  const expectedTotal = expectedCreator + expectedLauncher;
  assert(
    BigInt(snapshot.creatorFeesAccrued) === expectedCreator &&
      BigInt(snapshot.launcherFeesAccrued) === expectedLauncher &&
      BigInt(snapshot.totalNativeFeesAccrued) === expectedTotal &&
      BigInt(snapshot.poolManagerNativeClaims) === expectedTotal &&
      BigInt(snapshot.poolManagerTokenClaims) === 0n &&
      BigInt(snapshot.rawNativeBalance) === 0n,
    `${label} hook accounting differs`,
  );
}

function assertRegisteredConfig(snapshot, launch, canary, label) {
  sameAddress(snapshot.rewardVault, launch.rewardVault, `${label} reward vault`);
  sameAddress(snapshot.registrar, canary.launcher, `${label} registrar`);
  assert(
    snapshot.registered === true &&
      snapshot.buySwapFeeBps === 100 &&
      snapshot.sellSwapFeeBps === 200,
    `${label} pool configuration differs`,
  );
}

async function verifyAccountingTimeline(
  endpoint,
  verificationBlock,
  actions,
  launch,
  swaps,
  claims,
  canary,
) {
  const creatorSum =
    launch.initialFee.creatorFee +
    Object.values(swaps).reduce((sum, swap) => sum + BigInt(swap.creatorFee), 0n);
  const launcherSum =
    launch.initialFee.launcherFee +
    Object.values(swaps).reduce((sum, swap) => sum + BigInt(swap.launcherFee), 0n);
  assert(
    claims.creator.hookAmount === creatorSum &&
      claims.launcher.amount === launcherSum,
    "Claim amounts differ from the five canary accrual events",
  );

  const baselineBlock = actions.launch.anchor.blockNumber - 1;
  const beforeCreatorClaimBlock = actions.creatorClaim.anchor.blockNumber - 1;
  const creatorClaimBlock = actions.creatorClaim.anchor.blockNumber;
  const beforeLauncherClaimBlock = actions.launcherClaim.anchor.blockNumber - 1;
  const [baseline, beforeCreator, afterCreator, beforeLauncher, final, vaultBefore, vaultAfter, vaultFinal] =
    await Promise.all([
      readHookAccounting(endpoint, baselineBlock, launch, canary),
      readHookAccounting(endpoint, beforeCreatorClaimBlock, launch, canary),
      readHookAccounting(endpoint, creatorClaimBlock, launch, canary),
      readHookAccounting(endpoint, beforeLauncherClaimBlock, launch, canary),
      readHookAccounting(endpoint, verificationBlock, launch, canary),
      readVaultAccounting(endpoint, beforeCreatorClaimBlock, launch, canary),
      readVaultAccounting(endpoint, creatorClaimBlock, launch, canary),
      readVaultAccounting(endpoint, verificationBlock, launch, canary),
    ]);

  assert(
    baseline.registered === false &&
      baseline.buySwapFeeBps === 0 &&
      baseline.sellSwapFeeBps === 0 &&
      normalizeHex(baseline.rewardVault) === normalizeHex(ZERO_ADDRESS) &&
      normalizeHex(baseline.registrar) === normalizeHex(ZERO_ADDRESS),
    "Canary pool was registered before launch",
  );
  assertHookAccounting(baseline, 0n, 0n, "Pre-launch baseline");
  for (const [snapshot, label] of [
    [beforeCreator, "Before creator claim"],
    [afterCreator, "After creator claim"],
    [beforeLauncher, "Before launcher claim"],
    [final, "Final"],
  ]) {
    assertRegisteredConfig(snapshot, launch, canary, label);
  }
  assertHookAccounting(beforeCreator, creatorSum, launcherSum, "Before creator claim");
  assertHookAccounting(afterCreator, 0n, launcherSum, "After creator claim");
  assertHookAccounting(beforeLauncher, 0n, launcherSum, "Before launcher claim");
  assertHookAccounting(final, 0n, 0n, "Final");

  assert(
    Object.values(vaultBefore).every((value) => BigInt(value) === 0n),
    "Reward vault had state before the creator claim",
  );
  for (const [snapshot, label] of [
    [vaultAfter, "After creator claim"],
    [vaultFinal, "Final vault"],
  ]) {
    assert(
      BigInt(snapshot.totalCreatorFeesReceived) === creatorSum &&
        BigInt(snapshot.totalCreatorFeesClaimed) === creatorSum &&
        BigInt(snapshot.beneficiaryClaimed) === creatorSum &&
        BigInt(snapshot.beneficiaryClaimable) === 0n &&
        BigInt(snapshot.rawNativeBalance) === 0n,
      `${label} accounting differs`,
    );
  }
  return {
    creatorAccrualTotal: creatorSum.toString(),
    launcherAccrualTotal: launcherSum.toString(),
    totalAccrual: (creatorSum + launcherSum).toString(),
    checkpoints: {
      preLaunch: { blockNumber: baselineBlock, hook: baseline },
      beforeCreatorClaim: {
        blockNumber: beforeCreatorClaimBlock,
        hook: beforeCreator,
        vault: vaultBefore,
      },
      afterCreatorClaim: {
        blockNumber: creatorClaimBlock,
        hook: afterCreator,
        vault: vaultAfter,
      },
      beforeLauncherClaim: {
        blockNumber: beforeLauncherClaimBlock,
        hook: beforeLauncher,
      },
      final: { blockNumber: verificationBlock, hook: final, vault: vaultFinal },
    },
  };
}

async function verifySellApproval(endpoint, action, swap, launch, canary) {
  const approvalBlock = action.anchor.blockNumber - 1;
  const tag = blockTag(approvalBlock);
  const [erc20Allowance, permitAllowance] = await Promise.all([
    readContract(endpoint, tag, launch.token, tokenAbi, "allowance", [
      canary.operatorWallet,
      canary.dependencies.permit2,
    ]),
    readContract(endpoint, tag, canary.dependencies.permit2, permit2Abi, "allowance", [
      canary.operatorWallet,
      launch.token,
      canary.dependencies.universalRouter,
    ]),
  ]);
  const [permitAmount, permitExpiration, permitNonce] = permitAllowance;
  const requiredAmount = BigInt(swap.inputBound);
  assert(
    erc20Allowance >= requiredAmount &&
      permitAmount >= requiredAmount &&
      permitExpiration >= action.blockTimestamp,
    `${action.anchor.side} ${action.anchor.exactness} Permit2 approval is insufficient`,
  );
  return {
    blockNumber: approvalBlock,
    erc20AllowanceToPermit2: erc20Allowance.toString(),
    permit2AllowanceToRouter: permitAmount.toString(),
    permit2Expiration: permitExpiration.toString(),
    permit2Nonce: permitNonce.toString(),
    requiredAmount: requiredAmount.toString(),
  };
}

function signedInt24(value) {
  const bits = BigInt(value) & 0xffffffn;
  return Number(bits >= 0x800000n ? bits - 0x1000000n : bits);
}

function assertPoolKey(actual, expected, label) {
  sameAddress(actual.currency0, expected.currency0, `${label} currency0`);
  sameAddress(actual.currency1, expected.currency1, `${label} currency1`);
  sameAddress(actual.hooks, expected.hooks, `${label} hooks`);
  assert(
    Number(actual.fee) === Number(expected.fee) &&
      Number(actual.tickSpacing) === Number(expected.tickSpacing),
    `${label} fee or tick spacing differs`,
  );
}

async function verifyFinalState(
  endpoint,
  verificationBlock,
  actions,
  launch,
  canary,
  plan,
) {
  const tag = blockTag(verificationBlock);
  const baselineTag = blockTag(actions.launch.anchor.blockNumber - 1);
  const shared = plan.sharedDependencies;
  const [
    launchHash,
    rewardVaultOf,
    initialBuyCustody,
    launcherPoolKey,
    predictedToken,
    poolConfig,
    disclosure,
    tokenName,
    tokenSymbol,
    tokenDecimals,
    tokenGraffiti,
    tokenMetadata,
    tokenCreator,
    totalSupply,
    forwarderDust,
    launcherTokenBalance,
    positionManagerTokenBalance,
    nftOwner,
    nftApproval,
    positionLiquidity,
    poolAndPosition,
    forwarderManager,
    forwarderOperator,
    forwarderTimelock,
    forwarderFeeRecipient,
    forwarderFactoryHash,
    slot0,
    activePoolLiquidity,
    vaultFeeHook,
    vaultPoolManager,
    vaultCtoAuthority,
    vaultPoolId,
    vaultConfigurationHash,
    vaultConfigurationEpoch,
    vaultActiveConfigurationHash,
    vaultBeneficiaryCount,
    vaultBeneficiary,
    vaultShare,
    vaultFactoryHash,
    tokenCode,
    vaultCode,
    forwarderCode,
    tokenCodeBefore,
    vaultCodeBefore,
    forwarderCodeBefore,
  ] = await Promise.all([
    readContract(endpoint, tag, canary.launcher, launcherReadAbi, "launchHashOf", [
      launch.token,
    ]),
    readContract(endpoint, tag, canary.launcher, launcherReadAbi, "rewardVaultOf", [
      launch.token,
    ]),
    readContract(
      endpoint,
      tag,
      canary.launcher,
      launcherReadAbi,
      "initialBuyCustodyOf",
      [launch.token],
    ),
    readContract(endpoint, tag, canary.launcher, launcherReadAbi, "poolKey", [
      launch.token,
    ]),
    readContract(
      endpoint,
      tag,
      canary.launcher,
      launcherReadAbi,
      "predictTokenAddress",
      [
        canary.launchFixture.name,
        canary.launchFixture.symbol,
        canary.operatorWallet,
        canary.launchFixture.creatorSalt,
      ],
    ),
    readContract(endpoint, tag, canary.feeHook, hookReadAbi, "poolFeeConfig", [
      launch.poolId,
    ]),
    readContract(endpoint, tag, canary.feeHook, hookReadAbi, "feeDisclosure", [
      launch.poolId,
    ]),
    readContract(endpoint, tag, launch.token, tokenAbi, "name"),
    readContract(endpoint, tag, launch.token, tokenAbi, "symbol"),
    readContract(endpoint, tag, launch.token, tokenAbi, "decimals"),
    readContract(endpoint, tag, launch.token, tokenAbi, "graffiti"),
    readContract(endpoint, tag, launch.token, tokenAbi, "metadata"),
    readContract(endpoint, tag, launch.token, tokenAbi, "creator"),
    readContract(endpoint, tag, launch.token, tokenAbi, "totalSupply"),
    readContract(endpoint, tag, launch.token, tokenAbi, "balanceOf", [
      launch.positionRecipient,
    ]),
    readContract(endpoint, tag, launch.token, tokenAbi, "balanceOf", [
      canary.launcher,
    ]),
    readContract(endpoint, tag, launch.token, tokenAbi, "balanceOf", [
      canary.dependencies.positionManager,
    ]),
    readContract(
      endpoint,
      tag,
      canary.dependencies.positionManager,
      positionManagerAbi,
      "ownerOf",
      [launch.positionTokenId],
    ),
    readContract(
      endpoint,
      tag,
      canary.dependencies.positionManager,
      positionManagerAbi,
      "getApproved",
      [launch.positionTokenId],
    ),
    readContract(
      endpoint,
      tag,
      canary.dependencies.positionManager,
      positionManagerAbi,
      "getPositionLiquidity",
      [launch.positionTokenId],
    ),
    readContract(
      endpoint,
      tag,
      canary.dependencies.positionManager,
      positionManagerAbi,
      "getPoolAndPositionInfo",
      [launch.positionTokenId],
    ),
    readContract(endpoint, tag, launch.positionRecipient, forwarderAbi, "positionManager"),
    readContract(endpoint, tag, launch.positionRecipient, forwarderAbi, "operator"),
    readContract(
      endpoint,
      tag,
      launch.positionRecipient,
      forwarderAbi,
      "timelockBlockNumber",
    ),
    readContract(endpoint, tag, launch.positionRecipient, forwarderAbi, "feeRecipient"),
    readContract(
      endpoint,
      tag,
      shared.positionForwarderFactory.address,
      forwarderFactoryAbi,
      "configurationHashOf",
      [launch.positionRecipient],
    ),
    readContract(endpoint, tag, canary.dependencies.stateView, stateViewAbi, "getSlot0", [
      launch.poolId,
    ]),
    readContract(
      endpoint,
      tag,
      canary.dependencies.stateView,
      stateViewAbi,
      "getLiquidity",
      [launch.poolId],
    ),
    readContract(endpoint, tag, launch.rewardVault, rewardVaultAbi, "feeHook"),
    readContract(endpoint, tag, launch.rewardVault, rewardVaultAbi, "poolManager"),
    readContract(endpoint, tag, launch.rewardVault, rewardVaultAbi, "ctoAuthority"),
    readContract(endpoint, tag, launch.rewardVault, rewardVaultAbi, "poolId"),
    readContract(endpoint, tag, launch.rewardVault, rewardVaultAbi, "configurationHash"),
    readContract(endpoint, tag, launch.rewardVault, rewardVaultAbi, "configurationEpoch"),
    readContract(
      endpoint,
      tag,
      launch.rewardVault,
      rewardVaultAbi,
      "activeConfigurationHash",
    ),
    readContract(endpoint, tag, launch.rewardVault, rewardVaultAbi, "beneficiaryCount"),
    readContract(endpoint, tag, launch.rewardVault, rewardVaultAbi, "beneficiaryAt", [0n]),
    readContract(endpoint, tag, launch.rewardVault, rewardVaultAbi, "shareBpsAt", [0n]),
    readContract(
      endpoint,
      tag,
      shared.rewardVaultFactory.address,
      rewardVaultFactoryAbi,
      "configurationHashOf",
      [launch.rewardVault],
    ),
    rpc(endpoint, "eth_getCode", [launch.token, tag]),
    rpc(endpoint, "eth_getCode", [launch.rewardVault, tag]),
    rpc(endpoint, "eth_getCode", [launch.positionRecipient, tag]),
    rpc(endpoint, "eth_getCode", [launch.token, baselineTag]),
    rpc(endpoint, "eth_getCode", [launch.rewardVault, baselineTag]),
    rpc(endpoint, "eth_getCode", [launch.positionRecipient, baselineTag]),
  ]);

  sameHex(launchHash, launch.launchHash, "Launcher launch hash mapping");
  sameAddress(rewardVaultOf, launch.rewardVault, "Launcher reward vault mapping");
  sameAddress(initialBuyCustody, ZERO_ADDRESS, "Launcher initial custody mapping");
  assertPoolKey(launcherPoolKey, launch.poolKey, "Launcher pool key");
  assertPoolKey(poolAndPosition[0], launch.poolKey, "Position pool key");
  const expectedGraffiti = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [canary.operatorWallet, canary.launchFixture.creatorSalt],
    ),
  );
  sameAddress(predictedToken[0], launch.token, "Predicted canary token");
  sameHex(predictedToken[1], expectedGraffiti, "Predicted token graffiti");
  sameHex(tokenGraffiti, expectedGraffiti, "Token graffiti");
  assert(
    tokenName === canary.launchFixture.name &&
      tokenSymbol === canary.launchFixture.symbol &&
      Number(tokenDecimals) === 18 &&
      tokenMetadata[0] === canary.launchFixture.metadata.description &&
      tokenMetadata[1] === canary.launchFixture.metadata.website &&
      tokenMetadata[2] === canary.launchFixture.metadata.image &&
      normalizeHex(tokenMetadata[3]) ===
        normalizeHex(canary.launchFixture.metadata.extraData),
    "Deployed token identity or metadata differs",
  );
  sameAddress(poolConfig[0], launch.rewardVault, "Final pool reward vault");
  sameAddress(poolConfig[1], canary.launcher, "Final pool registrar");
  assert(
    Number(poolConfig[2]) === 100 &&
      Number(poolConfig[3]) === 200 &&
      poolConfig[4] === true &&
      poolConfig[5] === 0n,
    "Final pool fee configuration differs",
  );
  assert(
    Number(disclosure[0]) === 100 &&
      Number(disclosure[1]) === 200 &&
      Number(disclosure[2]) === 90 &&
      Number(disclosure[3]) === 190 &&
      Number(disclosure[4]) === 10 &&
      Number(disclosure[5]) === 0 &&
      Number(disclosure[6]) === 0,
    "Final fee disclosure differs",
  );
  sameAddress(disclosure[7], launch.rewardVault, "Final disclosed reward vault");

  const expectedVaultConfigurationHash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "address[]" },
        { type: "uint16[]" },
      ],
      [
        1n,
        launch.rewardVault,
        canary.feeHook,
        canary.dependencies.poolManager,
        shared.ctoAuthority.address,
        launch.poolId,
        [canary.operatorWallet],
        [10_000],
      ],
    ),
  );
  const expectedActiveConfigurationHash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint64" },
        { type: "address[]" },
        { type: "uint16[]" },
      ],
      [
        1n,
        launch.rewardVault,
        expectedVaultConfigurationHash,
        1n,
        [canary.operatorWallet],
        [10_000],
      ],
    ),
  );
  sameAddress(vaultFeeHook, canary.feeHook, "Vault hook");
  sameAddress(vaultPoolManager, canary.dependencies.poolManager, "Vault PoolManager");
  sameAddress(vaultCtoAuthority, shared.ctoAuthority.address, "Vault CTO authority");
  sameHex(vaultPoolId, launch.poolId, "Vault pool ID");
  sameHex(vaultConfigurationHash, expectedVaultConfigurationHash, "Vault configuration");
  sameHex(vaultFactoryHash, expectedVaultConfigurationHash, "Vault factory configuration");
  sameHex(
    launch.rewardConfigurationHash,
    expectedVaultConfigurationHash,
    "Launch reward configuration",
  );
  sameHex(
    vaultActiveConfigurationHash,
    expectedActiveConfigurationHash,
    "Active vault configuration",
  );
  sameAddress(vaultBeneficiary, canary.operatorWallet, "Vault beneficiary");
  assert(
    vaultConfigurationEpoch === 1n &&
      vaultBeneficiaryCount === 1n &&
      Number(vaultShare) === 10_000,
    "Vault beneficiary configuration differs",
  );

  const expectedForwarderConfigurationHash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        1n,
        shared.positionForwarderFactory.address,
        launch.positionRecipient,
        canary.dependencies.positionManager,
        ZERO_ADDRESS,
        UINT256_MAX,
        canary.operatorWallet,
      ],
    ),
  );
  sameAddress(nftOwner, launch.positionRecipient, "Position NFT owner");
  sameAddress(nftApproval, ZERO_ADDRESS, "Position NFT approval");
  sameAddress(forwarderManager, canary.dependencies.positionManager, "Forwarder manager");
  sameAddress(forwarderOperator, ZERO_ADDRESS, "Forwarder operator");
  sameAddress(forwarderFeeRecipient, canary.operatorWallet, "Forwarder fee recipient");
  sameHex(
    forwarderFactoryHash,
    expectedForwarderConfigurationHash,
    "Forwarder factory configuration",
  );
  if (launch.forwarderDeploymentConfigurationHash) {
    sameHex(
      launch.forwarderDeploymentConfigurationHash,
      expectedForwarderConfigurationHash,
      "Forwarder deployment configuration",
    );
  }
  const positionInfo = BigInt(poolAndPosition[1]);
  const positionPoolMask =
    0xffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000n;
  const tickLower = signedInt24(positionInfo >> 8n);
  const tickUpper = signedInt24(positionInfo >> 32n);
  assert(
    forwarderTimelock === UINT256_MAX &&
      positionLiquidity > 0n &&
      activePoolLiquidity > 0n &&
      slot0[0] > 0n &&
      Number(slot0[3]) === 0 &&
      (positionInfo & positionPoolMask) ===
        (BigInt(launch.poolId) & positionPoolMask) &&
      tickLower === 174_800 &&
      tickUpper === 204_200,
    "Permanent Deep30 position lock differs",
  );

  sameAddress(tokenCreator, canary.launcher, "Token creator");
  assert(
    totalSupply === TOKEN_SUPPLY &&
      totalSupply === launch.totalSupply &&
      forwarderDust === launch.lockedTokenDust &&
      launcherTokenBalance === 0n &&
      positionManagerTokenBalance === 0n &&
      launch.tokenLiquidityAmount + launch.lockedTokenDust === TOKEN_SUPPLY,
    "Token supply or locked dust custody differs",
  );
  assert(
    [tokenCode, vaultCode, forwarderCode].every((code) => code !== "0x") &&
      tokenCodeBefore === "0x" &&
      (!launch.rewardVaultDeployedDuringLaunch || vaultCodeBefore === "0x") &&
      (!launch.positionForwarderDeployedDuringLaunch ||
        forwarderCodeBefore === "0x"),
    "Derived deployment code provenance differs",
  );

  return {
    launchMappings: {
      launchHash: launchHash.toLowerCase(),
      rewardVault: canonicalAddress(rewardVaultOf),
      initialBuyCustody: canonicalAddress(initialBuyCustody),
    },
    poolFeeConfig: {
      rewardVault: canonicalAddress(poolConfig[0]),
      registrar: canonicalAddress(poolConfig[1]),
      buySwapFeeBps: Number(poolConfig[2]),
      sellSwapFeeBps: Number(poolConfig[3]),
      registered: poolConfig[4],
      creatorFeesAccrued: poolConfig[5].toString(),
    },
    rewardVault: {
      configurationHash: vaultConfigurationHash.toLowerCase(),
      activeConfigurationHash: vaultActiveConfigurationHash.toLowerCase(),
      configurationEpoch: Number(vaultConfigurationEpoch),
      beneficiary: canonicalAddress(vaultBeneficiary),
      shareBps: Number(vaultShare),
    },
    positionLock: {
      owner: canonicalAddress(nftOwner),
      approved: canonicalAddress(nftApproval),
      tokenId: launch.positionTokenId.toString(),
      positionLiquidity: positionLiquidity.toString(),
      activePoolLiquidity: activePoolLiquidity.toString(),
      tickLower,
      tickUpper,
      manager: canonicalAddress(forwarderManager),
      operator: canonicalAddress(forwarderOperator),
      timelockBlockNumber: forwarderTimelock.toString(),
      feeRecipient: canonicalAddress(forwarderFeeRecipient),
      factoryConfigurationHash: forwarderFactoryHash.toLowerCase(),
    },
    tokenCustody: {
      totalSupply: totalSupply.toString(),
      lockedTokenDust: forwarderDust.toString(),
      launcherBalance: launcherTokenBalance.toString(),
      positionManagerBalance: positionManagerTokenBalance.toString(),
    },
    derivedCodeHashes: {
      token: keccak256(tokenCode),
      rewardVault: keccak256(vaultCode),
      positionForwarder: keccak256(forwarderCode),
      rewardVaultPredeployed: !launch.rewardVaultDeployedDuringLaunch,
      positionForwarderPredeployed:
        !launch.positionForwarderDeployedDuringLaunch,
    },
  };
}

const SWAP_ACTIONS = Object.freeze([
  Object.freeze({ key: "buyExactInput", side: "buy", exactness: "exact-input" }),
  Object.freeze({ key: "buyExactOutput", side: "buy", exactness: "exact-output" }),
  Object.freeze({ key: "sellExactInput", side: "sell", exactness: "exact-input" }),
  Object.freeze({ key: "sellExactOutput", side: "sell", exactness: "exact-output" }),
]);

async function verifyAtEndpoint(
  endpoint,
  verificationBlock,
  hashes,
  plan,
  deploymentEvidence,
  canary,
  artifacts,
) {
  const [chainId, verificationAnchor, latestBlock] = await Promise.all([
    rpc(endpoint, "eth_chainId"),
    rpc(endpoint, "eth_getBlockByNumber", [blockTag(verificationBlock), false]),
    rpc(endpoint, "eth_getBlockByNumber", ["latest", false]),
  ]);
  assert(BigInt(chainId) === 1n, "RPC is not Ethereum Mainnet");
  assert(verificationAnchor && latestBlock, "Verification block is unavailable");
  assert(
    hexInteger(verificationAnchor.number, "Verification block number") ===
      verificationBlock &&
      hexInteger(latestBlock.number, "Latest block number") >= verificationBlock,
    "RPC has not reached the fixed verification block",
  );
  const verificationBlockHash = nonzeroHash(
    verificationAnchor.hash,
    "verification block hash",
  );
  const actions = await readTransactions(
    endpoint,
    hashes,
    verificationBlock,
    canary,
    deploymentEvidence,
  );
  const launch = validateLaunch(actions.launch, canary, artifacts, plan);
  const swaps = Object.fromEntries(
    SWAP_ACTIONS.map((expected) => [
      expected.key,
      validateSwap(actions[expected.key], expected, launch, canary, artifacts),
    ]),
  );
  const quoteEntries = await Promise.all(
    SWAP_ACTIONS.map(async (expected) => [
      expected.key,
      await verifySwapQuote(
        endpoint,
        actions[expected.key],
        expected,
        swaps[expected.key],
        launch,
        canary,
      ),
    ]),
  );
  for (const [key, quote] of quoteEntries) swaps[key].quote = quote;
  const claims = validateClaims(actions, launch, canary, artifacts);
  const [exclusiveHookActivity, feeConservation, sellExactInputApproval, sellExactOutputApproval, postState] =
    await Promise.all([
      verifyExclusiveHookActivity(
        endpoint,
        verificationBlock,
        actions,
        launch,
        canary,
        artifacts,
      ),
      verifyAccountingTimeline(
        endpoint,
        verificationBlock,
        actions,
        launch,
        swaps,
        claims,
        canary,
      ),
      verifySellApproval(
        endpoint,
        actions.sellExactInput,
        swaps.sellExactInput,
        launch,
        canary,
      ),
      verifySellApproval(
        endpoint,
        actions.sellExactOutput,
        swaps.sellExactOutput,
        launch,
        canary,
      ),
      verifyFinalState(
        endpoint,
        verificationBlock,
        actions,
        launch,
        canary,
        plan,
      ),
    ]);
  return {
    verificationBlock,
    verificationBlockHash,
    checkedAt: new Date(
      Number(BigInt(verificationAnchor.timestamp)) * 1_000,
    ).toISOString(),
    latestLifecycleBlock: actions.launcherClaim.anchor.blockNumber,
    confirmations: Math.min(
      ...Object.values(actions).map((action) => action.anchor.confirmations),
    ),
    canaryToken: launch.token,
    rewardVault: launch.rewardVault,
    poolId: launch.poolId,
    positionRecipient: launch.positionRecipient,
    positionTokenId: launch.positionTokenId.toString(),
    actions: Object.fromEntries(
      CLASSIC_V4_LIFECYCLE_ACTIONS.map((key) => [key, actions[key].anchor]),
    ),
    swaps,
    claims: {
      creator: {
        amount: claims.creator.hookAmount.toString(),
        vaultCheckpointAmount: claims.creator.vaultCheckpointAmount.toString(),
        beneficiaryAmount: claims.creator.beneficiaryAmount.toString(),
      },
      launcher: { amount: claims.launcher.amount.toString() },
    },
    postState,
    feeConservation,
    observations: {
      exclusiveHookActivity,
      sellApprovals: {
        sellExactInput: sellExactInputApproval,
        sellExactOutput: sellExactOutputApproval,
      },
    },
  };
}

function reconcileEndpoints(left, right) {
  assert(
    digestJson(left, CLASSIC_V4_DIGEST_DOMAINS.lifecycleRpcSnapshot) ===
      digestJson(right, CLASSIC_V4_DIGEST_DOMAINS.lifecycleRpcSnapshot),
    "Independent RPCs disagree on lifecycle evidence",
  );
  return left;
}

async function writeAcknowledgedEvidence(evidence, canary, options) {
  if (!options.output || !path.isAbsolute(options.output)) {
    fail("--write requires an absolute --output path");
  }
  if (
    !options.wallet ||
    canonicalAddress(options.wallet, "wallet") !== canary.operatorWallet
  ) {
    fail("--write requires the explicit human wallet matching the canary operator");
  }
  if (
    !options.acknowledgement ||
    normalizeHex(options.acknowledgement) !== normalizeHex(evidence.evidenceDigest)
  ) {
    fail("--write requires --acknowledge-evidence-digest from a fresh check run");
  }
  const output = path.resolve(options.output);
  const relative = path.relative(repositoryRoot, output);
  if (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`))
  ) {
    fail("Lifecycle evidence must be written outside the source repository");
  }
  const parent = path.dirname(output);
  const [realParent, parentStats] = await Promise.all([
    realpath(parent),
    stat(parent),
  ]);
  if (!parentStats.isDirectory() || realParent !== parent) {
    fail("The output parent must be an existing real directory");
  }
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function verifyClassicV4LifecycleCanary({
  endpoints,
  verificationBlock,
  plan,
  deploymentEvidence,
  sourceEvidence,
  suppliedCanary,
  suppliedTransactions,
  artifacts,
}) {
  assert(
    Number.isSafeInteger(verificationBlock) && verificationBlock > 0,
    "Verification block must be a positive integer",
  );
  assertEndpoints(endpoints);
  validateClassicV4PreparationPlan(plan, artifacts);
  validateClassicV4DeploymentEvidence(plan, deploymentEvidence);
  validateClassicV4SourceEvidence(plan, deploymentEvidence, sourceEvidence);
  await verifyClassicV4ReleasePrerequisites({
    endpoints,
    plan,
    deploymentEvidence,
    sourceEvidence,
    artifacts,
  });
  const canary = reconstructCanary(
    plan,
    deploymentEvidence,
    sourceEvidence,
    suppliedCanary,
  );
  const hashes = validateTransactionHashes(suppliedTransactions);
  const observations = await Promise.all(
    endpoints.map((endpoint) =>
      verifyAtEndpoint(
        endpoint,
        verificationBlock,
        hashes,
        plan,
        deploymentEvidence,
        canary,
        artifacts,
      ),
    ),
  );
  const verified = reconcileEndpoints(observations[0], observations[1]);
  const unsignedEvidence = {
    schemaVersion: 1,
    chainId: 1,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    status: "verified-current-release",
    checkedAt: verified.checkedAt,
    independentRpcCount: 2,
    releaseEligible: true,
    canaryPlanDigest: canary.planDigest,
    releaseBindingDigest: canary.releaseBindingDigest,
    deploymentEvidenceDigest: deploymentEvidence.evidenceDigest,
    sourceEvidenceDigest: sourceEvidence.evidenceDigest,
    verificationBlock: verified.verificationBlock,
    verificationBlockHash: verified.verificationBlockHash,
    latestLifecycleBlock: verified.latestLifecycleBlock,
    confirmations: verified.confirmations,
    operatorWallet: canary.operatorWallet,
    launcher: canary.launcher,
    feeHook: canary.feeHook,
    canaryToken: verified.canaryToken,
    rewardVault: verified.rewardVault,
    poolId: verified.poolId,
    positionRecipient: verified.positionRecipient,
    positionTokenId: verified.positionTokenId,
    actions: verified.actions,
    swaps: verified.swaps,
    claims: verified.claims,
    postState: verified.postState,
    feeConservation: verified.feeConservation,
    observations: verified.observations,
    invariants: {
      launchVerified: true,
      positionLockVerified: true,
      buyExactInputVerified: true,
      buyExactOutputVerified: true,
      sellExactInputVerified: true,
      sellExactOutputVerified: true,
      creatorClaimVerified: true,
      launcherClaimVerified: true,
      feeConservationVerified: true,
    },
  };
  const evidence = {
    ...unsignedEvidence,
    evidenceDigest: digestJson(
      unsignedEvidence,
      CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
    ),
  };
  validateClassicV4LifecycleEvidence(
    plan,
    deploymentEvidence,
    sourceEvidence,
    evidence,
  );
  return evidence;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (
    !options.write &&
    (options.output || options.wallet || options.acknowledgement)
  ) {
    fail("--output, --wallet and acknowledgement are accepted only with --write");
  }
  const [
    plan,
    deploymentEvidence,
    sourceEvidence,
    suppliedCanary,
    suppliedTransactions,
  ] = await Promise.all([
    readJson(options.plan, "preparation plan"),
    readJson(options.deploymentEvidence, "deployment evidence"),
    readJson(options.sourceEvidence, "source evidence"),
    readJson(options.canaryPlan, "canary plan"),
    readJson(options.transactions, "lifecycle transactions"),
  ]);
  const artifacts = await loadClassicV4SealedBuild(plan);
  const evidence = await verifyClassicV4LifecycleCanary({
    endpoints: [options.rpcA, options.rpcB],
    verificationBlock: options.verificationBlock,
    plan,
    deploymentEvidence,
    sourceEvidence,
    suppliedCanary,
    suppliedTransactions,
    artifacts,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (options.write) {
    await writeAcknowledgedEvidence(
      evidence,
      { operatorWallet: evidence.operatorWallet },
      options,
    );
  } else {
    process.stderr.write(
      "Read-only verification complete. Re-run with --write and the fresh evidence digest only after human review.\n",
    );
  }
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`Lifecycle verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
