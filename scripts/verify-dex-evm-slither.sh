#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_root="$repository_root/packages/dex-evm"
analysis_root="$(mktemp -d "${TMPDIR:-/tmp}/programmable-dex-slither.XXXXXX")"
analysis_package="$analysis_root/project/packages/dex-evm"

cleanup() {
  case "$analysis_root" in
    "${TMPDIR:-/tmp}"/programmable-dex-slither.*) rm -rf "$analysis_root" ;;
    *) echo "Refusing to clean unexpected Slither path: $analysis_root" >&2 ;;
  esac
}
trap cleanup EXIT

if ! command -v slither >/dev/null 2>&1; then
  echo "slither is required; install the exact CI version 0.11.5" >&2
  exit 1
fi

if [[ "$(slither --version 2>&1 | tr -d '[:space:]')" != "0.11.5" ]]; then
  echo "slither 0.11.5 is required" >&2
  exit 1
fi

mkdir -p "$analysis_package" "$analysis_root/project/contracts/lib"
cp "$package_root/foundry.toml" "$package_root/remappings.txt" "$package_root/slither.config.json" "$analysis_package/"
for directory in src test script binding; do
  if [[ -d "$package_root/$directory" ]]; then
    cp -R "$package_root/$directory" "$analysis_package/$directory"
  fi
done
cp -R "$repository_root/contracts/lib/forge-std" "$analysis_root/project/contracts/lib/forge-std"

cd "$analysis_package"
if ! slither . \
  --config-file "$analysis_package/slither.config.json" \
  --compile-force-framework foundry \
  --foundry-out-directory out \
  --fail-none \
  --json "$analysis_root/findings.json" \
  --disable-color \
  > "$analysis_root/detectors.txt" 2>&1; then
  cat "$analysis_root/detectors.txt" >&2
  exit 1
fi

node "$repository_root/scripts/verify-dex-evm-slither-findings.mjs" "$analysis_root/findings.json"

# Keep the severity exit threshold separate from the exact every-finding triage.
if ! slither . \
  --config-file "$analysis_package/slither.config.json" \
  --compile-force-framework foundry \
  --foundry-out-directory out \
  --fail-high \
  --disable-color \
  > "$analysis_root/severity.txt" 2>&1; then
  cat "$analysis_root/severity.txt" >&2
  exit 1
fi
echo "Slither high-severity exit threshold verified."

cd "$analysis_root"
slither "$analysis_package" \
  --config-file "$analysis_package/slither.config.json" \
  --compile-force-framework foundry \
  --foundry-out-directory out \
  --print inheritance-graph,function-summary,vars-and-auth \
  --disable-color \
  > "$analysis_root/printers.txt" 2>&1

if [[ ! -s "$analysis_root/printers.txt" ]]; then
  echo "Slither function-summary and vars-and-auth printer output is empty" >&2
  exit 1
fi
if ! grep -Fq "Contract CoreV1" "$analysis_root/printers.txt"; then
  echo "Slither printer output does not contain the CoreV1 function/authorization summary" >&2
  exit 1
fi
if [[ "$(find "$analysis_root" -type f -name '*inheritance-graph.dot' -size +0c | wc -l | tr -d '[:space:]')" == "0" ]]; then
  echo "Slither inheritance graph was not generated" >&2
  exit 1
fi
echo "Slither inheritance graph, function summary, and variables/authorization printers verified."
