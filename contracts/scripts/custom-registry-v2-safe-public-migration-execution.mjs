import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  recoverMessageAddress,
} from "viem";

import {
  AUTHORIZATION_SEMANTICS,
  assertSettledDeployerNonce,
} from "./custom-registry-v2-deployment-guards.mjs";
import {
  assertCanonicalTransactionJournalPath,
  assertNoExistingTransactionIntent,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";
import {
  assertDispatchAuthorizedJournal,
  assertExactSerializedEip1559Transaction,
  assertStagedTransactionEvidence,
} from "./custom-registry-v2-transaction-journal.mjs";
import {
  assertHardwareMigrationInventory,
  assertSafePublicMigrationPolicy,
  assertSafePublicMigrationReleaseAuthorization,
  safePublicMigrationTransaction,
  safeTransactionHash,
} from "./custom-registry-v2-safe-public-migration-guards.mjs";
import { SAFE_VERIFICATION_SCHEMA } from "./custom-registry-v2-safe-controller-guards.mjs";

export const SAFE_PUBLIC_MIGRATION_STAGED_SCHEMA =
  "programmable.custom-registry-v2-safe-public-migration-staged-transaction.v1";
export const SAFE_PUBLIC_MIGRATION_AUTHORIZATION_SCHEMA =
  "programmable.custom-registry-v2-safe-public-migration-authorization.v1";
export const SAFE_PUBLIC_MIGRATION_JOURNAL_SCHEMA =
  "programmable.custom-registry-v2-safe-public-migration-journal.v1";
export const SAFE_PUBLIC_MIGRATION_EXECUTION_BUNDLE_SCHEMA =
  "programmable.custom-registry-v2-safe-public-migration-execution-bundle.v1";
export const SAFE_PUBLIC_MIGRATION_SIGNED_EVENT =
  "SIGNED_SAFE_PUBLIC_MIGRATION_NOT_CONFIRMED";

const sha256 = (bytes) =>
  `0x${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalSha256 = (value) => /^0x[0-9a-f]{64}$/u.test(value ?? "");
const canonicalRoleTransaction = (entry) => ({
  role: entry.role,
  stagedTransactionSha256: entry.stagedTransactionSha256,
  authorizedTransactionHash: entry.authorizedTransactionHash,
  signer: getAddress(entry.signer),
  nonce: BigInt(entry.nonce),
});

export function assertSafeMigrationSourcePlan(plan) {
  const remaining = plan?.remainingRoles;
  const transactions = plan?.transactions;
  if (
    plan?.schemaVersion !==
      "programmable.custom-registry-v2-safe-public-migration-plan.v2" ||
    plan.status !==
      "PREFLIGHT_ONLY_TWELVE_HARDWARE_KEYS_NO_SIGNING_NO_BROADCAST" ||
    plan.chainId !== 1 ||
    !/^[0-9a-f]{40}$/u.test(plan.source?.commit ?? "") ||
    !/^[0-9a-f]{40}$/u.test(plan.source?.tree ?? "") ||
    !canonicalSha256(plan.policySha256) ||
    !Array.isArray(plan.rpcProviderBindings) ||
    plan.rpcProviderBindings.length !== 2 ||
    !Array.isArray(remaining) ||
    !Array.isArray(transactions) ||
    remaining.length !== transactions.length ||
    new Set(remaining).size !== remaining.length ||
    transactions.some(
      (entry, index) =>
        entry.role !== remaining[index] ||
        entry.outerTransaction?.type !== "eip1559" ||
        entry.outerTransaction.chainId !== 1 ||
        getAddress(entry.outerTransaction.from) !== getAddress(entry.legacyOwner) ||
        getAddress(entry.outerTransaction.to) !== getAddress(entry.safe) ||
        !Number.isSafeInteger(entry.outerTransaction.nonce),
    ) ||
    plan.signingAllowed !== false ||
    plan.broadcastAllowed !== false ||
    plan.activationAllowed !== false ||
    !Number.isSafeInteger(plan.createdAtTimestamp) ||
    !Number.isSafeInteger(plan.expiresAtTimestamp) ||
    plan.expiresAtTimestamp - plan.createdAtTimestamp !== 600 ||
    plan.releaseAuthorization
      ?.maximumDispatchIntentAuthorizationValiditySeconds !== 300 ||
    plan.releaseAuthorization?.authorizationSemantics !==
      AUTHORIZATION_SEMANTICS
  ) {
    throw new Error("Safe migration source plan is invalid");
  }
  getAddress(plan.releaseAuthorization.owner);
  return plan;
}

export function assertSafeMigrationPlanTransactions({
  plan,
  intentRoles,
  multiSendCallOnly,
}) {
  if (
    !Array.isArray(plan?.remainingRoles) ||
    !Array.isArray(plan?.transactions) ||
    plan.remainingRoles.length !== plan.transactions.length ||
    plan.transactions.length !== intentRoles?.length
  ) {
    throw new Error("Safe migration exact transaction binding is invalid");
  }
  let aggregateMaximumCostWei = 0n;
  for (const [index, intent] of intentRoles.entries()) {
    const entry = plan.transactions[index];
    const migration = safePublicMigrationTransaction({
      safe: intent.safe,
      legacyOwner: intent.legacyOwner,
      hardwareOwners: intent.hardwareOwners,
      safeNonce: 0n,
      multiSendCallOnly,
    });
    const expectedSafeTransactionHash = safeTransactionHash({
      safe: intent.safe,
      transaction: migration.safeTransaction,
    });
    const gasLimit = BigInt(entry?.outerTransaction?.gasLimit ?? 0);
    const maxFeePerGas = BigInt(
      entry?.outerTransaction?.maxFeePerGas ?? 0,
    );
    const maxPriorityFeePerGas = BigInt(
      entry?.outerTransaction?.maxPriorityFeePerGas ?? 0,
    );
    const maximumCostWei = gasLimit * maxFeePerGas;
    if (
      entry?.role !== intent.role ||
      plan.remainingRoles[index] !== intent.role ||
      getAddress(entry.safe) !== getAddress(intent.safe) ||
      getAddress(entry.legacyOwner) !== getAddress(intent.legacyOwner) ||
      JSON.stringify(entry.hardwareOwners.map((value) => getAddress(value))) !==
        JSON.stringify(intent.hardwareOwners.map((value) => getAddress(value))) ||
      JSON.stringify(entry.expectedOwners.map((value) => getAddress(value))) !==
        JSON.stringify(migration.expectedOwners.map((value) => getAddress(value))) ||
      entry.expectedThreshold !== 2 ||
      entry.expectedSafeNonceBefore !== "0" ||
      entry.expectedSafeNonceAfter !== "1" ||
      entry.safeTransactionHash !== expectedSafeTransactionHash ||
      entry.outerTransaction?.type !== "eip1559" ||
      entry.outerTransaction.chainId !== 1 ||
      getAddress(entry.outerTransaction.from) !== getAddress(intent.legacyOwner) ||
      getAddress(entry.outerTransaction.to) !== getAddress(intent.safe) ||
      entry.outerTransaction.input !== migration.execTransactionData ||
      entry.outerTransaction.valueWei !== "0" ||
      !Number.isSafeInteger(entry.outerTransaction.nonce) ||
      entry.outerTransaction.nonce < 0 ||
      gasLimit <= 0n ||
      maxPriorityFeePerGas <= 0n ||
      maxFeePerGas < maxPriorityFeePerGas ||
      entry.maximumCostWei !== maximumCostWei.toString()
    ) {
      throw new Error("Safe migration exact transaction binding is invalid");
    }
    aggregateMaximumCostWei += maximumCostWei;
  }
  if (
    plan.feeReview?.aggregateMaximumCostWei !==
      aggregateMaximumCostWei.toString() ||
    aggregateMaximumCostWei >
      BigInt(plan.feeReview?.ownerAggregateCostCeilingWei ?? 0) ||
    plan.feeReview?.reviewedMaxFeePerGas !==
      plan.transactions[0]?.outerTransaction.maxFeePerGas ||
    plan.transactions.some(
      (entry) =>
        entry.outerTransaction.maxFeePerGas !==
          plan.feeReview.reviewedMaxFeePerGas ||
        entry.outerTransaction.maxPriorityFeePerGas !==
          plan.feeReview.reviewedMaxPriorityFeePerGas,
    )
  ) {
    throw new Error("Safe migration exact transaction binding is invalid");
  }
  return true;
}

export async function assertSafeMigrationPlanAgainstEvidence({
  plan,
  darkSafeVerification,
  darkSafeVerificationSha256,
  hardwareInventory,
  hardwareInventorySha256,
  policy,
  policySha256,
  safeControllerPolicySha256,
  releasePolicy,
  releasePolicySha256,
  predeployment,
  predeploymentManifestSha256,
  expectedMaxFeePerGas,
  expectedMaxPriorityFeePerGas,
  expectedAggregateCostCeilingWei,
  nowTimestamp,
  trustedTime,
}) {
  assertSafeMigrationSourcePlan(plan);
  assertSafePublicMigrationPolicy(policy);
  if (
    darkSafeVerification?.schemaVersion !== SAFE_VERIFICATION_SCHEMA ||
    darkSafeVerification.verified !== true ||
    darkSafeVerification.chainId !== 1 ||
    darkSafeVerification.controllers?.length !== 4 ||
    darkSafeVerificationSha256 !== plan.darkSafeVerificationSha256 ||
    hardwareInventorySha256 !== plan.hardwareInventorySha256 ||
    policySha256 !== plan.policySha256 ||
    safeControllerPolicySha256 !== plan.safeControllerPolicySha256 ||
    releasePolicySha256 !== plan.releasePolicySha256 ||
    predeploymentManifestSha256 !== plan.predeploymentManifestSha256 ||
    releasePolicy?.schemaVersion !==
      "programmable.custom-registry-release-policy.v3" ||
    releasePolicy.activationAllowed !== false ||
    predeployment?.schemaVersion !==
      "programmable.custom-registry-predeployment.v3" ||
    predeployment.status !== "SOURCE_ONLY_NOT_DEPLOYED" ||
    predeployment.activationAllowed !== false ||
    plan.source?.commit !== darkSafeVerification.source?.commit ||
    plan.source?.tree !== darkSafeVerification.source?.tree ||
    plan.feeReview?.reviewedMaxFeePerGas !==
      BigInt(expectedMaxFeePerGas).toString() ||
    plan.feeReview?.reviewedMaxPriorityFeePerGas !==
      BigInt(expectedMaxPriorityFeePerGas).toString() ||
    plan.feeReview?.ownerAggregateCostCeilingWei !==
      BigInt(expectedAggregateCostCeilingWei).toString()
  ) {
    throw new Error("Safe migration reviewed evidence binding is invalid");
  }
  assertSafePublicMigrationReleaseAuthorization({
    actual: plan.releaseAuthorization,
    expected: predeployment.releaseAuthorization,
    releaseOwner: darkSafeVerification.releaseOwner,
  });
  const inventory = await assertHardwareMigrationInventory({
    inventory: hardwareInventory,
    darkSafeVerification,
    darkSafeVerificationSha256,
    policySha256,
    forbiddenAddresses: [
      darkSafeVerification.deployer,
      darkSafeVerification.admin,
      darkSafeVerification.releaseOwner,
      darkSafeVerification.singleton.address,
      darkSafeVerification.proxyFactory.address,
      darkSafeVerification.multiSendCallOnly.address,
    ],
    nowTimestamp,
    trustedTime,
  });
  if (
    inventory.migrationPlanDigest !== plan.migrationPlanDigest ||
    JSON.stringify(inventory.proofWindow) !==
      JSON.stringify(plan.hardwareProofWindow) ||
    plan.roleStates?.length !== 4 ||
    plan.roleStates.some((entry, index) => {
      const intent = inventory.intentRoles[index];
      const dark = darkSafeVerification.controllers[index];
      return (
        entry.role !== intent.role ||
        dark.role !== intent.role ||
        getAddress(entry.safe) !== getAddress(intent.safe) ||
        getAddress(entry.safe) !== getAddress(dark.address) ||
        getAddress(entry.legacyOwner) !== getAddress(intent.legacyOwner) ||
        getAddress(entry.legacyOwner) !== getAddress(dark.owner) ||
        JSON.stringify(
          entry.hardwareOwners.map((value) => getAddress(value)),
        ) !==
          JSON.stringify(
            intent.hardwareOwners.map((value) => getAddress(value)),
          )
      );
    })
  ) {
    throw new Error("Safe migration reviewed evidence binding is invalid");
  }
  const remainingIntentRoles = plan.remainingRoles.map((role) => {
    const matches = inventory.intentRoles.filter((entry) => entry.role === role);
    if (matches.length !== 1) {
      throw new Error("Safe migration reviewed evidence binding is invalid");
    }
    return matches[0];
  });
  assertSafeMigrationPlanTransactions({
    plan,
    intentRoles: remainingIntentRoles,
    multiSendCallOnly: policy.multiSendCallOnly.address,
  });
  return { inventory, remainingIntentRoles };
}

async function readBoundJsonEvidence({ pathValue, digestValue, label }) {
  const filePath = assertReleaseEvidencePath(pathValue, { mode: 0o600 });
  const bytes = await readFile(filePath);
  if (!canonicalSha256(digestValue) || sha256(bytes) !== digestValue) {
    throw new Error(`${label} digest mismatch`);
  }
  return { bytes, digest: digestValue, value: JSON.parse(bytes) };
}

export async function loadAndAssertSafeMigrationReviewedPlan({
  root,
  plan,
  nowTimestamp,
  trustedTime,
}) {
  const required = (name) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const dark = await readBoundJsonEvidence({
    pathValue: required("REGISTRY_SAFE_VERIFICATION_PATH"),
    digestValue: required("REGISTRY_SAFE_VERIFICATION_SHA256"),
    label: "dark Safe verification",
  });
  const hardware = await readBoundJsonEvidence({
    pathValue: required("REGISTRY_HARDWARE_OWNER_INVENTORY_PATH"),
    digestValue: required("REGISTRY_HARDWARE_OWNER_INVENTORY_SHA256"),
    label: "hardware owner inventory",
  });
  const [policyBytes, safeControllerPolicyBytes, releasePolicyBytes, manifestBytes] =
    await Promise.all([
      readFile(
        path.join(
          root,
          "config/custom-registry-v2-safe-public-migration-policy.json",
        ),
      ),
      readFile(
        path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
      ),
      readFile(path.join(root, "config/custom-registry-v2-release-policy.json")),
      readFile(
        path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"),
      ),
    ]);
  const policySha256 = sha256(policyBytes);
  const safeControllerPolicySha256 = sha256(safeControllerPolicyBytes);
  const releasePolicySha256 = sha256(releasePolicyBytes);
  const predeploymentManifestSha256 = sha256(manifestBytes);
  const policy = JSON.parse(policyBytes);
  const releasePolicy = JSON.parse(releasePolicyBytes);
  const predeployment = JSON.parse(manifestBytes);
  if (
    predeployment.sourceDigests?.[
      "config/custom-registry-v2-safe-public-migration-policy.json"
    ] !== policySha256 ||
    predeployment.sourceDigests?.[
      "config/custom-registry-v2-safe-controller-policy.json"
    ] !== safeControllerPolicySha256 ||
    predeployment.sourceDigests?.[
      "config/custom-registry-v2-release-policy.json"
    ] !== releasePolicySha256
  ) {
    throw new Error("Safe migration reviewed manifest source binding is invalid");
  }
  return assertSafeMigrationPlanAgainstEvidence({
    plan,
    darkSafeVerification: dark.value,
    darkSafeVerificationSha256: dark.digest,
    hardwareInventory: hardware.value,
    hardwareInventorySha256: hardware.digest,
    policy,
    policySha256,
    safeControllerPolicySha256,
    releasePolicy,
    releasePolicySha256,
    predeployment,
    predeploymentManifestSha256,
    expectedMaxFeePerGas: required("REGISTRY_MIGRATION_MAX_FEE_PER_GAS"),
    expectedMaxPriorityFeePerGas: required(
      "REGISTRY_MIGRATION_MAX_PRIORITY_FEE_PER_GAS",
    ),
    expectedAggregateCostCeilingWei: required(
      "REGISTRY_MIGRATION_MAX_TOTAL_COST_WEI",
    ),
    nowTimestamp,
    trustedTime,
  });
}

export function assertSafeMigrationSignerNonceAvailable({
  signer,
  pendingNonces,
  finalizedNonces,
}) {
  const nonce = assertSettledDeployerNonce({
    pendingNonces,
    finalizedNonces,
  });
  assertNoExistingTransactionIntent({ chainId: 1, signer, nonce });
  return nonce;
}

export function computeSafeMigrationAuthorizationDigest(authorization) {
  const entries = authorization?.authorizedTransactions;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("migration authorization transactions are required");
  }
  const transactionSetDigest = keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple[]",
          components: [
            { name: "role", type: "string" },
            { name: "stagedTransactionSha256", type: "bytes32" },
            { name: "authorizedTransactionHash", type: "bytes32" },
            { name: "signer", type: "address" },
            { name: "nonce", type: "uint64" },
          ],
        },
      ],
      [entries.map(canonicalRoleTransaction)],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        SAFE_PUBLIC_MIGRATION_AUTHORIZATION_SCHEMA,
        authorization.planSha256,
        transactionSetDigest,
        getAddress(authorization.ownerAuthorizationAddress),
        BigInt(authorization.notBeforeTimestamp),
        BigInt(authorization.dispatchIntentExpiresAtTimestamp),
        AUTHORIZATION_SEMANTICS,
        authorization.source.commit,
        authorization.source.tree,
        authorization.policySha256,
        authorization.continuationEvidenceSha256 ?? `0x${"00".repeat(32)}`,
        keccak256(
          encodeAbiParameters(
            [{ type: "string[]" }],
            [entries.map(({ role }) => role)],
          ),
        ),
      ],
    ),
  );
}

export function safeMigrationAuthorizationMessage(reviewedPlanDigest) {
  return `Programmable Custom Registry V2 Safe public migration authorization\n${reviewedPlanDigest}`;
}

export function assertSafeMigrationAuthorization({
  authorization,
  plan,
  planSha256,
  stagedTransactions = [],
  stagedTransactionSha256ByRole = new Map(),
  nowTimestamp,
  allowExpired = false,
}) {
  assertSafeMigrationSourcePlan(plan);
  const remainingRoles = plan?.remainingRoles;
  const plannedTransactions = plan?.transactions;
  const authorized = authorization?.authorizedTransactions;
  if (
    !Array.isArray(remainingRoles) ||
    !Array.isArray(plannedTransactions) ||
    !Array.isArray(authorized) ||
    authorized.length !== remainingRoles.length ||
    authorized.length !== plannedTransactions.length
  ) {
    throw new Error("authorization must bind every remaining migration role");
  }
  if (
    authorization?.schemaVersion !==
      SAFE_PUBLIC_MIGRATION_AUTHORIZATION_SCHEMA ||
    authorization.status !==
      "REVIEWED_REMAINING_ROLES_READY_FOR_EXPLICIT_DISPATCH_INTENTS" ||
    authorization.planSha256 !== planSha256 ||
    authorization.source?.commit !== plan?.source?.commit ||
    authorization.source?.tree !== plan?.source?.tree ||
    authorization.policySha256 !== plan?.policySha256 ||
    authorization.continuationEvidenceSha256 !==
      (plan?.continuationEvidenceSha256 ?? null) ||
    authorization.authorizationSemantics !== AUTHORIZATION_SEMANTICS ||
    plan?.releaseAuthorization?.authorizationSemantics !==
      AUTHORIZATION_SEMANTICS ||
    plan?.releaseAuthorization
      ?.maximumDispatchIntentAuthorizationValiditySeconds !== 300 ||
    getAddress(authorization.ownerAuthorizationAddress) !==
      getAddress(plan?.releaseAuthorization?.owner) ||
    authorization.signingAllowed !== false ||
    authorization.broadcastAllowed !== false ||
    authorization.dispatchIntentActivationAllowed !== true ||
    authorization.broadcastRequiresDurableDispatchIntent !== true ||
    !Number.isSafeInteger(authorization.notBeforeTimestamp) ||
    !Number.isSafeInteger(authorization.dispatchIntentExpiresAtTimestamp) ||
    !Number.isSafeInteger(nowTimestamp) ||
    authorization.notBeforeTimestamp < plan.createdAtTimestamp ||
    authorization.dispatchIntentExpiresAtTimestamp <=
      authorization.notBeforeTimestamp ||
    authorization.dispatchIntentExpiresAtTimestamp -
        authorization.notBeforeTimestamp >
      300 ||
    authorization.dispatchIntentExpiresAtTimestamp > plan.expiresAtTimestamp ||
    (!allowExpired &&
      (authorization.notBeforeTimestamp > nowTimestamp ||
        authorization.dispatchIntentExpiresAtTimestamp < nowTimestamp))
  ) {
    throw new Error("migration authorization is stale or invalid");
  }
  const stagedByRole = new Map(
    stagedTransactions.map((entry) => [entry.role, entry]),
  );
  for (const [index, role] of remainingRoles.entries()) {
    const planned = plannedTransactions[index];
    const entry = authorized[index];
    if (
      planned?.role !== role ||
      entry?.role !== role ||
      !canonicalSha256(entry.stagedTransactionSha256) ||
      !/^0x[0-9a-fA-F]{64}$/u.test(entry.authorizedTransactionHash ?? "") ||
      getAddress(entry.signer) !== getAddress(planned.outerTransaction.from) ||
      entry.nonce !== planned.outerTransaction.nonce
    ) {
      throw new Error("authorization must bind every remaining migration role");
    }
    const staged = stagedByRole.get(role);
    const expectedStagedDigest = stagedTransactionSha256ByRole.get(role);
    if (
      staged &&
      (staged.transactionHash !== entry.authorizedTransactionHash ||
        expectedStagedDigest !== entry.stagedTransactionSha256)
    ) {
      throw new Error(`${role} staged migration authorization binding failed`);
    }
  }
  if (authorization.reviewedPlanDigest !== computeSafeMigrationAuthorizationDigest(authorization)) {
    throw new Error("migration authorization digest mismatch");
  }
  return authorization.reviewedPlanDigest;
}

export async function verifySafeMigrationAuthorizationSignature(authorization) {
  if (!/^0x[0-9a-fA-F]{130}$/u.test(authorization?.ownerAuthorizationSignature ?? "")) {
    throw new Error("migration owner authorization signature is invalid");
  }
  const recovered = await recoverMessageAddress({
    message: safeMigrationAuthorizationMessage(authorization.reviewedPlanDigest),
    signature: authorization.ownerAuthorizationSignature,
  });
  if (getAddress(recovered) !== getAddress(authorization.ownerAuthorizationAddress)) {
    throw new Error("migration owner authorization signature mismatch");
  }
  return getAddress(recovered);
}

async function readExactArtifact(artifact, { mode }) {
  if (
    !artifact ||
    !canonicalSha256(artifact.sha256) ||
    typeof artifact.bytesBase64 !== "string" ||
    Buffer.from(artifact.bytesBase64, "base64").toString("base64") !==
      artifact.bytesBase64
  ) {
    throw new Error("execution artifact bytes or digest mismatch");
  }
  const embeddedBytes = Buffer.from(artifact.bytesBase64, "base64");
  const filePath = assertReleaseEvidencePath(artifact.path, { mode });
  const fileBytes = await readFile(filePath);
  if (
    embeddedBytes.length === 0 ||
    sha256(embeddedBytes) !== artifact.sha256 ||
    sha256(fileBytes) !== artifact.sha256 ||
    !fileBytes.equals(embeddedBytes)
  ) {
    throw new Error("execution artifact bytes or digest mismatch");
  }
  return { bytes: embeddedBytes, path: filePath };
}

export async function assertSafeMigrationExecutionBundle({
  bundle,
  plan,
  plannedRole,
  nowTimestamp,
  allowExpired = false,
}) {
  assertSafeMigrationSourcePlan(plan);
  if (
    bundle?.schemaVersion !== SAFE_PUBLIC_MIGRATION_EXECUTION_BUNDLE_SCHEMA ||
    bundle.status !==
      "EXACT_ROLE_EXECUTION_EVIDENCE_AWAITING_FINALIZED_CHAIN_VERIFICATION" ||
    bundle.chainId !== 1 ||
    bundle.role !== plannedRole?.role ||
    !/^0x[0-9a-fA-F]{64}$/u.test(bundle.transactionHash ?? "")
  ) {
    throw new Error("Safe migration execution bundle is invalid");
  }
  const [planArtifact, stagedArtifact, authorizationArtifact, journalArtifact] =
    await Promise.all([
      readExactArtifact(bundle.artifacts?.plan, { mode: 0o600 }),
      readExactArtifact(bundle.artifacts?.stagedTransaction, { mode: 0o400 }),
      readExactArtifact(bundle.artifacts?.ownerAuthorization, { mode: 0o600 }),
      readExactArtifact(bundle.artifacts?.transactionJournal, { mode: 0o600 }),
    ]);
  let artifactPlan;
  let stagedTransaction;
  let authorization;
  let journalRecords;
  try {
    artifactPlan = JSON.parse(planArtifact.bytes);
    stagedTransaction = JSON.parse(stagedArtifact.bytes);
    authorization = JSON.parse(authorizationArtifact.bytes);
    journalRecords = journalArtifact.bytes
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error("Safe migration execution artifact JSON is invalid");
  }
  if (
    JSON.stringify(artifactPlan) !== JSON.stringify(plan) ||
    bundle.artifacts.plan.sha256 !== authorization.planSha256 ||
    stagedTransaction.schemaVersion !== SAFE_PUBLIC_MIGRATION_STAGED_SCHEMA ||
    stagedTransaction.role !== bundle.role ||
    stagedTransaction.planSha256 !== bundle.artifacts.plan.sha256 ||
    stagedTransaction.source?.commit !== plan.source?.commit ||
    stagedTransaction.source?.tree !== plan.source?.tree ||
    stagedTransaction.policySha256 !== plan.policySha256 ||
    stagedTransaction.continuationEvidenceSha256 !==
      (plan.continuationEvidenceSha256 ?? null)
  ) {
    throw new Error("Safe migration execution source or staged evidence drifted");
  }
  await assertStagedTransactionEvidence({
    evidence: stagedTransaction,
    schemaVersion: SAFE_PUBLIC_MIGRATION_STAGED_SCHEMA,
    preflightSha256: bundle.artifacts.plan.sha256,
    expectedTransaction: plannedRole.outerTransaction,
    planCreatedAtTimestamp: plan.createdAtTimestamp,
    planExpiresAtTimestamp: plan.expiresAtTimestamp,
  });
  const roleAuthorization = authorization.authorizedTransactions?.find(
    ({ role }) => role === bundle.role,
  );
  assertSafeMigrationAuthorization({
    authorization,
    plan,
    planSha256: bundle.artifacts.plan.sha256,
    stagedTransactions: [stagedTransaction],
    stagedTransactionSha256ByRole: new Map([
      [bundle.role, bundle.artifacts.stagedTransaction.sha256],
    ]),
    nowTimestamp,
    allowExpired,
  });
  await verifySafeMigrationAuthorizationSignature(authorization);
  if (
    !roleAuthorization ||
    roleAuthorization.authorizedTransactionHash !== bundle.transactionHash ||
    stagedTransaction.transactionHash !== bundle.transactionHash
  ) {
    throw new Error("Safe migration execution transaction hash drifted");
  }
  assertCanonicalTransactionJournalPath({
    candidate: journalArtifact.path,
    chainId: 1,
    signer: plannedRole.outerTransaction.from,
    nonce: plannedRole.outerTransaction.nonce,
    mustExist: true,
  });
  const journal = assertDispatchAuthorizedJournal({
    records: journalRecords,
    schemaVersion: SAFE_PUBLIC_MIGRATION_JOURNAL_SCHEMA,
    signedEvent: SAFE_PUBLIC_MIGRATION_SIGNED_EVENT,
    transactionHash: bundle.transactionHash,
    stagedTransactionSha256: bundle.artifacts.stagedTransaction.sha256,
    authorizationSha256: bundle.artifacts.ownerAuthorization.sha256,
    authorization,
    broadcastProviderBindings: plan.rpcProviderBindings,
    discoveryProviderBindings: plan.rpcProviderBindings,
    allowedTailEvents: [
      "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
      "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
    ],
  });
  if (
    journal.header.planSha256 !== bundle.artifacts.plan.sha256 ||
    journal.header.role !== bundle.role ||
    getAddress(journal.header.signer) !==
      getAddress(plannedRole.outerTransaction.from) ||
    journal.header.nonce !== plannedRole.outerTransaction.nonce ||
    journal.signed.serializedTransaction !==
      stagedTransaction.serializedTransaction ||
    !journal.receipt ||
    !journal.completion
  ) {
    throw new Error("Safe migration canonical journal is incomplete or invalid");
  }
  const { signer } = await assertExactSerializedEip1559Transaction({
    serializedTransaction: stagedTransaction.serializedTransaction,
    transactionHash: stagedTransaction.transactionHash,
    expected: plannedRole.outerTransaction,
  });
  return {
    bundle,
    plan: artifactPlan,
    plannedRole,
    stagedTransaction,
    authorization,
    journalRecords,
    transactionHash: bundle.transactionHash,
    signer,
    nonce: plannedRole.outerTransaction.nonce,
  };
}

export async function createSafeMigrationExecutionBundle({
  role,
  planPath,
  planSha256,
  stagedTransactionPath,
  stagedTransactionSha256,
  ownerAuthorizationPath,
  ownerAuthorizationSha256,
  transactionJournalPath,
  transactionJournalSha256,
  nowTimestamp,
  allowExpired = true,
}) {
  const artifacts = {};
  for (const [name, filePath, digest, mode] of [
    ["plan", planPath, planSha256, 0o600],
    ["stagedTransaction", stagedTransactionPath, stagedTransactionSha256, 0o400],
    ["ownerAuthorization", ownerAuthorizationPath, ownerAuthorizationSha256, 0o600],
    ["transactionJournal", transactionJournalPath, transactionJournalSha256, 0o600],
  ]) {
    const canonicalPath = assertReleaseEvidencePath(filePath, { mode });
    const bytes = await readFile(canonicalPath);
    if (!canonicalSha256(digest) || sha256(bytes) !== digest) {
      throw new Error(`${name} artifact digest mismatch`);
    }
    artifacts[name] = {
      path: canonicalPath,
      sha256: digest,
      bytesBase64: bytes.toString("base64"),
    };
  }
  const plan = JSON.parse(artifacts.plan.bytesBase64.length
    ? Buffer.from(artifacts.plan.bytesBase64, "base64")
    : "{}");
  const plannedRole = plan.transactions?.find((entry) => entry.role === role);
  const staged = JSON.parse(
    Buffer.from(artifacts.stagedTransaction.bytesBase64, "base64"),
  );
  const bundle = {
    schemaVersion: SAFE_PUBLIC_MIGRATION_EXECUTION_BUNDLE_SCHEMA,
    status:
      "EXACT_ROLE_EXECUTION_EVIDENCE_AWAITING_FINALIZED_CHAIN_VERIFICATION",
    chainId: 1,
    role,
    transactionHash: staged.transactionHash,
    artifacts,
  };
  const parsed = await assertSafeMigrationExecutionBundle({
    bundle,
    plan,
    plannedRole,
    nowTimestamp,
    allowExpired,
  });
  return { bundle, parsed };
}

export async function readSafeMigrationExecutionBundle({
  bundlePath,
  bundleSha256,
  ...validation
}) {
  const filePath = assertReleaseEvidencePath(bundlePath, { mode: 0o600 });
  const bytes = await readFile(filePath);
  if (!canonicalSha256(bundleSha256) || sha256(bytes) !== bundleSha256) {
    throw new Error("Safe migration execution bundle digest mismatch");
  }
  let bundle;
  try {
    bundle = JSON.parse(bytes);
  } catch {
    throw new Error("Safe migration execution bundle JSON is invalid");
  }
  return assertSafeMigrationExecutionBundle({ bundle, ...validation });
}

export async function readSafeMigrationExecutionBundleContext({
  bundlePath,
  bundleSha256,
  nowTimestamp,
  allowExpired = true,
}) {
  const filePath = assertReleaseEvidencePath(bundlePath, { mode: 0o600 });
  const bundleBytes = await readFile(filePath);
  if (!canonicalSha256(bundleSha256) || sha256(bundleBytes) !== bundleSha256) {
    throw new Error("Safe migration execution bundle digest mismatch");
  }
  let bundle;
  try {
    bundle = JSON.parse(bundleBytes);
  } catch {
    throw new Error("Safe migration execution bundle JSON is invalid");
  }
  const planArtifact = await readExactArtifact(bundle.artifacts?.plan, {
    mode: 0o600,
  });
  let plan;
  try {
    plan = JSON.parse(planArtifact.bytes);
  } catch {
    throw new Error("Safe migration embedded plan JSON is invalid");
  }
  const matches = plan.transactions?.filter(
    (entry) => entry.role === bundle.role,
  );
  if (matches?.length !== 1 || !plan.remainingRoles?.includes(bundle.role)) {
    throw new Error("Safe migration bundle role is not unique in original plan");
  }
  return assertSafeMigrationExecutionBundle({
    bundle,
    plan,
    plannedRole: matches[0],
    nowTimestamp,
    allowExpired,
  });
}

export function assertSafeMigrationContinuationExecutionBinding({
  entry,
  execution,
  executionBundlePath,
  executionBundleSha256,
  migrationPlanDigest,
  source,
  darkSafeVerificationSha256,
  policySha256,
  safeControllerPolicySha256,
  releasePolicySha256,
  predeploymentManifestSha256,
  hardwareInventorySha256,
  releaseAuthorization,
}) {
  if (
    entry?.role !== execution?.bundle?.role ||
    entry.transactionHash !== execution.transactionHash ||
    entry.executionBundlePath !== executionBundlePath ||
    entry.executionBundleSha256 !== executionBundleSha256 ||
    entry.sourcePlanSha256 !== execution.bundle.artifacts.plan.sha256 ||
    entry.ownerAuthorizationSha256 !==
      execution.bundle.artifacts.ownerAuthorization.sha256 ||
    entry.transactionJournalSha256 !==
      execution.bundle.artifacts.transactionJournal.sha256 ||
    execution.plan.migrationPlanDigest !== migrationPlanDigest ||
    execution.plan.source?.commit !== source?.commit ||
    execution.plan.source?.tree !== source?.tree ||
    execution.plan.darkSafeVerificationSha256 !==
      darkSafeVerificationSha256 ||
    execution.plan.policySha256 !== policySha256 ||
    execution.plan.safeControllerPolicySha256 !==
      safeControllerPolicySha256 ||
    execution.plan.releasePolicySha256 !== releasePolicySha256 ||
    execution.plan.predeploymentManifestSha256 !==
      predeploymentManifestSha256 ||
    execution.plan.hardwareInventorySha256 !== hardwareInventorySha256
  ) {
    throw new Error("Safe migration continuation execution provenance is invalid");
  }
  assertSafePublicMigrationReleaseAuthorization({
    actual: execution.plan.releaseAuthorization,
    expected: releaseAuthorization,
    releaseOwner: releaseAuthorization?.owner,
  });
  return true;
}

export function assertSafeMigrationReceiptFollowsDispatchIntent({
  receiptBlockTimestamp,
  execution,
}) {
  const trustedTime = execution?.journalRecords?.find(
    ({ event }) => event === "DISPATCH_INTENT_ACTIVATED",
  )?.activatedTrustedTime;
  if (
    typeof receiptBlockTimestamp !== "bigint" ||
    !Number.isSafeInteger(trustedTime?.adjustedTimeMilliseconds) ||
    !Number.isSafeInteger(trustedTime?.uncertaintyMilliseconds) ||
    receiptBlockTimestamp * 1000n <=
      BigInt(
        trustedTime.adjustedTimeMilliseconds +
          trustedTime.uncertaintyMilliseconds,
      )
  ) {
    throw new Error("finalized migration receipt must follow durable dispatch intent");
  }
  return true;
}

export function safeMigrationReceiptTailEvents({
  existingReceipt,
  transactionHash,
  blockNumber,
  blockHash,
  observedTrustedTime,
  completedTrustedTime,
}) {
  const blockNumberString = BigInt(blockNumber).toString();
  if (
    !/^0x[0-9a-fA-F]{64}$/u.test(transactionHash ?? "") ||
    !/^0x[0-9a-fA-F]{64}$/u.test(blockHash ?? "") ||
    existingReceipt &&
      (existingReceipt.transactionHash !== transactionHash ||
        existingReceipt.blockNumber !== blockNumberString ||
        existingReceipt.blockHash !== blockHash)
  ) {
    throw new Error("existing migration receipt differs from live receipt");
  }
  const receipt = existingReceipt
    ? []
    : [
        {
          event: "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
          transactionHash,
          observedAtTimestamp: observedTrustedTime.adjustedTimestamp,
          blockNumber: blockNumberString,
          blockHash,
        },
      ];
  return [
    ...receipt,
    {
      event: "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
      transactionHash,
      observedAtTimestamp: completedTrustedTime.adjustedTimestamp,
    },
  ];
}

export function assertSafeMigrationJournalCandidate({
  records,
  candidate,
  plan,
  plannedRole,
  stagedTransaction,
  stagedTransactionSha256,
  authorization,
  authorizationSha256,
  planSha256,
}) {
  const parsed = assertDispatchAuthorizedJournal({
    records: [...records, candidate],
    schemaVersion: SAFE_PUBLIC_MIGRATION_JOURNAL_SCHEMA,
    signedEvent: SAFE_PUBLIC_MIGRATION_SIGNED_EVENT,
    transactionHash: stagedTransaction.transactionHash,
    stagedTransactionSha256,
    authorizationSha256,
    authorization,
    broadcastProviderBindings: plan.rpcProviderBindings,
    discoveryProviderBindings: plan.rpcProviderBindings,
    allowedTailEvents: [
      "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
      "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
    ],
  });
  if (
    parsed.header.planSha256 !== planSha256 ||
    parsed.header.role !== plannedRole.role ||
    getAddress(parsed.header.signer) !==
      getAddress(plannedRole.outerTransaction.from) ||
    parsed.header.nonce !== plannedRole.outerTransaction.nonce ||
    parsed.signed.serializedTransaction !==
      stagedTransaction.serializedTransaction
  ) {
    throw new Error("migration candidate journal differs from exact reviewed raw");
  }
  return parsed;
}
