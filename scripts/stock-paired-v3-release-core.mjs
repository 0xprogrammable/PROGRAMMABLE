import { execFileSync } from "node:child_process";

export const STOCK_PAIRED_V3_RELEASE_VERSION = "v3";
export const STOCK_PAIRED_V3_MANIFEST_PATH =
  "contracts/deployments/mainnet-stock-paired-v3.json";
export const STOCK_PAIRED_V3_DEPLOY_SCRIPT =
  "contracts/script/DeployMainnetStockPairedInfrastructureV3.s.sol";
export const STOCK_PAIRED_V3_DEPLOY_TEST =
  "contracts/test/DeployMainnetStockPairedInfrastructureV3.t.sol";
export const STOCK_PAIRED_V3_SOURCE_COMMITMENT =
  "0xda537415a9678c414240ba9849011acef0aeee36bc938cc4597a0a78f0e74f66";

const releasePaths = Object.freeze([
  "config/stock-paired-assets.v3.json",
  "contracts/dependencies/ethereum-mainnet.json",
  "contracts/dependencies/source-pins.json",
  "contracts/foundry.toml",
  "contracts/remappings.txt",
  "contracts/script/DeployMainnetStockPairedInfrastructureV3.s.sol",
  "contracts/security/STOCK-PAIRED-V3-PRICE-POLICY.md",
  "contracts/src/StockPairedEthLaunchCoordinatorV3.sol",
  "contracts/src/StockPairedLaunchV3.sol",
  "contracts/src/StockPairedPositionPlannerV3.sol",
  "contracts/test/DeployMainnetStockPairedInfrastructureV3.t.sol",
  "contracts/test/StockPairedLaunchV3.t.sol",
  "contracts/test/StockPairedPositionPlannerV3.t.sol",
  "contracts/test/StockPairedV3MainnetFork.t.sol",
  "contracts/scripts/verify-stock-paired-v3-final-pricing.mjs",
  "lib/stock-paired-v3.ts",
]);

function git(root, args, options = {}) {
  const output = execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  return typeof output === "string" ? output.trim() : "";
}

export function assertStockPairedV3ReleaseCheckout(
  root,
  releaseCommit,
  { allowDescendant = false } = {},
) {
  if (
    typeof releaseCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(releaseCommit)
  ) {
    throw new Error("A full Stock-Paired V3 release commit is required");
  }
  git(root, ["cat-file", "-e", `${releaseCommit}^{commit}`], {
    stdio: "ignore",
  });
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head !== releaseCommit) {
    if (!allowDescendant) {
      throw new Error("The checkout is not at the Stock-Paired V3 release");
    }
    try {
      git(root, ["merge-base", "--is-ancestor", releaseCommit, head], {
        stdio: "ignore",
      });
    } catch {
      throw new Error(
        "The checkout does not descend from the Stock-Paired V3 release",
      );
    }
  }
  const committedChanges = git(root, [
    "diff",
    "--name-only",
    releaseCommit,
    "HEAD",
    "--",
    ...releasePaths,
  ]);
  if (committedChanges) {
    throw new Error(
      "Stock-Paired V3 release files differ from the deployed release",
    );
  }
  const dirty = git(root, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ...releasePaths,
  ]);
  if (dirty) {
    throw new Error("Stock-Paired V3 release files have uncommitted changes");
  }
  return true;
}

export function stockPairedReleaseDescriptor(version) {
  const normalized = String(version ?? "").trim().toLowerCase();
  if (!["v1", "v2", "v3"].includes(normalized)) {
    throw new Error("STOCK_PAIRED_RELEASE_VERSION must be v1, v2 or v3");
  }
  return Object.freeze({
    version: normalized,
    expanded: normalized !== "v1",
    v3: normalized === "v3",
    manifestPath:
      normalized === "v3"
        ? STOCK_PAIRED_V3_MANIFEST_PATH
        : `contracts/deployments/mainnet-stock-paired-${normalized}.json`,
    defaultCanaryPort:
      normalized === "v3" ? 4195 : normalized === "v2" ? 4193 : 4191,
  });
}
