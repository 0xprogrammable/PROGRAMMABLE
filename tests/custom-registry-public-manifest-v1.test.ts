import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createCustomRegistryManifestHandlerV1,
  createCustomRegistryReadinessHandlerV1,
  resolveCustomRegistryPublicManifestV1,
} from "../lib/server/custom-launch/registry-manifest-v1";
import {
  CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH,
  CUSTOM_REGISTRY_PUBLIC_READINESS_PATH,
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
} from "../lib/custom-launch/registry-public-manifest-v1";

const environmentThatPreviouslyPublishedV1 = Object.freeze({
  PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED: "true",
  PROGRAMMABLE_CUSTOM_REGISTRY_GENERATION: "ethereum-mainnet-v1",
  PROGRAMMABLE_CUSTOM_REGISTRY_START_BLOCK: "23456789",
  PROGRAMMABLE_CUSTOM_REGISTRY_ADDRESS:
    "0x1234567890abcdef1234567890abcdef12345678",
});

function request(path: string): Request {
  return new Request(`https://programmable.family${path}`, {
    headers: { accept: "application/json" },
  });
}

describe("retired Custom Registry V1 public surface", () => {
  it("always publishes prelaunch with null bindings", () => {
    expect(resolveCustomRegistryPublicManifestV1({})).toEqual(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );
    expect(resolveCustomRegistryPublicManifestV1(
      environmentThatPreviouslyPublishedV1,
    )).toEqual(PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1);
  });

  it("serves only the prelaunch manifest even when stale live env remains", async () => {
    const response = createCustomRegistryManifestHandlerV1(
      environmentThatPreviouslyPublishedV1,
    )(request(CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );
  });

  it("fails readiness closed before any RPC request", async () => {
    const rpcFetch = vi.fn<typeof fetch>();
    const response = await createCustomRegistryReadinessHandlerV1({
      environment: {
        ...environmentThatPreviouslyPublishedV1,
        PROGRAMMABLE_CUSTOM_REGISTRY_READINESS_RPC_URL:
          "https://rpc.invalid/should-not-run",
      },
      rpcFetch,
      now: () => new Date("2026-08-13T12:00:00.000Z"),
    })(request(CUSTOM_REGISTRY_PUBLIC_READINESS_PATH));
    expect(response.status).toBe(503);
    expect(rpcFetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      status: "unready",
      registryStatus: "prelaunch",
      code: "custom_registry_prelaunch",
      runtimeBindings: "not-run",
    });
  });

  it("rejects query-bearing manifest requests", async () => {
    const response = createCustomRegistryManifestHandlerV1({})(
      request(`${CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH}?unsafe=1`),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      code: "invalid_manifest_request",
    });
  });
});
