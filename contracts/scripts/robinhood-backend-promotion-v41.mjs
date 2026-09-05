import { ROBINHOOD_PROFILE_V41 } from "../../packages/launch/src/profile-v41.mjs";
import * as binding from "../../scripts/programmable-launch-v41-release-binding.mjs";
import { createRobinhoodBackendPromotionTools } from "./robinhood-backend-promotion-v1.mjs";

// Filled only from the final backend source artifacts, never from predecessor evidence.
export const ROBINHOOD_V41_BACKEND_RELEASE_PINS = Object.freeze({
  migrationSha256: "sha256:68dc928cbfd27ca0a0172747c47d7f6de3e523334a3246e2be74ec855226b6f4",
  apiContractSha256: "sha256:b7eb27465ffd11baf97223069bba4db1fdaa1b6b13190841b0e402e8563af7d5",
  providerProfileDigest: "sha256:ea5b5884b2b09775da760f65ba998c4ab68319e8567fa1d05072943c4bf8eb16",
  captureWorkflow: ".github/workflows/capture-programmable-robinhood-v41-promotion.yml",
  captureWorkflowName: "Capture Programmable Robinhood v4.1 backend promotion",
});

export function requireRobinhoodV41BackendReleasePins(pins = ROBINHOOD_V41_BACKEND_RELEASE_PINS) {
  if (!/^sha256:(?!0{64}$)[0-9a-f]{64}$/u.test(pins.migrationSha256 ?? "")
    || !/^sha256:(?!0{64}$)[0-9a-f]{64}$/u.test(pins.apiContractSha256 ?? "")
    || !/^sha256:(?!0{64}$)[0-9a-f]{64}$/u.test(pins.providerProfileDigest ?? "")
    || !/^\.github\/workflows\/[a-z0-9-]+\.yml$/u.test(pins.captureWorkflow ?? "")
    || !/^[A-Za-z0-9 ._-]+$/u.test(pins.captureWorkflowName ?? "")) {
    throw new TypeError("Robinhood v4.1 backend release pins are pending; production promotion is unavailable");
  }
}

export function createRobinhoodV41BackendPromotionTools(pins = ROBINHOOD_V41_BACKEND_RELEASE_PINS) {
  const tools = createRobinhoodBackendPromotionTools({
    profile: ROBINHOOD_PROFILE_V41,
    ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW: binding.V4_BACKEND_AUTHORIZATION_WORKFLOW,
    ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH:
      "release/robinhood-chain-4663/v4.1/backend-promotion-input.json",
    ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH: binding.V4_ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH,
    ROBINHOOD_BACKEND_AUTHORIZATION_PATH: binding.V4_ROBINHOOD_BACKEND_AUTHORIZATION_PATH,
    ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH:
      binding.V4_ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH,
    ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH: binding.V4_ROBINHOOD_BACKEND_PROMOTION_ATTESTATION_PATH,
    ROBINHOOD_BACKEND_CAPTURE_WORKFLOW: pins.captureWorkflow,
    ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME: pins.captureWorkflowName,
    ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY: pins.captureWorkflow === null ? null
      : `https://github.com/programmablehq/programmable-open-hook-v2-internal/${pins.captureWorkflow}@refs/heads/main`,
    BACKEND_MIGRATION_PATH: "migrations/0029_activate_robinhood_fee_profile_v41.sql",
    BACKEND_MIGRATION_SHA256: pins.migrationSha256,
    BACKEND_API_CONTRACT_PATH: "release/custom-launch-api-contract.v4.1.json",
    BACKEND_API_CONTRACT_SHA256: pins.apiContractSha256,
    ROBINHOOD_PROVIDER_PROFILE_SHA256: pins.providerProfileDigest,
  });
  return Object.freeze(Object.fromEntries(Object.entries(tools).map(([name, value]) => [
    name, typeof value === "function" ? (...args) => {
      requireRobinhoodV41BackendReleasePins(pins);
      return value(...args);
    } : value,
  ])));
}

export const robinhoodV41BackendPromotionTools = createRobinhoodV41BackendPromotionTools();
