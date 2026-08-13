import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  encodeDeployData,
  getAddress,
  getContractAddress,
  keccak256,
} from "viem";

import {
  assertArtifactBinding,
  assertExpectedDeploymentTransaction,
  assertPreflightEnvelope,
  assertSourceBinding,
  assessDeploymentCost,
  computeConstructorCommitment,
  sha256,
} from "./custom-registry-v2-deployment-guards.mjs";
import {
  assertCustomRegistryV2ProductionConstructor,
  loadCustomRegistryV2ProductionPolicy,
} from "./custom-registry-v2-production-policy.mjs";
import {
  SAFE_VERIFICATION_SCHEMA,
  assertDistinctControllerOwners,
} from "./custom-registry-v2-safe-controller-guards.mjs";

const ARTIFACT =
  "contracts/out/ProgrammableCustomRegistryV2.sol/ProgrammableCustomRegistryV2.json";
const MANIFEST = "contracts/spec/custom-registry-v2-predeployment.json";
const ABI = "docs/security/abi/ProgrammableCustomRegistryV2.json";
const SAFE_POLICY = "config/custom-registry-v2-safe-controller-policy.json";

export async function loadRegistryDeploymentInputs({
  root,
  safeVerificationBytes,
}) {
  const [
    artifactBytes,
    manifestBytes,
    committedAbiBytes,
    safePolicyBytes,
  ] = await Promise.all([
    readFile(path.join(root, ARTIFACT)),
    readFile(path.join(root, MANIFEST)),
    readFile(path.join(root, ABI)),
    readFile(path.join(root, SAFE_POLICY)),
  ]);
  const artifact = JSON.parse(artifactBytes);
  const manifest = JSON.parse(manifestBytes);
  const committedAbiDocument = JSON.parse(committedAbiBytes);
  const safeVerification = JSON.parse(safeVerificationBytes);
  const productionPolicy = await loadCustomRegistryV2ProductionPolicy(root);
  const productionPolicyBytes = await readFile(productionPolicy.documentPath);
  return {
    artifact,
    manifest,
    manifestBytes,
    committedAbiBytes,
    committedAbiDocument,
    safePolicyBytes,
    safeVerification,
    safeVerificationBytes,
    productionPolicy,
    productionPolicyBytes,
  };
}

export function currentSourceIdentity(root) {
  const run = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  return {
    commit: run(["rev-parse", "HEAD"]),
    tree: run(["rev-parse", "HEAD^{tree}"]),
    clean:
      execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }) === "",
  };
}

export async function assertRegistryDeploymentPlan({
  root,
  plan,
  safeVerificationBytes,
  nowTimestamp,
  allowExpired = false,
  requireClean = true,
}) {
  assertPreflightEnvelope(plan, nowTimestamp, { allowExpired });
  const inputs = await loadRegistryDeploymentInputs({
    root,
    safeVerificationBytes,
  });
  const {
    artifact,
    manifest,
    manifestBytes,
    committedAbiBytes,
    committedAbiDocument,
    safePolicyBytes,
    safeVerification,
    productionPolicy,
    productionPolicyBytes,
  } = inputs;

  if (
    !/^[0-9a-f]{40}$/u.test(plan.source?.commit ?? "") ||
    !/^[0-9a-f]{40}$/u.test(plan.source?.tree ?? "") ||
    !/^[1-9][0-9]*$/u.test(plan.commonFinalizedAnchor?.blockNumber ?? "") ||
    !/^0x[0-9a-f]{64}$/u.test(plan.commonFinalizedAnchor?.blockHash ?? "") ||
    plan.rpcProviders?.length !== 2 ||
    plan.rpcProviders[0].toLowerCase() === plan.rpcProviders[1].toLowerCase() ||
    manifest.status !== "SOURCE_ONLY_NOT_DEPLOYED" ||
    manifest.activationAllowed !== false ||
    committedAbiDocument.schemaVersion !==
      "programmable.custom-registry-abi.v2" ||
    manifest.artifact?.creationBytecodeKeccak256 !==
      keccak256(artifact.bytecode.object) ||
    manifest.artifact?.runtimeTemplateKeccak256 !==
      keccak256(artifact.deployedBytecode.object) ||
    manifest.artifact?.abiSha256 !== sha256(committedAbiBytes)
  ) {
    throw new Error("Registry source manifest or committed ABI is invalid");
  }
  for (const [relative, digest] of Object.entries(
    manifest.sourceDigests ?? {},
  )) {
    const actual = sha256(await readFile(path.join(root, relative)));
    if (actual !== digest) {
      throw new Error(`${relative} does not match the source manifest`);
    }
  }

  const source = currentSourceIdentity(root);
  assertSourceBinding({
    ...source,
    clean: requireClean ? source.clean : true,
    plan,
  });

  const safePolicySha256 = sha256(safePolicyBytes);
  if (
    safeVerification.schemaVersion !== SAFE_VERIFICATION_SCHEMA ||
    safeVerification.status !== "VERIFIED_FINALIZED_SAFE_CONTROLLERS" ||
    safeVerification.chainId !== 1 ||
    safeVerification.verified !== true ||
    safeVerification.source?.commit !== source.commit ||
    safeVerification.source?.tree !== source.tree ||
    safeVerification.policySha256 !== safePolicySha256 ||
    safeVerification.controllers?.length !== 4 ||
    safeVerification.controllers.some(
      ({
        runtimeCodeKeccak256,
        masterCopy,
        threshold,
        modules,
        fallbackHandler,
        guard,
      }) =>
        runtimeCodeKeccak256 !==
          safeVerification.proxyFactory?.proxyRuntimeCodeKeccak256 ||
        getAddress(masterCopy) !==
          getAddress(safeVerification.singleton?.address) ||
        threshold !== "1" ||
        modules?.length !== 0 ||
        fallbackHandler !== "0x0000000000000000000000000000000000000000" ||
        guard !== "0x0000000000000000000000000000000000000000",
    )
  ) {
    throw new Error("Safe controller verification is invalid or source-drifted");
  }

  const roles = ["approver", "registrar", "finalizer", "revoker"];
  const controllers = roles.map((role) => {
    const controller = safeVerification.controllers.find(
      (candidate) => candidate.role === role,
    );
    if (!controller) throw new Error(`verified ${role} Safe is missing`);
    return getAddress(controller.address);
  });
  const expectedConfig = {
    initialAdminDelay: String(
      productionPolicy.constructorPolicy.initialAdminDelaySeconds,
    ),
    initialAdmin: getAddress(safeVerification.admin),
    initialApprover: controllers[0],
    initialRegistrar: controllers[1],
    initialFinalizer: controllers[2],
    initialRevoker: controllers[3],
    minimumFinalityBlocks: String(
      productionPolicy.constructorPolicy.minimumFinalityBlocks,
    ),
    registryPolicyCommitment: productionPolicy.registryPolicyCommitment,
  };
  for (const [field, value] of Object.entries(expectedConfig)) {
    const actual = plan.constructor?.[field];
    if (
      (field.startsWith("initial") && field !== "initialAdminDelay"
        ? getAddress(actual) !== value
        : String(actual) !== value)
    ) {
      throw new Error(`reviewed constructor ${field} is invalid`);
    }
  }
  assertCustomRegistryV2ProductionConstructor(
    {
      ...plan.constructor,
      initialAdminDelay: BigInt(plan.constructor.initialAdminDelay),
      minimumFinalityBlocks: BigInt(
        plan.constructor.minimumFinalityBlocks,
      ),
    },
    productionPolicy,
  );
  if (
    computeConstructorCommitment(plan.constructor) !==
    plan.constructorCommitment
  ) {
    throw new Error("constructor commitment mismatch");
  }

  const deploymentData = encodeDeployData({
    abi: committedAbiDocument.abi,
    bytecode: artifact.bytecode.object,
    args: [plan.constructor],
  });
  assertArtifactBinding({
    artifactBytecode: artifact.bytecode.object,
    deploymentData,
    manifestBytes,
    committedAbiBytes,
    productionPolicyBytes,
    safeVerificationBytes,
    manifest,
    plan,
  });
  assertExpectedDeploymentTransaction({ plan, deploymentData });

  const predictedAddress = getContractAddress({
    from: getAddress(plan.create.deployer),
    nonce: BigInt(plan.create.exactPendingNonce),
  });
  if (getAddress(predictedAddress) !== getAddress(plan.create.predictedAddress)) {
    throw new Error("reviewed CREATE address is invalid");
  }
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(plan.create?.expectedRuntimeCodeKeccak256 ?? "") ||
    !Number.isSafeInteger(plan.create?.expectedRuntimeCodeLength) ||
    plan.create.expectedRuntimeCodeLength <= 0 ||
    plan.create.expectedRuntimeCodeKeccak256 !==
      plan.expectedRuntime?.codeKeccak256 ||
    plan.create.expectedRuntimeCodeLength !== plan.expectedRuntime?.codeLength
  ) {
    throw new Error("reviewed exact runtime evidence is invalid");
  }

  const maximumCostWei = assessDeploymentCost({
    gasLimit: BigInt(plan.create.gasLimit),
    blockGasLimit: BigInt(plan.create.minimumObservedBlockGasLimit),
    observedFeePerGas: BigInt(plan.create.maximumObservedFeePerGas),
    maxFeePerGas: BigInt(plan.create.reviewedMaxFeePerGas),
    maxPriorityFeePerGas: BigInt(
      plan.create.reviewedMaxPriorityFeePerGas,
    ),
    maxTotalCostWei: BigInt(plan.create.reviewedMaxTotalCostWei),
    deployerBalance: BigInt(plan.create.deployerBalanceWei),
  });
  if (maximumCostWei.toString() !== plan.create.maximumCostWei) {
    throw new Error("reviewed maximum deployment cost is invalid");
  }

  if (
    plan.productionPolicy.document !==
      path.relative(root, productionPolicy.documentPath) ||
    plan.productionPolicy.documentSha256 !== sha256(productionPolicyBytes) ||
    plan.productionPolicy.registryPolicyCommitment !==
      productionPolicy.registryPolicyCommitment ||
    plan.safeControllers.verificationSha256 !==
      sha256(safeVerificationBytes) ||
    plan.safeControllers.policySha256 !== safePolicySha256 ||
    plan.safeControllers.custodyProofSha256 !==
      safeVerification.custodyProofSha256 ||
    JSON.stringify(plan.safeControllers.controllers) !==
      JSON.stringify(
        safeVerification.controllers.map(
          ({ role, address, owner, transactionHash, runtimeCodeKeccak256 }) => ({
            role,
            address,
            owner,
            transactionHash,
            runtimeCodeKeccak256,
          }),
        ),
      ) ||
    getAddress(plan.create.deployer) !==
      getAddress(safeVerification.deployer) ||
    getAddress(plan.constructor.initialAdmin) !==
      getAddress(safeVerification.admin) ||
    getAddress(plan.releaseAuthorization.owner) !==
      getAddress(safeVerification.releaseOwner) ||
    getAddress(plan.releaseAuthorization.owner) !==
      getAddress(manifest.releaseAuthorization.owner) ||
    plan.releaseAuthorization.maximumValiditySeconds !== 300
  ) {
    throw new Error("policy, Safe, deployer, admin, or release binding is invalid");
  }

  assertDistinctControllerOwners({
    deployer: plan.create.deployer,
    admin: plan.constructor.initialAdmin,
    releaseOwner: plan.releaseAuthorization.owner,
    owners: safeVerification.controllers.map(({ owner }) => owner),
  });
  const isolated = [
    plan.create.deployer,
    plan.constructor.initialAdmin,
    plan.releaseAuthorization.owner,
    ...safeVerification.controllers.map(({ owner }) => owner),
    ...controllers,
    plan.create.predictedAddress,
  ].map((value) => getAddress(value).toLowerCase());
  if (new Set(isolated).size !== isolated.length) {
    throw new Error("Registry deployment identities are not fully isolated");
  }

  return { ...inputs, deploymentData, source, controllers };
}

export function rawSourceSha256(bytes) {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}
