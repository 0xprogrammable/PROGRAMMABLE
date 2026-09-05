#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createV4ReleaseBindingTools } from "./programmable-launch-v4-release-binding.mjs";

// Shared deployed roots retain their original provenance. The successor binds its own
// policy, profile, CLI, machine contracts and backend promotion.
const RELEASE = {
  "backendApiContractPath": "release/custom-launch-api-contract.v4.1.json",
  "backendMigrationPath": "migrations/0029_activate_robinhood_fee_profile_v41.sql",
  "bindingSchema": "programmable.launch-cli-v4-release-binding.v2",
  "bindingPath": "docs/operations/releases/custom-launch-v4.1/cli-release-binding.json",
  "package": {
    "name": "@programmable/launch",
    "version": "4.1.0",
    "tag": "programmable-launch-v4.1.0",
    "repository": "programmablehq/PROGRAMMABLE"
  },
  "profile": {
    "schemaVersion": "programmable.custom-launch-profile-ref.v4",
    "structuralProfileId": "programmable.custom-launch.robinhood-mainnet.v1",
    "businessProfileId": "robinhood-production-launch",
    "admissionDescriptorDigest": "sha256:b09611360e284641873fdb2914b4282e0545e32ea587b278fcd11f4db9a4e7f5",
    "admissionPolicyDigest": "sha256:47801f57e2365f89eb7397a2df10d697bd1f756ec01536b9b34755e89809da04",
    "admissionBindingDigest": "sha256:5b2486f35fcd44bd476cafd5bfb5a12decf05a756ba237ca191928f5414c721e",
    "admissionSchemaDigest": "sha256:6a8194a3b5d8b6432a95ec04da3cd86091ad64c93c0531125caf00ecb919c8cf",
    "profileRevision": 2,
    "profileVersion": "4.1.0",
    "profileDigest": "sha256:b0fca91264a49d358ed1a9eec2a679b59a48d716b71475bef583c2545e1ee502"
  },
  "policySource": {
    "schemaVersion": "programmable.custom-launch-policy-source.v1",
    "repository": "programmablehq/Launch-Policy",
    "repositoryId": 1320171831,
    "protectedBranch": "main",
    "verifiedMergeCommit": "6e33d64609567f6d1d03c9a9d6bd41ee71fe48f4",
    "verifiedTree": "8aa630325d638b8dde573ebd6f95b35b0716e7bc",
    "artifacts": {
      "descriptor": {
        "path": "policy/custom-launch-admission-v4.1.json",
        "digest": "sha256:b09611360e284641873fdb2914b4282e0545e32ea587b278fcd11f4db9a4e7f5"
      },
      "businessPolicy": {
        "path": "policy/robinhood-custom-launch-economics-v1.json",
        "digest": "sha256:47801f57e2365f89eb7397a2df10d697bd1f756ec01536b9b34755e89809da04"
      },
      "generatedBinding": {
        "path": ".programmable/custom-launch-admission.v4.1.json",
        "digest": "sha256:5b2486f35fcd44bd476cafd5bfb5a12decf05a756ba237ca191928f5414c721e"
      },
      "schema": {
        "path": "policy/schemas/custom-launch-admission-v4.1.schema.json",
        "digest": "sha256:6a8194a3b5d8b6432a95ec04da3cd86091ad64c93c0531125caf00ecb919c8cf"
      }
    }
  },
  "machines": {
    "openapi": [
      "public/openapi/custom-launch-v4.1.json",
      "https://programmable.market/openapi/custom-launch-v4.1.json"
    ],
    "packConfig": [
      "public/schemas/custom-launch/v4.1/pack-config.json",
      "https://programmable.market/schemas/custom-launch/v4.1/pack-config.json"
    ],
    "createRequest": [
      "public/schemas/custom-launch/v4.1/custom-launch-create-request.json",
      "https://programmable.market/schemas/custom-launch/v4.1/custom-launch-create-request.json"
    ],
    "resource": [
      "public/schemas/custom-launch/v4.1/custom-launch.json",
      "https://programmable.market/schemas/custom-launch/v4.1/custom-launch.json"
    ],
    "sourceVerificationStatus": [
      "public/schemas/custom-launch/v4.1/source-verification-status.json",
      "https://programmable.market/schemas/custom-launch/v4.1/source-verification-status.json"
    ],
    "capabilities": [
      "public/schemas/custom-launch/v4.1/capabilities.json",
      "https://programmable.market/schemas/custom-launch/v4.1/capabilities.json"
    ],
    "preflight": [
      "public/schemas/custom-launch/v4.1/preflight.json",
      "https://programmable.market/schemas/custom-launch/v4.1/preflight.json"
    ],
    "onchainEvidence": [
      "public/schemas/custom-launch/v4.1/onchain-evidence.json",
      "https://programmable.market/schemas/custom-launch/v4.1/onchain-evidence.json"
    ],
    "exactWalletTransaction": [
      "public/schemas/custom-launch/v4.1/exact-wallet-transaction.json",
      "https://programmable.market/schemas/custom-launch/v4.1/exact-wallet-transaction.json"
    ]
  },
  "paths": {
    "V4_ROBINHOOD_PROMOTION_BUNDLE_PATH": "release/robinhood-chain-4663/v4.1/programmable-promotion-bundle.json",
    "V4_ROBINHOOD_BACKEND_AUTHORIZATION_PATH": "release/robinhood-chain-4663/v4.1/programmable-backend-authorization.json",
    "V4_ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH": "release/robinhood-chain-4663/v4.1/backend-promotion-input.public.json",
    "V4_ROBINHOOD_BACKEND_PROMOTION_ATTESTATION_PATH": "release/robinhood-chain-4663/v4.1/backend-promotion-input.attestation.json",
    "V4_ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH": "release/robinhood-chain-4663/v4.1/programmable-backend-authorization.attestation.json",
    "V4_ROBINHOOD_PROMOTION_ATTESTATION_PATH": "release/robinhood-chain-4663/v4.1/programmable-promotion-bundle.attestation.json",
    "V4_BACKEND_AUTHORIZATION_WORKFLOW": ".github/workflows/finalize-robinhood-custom-launch-v41-promotion.yml"
  }
};
const tools = createV4ReleaseBindingTools(RELEASE);
export const {
  V4_RELEASE_BINDING_SCHEMA,
  V4_RELEASE_BINDING_PATH,
  V4_BACKEND_AUTHORIZATION_SCHEMA,
  V4_BACKEND_AUTHORIZATION_WORKFLOW,
  V4_ROBINHOOD_STAGE_BUNDLE_PATH,
  V4_ROBINHOOD_PROMOTION_BUNDLE_PATH,
  V4_ROBINHOOD_LIVE_DEPLOYMENT_PATH,
  V4_ROBINHOOD_BACKEND_AUTHORIZATION_PATH,
  V4_ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH,
  V4_ROBINHOOD_CAPTURE_PATH,
  V4_ROBINHOOD_CAPTURE_ATTESTATION_PATH,
  V4_ROBINHOOD_STAGE_ATTESTATION_PATH,
  V4_ROBINHOOD_SOURCE_VERIFY_PROOF_PATH,
  V4_ROBINHOOD_SOURCE_VERIFY_ATTESTATION_PATH,
  V4_ROBINHOOD_SOURCE_VERIFY_COORDINATES_PATH,
  V4_ROBINHOOD_BACKEND_PROMOTION_ATTESTATION_PATH,
  V4_ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH,
  V4_ROBINHOOD_PROMOTION_ATTESTATION_PATH,
  V4_RELEASE_REQUIRED_SOURCE_PATHS,
  auditV4ReleaseBinding,
  requireV4ReleaseReady,
  verifyProtectedBackendAuthorization,
  auditV4ReleaseCommitChain,
  auditV4ReleaseBindingTransition,
  computeV4ChainDeploymentDescriptorDigest,
  computeV4ChainDeploymentBindingDigest,
  computeV4ProfileEvidenceDigest,
  computeV4ReleaseManifestDigest,
  computeV4SourceClosureDigest,
  computeV4FinalityEvidenceDigest,
  computeV4BackendReleaseEvidenceDigest,
  validateV4BackendReleaseEvidence,
  createV4ReleaseCandidate
} = tools;
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] === "create-inactive-candidate") {
    if (args.length !== 3 || args[1] !== "--repository-root") throw new Error("Exact repository root required");
    process.stdout.write(`${JSON.stringify(tools.createV4ReleaseCandidate({ repositoryRoot: args[2] }), null, 2)}\n`);
  } else process.stdout.write(`${JSON.stringify(tools.runCli(args))}\n`);
}
