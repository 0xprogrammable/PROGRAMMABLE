import {
  API_ORIGIN,
  CAPABILITIES_PATH_V3,
  CREATE_PATH_V3,
  DIRECT_NATIVE_PROFILE_ID,
  DIRECT_NATIVE_PROFILE_REVISION,
  DIRECT_NATIVE_PROFILE_VERSION,
  PREFLIGHT_PATH_V3,
  WALLET_HANDOFF_BASE_URL,
} from "../../src/constants.mjs";

export function validCapabilities(overrides = {}) {
  return {
    schemaVersion: "programmable.custom-launch-capabilities.v1",
    apiVersion: "v3",
    serverTime: "2026-08-26T18:00:00.000Z",
    readinessUrl: `${API_ORIGIN}/readyz`,
    chain: { id: "1", name: "Ethereum Mainnet" },
    profile: {
      profileId: DIRECT_NATIVE_PROFILE_ID,
      profileRevision: DIRECT_NATIVE_PROFILE_REVISION,
      profileVersion: DIRECT_NATIVE_PROFILE_VERSION,
      productionLaunchAuthorized: true,
    },
    routes: {
      create: CREATE_PATH_V3,
      preflight: PREFLIGHT_PATH_V3,
      status: `${CREATE_PATH_V3}/{launchId}`,
      list: CREATE_PATH_V3,
      finalizedMetadata: "/v3/finalized-custom-launches",
      capabilities: CAPABILITIES_PATH_V3,
    },
    authentication: {
      create: "bearer-api-key",
      preflight: "bearer-api-key",
      status: "bearer-api-key",
      finalizedMetadata: "none",
      capabilities: "none",
      requiredScopes: ["custom-launch:create", "custom-launch:read"],
      apiKeyIsWallet: false,
    },
    preflight: {
      quotaConsumed: false,
      nonceAllocated: false,
      persisted: false,
      walletSignatureProduced: false,
      transactionBroadcast: false,
      exactProductionAdmissionEngine: true,
    },
    walletHandoffBaseUrl: WALLET_HANDOFF_BASE_URL,
    ...overrides,
  };
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
