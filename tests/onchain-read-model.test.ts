import { describe, expect, it } from "vitest";

import { readExploreModel } from "../lib/onchain/read-model";
import type { OnchainDeployment } from "../lib/onchain/types";

describe("Explore read model deployment boundary", () => {
  it("returns an honest empty result without touching RPC when undeployed", async () => {
    const config: OnchainDeployment = {
      environment: "production",
      releaseVersion: "classic-v1",
      chainId: 1,
      status: "not-deployed",
      launcher: null,
      feeHook: null,
      launcherRuntimeCodeHash: null,
      feeHookRuntimeCodeHash: null,
      deploymentBlock: null,
      stateView: "0x1111111111111111111111111111111111111111",
      stateViewRuntimeCodeHash: `0x${"11".repeat(32)}`,
      rpcUrl: "https://this-must-not-be-called.invalid",
      rpcUrlSecondary: null,
      confirmations: 12n,
      logBlockRange: 10_000n,
    };

    await expect(readExploreModel(config)).resolves.toEqual({
      status: "not-deployed",
      tokens: [],
      snapshot: null,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    });
  });
});
