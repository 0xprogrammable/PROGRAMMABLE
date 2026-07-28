import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  getAddress,
  getContractAddress,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PROGRAMMABLE_DEEP_LIFECYCLE_PORT ?? 4179);
const CHAIN_ID = "0x1";
const ACCOUNT = "0x2bb333d48dfaf1596d9036671d2e43168994249e";
const LAUNCHER = "0x7aef9a4038fabb1d477bbfd3a106f81b93eb5aeb";
const AUTOMATION = "0x856a8e8421e76f55cd1e0d65b4f3c1b474289b2f";
const FEE_HOOK = "0x48dc3009ec1d3298bba31f718a9a29d02fc9b0cc";
const POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90";
const POSITION_MANAGER = "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e";
const RELEASE_COMMIT = "63a06456f169fc6fa9f346bd22fbc4c63e174ea5";
const INITIAL_BUY_WEI = 30_000_000_000_000_000n;
const BUY_FEE_BPS = 1_000;
const SELL_FEE_BPS = 1_000;
const OBSERVATION_TARGET = 192;
const OBSERVATION_STEP = 16;
const CREATOR_SALT = keccak256(
  stringToHex("programmable.deep-full-range.lifecycle.2026-07-28.v1"),
);
const RPC_ENDPOINTS = [
  process.env.DEEP_FULL_RANGE_RPC_A ?? "https://eth.drpc.org",
  process.env.DEEP_FULL_RANGE_RPC_B ?? "https://rpc.mevblocker.io",
];
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 8_192;
const MAX_FEE_PER_GAS_WEI = 10_000_000_000n;
const REVIEWED_KEEPER_EXECUTOR_RUNTIME_HASH =
  "0xd4a6e8f200bd63ab924f5c4cfb1bbcc07c26c7b7b7abaa1f879418d2435f48e6";
const REVIEWED_KEEPER_EXECUTOR_CREATION_CODE_HASH =
  "0x7d28e049ebf5ae002150d68d4fb31947a301645f13bafc8e6b73f99e451e9f58";
const REVIEWED_KEEPER_EXECUTOR_SOURCE_COMMITMENT =
  "0x9072fa857d484b944205a969fda41727fa76d0f9e670916451b308615bb82175";
const KEEPER_EXECUTOR_ADDRESS = normalizeOptionalAddress(
  process.env.DEEP_KEEPER_EXECUTOR_ADDRESS,
);
const KEEPER_EXECUTOR_RUNTIME_HASH = normalizeOptionalHash(
  process.env.DEEP_KEEPER_EXECUTOR_RUNTIME_HASH,
);
if (
  KEEPER_EXECUTOR_RUNTIME_HASH &&
  KEEPER_EXECUTOR_RUNTIME_HASH !== REVIEWED_KEEPER_EXECUTOR_RUNTIME_HASH
) {
  throw new Error(
    "DEEP_KEEPER_EXECUTOR_RUNTIME_HASH is not the reviewed DeepKeeperExecutorV1 runtime",
  );
}
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const rpcQueues = new Map();
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const evidencePath = path.join(
  repositoryRoot,
  "tmp/deep-full-range-mainnet-lifecycle-evidence.json",
);
const keeperExecutorArtifactPath = path.join(
  repositoryRoot,
  "contracts/out/DeepKeeperExecutorV1.sol/DeepKeeperExecutorV1.json",
);

const runtimeHashes = Object.freeze({
  [LAUNCHER]:
    "0xa2acb1f45f9d5baa4037d837b82e1a4fade65202406bdf530bad536b3a58cde0",
  [AUTOMATION]:
    "0x1b6cc50912806d27908a5e01abf30af392b909116e0d0f7321f828be52400ad8",
  [FEE_HOOK]:
    "0xda536944ead25d438a8a957ec1c7997115fb36d7e1af963d162b1ce99229b002",
  [POOL_MANAGER]:
    "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
});

const gasCeilings = Object.freeze({
  deploy_keeper_executor: 1_500_000n,
  launch: 9_000_000n,
  grow_oracle: 7_000_000n,
  fee_process_compound: 2_500_000n,
});

const launcherAbi = parseAbi([
  "function launch((string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps) parameters) payable returns ((address token,address growthVault,address oracleGuard,address upstreamRewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,bytes32 poolId,bytes32 vaultConfigurationHash,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address deployer,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function growthVaultOf(address token) view returns (address)",
  "function launchHashOf(address token) view returns (bytes32)",
]);
const automationAbi = parseAbi([
  "function stageOracleBatch(address[] candidates) returns (uint256 attempted,uint256 succeeded)",
  "function performVault(address vaultAddress) returns (bool succeeded,uint8 action)",
  "function checkVault(address vaultAddress) view returns (uint8 action)",
  "function isRegisteredVault(address vault) view returns (bool)",
]);
const keeperExecutorAbi = parseAbi([
  "function execute((address vault,uint8 expectedAction)[] candidates) returns (bytes32 batchHash,uint256 attempted,uint256 succeeded)",
  "function automation() view returns (address)",
  "event CandidateResult(bytes32 indexed batchHash,uint256 indexed candidateIndex,address indexed vault,address executor,uint8 expectedAction,uint8 actualAction,uint8 outcome,bytes4 errorSelector,uint256 gasUsed)",
]);
const vaultAbi = parseAbi([
  "function poolId() view returns (bytes32)",
  "function oracleGuard() view returns (address)",
  "function upstreamVault() view returns (address)",
  "function token() view returns (address)",
  "function initialPositionTokenId() view returns (uint256)",
  "function initialPositionRecipient() view returns (address)",
  "function configurationHash() view returns (bytes32)",
  "function totalCreatorFeesReceived() view returns (uint256)",
  "function totalNativeAllocatedToGrowth() view returns (uint256)",
  "function pendingGrowthNative() view returns (uint256)",
  "function totalNativeAddedToLiquidity() view returns (uint256)",
  "function totalTokenAddedToLiquidity() view returns (uint256)",
  "function totalLiquidityAdded() view returns (uint256)",
  "function lockedLiquidity() view returns (uint128)",
  "function lastCompoundTimestamp() view returns (uint64)",
  "function oracleReady() view returns (bool)",
  "function workState() view returns (uint8 action,uint256 hookCreatorFees,uint256 pendingNative,uint256 nextCompoundTimestamp,uint256 trustedNativeDepth,uint256 depthCapNative)",
]);
const hookAbi = parseAbi([
  "function stateById(bytes32 poolId) view returns (uint16 index,uint16 cardinality,uint16 cardinalityNext)",
  "function poolFeeConfig(bytes32 poolId) view returns (address rewardVault,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bool registered,bytes32 rewardConfigurationHash,uint256 creatorFeesAccrued)",
]);
const guardAbi = parseAbi([
  "function twapWindow() view returns (uint32)",
  "function quoteRange() view returns ((int24 tickLower,int24 tickUpper,int24 twapTick,int24 spotTick) quote)",
]);
const positionManagerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
]);
const lifecycleEventAbi = parseAbi([
  "event OracleGrowthStaged(address indexed vault,bytes32 indexed poolId,address indexed executor,uint16 previousCardinalityNext,uint16 newCardinalityNext)",
  "event WorkPerformed(address indexed vault,uint8 indexed action,address indexed executor)",
  "event CreatorFeesProcessed(uint256 received,uint256 allocatedToGrowth,uint256 deferredToRewards,uint256 totalAllocatedToGrowth,uint256 growthTarget)",
  "event LiquidityCompounded(address indexed caller,uint256 nativeBudget,uint256 tokenBudget,uint256 nativeAdded,uint256 tokenAdded,uint256 nativeRecycled,uint256 tokenRecycled,uint128 liquidityAdded,uint256 pendingGrowthNative)",
]);

const launchParameters = Object.freeze({
  name: "Deep Lifecycle 2026",
  symbol: "DEEPLIFE",
  buySwapFeeBps: BUY_FEE_BPS,
  sellSwapFeeBps: SELL_FEE_BPS,
  creatorSalt: CREATOR_SALT,
  metadata: {
    description: "Programmable Deep Full-Range V1 lifecycle completion canary.",
    website: "https://programmable.family/",
    image:
      "https://programmable.family/brand/programmable-token-fallback-01-dawn.webp",
    extraData: stringToHex(
      JSON.stringify({ v: 1, purpose: "deep-full-range-lifecycle" }),
    ),
  },
  rewardBeneficiaries: [getAddress(ACCOUNT)],
  rewardSharesBps: [10_000],
});

function normalizeHex(value) {
  return String(value ?? "").toLowerCase();
}

function normalizeOptionalAddress(value) {
  if (value === undefined || value === "") return null;
  try {
    return normalizeHex(getAddress(value));
  } catch {
    throw new Error("DEEP_KEEPER_EXECUTOR_ADDRESS is not a valid address");
  }
}

function normalizeOptionalHash(value) {
  if (value === undefined || value === "") return null;
  const normalized = normalizeHex(value);
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("DEEP_KEEPER_EXECUTOR_RUNTIME_HASH is not a bytes32 hash");
  }
  return normalized;
}

function quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

export function validateMinedTransactionEnvelope(
  transaction,
  preparedRequest,
  preparedMaximumTotalDebitWei,
) {
  if (
    transaction?.gas === undefined ||
    transaction?.value === undefined ||
    preparedRequest?.gas === undefined ||
    preparedRequest?.maxFeePerGas === undefined ||
    preparedRequest?.maxPriorityFeePerGas === undefined
  ) {
    throw new Error("Transaction gas envelope is incomplete");
  }
  const minedGasLimit = BigInt(transaction.gas);
  const preparedGasLimit = BigInt(preparedRequest.gas);
  const preparedMaxFeePerGas = BigInt(preparedRequest.maxFeePerGas);
  const preparedMaxPriorityFeePerGas = BigInt(
    preparedRequest.maxPriorityFeePerGas,
  );
  if (minedGasLimit > preparedGasLimit) {
    throw new Error("Mined transaction gas limit exceeds the reviewed limit");
  }

  let minedFeeCeiling;
  let feeMode;
  if (transaction.maxFeePerGas !== undefined && transaction.maxFeePerGas !== null) {
    if (
      transaction.maxPriorityFeePerGas === undefined ||
      transaction.maxPriorityFeePerGas === null
    ) {
      throw new Error("Mined EIP-1559 transaction has no priority-fee ceiling");
    }
    minedFeeCeiling = BigInt(transaction.maxFeePerGas);
    const minedPriorityFee = BigInt(transaction.maxPriorityFeePerGas);
    if (minedPriorityFee > preparedMaxPriorityFeePerGas) {
      throw new Error(
        "Mined transaction priority-fee ceiling exceeds the reviewed limit",
      );
    }
    feeMode = "eip1559";
  } else if (transaction.gasPrice !== undefined && transaction.gasPrice !== null) {
    minedFeeCeiling = BigInt(transaction.gasPrice);
    feeMode = "legacy";
  } else {
    throw new Error("Mined transaction has no enforceable fee ceiling");
  }
  if (minedFeeCeiling > preparedMaxFeePerGas) {
    throw new Error("Mined transaction fee ceiling exceeds the reviewed limit");
  }

  const maximumPossibleDebit =
    minedGasLimit * minedFeeCeiling + BigInt(transaction.value);
  const preparedMaximum = BigInt(preparedMaximumTotalDebitWei);
  if (maximumPossibleDebit > preparedMaximum) {
    throw new Error(
      "Mined transaction maximum debit exceeds the prepared maximum",
    );
  }
  return {
    feeMode,
    minedGasLimit: minedGasLimit.toString(),
    minedFeeCeilingWei: minedFeeCeiling.toString(),
    maximumPossibleDebitWei: maximumPossibleDebit.toString(),
    preparedMaximumTotalDebitWei: preparedMaximum.toString(),
  };
}

function decimal(value) {
  return BigInt(value).toString();
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireDualRpcConfiguration() {
  if (
    RPC_ENDPOINTS.length !== 2 ||
    RPC_ENDPOINTS[0] === RPC_ENDPOINTS[1] ||
    RPC_ENDPOINTS.some((endpoint) => new URL(endpoint).protocol !== "https:")
  ) {
    throw new Error("Two distinct HTTPS Ethereum Mainnet RPCs are required");
  }
}

async function performRpc(endpoint, method, params) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      const payload = await response.json();
      if (payload?.error) {
        throw new Error(
          `${method} failed on ${new URL(endpoint).hostname}: ${payload.error.message}`,
        );
      }
      return payload?.result;
    }
    if (![429, 502, 503].includes(response.status)) {
      throw new Error(
        `${method} returned HTTP ${response.status} from ${new URL(endpoint).hostname}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
  }
  throw new Error(
    `${method} remained rate-limited on ${new URL(endpoint).hostname}`,
  );
}

async function rpc(endpoint, method, params = []) {
  const previous = rpcQueues.get(endpoint) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => performRpc(endpoint, method, params));
  rpcQueues.set(endpoint, current);
  return current;
}

async function contractRead(
  endpoint,
  address,
  abi,
  functionName,
  args = [],
  blockTag = "latest",
) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpc(endpoint, "eth_call", [{ to: address, data }, blockTag]);
  return decodeFunctionResult({ abi, functionName, data: result });
}

function assertFrozenContractSource() {
  execFileSync("git", ["cat-file", "-e", `${RELEASE_COMMIT}^{commit}`], {
    cwd: repositoryRoot,
  });
  const drift = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      RELEASE_COMMIT,
      "--",
      "contracts/src",
      "contracts/foundry.toml",
      "contracts/lib",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (drift.length > 0) {
    throw new Error("The deployed Deep contract source has changed");
  }
}

export function reviewedKeeperExecutorSourceCommitment() {
  const gasPolicyCommitment = keccak256(
    encodeAbiParameters(
      Array.from({ length: 7 }, () => ({ type: "uint256" })),
      [8n, 150_000n, 700_000n, 220_000n, 450_000n, 25_000n, 25_000n],
    ),
  );
  const resultPolicyCommitment = keccak256(
    stringToHex(
      "one-result-per-candidate:fresh-assessment:skip-none-or-drift:bounded-per-action-call",
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        REVIEWED_KEEPER_EXECUTOR_CREATION_CODE_HASH,
        getAddress(AUTOMATION),
        runtimeHashes[AUTOMATION],
        gasPolicyCommitment,
        resultPolicyCommitment,
      ],
    ),
  );
}

export function predictKeeperExecutorAddress(deployer, nonce) {
  return normalizeHex(
    getContractAddress({
      from: getAddress(deployer),
      nonce: BigInt(nonce),
    }),
  );
}

async function keeperExecutorDeploymentData() {
  let artifact;
  try {
    artifact = JSON.parse(await readFile(keeperExecutorArtifactPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "Missing DeepKeeperExecutorV1 Forge artifact; run the reviewed Forge build",
      );
    }
    throw error;
  }
  const creationCode = normalizeHex(artifact?.bytecode?.object);
  if (
    !/^0x[0-9a-f]+$/.test(creationCode) ||
    creationCode.length % 2 !== 0 ||
    keccak256(creationCode) !== REVIEWED_KEEPER_EXECUTOR_CREATION_CODE_HASH
  ) {
    throw new Error("DeepKeeperExecutorV1 creation artifact is not reviewed");
  }
  if (
    reviewedKeeperExecutorSourceCommitment() !==
    REVIEWED_KEEPER_EXECUTOR_SOURCE_COMMITMENT
  ) {
    throw new Error("DeepKeeperExecutorV1 reviewed policy commitment changed");
  }
  const constructorArguments = encodeAbiParameters(
    [{ type: "address" }],
    [getAddress(AUTOMATION)],
  );
  return `${creationCode}${constructorArguments.slice(2)}`;
}

async function assertRuntime(endpoint) {
  for (const [address, expectedHash] of Object.entries(runtimeHashes)) {
    const code = await rpc(endpoint, "eth_getCode", [address, "latest"]);
    if (normalizeHex(code) === "0x" || keccak256(code) !== expectedHash) {
      throw new Error(`Pinned runtime mismatch at ${address}`);
    }
  }
}

async function assertKeeperExecutor(endpoint, executorAddress) {
  if (!executorAddress) throw new Error("DeepKeeperExecutorV1 address is required");
  if (
    Object.keys(runtimeHashes).includes(executorAddress) ||
    executorAddress === ACCOUNT
  ) {
    throw new Error("DeepKeeperExecutorV1 address aliases a pinned dependency");
  }
  const [code, boundAutomation] = await Promise.all([
    rpc(endpoint, "eth_getCode", [executorAddress, "latest"]),
    contractRead(
      endpoint,
      executorAddress,
      keeperExecutorAbi,
      "automation",
    ),
  ]);
  if (
    normalizeHex(code) === "0x" ||
    keccak256(code) !== REVIEWED_KEEPER_EXECUTOR_RUNTIME_HASH
  ) {
    throw new Error("DeepKeeperExecutorV1 runtime does not match the reviewed hash");
  }
  if (normalizeHex(boundAutomation) !== AUTOMATION) {
    throw new Error("DeepKeeperExecutorV1 is not bound to canonical Automation");
  }
}

function launchData() {
  return encodeFunctionData({
    abi: launcherAbi,
    functionName: "launch",
    args: [launchParameters],
  });
}

export function oracleBatchRepeatCount(
  currentCardinalityNext,
  target = OBSERVATION_TARGET,
  step = OBSERVATION_STEP,
) {
  if (
    !Number.isInteger(currentCardinalityNext) ||
    !Number.isInteger(target) ||
    !Number.isInteger(step) ||
    currentCardinalityNext <= 0 ||
    target < currentCardinalityNext ||
    step <= 0
  ) {
    throw new Error("Invalid oracle-cardinality state");
  }
  let current = currentCardinalityNext;
  let repeats = 0;
  while (current < target) {
    current = Math.min(target, current + step);
    repeats += 1;
  }
  return repeats;
}

export function decideLifecycleAction(state, evidence) {
  const recorded = evidence?.transactions ?? {};
  if (!state.launched) {
    if (recorded.launch) throw new Error("Recorded launch state disappeared");
    return "launch";
  }
  if (!recorded.launch) {
    throw new Error("Token exists without a recorded lifecycle launch receipt");
  }
  if (state.cardinalityNext < OBSERVATION_TARGET) {
    if (recorded.grow_oracle) {
      throw new Error("Recorded oracle growth did not reach 192");
    }
    if (state.cardinalityNext !== 2) {
      throw new Error(
        "Oracle cardinality advanced outside the reviewed 2-to-192 batch",
      );
    }
    return "grow_oracle";
  }
  if (!recorded.grow_oracle) {
    throw new Error("Oracle reached 192 without the reviewed growth receipt");
  }
  if (!state.oracleReady) return "wait_twap";
  if (!recorded.fee_process_compound) {
    if (BigInt(state.creatorFeesAccrued) === 0n) {
      throw new Error(
        "Creator fees disappeared before the combined process-and-compound action",
      );
    }
    return "fee_process_compound";
  }
  return "complete";
}

function emptyEvidence(planDigest) {
  return {
    schemaVersion: 2,
    planDigest,
    releaseCommit: RELEASE_COMMIT,
    chainId: 1,
    account: ACCOUNT,
    launcher: LAUNCHER,
    automation: AUTOMATION,
    feeHook: FEE_HOOK,
    keeperExecutor: null,
    keeperExecutorRuntimeCodeHash: null,
    executorDeployment: null,
    token: null,
    growthVault: null,
    poolId: null,
    launchHash: null,
    launch: null,
    oracleTransaction: null,
    feeProcessCompoundTransaction: null,
    prepared: null,
    transactions: {
      deploy_keeper_executor: null,
      launch: null,
      grow_oracle: null,
      fee_process_compound: null,
    },
    finalPostState: null,
  };
}

function resolvedKeeperExecutor(evidence) {
  const recorded = evidence?.keeperExecutor
    ? normalizeOptionalAddress(evidence.keeperExecutor)
    : null;
  if (
    KEEPER_EXECUTOR_ADDRESS &&
    recorded &&
    KEEPER_EXECUTOR_ADDRESS !== recorded
  ) {
    throw new Error(
      "Configured DeepKeeperExecutorV1 differs from recorded deployment",
    );
  }
  return KEEPER_EXECUTOR_ADDRESS ?? recorded;
}

async function readEvidence(planDigest) {
  try {
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    if (evidence.planDigest !== planDigest) {
      throw new Error("Existing lifecycle evidence belongs to another plan");
    }
    return evidence;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return emptyEvidence(planDigest);
  }
}

async function writeEvidence(evidence) {
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function buildPlan() {
  requireDualRpcConfiguration();
  assertFrozenContractSource();
  await Promise.all(RPC_ENDPOINTS.map(assertRuntime));
  const tokens = await Promise.all(
    RPC_ENDPOINTS.map((endpoint) =>
      contractRead(endpoint, LAUNCHER, launcherAbi, "predictTokenAddress", [
        launchParameters.name,
        launchParameters.symbol,
        getAddress(ACCOUNT),
        CREATOR_SALT,
      ]),
    ),
  );
  const token = normalizeHex(tokens[0][0]);
  if (token !== normalizeHex(tokens[1][0])) {
    throw new Error("Independent Mainnet RPCs disagree on the predicted token");
  }
  const data = launchData();
  const planDigest = keccak256(
    stringToHex(
      JSON.stringify({
        releaseCommit: RELEASE_COMMIT,
        account: ACCOUNT,
        launcher: LAUNCHER,
        automation: AUTOMATION,
        token,
        creatorSalt: CREATOR_SALT,
        buyFeeBps: BUY_FEE_BPS,
        sellFeeBps: SELL_FEE_BPS,
        initialBuyWei: INITIAL_BUY_WEI.toString(),
        keeperExecutorCreationCodeHash:
          REVIEWED_KEEPER_EXECUTOR_CREATION_CODE_HASH,
        keeperExecutorRuntimeHash:
          REVIEWED_KEEPER_EXECUTOR_RUNTIME_HASH,
        keeperExecutorSourceCommitment:
          REVIEWED_KEEPER_EXECUTOR_SOURCE_COMMITMENT,
        calldataHash: keccak256(data),
      }),
    ),
  );
  return Object.freeze({ planDigest, token, launchData: data });
}

async function endpointState(endpoint, token, blockTag = "latest") {
  const historical = blockTag !== "latest";
  const read = (address, abi, functionName, args = []) =>
    contractRead(endpoint, address, abi, functionName, args, blockTag);
  const [
    chainId,
    confirmedNonce,
    pendingNonce,
    balance,
    gasPrice,
    block,
    tokenCode,
    growthVault,
    launchHash,
  ] = await Promise.all([
    rpc(endpoint, "eth_chainId"),
    rpc(endpoint, "eth_getTransactionCount", [ACCOUNT, blockTag]),
    rpc(endpoint, "eth_getTransactionCount", [
      ACCOUNT,
      historical ? blockTag : "pending",
    ]),
    rpc(endpoint, "eth_getBalance", [ACCOUNT, blockTag]),
    rpc(endpoint, "eth_gasPrice"),
    rpc(endpoint, "eth_getBlockByNumber", [blockTag, false]),
    rpc(endpoint, "eth_getCode", [token, blockTag]),
    read(LAUNCHER, launcherAbi, "growthVaultOf", [token]),
    read(LAUNCHER, launcherAbi, "launchHashOf", [token]),
  ]);
  if (normalizeHex(chainId) !== CHAIN_ID) {
    throw new Error("A lifecycle RPC is not connected to Ethereum Mainnet");
  }
  const base = {
    chainId: normalizeHex(chainId),
    confirmedNonce: normalizeHex(confirmedNonce),
    pendingNonce: normalizeHex(pendingNonce),
    balance: normalizeHex(balance),
    gasPrice: normalizeHex(gasPrice),
    blockNumber: normalizeHex(block.number),
    blockHash: normalizeHex(block.hash),
    blockTimestamp: decimal(block.timestamp),
    baseFeePerGas: decimal(block.baseFeePerGas ?? gasPrice),
    tokenCode: normalizeHex(tokenCode),
    launched: normalizeHex(tokenCode) !== "0x",
    growthVault: normalizeHex(growthVault),
    launchHash: normalizeHex(launchHash),
  };
  if (!base.launched) {
    return {
      ...base,
      poolId: null,
      registered: false,
      oracleGuard: ZERO_ADDRESS,
      upstreamVault: ZERO_ADDRESS,
      vaultToken: ZERO_ADDRESS,
      configurationHash: ZERO_BYTES32,
      initialPositionTokenId: "0",
      initialPositionRecipient: ZERO_ADDRESS,
      initialPositionOwner: ZERO_ADDRESS,
      initialPositionLiquidity: "0",
      cardinality: 0,
      cardinalityNext: 0,
      creatorFeesAccrued: "0",
      buySwapFeeBps: 0,
      sellSwapFeeBps: 0,
      oracleReady: false,
      twapWindow: 1800,
      automationAction: 0,
      totalCreatorFeesReceived: "0",
      totalNativeAllocatedToGrowth: "0",
      pendingGrowthNative: "0",
      totalNativeAddedToLiquidity: "0",
      totalTokenAddedToLiquidity: "0",
      totalLiquidityAdded: "0",
      lockedLiquidity: "0",
      lastCompoundTimestamp: "0",
      nextCompoundTimestamp: "0",
      trustedNativeDepth: "0",
      depthCapNative: "0",
    };
  }
  if (base.growthVault === ZERO_ADDRESS || base.launchHash === ZERO_BYTES32) {
    throw new Error("The lifecycle launch registry is incomplete");
  }
  const vaultCode = await rpc(endpoint, "eth_getCode", [
    base.growthVault,
    blockTag,
  ]);
  if (normalizeHex(vaultCode) === "0x") {
    throw new Error("The registered lifecycle vault has no code");
  }
  const [
    poolId,
    registered,
    oracleGuard,
    upstreamVault,
    vaultToken,
    configurationHash,
    initialPositionTokenId,
    initialPositionRecipient,
    totalCreatorFeesReceived,
    totalNativeAllocatedToGrowth,
    pendingGrowthNative,
    totalNativeAddedToLiquidity,
    totalTokenAddedToLiquidity,
    totalLiquidityAdded,
    lockedLiquidity,
    lastCompoundTimestamp,
    oracleReady,
    workState,
  ] = await Promise.all([
    read(base.growthVault, vaultAbi, "poolId"),
    read(AUTOMATION, automationAbi, "isRegisteredVault", [
      base.growthVault,
    ]),
    read(base.growthVault, vaultAbi, "oracleGuard"),
    read(base.growthVault, vaultAbi, "upstreamVault"),
    read(base.growthVault, vaultAbi, "token"),
    read(base.growthVault, vaultAbi, "configurationHash"),
    read(base.growthVault, vaultAbi, "initialPositionTokenId"),
    read(base.growthVault, vaultAbi, "initialPositionRecipient"),
    read(base.growthVault, vaultAbi, "totalCreatorFeesReceived"),
    read(
      base.growthVault,
      vaultAbi,
      "totalNativeAllocatedToGrowth",
    ),
    read(base.growthVault, vaultAbi, "pendingGrowthNative"),
    read(
      base.growthVault,
      vaultAbi,
      "totalNativeAddedToLiquidity",
    ),
    read(
      base.growthVault,
      vaultAbi,
      "totalTokenAddedToLiquidity",
    ),
    read(base.growthVault, vaultAbi, "totalLiquidityAdded"),
    read(base.growthVault, vaultAbi, "lockedLiquidity"),
    read(base.growthVault, vaultAbi, "lastCompoundTimestamp"),
    read(base.growthVault, vaultAbi, "oracleReady"),
    read(base.growthVault, vaultAbi, "workState"),
  ]);
  if (!registered || normalizeHex(vaultToken) !== token) {
    throw new Error("The lifecycle vault is not canonically registered");
  }
  const [oracleState, feeConfig, twapWindow, automationAction, owner, liquidity] =
    await Promise.all([
      read(FEE_HOOK, hookAbi, "stateById", [poolId]),
      read(FEE_HOOK, hookAbi, "poolFeeConfig", [poolId]),
      read(oracleGuard, guardAbi, "twapWindow"),
      read(AUTOMATION, automationAbi, "checkVault", [
        base.growthVault,
      ]),
      read(
        POSITION_MANAGER,
        positionManagerAbi,
        "ownerOf",
        [initialPositionTokenId],
      ),
      read(
        POSITION_MANAGER,
        positionManagerAbi,
        "getPositionLiquidity",
        [initialPositionTokenId],
      ),
    ]);
  if (
    normalizeHex(feeConfig[0]) !== normalizeHex(upstreamVault) ||
    !feeConfig[3] ||
    Number(feeConfig[1]) !== BUY_FEE_BPS ||
    Number(feeConfig[2]) !== SELL_FEE_BPS
  ) {
    throw new Error("The lifecycle pool fee configuration is not exact");
  }
  return {
    ...base,
    poolId: normalizeHex(poolId),
    registered: Boolean(registered),
    oracleGuard: normalizeHex(oracleGuard),
    upstreamVault: normalizeHex(upstreamVault),
    vaultToken: normalizeHex(vaultToken),
    configurationHash: normalizeHex(configurationHash),
    initialPositionTokenId: decimal(initialPositionTokenId),
    initialPositionRecipient: normalizeHex(initialPositionRecipient),
    initialPositionOwner: normalizeHex(owner),
    initialPositionLiquidity: decimal(liquidity),
    cardinality: Number(oracleState[1]),
    cardinalityNext: Number(oracleState[2]),
    creatorFeesAccrued: decimal(feeConfig[5]),
    buySwapFeeBps: Number(feeConfig[1]),
    sellSwapFeeBps: Number(feeConfig[2]),
    oracleReady: Boolean(oracleReady),
    twapWindow: Number(twapWindow),
    automationAction: Number(automationAction),
    totalCreatorFeesReceived: decimal(totalCreatorFeesReceived),
    totalNativeAllocatedToGrowth: decimal(totalNativeAllocatedToGrowth),
    pendingGrowthNative: decimal(pendingGrowthNative),
    totalNativeAddedToLiquidity: decimal(totalNativeAddedToLiquidity),
    totalTokenAddedToLiquidity: decimal(totalTokenAddedToLiquidity),
    totalLiquidityAdded: decimal(totalLiquidityAdded),
    lockedLiquidity: decimal(lockedLiquidity),
    lastCompoundTimestamp: decimal(lastCompoundTimestamp),
    nextCompoundTimestamp: decimal(workState[3]),
    trustedNativeDepth: decimal(workState[4]),
    depthCapNative: decimal(workState[5]),
  };
}

async function reconcile(token, blockTag = "latest") {
  requireDualRpcConfiguration();
  const states = await Promise.all(
    RPC_ENDPOINTS.map((endpoint) => endpointState(endpoint, token, blockTag)),
  );
  const [left, right] = states;
  for (const field of [
    "chainId",
    "confirmedNonce",
    "pendingNonce",
    "tokenCode",
    "launched",
    "growthVault",
    "launchHash",
    "poolId",
    "registered",
    "oracleGuard",
    "upstreamVault",
    "vaultToken",
    "configurationHash",
    "initialPositionTokenId",
    "initialPositionRecipient",
    "initialPositionOwner",
    "initialPositionLiquidity",
    "cardinality",
    "cardinalityNext",
    "creatorFeesAccrued",
    "buySwapFeeBps",
    "sellSwapFeeBps",
    "oracleReady",
    "twapWindow",
    "automationAction",
    "totalCreatorFeesReceived",
    "totalNativeAllocatedToGrowth",
    "pendingGrowthNative",
    "totalNativeAddedToLiquidity",
    "totalTokenAddedToLiquidity",
    "totalLiquidityAdded",
    "lockedLiquidity",
    "lastCompoundTimestamp",
    "nextCompoundTimestamp",
    "trustedNativeDepth",
    "depthCapNative",
  ]) {
    if (left[field] !== right[field]) {
      throw new Error(`Independent Mainnet RPCs disagree on ${field}`);
    }
  }
  const blockDelta =
    BigInt(left.blockNumber) > BigInt(right.blockNumber)
      ? BigInt(left.blockNumber) - BigInt(right.blockNumber)
      : BigInt(right.blockNumber) - BigInt(left.blockNumber);
  if (blockDelta > 4n) {
    throw new Error("Independent Mainnet RPC heads differ by more than four blocks");
  }
  return {
    ...left,
    balance:
      BigInt(left.balance) < BigInt(right.balance)
        ? left.balance
        : right.balance,
    gasPrice:
      BigInt(left.gasPrice) > BigInt(right.gasPrice)
        ? left.gasPrice
        : right.gasPrice,
    baseFeePerGas:
      BigInt(left.baseFeePerGas) > BigInt(right.baseFeePerGas)
        ? left.baseFeePerGas
        : right.baseFeePerGas,
    blockTimestamp:
      BigInt(left.blockTimestamp) < BigInt(right.blockTimestamp)
        ? left.blockTimestamp
        : right.blockTimestamp,
  };
}

async function actionRequest(action, plan, state, executorAddress) {
  if (action === "deploy_keeper_executor") {
    const data = await keeperExecutorDeploymentData();
    const predicted = predictKeeperExecutorAddress(
      ACCOUNT,
      state.confirmedNonce,
    );
    const codes = await Promise.all(
      RPC_ENDPOINTS.map((endpoint) =>
        rpc(endpoint, "eth_getCode", [predicted, "latest"]),
      ),
    );
    if (codes.some((code) => normalizeHex(code) !== "0x")) {
      throw new Error("Predicted DeepKeeperExecutorV1 address is occupied");
    }
    return {
      label: "Deploy reviewed DeepKeeperExecutorV1",
      to: null,
      predicted,
      value: 0n,
      data,
      details: {
        predictedExecutor: predicted,
        creationCodeHash: REVIEWED_KEEPER_EXECUTOR_CREATION_CODE_HASH,
        sourceCommitment: REVIEWED_KEEPER_EXECUTOR_SOURCE_COMMITMENT,
        expectedRuntimeHash: REVIEWED_KEEPER_EXECUTOR_RUNTIME_HASH,
        canonicalAutomation: AUTOMATION,
      },
    };
  }
  if (action === "launch") {
    return {
      label: "Launch Deep Lifecycle 2026",
      to: LAUNCHER,
      value: INITIAL_BUY_WEI,
      data: plan.launchData,
      details: {
        buyFeeBps: BUY_FEE_BPS,
        sellFeeBps: SELL_FEE_BPS,
        expectedCreatorFeesWei: (
          (INITIAL_BUY_WEI * BigInt(BUY_FEE_BPS - 10)) /
          10_000n
        ).toString(),
      },
    };
  }
  if (!state.growthVault || state.growthVault === ZERO_ADDRESS) {
    throw new Error("The canonical lifecycle vault is unavailable");
  }
  if (action === "grow_oracle") {
    const repeats = oracleBatchRepeatCount(state.cardinalityNext);
    const candidates = Array.from(
      { length: repeats },
      () => getAddress(state.growthVault),
    );
    if (
      candidates.length === 0 ||
      candidates.length > 32 ||
      candidates.some(
        (candidate) =>
          normalizeHex(candidate) !== normalizeHex(state.growthVault),
      )
    ) {
      throw new Error("Oracle batch is not the repeated canonical vault");
    }
    return {
      label: `Grow oracle ${state.cardinalityNext} → 192`,
      to: AUTOMATION,
      value: 0n,
      data: encodeFunctionData({
        abi: automationAbi,
        functionName: "stageOracleBatch",
        args: [candidates],
      }),
      details: {
        repeatedCanonicalVault: state.growthVault,
        repetitions: repeats,
        targetCardinalityNext: OBSERVATION_TARGET,
      },
    };
  }
  if (action === "fee_process_compound") {
    if (state.automationAction !== 1) {
      throw new Error("Automation does not assess ProcessFees as ready");
    }
    if (
      BigInt(state.creatorFeesAccrued) < BigInt(state.depthCapNative) ||
      BigInt(state.depthCapNative) < 2_000_000_000_000_000n
    ) {
      throw new Error("The first reviewed safe full-range chunk is not funded");
    }
    if (!executorAddress) {
      throw new Error("DeepKeeperExecutorV1 must be deployed first");
    }
    await Promise.all(
      RPC_ENDPOINTS.map((endpoint) =>
        assertKeeperExecutor(endpoint, executorAddress),
      ),
    );
    return {
      label: "Process fees and compound through DeepKeeperExecutorV1",
      to: executorAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: keeperExecutorAbi,
        functionName: "execute",
        args: [
          [
            {
              vault: getAddress(state.growthVault),
              expectedAction: 1,
            },
          ],
        ],
      }),
      details: {
        executor: executorAddress,
        executorRuntimeHash: REVIEWED_KEEPER_EXECUTOR_RUNTIME_HASH,
        canonicalVault: state.growthVault,
        expectedAction: 1,
        expectedOutcome: 4,
        creatorFeesAccruedWei: state.creatorFeesAccrued,
        safeDepthCapWei: state.depthCapNative,
      },
    };
  }
  throw new Error(`Unsupported lifecycle action ${action}`);
}

async function dualSimulations(request) {
  const checks = await Promise.all(
    RPC_ENDPOINTS.map(async (endpoint) => {
      const [result, estimate] = await Promise.all([
        rpc(endpoint, "eth_call", [request, "pending"]),
        rpc(endpoint, "eth_estimateGas", [request, "pending"]),
      ]);
      return {
        resultHash: keccak256(result),
        estimatedGas: normalizeHex(estimate),
      };
    }),
  );
  if (checks[0].resultHash !== checks[1].resultHash) {
    throw new Error("Independent Mainnet simulations disagree");
  }
  return checks;
}

function actionPostState(state) {
  return {
    blockNumber: decimal(state.blockNumber),
    blockHash: state.blockHash,
    blockTimestamp: state.blockTimestamp,
    token: state.vaultToken,
    growthVault: state.growthVault,
    poolId: state.poolId,
    launchHash: state.launchHash,
    configurationHash: state.configurationHash,
    oracleGuard: state.oracleGuard,
    upstreamVault: state.upstreamVault,
    initialPositionTokenId: state.initialPositionTokenId,
    initialPositionRecipient: state.initialPositionRecipient,
    initialPositionOwner: state.initialPositionOwner,
    initialPositionLiquidity: state.initialPositionLiquidity,
    oracleCardinality: state.cardinality,
    oracleCardinalityNext: state.cardinalityNext,
    creatorFeesAccruedWei: state.creatorFeesAccrued,
    totalCreatorFeesReceivedWei: state.totalCreatorFeesReceived,
    totalNativeAllocatedToGrowthWei: state.totalNativeAllocatedToGrowth,
    pendingGrowthNativeWei: state.pendingGrowthNative,
    totalNativeAddedToLiquidityWei: state.totalNativeAddedToLiquidity,
    totalTokenAddedToLiquidity: state.totalTokenAddedToLiquidity,
    totalLiquidityAdded: state.totalLiquidityAdded,
    lockedFullRangeLiquidity: state.lockedLiquidity,
    lastCompoundTimestamp: state.lastCompoundTimestamp,
    oracleReady: state.oracleReady,
  };
}

function validateProgress(evidence, state) {
  if (state.launched) {
    if (
      normalizeHex(state.vaultToken) === ZERO_ADDRESS ||
      normalizeHex(state.vaultToken) !== normalizeHex(evidence.token ?? state.vaultToken)
    ) {
      throw new Error("Lifecycle token binding changed");
    }
  }
  if (evidence.growthVault && evidence.growthVault !== state.growthVault) {
    throw new Error("Lifecycle growth vault changed");
  }
  if (evidence.poolId && evidence.poolId !== state.poolId) {
    throw new Error("Lifecycle pool changed");
  }
  const productive = evidence.transactions.fee_process_compound;
  if (productive) {
    const before = productive.preState;
    if (
      BigInt(state.totalCreatorFeesReceived) <=
        BigInt(before.totalCreatorFeesReceivedWei) ||
      BigInt(state.totalNativeAllocatedToGrowth) <=
        BigInt(before.totalNativeAllocatedToGrowthWei)
    ) {
      throw new Error("Recorded process receipt did not pull creator fees");
    }
  }
}

async function inspect(plan) {
  const [state, evidence] = await Promise.all([
    reconcile(plan.token),
    readEvidence(plan.planDigest),
  ]);
  if (state.confirmedNonce !== state.pendingNonce) {
    throw new Error("Another transaction is pending from the required wallet");
  }
  const executorAddress = resolvedKeeperExecutor(evidence);
  if (executorAddress) {
    await Promise.all(
      RPC_ENDPOINTS.map((endpoint) =>
        assertKeeperExecutor(endpoint, executorAddress),
      ),
    );
  }
  const action = executorAddress
    ? decideLifecycleAction(state, evidence)
    : "deploy_keeper_executor";
  validateProgress(evidence, state);
  if (action === "wait_twap") {
    const oldestRelevantTimestamp =
      evidence.transactions.launch?.receipt?.blockTimestamp;
    const matureAt = oldestRelevantTimestamp
      ? BigInt(oldestRelevantTimestamp) + BigInt(state.twapWindow)
      : null;
    return {
      status: "waiting",
      action,
      state,
      evidence,
      prepared: null,
      wait: {
        twapWindowSeconds: state.twapWindow,
        matureAt: matureAt?.toString() ?? null,
        currentBlockTimestamp: state.blockTimestamp,
        initializationObservationPresent: state.cardinality >= 1,
        additionalObservationRequired: false,
      },
    };
  }
  if (action === "complete") {
    verifyFinalPostState(evidence, state);
    return {
      status: "complete",
      action,
      state,
      evidence,
      prepared: null,
    };
  }
  const base = await actionRequest(action, plan, state, executorAddress);
  const unsigned = {
    from: ACCOUNT,
    nonce: state.confirmedNonce,
    value: quantity(base.value),
    data: base.data,
    ...(base.to ? { to: base.to } : {}),
  };
  const simulations = await dualSimulations(unsigned);
  if (
    action === "deploy_keeper_executor" &&
    simulations.some(
      (simulation) =>
        simulation.resultHash !== REVIEWED_KEEPER_EXECUTOR_RUNTIME_HASH,
    )
  ) {
    throw new Error(
      "Independent deployment simulations did not return the reviewed runtime",
    );
  }
  const estimate =
    BigInt(simulations[0].estimatedGas) >
    BigInt(simulations[1].estimatedGas)
      ? BigInt(simulations[0].estimatedGas)
      : BigInt(simulations[1].estimatedGas);
  const gasLimit = (estimate * 125n + 99n) / 100n + 25_000n;
  const ceiling = gasCeilings[action];
  if (!ceiling || gasLimit > ceiling) {
    throw new Error(`${base.label} exceeds its reviewed gas ceiling`);
  }
  const priorityFee = 100_000_000n;
  const maxFeePerGas =
    BigInt(state.baseFeePerGas) * 2n + priorityFee >
    (BigInt(state.gasPrice) * 125n + 99n) / 100n
      ? BigInt(state.baseFeePerGas) * 2n + priorityFee
      : (BigInt(state.gasPrice) * 125n + 99n) / 100n;
  if (maxFeePerGas > MAX_FEE_PER_GAS_WEI) {
    throw new Error("Current Mainnet fees exceed the reviewed 10 gwei ceiling");
  }
  const maximumGasDebit = gasLimit * maxFeePerGas;
  const maximumTotalDebit = maximumGasDebit + base.value;
  if (BigInt(state.balance) < maximumTotalDebit) {
    throw new Error("Wallet balance is below the exact prepared debit ceiling");
  }
  const request = {
    ...unsigned,
    gas: quantity(gasLimit),
    maxFeePerGas: quantity(maxFeePerGas),
    maxPriorityFeePerGas: quantity(priorityFee),
  };
  const preparedDigest = keccak256(
    stringToHex(
      JSON.stringify({
        planDigest: plan.planDigest,
        action,
        state: {
          confirmedNonce: state.confirmedNonce,
          blockHash: state.blockHash,
        },
        request,
        liveEstimatedGas: quantity(estimate),
        details: base.details,
      }),
    ),
  );
  evidence.prepared = {
    action,
    preparedDigest,
    request,
    reviewedGasLimit: gasLimit.toString(),
    reviewedMaxFeePerGasWei: maxFeePerGas.toString(),
    reviewedMaxPriorityFeePerGasWei: priorityFee.toString(),
    maximumGasDebitWei: maximumGasDebit.toString(),
    maximumTotalDebitWei: maximumTotalDebit.toString(),
    details: base.details,
    preState: actionPostState(state),
  };
  await writeEvidence(evidence);
  return {
    status: "ready",
    action,
    state,
    evidence,
    prepared: {
      action,
      label: base.label,
      target: base.to ?? base.predicted,
      predictedContractAddress: base.predicted ?? null,
      token: plan.token,
      growthVault: state.growthVault,
      valueWei: base.value.toString(),
      valueEth: formatEther(base.value),
      calldataHash: keccak256(base.data),
      liveEstimatedGas: estimate.toString(),
      gasLimit: gasLimit.toString(),
      maxFeePerGasWei: maxFeePerGas.toString(),
      maximumGasDebitWei: maximumGasDebit.toString(),
      maximumGasDebitEth: formatEther(maximumGasDebit),
      maximumTotalDebitWei: maximumTotalDebit.toString(),
      maximumTotalDebitEth: formatEther(maximumTotalDebit),
      walletBalanceWei: decimal(state.balance),
      walletBalanceEth: formatEther(BigInt(state.balance)),
      preparedDigest,
      details: base.details,
      request,
    },
    simulations: simulations.map((check, index) => ({
      rpc: index === 0 ? "A" : "B",
      resultHash: check.resultHash,
      estimatedGas: decimal(check.estimatedGas),
    })),
  };
}

function comparableReceipt(receipt) {
  return {
    transactionHash: normalizeHex(receipt.transactionHash),
    transactionIndex: normalizeHex(receipt.transactionIndex),
    blockHash: normalizeHex(receipt.blockHash),
    blockNumber: normalizeHex(receipt.blockNumber),
    from: normalizeHex(receipt.from),
    to: normalizeHex(receipt.to),
    contractAddress: normalizeHex(receipt.contractAddress),
    cumulativeGasUsed: normalizeHex(receipt.cumulativeGasUsed),
    gasUsed: normalizeHex(receipt.gasUsed),
    effectiveGasPrice: normalizeHex(receipt.effectiveGasPrice),
    status: normalizeHex(receipt.status),
    logs: receipt.logs.map((log) => ({
      address: normalizeHex(log.address),
      topics: log.topics.map(normalizeHex),
      data: normalizeHex(log.data),
      logIndex: normalizeHex(log.logIndex),
    })),
  };
}

function decodedLifecycleEvents(receipt, vault, executorAddress) {
  const candidateResults = [];
  const workPerformed = [];
  const creatorFeesProcessed = [];
  const liquidityCompounded = [];
  for (const log of receipt.logs) {
    try {
      if (
        normalizeHex(log.address) !== normalizeHex(executorAddress)
      ) {
        throw new Error("not executor");
      }
      const decoded = decodeEventLog({
        abi: keeperExecutorAbi,
        topics: log.topics,
        data: log.data,
        strict: true,
      });
      if (decoded.eventName === "CandidateResult") {
        candidateResults.push(decoded.args);
        continue;
      }
    } catch {
      // The receipt contains downstream events from other exact-bound contracts.
    }
    try {
      const decoded = decodeEventLog({
        abi: lifecycleEventAbi,
        topics: log.topics,
        data: log.data,
        strict: true,
      });
      if (decoded.eventName === "WorkPerformed") {
        if (normalizeHex(log.address) === AUTOMATION) {
          workPerformed.push(decoded.args);
        }
      } else if (decoded.eventName === "CreatorFeesProcessed") {
        if (normalizeHex(log.address) === normalizeHex(vault)) {
          creatorFeesProcessed.push(decoded.args);
        }
      } else if (decoded.eventName === "LiquidityCompounded") {
        if (normalizeHex(log.address) === normalizeHex(vault)) {
          liquidityCompounded.push(decoded.args);
        }
      }
    } catch {
      // Unknown receipt events are retained in the exact receipt but ignored here.
    }
  }
  return {
    candidateResults,
    workPerformed,
    creatorFeesProcessed,
    liquidityCompounded,
  };
}

function requireOracleGrowthEvents(receipt, vault, poolId, expectedCount) {
  const events = [];
  for (const log of receipt.logs) {
    if (normalizeHex(log.address) !== AUTOMATION) continue;
    try {
      const decoded = decodeEventLog({
        abi: lifecycleEventAbi,
        topics: log.topics,
        data: log.data,
        strict: true,
      });
      if (decoded.eventName === "OracleGrowthStaged") {
        events.push(decoded.args);
      }
    } catch {
      // Other canonical Automation logs are retained in the exact receipt.
    }
  }
  if (events.length !== expectedCount) {
    throw new Error("Oracle batch receipt has missing or duplicate growth events");
  }
  let expectedPrevious = 2;
  for (const event of events) {
    const expectedNext = Math.min(
      OBSERVATION_TARGET,
      expectedPrevious + OBSERVATION_STEP,
    );
    if (
      normalizeHex(event.vault) !== normalizeHex(vault) ||
      normalizeHex(event.poolId) !== normalizeHex(poolId) ||
      normalizeHex(event.executor) !== AUTOMATION ||
      Number(event.previousCardinalityNext) !== expectedPrevious ||
      Number(event.newCardinalityNext) !== expectedNext
    ) {
      throw new Error("Oracle growth event does not match the canonical sequence");
    }
    expectedPrevious = expectedNext;
  }
  if (expectedPrevious !== OBSERVATION_TARGET) {
    throw new Error("Oracle growth events do not end at cardinalityNext 192");
  }
  return events.map((event) => ({
    vault: normalizeHex(event.vault),
    poolId: normalizeHex(event.poolId),
    executor: normalizeHex(event.executor),
    previousCardinalityNext: Number(event.previousCardinalityNext),
    newCardinalityNext: Number(event.newCardinalityNext),
  }));
}

function requireProductiveKeeperEvents(receipt, vault, executorAddress) {
  if (!executorAddress) {
    throw new Error("DeepKeeperExecutorV1 is not configured");
  }
  const events = decodedLifecycleEvents(receipt, vault, executorAddress);
  if (
    events.candidateResults.length !== 1 ||
    events.workPerformed.length !== 1 ||
    events.creatorFeesProcessed.length !== 1 ||
    events.liquidityCompounded.length !== 1
  ) {
    throw new Error("Productive keeper receipt has missing or duplicate result events");
  }
  const result = events.candidateResults[0];
  const work = events.workPerformed[0];
  if (
    BigInt(result.candidateIndex) !== 0n ||
    normalizeHex(result.vault) !== normalizeHex(vault) ||
    normalizeHex(result.executor) !== ACCOUNT ||
    Number(result.expectedAction) !== 1 ||
    Number(result.actualAction) !== 1 ||
    Number(result.outcome) !== 4 ||
    normalizeHex(result.errorSelector) !== "0x00000000" ||
    BigInt(result.gasUsed) === 0n
  ) {
    throw new Error("DeepKeeperExecutorV1 result does not prove one successful ProcessFees action");
  }
  if (
    normalizeHex(work.vault) !== normalizeHex(vault) ||
    Number(work.action) !== 1 ||
    normalizeHex(work.executor) !== normalizeHex(executorAddress)
  ) {
    throw new Error("Automation WorkPerformed does not bind the reviewed executor action");
  }
  return {
    candidateResult: {
      batchHash: normalizeHex(result.batchHash),
      candidateIndex: decimal(result.candidateIndex),
      vault: normalizeHex(result.vault),
      executor: normalizeHex(result.executor),
      expectedAction: Number(result.expectedAction),
      actualAction: Number(result.actualAction),
      outcome: Number(result.outcome),
      errorSelector: normalizeHex(result.errorSelector),
      gasUsed: decimal(result.gasUsed),
    },
    creatorFeesProcessed: {
      receivedWei: decimal(events.creatorFeesProcessed[0].received),
      allocatedToGrowthWei: decimal(
        events.creatorFeesProcessed[0].allocatedToGrowth,
      ),
      deferredToRewardsWei: decimal(
        events.creatorFeesProcessed[0].deferredToRewards,
      ),
    },
    liquidityCompounded: {
      nativeBudgetWei: decimal(events.liquidityCompounded[0].nativeBudget),
      tokenBudget: decimal(events.liquidityCompounded[0].tokenBudget),
      nativeAddedWei: decimal(events.liquidityCompounded[0].nativeAdded),
      tokenAdded: decimal(events.liquidityCompounded[0].tokenAdded),
      liquidityAdded: decimal(events.liquidityCompounded[0].liquidityAdded),
    },
  };
}

function verifyFinalPostState(evidence, state) {
  const productive = evidence.transactions.fee_process_compound;
  if (!productive?.preState || !productive?.postState) {
    throw new Error("Lifecycle completion evidence is incomplete");
  }
  const processBefore = productive.preState;
  const processAfter = productive.postState;
  const compoundBefore = productive.preState;
  const compoundAfter = productive.postState;
  const creatorFeesPulled =
    BigInt(processAfter.totalCreatorFeesReceivedWei) -
    BigInt(processBefore.totalCreatorFeesReceivedWei);
  const nativeAdded =
    BigInt(compoundAfter.totalNativeAddedToLiquidityWei) -
    BigInt(compoundBefore.totalNativeAddedToLiquidityWei);
  const tokenAdded =
    BigInt(compoundAfter.totalTokenAddedToLiquidity) -
    BigInt(compoundBefore.totalTokenAddedToLiquidity);
  const liquidityAdded =
    BigInt(compoundAfter.totalLiquidityAdded) -
    BigInt(compoundBefore.totalLiquidityAdded);
  const lockedDelta =
    BigInt(compoundAfter.lockedFullRangeLiquidity) -
    BigInt(compoundBefore.lockedFullRangeLiquidity);
  if (
    creatorFeesPulled <= 0n ||
    nativeAdded <= 0n ||
    tokenAdded <= 0n ||
    liquidityAdded <= 0n ||
    lockedDelta !== liquidityAdded ||
    BigInt(compoundBefore.lockedFullRangeLiquidity) !== 0n ||
    BigInt(compoundBefore.totalLiquidityAdded) !== 0n ||
    BigInt(compoundAfter.lockedFullRangeLiquidity) !==
      BigInt(compoundAfter.totalLiquidityAdded)
  ) {
    throw new Error("Final full-range accounting proof failed");
  }
  for (const field of [
    "token",
    "growthVault",
    "poolId",
    "launchHash",
    "configurationHash",
    "oracleGuard",
    "upstreamVault",
    "initialPositionTokenId",
    "initialPositionRecipient",
    "initialPositionOwner",
    "initialPositionLiquidity",
  ]) {
    if (processBefore[field] !== compoundAfter[field]) {
      throw new Error(`Immutable lifecycle binding changed: ${field}`);
    }
  }
  if (
    state.lockedLiquidity !== compoundAfter.lockedFullRangeLiquidity ||
    state.totalLiquidityAdded !== compoundAfter.totalLiquidityAdded
  ) {
    throw new Error("Final live full-range state no longer matches evidence");
  }
  evidence.finalPostState = {
    creatorFeesPulledWei: creatorFeesPulled.toString(),
    nativeLiquidityAddedWei: nativeAdded.toString(),
    tokenLiquidityAdded: tokenAdded.toString(),
    liquidityAdded: liquidityAdded.toString(),
    lockedFullRangeLiquidityAfter: compoundAfter.lockedFullRangeLiquidity,
    sameLockedFullRangePosition: true,
    liquidityRemoved: "0",
    initialPositionUnchanged: true,
  };
}

async function record(plan, body) {
  const { action, txHash, preparedDigest } = body ?? {};
  if (!Object.hasOwn(gasCeilings, action)) {
    throw new Error("Unknown lifecycle action");
  }
  const normalizedHash = normalizeHex(txHash);
  if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) {
    throw new Error("Invalid transaction hash");
  }
  const evidence = await readEvidence(plan.planDigest);
  const executorAddress = resolvedKeeperExecutor(evidence);
  const prepared = evidence.prepared;
  if (
    !prepared ||
    prepared.action !== action ||
    prepared.preparedDigest !== preparedDigest
  ) {
    throw new Error("Submitted transaction has no exact reviewed preparation");
  }
  if (evidence.transactions[action]) {
    throw new Error("This lifecycle action is already recorded");
  }
  const records = await Promise.all(
    RPC_ENDPOINTS.map(async (endpoint) => {
      const [transaction, receipt] = await Promise.all([
        rpc(endpoint, "eth_getTransactionByHash", [normalizedHash]),
        rpc(endpoint, "eth_getTransactionReceipt", [normalizedHash]),
      ]);
      return { transaction, receipt };
    }),
  );
  if (records.some(({ transaction }) => transaction === null)) {
    throw new Error("Transaction is not visible on both Mainnet RPCs");
  }
  const expected = prepared.request;
  if (prepared.maximumTotalDebitWei === undefined) {
    throw new Error("Prepared transaction has no maximum-debit commitment");
  }
  const minedEnvelopes = records.map(({ transaction }) =>
    validateMinedTransactionEnvelope(
      transaction,
      expected,
      prepared.maximumTotalDebitWei,
    ),
  );
  if (!sameJson(minedEnvelopes[0], minedEnvelopes[1])) {
    throw new Error("Independent Mainnet RPCs disagree on the mined gas envelope");
  }
  for (const [index, { transaction, receipt }] of records.entries()) {
    if (
      normalizeHex(transaction.from) !== normalizeHex(expected.from) ||
      normalizeHex(transaction.to) !== normalizeHex(expected.to) ||
      normalizeHex(transaction.input) !== normalizeHex(expected.data) ||
      normalizeHex(transaction.value) !== normalizeHex(expected.value) ||
      normalizeHex(transaction.nonce) !== normalizeHex(expected.nonce)
    ) {
      throw new Error("Submitted transaction does not match the reviewed action");
    }
    if (receipt && normalizeHex(receipt.status) !== "0x1") {
      throw new Error(`${action} reverted on Ethereum Mainnet`);
    }
    if (
      receipt &&
      BigInt(receipt.effectiveGasPrice) >
        BigInt(minedEnvelopes[index].minedFeeCeilingWei)
    ) {
      throw new Error("Receipt effective gas price exceeds the mined fee ceiling");
    }
  }
  if (records.some(({ receipt }) => receipt === null)) {
    return { receipt: null };
  }
  const receipts = records.map(({ receipt }) => comparableReceipt(receipt));
  if (!sameJson(receipts[0], receipts[1])) {
    throw new Error("Independent Mainnet RPCs disagree on the exact receipt");
  }
  const receiptBlock = await Promise.all(
    RPC_ENDPOINTS.map((endpoint) =>
      rpc(endpoint, "eth_getBlockByHash", [records[0].receipt.blockHash, false]),
    ),
  );
  if (
    !receiptBlock[0] ||
    !receiptBlock[1] ||
    normalizeHex(receiptBlock[0].hash) !== normalizeHex(receiptBlock[1].hash) ||
    normalizeHex(receiptBlock[0].timestamp) !==
      normalizeHex(receiptBlock[1].timestamp)
  ) {
    throw new Error("Independent Mainnet RPCs disagree on the receipt block");
  }
  const receiptBlockTag = normalizeHex(records[0].receipt.blockNumber);
  const previousBlockTag = quantity(BigInt(receiptBlockTag) - 1n);
  const [preState, state] = await Promise.all([
    reconcile(plan.token, previousBlockTag),
    reconcile(plan.token, receiptBlockTag),
  ]);
  const postState = actionPostState(state);
  const recorded = {
    transactionHash: normalizedHash,
    blockNumber: decimal(receipts[0].blockNumber),
    blockHash: receipts[0].blockHash,
    from: receipts[0].from,
    to: receipts[0].to,
    status: receipts[0].status,
    gasUsed: decimal(receipts[0].gasUsed),
    effectiveGasPriceWei: decimal(receipts[0].effectiveGasPrice),
    nonce: decimal(expected.nonce),
    valueWei: decimal(expected.value),
    calldataHash: keccak256(expected.data),
    preparedDigest,
    minedEnvelope: minedEnvelopes[0],
    details: prepared.details,
    receipt: {
      ...receipts[0],
      blockNumber: decimal(receipts[0].blockNumber),
      blockTimestamp: decimal(receiptBlock[0].timestamp),
    },
    preState: actionPostState(preState),
    postState,
  };
  if (action === "launch") {
    if (
      !state.launched ||
      state.growthVault === ZERO_ADDRESS ||
      state.cardinality !== 1 ||
      state.cardinalityNext !== 2 ||
      state.buySwapFeeBps !== BUY_FEE_BPS ||
      state.sellSwapFeeBps !== SELL_FEE_BPS
    ) {
      throw new Error("Launch receipt did not create the exact reviewed canary");
    }
    evidence.token = plan.token;
    evidence.growthVault = state.growthVault;
    evidence.poolId = state.poolId;
    evidence.launchHash = state.launchHash;
    evidence.launch = recorded;
  } else if (action === "deploy_keeper_executor") {
    const deployedAddress = normalizeHex(records[0].receipt.contractAddress);
    if (
      !deployedAddress ||
      deployedAddress !== normalizeHex(prepared.details.predictedExecutor)
    ) {
      throw new Error(
        "Executor deployment receipt does not match the predicted CREATE address",
      );
    }
    await Promise.all(
      RPC_ENDPOINTS.map((endpoint) =>
        assertKeeperExecutor(endpoint, deployedAddress),
      ),
    );
    recorded.runtimeCodeHash = REVIEWED_KEEPER_EXECUTOR_RUNTIME_HASH;
    recorded.sourceCommitment =
      REVIEWED_KEEPER_EXECUTOR_SOURCE_COMMITMENT;
    evidence.keeperExecutor = deployedAddress;
    evidence.keeperExecutorRuntimeCodeHash =
      REVIEWED_KEEPER_EXECUTOR_RUNTIME_HASH;
    evidence.executorDeployment = recorded;
  } else if (action === "grow_oracle") {
    if (state.cardinalityNext !== OBSERVATION_TARGET) {
      throw new Error("Oracle batch receipt did not reach cardinalityNext 192");
    }
    recorded.events = {
      oracleGrowthStaged: requireOracleGrowthEvents(
        records[0].receipt,
        state.growthVault,
        state.poolId,
        prepared.details.repetitions,
      ),
    };
    evidence.oracleTransaction = recorded;
  } else if (action === "fee_process_compound") {
    recorded.events = requireProductiveKeeperEvents(
      records[0].receipt,
      state.growthVault,
      executorAddress,
    );
    const pulled =
      BigInt(postState.totalCreatorFeesReceivedWei) -
      BigInt(recorded.preState.totalCreatorFeesReceivedWei);
    const allocated =
      BigInt(postState.totalNativeAllocatedToGrowthWei) -
      BigInt(recorded.preState.totalNativeAllocatedToGrowthWei);
    const nativeAdded =
      BigInt(postState.totalNativeAddedToLiquidityWei) -
      BigInt(recorded.preState.totalNativeAddedToLiquidityWei);
    const tokenAdded =
      BigInt(postState.totalTokenAddedToLiquidity) -
      BigInt(recorded.preState.totalTokenAddedToLiquidity);
    const liquidityAdded =
      BigInt(postState.totalLiquidityAdded) -
      BigInt(recorded.preState.totalLiquidityAdded);
    if (
      pulled <= 0n ||
      pulled !== BigInt(recorded.preState.creatorFeesAccruedWei) ||
      allocated !== pulled ||
      BigInt(postState.creatorFeesAccruedWei) !== 0n ||
      nativeAdded <= 0n ||
      tokenAdded <= 0n ||
      liquidityAdded <= 0n ||
      BigInt(recorded.events.creatorFeesProcessed.receivedWei) !== pulled ||
      BigInt(recorded.events.liquidityCompounded.nativeAddedWei) !==
        nativeAdded ||
      BigInt(recorded.events.liquidityCompounded.tokenAdded) !== tokenAdded ||
      BigInt(recorded.events.liquidityCompounded.liquidityAdded) !==
        liquidityAdded
    ) {
      throw new Error(
        "Productive keeper receipt did not process fees and compound liquidity",
      );
    }
    evidence.transactions[action] = recorded;
    verifyFinalPostState(evidence, state);
    evidence.keeperExecutor = executorAddress;
    evidence.keeperExecutorRuntimeCodeHash =
      REVIEWED_KEEPER_EXECUTOR_RUNTIME_HASH;
    evidence.feeProcessCompoundTransaction = recorded;
  }
  evidence.transactions[action] = recorded;
  evidence.prepared = null;
  await writeEvidence(evidence);
  return recorded;
}

function publicPlan(plan) {
  return {
    planDigest: plan.planDigest,
    releaseCommit: RELEASE_COMMIT,
    expectedAccount: ACCOUNT,
    launcher: LAUNCHER,
    automation: AUTOMATION,
    feeHook: FEE_HOOK,
    keeperExecutor: KEEPER_EXECUTOR_ADDRESS,
    keeperExecutorRuntimeCodeHash: KEEPER_EXECUTOR_ADDRESS
      ? REVIEWED_KEEPER_EXECUTOR_RUNTIME_HASH
      : null,
    token: plan.token,
    tokenName: launchParameters.name,
    tokenSymbol: launchParameters.symbol,
    creatorSalt: CREATOR_SALT,
    buySwapFeeBps: BUY_FEE_BPS,
    sellSwapFeeBps: SELL_FEE_BPS,
    initialBuyWei: INITIAL_BUY_WEI.toString(),
    initialBuyEth: formatEther(INITIAL_BUY_WEI),
    launchCalldataHash: keccak256(plan.launchData),
  };
}

function renderHtml(plan) {
  const config = JSON.stringify(publicPlan(plan));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deep Full-Range lifecycle</title>
  <style>:root{color-scheme:dark;--bg:#0b0c0f;--panel:#13151a;--line:#292d36;--ink:#f4f5f7;--muted:#979eaa;--accent:#e685b8;--bad:#ff829b;--good:#72d8ad}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#2b1724 0,transparent 30%),var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(920px,calc(100% - 28px));margin:auto;padding:32px 0 48px}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}h1{font-size:clamp(30px,6vw,54px);line-height:1;letter-spacing:-.05em;margin:0}h2{font-size:18px;margin:0 0 12px}p{color:var(--muted);margin:8px 0}.bar{display:flex;flex-wrap:wrap;gap:10px}.card{margin-top:20px;border:1px solid var(--line);border-radius:22px;background:rgba(19,21,26,.94);padding:20px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.fact{min-width:0;border:1px solid var(--line);border-radius:14px;padding:12px;background:#101217}.fact span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.fact strong,.fact code{display:block;margin-top:4px;overflow-wrap:anywhere}code{font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}button{border:1px solid var(--line);border-radius:999px;background:#181b21;color:var(--ink);padding:11px 16px;font:inherit;font-weight:650;cursor:pointer}button.primary{background:var(--accent);border-color:var(--accent);color:#1a0d14}button:disabled{opacity:.38;cursor:not-allowed}.notice{margin-top:14px;border-radius:13px;background:#181b21;padding:12px;color:var(--muted)}.notice.error{color:var(--bad)}.notice.success{color:var(--good)}.review{display:none}.review.open{display:block}label{display:flex;gap:9px;margin:16px 0;color:var(--muted)}input{margin-top:4px;accent-color:var(--accent)}ol{padding-left:22px;color:var(--muted)}footer{margin-top:16px;color:var(--muted);font-size:12px}@media(max-width:720px){header{display:block}.header-actions{margin-top:16px}.grid{grid-template-columns:1fr}}</style></head>
  <body><main><header><div><h1>Deep lifecycle</h1><p>One exact Mainnet action at a time. MetaMask is the only signer.</p></div><div class="bar header-actions"><button id="switch">Switch to Mainnet</button><button id="connect" class="primary">Connect MetaMask</button></div></header>
  <section class="card"><h2>Fixed plan</h2><div class="grid"><div class="fact"><span>Canary</span><strong>${launchParameters.name} · $${launchParameters.symbol}</strong></div><div class="fact"><span>Launch value</span><strong>${formatEther(INITIAL_BUY_WEI)} ETH</strong></div><div class="fact"><span>Fees</span><strong>10% buy · 10% sell</strong></div><div class="fact"><span>Predicted token</span><code>${plan.token}</code></div><div class="fact"><span>Required account</span><code>${ACCOUNT}</code></div><div class="fact"><span>Signer</span><strong>MetaMask only</strong></div></div></section>
  <section class="card"><h2>Lifecycle</h2><ol><li>Deploy the reviewed immutable keeper executor if absent.</li><li>Launch with the reviewed initial buy.</li><li>Grow 2 → 192 in one repeated-vault batch.</li><li>Use the launch initialization observation; create another only if live state proves it is needed.</li><li>Wait for the 30-minute TWAP.</li><li>Process fees and compound in one expected-action executor receipt.</li></ol><div class="bar"><button id="refresh">Refresh live checks</button><button id="prepare" class="primary" disabled>Prepare exact next action</button></div><div id="notice" class="notice">Connect the required MetaMask account to begin.</div></section>
  <section id="review" class="card review"><h2 id="title">Review action</h2><div class="grid"><div class="fact"><span>Exact ETH value</span><code id="value"></code></div><div class="fact"><span>Nonce</span><code id="nonce"></code></div><div class="fact"><span>Target</span><code id="target"></code></div><div class="fact"><span>Calldata hash</span><code id="calldata"></code></div><div class="fact"><span>Live gas estimate</span><code id="estimate"></code></div><div class="fact"><span>Gas limit</span><code id="gas"></code></div><div class="fact"><span>Max fee / gas</span><code id="fee"></code></div><div class="fact"><span>Max gas debit</span><code id="gasDebit"></code></div><div class="fact"><span>Max total debit</span><code id="totalDebit"></code></div></div><label><input id="ack" type="checkbox"><span>I checked the exact ETH value, target, nonce, calldata hash, gas limit, and maximum total debit.</span></label><button id="send" class="primary" disabled>Open MetaMask for this action</button></section>
  <footer>This local console never reads a private key and has no transaction-broadcast endpoint. Browser wallet signing is explicit.</footer></main>
  <script>const config=${config};const $=id=>document.getElementById(id);const el={switch:$("switch"),connect:$("connect"),refresh:$("refresh"),prepare:$("prepare"),notice:$("notice"),review:$("review"),title:$("title"),value:$("value"),nonce:$("nonce"),target:$("target"),calldata:$("calldata"),estimate:$("estimate"),gas:$("gas"),fee:$("fee"),gasDebit:$("gasDebit"),totalDebit:$("totalDebit"),ack:$("ack"),send:$("send")};let provider,account,inspection,locked,busy=false;
  function metamask(){if(window.ethereum?.isMetaMask)return window.ethereum;return window.ethereum?.providers?.find(p=>p?.isMetaMask)}function wallet(method,params=[]){return provider.request({method,params})}function notice(message,type){el.notice.textContent=message;el.notice.className="notice"+(type?" "+type:"")}function clear(){locked=undefined;el.ack.checked=false;el.review.classList.remove("open")}function buttons(){const ready=Boolean(account&&inspection?.status==="ready"&&inspection.prepared);el.connect.disabled=busy;el.switch.disabled=busy;el.refresh.disabled=busy||!account;el.prepare.disabled=busy||!ready;el.send.disabled=busy||!locked||!el.ack.checked}
  async function serverState(){const response=await fetch("/state",{cache:"no-store"}),body=await response.json();if(!response.ok)throw new Error(body.error||"Lifecycle preflight failed");return body}async function ensure(){if(String(await wallet("eth_chainId")).toLowerCase()!=="0x1")throw new Error("Select Ethereum Mainnet");const accounts=await wallet("eth_accounts"),selected=String(accounts[0]||"").toLowerCase();if(selected!==config.expectedAccount)throw new Error("Select "+config.expectedAccount+" in MetaMask");account=selected}
  async function refresh(){clear();await ensure();inspection=await serverState();if(inspection.status==="complete")notice("Lifecycle complete. Exact final accounting is recorded.","success");else if(inspection.status==="waiting")notice("Waiting for the 30-minute TWAP. Refresh after maturity.");else if(inspection.status==="blocked")notice(inspection.blocker.message,"error");else notice(inspection.prepared.label+" passed both independent Mainnet simulations.");buttons()}
  async function connect(){if(busy)return;busy=true;buttons();try{provider=metamask();if(!provider)throw new Error("MetaMask is not available");if(!(await wallet("eth_accounts")).length)await wallet("eth_requestAccounts");await ensure();await refresh();el.connect.textContent="Connected"}catch(error){account=undefined;inspection=undefined;el.connect.textContent="Connect MetaMask";notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}
  async function prepare(){if(busy)return;busy=true;buttons();try{await ensure();inspection=await serverState();if(inspection.status!=="ready")throw new Error(inspection.status==="waiting"?"TWAP is not mature yet":"No action is ready");locked=inspection.prepared;el.title.textContent="Review · "+locked.label;el.value.textContent=locked.valueEth+" ETH ("+locked.valueWei+" wei)";el.nonce.textContent=String(Number(BigInt(locked.request.nonce)));el.target.textContent=locked.target;el.calldata.textContent=locked.calldataHash;el.estimate.textContent=locked.liveEstimatedGas;el.gas.textContent=locked.gasLimit;el.fee.textContent=locked.maxFeePerGasWei+" wei";el.gasDebit.textContent=locked.maximumGasDebitEth+" ETH";el.totalDebit.textContent=locked.maximumTotalDebitEth+" ETH";el.review.classList.add("open");notice("Review the exact value and maximum debit before opening MetaMask.")}catch(error){clear();notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}
  async function record(hash,prepared){for(let attempt=0;attempt<180;attempt+=1){const response=await fetch("/record",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:prepared.action,txHash:hash,preparedDigest:prepared.preparedDigest})}),body=await response.json();if(response.ok&&body.receipt)return body;if(!response.ok&&response.status!==409)throw new Error(body.error||"Could not record transaction");await new Promise(resolve=>setTimeout(resolve,2000))}throw new Error("Transaction is still pending after six minutes")}
  async function send(){if(busy||!locked||!el.ack.checked)return;busy=true;buttons();const prepared=locked;try{await ensure();const fresh=await serverState();if(fresh.status!=="ready"||fresh.prepared?.preparedDigest!==prepared.preparedDigest)throw new Error("Live state changed. Prepare again");notice("Review "+prepared.label+" in MetaMask.");const hash=await wallet("eth_sendTransaction",[prepared.request]);notice("Submitted through MetaMask. Reconciling the exact receipt on two RPCs.");await record(hash,prepared);clear();await refresh()}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}
  el.connect.addEventListener("click",connect);el.refresh.addEventListener("click",()=>{if(!busy){busy=true;buttons();refresh().catch(error=>notice(error?.message||String(error),"error")).finally(()=>{busy=false;buttons()})}});el.prepare.addEventListener("click",prepare);el.ack.addEventListener("change",buttons);el.send.addEventListener("click",send);el.switch.addEventListener("click",async()=>{try{provider=metamask();if(!provider)throw new Error("MetaMask is not available");await wallet("wallet_switchEthereumChain",[{chainId:"0x1"}]);await connect()}catch(error){notice(error?.message||String(error),"error")}});window.ethereum?.on?.("accountsChanged",()=>location.reload());window.ethereum?.on?.("chainChanged",()=>location.reload());buttons();</script></body></html>`;
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function main() {
  const plan = await buildPlan();
  if (process.argv.includes("--check")) {
    const inspection = await inspect(plan);
    process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
    return;
  }
  const html = renderHtml(plan);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
        });
        response.end(html);
        return;
      }
      if (request.method === "GET" && url.pathname === "/state") {
        json(response, 200, await inspect(plan));
        return;
      }
      if (request.method === "POST" && url.pathname === "/record") {
        const recorded = await record(plan, await readJsonBody(request));
        json(response, recorded.receipt ? 200 : 409, recorded);
        return;
      }
      json(response, 404, { error: "Not found" });
    } catch (error) {
      json(response, 400, { error: error?.message ?? String(error) });
    }
  });
  server.listen(PORT, HOST, () => {
    process.stdout.write(
      `Deep Full-Range lifecycle console: http://${HOST}:${PORT}\n` +
        `Expected MetaMask account: ${ACCOUNT}\n` +
        `Fresh deterministic token: ${plan.token}\n` +
        `Initial buy: ${formatEther(INITIAL_BUY_WEI)} ETH\n` +
        "The server never signs or broadcasts transactions.\n",
    );
  });
}

const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : "";
if (invokedPath === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
