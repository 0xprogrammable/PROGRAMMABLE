import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const paths = [
  "contracts/src/interfaces/IProgrammableCustomRegistryV2.sol",
  "contracts/src/ProgrammableCustomRegistryV2.sol",
  "contracts/test/ProgrammableCustomRegistryV2.t.sol",
  "contracts/script/DeployProgrammableCustomRegistryV2.s.sol",
  "contracts/scripts/generate-custom-registry-v2-artifacts.mjs",
  "contracts/scripts/prepare-custom-registry-v2-deployment.mjs",
  "contracts/scripts/stage-custom-registry-v2-deployment-transaction.mjs",
  "contracts/scripts/authorize-custom-registry-v2-deployment.mjs",
  "contracts/scripts/custom-registry-v2-deployment-guards.mjs",
  "contracts/scripts/broadcast-custom-registry-v2-deployment.mjs",
  "contracts/scripts/test/custom-registry-v2-deployment-guards.test.mjs",
  "contracts/scripts/test/custom-registry-v2-deployment-cli.test.mjs",
  "contracts/spec/custom-registry-v2-predeployment.json",
  "docs/security/abi/ProgrammableCustomRegistryV2.json",
  "docs/security/CUSTOM_REGISTRY_EVENT_SET_V2.json",
  "config/custom-registry-v2-release-policy.json",
];
const universallyForbidden = [/partnerId/i, /partnerFactoryRegistry/i];
const applicantMetadataForbidden = [
  /providerId/i,
  /repositoryId/i,
  /repositoryOwner/i,
];

for (const relative of paths) {
  const contents = await readFile(path.join(root, relative), "utf8");
  const forbidden = [
    ...universallyForbidden,
    ...(relative.includes("/src/") || relative.includes("/abi/")
      ? applicantMetadataForbidden
      : []),
  ];
  for (const pattern of forbidden) {
    if (pattern.test(contents))
      throw new Error(`${relative} contains forbidden coupling ${pattern}`);
  }
}

const manifest = JSON.parse(
  await readFile(
    path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"),
    "utf8",
  ),
);
const releasePolicy = JSON.parse(
  await readFile(
    path.join(root, "config/custom-registry-v2-release-policy.json"),
    "utf8",
  ),
);
if (
  manifest.schemaVersion !== "programmable.custom-registry-predeployment.v3" ||
  releasePolicy.schemaVersion !==
    "programmable.custom-registry-release-policy.v3" ||
  manifest.status !== "SOURCE_ONLY_NOT_DEPLOYED" ||
  manifest.activationAllowed !== false ||
  Object.values(manifest.deployment).some((value) => value !== null) ||
  manifest.policy.market.protocolFeeBps !== 10 ||
  manifest.policy.noMarket.protocolFeeBps !== 0 ||
  releasePolicy.releaseOwner !== manifest.releaseAuthorization.owner ||
  releasePolicy.maximumDispatchIntentAuthorizationValiditySeconds !== 300 ||
  releasePolicy.authorizationSemantics !==
    "EXACT_RAW_TRANSACTION_HASH_AUTHORIZED_DURABLE_DISPATCH_INTENT_ACTIVATES_LATER_IDENTICAL_RAW_SEND_REBROADCAST_AND_INCLUSION_NO_WORKFLOW_CANCELLATION" ||
  releasePolicy.stagedRawTransactionTrustBoundary !==
    "OWNER_ONLY_0400_CURRENT_USER_DARK_DEPLOYMENT_WORKFLOW_NOT_AN_ONCHAIN_OWNER_GATE" ||
  releasePolicy.dispatchIntentFinalConfirmation !==
    "EXPLICIT_EXACT_TRANSACTION_HASH_REQUIRED_IMMEDIATELY_BEFORE_DURABLE_ACTIVATION" ||
  releasePolicy.nonceScopedJournalExclusivity !==
    "ONE_CANONICAL_CHAIN_SIGNER_NONCE_JOURNAL_BLOCKS_CHANGED_TRANSACTION_UNTIL_NONCE_IS_CANONICALLY_CONSUMED" ||
  releasePolicy.nonceScopedJournalExclusivity !==
    manifest.releaseAuthorization.nonceScopedJournalExclusivity ||
  releasePolicy.activationAllowed !== false
) {
  throw new Error("neutral predeployment manifest is not fail-closed");
}

process.stdout.write("CUSTOM_REGISTRY_V2_NEUTRALITY_VERIFIED\n");
