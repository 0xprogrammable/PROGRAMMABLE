#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
library_root="$repository_root/contracts/lib"
target="$library_root/forge-std"
expected_remote="https://github.com/foundry-rs/forge-std.git"
expected_commit="3b20d60d14b343ee4f908cb8079495c07f5e8981"
expected_tree="12dc77680520b52f871a992281dd8d817e46c4bf"

verify_checkout() {
  if [[ -L "$target" ]] || [[ "$(git -C "$target" rev-parse --is-inside-work-tree 2>/dev/null || true)" != "true" ]]; then
    echo "forge-std must be an ordinary Git worktree" >&2
    exit 1
  fi

  local actual_commit actual_tree actual_remote checkout_status
  actual_commit="$(git -C "$target" rev-parse 'HEAD^{commit}')"
  actual_tree="$(git -C "$target" rev-parse 'HEAD^{tree}')"
  actual_remote="$(git -C "$target" remote get-url origin)"
  checkout_status="$(git -C "$target" status --porcelain=v1 --untracked-files=all)"

  if [[ "$actual_commit" != "$expected_commit" || "$actual_tree" != "$expected_tree" ]]; then
    echo "forge-std does not match the exact commit and tree pin" >&2
    exit 1
  fi
  if [[ "$actual_remote" != "$expected_remote" ]]; then
    echo "forge-std origin does not match the exact dependency source" >&2
    exit 1
  fi
  if [[ -n "$checkout_status" ]]; then
    echo "forge-std contains tracked or untracked changes" >&2
    exit 1
  fi
}

mkdir -p "$library_root"
if [[ ! -e "$target" ]]; then
  git clone --filter=blob:none --no-checkout "$expected_remote" "$target"
  git -C "$target" checkout --detach "$expected_commit"
elif [[ ! -d "$target" ]]; then
  echo "$target exists but is not a directory" >&2
  exit 1
fi

verify_checkout
echo "DEX EVM dependency verified: forge-std $expected_commit tree $expected_tree."
