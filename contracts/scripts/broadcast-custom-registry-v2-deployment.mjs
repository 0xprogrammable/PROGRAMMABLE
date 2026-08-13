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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import {
  assessDeploymentCost,
  assertArtifactBinding,
  assertDeployerBinding,
  assertLiveBinding,
  assertPreflightEnvelope,
  assertReviewedAuthorization,
  assertSourceBinding,
  computeConstructorCommitment,
  requireDistinctRpcOrigins,
  verifyReviewedAuthorizationSignature,
} from "./custom-registry-v2-deployment-guards.mjs";

if (!process.argv.includes("--broadcast")) throw new Error("explicit --broadcast is required");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const planPath = path.resolve(process.env.REGISTRY_REVIEWED_PLAN_PATH ?? "");
if (!planPath.startsWith("/tmp/")) throw new Error("reviewed plan must be under /tmp");
const planBytes = await readFile(planPath);
const expectedDigest = process.env.REGISTRY_REVIEWED_PLAN_SHA256;
const actualDigest = `0x${createHash("sha256").update(planBytes).digest("hex")}`;
if (actualDigest !== expectedDigest) throw new Error("reviewed plan digest mismatch");
const plan = JSON.parse(planBytes);
const nowTimestamp = Math.floor(Date.now() / 1000);
assertPreflightEnvelope(plan, nowTimestamp);
const authorizationPath = path.resolve(process.env.REGISTRY_BROADCAST_AUTHORIZATION_PATH ?? "");
if (!authorizationPath.startsWith("/tmp/")) throw new Error("broadcast authorization must be under /tmp");
const authorizationBytes = await readFile(authorizationPath);
const authorizationSha256 = `0x${createHash("sha256").update(authorizationBytes).digest("hex")}`;
if (authorizationSha256 !== process.env.REGISTRY_BROADCAST_AUTHORIZATION_SHA256) {
  throw new Error("broadcast authorization digest mismatch");
}
const authorization = JSON.parse(authorizationBytes);
assertReviewedAuthorization({ authorization, preflightSha256: actualDigest, plan, nowTimestamp });
await verifyReviewedAuthorizationSignature(authorization);
if (computeConstructorCommitment(plan.constructor) !== plan.constructorCommitment) {
  throw new Error("constructor commitment mismatch");
}

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
assertSourceBinding({
  commit,
  tree,
  clean: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }) === "",
  plan,
});
const artifact = JSON.parse(await readFile(
  path.join(root, "contracts/out/ProgrammableCustomRegistryV2.sol/ProgrammableCustomRegistryV2.json"),
));
const manifestBytes = await readFile(path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"));
const manifest = JSON.parse(manifestBytes);
const committedAbiBytes = await readFile(path.join(root, "docs/security/abi/ProgrammableCustomRegistryV2.json"));
const committedAbiDocument = JSON.parse(committedAbiBytes);
assertArtifactBinding({
  artifactBytecode: artifact.bytecode.object,
  manifestBytes,
  committedAbiBytes,
  manifest,
  plan,
});
if (committedAbiDocument.schemaVersion !== "programmable.custom-registry-abi.v2") {
  throw new Error("committed deployment ABI schema is invalid");
}

const rpcA = process.env.REGISTRY_PREFLIGHT_RPC_URL_A;
const rpcB = process.env.REGISTRY_PREFLIGHT_RPC_URL_B;
if (!rpcA || !rpcB) throw new Error("two RPC endpoints are required");
requireDistinctRpcOrigins(rpcA, rpcB);
const privateKey = process.env.REGISTRY_DEPLOYER_PRIVATE_KEY;
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("deployer key is missing");
const account = privateKeyToAccount(privateKey);
assertDeployerBinding(account.address, plan.create.deployer);
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
assertLiveBinding({ first: a, second: b, plan });
if ((a.code !== undefined && a.code !== "0x") || (b.code !== undefined && b.code !== "0x")) {
  throw new Error("predicted address is occupied on an independent RPC");
}
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
  abi: committedAbiDocument.abi,
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
const address = receipt.contractAddress;
const read = (functionName, args = undefined) => clients[0].readContract({
  address,
  abi: committedAbiDocument.abi,
  functionName,
  ...(args ? { args } : {}),
});
const roleNames = ["APPROVER_ROLE", "REGISTRAR_ROLE", "FINALIZER_ROLE", "REVOKER_ROLE"];
const roleValues = await Promise.all(roleNames.map((name) => read(name)));
const [runtimeA, runtimeB, chainId, adminDelay, admin, minimumFinalityBlocks, policy, ...controllers] = await Promise.all([
  clients[0].getCode({ address, blockTag: "latest" }),
  clients[1].getCode({ address, blockTag: "latest" }),
  read("CHAIN_ID"),
  read("defaultAdminDelay"),
  read("defaultAdmin"),
  read("MINIMUM_FINALITY_BLOCKS"),
  read("REGISTRY_POLICY_COMMITMENT"),
  ...roleValues.map((role) => read("operationalController", [role])),
]);
const expectedControllers = [
  plan.constructor.initialApprover,
  plan.constructor.initialRegistrar,
  plan.constructor.initialFinalizer,
  plan.constructor.initialRevoker,
].map(getAddress);
if (
  !runtimeA || runtimeA === "0x" || runtimeA !== runtimeB
  || chainId !== 1n
  || adminDelay !== BigInt(plan.constructor.initialAdminDelay)
  || getAddress(admin) !== getAddress(plan.constructor.initialAdmin)
  || minimumFinalityBlocks !== BigInt(plan.constructor.minimumFinalityBlocks)
  || policy !== plan.constructor.registryPolicyCommitment
  || controllers.some((controller, index) => getAddress(controller) !== expectedControllers[index])
) throw new Error("post-deployment immutable or controller verification failed");
const roleAssignments = await Promise.all(roleValues.map((role, index) => read("hasRole", [role, expectedControllers[index]])));
if (roleAssignments.some((assigned) => assigned !== true)) {
  throw new Error("post-deployment operational role verification failed");
}
process.stdout.write(`${JSON.stringify({ transactionHash, contractAddress: receipt.contractAddress })}\n`);
