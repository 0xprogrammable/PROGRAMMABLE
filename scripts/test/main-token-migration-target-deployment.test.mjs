import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  keccak256,
  parseAbiParameters,
  stringToHex,
  toHex,
} from "viem";

import {
  MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY,
  MAIN_TOKEN_MIGRATION_TARGET_READ_ABIS,
  mainTokenMigrationTargetDeploymentReceiptSha256,
  normalizeMainTokenMigrationRpcProviders,
  prepareMainTokenMigrationTargetDeployment,
  preflightMainTokenMigrationTargetDeployment,
  revalidateMainTokenMigrationTargetWalletRequest,
  verifyMainTokenMigrationTargetDeploymentFinality,
} from "../main-token-migration-target-deployment-core.mjs";
import {
  parseMainTokenMigrationTargetOperatorArguments,
  loadProtectedTargetDeploymentRecovery,
  writeProtectedTargetAuthorizationCheckpoint,
  writeProtectedTargetDeploymentReceipt,
  writeProtectedTargetSubmissionCheckpoint,
} from "../serve-main-token-migration-target-deployment.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const OWNER = "0x2Bb333d48DFAF1596D9036671d2E43168994249E";
const REMAINDER = "0x228Be90653fDDAa408fB6cf9ca0AEC311dbE9A0D";
const DEADLINE = "1900000000";
const QUICKNODE_SECRET = "quicknode_secret_123456789";
const ALCHEMY_SECRET = "alchemy_secret_1234567890";
const DRPC_SECRET = "drpc_secret_1234567890";
const ETH_QUICKNODE_SECRET = "eth_quicknode_secret_123456789";
const ROBINHOOD_RPCS = [
  `https://hood.robinhood-mainnet.quiknode.pro/${QUICKNODE_SECRET}/`,
  `https://robinhood-mainnet.g.alchemy.com/v2/${ALCHEMY_SECRET}`,
];
const ETHEREUM_RPCS = [
  `https://lb.drpc.live/ethereum/${DRPC_SECRET}`,
  `https://ethereum.ethereum-mainnet.quiknode.pro/${ETH_QUICKNODE_SECRET}/`,
];
const DEPLOYER_RUNTIME =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
const ZERO_HASH = `0x${"00".repeat(32)}`;
const LATEST_HASH = `0x${"11".repeat(32)}`;
const FINALIZED_HASH = `0x${"22".repeat(32)}`;
const PENDING_PARENT = `0x${"33".repeat(32)}`;
const DEPLOYMENT_BLOCK_HASH = `0x${"44".repeat(32)}`;
const L2_COMMON_FINALIZED_HASH = `0x${"55".repeat(32)}`;
const TX_HASH = `0x${"66".repeat(32)}`;
const POSTING_TX_HASH = `0x${"77".repeat(32)}`;
const POSTING_BLOCK_HASH = `0x${"88".repeat(32)}`;
const ETH_FINALIZED_HASH = `0x${"99".repeat(32)}`;
const BEFORE_ACC = `0x${"aa".repeat(32)}`;
const AFTER_ACC = `0x${"bb".repeat(32)}`;
const DELAYED_ACC = `0x${"cc".repeat(32)}`;
const BATCH_TOPIC = `0x${42n.toString(16).padStart(64, "0")}`;
const SEQUENCER_TOPIC =
  "0x7394f4a19a13c7b92b5bb71033245305946ef78452f7b4986ac1390b5df4ebd7";
const SEQUENCER_INBOX = "0xBd0D173EEb87D57A09521c24388a12789F33ba96";
const NODE_INTERFACE = "0x00000000000000000000000000000000000000C8";

function block(number, hash, timestamp = 1_788_000_000n) {
  return {
    number: toHex(number),
    hash,
    timestamp: toHex(timestamp),
    gasLimit: toHex(30_000_000n),
  };
}

async function fixture() {
  const [targetDesign, tokenArtifact] = await Promise.all([
    readFile(join(ROOT, "config/main-token-migration-target-design.v1.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(
      join(
        ROOT,
        "contracts/out/ProgrammableV4TokenV1.sol/ProgrammableV4TokenV1.json",
      ),
      "utf8",
    ).then(JSON.parse),
  ]);
  const ownerFields = {
    sourceDeadlineTimestampExclusive: DEADLINE,
    sealAuthority: OWNER,
    remainderRecipient: REMAINDER,
  };
  const plan = prepareMainTokenMigrationTargetDeployment({
    targetDesign,
    tokenArtifact,
    owner: OWNER,
    ownerFields,
  });
  return { targetDesign, tokenArtifact, ownerFields, plan };
}

function preflightRpc(
  plan,
  {
    divergent = false,
    finalizedTimestamp = 1_788_000_000n,
    ownerCode = "0x",
  } = {},
) {
  return async ({ providerId, method, params }) => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getBlockByNumber") {
      if (params[0] === "latest") return block(104n, LATEST_HASH);
      if (params[0] === "finalized") {
        return block(100n, FINALIZED_HASH, finalizedTimestamp);
      }
      if (params[0] === "pending") {
        return {
          parentHash: PENDING_PARENT,
          timestamp: toHex(1_788_000_001n),
          gasLimit: toHex(30_000_000n),
          baseFeePerGas: toHex(100n),
        };
      }
      if (params[0] === "0x64") {
        return block(
          100n,
          divergent && providerId === "alchemy"
            ? `0x${"ef".repeat(32)}`
            : FINALIZED_HASH,
          finalizedTimestamp,
        );
      }
      throw new Error(`unexpected block ${params[0]}`);
    }
    if (method === "eth_getTransactionCount") {
      const address = params[0].toLowerCase();
      if (
        address === plan.predicted.token.toLowerCase() ||
        address === plan.predicted.distributor.toLowerCase()
      ) {
        return "0x0";
      }
      return "0x5";
    }
    if (method === "eth_getCode") {
      const address = params[0].toLowerCase();
      if (address === plan.to.toLowerCase()) return DEPLOYER_RUNTIME;
      if (address === plan.owner.toLowerCase()) return ownerCode;
      return "0x";
    }
    if (method === "eth_call") return plan.predicted.token.toLowerCase();
    if (method === "eth_estimateGas") return toHex(1_000_000n);
    if (method === "eth_gasPrice") return toHex(250n);
    if (method === "eth_maxPriorityFeePerGas") return toHex(5n);
    if (method === "eth_getBalance") return toHex(10n ** 20n);
    throw new Error(`unexpected ${providerId} ${method}`);
  };
}

async function envelope(plan, rpcClient = preflightRpc(plan)) {
  return preflightMainTokenMigrationTargetDeployment({
    plan,
    rpcUrls: ROBINHOOD_RPCS,
    maximumFeePerGasWei: "1000",
    maximumPriorityFeePerGasWei: "100",
    maximumGasCostWei: "100000000000000000",
    rpcClient,
    clock: () => 1_788_000_002_000,
  });
}

test("prepares exact deterministic CREATE2 token and constructor-created distributor", async () => {
  const { plan } = await fixture();
  const second = (await fixture()).plan;
  assert.deepEqual(plan, second);
  assert.equal(plan.to, MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.deterministicDeployer);
  assert.match(plan.preparedDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(plan.salt, /^0x[0-9a-f]{64}$/u);
  assert.equal(plan.transactionData.slice(0, 66), plan.salt);
  assert.equal(plan.value, "0x0");
  assert.equal(plan.automaticSigning, false);
  assert.equal(plan.automaticBroadcast, false);
  assert.equal(plan.predicted.token, "0x9Cdf11d6a11C6c25A117fa025BD2fAE18E5f7def");
  assert.equal(
    plan.predicted.distributor,
    "0xcaa1f4b25001482F6E150b507D62D640360beEFc",
  );
});

test("rejects substituted creation bytecode even when metadata and sources are unchanged", async () => {
  const { targetDesign, tokenArtifact, ownerFields } = await fixture();
  const substituted = structuredClone(tokenArtifact);
  const bytecode = substituted.bytecode.object;
  substituted.bytecode.object = `${bytecode.slice(0, -2)}${
    bytecode.endsWith("00") ? "01" : "00"
  }`;
  assert.throws(
    () =>
      prepareMainTokenMigrationTargetDeployment({
        targetDesign,
        tokenArtifact: substituted,
        owner: OWNER,
        ownerFields,
      }),
    /differs from the frozen reviewed build/u,
  );
});

test("rejects release and snapshot hashes that do not bind exact text", async () => {
  const { targetDesign, tokenArtifact, ownerFields } = await fixture();
  assert.throws(
    () =>
      prepareMainTokenMigrationTargetDeployment({
        targetDesign: { ...targetDesign, releaseIdHash: `0x${"12".repeat(32)}` },
        tokenArtifact,
        owner: OWNER,
        ownerFields,
      }),
    /release ID hash does not bind/u,
  );
  assert.throws(
    () =>
      prepareMainTokenMigrationTargetDeployment({
        targetDesign: {
          ...targetDesign,
          source: {
            ...targetDesign.source,
            snapshotRuleHash: `0x${"13".repeat(32)}`,
          },
        },
        tokenArtifact,
        owner: OWNER,
        ownerFields,
      }),
    /snapshot rule hash does not bind/u,
  );
});

test("requires credentialed provider pins and never publishes endpoint secrets", async () => {
  assert.throws(
    () =>
      normalizeMainTokenMigrationRpcProviders([
        "https://rpc.mainnet.chain.robinhood.com",
        ROBINHOOD_RPCS[1],
      ]),
    /credential-bearing production endpoint/u,
  );
  const { plan } = await fixture();
  const prepared = await envelope(plan);
  const serialized = JSON.stringify(prepared);
  for (const secret of [QUICKNODE_SECRET, ALCHEMY_SECRET]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(prepared.checks.independentAuthenticatedRpcCount, 2);
  assert.equal(prepared.checks.targetAndDistributorVacant, true);
  assert.equal(prepared.checks.ownerIsExactEoa, true);
  assert.equal(prepared.request.from, OWNER);
  assert.equal(prepared.request.to, plan.to);
  assert.equal(prepared.request.data, plan.transactionData);
});

test("fails closed when finalized RPC state disagrees", async () => {
  const { plan } = await fixture();
  await assert.rejects(
    () => envelope(plan, preflightRpc(plan, { divergent: true })),
    /RPCs disagree on the common finalized block/u,
  );
});

test("rejects deployment after the pre-window safety boundary", async () => {
  const { plan } = await fixture();
  await assert.rejects(
    () =>
      envelope(
        plan,
        preflightRpc(plan, {
          finalizedTimestamp:
            BigInt(plan.sourceWindowStartTimestampInclusive) - 899n,
        }),
      ),
    /does not precede the 96-hour source window safely/u,
  );
});

test("fails closed when the required exact EOA has an EIP-7702 designator", async () => {
  const { plan } = await fixture();
  await assert.rejects(
    () =>
      envelope(
        plan,
        preflightRpc(plan, {
          ownerCode: "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b",
        }),
      ),
    /owner EOA check failed/u,
  );
});

test("action-time revalidation binds wallet chain, account and every request field", async () => {
  const { plan } = await fixture();
  const prepared = await envelope(plan);
  const fresh = await revalidateMainTokenMigrationTargetWalletRequest({
    plan,
    envelope: prepared,
    connectedAccount: OWNER,
    walletChainId: "0x1237",
    rpcUrls: ROBINHOOD_RPCS,
    maximumFeePerGasWei: "1000",
    maximumPriorityFeePerGasWei: "100",
    maximumGasCostWei: "100000000000000000",
    rpcClient: preflightRpc(plan),
    clock: () => 1_788_000_002_000,
  });
  assert.deepEqual(fresh.request, prepared.request);
  await assert.rejects(
    () =>
      revalidateMainTokenMigrationTargetWalletRequest({
        plan,
        envelope: prepared,
        connectedAccount: REMAINDER,
        walletChainId: "0x1237",
        rpcUrls: ROBINHOOD_RPCS,
        maximumFeePerGasWei: "1000",
        maximumPriorityFeePerGasWei: "100",
        maximumGasCostWei: "100000000000000000",
        rpcClient: preflightRpc(plan),
        clock: () => 1_788_000_002_000,
      }),
    /connected wallet or chain differs/u,
  );
});

function encodedRead(abi, functionName, result) {
  return encodeFunctionResult({ abi, functionName, result });
}

function readMap(plan) {
  const token = MAIN_TOKEN_MIGRATION_TARGET_READ_ABIS.token;
  const distributor = MAIN_TOKEN_MIGRATION_TARGET_READ_ABIS.distributor;
  const values = new Map();
  const add = (address, abi, functionName, result, args = []) => {
    values.set(
      `${address.toLowerCase()}:${encodeFunctionData({ abi, functionName, args }).slice(0, 10)}`,
      encodedRead(abi, functionName, result),
    );
  };
  add(plan.predicted.token, token, "name", "Programmable");
  add(plan.predicted.token, token, "symbol", "V4");
  add(plan.predicted.token, token, "decimals", 18);
  add(plan.predicted.token, token, "totalSupply", 10n ** 27n);
  add(plan.predicted.token, token, "TARGET_CHAIN_ID", 4_663n);
  add(plan.predicted.token, token, "TOTAL_SUPPLY", 10n ** 27n);
  add(
    plan.predicted.token,
    token,
    "MIGRATION_DISTRIBUTOR",
    plan.predicted.distributor,
  );
  add(
    plan.predicted.token,
    token,
    "balanceOf",
    10n ** 27n,
    [plan.predicted.distributor],
  );
  add(plan.predicted.distributor, distributor, "TOKEN", plan.predicted.token);
  add(
    plan.predicted.distributor,
    distributor,
    "RELEASE_ID_HASH",
    plan.releaseIdHash,
  );
  add(plan.predicted.distributor, distributor, "SOURCE_CHAIN_ID", 1n);
  add(
    plan.predicted.distributor,
    distributor,
    "SOURCE_TOKEN",
    MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.sourceToken,
  );
  add(
    plan.predicted.distributor,
    distributor,
    "SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE",
    BigInt(DEADLINE),
  );
  add(
    plan.predicted.distributor,
    distributor,
    "SNAPSHOT_RULE_HASH",
    plan.snapshotRuleHash,
  );
  add(plan.predicted.distributor, distributor, "SEAL_AUTHORITY", OWNER);
  add(
    plan.predicted.distributor,
    distributor,
    "REMAINDER_RECIPIENT",
    REMAINDER,
  );
  add(plan.predicted.distributor, distributor, "TARGET_CHAIN_ID", 4_663n);
  add(
    plan.predicted.distributor,
    distributor,
    "TOKEN_TOTAL_SUPPLY_RAW",
    10n ** 27n,
  );
  add(plan.predicted.distributor, distributor, "isSealed", false);
  add(plan.predicted.distributor, distributor, "merkleRoot", ZERO_HASH);
  add(
    plan.predicted.distributor,
    distributor,
    "sourceSnapshotSha256",
    ZERO_HASH,
  );
  add(plan.predicted.distributor, distributor, "migrationTotalRaw", 0n);
  add(plan.predicted.distributor, distributor, "totalDistributedRaw", 0n);
  return values;
}

function terminalRpc(plan, prepared) {
  const reads = readMap(plan);
  const tokenRuntime = "0x6001600055";
  const distributorRuntime = "0x6002600055";
  const postingData = encodeAbiParameters(
    parseAbiParameters("bytes32,uint256,(uint64,uint64,uint64,uint64),uint8"),
    [DELAYED_ACC, 0n, [0n, 0n, 0n, 0n], 0],
  );
  const postingLog = {
    address: SEQUENCER_INBOX,
    topics: [SEQUENCER_TOPIC, BATCH_TOPIC, BEFORE_ACC, AFTER_ACC],
    data: postingData,
    transactionHash: POSTING_TX_HASH,
    transactionIndex: "0x0",
    blockNumber: "0x3e8",
    blockHash: POSTING_BLOCK_HASH,
    logIndex: "0x0",
    removed: false,
  };
  return async ({ rpcUrl, method, params }) => {
    const ethereum = rpcUrl.includes("ethereum-mainnet") || rpcUrl.includes("/ethereum/");
    if (ethereum) {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_getLogs") return [postingLog];
      if (method === "eth_getTransactionReceipt") {
        return {
          transactionHash: POSTING_TX_HASH,
          from: OWNER,
          to: SEQUENCER_INBOX,
          status: "0x1",
          blockNumber: "0x3e8",
          blockHash: POSTING_BLOCK_HASH,
          transactionIndex: "0x0",
          contractAddress: null,
          logs: [postingLog],
        };
      }
      if (method === "eth_getBlockByHash") {
        return block(1_000n, POSTING_BLOCK_HASH, 1_788_000_100n);
      }
      if (method === "eth_getBlockByNumber" && params[0] === "finalized") {
        return block(1_100n, ETH_FINALIZED_HASH, 1_788_001_000n);
      }
      throw new Error(`unexpected ethereum ${method}`);
    }
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getTransactionByHash") {
      return {
        hash: TX_HASH,
        from: prepared.request.from,
        to: prepared.request.to,
        input: prepared.request.data,
        value: prepared.request.value,
        nonce: prepared.request.nonce,
        gas: prepared.request.gas,
        maxFeePerGas: prepared.request.maxFeePerGas,
        maxPriorityFeePerGas: prepared.request.maxPriorityFeePerGas,
        type: "0x2",
        blockNumber: "0x69",
        blockHash: DEPLOYMENT_BLOCK_HASH,
      };
    }
    if (method === "eth_getTransactionReceipt") {
      return {
        transactionHash: TX_HASH,
        from: prepared.request.from,
        to: prepared.request.to,
        status: "0x1",
        blockNumber: "0x69",
        blockHash: DEPLOYMENT_BLOCK_HASH,
        gasUsed: "0xf4240",
        contractAddress: null,
      };
    }
    if (method === "eth_getBlockByNumber") {
      if (params[0] === "finalized") {
        return block(110n, L2_COMMON_FINALIZED_HASH, 1_788_000_020n);
      }
      if (params[0] === "0x69") {
        return block(105n, DEPLOYMENT_BLOCK_HASH, 1_788_000_010n);
      }
      if (params[0] === "0x6e") {
        return block(110n, L2_COMMON_FINALIZED_HASH, 1_788_000_020n);
      }
      throw new Error(`unexpected L2 block ${params[0]}`);
    }
    if (method === "eth_getCode") {
      if (params[0].toLowerCase() === plan.predicted.token.toLowerCase()) {
        return tokenRuntime;
      }
      if (
        params[0].toLowerCase() === plan.predicted.distributor.toLowerCase()
      ) {
        return distributorRuntime;
      }
      throw new Error(`unexpected code address ${params[0]}`);
    }
    if (method === "eth_call") {
      const target = params[0].to.toLowerCase();
      const data = params[0].data.toLowerCase();
      if (target === NODE_INTERFACE.toLowerCase()) {
        if (data.startsWith("0x81f1adaf")) return toHex(42n, { size: 32 });
        if (data.startsWith("0xe5ca238c")) return toHex(7n, { size: 32 });
      }
      const value = reads.get(`${target}:${data.slice(0, 10)}`);
      if (!value) throw new Error(`unexpected read ${target}:${data.slice(0, 10)}`);
      return value;
    }
    throw new Error(`unexpected L2 ${method}`);
  };
}

test("Robinhood finalized tags alone cannot produce an active deployment receipt", async () => {
  const { plan } = await fixture();
  const prepared = await envelope(plan);
  await assert.rejects(
    () =>
      verifyMainTokenMigrationTargetDeploymentFinality({
        plan,
        envelope: prepared,
        transactionHash: TX_HASH,
        rpcUrls: ROBINHOOD_RPCS,
        rpcClient: terminalRpc(plan, prepared),
      }),
    /finalized-tag agreement is insufficient/u,
  );
});

test("emits active-design fields only after dual L2 state and Ethereum-finalized batch proof", async () => {
  const { plan } = await fixture();
  const prepared = await envelope(plan);
  const receipt = await verifyMainTokenMigrationTargetDeploymentFinality({
    plan,
    envelope: prepared,
    transactionHash: TX_HASH,
    rpcUrls: ROBINHOOD_RPCS,
    ethereumRpcUrls: ETHEREUM_RPCS,
    ethereumPostingBlock: "1000",
    rpcClient: terminalRpc(plan, prepared),
  });
  assert.equal(receipt.state, "deployed-ethereum-finalized-source-window-pending");
  assert.equal(receipt.terminalFinality.terminalStage, "ethereum_finalized");
  assert.equal(receipt.terminalFinality.batchNumber, "42");
  assert.equal(receipt.deployment.transactionHash, TX_HASH);
  assert.equal(receipt.deployment.blockNumber, "105");
  assert.equal(receipt.deployment.finalizedBlockNumber, "110");
  assert.equal(receipt.deployment.independentRpcAgreement, true);
  assert.equal(
    receipt.deployment.distributorTokenBalanceRaw,
    "1000000000000000000000000000",
  );
  assert.equal(receipt.deployment.distributorIsSealed, false);
  assert.equal(receipt.deployment.verificationReceiptSha256, receipt.verificationReceiptSha256);
  assert.equal(
    mainTokenMigrationTargetDeploymentReceiptSha256(receipt),
    receipt.verificationReceiptSha256,
  );
  const serialized = JSON.stringify(receipt);
  for (const secret of [
    QUICKNODE_SECRET,
    ALCHEMY_SECRET,
    DRPC_SECRET,
    ETH_QUICKNODE_SECRET,
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("operator is read-only by default and protected receipts are exclusive 0600 files", async () => {
  const parsed = parseMainTokenMigrationTargetOperatorArguments([], {
    ROBINHOOD_MIGRATION_DEPLOYMENT_OWNER: OWNER,
    MAIN_TOKEN_MIGRATION_SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE: DEADLINE,
    MAIN_TOKEN_MIGRATION_SEAL_AUTHORITY: OWNER,
    MAIN_TOKEN_MIGRATION_REMAINDER_RECIPIENT: REMAINDER,
    ROBINHOOD_MIGRATION_MAXIMUM_FEE_PER_GAS_WEI: "1000",
    ROBINHOOD_MIGRATION_MAXIMUM_PRIORITY_FEE_PER_GAS_WEI: "100",
    ROBINHOOD_MIGRATION_MAXIMUM_GAS_COST_WEI: "100000000000000000",
  });
  assert.equal(parsed.write, false);
  assert.throws(
    () =>
      parseMainTokenMigrationTargetOperatorArguments(["--write"], {
        ROBINHOOD_MIGRATION_DEPLOYMENT_OWNER: OWNER,
        MAIN_TOKEN_MIGRATION_SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE: DEADLINE,
        MAIN_TOKEN_MIGRATION_SEAL_AUTHORITY: OWNER,
        MAIN_TOKEN_MIGRATION_REMAINDER_RECIPIENT: REMAINDER,
        ROBINHOOD_MIGRATION_MAXIMUM_FEE_PER_GAS_WEI: "1000",
        ROBINHOOD_MIGRATION_MAXIMUM_PRIORITY_FEE_PER_GAS_WEI: "100",
        ROBINHOOD_MIGRATION_MAXIMUM_GAS_COST_WEI: "100000000000000000",
      }),
    /--write requires/u,
  );
  const directory = await mkdtemp(join(tmpdir(), "programmable-target-receipt-"));
  await chmod(directory, 0o700);
  const receiptPath = join(directory, "receipt.json");
  await writeProtectedTargetDeploymentReceipt({
    repositoryRoot: ROOT,
    receiptPath,
    receipt: { schema: "test", verified: true },
  });
  const metadata = await stat(receiptPath);
  assert.equal(metadata.mode & 0o777, 0o600);
  assert.equal(
    await readFile(receiptPath, "utf8"),
    '{"schema":"test","verified":true}\n',
  );
  await assert.rejects(
    () =>
      writeProtectedTargetDeploymentReceipt({
        repositoryRoot: ROOT,
        receiptPath,
        receipt: { schema: "test", verified: true },
      }),
    /already exists/u,
  );
});

test("operator direct entry prints help without requiring deployment settings", () => {
  const result = spawnSync(
    process.execPath,
    [join(ROOT, "scripts/serve-main-token-migration-target-deployment.mjs"), "--help"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/u);
  assert.equal(result.stderr, "");
});

test("authorized envelope and submitted hash survive restart in protected recovery files", async () => {
  const { plan } = await fixture();
  const prepared = await envelope(plan);
  const directory = await mkdtemp(join(tmpdir(), "programmable-target-recovery-"));
  await chmod(directory, 0o700);
  const receiptPath = join(directory, "receipt.json");
  await writeProtectedTargetAuthorizationCheckpoint({
    repositoryRoot: ROOT,
    receiptPath,
    plan,
    envelope: prepared,
  });
  assert.deepEqual(
    await loadProtectedTargetDeploymentRecovery({
      repositoryRoot: ROOT,
      receiptPath,
      plan,
    }),
    { envelope: prepared, transactionHash: null },
  );
  await writeProtectedTargetSubmissionCheckpoint({
    repositoryRoot: ROOT,
    receiptPath,
    plan,
    envelope: prepared,
    transactionHash: TX_HASH,
  });
  const recovered = await loadProtectedTargetDeploymentRecovery({
    repositoryRoot: ROOT,
    receiptPath,
    plan,
  });
  assert.equal(recovered.envelope.envelopeDigest, prepared.envelopeDigest);
  assert.equal(recovered.transactionHash, TX_HASH);
  for (const suffix of [".authorized.json", ".submitted.json"]) {
    const path = `${receiptPath}${suffix}`;
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const bytes = await readFile(path, "utf8");
    assert.equal(bytes.includes(QUICKNODE_SECRET), false);
    assert.equal(bytes.includes(ALCHEMY_SECRET), false);
  }
  await assert.rejects(
    () =>
      writeProtectedTargetSubmissionCheckpoint({
        repositoryRoot: ROOT,
        receiptPath,
        plan,
        envelope: prepared,
        transactionHash: `0x${"ab".repeat(32)}`,
      }),
    /different attempt/u,
  );
});

test("browser source has one wallet broadcast boundary and no signing primitive", async () => {
  const source = await readFile(
    join(ROOT, "scripts/serve-main-token-migration-target-deployment.mjs"),
    "utf8",
  );
  assert.equal((source.match(/eth_sendTransaction/gu) ?? []).length, 1);
  assert.equal(/privateKey|eth_signTransaction|wallet_sendCalls/iu.test(source), false);
  assert.match(source, /if \(!options\.write\).*server is read-only/u);
  assert.match(source, /revalidateMainTokenMigrationTargetWalletRequest/u);
  assert.match(source, /writeProtectedTargetAuthorizationCheckpoint/u);
  assert.match(source, /writeProtectedTargetSubmissionCheckpoint/u);
});

test("frozen release and snapshot hashes match their exact bytes", () => {
  assert.equal(
    keccak256(stringToHex(MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.releaseId)),
    "0xe22e729786da05c9b8b2b4c94df049badbdbd427563177c87abe4e1036edde6e",
  );
  assert.equal(
    keccak256(
      stringToHex(MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.snapshotRule),
    ),
    "0x6720fe7cfe3d287cc5f21d264bb4a4125f1ab7f37189407d213c89489ed2d5f0",
  );
});
