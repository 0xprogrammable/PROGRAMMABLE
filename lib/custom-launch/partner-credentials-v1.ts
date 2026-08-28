/**
 * Exact public partner-credential discovery contract emitted by the Custom
 * Launch API V3 capabilities route. Keep the dynamic website discovery
 * byte-for-field aligned with this object. The release-bound OpenAPI carries
 * its own compatible, context-specific summary.
 */
export const PARTNER_CREDENTIALS_PUBLIC_CONTRACT_V1 = Object.freeze({
  schemaVersion: "programmable.partner-public-contract.v1" as const,
  status: "live" as const,
  environmentVariable: "PROGRAMMABLE_API_KEY" as const,
  credentialKinds: Object.freeze(["root", "subkey"] as const),
  canonicalV3LaunchRoutes: true as const,
  launchScopes: Object.freeze([
    "custom-launch:create",
    "custom-launch:read",
  ] as const),
  rootOnlyScope: "partner-subkeys:manage" as const,
  subkeyAdminRoutes: Object.freeze([
    "GET /v1/partner/subkeys",
    "POST /v1/partner/subkeys",
    "POST /v1/partner/subkeys/{subkeyId}/rotate",
    "DELETE /v1/partner/subkeys/{subkeyId}",
  ] as const),
  maximumSubkeyDepth: 1 as const,
  subkeyScopesAndBudgetsCannotExceedRoot: true as const,
  subkeyExpiryCannotExceedRoot: true as const,
  permitReissueDispositionCredentialKind: "wallet-only" as const,
  metadataPolicySameAsWalletKeys: true as const,
  controllerWallet: Object.freeze({
    walletKey: "must-equal-key-wallet-binding" as const,
    partnerCredential: "selected-by-exact-request" as const,
    mustReviewSignAndBroadcast: true as const,
  }),
  launchHistoryVisibility: Object.freeze({
    root: "all-partner-attributed-root-and-subkey-launches" as const,
    subkey: "stable-subkey-lineage-only" as const,
    rootAggregatesSubkeys: true as const,
    rotationPreservesLineageHistory: true as const,
    newDistinctSubkeyStartsIsolatedLineage: true as const,
    revokedCredentialCanAuthenticate: false as const,
  }),
  secretDelivery: "issue-and-rotation-response-only" as const,
  callerSuppliedAttributionAccepted: false as const,
  attributionSource: "authenticated-partner-api-key" as const,
  attributionIsVerificationOrSafetyClaim: false as const,
  walletSigningAuthority: false as const,
  walletBroadcastAuthority: false as const,
  gateBypassAuthority: false as const,
  adminProvisioning: Object.freeze({
    authentication: "website-bff-assertion-v2" as const,
    authorization: "server-configured-privy-user-wallet-pair-allowlist" as const,
    clientMaySelfAuthorize: false as const,
  }),
});
