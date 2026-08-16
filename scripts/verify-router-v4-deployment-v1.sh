#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

rpc_candidates_raw="${ETHEREUM_RPC_URLS:-${ETHEREUM_RPC_URL:-}}"
if [[ -z "$rpc_candidates_raw" ]]; then
  echo "ETHEREUM_RPC_URL or ETHEREUM_RPC_URLS is required for the pinned Router V4 fork gates" >&2
  exit 1
fi
read -r -a rpc_candidates <<< "$rpc_candidates_raw"

./scripts/bootstrap-deps.sh
(
  cd deployment/router-v4
  forge fmt --check
  forge test --match-path test/ProgrammableRouterDeploymentV1.t.sol -vvv
  forge test --match-path test/ProgrammableCreate2GraphDeployerV1.t.sol -vvv
  fork_gate_passed=false
  for rpc_url in "${rpc_candidates[@]}"; do
    for attempt in 1 2 3; do
      echo "Router V4 fork attempt ${attempt} with ${rpc_url}"
      if ETHEREUM_RPC_URL="$rpc_url" forge test \
          --match-path test/ProgrammableExactShardsNestedFactoryFork.t.sol -vv \
        && ETHEREUM_RPC_URL="$rpc_url" forge test \
          --match-path test/ProgrammableRouterDeploymentMainnetFork.t.sol -vv; then
        fork_gate_passed=true
        break 2
      fi
      sleep $((attempt * 3))
    done
  done
  if [[ "$fork_gate_passed" != true ]]; then
    echo "Router V4 pinned fork gates failed on every configured provider" >&2
    exit 1
  fi
  forge build --sizes
)
node scripts/generate-router-v4-deployment-artifact.mjs --check
git diff --check
