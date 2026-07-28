import { describe, expect, it } from "vitest";

import {
  errorChainIncludesData,
  safeServerErrorSummary,
} from "../lib/server/safe-error";

describe("safe server error handling", () => {
  it("recognizes a nested custom error selector", () => {
    const error = Object.assign(new Error("Call failed"), {
      cause: {
        name: "RpcRequestError",
        data: "0x846d8c5c",
      },
    });

    expect(
      errorChainIncludesData(error, "0x846d8c5c"),
    ).toBe(true);
    expect(
      errorChainIncludesData(error, "0x3e87ea32"),
    ).toBe(false);
  });

  it("never includes RPC URLs, request bodies or full calldata", () => {
    const error = Object.assign(new Error("Execution reverted"), {
      cause: {
        name: "RpcRequestError",
        message:
          "RPC Request failed.\n\nURL: https://rpc.example/key\nRequest body: secret",
        code: 3,
        data: `0x846d8c5c${"ab".repeat(32)}`,
      },
    });
    const summary = JSON.stringify(safeServerErrorSummary(error));

    expect(summary).toContain("RPC Request failed.");
    expect(summary).toContain("0x846d8c5c");
    expect(summary).not.toContain("rpc.example");
    expect(summary).not.toContain("Request body");
    expect(summary).not.toContain("abababab");
  });

  it("terminates safely when an error cause is cyclic", () => {
    const cyclic: { name: string; cause?: unknown } = {
      name: "CyclicError",
    };
    cyclic.cause = cyclic;

    expect(safeServerErrorSummary(cyclic)).toEqual({
      chain: [{ name: "CyclicError" }],
    });
  });
});
