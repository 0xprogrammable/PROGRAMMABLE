import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOfficialLaunchProfile } from "./official-launchpad-core.mjs";
import { resolvedText } from "./submission-analysis-helpers.mjs";
import { KNOWN_EVM_NETWORKS, PROGRAMMABLE_LAUNCH_CHAIN_ID } from "./submission-constants-core.mjs";

const modulePath = fileURLToPath(import.meta.url);
const officialLaunchpadReferencePath = path.resolve(
  path.dirname(modulePath),
  "..",
  "references",
  "official-launchpad-deployments.json"
);

export function validateSubmissionTarget({ target, solidityBuildRequired, add, gate }) {
  const targetChainIsValid = Number.isSafeInteger(target.chainId) && target.chainId > 0;
  const expectedNetwork = targetChainIsValid ? KNOWN_EVM_NETWORKS[target.chainId] ?? null : null;
  if (expectedNetwork && target.network !== expectedNetwork) {
    add(
      "blocker",
      "CHAIN_NETWORK_MISMATCH",
      "$.target.network",
      `Chain ${target.chainId} must use network ${expectedNetwork}.`,
      "Keep the canonical network slug and numeric chain id bound to the same deployment set."
    );
  }
  if (targetChainIsValid && !expectedNetwork) {
    add(
      "warning",
      "TARGET_CHAIN_REQUIRES_ARCHITECTURE_REVIEW",
      "$.target.chainId",
      `Chain ${target.chainId} is application-eligible, but this standard has no committed chain profile for it.`,
      "Keep the canonical network slug and add exact Uniswap v4 deployments, Cancun and EIP-1153 support, PoolManager, router, Permit2, runtime, source and pinned-fork evidence for architecture review."
    );
    gate(
      "target-chain-architecture-review",
      "candidate",
      "The target chain has no committed Programmable chain profile; reviewers must verify its canonical identity, v4 deployment set, Cancun support, runtime evidence and integration plan."
    );
  }
  if (targetChainIsValid && target.chainId !== PROGRAMMABLE_LAUNCH_CHAIN_ID) {
    add(
      "warning",
      "PROGRAMMABLE_PLATFORM_CHAIN_NOT_CURRENTLY_INTEGRATED",
      "$.target.chainId",
      `Chain ${target.chainId} is eligible for public application review, but the current Programmable launch runtime is integrated only with Ethereum Mainnet (chain 1).`,
      "Continue the application and architecture review without making a launch claim; a separate maintainer-owned chain integration and release must pass before Programmable can launch this project on the target chain."
    );
    gate(
      "programmable-platform-target-chain-integration",
      "release",
      "The project may be reviewed, but Programmable launch availability remains blocked until maintainers integrate and release the exact target chain."
    );
  }
  if (solidityBuildRequired && !resolvedText(target.solidityVersion)) add("blocker", "COMPILER_UNPINNED", "$.target.solidityVersion", "The declared Solidity source has no pinned compiler.", "Set one exact compiler version from a tested dependency baseline.");
  if (solidityBuildRequired && target.evmVersion !== "cancun") add("blocker", "EVM_TARGET_INVALID", "$.target.evmVersion", "Declared Uniswap v4 Solidity source requires the Cancun EVM target.", "Set evmVersion to cancun and verify the target chain supports EIP-1153.");
  if (solidityBuildRequired && !target.dependencyBaseline) add("blocker", "DEPENDENCY_BASELINE_MISSING", "$.target.dependencyBaseline", "Declared Solidity source has no dependency baseline.", "Use the Programmable-tested baseline or document and review a model-specific baseline.");
  if (target.dependencyBaseline === "model-specific-pinned") {
    gate("model-specific-dependency-review", "candidate", "A builder-pinned compiler and dependency closure remains unreviewed until maintainers verify the exact lock and source graph.");
    gate("model-specific-architecture-review", "candidate", "A model-specific baseline changes the architecture and trust assumptions outside the Programmable-tested acceleration path.");
  }
  if (target.dependencyBaseline === "model-specific-reviewed") {
    add(
      "blocker",
      "MODEL_SPECIFIC_REVIEWED_BASELINE_SELF_ATTESTED",
      "$.target.dependencyBaseline",
      "A public builder submission cannot attribute a model-specific dependency baseline to Programmable maintainers.",
      "Use model-specific-pinned with an exact dependency lock. Maintainers may later register an attributable reviewed baseline outside the builder-controlled submission."
    );
  }
  if (resolvedText(target.officialLaunchProfileId)) {
    try {
      const reference = JSON.parse(fs.readFileSync(officialLaunchpadReferencePath, "utf8"));
      const profile = resolveOfficialLaunchProfile(reference, target.officialLaunchProfileId);
      if (profile.chainId !== target.chainId) {
        add(
          "blocker",
          "OFFICIAL_LAUNCH_PROFILE_CHAIN_MISMATCH",
          "$.target.officialLaunchProfileId",
          `Official launch profile ${profile.id} targets chain ${profile.chainId}, not submission chain ${target.chainId}.`,
          "Select the exact committed profile for target.chainId; never override profile deployment addresses in the submission."
        );
      }
      gate("official-launch-profile-runtime-and-interface-verification", "release", "An official launch profile reference is not proof that its current runtime, interfaces, immutables or source configuration were verified.");
      if (profile.sourceConflictStatus === "blocked-official-source-conflict") {
        gate("official-launch-profile-source-conflict-resolution", "release", "The committed official sources disagree on at least one selected deployment record and execution remains blocked until the conflict is resolved.");
      }
    } catch (error) {
      add(
        "blocker",
        "OFFICIAL_LAUNCH_PROFILE_INVALID",
        "$.target.officialLaunchProfileId",
        `The selected official launch profile cannot be resolved from the committed reference: ${error.message}`,
        "Select an exact profile id from references/official-launchpad-deployments.json and rerun the current skill; do not supply deployment addresses manually."
      );
    }
  }

}
