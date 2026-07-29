import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  stringToHex,
} from "viem";

import {
  DEEP_V3_MANIFEST_PATH,
  DEEP_V3_RUNTIME_FIELDS,
  DEEP_V3_STACK,
  DEEP_V3_TRANSACTION_FIELDS,
  buildDeepV3DeploymentPlan,
  expectedDeepV3TransactionInput,
  validDeepV3Hash,
} from "../contracts/scripts/deep-full-range-release-v3-core.mjs";

export const DEEP_V3_CHAIN_ID = 1;
export const DEEP_V3_CHAIN_ID_HEX = "0x1";
export const DEEP_V3_CONFIRMATIONS = 12n;
export const DEEP_V3_ORACLE_MATURITY_SECONDS = 1_800n;
export const DEEP_V3_CANARY_INITIAL_BUY_WEI = 600_000_000_000_000n;
export const DEEP_V3_MAX_FEE_PER_GAS_WEI = 100_000_000_000n;
export const DEEP_V3_MIN_PRIORITY_FEE_PER_GAS_WEI = 10_000_000n;
export const DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI = 5_000_000_000n;

export const DEEP_V3_DEPLOYMENT_GAS_CEILINGS = Object.freeze({
  zapPlanner: 5_000_000n,
  growthVaultFactory: 7_000_000n,
  hookFactory: 7_000_000n,
  feeHook: 8_000_000n,
  launcher: 15_000_000n,
  keeperExecutor: 3_000_000n,
});

export const DEEP_V3_CANARY_GAS_CEILINGS = Object.freeze({
  launch: 20_000_000n,
  growOracle: 3_000_000n,
  compound: 4_500_000n,
});

export const DEEP_V3_DEPLOYMENT_LABELS = Object.freeze({
  zapPlanner: "Zap planner",
  growthVaultFactory: "Growth vault factory",
  hookFactory: "Fee hook factory",
  feeHook: "Fee and oracle hook",
  launcher: "Deep launcher",
  keeperExecutor: "Keeper executor",
});

export const DEEP_V3_RUNTIME_GROUPS = Object.freeze({
  zapPlanner: Object.freeze(["zapPlanner"]),
  growthVaultFactory: Object.freeze([
    "growthVaultFactory",
    "growthVaultImplementation",
  ]),
  hookFactory: Object.freeze(["hookFactory"]),
  feeHook: Object.freeze(["feeHook"]),
  launcher: Object.freeze([
    "launcher",
    "positionPlanner",
    "automation",
  ]),
  keeperExecutor: Object.freeze(["keeperExecutor"]),
});

export const deepV3LauncherAbi = parseAbi([
  "function launch((string name,string symbol,(string description,string website,string image,bytes extraData) metadata,bytes32 creatorSalt,uint256 minimumInitialTokenOut,uint160 initialBuySqrtPriceLimitX96,uint256 deadline) parameters) payable returns ((address token,bytes32 poolId,address growthVault,address positionRecipient,uint256 positionTokenId,address oracleGuard,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,uint256 initialLockedTokenDust,bytes32 vaultConfigurationHash,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address deployer,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function growthVaultOf(address token) view returns (address)",
  "function launchHashOf(address token) view returns (bytes32)",
  "function MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96() view returns (uint160)",
]);

export const deepV3AutomationAbi = parseAbi([
  "function stageOracleBatch(address[] candidates) returns (uint256 attempted,uint256 succeeded)",
  "function checkVault(address vaultAddress) view returns (uint8 action)",
  "function scan(uint256 cursor,uint256 limit) view returns ((address vault,uint8 action)[] ready,uint256 nextCursor)",
  "function isRegisteredVault(address vault) view returns (bool)",
]);

export const deepV3KeeperExecutorAbi = parseAbi([
  "function execute((address vault,uint8 expectedAction)[] candidates) returns (bytes32 batchHash,uint256 attempted,uint256 succeeded)",
  "function automation() view returns (address)",
]);

export const deepV3VaultAbi = parseAbi([
  "function poolId() view returns (bytes32)",
  "function token() view returns (address)",
  "function feeHook() view returns (address)",
  "function workState() view returns (uint8 action,uint256 hookGrowthFees,uint256 pendingNative,uint256 nextEligibleTimestamp,uint256 rollingCapacity,bytes4 blockedReason)",
  "function lockedLiquidity() view returns (uint128)",
  "function totalNativeAddedToLiquidity() view returns (uint256)",
  "function totalTokenAddedToLiquidity() view returns (uint256)",
  "function totalLiquidityAdded() view returns (uint256)",
  "function pendingGrowthNative() view returns (uint256)",
]);

export const deepV3HookAbi = parseAbi([
  "function stateById(bytes32 poolId) view returns (uint16 index,uint16 cardinality,uint16 cardinalityNext)",
  "function poolFeeConfig(bytes32 poolId) view returns (address growthVault,address registrar,uint8 lifecycle,uint256 growthFeesAccrued)",
]);

export const deepV3LaunchEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeTokenLaunchedV3(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address growthVault,address positionRecipient,uint256 positionTokenId,bytes32 vaultConfigurationHash,bytes32 launchHash)",
);
export const deepV3ConfiguredEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeConfiguredV3(address indexed token,uint256 totalSupply,uint256 initialLockedTokenDust,uint16 totalHookFeeBps,uint16 growthFeeBps,uint16 programmableFeeBps,int24 initialTick,int24 fullRangeTickLower,int24 fullRangeTickUpper,bytes32 launchHash)",
);
export const deepV3InitialBuyEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeCreatorInitialBuyV3(address indexed deployer,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,uint160 sqrtPriceLimitX96,bytes32 launchHash)",
);
export const deepV3OracleEvent = parseAbiItem(
  "event OracleGrowthStaged(address indexed vault,bytes32 indexed poolId,address indexed executor,uint16 previousCardinalityNext,uint16 newCardinalityNext)",
);
export const deepV3WorkEvent = parseAbiItem(
  "event WorkPerformed(address indexed vault,uint8 indexed action,address indexed executor)",
);
export const deepV3CompoundEvent = parseAbiItem(
  "event LiquidityCompounded(address indexed keeper,bytes32 indexed poolId,bytes32 indexed digest,uint256 budgetNative,uint256 swapNative,uint256 tokenAcquired,uint256 nativeAdded,uint256 tokenAdded,uint128 liquidityAdded,uint256 rollingExposure)",
);
export const deepV3CandidateEvent = parseAbiItem(
  "event CandidateResult(bytes32 indexed batchHash,uint256 indexed candidateIndex,address indexed vault,address executor,uint8 expectedAction,uint8 actualAction,uint8 outcome,bytes4 errorSelector,uint256 gasUsed)",
);

const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
export const DEEP_V3_CONTRACT_RELEASE_PATHS = Object.freeze([
  "contracts/src/LiquidityGrowthZapPlannerV3.sol",
  "contracts/src/LiquidityGrowthFullRangePolicyV3.sol",
  "contracts/src/LiquidityGrowthFullRangeVaultV3.sol",
  "contracts/src/LiquidityGrowthFullRangeVaultFactoryV3.sol",
  "contracts/src/LiquidityGrowthFeeOracleHookV2.sol",
  "contracts/src/LiquidityGrowthFeeOracleHookFactoryV2.sol",
  "contracts/src/LiquidityGrowthFullRangePositionPlannerV3.sol",
  "contracts/src/LiquidityGrowthFullRangeAutomationV3.sol",
  "contracts/src/LiquidityGrowthFullRangeLaunchV3.sol",
  "contracts/src/DeepKeeperExecutorV2.sol",
  "contracts/script/DeployMainnetDeepFullRangeInfrastructureV3.s.sol",
  "contracts/foundry.toml",
  "contracts/remappings.txt",
]);

export const DEEP_V3_OPERATOR_RELEASE_PATHS = Object.freeze([
  "package.json",
  "package-lock.json",
  "contracts/deployments/mainnet-deep-full-range-v3.json",
  "contracts/scripts/deep-full-range-release-v3-core.mjs",
  "contracts/scripts/deep-v3-lifecycle-write.mjs",
  "contracts/scripts/capture-deep-full-range-v3-lifecycle.mjs",
  "scripts/deep-v3-mainnet-operator-core.mjs",
  "scripts/deep-v3-canary-trade-core.mjs",
  "scripts/serve-deep-v3-mainnet-operator.mjs",
  "scripts/serve-deep-v3-mainnet-canary.mjs",
  "scripts/serve-deep-v3-mainnet-canary-trades.mjs",
]);

function assertRegularFile(root, relativePath, label) {
  let fileStat;
  try {
    fileStat = lstatSync(path.join(root, relativePath));
  } catch {
    throw new Error(`${label} are missing: ${relativePath}`);
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new Error(`${label} must be regular files: ${relativePath}`);
  }
}

function assertTrackedAndClean(root, paths, label) {
  const tracked = new Set(
    execFileSync("git", ["ls-files", "--", ...paths], {
      cwd: root,
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter(Boolean),
  );
  const missing = paths.filter((relativePath) => !tracked.has(relativePath));
  if (missing.length > 0) {
    throw new Error(
      `${label} are not tracked by the current commit: ${missing.join(", ")}`,
    );
  }
  for (const relativePath of paths) {
    const absolutePath = path.join(root, relativePath);
    assertRegularFile(root, relativePath, label);
    const committed = execFileSync(
      "git",
      ["show", `HEAD:${relativePath}`],
      { cwd: root, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
    );
    if (!committed.equals(readFileSync(absolutePath))) {
      throw new Error(
        `${label} differ from the current commit: ${relativePath}`,
      );
    }
  }
  const dirty = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all", "--", ...paths],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (dirty) {
    throw new Error(`${label} have uncommitted changes`);
  }
}

function assertFilesMatchCommit(root, paths, releaseCommit, label) {
  for (const relativePath of paths) {
    const absolutePath = path.join(root, relativePath);
    assertRegularFile(root, relativePath, label);
    let committed;
    try {
      committed = execFileSync(
        "git",
        ["show", `${releaseCommit}:${relativePath}`],
        { cwd: root, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
      );
    } catch {
      throw new Error(
        `${label} are absent from ${releaseCommit}: ${relativePath}`,
      );
    }
    if (!committed.equals(readFileSync(absolutePath))) {
      throw new Error(
        `${label} differ from ${releaseCommit}: ${relativePath}`,
      );
    }
  }
}

export function assertDeepV3OperatorCheckoutClean(root) {
  assertTrackedAndClean(
    root,
    DEEP_V3_OPERATOR_RELEASE_PATHS,
    "The Deep V3 operator files",
  );
  const dirtyWorktree = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (dirtyWorktree) {
    throw new Error(
      "Deep V3 signing requires a completely clean release worktree",
    );
  }
  const hiddenIndexFlags = execFileSync("git", ["ls-files", "-v"], {
    cwd: root,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter((line) => /^[a-zS] /.test(line));
  if (hiddenIndexFlags.length > 0) {
    throw new Error(
      "Deep V3 signing rejects assume-unchanged and skip-worktree index flags",
    );
  }
}

export function normalizeDeepV3Hex(value) {
  return String(value ?? "").toLowerCase();
}

export function deepV3Quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function nonnegativeQuantity(value, label) {
  let quantity;
  try {
    quantity = BigInt(value);
  } catch {
    throw new Error(`${label} is not a valid quantity`);
  }
  if (quantity < 0n) {
    throw new Error(`${label} is not a valid quantity`);
  }
  return quantity;
}

export function buildDeepV3DeploymentFeePolicy(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length !== 2) {
    throw new Error("Two independent fee snapshots are required");
  }
  const observations = snapshots.map((snapshot, index) => {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot)
    ) {
      throw new Error(`RPC ${index + 1} fee snapshot is invalid`);
    }
    const baseFeePerGas = nonnegativeQuantity(
      snapshot.baseFeePerGas,
      `RPC ${index + 1} base fee`,
    );
    if (baseFeePerGas === 0n) {
      throw new Error("Current Mainnet base fee is unavailable");
    }
    const priorityCandidates = [];
    if (
      snapshot.maxPriorityFeePerGas !== null &&
      snapshot.maxPriorityFeePerGas !== undefined
    ) {
      priorityCandidates.push(
        nonnegativeQuantity(
          snapshot.maxPriorityFeePerGas,
          `RPC ${index + 1} priority fee`,
        ),
      );
    }
    if (
      snapshot.gasPricePerGas !== null &&
      snapshot.gasPricePerGas !== undefined
    ) {
      const gasPricePerGas = nonnegativeQuantity(
        snapshot.gasPricePerGas,
        `RPC ${index + 1} gas price`,
      );
      if (gasPricePerGas < baseFeePerGas) {
        throw new Error(
          `RPC ${index + 1} gas price is below its base fee`,
        );
      }
      priorityCandidates.push(gasPricePerGas - baseFeePerGas);
    }
    return { baseFeePerGas, priorityCandidates };
  });
  const priorityCandidates = observations.flatMap(
    (observation) => observation.priorityCandidates,
  );
  if (priorityCandidates.length === 0) {
    throw new Error(
      "No independent Mainnet priority-fee estimate is available",
    );
  }
  const highestBaseFee = observations
    .map((observation) => observation.baseFeePerGas)
    .reduce((left, right) => (left > right ? left : right));
  const recommendedPriority = priorityCandidates.reduce(
    (left, right) => (left > right ? left : right),
  );
  if (
    recommendedPriority > DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI
  ) {
    throw new Error(
      "Current Mainnet priority fee exceeds the Deep V3 operator policy",
    );
  }
  let priority = recommendedPriority * 2n;
  if (priority < DEEP_V3_MIN_PRIORITY_FEE_PER_GAS_WEI) {
    priority = DEEP_V3_MIN_PRIORITY_FEE_PER_GAS_WEI;
  }
  if (priority > DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI) {
    throw new Error(
      "Buffered Mainnet priority fee exceeds the Deep V3 operator policy",
    );
  }
  const maxFeePerGas = highestBaseFee * 2n + priority;
  if (maxFeePerGas > DEEP_V3_MAX_FEE_PER_GAS_WEI) {
    throw new Error(
      "Current Mainnet fees exceed the Deep V3 operator policy",
    );
  }
  return {
    maxFeePerGas,
    maxPriorityFeePerGas: priority,
  };
}

export function validDeepV3Commit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value);
}

export function validDeepV3TransactionHash(value) {
  return (
    typeof value === "string" &&
    HASH_PATTERN.test(value.toLowerCase())
  );
}

export function assertDeepV3ReleaseCheckout(root, releaseCommit) {
  if (!validDeepV3Commit(releaseCommit)) {
    throw new Error("A full 40-character Deep V3 release commit is required");
  }
  execFileSync("git", ["cat-file", "-e", `${releaseCommit}^{commit}`], {
    cwd: root,
    stdio: "ignore",
  });
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (head !== releaseCommit) {
    throw new Error(
      "The operator checkout is not at the exact Deep V3 release commit",
    );
  }
  assertTrackedAndClean(
    root,
    DEEP_V3_CONTRACT_RELEASE_PATHS,
    "The Deep V3 contract release files",
  );
  assertDeepV3OperatorCheckoutClean(root);
}

export function assertDeepV3ReleaseSourcesMatchCommit(
  root,
  releaseCommit,
) {
  if (!validDeepV3Commit(releaseCommit)) {
    throw new Error("A full 40-character Deep V3 release commit is required");
  }
  execFileSync("git", ["cat-file", "-e", `${releaseCommit}^{commit}`], {
    cwd: root,
    stdio: "ignore",
  });
  assertFilesMatchCommit(
    root,
    DEEP_V3_CONTRACT_RELEASE_PATHS,
    releaseCommit,
    "The current Deep V3 contract release files",
  );
  assertTrackedAndClean(
    root,
    DEEP_V3_CONTRACT_RELEASE_PATHS,
    "The Deep V3 contract release files",
  );
  assertDeepV3OperatorCheckoutClean(root);
}

export const assertDeepV3SourcesMatchCommit =
  assertDeepV3ReleaseSourcesMatchCommit;

function assertManifestIdentity(manifest) {
  if (
    manifest?.schemaVersion !== 3 ||
    manifest.model !== "deep" ||
    manifest.internalContractRelease !==
      "liquidity-growth-full-range-v3" ||
    manifest.releaseVersion !== "deep-full-range-v3" ||
    manifest.releaseManifest !== DEEP_V3_MANIFEST_PATH ||
    manifest.chainId !== DEEP_V3_CHAIN_ID ||
    manifest.transactionCount !== 6 ||
    !validDeepV3Hash(manifest.sourceCommitment) ||
    normalizeDeepV3Hex(manifest.addresses?.treasury) !==
      normalizeDeepV3Hex(DEEP_V3_STACK.treasury)
  ) {
    throw new Error("The Deep V3 release manifest identity is invalid");
  }
}

export function readDeepV3Manifest(root) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, DEEP_V3_MANIFEST_PATH), "utf8"),
  );
  assertManifestIdentity(manifest);
  return manifest;
}

export function buildDeepV3OperatorPlan({
  root,
  manifest,
  deployer,
  startingNonce,
  hookSalt,
  releaseCommit,
}) {
  assertManifestIdentity(manifest);
  if (!isAddress(deployer ?? "")) {
    throw new Error("A valid Deep V3 Mainnet deployer is required");
  }
  if (
    !Number.isSafeInteger(startingNonce) ||
    startingNonce < 0
  ) {
    throw new Error("The Deep V3 starting nonce is invalid");
  }
  if (!validDeepV3Hash(hookSalt) || BigInt(hookSalt) === 0n) {
    throw new Error("A nonzero Deep V3 hook salt is required");
  }
  if (!validDeepV3Commit(releaseCommit)) {
    throw new Error("A full Deep V3 release commit is required");
  }
  const addresses = buildDeepV3DeploymentPlan(
    getAddress(deployer),
    startingNonce,
    hookSalt,
    root,
  );
  if (
    normalizeDeepV3Hex(addresses.sourceCommitment) !==
    normalizeDeepV3Hex(manifest.sourceCommitment)
  ) {
    throw new Error(
      "The local Deep V3 artifacts do not match the release commitment",
    );
  }
  const manifestForInputs = {
    hookSalt,
    addresses,
  };
  const transactions = DEEP_V3_TRANSACTION_FIELDS.map((field, index) => {
    const to = field === "feeHook" ? addresses.hookFactory : null;
    const data = expectedDeepV3TransactionInput(
      field,
      manifestForInputs,
      root,
    );
    const runtimes = DEEP_V3_RUNTIME_GROUPS[field].map((runtimeField) => ({
      field: runtimeField,
      address: addresses[runtimeField],
    }));
    return {
      index,
      field,
      label: DEEP_V3_DEPLOYMENT_LABELS[field],
      from: getAddress(deployer),
      to,
      nonce: startingNonce + index,
      value: 0n,
      data,
      calldataHash: keccak256(data),
      gasCeiling: DEEP_V3_DEPLOYMENT_GAS_CEILINGS[field],
      runtimes,
    };
  });
  const digest = keccak256(
    stringToHex(
      JSON.stringify({
        chainId: DEEP_V3_CHAIN_ID,
        releaseCommit,
        sourceCommitment: manifest.sourceCommitment,
        deployer: getAddress(deployer),
        treasury: getAddress(DEEP_V3_STACK.treasury),
        startingNonce,
        hookSalt: hookSalt.toLowerCase(),
        transactions: transactions.map((transaction) => ({
          field: transaction.field,
          to: transaction.to,
          nonce: transaction.nonce,
          value: "0",
          calldataHash: transaction.calldataHash,
          gasCeiling: transaction.gasCeiling.toString(),
          runtimes: transaction.runtimes,
        })),
      }),
    ),
  );
  return {
    chainId: DEEP_V3_CHAIN_ID,
    releaseCommit,
    sourceCommitment: manifest.sourceCommitment,
    deployer: getAddress(deployer),
    treasury: getAddress(DEEP_V3_STACK.treasury),
    startingNonce,
    endingNonce: startingNonce + 6,
    hookSalt: hookSalt.toLowerCase(),
    addresses,
    transactions,
    digest,
  };
}

export function assertDeepV3DeploymentState(plan, snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length !== 2) {
    throw new Error("Exactly two independent Mainnet snapshots are required");
  }
  for (const snapshot of snapshots) {
    if (
      Number(snapshot.chainId) !== DEEP_V3_CHAIN_ID ||
      !Number.isSafeInteger(snapshot.confirmedNonce) ||
      !Number.isSafeInteger(snapshot.pendingNonce) ||
      snapshot.confirmedNonce !== snapshot.pendingNonce ||
      snapshot.confirmedNonce < plan.startingNonce ||
      !Array.isArray(snapshot.runtimes) ||
      snapshot.runtimes.length !== DEEP_V3_RUNTIME_FIELDS.length
    ) {
      throw new Error("A Deep V3 deployment snapshot is invalid");
    }
  }
  const [left, right] = snapshots;
  const runtimeFields = left.runtimes.map((runtime) => runtime.field);
  if (
    new Set(runtimeFields).size !== DEEP_V3_RUNTIME_FIELDS.length ||
    DEEP_V3_RUNTIME_FIELDS.some(
      (field) => !runtimeFields.includes(field),
    )
  ) {
    throw new Error("The Deep V3 runtime snapshot is incomplete");
  }
  if (
    left.confirmedNonce !== right.confirmedNonce ||
    JSON.stringify(left.runtimes) !== JSON.stringify(right.runtimes)
  ) {
    throw new Error("Independent RPCs disagree on Deep V3 deployment state");
  }
  const completed = left.confirmedNonce - plan.startingNonce;
  if (completed < 0 || completed > 6) {
    throw new Error("The deployment nonce moved outside the six-step plan");
  }
  const expectedByRuntime = new Map();
  for (const transaction of plan.transactions) {
    for (const runtime of transaction.runtimes) {
      expectedByRuntime.set(runtime.field, transaction.index < completed);
    }
  }
  for (const runtime of left.runtimes) {
    if (
      !expectedByRuntime.has(runtime.field) ||
      runtime.deployed !== expectedByRuntime.get(runtime.field)
    ) {
      throw new Error(
        runtime.deployed
          ? `${runtime.field} exists before its reviewed deployment step`
          : `${runtime.field} is absent after its reviewed deployment step`,
      );
    }
  }
  return completed;
}

export function prepareDeepV3DeploymentTransaction({
  plan,
  snapshots,
  simulations,
  feePolicy,
}) {
  const completed = assertDeepV3DeploymentState(plan, snapshots);
  if (completed === 6) return null;
  if (!Array.isArray(simulations) || simulations.length !== 2) {
    throw new Error("Two independent deployment simulations are required");
  }
  const transaction = plan.transactions[completed];
  const callResults = simulations.map((simulation) =>
    normalizeDeepV3Hex(simulation.callResult),
  );
  if (
    callResults.some((result) => !/^0x[0-9a-f]*$/.test(result)) ||
    callResults[0] !== callResults[1]
  ) {
    throw new Error("Independent deployment simulations disagree");
  }
  const estimates = simulations.map((simulation) =>
    BigInt(simulation.estimatedGas),
  );
  const estimate = estimates[0] > estimates[1] ? estimates[0] : estimates[1];
  const gas = (estimate * 120n + 99n) / 100n;
  if (gas > transaction.gasCeiling) {
    throw new Error(`${transaction.field} exceeds its reviewed gas ceiling`);
  }
  const maxFeePerGas = BigInt(feePolicy.maxFeePerGas);
  const maxPriorityFeePerGas = BigInt(feePolicy.maxPriorityFeePerGas);
  if (
    maxFeePerGas <= 0n ||
    maxFeePerGas > DEEP_V3_MAX_FEE_PER_GAS_WEI ||
    maxPriorityFeePerGas < 0n ||
    maxPriorityFeePerGas > DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI ||
    maxPriorityFeePerGas > maxFeePerGas
  ) {
    throw new Error("The deployment fee envelope is outside policy");
  }
  const balance = snapshots
    .map((snapshot) => BigInt(snapshot.balance))
    .reduce((left, right) => (left < right ? left : right));
  const maximumDebit = gas * maxFeePerGas;
  if (balance < maximumDebit) {
    throw new Error("The deployment wallet balance is below the gas ceiling");
  }
  const request = {
    from: transaction.from,
    nonce: deepV3Quantity(transaction.nonce),
    value: "0x0",
    data: transaction.data,
    gas: deepV3Quantity(gas),
    maxFeePerGas: deepV3Quantity(maxFeePerGas),
    maxPriorityFeePerGas: deepV3Quantity(maxPriorityFeePerGas),
  };
  if (transaction.to) request.to = transaction.to;
  const preparedDigest = keccak256(
    stringToHex(
      JSON.stringify({
        planDigest: plan.digest,
        index: transaction.index,
        calldataHash: transaction.calldataHash,
        request,
        maximumDebit: maximumDebit.toString(),
      }),
    ),
  );
  return {
    index: transaction.index,
    field: transaction.field,
    label: transaction.label,
    address: transaction.runtimes[0].address,
    calldataHash: transaction.calldataHash,
    liveEstimatedGas: estimate.toString(),
    gasLimit: gas.toString(),
    maximumDebitWei: maximumDebit.toString(),
    preparedDigest,
    request,
  };
}

export function validateDeepV3DeploymentTransactionRecord({
  plan,
  index,
  transaction,
  receipt,
}) {
  if (!Number.isInteger(index) || index < 0 || index >= 6) {
    throw new Error("The Deep V3 deployment transaction index is invalid");
  }
  const expected = plan.transactions[index];
  const expectedTo = expected.to
    ? normalizeDeepV3Hex(expected.to)
    : null;
  if (
    normalizeDeepV3Hex(transaction?.from) !==
      normalizeDeepV3Hex(expected.from) ||
    (transaction?.to
      ? normalizeDeepV3Hex(transaction.to)
      : null) !== expectedTo ||
    Number(BigInt(transaction?.nonce ?? -1)) !== expected.nonce ||
    BigInt(transaction?.value ?? -1) !== 0n ||
    normalizeDeepV3Hex(transaction?.input) !==
      normalizeDeepV3Hex(expected.data)
  ) {
    throw new Error(
      "The submitted transaction does not match the reviewed Deep V3 plan",
    );
  }
  if (receipt === null || receipt === undefined) {
    return { status: "pending", hash: transaction.hash };
  }
  if (
    normalizeDeepV3Hex(receipt.status) !== "0x1" &&
    receipt.status !== "success"
  ) {
    throw new Error(`${expected.field} reverted on Ethereum Mainnet`);
  }
  if (
    normalizeDeepV3Hex(receipt.transactionHash) !==
      normalizeDeepV3Hex(transaction.hash) ||
    normalizeDeepV3Hex(receipt.blockHash) !==
      normalizeDeepV3Hex(transaction.blockHash)
  ) {
    throw new Error("The Deep V3 receipt is not bound to its transaction");
  }
  return {
    status: "confirmed",
    hash: transaction.hash,
    blockNumber: Number(BigInt(receipt.blockNumber)),
    blockHash: receipt.blockHash,
  };
}

export function deepV3OracleRepeatCount(cardinalityNext) {
  if (
    !Number.isSafeInteger(cardinalityNext) ||
    cardinalityNext < 2 ||
    cardinalityNext > 192
  ) {
    throw new Error("The Deep V3 oracle cardinality is invalid");
  }
  return Math.ceil((192 - cardinalityNext) / 16);
}

export function buildDeepV3CanaryIdentity({
  releaseCommit,
  account,
  nonce,
}) {
  if (
    !validDeepV3Commit(releaseCommit) ||
    !isAddress(account ?? "") ||
    !Number.isSafeInteger(nonce) ||
    nonce < 0
  ) {
    throw new Error("The Deep V3 canary identity is invalid");
  }
  const creatorSalt = keccak256(
    stringToHex(
      `programmable.deep-v3.mainnet-canary:${releaseCommit}:${getAddress(account)}:${nonce}`,
    ),
  );
  return {
    name: "Deep Canary",
    symbol: "DEEPCANARY",
    creatorSalt,
    metadata: {
      description: "Programmable Deep Mainnet release canary.",
      website: "https://programmable.family/",
      image:
        "https://programmable.family/brand/programmable-token-fallback-01-dawn.webp",
      extraData: stringToHex(
        JSON.stringify({
          v: 3,
          purpose: "deep-mainnet-canary",
          releaseCommit,
        }),
      ),
    },
  };
}

export function encodeDeepV3CanaryLaunch({
  identity,
  minimumInitialTokenOut,
  initialBuySqrtPriceLimitX96,
  deadline,
}) {
  if (
    BigInt(minimumInitialTokenOut) <= 1n ||
    BigInt(initialBuySqrtPriceLimitX96) <= 0n ||
    BigInt(deadline) <= 0n
  ) {
    throw new Error("The Deep V3 canary protections are invalid");
  }
  return encodeFunctionData({
    abi: deepV3LauncherAbi,
    functionName: "launch",
    args: [
      {
        name: identity.name,
        symbol: identity.symbol,
        metadata: identity.metadata,
        creatorSalt: identity.creatorSalt,
        minimumInitialTokenOut: BigInt(minimumInitialTokenOut),
        initialBuySqrtPriceLimitX96: BigInt(
          initialBuySqrtPriceLimitX96,
        ),
        deadline: BigInt(deadline),
      },
    ],
  });
}

export function encodeDeepV3OracleGrowth(vault, cardinalityNext) {
  if (!isAddress(vault ?? "")) {
    throw new Error("The Deep V3 canary vault is invalid");
  }
  const repeats = deepV3OracleRepeatCount(cardinalityNext);
  if (repeats === 0) {
    throw new Error("The Deep V3 oracle is already at its target");
  }
  return encodeFunctionData({
    abi: deepV3AutomationAbi,
    functionName: "stageOracleBatch",
    args: [Array.from({ length: repeats }, () => getAddress(vault))],
  });
}

export function encodeDeepV3Compound(vault) {
  if (!isAddress(vault ?? "")) {
    throw new Error("The Deep V3 canary vault is invalid");
  }
  return encodeFunctionData({
    abi: deepV3KeeperExecutorAbi,
    functionName: "execute",
    args: [[{ vault: getAddress(vault), expectedAction: 1 }]],
  });
}

export function decideDeepV3CanaryAction(state) {
  if (!state?.launched) return "launch";
  if (!isAddress(state.token ?? "") || !isAddress(state.vault ?? "")) {
    throw new Error("The Deep V3 canary launch identity is incomplete");
  }
  if (state.cardinalityNext < 192) return "growOracle";
  if (
    !Number.isSafeInteger(state.oracleGrowthTimestamp) ||
    state.oracleGrowthTimestamp <= 0
  ) {
    throw new Error(
      "The target Deep V3 oracle event is missing",
    );
  }
  if (
    BigInt(state.oracleGrowthTimestamp ?? 0) +
      DEEP_V3_ORACLE_MATURITY_SECONDS >
    BigInt(state.timestamp ?? 0)
  ) {
    return "waitOracle";
  }
  if (state.compounded) return "complete";
  if (Number(state.action) !== 1) return "waitFees";
  return "compound";
}

export function decodeOneDeepV3Event(receipt, address, event, label) {
  const decoded = [];
  for (const log of receipt?.logs ?? []) {
    if (
      normalizeDeepV3Hex(log.address) !== normalizeDeepV3Hex(address)
    ) {
      continue;
    }
    try {
      decoded.push(
        decodeEventLog({
          abi: [event],
          topics: log.topics,
          data: log.data,
          strict: true,
        }),
      );
    } catch {
      // A receipt can include unrelated events from the same contract.
    }
  }
  if (decoded.length !== 1) {
    throw new Error(`Expected exactly one ${label} event`);
  }
  return decoded[0].args;
}

export function assertDeepV3CanaryLaunchCalldata({
  transaction,
  identity,
  minimumPriceLimit,
  blockTimestamp,
}) {
  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: deepV3LauncherAbi,
      data: transaction.input,
    });
  } catch {
    throw new Error("The canary launch calldata is not a Deep V3 launch");
  }
  if (decoded.functionName !== "launch") {
    throw new Error("The canary transaction does not call launch");
  }
  const parameters = decoded.args[0];
  if (
    parameters.name !== identity.name ||
    parameters.symbol !== identity.symbol ||
    parameters.creatorSalt !== identity.creatorSalt ||
    JSON.stringify(parameters.metadata) !==
      JSON.stringify(identity.metadata) ||
    parameters.minimumInitialTokenOut <= 1n ||
    parameters.initialBuySqrtPriceLimitX96 !==
      BigInt(minimumPriceLimit) ||
    parameters.deadline < BigInt(blockTimestamp)
  ) {
    throw new Error("The canary launch parameters drifted");
  }
  return parameters;
}

export function canonicalDeepV3EvidenceHash(value) {
  return keccak256(stringToHex(JSON.stringify(value)));
}

export function assertDeepV3RpcUrls(urls) {
  if (
    !Array.isArray(urls) ||
    urls.length !== 2 ||
    new Set(urls).size !== 2
  ) {
    throw new Error("Two distinct Ethereum Mainnet RPCs are required");
  }
  for (const value of urls) {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new Error("Deep V3 operator RPCs must use HTTPS");
    }
  }
}

export function publicDeepV3DeploymentPlan(plan) {
  return {
    chainId: plan.chainId,
    releaseCommit: plan.releaseCommit,
    sourceCommitment: plan.sourceCommitment,
    deployer: plan.deployer,
    treasury: plan.treasury,
    startingNonce: plan.startingNonce,
    endingNonce: plan.endingNonce,
    hookSalt: plan.hookSalt,
    addresses: plan.addresses,
    digest: plan.digest,
    transactions: plan.transactions.map((transaction) => ({
      index: transaction.index,
      field: transaction.field,
      label: transaction.label,
      from: transaction.from,
      to: transaction.to,
      nonce: transaction.nonce,
      valueWei: "0",
      calldataHash: transaction.calldataHash,
      gasCeiling: transaction.gasCeiling.toString(),
      runtimes: transaction.runtimes,
    })),
  };
}

export function emptyAddress() {
  return ADDRESS_ZERO;
}
