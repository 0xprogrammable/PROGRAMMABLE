import { getAddress, keccak256, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as manifestGET } from
  "../app/api/custom-launch/registry/v1/manifest/route";
import {
  CUSTOM_REGISTRY_PUBLIC_ENVIRONMENT_KEYS_V1,
  createCustomRegistryManifestHandlerV1,
  createCustomRegistryReadinessHandlerV1,
  resolveCustomRegistryPublicManifestV1,
} from "../lib/server/custom-launch/registry-manifest-v1";
import {
  CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH,
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
} from "../lib/custom-launch/registry-public-manifest-v1";
import {
  createProgrammableWellKnownHandlerV1,
  PROGRAMMABLE_WELL_KNOWN_PATH,
} from "../lib/server/custom-launch/well-known-v1";

const NOW = new Date("2026-08-07T08:00:00.000Z");
const runtimeCodes = {
  registry: "0x6001600055",
  partnerFactoryRegistry: "0x6002600055",
  feePolicyVerifier: "0x6003600055",
  atomicRegistrar: "0x6004600055",
} as const satisfies Record<string, Hex>;

const configured = {
  PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED: "true",
  PROGRAMMABLE_CUSTOM_REGISTRY_GENERATION: "ethereum-mainnet-v1",
  PROGRAMMABLE_CUSTOM_REGISTRY_START_BLOCK: "23456789",
  PROGRAMMABLE_CUSTOM_REGISTRY_ADDRESS:
    "0x1234567890abcdef1234567890abcdef12345678",
  PROGRAMMABLE_CUSTOM_REGISTRY_RUNTIME_CODE_KECCAK256:
    keccak256(runtimeCodes.registry),
  PROGRAMMABLE_CUSTOM_PARTNER_FACTORY_REGISTRY_ADDRESS:
    "0x234567890abcdef1234567890abcdef123456789",
  PROGRAMMABLE_CUSTOM_PARTNER_FACTORY_REGISTRY_RUNTIME_CODE_KECCAK256:
    keccak256(runtimeCodes.partnerFactoryRegistry),
  PROGRAMMABLE_CUSTOM_FEE_POLICY_VERIFIER_ADDRESS:
    "0x34567890abcdef1234567890abcdef1234567890",
  PROGRAMMABLE_CUSTOM_FEE_POLICY_VERIFIER_RUNTIME_CODE_KECCAK256:
    keccak256(runtimeCodes.feePolicyVerifier),
  PROGRAMMABLE_CUSTOM_ATOMIC_REGISTRAR_ADDRESS:
    "0x4567890abcdef1234567890abcdef12345678901",
  PROGRAMMABLE_CUSTOM_ATOMIC_REGISTRAR_RUNTIME_CODE_KECCAK256:
    keccak256(runtimeCodes.atomicRegistrar),
  PROGRAMMABLE_CUSTOM_REGISTRY_ABI_IDENTIFIER:
    "programmable.custom-registry.v1.abi",
  PROGRAMMABLE_CUSTOM_REGISTRY_ABI_URL:
    "https://developers.programmable.family/abis/ethereum/programmable-custom-registry-v1.json",
  PROGRAMMABLE_CUSTOM_REGISTRY_EVENT_SET_IDENTIFIER:
    "programmable.custom-registry.v1.events",
  PROGRAMMABLE_CUSTOM_REGISTRY_EVENT_SET_URL:
    "https://developers.programmable.family/event-sets/ethereum/programmable-custom-registry-v1.json",
  PROGRAMMABLE_CUSTOM_REGISTRY_HASH_SPEC_IDENTIFIER:
    "programmable.custom-registry.v1.hash-spec",
  PROGRAMMABLE_CUSTOM_REGISTRY_HASH_SPEC_URL:
    "https://developers.programmable.family/specifications/programmable-custom-registry-hashes-v1.json",
} as const;

function request(
  path = CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH,
  init: RequestInit = {},
): Request {
  return new Request(`https://programmable.family${path}`, {
    headers: { accept: "application/json" },
    ...init,
  });
}

function rpcResponse(codes: Readonly<Record<keyof typeof runtimeCodes, Hex>> = runtimeCodes): Response {
  return Response.json([
    { jsonrpc: "2.0", id: 1, result: "0x1" },
    { jsonrpc: "2.0", id: 2, result: codes.registry },
    { jsonrpc: "2.0", id: 3, result: codes.partnerFactoryRegistry },
    { jsonrpc: "2.0", id: 4, result: codes.feePolicyVerifier },
    { jsonrpc: "2.0", id: 5, result: codes.atomicRegistrar },
  ]);
}

describe("Custom Registry V1 public manifest", () => {
  it("publishes the local/default state honestly as prelaunch with null bindings", () => {
    expect(resolveCustomRegistryPublicManifestV1({})).toEqual(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );
    expect(resolveCustomRegistryPublicManifestV1({})).toMatchObject({
      status: "prelaunch",
      chainId: "1",
      publicSubmissionsEnabled: false,
      generation: null,
      startBlock: null,
      contracts: {
        registry: { address: null, runtimeCodeKeccak256: null },
        partnerFactoryRegistry: { address: null, runtimeCodeKeccak256: null },
        feePolicyVerifier: { address: null, runtimeCodeKeccak256: null },
        atomicRegistrar: { address: null, runtimeCodeKeccak256: null },
      },
    });
  });

  it("publishes live only when every Ethereum deployment and specification pin is complete", () => {
    expect(resolveCustomRegistryPublicManifestV1(configured)).toEqual({
      schemaVersion: "programmable.custom-registry-public-manifest.v1",
      status: "live",
      chainId: "1",
      caip2: "eip155:1",
      publicSubmissionsEnabled: false,
      generation: "ethereum-mainnet-v1",
      startBlock: "23456789",
      contracts: {
        registry: {
          address: getAddress(configured.PROGRAMMABLE_CUSTOM_REGISTRY_ADDRESS),
          runtimeCodeKeccak256:
            configured.PROGRAMMABLE_CUSTOM_REGISTRY_RUNTIME_CODE_KECCAK256,
        },
        partnerFactoryRegistry: {
          address: getAddress(
            configured.PROGRAMMABLE_CUSTOM_PARTNER_FACTORY_REGISTRY_ADDRESS,
          ),
          runtimeCodeKeccak256:
            configured.PROGRAMMABLE_CUSTOM_PARTNER_FACTORY_REGISTRY_RUNTIME_CODE_KECCAK256,
        },
        feePolicyVerifier: {
          address: getAddress(
            configured.PROGRAMMABLE_CUSTOM_FEE_POLICY_VERIFIER_ADDRESS,
          ),
          runtimeCodeKeccak256:
            configured.PROGRAMMABLE_CUSTOM_FEE_POLICY_VERIFIER_RUNTIME_CODE_KECCAK256,
        },
        atomicRegistrar: {
          address: getAddress(
            configured.PROGRAMMABLE_CUSTOM_ATOMIC_REGISTRAR_ADDRESS,
          ),
          runtimeCodeKeccak256:
            configured.PROGRAMMABLE_CUSTOM_ATOMIC_REGISTRAR_RUNTIME_CODE_KECCAK256,
        },
      },
      specifications: {
        abi: {
          identifier: configured.PROGRAMMABLE_CUSTOM_REGISTRY_ABI_IDENTIFIER,
          url: configured.PROGRAMMABLE_CUSTOM_REGISTRY_ABI_URL,
        },
        eventSet: {
          identifier:
            configured.PROGRAMMABLE_CUSTOM_REGISTRY_EVENT_SET_IDENTIFIER,
          url: configured.PROGRAMMABLE_CUSTOM_REGISTRY_EVENT_SET_URL,
        },
        hashSpec: {
          identifier:
            configured.PROGRAMMABLE_CUSTOM_REGISTRY_HASH_SPEC_IDENTIFIER,
          url: configured.PROGRAMMABLE_CUSTOM_REGISTRY_HASH_SPEC_URL,
        },
      },
    });
  });

  it("collapses missing, malformed and placeholder pins to one null prelaunch manifest", () => {
    const invalidEnvironments = [
      { ...configured, PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED: "false" },
      { ...configured, PROGRAMMABLE_CUSTOM_REGISTRY_START_BLOCK: undefined },
      { ...configured, PROGRAMMABLE_CUSTOM_REGISTRY_START_BLOCK: "023456789" },
      { ...configured, PROGRAMMABLE_CUSTOM_REGISTRY_GENERATION: "placeholder" },
      {
        ...configured,
        PROGRAMMABLE_CUSTOM_REGISTRY_ADDRESS:
          "0x0000000000000000000000000000000000000000",
      },
      {
        ...configured,
        PROGRAMMABLE_CUSTOM_REGISTRY_ADDRESS:
          configured.PROGRAMMABLE_CUSTOM_ATOMIC_REGISTRAR_ADDRESS,
      },
      {
        ...configured,
        PROGRAMMABLE_CUSTOM_REGISTRY_RUNTIME_CODE_KECCAK256:
          `0x${"1".repeat(64)}`,
      },
      {
        ...configured,
        PROGRAMMABLE_CUSTOM_REGISTRY_ABI_URL:
          "https://example.com/registry.json",
      },
      {
        ...configured,
        PROGRAMMABLE_CUSTOM_REGISTRY_EVENT_SET_URL:
          "http://developers.programmable.family/events.json",
      },
      {
        ...configured,
        PROGRAMMABLE_CUSTOM_REGISTRY_HASH_SPEC_IDENTIFIER: "TBD",
      },
    ];
    for (const environment of invalidEnvironments) {
      expect(resolveCustomRegistryPublicManifestV1(environment)).toBe(
        PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
      );
    }
  });

  it("serves the public JSON route and rejects query-bearing requests", async () => {
    const handler = createCustomRegistryManifestHandlerV1(configured);
    const response = handler(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    await expect(response.json()).resolves.toMatchObject({
      status: "live",
      chainId: "1",
      generation: "ethereum-mainnet-v1",
    });

    const invalid = handler(request(`${CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH}?candidate=1`));
    expect(invalid.status).toBe(400);
  });

  it("keeps Well-known and the live Registry manifest on the same deployment", async () => {
    const manifestHandler = createCustomRegistryManifestHandlerV1(configured);
    const wellKnownHandler = createProgrammableWellKnownHandlerV1(configured);
    const manifest = await manifestHandler(request()).json();
    const response = wellKnownHandler(request(PROGRAMMABLE_WELL_KNOWN_PATH));
    const wellKnown = await response.json();

    expect(response.status).toBe(200);
    expect(wellKnown.publicCategories.custom).toMatchObject({
      discoveryStatus: "live",
      publicSubmissionStatus: "prelaunch",
      registryAddress: manifest.contracts.registry.address.toLowerCase(),
      registryStartBlock: manifest.startBlock,
      registryGeneration: "1",
    });
  });

  it("keeps the production route prelaunch/null when deployment env is absent", async () => {
    const previous = new Map(CUSTOM_REGISTRY_PUBLIC_ENVIRONMENT_KEYS_V1.map(
      (key) => [key, process.env[key]],
    ));
    try {
      for (const key of CUSTOM_REGISTRY_PUBLIC_ENVIRONMENT_KEYS_V1) {
        delete process.env[key];
      }
      const response = manifestGET(request());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(
        PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
      );
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("Custom Registry V1 readiness", () => {
  it("reports ready for a complete manifest without requiring optional RPC verification", async () => {
    const rpcFetch = vi.fn<typeof fetch>();
    const handler = createCustomRegistryReadinessHandlerV1({
      environment: configured,
      rpcFetch,
      now: () => NOW,
    });
    const response = await handler(request(
      "/api/custom-launch/registry/v1/readiness",
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: "programmable.custom-registry-readiness.v1",
      status: "ready",
      registryStatus: "live",
      chainId: "1",
      generation: "ethereum-mainnet-v1",
      manifestPath: CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH,
      runtimeBindings: "not-configured",
      checkedAt: NOW.toISOString(),
    });
    expect(rpcFetch).not.toHaveBeenCalled();
  });

  it("verifies chain and all four runtime bindings when the read-only RPC is configured", async () => {
    const rpcFetch = vi.fn<typeof fetch>().mockResolvedValue(rpcResponse());
    const handler = createCustomRegistryReadinessHandlerV1({
      environment: {
        ...configured,
        PROGRAMMABLE_CUSTOM_REGISTRY_READINESS_RPC_URL:
          "https://eth-mainnet.g.alchemy.com/v2/credential",
      },
      rpcFetch,
      now: () => NOW,
    });
    const response = await handler(request(
      "/api/custom-launch/registry/v1/readiness",
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      registryStatus: "live",
      runtimeBindings: "verified",
    });
    const init = rpcFetch.mock.calls[0]?.[1];
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(JSON.parse(String(init?.body))).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "eth_chainId" }),
      expect.objectContaining({ method: "eth_getCode" }),
    ]));
  });

  it("accepts the complete deployed-runtime batch when it exceeds 64 KiB", async () => {
    const deployedSizeCodes = {
      registry: `0x${"60".repeat(21_760)}`,
      partnerFactoryRegistry: `0x${"61".repeat(9_314)}`,
      feePolicyVerifier: `0x${"62".repeat(4_001)}`,
      atomicRegistrar: `0x${"63".repeat(3_717)}`,
    } as const satisfies Record<string, Hex>;
    const body = JSON.stringify([
      { jsonrpc: "2.0", id: 1, result: "0x1" },
      { jsonrpc: "2.0", id: 2, result: deployedSizeCodes.registry },
      { jsonrpc: "2.0", id: 3, result: deployedSizeCodes.partnerFactoryRegistry },
      { jsonrpc: "2.0", id: 4, result: deployedSizeCodes.feePolicyVerifier },
      { jsonrpc: "2.0", id: 5, result: deployedSizeCodes.atomicRegistrar },
    ]);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(65_536);

    const handler = createCustomRegistryReadinessHandlerV1({
      environment: {
        ...configured,
        PROGRAMMABLE_CUSTOM_REGISTRY_RUNTIME_CODE_KECCAK256:
          keccak256(deployedSizeCodes.registry),
        PROGRAMMABLE_CUSTOM_PARTNER_FACTORY_REGISTRY_RUNTIME_CODE_KECCAK256:
          keccak256(deployedSizeCodes.partnerFactoryRegistry),
        PROGRAMMABLE_CUSTOM_FEE_POLICY_VERIFIER_RUNTIME_CODE_KECCAK256:
          keccak256(deployedSizeCodes.feePolicyVerifier),
        PROGRAMMABLE_CUSTOM_ATOMIC_REGISTRAR_RUNTIME_CODE_KECCAK256:
          keccak256(deployedSizeCodes.atomicRegistrar),
        PROGRAMMABLE_CUSTOM_REGISTRY_READINESS_RPC_URL:
          "https://eth-mainnet.public.blastapi.io",
      },
      rpcFetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
      now: () => NOW,
    });

    const response = await handler(request(
      "/api/custom-launch/registry/v1/readiness",
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      runtimeBindings: "verified",
    });
  });

  it("fails readiness on prelaunch, malformed RPC or a runtime mismatch", async () => {
    const prelaunch = createCustomRegistryReadinessHandlerV1({
      environment: {},
      rpcFetch: vi.fn<typeof fetch>(),
      now: () => NOW,
    });
    expect((await prelaunch(request(
      "/api/custom-launch/registry/v1/readiness",
    ))).status).toBe(503);

    const malformedRpc = createCustomRegistryReadinessHandlerV1({
      environment: {
        ...configured,
        PROGRAMMABLE_CUSTOM_REGISTRY_READINESS_RPC_URL: "http://localhost:8545",
      },
      rpcFetch: vi.fn<typeof fetch>(),
      now: () => NOW,
    });
    expect((await malformedRpc(request(
      "/api/custom-launch/registry/v1/readiness",
    ))).status).toBe(503);

    const mismatch = createCustomRegistryReadinessHandlerV1({
      environment: {
        ...configured,
        PROGRAMMABLE_CUSTOM_REGISTRY_READINESS_RPC_URL:
          "https://eth-mainnet.g.alchemy.com/v2/credential",
      },
      rpcFetch: vi.fn<typeof fetch>().mockResolvedValue(rpcResponse({
        ...runtimeCodes,
        atomicRegistrar: "0x6005600055",
      })),
      now: () => NOW,
    });
    const response = await mismatch(request(
      "/api/custom-launch/registry/v1/readiness",
    ));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unready",
      registryStatus: "live",
      code: "custom_registry_not_ready",
      runtimeBindings: "not-run",
    });
  });
});
