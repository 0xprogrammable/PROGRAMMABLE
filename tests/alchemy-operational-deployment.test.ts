import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (reader: () => unknown) => reader,
}));

const mocks = vi.hoisted(() => ({
  getOperationalOnchainDeployment: vi.fn(),
  getWebsiteReadOnchainDeployment: vi.fn(),
}));

vi.mock("../lib/onchain/config", () => ({
  getOperationalOnchainDeployment: mocks.getOperationalOnchainDeployment,
  getWebsiteReadOnchainDeployment: mocks.getWebsiteReadOnchainDeployment,
}));

import { getAlchemyOnchainDeployment } from "../lib/alchemy/explore.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";

const operational = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 1n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: "https://primary.example/rpc-key",
  rpcUrlSecondary: "https://secondary.example/rpc-key",
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

describe("Alchemy-named website consumer deployment", () => {
  it("uses the fixed independent Website read quorum", () => {
    mocks.getWebsiteReadOnchainDeployment.mockReturnValue(operational);

    expect(getAlchemyOnchainDeployment()).toBe(operational);
    expect(mocks.getWebsiteReadOnchainDeployment).toHaveBeenCalledWith(
      "production",
    );
    expect(mocks.getOperationalOnchainDeployment).not.toHaveBeenCalled();
  });
});
