import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  getAddress,
  getContractAddress,
  http,
  keccak256,
} from "viem";
import { mainnet } from "viem/chains";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1]) throw new Error("--output is required");
const output = path.resolve(process.argv[outputIndex + 1]);
if (!output.startsWith("/tmp/")) throw new Error("preflight output must be under /tmp");

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const positiveInteger = (name, maximum) => {
  const value = BigInt(required(name));
  if (value <= 0n || value > maximum) throw new Error(`${name} is out of range`);
  return value;
};
const bytes32 = (name) => {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value)) throw new Error(`${name} is invalid`);
  return value;
};
const rpcA = required("REGISTRY_PREFLIGHT_RPC_URL_A");
const rpcB = required("REGISTRY_PREFLIGHT_RPC_URL_B");
if (rpcA === rpcB) throw new Error("preflight RPC endpoints must be distinct");

const artifactBytes = await readFile(
  path.join(root, "contracts/out/ProgrammableCustomRegistryV2.sol/ProgrammableCustomRegistryV2.json"),
);
const artifact = JSON.parse(artifactBytes);
const manifestBytes = await readFile(path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"));
const manifest = JSON.parse(manifestBytes);
if (manifest.status !== "SOURCE_ONLY_NOT_DEPLOYED" || manifest.activationAllowed !== false) {
  throw new Error("source manifest is not fail-closed");
}

const deployer = getAddress(required("REGISTRY_DEPLOYER"));
const config = {
  initialAdminDelay: positiveInteger("REGISTRY_ADMIN_DELAY_SECONDS", (1n << 48n) - 1n),
  initialAdmin: getAddress(required("REGISTRY_ADMIN")),
  initialApprover: getAddress(required("REGISTRY_APPROVER")),
  initialRegistrar: getAddress(required("REGISTRY_REGISTRAR")),
  initialFinalizer: getAddress(required("REGISTRY_FINALIZER")),
  initialRevoker: getAddress(required("REGISTRY_REVOKER")),
  minimumFinalityBlocks: positiveInteger("REGISTRY_MINIMUM_FINALITY_BLOCKS", 255n),
  registryPolicyCommitment: bytes32("REGISTRY_POLICY_COMMITMENT"),
};
if (new Set(Object.values(config).filter((value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value))).size !== 5) {
  throw new Error("admin and operational roles must be five distinct accounts");
}

const clients = [rpcA, rpcB].map((url) => createPublicClient({ chain: mainnet, transport: http(url) }));
const observations = await Promise.all(clients.map(async (client) => {
  const [chainId, finalized, nonce] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockTag: "finalized" }),
    client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  ]);
  if (chainId !== 1) throw new Error("preflight endpoint is not Ethereum mainnet");
  const predictedAddress = getContractAddress({ from: deployer, nonce: BigInt(nonce) });
  const [predictedCode, estimatedGas] = await Promise.all([
    client.getCode({ address: predictedAddress, blockTag: "latest" }),
    client.estimateContractGas({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [config],
      account: deployer,
    }),
  ]);
  if (predictedCode !== undefined && predictedCode !== "0x") throw new Error("predicted deployment address has code");
  return {
    chainId,
    finalizedBlockNumber: finalized.number,
    finalizedBlockHash: finalized.hash,
    pendingNonce: nonce,
    predictedAddress,
    estimatedGas,
  };
}));

const [a, b] = observations;
if (
  a.finalizedBlockNumber !== b.finalizedBlockNumber ||
  a.finalizedBlockHash !== b.finalizedBlockHash ||
  a.pendingNonce !== b.pendingNonce ||
  a.predictedAddress !== b.predictedAddress
) {
  throw new Error("independent preflight observations disagree");
}
const gasLimit = observations.reduce((maximum, observation) => observation.estimatedGas > maximum ? observation.estimatedGas : maximum, 0n) * 120n / 100n;
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
if (status !== "") throw new Error("deployment preflight requires a clean worktree");

const plan = {
  schemaVersion: "programmable.custom-registry-deployment-preflight.v2",
  status: "PREFLIGHT_ONLY_NO_TRANSACTION",
  source: {
    commit: sourceCommit,
    tree: sourceTree,
    sourceManifestSha256: `0x${createHash("sha256").update(manifestBytes).digest("hex")}`,
    creationBytecodeKeccak256: keccak256(artifact.bytecode.object),
  },
  chainId: "1",
  commonFinalizedAnchor: {
    blockNumber: a.finalizedBlockNumber.toString(),
    blockHash: a.finalizedBlockHash,
  },
  create: {
    kind: "CREATE",
    deployer,
    exactPendingNonce: a.pendingNonce.toString(),
    predictedAddress: a.predictedAddress,
    gasEstimates: observations.map((observation) => observation.estimatedGas.toString()),
    gasLimit: gasLimit.toString(),
  },
  constructor: config,
  broadcastAllowed: false,
  signingAllowed: false,
};

await writeFile(output, `${JSON.stringify(plan, (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(`CUSTOM_REGISTRY_V2_DEPLOYMENT_PREFLIGHT ${output}\n`);
