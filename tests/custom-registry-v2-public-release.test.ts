import { describe, expect, it, vi } from "vitest";
import { keccak256, toFunctionSelector } from "viem";

vi.mock("server-only", () => ({}));

import {
  CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH_V2,
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V2,
} from "../lib/custom-launch/registry-public-manifest-v2";
import {
  createCustomRegistryManifestHandlerV2,
  createCustomRegistryReadinessHandlerV2,
  handleProductionCustomRegistryManifestV2,
  resolveCustomRegistryPublicManifestV2,
} from "../lib/server/custom-launch/registry-manifest-v2";

const runtimeCode = "0x6000" as const;
const address = `0x${"12".repeat(20)}` as const;
const transactionHash = `0x${"34".repeat(32)}` as const;
const blockHash = `0x${"56".repeat(32)}` as const;
const policyBindingHash = `0x${"78".repeat(32)}` as const;
const now = () => new Date("2026-08-13T00:00:00.000Z");

function prelaunchSource() {
  return {
    schemaVersion: "programmable.custom-registry-v2-deployment.v1",
    status: "prelaunch",
    generation: "2",
    chainId: "1",
    caip2: "eip155:1",
    publicReadEnabled: false,
    indexingEnabled: false,
    registry: {
      address: null,
      runtimeCodeKeccak256: null,
      deploymentTransactionHash: null,
      deploymentBlock: null,
      deploymentBlockHash: null,
    },
    release: {
      sourceCommit: null,
      sourceTree: null,
      sourceArtifactSha256: null,
      abiArtifactSha256: null,
      eventSetSha256: null,
    },
    finality: {
      minimumConfirmations: null,
      policyBindingHash: null,
    },
    profiles: {
      descriptorFieldsRemainOpaqueToWebsiteReadiness: true,
    },
  };
}

function liveSource() {
  return {
    ...prelaunchSource(),
    status: "live",
    publicReadEnabled: true,
    indexingEnabled: true,
    registry: {
      address,
      runtimeCodeKeccak256: keccak256(runtimeCode),
      deploymentTransactionHash: transactionHash,
      deploymentBlock: "100",
      deploymentBlockHash: blockHash,
    },
    release: {
      sourceCommit: "a".repeat(40),
      sourceTree: "b".repeat(40),
      sourceArtifactSha256: `sha256:${"c".repeat(64)}`,
      abiArtifactSha256: `sha256:${"d".repeat(64)}`,
      eventSetSha256: `sha256:${"e".repeat(64)}`,
    },
    finality: {
      minimumConfirmations: "12",
      policyBindingHash,
    },
  };
}

function request(path: string) {
  return new Request(`https://programmable.market${path}`, {
    headers: { accept: "application/json" },
  });
}

function rpcResponse(input?: Readonly<{
  code?: string;
  head?: string;
  contractAddress?: string;
}>) {
  return new Response(JSON.stringify([
    { jsonrpc: "2.0", id: 1, result: "0x1" },
    { jsonrpc: "2.0", id: 2, result: input?.code ?? runtimeCode },
    {
      jsonrpc: "2.0",
      id: 3,
      result: {
        status: "0x1",
        contractAddress: input?.contractAddress ?? address,
        transactionHash,
        blockHash,
        blockNumber: "0x64",
      },
    },
    {
      jsonrpc: "2.0",
      id: 4,
      result: { hash: blockHash, number: "0x64" },
    },
    { jsonrpc: "2.0", id: 5, result: input?.head ?? "0x70" },
    { jsonrpc: "2.0", id: 6, result: policyBindingHash },
    { jsonrpc: "2.0", id: 7, result: `0x${"0".repeat(63)}c` },
    { jsonrpc: "2.0", id: 8, result: `0x${"0".repeat(63)}2` },
  ]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Custom Registry V2 public release binding", () => {
  it("publishes the exact null prelaunch identity without profile semantics", () => {
    expect(resolveCustomRegistryPublicManifestV2(prelaunchSource())).toEqual(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V2,
    );
    expect(resolveCustomRegistryPublicManifestV2(prelaunchSource()))
      .not.toHaveProperty("profiles");
  });

  it("rejects partial activation and unknown deployment fields", () => {
    expect(() => resolveCustomRegistryPublicManifestV2({
      ...prelaunchSource(),
      publicReadEnabled: true,
    })).toThrow(/prelaunch binding/u);
    expect(() => resolveCustomRegistryPublicManifestV2({
      ...liveSource(),
      registry: { ...liveSource().registry, runtimeCodeKeccak256: null },
    })).toThrow(/registry runtime/u);
    expect(() => resolveCustomRegistryPublicManifestV2({
      ...liveSource(),
      surprise: true,
    })).toThrow(/keys/u);
  });

  it("maps only exact finalized deployment and artifact bindings to live", () => {
    expect(resolveCustomRegistryPublicManifestV2(liveSource())).toEqual({
      schemaVersion: "programmable.custom-registry-public-manifest.v2",
      status: "live",
      generation: "2",
      chainId: "1",
      caip2: "eip155:1",
      publicReadEnabled: true,
      indexingEnabled: true,
      registry: liveSource().registry,
      release: liveSource().release,
      finality: liveSource().finality,
    });
  });

  it("serves the imported finalized deployment as the canonical live manifest", async () => {
    const manifest = resolveCustomRegistryPublicManifestV2();
    expect(manifest).toMatchObject({
      status: "live",
      publicReadEnabled: true,
      indexingEnabled: true,
      registry: {
        address: "0x845506084a1afb969fa4def444a2bdeee794aaad",
      },
    });
    const response = handleProductionCustomRegistryManifestV2(
      request(CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH_V2),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(manifest);
  });

  it("serves an explicit prelaunch manifest and rejects malformed requests", async () => {
    const handler = createCustomRegistryManifestHandlerV2(prelaunchSource());
    const response = handler(request(CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH_V2));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V2);

    const invalid = handler(new Request(
      `https://programmable.market${CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH_V2}?drift=1`,
      { headers: { accept: "application/json" } },
    ));
    expect(invalid.status).toBe(400);
  });

  it("keeps readiness closed before the Registry deployment is live", async () => {
    const rpcFetch = vi.fn<typeof fetch>();
    const handler = createCustomRegistryReadinessHandlerV2({
      deploymentSource: prelaunchSource(),
      rpcUrls: () => [new URL("https://primary.invalid"), new URL("https://secondary.invalid")],
      rpcFetch,
      now,
    });
    const response = await handler(request("/api/custom-launch/registry/v2/readiness"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unready",
      registryStatus: "prelaunch",
      runtimeBindings: "not-run",
      providerQuorum: "not-run",
    });
    expect(rpcFetch).not.toHaveBeenCalled();
  });

  it("requires exact deployment, runtime and finality evidence from both providers", async () => {
    const rpcFetch = vi.fn<typeof fetch>().mockImplementation(async () => rpcResponse());
    const handler = createCustomRegistryReadinessHandlerV2({
      deploymentSource: liveSource(),
      rpcUrls: () => [new URL("https://primary.invalid"), new URL("https://secondary.invalid")],
      rpcFetch,
      now,
    });
    const response = await handler(request("/api/custom-launch/registry/v2/readiness"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: "programmable.custom-registry-readiness.v2",
      status: "ready",
      registryStatus: "live",
      generation: "2",
      chainId: "1",
      manifestPath: CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH_V2,
      runtimeBindings: "verified",
      providerQuorum: "verified",
      checkedAt: now().toISOString(),
    });
    expect(rpcFetch).toHaveBeenCalledTimes(2);
    for (const [, requestInit] of rpcFetch.mock.calls) {
      const calls = JSON.parse(String(requestInit?.body));
      expect(calls.map((call: { method: string }) => call.method)).toEqual([
        "eth_chainId",
        "eth_getCode",
        "eth_getTransactionReceipt",
        "eth_getBlockByNumber",
        "eth_blockNumber",
        "eth_call",
        "eth_call",
        "eth_call",
      ]);
      expect(calls.slice(5).map((call: { params: [{ data: string }] }) =>
        call.params[0].data)).toEqual([
        toFunctionSelector("REGISTRY_POLICY_COMMITMENT()"),
        toFunctionSelector("MINIMUM_FINALITY_BLOCKS()"),
        toFunctionSelector("REGISTRY_GENERATION()"),
      ]);
    }
  });

  it.each([
    ["runtime drift", { code: "0x6001" }],
    ["receipt drift", { contractAddress: `0x${"99".repeat(20)}` }],
    ["insufficient finality", { head: "0x6f" }],
  ])("fails closed on one provider %s", async (_label, mutation) => {
    let call = 0;
    const rpcFetch = vi.fn<typeof fetch>().mockImplementation(async () => {
      call += 1;
      return call === 1 ? rpcResponse() : rpcResponse(mutation);
    });
    const handler = createCustomRegistryReadinessHandlerV2({
      deploymentSource: liveSource(),
      rpcUrls: () => [new URL("https://primary.invalid"), new URL("https://secondary.invalid")],
      rpcFetch,
      now,
    });
    const response = await handler(request("/api/custom-launch/registry/v2/readiness"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unready",
      code: "custom_registry_not_ready",
      runtimeBindings: "not-run",
      providerQuorum: "not-run",
    });
  });
});
