#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

: "${ETHEREUM_RPC_URL:?ETHEREUM_RPC_URL is required for the pinned Router V4 fork gates}"

./scripts/bootstrap-deps.sh
(
  cd deployment/router-v4
  forge fmt --check
  forge test --match-path test/ProgrammableRouterDeploymentV1.t.sol -vvv
  forge test --match-path test/ProgrammableCreate2GraphDeployerV1.t.sol -vvv
  forge test --match-path test/ProgrammableExactShardsNestedFactoryFork.t.sol -vv
  forge test --match-path test/ProgrammableRouterDeploymentMainnetFork.t.sol -vv
  forge build --sizes
)
node scripts/generate-router-v4-deployment-artifact.mjs --check
git diff --check
