const EXACT_PROVIDER_ROLES = Object.freeze([
  Object.freeze({ providerType: "envio_deployment", vendor: null }),
  Object.freeze({ providerType: "rpc_provider", vendor: "drpc" }),
  Object.freeze({ providerType: "rpc_provider", vendor: "quicknode" }),
  Object.freeze({ providerType: "uniswap_subgraph", vendor: null }),
]);

export function validateBootstrapProviderRoles(providers) {
  if (!Array.isArray(providers) || providers.length !== 4) {
    throw new Error("bootstrap provider set is incomplete");
  }
  const roles = providers.map(({ providerType, vendor = null }) => ({
    providerType,
    vendor,
  }));
  if (JSON.stringify(roles) !== JSON.stringify(EXACT_PROVIDER_ROLES)) {
    throw new Error("bootstrap provider order is not canonical");
  }
  const [, drpc, quicknode] = providers;
  if (
    drpc.chainId !== 1 ||
    quicknode.chainId !== 1 ||
    drpc.redactedIdentity !== "rpc:1:drpc" ||
    quicknode.redactedIdentity !== "rpc:1:quicknode" ||
    drpc.constructorVersion !== "rpc-provider-v1" ||
    quicknode.constructorVersion !== "rpc-provider-v1" ||
    drpc.endpointEvidenceDomain !== "rpc-endpoint-commitments-v1" ||
    quicknode.endpointEvidenceDomain !== "rpc-endpoint-commitments-v1"
  ) {
    throw new Error("bootstrap RPC provider roles are invalid");
  }
  return providers;
}
