#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <owner-payloads.json>" >&2
  exit 64
fi
if [[ -z "${ETHEREUM_RPC_URL:-}" ]]; then
  echo "ETHEREUM_RPC_URL is required" >&2
  exit 64
fi

repo_root=$(git rev-parse --show-toplevel)
payload_path=$1
artifact_path="$repo_root/artifacts/router-v4-deployment-v1/router-v4-deployment-v1.json"
launcher=0x2Bb333d48DFAF1596D9036671d2E43168994249E
safe=0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b
fork_block=25731328
transaction_gas_limit=16777216
anvil_port="${ROUTER_V4_ANVIL_PORT:-9855}"
local_rpc="http://127.0.0.1:${anvil_port}"
temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/router-v4-cold-outer.XXXXXX")
anvil_pid=

cleanup() {
  if [[ -n "$anvil_pid" ]] && kill -0 "$anvil_pid" 2>/dev/null; then
    kill "$anvil_pid" 2>/dev/null || true
    wait "$anvil_pid" 2>/dev/null || true
  fi
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT

for command in anvil cast jq; do
  command -v "$command" >/dev/null || {
    echo "$command is required" >&2
    exit 64
  }
done
[[ -f "$payload_path" ]] || {
  echo "payload file not found: $payload_path" >&2
  exit 66
}
expected_fork_label=$(jq -r '.deployment.simulations.separateSerialOuterTransactions' "$artifact_path")
expected_fork_block_hash=$(jq -r '.deployment.simulations.separateSerialOuterTransactionForkBlockHash' "$artifact_path")
[[ "$expected_fork_label" == "PASS_AT_BLOCK_${fork_block}_OSAKA_EIP7825" ]] || {
  echo "fork block label drift: expected PASS_AT_BLOCK_${fork_block}_OSAKA_EIP7825, got $expected_fork_label" >&2
  exit 1
}

anvil \
  --fork-url "$ETHEREUM_RPC_URL" \
  --fork-block-number "$fork_block" \
  --chain-id 1 \
  --hardfork osaka \
  --enable-tx-gas-limit \
  --accounts 0 \
  --host 127.0.0.1 \
  --port "$anvil_port" \
  >"$temp_dir/anvil.log" 2>&1 &
anvil_pid=$!

ready=false
for _ in $(seq 1 60); do
  if [[ "$(cast chain-id --rpc-url "$local_rpc" 2>/dev/null || true)" == "1" ]]; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  tail -n 100 "$temp_dir/anvil.log" >&2 || true
  echo "Anvil fork did not become ready" >&2
  exit 1
fi
actual_fork_block_hash=$(cast block "$fork_block" --field hash --rpc-url "$local_rpc")
actual_fork_block_hash_lower=$(printf '%s' "$actual_fork_block_hash" | tr '[:upper:]' '[:lower:]')
expected_fork_block_hash_lower=$(printf '%s' "$expected_fork_block_hash" | tr '[:upper:]' '[:lower:]')
[[ "$actual_fork_block_hash_lower" == "$expected_fork_block_hash_lower" ]] || {
  echo "fork block hash drift: expected $expected_fork_block_hash, got $actual_fork_block_hash" >&2
  exit 1
}

cast rpc --rpc-url "$local_rpc" anvil_impersonateAccount "$launcher" >/dev/null
cast rpc --rpc-url "$local_rpc" anvil_setBalance "$launcher" 0x56BC75E2D63100000 >/dev/null

initial_launcher_nonce=$(cast nonce "$launcher" --rpc-url "$local_rpc")
initial_safe_nonce=$(cast call "$safe" 'nonce()(uint256)' --rpc-url "$local_rpc")
actual_gas_total=0
minimum_gas_margin=$transaction_gas_limit

for index in $(seq 0 14); do
  phase=$(jq -r ".transactions[$index].phase" "$payload_path")
  target=$(jq -r ".transactions[$index].to" "$payload_path")
  data=$(jq -r ".transactions[$index].data" "$payload_path")
  expected_gas=$(jq -r ".transactions[$index].coldPinnedForkGasUsed" "$payload_path")
  receipt=$(cast send "$target" \
    --from "$launcher" \
    --unlocked \
    --data "$data" \
    --gas-limit "$transaction_gas_limit" \
    --gas-price 1000000000 \
    --legacy \
    --rpc-timeout 120 \
    --rpc-url "$local_rpc" \
    --json)
  receipt_status=$(jq -r .status <<<"$receipt")
  gas_hex=$(jq -r .gasUsed <<<"$receipt")
  actual_gas=$((gas_hex))
  if [[ "$receipt_status" != "0x1" ]]; then
    echo "cold outer transaction $((index + 1)) $phase reverted" >&2
    exit 1
  fi
  if [[ "$actual_gas" -ne "$expected_gas" ]]; then
    echo "cold gas drift for $phase: expected $expected_gas, got $actual_gas" >&2
    exit 1
  fi
  actual_gas_total=$((actual_gas_total + actual_gas))
  gas_margin=$((transaction_gas_limit - actual_gas))
  if [[ "$gas_margin" -lt "$minimum_gas_margin" ]]; then
    minimum_gas_margin=$gas_margin
  fi
  printf '%02d %-48s gas=%d margin=%d\n' "$((index + 1))" "$phase" "$actual_gas" "$gas_margin"
done

expected_gas_total=$(jq -r '.deployment.simulations.separateSerialOuterTransactionGasTotal' "$artifact_path")
expected_minimum_margin=$(jq -r '.deployment.simulations.minimumTransactionGasMargin' "$artifact_path")
[[ "$actual_gas_total" -eq "$expected_gas_total" ]] || {
  echo "cold gas total drift: expected $expected_gas_total, got $actual_gas_total" >&2
  exit 1
}
[[ "$minimum_gas_margin" -eq "$expected_minimum_margin" ]] || {
  echo "cold minimum margin drift: expected $expected_minimum_margin, got $minimum_gas_margin" >&2
  exit 1
}

final_launcher_nonce=$(cast nonce "$launcher" --rpc-url "$local_rpc")
final_safe_nonce=$(cast call "$safe" 'nonce()(uint256)' --rpc-url "$local_rpc")
[[ "$final_launcher_nonce" -eq $((initial_launcher_nonce + 15)) ]]
[[ "$final_safe_nonce" -eq $((initial_safe_nonce + 6)) ]]

while IFS=$'\t' read -r contract address expected_hash; do
  actual_hash=$(cast codehash "$address" --rpc-url "$local_rpc")
  actual_hash_lower=$(printf '%s' "$actual_hash" | tr '[:upper:]' '[:lower:]')
  expected_hash_lower=$(printf '%s' "$expected_hash" | tr '[:upper:]' '[:lower:]')
  if [[ "$actual_hash_lower" != "$expected_hash_lower" ]]; then
    echo "$contract runtime drift: expected $expected_hash, got $actual_hash" >&2
    exit 1
  fi
done < <(
  jq -r '
    .deployment as $d
    | $d.predictedAddresses
    | to_entries[]
    | [.key, .value, $d.specializedRuntimeCodeHashes[.key]]
    | @tsv
  ' "$artifact_path"
)

while IFS=$'\t' read -r address expected_hash; do
  actual_hash=$(cast codehash "$address" --rpc-url "$local_rpc")
  actual_hash_lower=$(printf '%s' "$actual_hash" | tr '[:upper:]' '[:lower:]')
  expected_hash_lower=$(printf '%s' "$expected_hash" | tr '[:upper:]' '[:lower:]')
  [[ "$actual_hash_lower" == "$expected_hash_lower" ]] || {
    echo "store child runtime drift at $address: expected $expected_hash, got $actual_hash" >&2
    exit 1
  }
done < <(jq -r '.deployment.deterministicPlan.storeChildren[] | [.address, .runtimeCodeHash] | @tsv' "$artifact_path")

for role in \
  ProgrammableRouterReviewerAuthorityV4 \
  ProgrammableRouterGovernanceAuthorityV4 \
  ProgrammableRouterFinalityAuthorityV4 \
  ProgrammableRouterIndexerAuthorityV4; do
  role_address=$(jq -r --arg role "$role" '.deployment.predictedAddresses[$role]' "$artifact_path")
  [[ "$(cast call "$role_address" 'initialized()(bool)' --rpc-url "$local_rpc")" == "true" ]]
  [[ "$(cast call "$role_address" 'killed()(bool)' --rpc-url "$local_rpc")" == "false" ]]
done

kernel=$(jq -r '.deployment.predictedAddresses.ProgrammableUniversalLaunchKernelV1' "$artifact_path")
profile=$(jq -r '.deployment.predictedAddresses.ProgrammableNestedFactoryProfileV1' "$artifact_path")
profile_key=$(jq -r '.deployment.profileBindings.universalProfileKey' "$artifact_path")
kernel_control=$(cast call "$kernel" \
  'controlStateV1()((bytes32,uint64,bytes32,uint64,bytes32,uint64,bytes32,bool))' \
  --json --rpc-url "$local_rpc")
jq -e '.[0][1] == 2 and .[0][3] == 2 and .[0][5] == 2 and .[0][7] == false' \
  <<<"$kernel_control" >/dev/null
profile_state=$(cast call "$kernel" \
  'profileDescriptorV1(bytes32)((bytes32,bytes32,uint32,uint8,address,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint64,bytes32,uint64,bytes32,uint64,bytes32,uint8))' \
  "$profile_key" --json --rpc-url "$local_rpc")
profile_lower=$(printf '%s' "$profile" | tr '[:upper:]' '[:lower:]')
jq -e --arg profile "$profile_lower" '((.[0][4] | ascii_downcase) == $profile) and .[0][17] == 1' \
  <<<"$profile_state" >/dev/null

registry=$(jq -r '.deployment.predictedAddresses.ProgrammableCompletedGraphAdoptionGrantRegistryV1' "$artifact_path")
compat_profile_key=$(jq -r '.deployment.profileBindings.completedGraphAdoptionCompatProfileKey' "$artifact_path")
compat_capability=$(jq -r '.deployment.profileBindings.completedGraphAdoptionCompatCapabilityHash' "$artifact_path")
compat_state=$(cast call "$registry" \
  'preflightControlStateV1(bytes32)((bytes32,uint16,bytes32,bytes32,uint64,bytes32,uint64,bytes32,(bytes32,uint64),bool,uint8,bytes32))' \
  "$compat_profile_key" --json --rpc-url "$local_rpc")
compat_capability_lower=$(printf '%s' "$compat_capability" | tr '[:upper:]' '[:lower:]')
jq -e --arg capability "$compat_capability_lower" \
  '.[0][4] == 2 and .[0][6] == 2 and .[0][8][1] == 2 and .[0][9] == false and .[0][10] == 1 and ((.[0][11] | ascii_downcase) == $capability)' \
  <<<"$compat_state" >/dev/null

jq -n \
  --argjson transactions 15 \
  --argjson gasTotal "$actual_gas_total" \
  --argjson minimumMargin "$minimum_gas_margin" \
  --argjson finalLauncherNonce "$final_launcher_nonce" \
  --argjson finalSafeNonce "$final_safe_nonce" \
  '{status:"PASS",transactions:$transactions,gasTotal:$gasTotal,minimumMargin:$minimumMargin,finalLauncherNonce:$finalLauncherNonce,finalSafeNonce:$finalSafeNonce}'
