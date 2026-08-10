import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createManualRouterWebsiteAuthorityDispatchV2,
  type ManualRouterWebsiteAuthorityV2,
} from "../lib/server/custom-launch/manual-router-authority-v2";
import type {
  ManualRouterWebsiteAuthorityV1,
} from "../lib/server/custom-launch/manual-router-service-v1";

const V1_ARTIFACT = Object.freeze({
  schemaVersion: "programmable.manual-router-complete-signed-artifact.v1",
});
const V2_ARTIFACT = Object.freeze({
  schemaVersion: "programmable.manual-router-complete-signed-artifact.v2",
});

describe("manual Router production authority version dispatch", () => {
  it("keeps every V1 operation on the existing authority", async () => {
    const { authority: v1, calls: v1Calls } = fakeAuthority("v1");
    const { authority: v2, calls: v2Calls } = fakeAuthority("v2");
    const loadV2 = vi.fn(() => v2 as ManualRouterWebsiteAuthorityV2);
    const dispatch = createManualRouterWebsiteAuthorityDispatchV2({
      v1,
      loadV2,
    });

    expect(dispatch.assertCompleteSignedArtifact(V1_ARTIFACT))
      .toBe(V1_ARTIFACT);
    await dispatch.verifySignedPublish(verificationInput(V1_ARTIFACT));
    await dispatch.observeExactTransaction({
      artifact: V1_ARTIFACT,
    } as never);
    await dispatch.resolveReissueState({
      request: { previousSignedArtifact: V1_ARTIFACT },
    } as never);
    await dispatch.readChainClock();

    expect(v1Calls).toEqual([
      "assert", "publish", "transaction", "reissue", "clock",
    ]);
    expect(v2Calls).toEqual([]);
    expect(loadV2).not.toHaveBeenCalled();
  });

  it("routes every V2 operation to the portable facade without V1 fallback", async () => {
    const { authority: v1, calls: v1Calls } = fakeAuthority("v1");
    const { authority: v2, calls: v2Calls } = fakeAuthority("v2");
    const loadV2 = vi.fn(() => v2 as ManualRouterWebsiteAuthorityV2);
    const dispatch = createManualRouterWebsiteAuthorityDispatchV2({
      v1,
      loadV2,
    });

    expect(dispatch.assertCompleteSignedArtifact(V2_ARTIFACT))
      .toBe(V2_ARTIFACT);
    await dispatch.verifySignedPublish(verificationInput(V2_ARTIFACT));
    await dispatch.observeExactTransaction({
      artifact: V2_ARTIFACT,
    } as never);
    await dispatch.resolveReissueState({
      request: { previousSignedArtifact: V2_ARTIFACT },
    } as never);
    await dispatch.assertV2AcceptanceCurrent?.({} as never);
    await dispatch.assertV2ReadyCurrentness?.({} as never);

    expect(v1Calls).toEqual([]);
    expect(v2Calls).toEqual([
      "assert", "publish", "transaction", "reissue", "acceptance",
      "currentness",
    ]);
    expect(loadV2).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown schemas before either authority can inspect them", async () => {
    const { authority: v1, calls: v1Calls } = fakeAuthority("v1");
    const { authority: v2, calls: v2Calls } = fakeAuthority("v2");
    const loadV2 = vi.fn(() => v2 as ManualRouterWebsiteAuthorityV2);
    const dispatch = createManualRouterWebsiteAuthorityDispatchV2({
      v1,
      loadV2,
    });
    const unknown = { schemaVersion: "programmable.unknown.v99" };

    expect(() => dispatch.assertCompleteSignedArtifact(unknown))
      .toThrow("schema is unsupported");
    await expect(dispatch.verifySignedPublish(verificationInput(unknown)))
      .rejects.toThrow("schema is unsupported");
    await expect(dispatch.observeExactTransaction({
      artifact: unknown,
    } as never)).rejects.toThrow("schema is unsupported");
    await expect(dispatch.resolveReissueState({
      request: { previousSignedArtifact: unknown },
    } as never)).rejects.toThrow("schema is unsupported");

    expect(v1Calls).toEqual([]);
    expect(v2Calls).toEqual([]);
    expect(loadV2).not.toHaveBeenCalled();
  });

  it("does not fall back to V1 when the V2 facade is unavailable", async () => {
    const { authority: v1, calls: v1Calls } = fakeAuthority("v1");
    const dispatch = createManualRouterWebsiteAuthorityDispatchV2({
      v1,
      loadV2() {
        throw new TypeError("portable V2 facade unavailable");
      },
    });

    expect(() => dispatch.assertCompleteSignedArtifact(V2_ARTIFACT))
      .toThrow("portable V2 facade unavailable");
    await expect(dispatch.verifySignedPublish(verificationInput(V2_ARTIFACT)))
      .rejects.toThrow("portable V2 facade unavailable");
    expect(v1Calls).toEqual([]);
  });
});

function fakeAuthority(label: "v1" | "v2") {
  const calls: string[] = [];
  const authority = {
    assertCompleteSignedArtifact(raw: unknown) {
      calls.push("assert");
      return raw;
    },
    async verifySignedPublish() {
      calls.push("publish");
      return {};
    },
    async readChainClock() {
      calls.push("clock");
      return {
        minimumTimestamp: "1",
        maximumTimestamp: "1",
        commonFinalizedTimestamp: "1",
        commonFinalizedBlockNumber: "1",
        commonFinalizedBlockHash: `0x${"11".repeat(32)}`,
      };
    },
    async assertV2AcceptanceCurrent() {
      calls.push("acceptance");
    },
    async assertV2ReadyCurrentness() {
      calls.push("currentness");
      return {};
    },
    async observeExactTransaction() {
      calls.push("transaction");
    },
    async resolveReissueState() {
      calls.push("reissue");
      return {};
    },
  };
  return {
    authority: authority as unknown as ManualRouterWebsiteAuthorityV1,
    calls,
    label,
  };
}

function verificationInput(signedArtifact: unknown) {
  return {
    request: { signedArtifact },
    currentApplicantIndex: null,
    currentApplicantPointers: [],
  };
}
