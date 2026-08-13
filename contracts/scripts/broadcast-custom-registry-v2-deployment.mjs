import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  getContractAddress,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { assessDeploymentCost, requireDistinctRpcOrigins } from "./custom-registry-v2-deployment-guards.mjs";

if (!process.argv.includes("--broadcast")) throw new Error("explicit --broadcast is required");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const planPath = path.resolve(process.env.REGISTRY_REVIEWED_PLAN_PATH ?? "");
if (!planPath.startsWith("/tmp/")) throw new Error("reviewed plan must be under /tmp");
const planBytes = await readFile(planPath);
const expectedDigest = process.env.REGISTRY_REVIEWED_PLAN_SHA256;
const actualDigest = `0x${createHash("sha256").update(planBytes).digest("hex")}`;
if (actualDigest !== expectedDigest) throw new Error("reviewed plan digest mismatch");
const plan = JSON.parse(planBytes);
if (
  plan.schemaVersion !== "programmable.custom-registry-deployment-preflight.v2"
  || plan.status !== "PREFLIGHT_ONLY_NO_TRANSACTION"
  || plan.broadcastAllowed !== false
  || plan.signingAllowed !== false
  || !Number.isSafeInteger(plan.expiresAtTimestamp)
  || plan.expiresAtTimestamp < Math.floor(Date.now() / 1000)
) throw new Error("reviewed plan is stale or invalid");

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
if (commit !== plan.source.commit || tree !== plan.source.tree) throw new Error("source identity drifted from plan");
if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }) !== "") {
  throw new Error("broadcast requires a clean worktree");
}
const artifact = JSON.parse(await readFile(
  path.join(root, "contracts/out/ProgrammableCustomRegistryV2.sol/ProgrammableCustomRegistryV2.json"),
));
if (keccak256(artifact.bytecode.object) !== plan.source.creationBytecodeKeccak256) {
  throw new Error("creation bytecode drifted from plan");
}

const rpcA = process.env.REGISTRY_PREFLIGHT_RPC_URL_A;
const rpcB = process.env.REGISTRY_PREFLIGHT_RPC_URL_B;
if (!rpcA || !rpcB) throw new Error("two RPC endpoints are required");
requireDistinctRpcOrigins(rpcA, rpcB);
const privateKey = process.env.REGISTRY_DEPLOYER_PRIVATE_KEY;
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("deployer key is missing");
const account = privateKeyToAccount(privateKey);
if (getAddress(account.address) !== getAddress(plan.create.deployer)) throw new Error("deployer key mismatch");
const clients = [rpcA, rpcB].map((url) => createPublicClient({ chain: mainnet, transport: http(url) }));
const live = await Promise.all(clients.map(async (client) => {
  const [finalized, latest, nonce, balance, priorityFee, code] = await Promise.all([
    client.getBlock({ blockTag: "finalized" }),
    client.getBlock({ blockTag: "latest" }),
    client.getTransactionCount({ address: account.address, blockTag: "pending" }),
    client.getBalance({ address: account.address, blockTag: "latest" }),
    client.estimateMaxPriorityFeePerGas(),
    client.getCode({ address: plan.create.predictedAddress, blockTag: "latest" }),
  ]);
  return { finalized, latest, nonce, balance, priorityFee, code };
}));
const [a, b] = live;
if (
  a.finalized.number.toString() !== plan.commonFinalizedAnchor.blockNumber
  || a.finalized.hash !== plan.commonFinalizedAnchor.blockHash
  || b.finalized.number !== a.finalized.number || b.finalized.hash !== a.finalized.hash
  || a.nonce !== b.nonce || a.nonce !== plan.create.exactPendingNonce
  || a.balance !== b.balance || a.latest.gasLimit !== b.latest.gasLimit
  || a.latest.baseFeePerGas !== b.latest.baseFeePerGas || a.priorityFee !== b.priorityFee
) throw new Error("live broadcast state drifted from reviewed plan");
if (a.code !== undefined && a.code !== "0x") throw new Error("predicted address is occupied");
if (getContractAddress({ from: account.address, nonce: BigInt(a.nonce) }) !== plan.create.predictedAddress) {
  throw new Error("predicted CREATE address mismatch");
}
const observedFeePerGas = (a.latest.baseFeePerGas ?? 0n) * 2n + a.priorityFee;
const gas = BigInt(plan.create.gasLimit);
const maxFeePerGas = BigInt(plan.create.reviewedMaxFeePerGas);
assessDeploymentCost({
  gasLimit: gas,
  blockGasLimit: a.latest.gasLimit,
  observedFeePerGas,
  maxFeePerGas,
  maxTotalCostWei: BigInt(plan.create.reviewedMaxTotalCostWei),
  deployerBalance: a.balance,
});
const wallet = createWalletClient({ account, chain: mainnet, transport: http(rpcA) });
const transactionHash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [plan.constructor],
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas: a.priorityFee,
});
const receipt = await clients[0].waitForTransactionReceipt({ hash: transactionHash, confirmations: 1 });
if (receipt.status !== "success" || receipt.contractAddress !== plan.create.predictedAddress) {
  throw new Error("deployment receipt does not match reviewed plan");
}
process.stdout.write(`${JSON.stringify({ transactionHash, contractAddress: receipt.contractAddress })}\n`);
