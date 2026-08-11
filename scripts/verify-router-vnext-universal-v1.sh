#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

export FOUNDRY_CONFIG=config/router-vnext/foundry.toml
forge fmt --check
forge test --match-path test/router_vnext/ProgrammableUniversalLaunchKernelV1.t.sol -vvv
forge build --sizes
node scripts/generate-router-vnext-universal-artifact.mjs --check
git diff --check
