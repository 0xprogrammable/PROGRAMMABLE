import { createHash } from "node:crypto";

import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  recoverAddress,
  stringToHex,
} from "viem";
import { privateKeyToAccount, sign, signatureToHex } from "viem/accounts";

const hash = (label) => keccak256(stringToHex(label));
const privateKey = `0x${"00".repeat(31)}a1`;
const verifyingContract = getAddress("0x1000000000000000000000000000000000000001");
const route = getAddress("0x2000000000000000000000000000000000000002");
const registry = getAddress("0x3000000000000000000000000000000000000003");
const applicantWallet = getAddress("0x4000000000000000000000000000000000000004");

const permitComponents = [
  { name: "githubRepositoryId", type: "uint64" },
  { name: "approvalGeneration", type: "uint64" },
  { name: "permitGeneration", type: "uint64" },
  { name: "notBefore", type: "uint64" },
  { name: "deadline", type: "uint64" },
  { name: "signerEpoch", type: "uint64" },
  { name: "nonce", type: "uint256" },
  { name: "chainId", type: "uint256" },
  { name: "repositoryKey", type: "bytes32" },
  { name: "route", type: "address" },
  { name: "routeId", type: "bytes32" },
  { name: "applicantWallet", type: "address" },
  { name: "launchId", type: "bytes32" },
  { name: "approvalId", type: "bytes32" },
  { name: "technicalApprovalHash", type: "bytes32" },
  { name: "descriptorHash", type: "bytes32" },
  { name: "presentationBindingHash", type: "bytes32" },
  { name: "configurationHash", type: "bytes32" },
  { name: "walletOwnershipBindingHash", type: "bytes32" },
  { name: "executionPlanHash", type: "bytes32" },
  { name: "executionCoreHash", type: "bytes32" },
  { name: "executionCalldataKeccak256", type: "bytes32" },
  { name: "generationBindingHash", type: "bytes32" },
  { name: "executionValue", type: "uint256" },
  { name: "releaseBindingHash", type: "bytes32" },
  { name: "kernelExecutionEnvelopeHash", type: "bytes32" },
];
const generationComponents = permitComponents.filter(({ name }) => name !== "generationBindingHash");
const releaseComponents = [
  { name: "authorityGeneration", type: "uint64" },
  { name: "releaseGeneration", type: "uint64" },
  { name: "permitAuthority", type: "address" },
  { name: "permitAuthorityRuntimeCodeHash", type: "bytes32" },
  { name: "launchRegistry", type: "address" },
  { name: "launchRegistryGeneration", type: "uint64" },
  { name: "launchRegistryRuntimeCodeHash", type: "bytes32" },
  { name: "chainProfileHash", type: "bytes32" },
  { name: "profile", type: "address" },
  { name: "profileId", type: "bytes32" },
  { name: "profileRuntimeCodeHash", type: "bytes32" },
  { name: "profileBindingHash", type: "bytes32" },
  { name: "route", type: "address" },
  { name: "routeId", type: "bytes32" },
  { name: "routeRuntimeCodeHash", type: "bytes32" },
  { name: "executionAuthorityHash", type: "bytes32" },
  { name: "kernelEnvelopeMode", type: "uint8" },
];
const kernelComponents = [
  { name: "kernelGrantDigest", type: "bytes32" },
  { name: "reviewerCurrentnessDigest", type: "bytes32" },
  { name: "applicantWalletIntentDigest", type: "bytes32" },
];

const typeStrings = {
  domain: "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
  permit: "LaunchPermitV1(uint64 githubRepositoryId,uint64 approvalGeneration,uint64 permitGeneration,uint64 notBefore,uint64 deadline,uint64 signerEpoch,uint256 nonce,uint256 chainId,bytes32 repositoryKey,address route,bytes32 routeId,address applicantWallet,bytes32 launchId,bytes32 approvalId,bytes32 technicalApprovalHash,bytes32 descriptorHash,bytes32 presentationBindingHash,bytes32 configurationHash,bytes32 walletOwnershipBindingHash,bytes32 executionPlanHash,bytes32 executionCoreHash,bytes32 executionCalldataKeccak256,bytes32 generationBindingHash,uint256 executionValue,bytes32 releaseBindingHash,bytes32 kernelExecutionEnvelopeHash)",
  generation: "GenerationBindingV1(uint64 githubRepositoryId,uint64 approvalGeneration,uint64 permitGeneration,uint64 notBefore,uint64 deadline,uint64 signerEpoch,uint256 nonce,uint256 chainId,bytes32 repositoryKey,address route,bytes32 routeId,address applicantWallet,bytes32 launchId,bytes32 approvalId,bytes32 technicalApprovalHash,bytes32 descriptorHash,bytes32 presentationBindingHash,bytes32 configurationHash,bytes32 walletOwnershipBindingHash,bytes32 executionPlanHash,bytes32 executionCoreHash,bytes32 executionCalldataKeccak256,uint256 executionValue,bytes32 releaseBindingHash,bytes32 kernelExecutionEnvelopeHash)",
  release: "ReleaseBindingV1(uint64 authorityGeneration,uint64 releaseGeneration,address permitAuthority,bytes32 permitAuthorityRuntimeCodeHash,address launchRegistry,uint64 launchRegistryGeneration,bytes32 launchRegistryRuntimeCodeHash,bytes32 chainProfileHash,address profile,bytes32 profileId,bytes32 profileRuntimeCodeHash,bytes32 profileBindingHash,address route,bytes32 routeId,bytes32 routeRuntimeCodeHash,bytes32 executionAuthorityHash,uint8 kernelEnvelopeMode)",
  kernel: "KernelExecutionEnvelopeV1(bytes32 kernelGrantDigest,bytes32 reviewerCurrentnessDigest,bytes32 applicantWalletIntentDigest)",
};
const typehashes = Object.fromEntries(Object.entries(typeStrings).map(([key, value]) => [key, hash(value)]));

const repositoryId = 1_329_073_878n;
const repositoryKey = keccak256(
  encodeAbiParameters([{ type: "string" }, { type: "uint256" }], ["programmable.github.repository.v1", repositoryId]),
);
const kernelEnvelope = {
  kernelGrantDigest: `0x${"00".repeat(32)}`,
  reviewerCurrentnessDigest: `0x${"00".repeat(32)}`,
  applicantWalletIntentDigest: `0x${"00".repeat(32)}`,
};
const releaseBinding = {
  authorityGeneration: 1n,
  releaseGeneration: 7n,
  permitAuthority: verifyingContract,
  permitAuthorityRuntimeCodeHash: hash("authority-runtime"),
  launchRegistry: registry,
  launchRegistryGeneration: 3n,
  launchRegistryRuntimeCodeHash: hash("registry-runtime"),
  chainProfileHash: hash("ethereum-mainnet-chain-profile"),
  profile: route,
  profileId: hash("shards-profile"),
  profileRuntimeCodeHash: hash("route-runtime"),
  profileBindingHash: hash("shards-profile-binding"),
  route,
  routeId: hash("programmable.exact-shards.atomic-launch-route.v1"),
  routeRuntimeCodeHash: hash("route-runtime"),
  executionAuthorityHash: hash("shards-execution-authority"),
  kernelEnvelopeMode: 0,
};
const kernelExecutionEnvelopeHash = keccak256(
  encodeAbiParameters([{ type: "bytes32" }, { type: "tuple", components: kernelComponents }], [typehashes.kernel, kernelEnvelope]),
);
const releaseBindingHash = keccak256(
  encodeAbiParameters([{ type: "bytes32" }, { type: "tuple", components: releaseComponents }], [typehashes.release, releaseBinding]),
);
const permit = {
  githubRepositoryId: repositoryId,
  approvalGeneration: 4n,
  permitGeneration: 9n,
  notBefore: 1_800_000_000n,
  deadline: 1_800_000_300n,
  signerEpoch: 2n,
  nonce: 0n,
  chainId: 1n,
  repositoryKey,
  route,
  routeId: releaseBinding.routeId,
  applicantWallet,
  launchId: hash("launch-id"),
  approvalId: hash("approval-id"),
  technicalApprovalHash: hash("technical-approval"),
  descriptorHash: hash("descriptor"),
  presentationBindingHash: hash("presentation"),
  configurationHash: hash("configuration"),
  walletOwnershipBindingHash: hash("wallet-ownership"),
  executionPlanHash: hash("execution-plan"),
  executionCoreHash: hash("execution-core"),
  executionCalldataKeccak256: hash("selector-included-inner-calldata"),
  generationBindingHash: `0x${"00".repeat(32)}`,
  executionValue: 0n,
  releaseBindingHash,
  kernelExecutionEnvelopeHash,
};
const generationPreimage = Object.fromEntries(generationComponents.map(({ name }) => [name, permit[name]]));
permit.generationBindingHash = `0x${createHash("sha256").update(Buffer.from(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "tuple", components: generationComponents }],
  [typehashes.generation, generationPreimage],
).slice(2), "hex")).digest("hex")}`;

const domainSeparator = keccak256(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
  [typehashes.domain, hash("ProgrammableLaunchPermitAuthority"), hash("1"), 1n, verifyingContract],
));
const permitStructHash = keccak256(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "tuple", components: permitComponents }],
  [typehashes.permit, permit],
));
const permitDigest = keccak256(`0x1901${domainSeparator.slice(2)}${permitStructHash.slice(2)}`);
const signature = signatureToHex(await sign({ hash: permitDigest, privateKey }));
const signer = privateKeyToAccount(privateKey).address;
if (await recoverAddress({ hash: permitDigest, signature }) !== signer) throw new Error("signature recovery mismatch");

const stringify = (_, value) => typeof value === "bigint" ? value.toString() : value;
process.stdout.write(`${JSON.stringify({
  schemaVersion: "programmable.launch-permit-v1-golden.v1",
  hashNamespaces: {
    generationBindingHash: "raw-sha256-of-abi-encoded-generation-preimage",
    releaseKernelAndPermit: "raw-keccak256",
  },
  typeStrings,
  typehashes,
  verifyingContract,
  signer,
  domainSeparator,
  repositoryKey,
  kernelEnvelope,
  kernelExecutionEnvelopeHash,
  releaseBinding,
  releaseBindingHash,
  permit,
  permitStructHash,
  permitDigest,
  lowSSignature: signature,
}, stringify, 2)}\n`);
