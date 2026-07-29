import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  getContractAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
} from "viem";

export const STOCK_PAIRED_ETH_COORDINATOR_CHAIN_ID = 1;
export const STOCK_PAIRED_ETH_COORDINATOR_DEPLOYER =
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E";
export const STOCK_PAIRED_ETH_COORDINATOR_ARTIFACT =
  "contracts/out/StockPairedEthLaunchCoordinatorV1.sol/StockPairedEthLaunchCoordinatorV1.json";
export const STOCK_PAIRED_ETH_COORDINATOR_MANIFEST =
  "contracts/deployments/mainnet-stock-paired-v1.json";
export const STOCK_PAIRED_ETH_COORDINATOR_EVIDENCE =
  "tmp/stock-paired-eth-coordinator-mainnet-evidence.json";
export const STOCK_PAIRED_ETH_COORDINATOR_MAX_RUNTIME_BYTES = 24_576;
export const STOCK_PAIRED_ETH_COORDINATOR_MAX_INITCODE_BYTES = 49_152;
export const STOCK_PAIRED_ETH_COORDINATOR_GAS_PADDING_BPS = 12_000n;
export const STOCK_PAIRED_ETH_COORDINATOR_MAX_GAS = 5_000_000n;
export const STOCK_PAIRED_ETH_COORDINATOR_MAX_FEE_PER_GAS = 100_000_000_000n;
export const STOCK_PAIRED_ETH_COORDINATOR_MAX_PRIORITY_FEE_PER_GAS =
  5_000_000_000n;
export const STOCK_PAIRED_ETH_COORDINATOR_MIN_PRIORITY_FEE_PER_GAS =
  100_000_000n;

export const STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES = Object.freeze({
  launcher: {
    address: "0x195750f33caD5eF2DF857a53226B421297A1e79e",
    runtimeCodeHash:
      "0xbd6f60760341db3d4ed31118676ab4342d0868cff42cc6f8205d877086fbce65",
  },
  v3SwapRouter: {
    address: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    runtimeCodeHash:
      "0xbb90113d2f9a5e9b7feb15a1d1fff06c1ee1575b3f9b1181778ffd0cf633e7ea",
  },
  v3Factory: {
    address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    runtimeCodeHash:
      "0x4d7b8525cd5d14343fa67a732fba5b24cddba11620ca88392f4ec6c52f91fd69",
  },
  weth: {
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    runtimeCodeHash:
      "0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23",
  },
  usdc: {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    runtimeCodeHash:
      "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505",
  },
});

export const STOCK_PAIRED_ETH_COORDINATOR_ASSETS = Object.freeze([
  ["NVDAon", "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE", 10_000],
  ["SPYon", "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08", 3_000],
  ["GOOGLon", "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc", 10_000],
  ["SLVon", "0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4", 10_000],
  ["TSLAon", "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f", 10_000],
  ["AAPLon", "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c", 10_000],
]);

const releasePaths = Object.freeze([
  "contracts/foundry.toml",
  "contracts/remappings.txt",
  "contracts/dependencies/source-pins.json",
  "contracts/dependencies/ethereum-mainnet.json",
  "contracts/src",
  "contracts/src/StockPairedEthLaunchCoordinatorV1.sol",
  "contracts/test/StockPairedLaunchV1.t.sol",
  "contracts/test/StockPairedMainnetFork.t.sol",
  "contracts/scripts/capture-stock-paired-eth-coordinator.mjs",
  "contracts/scripts/capture-stock-paired-eth-lifecycle.mjs",
  "contracts/scripts/verify-stock-paired-eth-coordinator-source.mjs",
  "scripts/stock-paired-eth-coordinator-operator-core.mjs",
  "scripts/stock-paired-eth-canary-core.mjs",
  "scripts/serve-stock-paired-eth-canary.mjs",
  "scripts/serve-stock-paired-eth-coordinator.mjs",
  "contracts/scripts/test/stock-paired-eth-canary.test.mjs",
  "contracts/scripts/test/stock-paired-eth-coordinator-operator.test.mjs",
  "package.json",
]);

export const stockPairedEthCoordinatorOperatorAbi = parseAbi([
  "function launcher() view returns (address)",
  "function v3SwapRouter() view returns (address)",
  "function v3Factory() view returns (address)",
  "function weth() view returns (address)",
  "function usdc() view returns (address)",
  "function stockPoolFee(address quoteAsset) view returns (uint24)",
  "function routePath(address quoteAsset) view returns (bytes)",
]);

function byteLength(value) {
  return (value.length - 2) / 2;
}

function validBytecode(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`${label} bytecode is unavailable`);
  }
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return typeof value === "bigint" ? value.toString() : value;
}

export function stockPairedEthCoordinatorDigest(value) {
  return keccak256(stringToHex(JSON.stringify(stable(value))));
}

export function assertStockPairedEthCoordinatorCheckout(
  root,
  releaseCommit,
  { allowDescendant = false, build = true } = {},
) {
  if (
    typeof releaseCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(releaseCommit)
  ) {
    throw new Error("A full coordinator release commit is required");
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
    if (!allowDescendant) {
      throw new Error("The checkout is not at the coordinator release commit");
    }
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", releaseCommit, head],
        {
          cwd: root,
          stdio: "ignore",
        },
      );
    } catch {
      throw new Error(
        "The canary checkout does not descend from the coordinator release",
      );
    }
  }
  const dirty = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all", "--", ...releasePaths],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (dirty) {
    throw new Error("The coordinator release files have uncommitted changes");
  }
  if (build) buildStockPairedEthCoordinatorArtifact(root);
}

export function buildStockPairedEthCoordinatorArtifact(root) {
  execFileSync("forge", ["build", "--force"], {
    cwd: path.join(root, "contracts"),
    stdio: "inherit",
  });
}

export function assertStockPairedEthCoordinatorRuntime(artifact, runtime) {
  const template = validBytecode(
    artifact?.deployedBytecode?.object,
    "Coordinator runtime",
  ).toLowerCase();
  if (
    typeof runtime !== "string" ||
    !/^0x[0-9a-f]+$/i.test(runtime) ||
    runtime.length !== template.length
  ) {
    throw new Error(
      "The coordinator runtime length does not match its artifact",
    );
  }
  let normalized = runtime.slice(2).toLowerCase();
  const templateBody = template.slice(2);
  const references = Object.values(
    artifact?.deployedBytecode?.immutableReferences ?? {},
  ).flat();
  if (
    references.length === 0 ||
    references.some(
      (reference) =>
        !Number.isSafeInteger(reference?.start) ||
        reference.start < 0 ||
        reference.length !== 32,
    )
  ) {
    throw new Error("The coordinator immutable references are malformed");
  }
  for (const reference of references) {
    const start = reference.start * 2;
    const end = start + reference.length * 2;
    normalized =
      normalized.slice(0, start) +
      templateBody.slice(start, end) +
      normalized.slice(end);
  }
  if (normalized !== templateBody) {
    throw new Error(
      "The coordinator runtime differs from its reviewed artifact",
    );
  }
  return {
    runtimeCodeHash: keccak256(runtime),
    runtimeBytes: byteLength(runtime),
  };
}

export async function loadStockPairedEthCoordinatorPlan(
  root,
  { releaseCommit, nonce },
) {
  const [artifact, manifest] = await Promise.all([
    readFile(
      path.join(root, STOCK_PAIRED_ETH_COORDINATOR_ARTIFACT),
      "utf8",
    ).then(JSON.parse),
    readFile(
      path.join(root, STOCK_PAIRED_ETH_COORDINATOR_MANIFEST),
      "utf8",
    ).then(JSON.parse),
  ]);
  if (
    manifest.addresses?.launcher?.toLowerCase() !==
    STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.launcher.address.toLowerCase()
  ) {
    throw new Error(
      "The base Stock-Paired launcher does not match the reviewed release",
    );
  }
  const creation = validBytecode(
    artifact?.bytecode?.object,
    "Coordinator creation",
  );
  const runtime = validBytecode(
    artifact?.deployedBytecode?.object,
    "Coordinator runtime",
  );
  if (
    byteLength(creation) > STOCK_PAIRED_ETH_COORDINATOR_MAX_INITCODE_BYTES ||
    byteLength(runtime) > STOCK_PAIRED_ETH_COORDINATOR_MAX_RUNTIME_BYTES
  ) {
    throw new Error("The coordinator exceeds an Ethereum bytecode limit");
  }
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new Error("The coordinator deployment nonce is invalid");
  }
  const quoteAssets = STOCK_PAIRED_ETH_COORDINATOR_ASSETS.map(([, address]) =>
    getAddress(address),
  );
  const stockPoolFees = STOCK_PAIRED_ETH_COORDINATOR_ASSETS.map(
    ([, , fee]) => fee,
  );
  const constructorArguments = encodeAbiParameters(
    parseAbiParameters(
      "address,address,address,address,address,address[],uint24[]",
    ),
    [
      getAddress(STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.launcher.address),
      getAddress(
        STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.v3SwapRouter.address,
      ),
      getAddress(STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.v3Factory.address),
      getAddress(STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.weth.address),
      getAddress(STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.usdc.address),
      quoteAssets,
      stockPoolFees,
    ],
  );
  const data = concatHex([creation, constructorArguments]);
  const address = getContractAddress({
    from: getAddress(STOCK_PAIRED_ETH_COORDINATOR_DEPLOYER),
    nonce: BigInt(nonce),
  });
  return {
    schemaVersion: 1,
    chainId: STOCK_PAIRED_ETH_COORDINATOR_CHAIN_ID,
    releaseCommit,
    sourceCommitment: keccak256(data),
    deployer: getAddress(STOCK_PAIRED_ETH_COORDINATOR_DEPLOYER),
    nonce,
    address,
    data,
    constructorArguments,
    calldataHash: keccak256(data),
    artifact,
    checks: [
      ["launcher", STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.launcher.address],
      [
        "v3SwapRouter",
        STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.v3SwapRouter.address,
      ],
      [
        "v3Factory",
        STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.v3Factory.address,
      ],
      ["weth", STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.weth.address],
      ["usdc", STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.usdc.address],
    ].map(([functionName, expected]) => ({
      label: functionName,
      data: encodeFunctionData({
        abi: stockPairedEthCoordinatorOperatorAbi,
        functionName,
      }),
      expected: getAddress(expected),
    })),
    routeChecks: STOCK_PAIRED_ETH_COORDINATOR_ASSETS.map(
      ([symbol, quoteAsset, fee]) => ({
        symbol,
        quoteAsset: getAddress(quoteAsset),
        fee,
        expectedPath: encodePacked(
          ["address", "uint24", "address", "uint24", "address"],
          [
            getAddress(STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.weth.address),
            500,
            getAddress(STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.usdc.address),
            fee,
            getAddress(quoteAsset),
          ],
        ),
        feeData: encodeFunctionData({
          abi: stockPairedEthCoordinatorOperatorAbi,
          functionName: "stockPoolFee",
          args: [getAddress(quoteAsset)],
        }),
        pathData: encodeFunctionData({
          abi: stockPairedEthCoordinatorOperatorAbi,
          functionName: "routePath",
          args: [getAddress(quoteAsset)],
        }),
      }),
    ),
  };
}

export function prepareStockPairedEthCoordinatorTransaction(
  plan,
  state,
  simulations,
) {
  const confirmedNonce = BigInt(state.confirmedNonce);
  const pendingNonce = BigInt(state.pendingNonce);
  if (
    confirmedNonce !== BigInt(plan.nonce) ||
    pendingNonce !== confirmedNonce
  ) {
    throw new Error(
      "The deployment wallet has another nonce or pending transaction",
    );
  }
  if (state.code !== "0x") {
    throw new Error("The predicted coordinator address is already occupied");
  }
  if (
    !Array.isArray(simulations) ||
    simulations.length !== 2 ||
    simulations.some(
      (simulation) =>
        !simulation?.callResult ||
        simulation.callResult === "0x" ||
        BigInt(simulation.estimatedGas ?? 0) <= 0n,
    ) ||
    simulations[0].callResult.toLowerCase() !==
      simulations[1].callResult.toLowerCase()
  ) {
    throw new Error("Independent RPC coordinator simulations disagree");
  }
  const runtime = assertStockPairedEthCoordinatorRuntime(
    plan.artifact,
    simulations[0].callResult,
  );
  const estimatedGas = simulations.reduce((highest, simulation) => {
    const value = BigInt(simulation.estimatedGas);
    return value > highest ? value : highest;
  }, 0n);
  const gas =
    (estimatedGas * STOCK_PAIRED_ETH_COORDINATOR_GAS_PADDING_BPS + 9_999n) /
    10_000n;
  if (gas > STOCK_PAIRED_ETH_COORDINATOR_MAX_GAS) {
    throw new Error("The coordinator deployment gas exceeds the reviewed cap");
  }
  const baseFee = BigInt(state.baseFeePerGas);
  const observedPriority = BigInt(state.priorityFeePerGas);
  const priorityFee =
    observedPriority < STOCK_PAIRED_ETH_COORDINATOR_MIN_PRIORITY_FEE_PER_GAS
      ? STOCK_PAIRED_ETH_COORDINATOR_MIN_PRIORITY_FEE_PER_GAS
      : observedPriority;
  const maxPriorityFeePerGas =
    priorityFee > STOCK_PAIRED_ETH_COORDINATOR_MAX_PRIORITY_FEE_PER_GAS
      ? STOCK_PAIRED_ETH_COORDINATOR_MAX_PRIORITY_FEE_PER_GAS
      : priorityFee;
  const proposedMaxFee = baseFee * 2n + maxPriorityFeePerGas;
  if (proposedMaxFee > STOCK_PAIRED_ETH_COORDINATOR_MAX_FEE_PER_GAS) {
    throw new Error("Mainnet gas is above the reviewed coordinator fee cap");
  }
  const maxFeePerGas = proposedMaxFee;
  const requiredBalance = gas * maxFeePerGas;
  if (BigInt(state.balance) < requiredBalance) {
    throw new Error("The deployment wallet does not have enough ETH");
  }
  const request = {
    from: plan.deployer,
    data: plan.data,
    value: "0x0",
    nonce: `0x${BigInt(plan.nonce).toString(16)}`,
    gas: `0x${gas.toString(16)}`,
    maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
    maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
    type: "0x2",
    chainId: "0x1",
  };
  return {
    address: plan.address,
    sourceCommitment: plan.sourceCommitment,
    runtimeCodeHash: runtime.runtimeCodeHash,
    runtimeBytes: runtime.runtimeBytes,
    estimatedGas: estimatedGas.toString(),
    gasLimit: gas.toString(),
    requiredBalance: requiredBalance.toString(),
    calldataHash: plan.calldataHash,
    request,
    preparedDigest: stockPairedEthCoordinatorDigest({
      address: plan.address,
      sourceCommitment: plan.sourceCommitment,
      runtimeCodeHash: runtime.runtimeCodeHash,
      request,
    }),
  };
}

export function assertStockPairedEthCoordinatorRevalidation(
  plan,
  prepared,
  state,
  simulations,
) {
  const confirmedNonce = BigInt(state.confirmedNonce);
  const pendingNonce = BigInt(state.pendingNonce);
  if (
    confirmedNonce !== BigInt(plan.nonce) ||
    pendingNonce !== confirmedNonce ||
    BigInt(prepared.request.nonce) !== confirmedNonce
  ) {
    throw new Error(
      "The deployment wallet has another nonce or pending transaction",
    );
  }
  if (state.code !== "0x") {
    throw new Error("The predicted coordinator address is already occupied");
  }
  if (BigInt(state.balance) < BigInt(prepared.requiredBalance)) {
    throw new Error("The deployment wallet no longer has enough ETH");
  }
  if (
    BigInt(state.baseFeePerGas) +
      BigInt(prepared.request.maxPriorityFeePerGas) >
    BigInt(prepared.request.maxFeePerGas)
  ) {
    throw new Error("Mainnet gas moved above the reviewed coordinator fee cap");
  }
  if (
    !Array.isArray(simulations) ||
    simulations.length !== 2 ||
    simulations.some(
      (simulation) =>
        !simulation?.callResult ||
        simulation.callResult === "0x" ||
        BigInt(simulation.estimatedGas ?? 0) <= 0n ||
        BigInt(simulation.estimatedGas) > BigInt(prepared.request.gas),
    ) ||
    simulations[0].callResult.toLowerCase() !==
      simulations[1].callResult.toLowerCase()
  ) {
    throw new Error(
      "The reviewed coordinator no longer passes both RPC simulations",
    );
  }
  const runtime = assertStockPairedEthCoordinatorRuntime(
    plan.artifact,
    simulations[0].callResult,
  );
  if (
    runtime.runtimeCodeHash.toLowerCase() !==
    prepared.runtimeCodeHash.toLowerCase()
  ) {
    throw new Error("The simulated coordinator runtime changed");
  }
  return true;
}

export function validateStockPairedEthCoordinatorReceipt(
  plan,
  prepared,
  transaction,
  receipt,
) {
  if (
    !transaction ||
    !receipt ||
    !/^0x[0-9a-f]{64}$/i.test(transaction.hash ?? "") ||
    receipt.status !== "0x1" ||
    transaction.hash?.toLowerCase() !==
      receipt.transactionHash?.toLowerCase() ||
    transaction.from?.toLowerCase() !== plan.deployer.toLowerCase() ||
    receipt.from?.toLowerCase() !== plan.deployer.toLowerCase() ||
    transaction.to !== null ||
    receipt.to !== null ||
    Number(BigInt(transaction.nonce)) !== plan.nonce ||
    transaction.input?.toLowerCase() !== plan.data.toLowerCase() ||
    BigInt(transaction.value ?? 0) !== 0n ||
    receipt.contractAddress?.toLowerCase() !== plan.address.toLowerCase() ||
    (transaction.chainId != null && BigInt(transaction.chainId) !== 1n) ||
    transaction.gas == null ||
    transaction.maxFeePerGas == null ||
    transaction.maxPriorityFeePerGas == null ||
    receipt.gasUsed == null ||
    receipt.effectiveGasPrice == null ||
    BigInt(transaction.gas ?? 0) > BigInt(prepared.request.gas) ||
    BigInt(transaction.maxFeePerGas ?? 0) >
      BigInt(prepared.request.maxFeePerGas) ||
    BigInt(transaction.maxPriorityFeePerGas ?? 0) >
      BigInt(prepared.request.maxPriorityFeePerGas) ||
    BigInt(receipt.gasUsed ?? 0) > BigInt(prepared.request.gas) ||
    BigInt(receipt.effectiveGasPrice ?? 0) >
      BigInt(prepared.request.maxFeePerGas)
  ) {
    throw new Error(
      "The coordinator receipt does not match the reviewed deployment",
    );
  }
  return {
    schemaVersion: 1,
    chainId: 1,
    releaseCommit: plan.releaseCommit,
    sourceCommitment: plan.sourceCommitment,
    deployer: plan.deployer,
    nonce: plan.nonce,
    address: plan.address,
    transactionHash: transaction.hash.toLowerCase(),
    blockNumber: Number(BigInt(receipt.blockNumber)),
    blockHash: receipt.blockHash.toLowerCase(),
    transactionIndex: Number(BigInt(receipt.transactionIndex)),
    gasUsed: BigInt(receipt.gasUsed).toString(),
    effectiveGasPrice: BigInt(receipt.effectiveGasPrice).toString(),
    runtimeCodeHash: prepared.runtimeCodeHash,
    runtimeBytes: prepared.runtimeBytes,
    preparedDigest: prepared.preparedDigest,
    gasLimit: prepared.gasLimit,
    maxFeePerGas: BigInt(prepared.request.maxFeePerGas).toString(),
    maxPriorityFeePerGas: BigInt(
      prepared.request.maxPriorityFeePerGas,
    ).toString(),
    constructorArguments: plan.constructorArguments,
    calldataHash: plan.calldataHash,
    capturedAt: new Date().toISOString(),
  };
}
