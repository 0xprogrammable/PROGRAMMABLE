#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_root="$repository_root/packages/dex-evm"
coverage_root="$(mktemp -d "${TMPDIR:-/tmp}/programmable-dex-coverage.XXXXXX")"
coverage_package="$coverage_root/package"

cleanup() {
  case "$coverage_root" in
    "${TMPDIR:-/tmp}"/programmable-dex-coverage.*) rm -rf "$coverage_root" ;;
    *) echo "Refusing to clean unexpected coverage path: $coverage_root" >&2 ;;
  esac
}
trap cleanup EXIT

mkdir -p "$coverage_package/lib"
cp "$package_root/foundry.toml" "$package_root/remappings.txt" "$coverage_package/"
for directory in src test script binding; do
  if [[ -d "$package_root/$directory" ]]; then
    cp -R "$package_root/$directory" "$coverage_package/$directory"
  fi
done
cp -R "$repository_root/contracts/lib/forge-std" "$coverage_package/lib/forge-std"

# Foundry 1.7.1's Solar coverage pass cannot resolve the package's deliberately
# narrow external test-only forge-std path. Re-home that exact pinned dependency
# in an isolated copy; production sources and the working tree remain unchanged.
# Forge coverage also deliberately disables the configured optimizer. Exclude
# only the conformance suite that compares optimizer-specific creation bytecode;
# the normal-profile package gate runs that suite separately and fail-closed.
if ! (
  cd "$coverage_package"
  NO_COLOR=1 forge coverage \
    --root "$coverage_package" \
    --remappings "forge-std/=lib/forge-std/src/" \
    --lib-paths lib/forge-std \
    --report summary \
    --exclude-tests \
    --no-match-path "test/{integration/**,conformance/FoundationsOnlyConformance.t.sol}"
) > "$coverage_root/coverage.log" 2>&1; then
  cat "$coverage_root/coverage.log" >&2
  exit 1
fi

total_row="$(grep -E '^\| Total[[:space:]]*\|' "$coverage_root/coverage.log" | tail -n 1 || true)"
if [[ -z "$total_row" ]]; then
  cat "$coverage_root/coverage.log" >&2
  echo "Foundry coverage completed without a total summary row" >&2
  exit 1
fi

percentages="$(printf '%s\n' "$total_row" | grep -Eo '[0-9]+([.][0-9]+)?%' | tr '\n' ' ')"
set -- $percentages
if [[ "$#" -ne 4 ]]; then
  echo "Could not parse the four coverage percentages from: $total_row" >&2
  exit 1
fi

node - "$1" "$2" "$3" "$4" <<'NODE'
const [lines, statements, branches, functions] = process.argv.slice(2).map((value) => Number.parseFloat(value));
const actual = { lines, statements, branches, functions };
const minimum = { lines: 90, statements: 85, branches: 50, functions: 95 };
for (const [metric, floor] of Object.entries(minimum)) {
  if (!Number.isFinite(actual[metric]) || actual[metric] < floor) {
    throw new Error(`Coverage gate failed: ${metric} ${actual[metric]}% is below ${floor}%`);
  }
}
process.stdout.write(
  `Scoped source coverage verified: lines ${lines}% (>=90), statements ${statements}% (>=85), `
  + `branches ${branches}% (>=50), functions ${functions}% (>=95).\n`
);
NODE

printf '%s\n' "$total_row"
