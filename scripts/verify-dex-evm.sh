#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_root="$repository_root/packages/dex-evm"
forge_std_root="$repository_root/contracts/lib/forge-std"
exact_toolchain="${PROGRAMMABLE_DEX_REQUIRE_EXACT_TOOLCHAIN:-0}"
allow_dirty="${PROGRAMMABLE_DEX_ALLOW_DIRTY:-0}"
run_echidna="${PROGRAMMABLE_DEX_RUN_ECHIDNA:-0}"
reproducibility_root=""
expected_forge_std_commit="3b20d60d14b343ee4f908cb8079495c07f5e8981"
expected_forge_std_tree="12dc77680520b52f871a992281dd8d817e46c4bf"
expected_forge_std_remote="https://github.com/foundry-rs/forge-std.git"
dex_paths=(
  README.md
  packages/dex-evm
  config/networks/robinhood-chain
  contracts/scripts/bootstrap-deps.sh
  deployments/dex/robinhood
  docs/PROJECT-STRUCTURE.md
  docs/dex-evm
  docs/security/DEX_EVM_PROPERTIES.md
  releases/dex-evm
  scripts/bootstrap-dex-evm-deps.sh
  scripts/generate-dex-evm-build-artifacts.mjs
  scripts/verify-dex-evm-import-boundary.mjs
  scripts/verify-dex-evm-network-records.mjs
  scripts/verify-dex-evm-package.mjs
  scripts/verify-dex-evm-release-evidence.mjs
  scripts/verify-dex-evm-coverage.sh
  scripts/verify-dex-evm-slither-findings.mjs
  scripts/verify-dex-evm-slither.sh
  scripts/verify-dex-evm-echidna.sh
  scripts/verify-dex-evm.sh
  scripts/verify-robinhood-dex-readonly.sh
  .github/workflows/dex-evm.yml
  .github/workflows/robinhood-dex-evidence.yml
)

verify_forge_std_pin() {
  if [[ ! -d "$forge_std_root/.git" || -L "$forge_std_root" ]]; then
    echo "The exact forge-std checkout is absent or not an ordinary Git worktree" >&2
    exit 1
  fi
  local actual_commit actual_tree actual_remote dependency_status
  actual_commit="$(git -C "$forge_std_root" rev-parse 'HEAD^{commit}')"
  actual_tree="$(git -C "$forge_std_root" rev-parse 'HEAD^{tree}')"
  actual_remote="$(git -C "$forge_std_root" remote get-url origin)"
  dependency_status="$(git -C "$forge_std_root" status --porcelain=v1 --untracked-files=all)"
  if [[ "$actual_commit" != "$expected_forge_std_commit" || "$actual_tree" != "$expected_forge_std_tree" ]]; then
    echo "forge-std commit/tree does not match the exact test dependency pin" >&2
    exit 1
  fi
  if [[ "$actual_remote" != "$expected_forge_std_remote" ]]; then
    echo "forge-std origin does not match the exact dependency source" >&2
    exit 1
  fi
  if [[ -n "$dependency_status" ]]; then
    echo "forge-std contains tracked or untracked changes" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -z "$reproducibility_root" ]]; then
    return
  fi
  case "$reproducibility_root" in
    "${TMPDIR:-/tmp}"/programmable-dex-reproducibility.*) rm -rf "$reproducibility_root" ;;
    *) echo "Refusing to clean unexpected reproducibility path: $reproducibility_root" >&2 ;;
  esac
}
trap cleanup EXIT

if [[ "$exact_toolchain" != "0" && "$exact_toolchain" != "1" ]]; then
  echo "PROGRAMMABLE_DEX_REQUIRE_EXACT_TOOLCHAIN must be 0 or 1" >&2
  exit 1
fi
if [[ "$allow_dirty" != "0" && "$allow_dirty" != "1" ]]; then
  echo "PROGRAMMABLE_DEX_ALLOW_DIRTY must be 0 or 1" >&2
  exit 1
fi
if [[ "$run_echidna" != "0" && "$run_echidna" != "1" ]]; then
  echo "PROGRAMMABLE_DEX_RUN_ECHIDNA must be 0 or 1" >&2
  exit 1
fi

if [[ "$exact_toolchain" == "1" ]]; then
  if [[ "${FOUNDRY_PROFILE:-}" != "ci" ]]; then
    echo "FOUNDRY_PROFILE=ci is required in the exact-toolchain lane" >&2
    exit 1
  fi
  if [[ "$(node --version)" != "v24.14.0" ]]; then
    echo "Node.js v24.14.0 is required in the exact-toolchain lane" >&2
    exit 1
  fi
  forge_version="$(forge --version)"
  if [[ "$(printf '%s\n' "$forge_version" | sed -n '1p')" != "forge Version: 1.7.1" ]] \
    || [[ "$(printf '%s\n' "$forge_version" | sed -n '2p')" != "Commit SHA: 4072e48705af9d93e3c0f6e29e93b5e9a40caed8" ]]; then
    echo "Foundry v1.7.1 at commit 4072e48705af9d93e3c0f6e29e93b5e9a40caed8 is required in the exact-toolchain lane" >&2
    exit 1
  fi
fi

echo "[dex-evm] exact clean forge-std test dependency"
verify_forge_std_pin

echo "[dex-evm] package and Protocol-lock structure"
node "$repository_root/scripts/verify-dex-evm-package.mjs"

echo "[dex-evm] strict import closure"
node "$repository_root/scripts/verify-dex-evm-import-boundary.mjs"

echo "[dex-evm] deterministic Robinhood network and canonical-network no-deployment records"
node "$repository_root/scripts/verify-dex-evm-network-records.mjs"

echo "[dex-evm] release, evidence, blocker, asset-vector, path, and checksum closure"
node "$repository_root/scripts/verify-dex-evm-release-evidence.mjs"

echo "[dex-evm] Solidity formatting"
(
  cd "$package_root"
  forge fmt --check
)

echo "[dex-evm] first clean build and contract sizes"
(
  cd "$package_root"
  forge clean
  forge build --sizes
)

echo "[dex-evm] first-build foundations ABI and artifact comparison"
node "$repository_root/scripts/generate-dex-evm-build-artifacts.mjs" --check
if [[ ! -d "$package_root/out" || -L "$package_root/out" ]]; then
  echo "The first Foundry output must be an ordinary package-local directory" >&2
  exit 1
fi
reproducibility_root="$(mktemp -d "${TMPDIR:-/tmp}/programmable-dex-reproducibility.XXXXXX")"
cp -R "$package_root/out" "$reproducibility_root/first-out"

for suite in unit fuzz invariant adversarial conformance; do
  echo "[dex-evm] Foundry $suite tests"
  (
    cd "$package_root"
    forge test --match-path "test/$suite/**/*.t.sol" -vvv
  )
done

echo "[dex-evm] explicit authority-bearing-field mutation gate"
(
  cd "$package_root"
  forge test --match-path "test/conformance/AuthorityFieldMutation.t.sol" -vvv
)

echo "[dex-evm] source coverage summary"
bash "$repository_root/scripts/verify-dex-evm-coverage.sh"

echo "[dex-evm] independent clean rebuild and byte-for-byte artifact comparison"
(
  cd "$package_root"
  forge clean
  forge build --sizes
)
node "$repository_root/scripts/generate-dex-evm-build-artifacts.mjs" --check
if [[ ! -d "$package_root/out" || -L "$package_root/out" ]]; then
  echo "The second Foundry output must be an ordinary package-local directory" >&2
  exit 1
fi
if ! diff -qr "$reproducibility_root/first-out" "$package_root/out" > "$reproducibility_root/diff.txt"; then
  cat "$reproducibility_root/diff.txt" >&2
  echo "The two clean-equivalent Foundry output trees are not byte-for-byte reproducible" >&2
  exit 1
fi
echo "[dex-evm] two Foundry output trees are byte-for-byte identical"

if [[ -f "$package_root/.gas-snapshot" ]]; then
  echo "[dex-evm] committed gas snapshot"
  (
    cd "$package_root"
    forge snapshot --check --no-match-path "test/integration/**"
  )
else
  echo "[dex-evm] no gas snapshot is present; no gas-snapshot claim is made"
fi

if [[ -f "$package_root/sdk/package.json" ]]; then
  echo "[dex-evm] isolated SDK install, build, tests, and pack inventory"
  (
    cd "$package_root/sdk"
    export npm_config_audit=false
    export npm_config_fund=false
    export npm_config_ignore_scripts=true
    npm ci --ignore-scripts
    npm run build
    npm test
    npm pack --dry-run --json >/dev/null
  )
else
  echo "[dex-evm] SDK absent; no SDK build or test claim is made"
fi

echo "[dex-evm] scoped Slither 0.11.5 analysis"
bash "$repository_root/scripts/verify-dex-evm-slither.sh"

if [[ "$run_echidna" == "1" ]]; then
  echo "[dex-evm] exact Echidna 2.3.3 campaign when a real harness exists"
  bash "$repository_root/scripts/verify-dex-evm-echidna.sh"
else
  echo "[dex-evm] Echidna runs in its exact dedicated CI lane; no campaign is claimed by this invocation"
fi

echo "[dex-evm] dependency pin remains clean after verification"
verify_forge_std_pin

echo "[dex-evm] unstaged and staged whitespace gates"
git -C "$repository_root" diff --check -- "${dex_paths[@]}"
git -C "$repository_root" diff --cached --check -- "${dex_paths[@]}"

if [[ "$allow_dirty" == "0" ]]; then
  if ! git -C "$repository_root" diff --quiet -- "${dex_paths[@]}"; then
    echo "Unstaged DEX verification inputs remain" >&2
    exit 1
  fi
  if ! git -C "$repository_root" diff --cached --quiet -- "${dex_paths[@]}"; then
    echo "Staged DEX verification inputs remain" >&2
    exit 1
  fi
  untracked="$(git -C "$repository_root" ls-files --others --exclude-standard -- "${dex_paths[@]}")"
  if [[ -n "$untracked" ]]; then
    echo "Untracked DEX verification inputs remain:" >&2
    echo "$untracked" >&2
    exit 1
  fi
else
  echo "[dex-evm] clean-tree enforcement disabled for this local integration run"
fi

echo "DEX EVM package verification passed. This is local test evidence only; protected execution remains BLOCKED_BY_SPEC."
