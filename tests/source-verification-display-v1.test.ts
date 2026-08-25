import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readSourceVerificationDisplayV1 } from
  "../lib/server/custom-launch/source-verification-display-v1";

const address = "0x1111111111111111111111111111111111111111";
const websiteToken = "website-token-that-is-long-enough-for-the-private-bridge";

function response(status: string, componentStatus = status) {
  return new Response(JSON.stringify({
    schemaVersion: "programmable.source-verification-status.v1",
    status,
    components: [{
      targetId: "token",
      address,
      status: componentStatus,
      provider: status === "exact_match" ? "sourcify" : null,
    }],
    updatedAt: "2026-08-25T06:00:00.000Z",
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function read(fetchBackend: typeof fetch) {
  return readSourceVerificationDisplayV1({
    address,
    backendBaseUrl: "https://api.programmable.market",
    websiteToken,
    fetchBackend,
  });
}

describe("public exact-source verification display", () => {
  it("shows verified only for a consistent server-authored exact match", async () => {
    const fetchBackend = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => response("exact_match"));
    await expect(read(fetchBackend as typeof fetch)).resolves.toEqual({
      schemaVersion: "programmable.source-verification-display.v1",
      status: "verified",
      label: "Source verified",
      updatedAt: "2026-08-25T06:00:00.000Z",
    });
    expect(fetchBackend).toHaveBeenCalledWith(
      new URL(
        `/v1/website/source-verifications/${address}`,
        "https://api.programmable.market",
      ),
      expect.objectContaining({
        method: "GET",
        redirect: "error",
      }),
    );
    const observedInit = fetchBackend.mock.calls[0]?.[1];
    expect(observedInit).toBeDefined();
    const authorization = observedInit!.headers as Record<string, string>;
    expect(authorization.Authorization).toBe(`Bearer ${websiteToken}`);
  });

  it("uses calm public states for retries, attention, and legacy absence", async () => {
    await expect(read((async () => response("retrying")) as typeof fetch))
      .resolves.toMatchObject({
        status: "in-progress",
        label: "Verification in progress",
      });
    await expect(read((async () => response("needs_attention")) as typeof fetch))
      .resolves.toMatchObject({
        status: "not-verified",
        label: "Source not verified",
      });
    await expect(read((async () => new Response(null, { status: 404 })) as typeof fetch))
      .resolves.toEqual({
        schemaVersion: "programmable.source-verification-display.v1",
        status: "not-verified",
        label: "Source not verified",
        updatedAt: null,
      });
  });

  it("never promotes an inconsistent component set", async () => {
    await expect(read((async () => response(
      "exact_match",
      "needs_attention",
    )) as typeof fetch)).rejects.toThrow("inconsistent");
  });
});
