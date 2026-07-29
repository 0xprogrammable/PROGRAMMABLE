#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOYMENT_FILE="${REPOSITORY_DIR}/deployments/ethereum.json"
RPC_URL="${ETHEREUM_RPC_URL:-https://ethereum-rpc.publicnode.com}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command cast
require_command jq

verify_contract() {
  local name="$1"
  local address="$2"
  local expected_hash="$3"
  local code=""

  for attempt in 1 2 3; do
    if code="$(cast code "${address}" --rpc-url "${RPC_URL}" 2>/dev/null)" && [[ "${code}" != "0x" ]]; then
      break
    fi
    if [[ "${attempt}" == "3" ]]; then
      echo "${name}: unable to read runtime bytecode after ${attempt} attempts" >&2
      exit 1
    fi
  done

  local actual_hash
  actual_hash="$(cast keccak "${code}")"
  local normalized_actual_hash
  local normalized_expected_hash
  normalized_actual_hash="$(printf '%s' "${actual_hash}" | tr '[:upper:]' '[:lower:]')"
  normalized_expected_hash="$(printf '%s' "${expected_hash}" | tr '[:upper:]' '[:lower:]')"
  if [[ "${normalized_actual_hash}" != "${normalized_expected_hash}" ]]; then
    echo "${name}: runtime code hash mismatch" >&2
    echo "  expected ${expected_hash}" >&2
    echo "  actual   ${actual_hash}" >&2
    exit 1
  fi

  echo "${name}: ${address} matches ${actual_hash}"
}

while IFS=$'\t' read -r name address expected_hash; do
  verify_contract "${name}" "${address}" "${expected_hash}"
done < <(
  jq -r '.contracts | to_entries[] | [.key, .value.address, .value.runtimeCodeHash] | @tsv' "${DEPLOYMENT_FILE}"
)

echo "All recorded Ethereum runtime code hashes match mainnet."
