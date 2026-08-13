import assert from "node:assert/strict";
import test from "node:test";

import { validateBootstrapProviderRoles } from "./bootstrap-provider-roles.mjs";

function providers() {
  return [
    { providerType: "envio_deployment", redactedIdentity: "envio:reviewed" },
    {
      providerType: "rpc_provider",
      vendor: "drpc",
      chainId: 1,
      redactedIdentity: "rpc:1:drpc",
      constructorVersion: "rpc-provider-v1",
      endpointEvidenceDomain: "rpc-endpoint-commitments-v1",
    },
    {
      providerType: "rpc_provider",
      vendor: "quicknode",
      chainId: 1,
      redactedIdentity: "rpc:1:quicknode",
      constructorVersion: "rpc-provider-v1",
      endpointEvidenceDomain: "rpc-endpoint-commitments-v1",
    },
    { providerType: "uniswap_subgraph", redactedIdentity: "uniswap-v4:ethereum" },
  ];
}

test("accepts only the ordered private dRPC and QuickNode bootstrap roles", () => {
  const exact = providers();
  assert.equal(validateBootstrapProviderRoles(exact), exact);
});

test("rejects legacy Alchemy, reordered, foreign-chain and weak evidence roles", () => {
  const mutations = [
    (value) => {
      value[1].vendor = "alchemy";
      value[1].redactedIdentity = "rpc:1:alchemy";
    },
    (value) => {
      [value[1], value[2]] = [value[2], value[1]];
    },
    (value) => {
      value[2].chainId = 8453;
    },
    (value) => {
      value[1].constructorVersion = "rpc-provider-v0";
    },
    (value) => {
      value[2].endpointEvidenceDomain = "unbound";
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(providers());
    mutate(changed);
    assert.throws(() => validateBootstrapProviderRoles(changed), /bootstrap/u);
  }
});
