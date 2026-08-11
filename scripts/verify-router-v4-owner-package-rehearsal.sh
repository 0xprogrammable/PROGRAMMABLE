#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 <owner-package.json> <evidence-output.json> [archive-rpc]" >&2
  exit 64
fi

package=$1
output=$2
upstream=${3:-https://mainnet.gateway.tenderly.co}
port=${ROUTER_V4_PACKAGE_ANVIL_PORT:-9866}
rpc="http://127.0.0.1:${port}"
launcher=$(jq -r .launcher.address "$package")
safe=$(jq -r .safe.address "$package")
base_nonce=$(jq -r .launcher.pendingNonce "$package")
base_safe_nonce=$(jq -r .safe.nonce "$package")
block=$(jq -r .chain.finalizedBlockNumber "$package")
expected_block_hash=$(jq -r .chain.finalizedBlockHash "$package")
kernel=$(jq -r '.prestate.vacancy[] | select(.name=="ProgrammableUniversalLaunchKernelV1") | .address' "$package")
registry=$(jq -r '.prestate.vacancy[] | select(.name=="ProgrammableCompletedGraphAdoptionGrantRegistryV1") | .address' "$package")
profile_key=$(jq -r .expectedPoststate.completedGraphAdoptionCompat.profileKey "$package")
governance=$(jq -r '.rollback.afterCompatOuterTransactionReverted[0].safe.to' "$package")
prevalidated_marker=$(jq -r '.transactions[] | select(.safe != null) | .safe.prevalidatedMarker' "$package" | head -n 1)
temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/router-v4-owner-rehearsal.XXXXXX")
records="$temp_dir/records.jsonl"
anvil_pid=

cleanup() {
  if [[ -n "$anvil_pid" ]] && kill -0 "$anvil_pid" 2>/dev/null; then
    kill "$anvil_pid" 2>/dev/null || true
    wait "$anvil_pid" 2>/dev/null || true
  fi
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT

for command in anvil cast jq python3 shasum; do
  command -v "$command" >/dev/null || {
    echo "$command is required" >&2
    exit 64
  }
done

anvil \
  --fork-url "$upstream" \
  --fork-block-number "$block" \
  --chain-id 1 \
  --hardfork osaka \
  --enable-tx-gas-limit \
  --accounts 0 \
  --host 127.0.0.1 \
  --port "$port" \
  >"$temp_dir/anvil.log" 2>&1 &
anvil_pid=$!

ready=false
for _ in $(seq 1 60); do
  if [[ "$(cast chain-id --rpc-url "$rpc" 2>/dev/null || true)" == 1 ]]; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  tail -n 100 "$temp_dir/anvil.log" >&2 || true
  exit 1
fi

actual_block_hash=$(cast block "$block" --field hash --rpc-url "$rpc")
actual_block_hash_lower=$(printf '%s' "$actual_block_hash" | tr '[:upper:]' '[:lower:]')
expected_block_hash_lower=$(printf '%s' "$expected_block_hash" | tr '[:upper:]' '[:lower:]')
[[ "$actual_block_hash_lower" == "$expected_block_hash_lower" ]] || {
  echo "fork block hash mismatch: expected $expected_block_hash, got $actual_block_hash" >&2
  exit 1
}

cast rpc --rpc-url "$rpc" anvil_impersonateAccount "$launcher" >/dev/null
cast rpc --rpc-url "$rpc" anvil_setBalance "$launcher" 0x56BC75E2D63100000 >/dev/null

success_topic=$(cast keccak 'ExecutionSuccess(bytes32,uint256)')
failure_topic=$(cast keccak 'ExecutionFailure(bytes32,uint256)')

send_record() {
  local json=$1
  local branch=$2
  local record_kind=$3
  local safe_event=$4
  local primary_index=${5:-null}
  local expected_status=${6:-0x1}
  local phase to data nonce gas_limit max_fee max_tip receipt status gas tx_hash tx_json
  local success_seen=false
  local failure_seen=false

  phase=$(jq -r .phase <<<"$json")
  to=$(jq -r .to <<<"$json")
  data=$(jq -r .data <<<"$json")
  nonce=$(jq -r .nonce <<<"$json")
  gas_limit=$(jq -r .gasLimit <<<"$json")
  max_fee=$(jq -r .maxFeePerGasWei <<<"$json")
  max_tip=$(jq -r .maxPriorityFeePerGasWei <<<"$json")
  receipt=$(cast send "$to" \
    --from "$launcher" \
    --unlocked \
    --nonce "$nonce" \
    --data "$data" \
    --gas-limit "$gas_limit" \
    --gas-price "$max_fee" \
    --priority-gas-price "$max_tip" \
    --rpc-timeout 120 \
    --rpc-url "$rpc" \
    --json)
  status=$(jq -r .status <<<"$receipt")
  gas=$(( $(jq -r .gasUsed <<<"$receipt") ))
  [[ "$status" == "$expected_status" ]] || {
    echo "$branch/$phase status mismatch: expected $expected_status, got $status" >&2
    exit 1
  }

  if jq -e --arg safe "$(printf '%s' "$safe" | tr '[:upper:]' '[:lower:]')" --arg topic "$(printf '%s' "$success_topic" | tr '[:upper:]' '[:lower:]')" \
    'any(.logs[]; ((.address|ascii_downcase)==$safe and (.topics[0]|ascii_downcase)==$topic))' \
    <<<"$receipt" >/dev/null; then
    success_seen=true
  fi
  if jq -e --arg safe "$(printf '%s' "$safe" | tr '[:upper:]' '[:lower:]')" --arg topic "$(printf '%s' "$failure_topic" | tr '[:upper:]' '[:lower:]')" \
    'any(.logs[]; ((.address|ascii_downcase)==$safe and (.topics[0]|ascii_downcase)==$topic))' \
    <<<"$receipt" >/dev/null; then
    failure_seen=true
  fi
  case "$safe_event" in
    NONE) [[ "$success_seen" == false && "$failure_seen" == false ]] ;;
    SUCCESS) [[ "$success_seen" == true && "$failure_seen" == false ]] ;;
    FAILURE) [[ "$success_seen" == false && "$failure_seen" == true ]] ;;
    *) echo "invalid safe event expectation: $safe_event" >&2; exit 64 ;;
  esac

  tx_hash=$(jq -r .transactionHash <<<"$receipt")
  tx_json=$(cast rpc --rpc-url "$rpc" eth_getTransactionByHash "$tx_hash")
  jq -cn \
    --arg branch "$branch" \
    --arg recordKind "$record_kind" \
    --arg phase "$phase" \
    --argjson primaryIndex "$primary_index" \
    --arg dataKeccak256 "$(cast keccak "$data")" \
    --arg signingHash "$(jq -r '.signingHash // ""' <<<"$json")" \
    --argjson gasUsed "$gas" \
    --arg safeEvent "$safe_event" \
    --argjson receipt "$(jq -cS . <<<"$receipt")" \
    --argjson transaction "$(jq -cS . <<<"$tx_json")" \
    '{branch:$branch,recordKind:$recordKind,phase:$phase,primaryIndex:$primaryIndex,dataKeccak256:$dataKeccak256,signingHash:$signingHash,gasUsed:$gasUsed,safeEvent:$safeEvent,receipt:$receipt,transaction:$transaction}' \
    >>"$records"
}

universal_killed() {
  local raw
  raw=$(cast call "$kernel" --data 0x982ebb7b --rpc-url "$rpc")
  python3 - "$raw" <<'PY'
import sys
from eth_abi import decode
print(str(decode(['(bytes32,uint64,bytes32,uint64,bytes32,uint64,bytes32,bool)'], bytes.fromhex(sys.argv[1][2:]))[0][-1]).lower())
PY
}

compat_killed() {
  local calldata raw
  calldata=$(cast calldata 'preflightControlStateV1(bytes32)' "$profile_key")
  raw=$(cast call "$registry" --data "$calldata" --rpc-url "$rpc")
  python3 - "$raw" <<'PY'
import sys
from eth_abi import decode
t='(bytes32,uint16,bytes32,bytes32,uint64,bytes32,uint64,bytes32,(bytes32,uint64),bool,uint8,bytes32)'
print(str(decode([t], bytes.fromhex(sys.argv[1][2:]))[0][9]).lower())
PY
}

for index in $(seq 0 13); do
  record=$(jq -c ".transactions[$index]" "$package")
  if [[ "$(jq -r '.safe == null' <<<"$record")" == true ]]; then event=NONE; else event=SUCCESS; fi
  send_record "$record" PRIMARY PRIMARY "$event" "$((index + 1))"
done
[[ "$(universal_killed)" == false ]]
[[ "$(compat_killed)" == true ]]

base_snapshot=$(cast rpc --rpc-url "$rpc" evm_snapshot | jq -r .)

rollback=$(jq -c '.rollback.afterUniversalBeforeCompat[0]' "$package")
send_record "$rollback" AFTER_UNIVERSAL_BEFORE_COMPAT ROLLBACK SUCCESS
[[ "$(universal_killed)" == true ]]
cast rpc --rpc-url "$rpc" evm_revert "$base_snapshot" >/dev/null

base_snapshot=$(cast rpc --rpc-url "$rpc" evm_snapshot | jq -r .)
failure_data=$(cast calldata \
  'execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)' \
  "$governance" 0 0xffffffff 0 0 0 0 \
  0x0000000000000000000000000000000000000000 \
  0x0000000000000000000000000000000000000000 \
  "$prevalidated_marker")
failure_record=$(jq -cn \
  --arg phase SYNTHETIC_COMPAT_OUTER_REVERT_SETUP \
  --arg to "$safe" \
  --arg data "$failure_data" \
  --argjson nonce "$((base_nonce + 14))" \
  --argjson gasLimit 16777216 \
  --arg maxFeePerGasWei "$(jq -r .feeAndCostBounds.maxFeePerGasWei "$package")" \
  --arg maxPriorityFeePerGasWei "$(jq -r .feeAndCostBounds.maxPriorityFeePerGasWei "$package")" \
  '{phase:$phase,to:$to,data:$data,nonce:$nonce,gasLimit:$gasLimit,maxFeePerGasWei:$maxFeePerGasWei,maxPriorityFeePerGasWei:$maxPriorityFeePerGasWei}')
send_record "$failure_record" AFTER_COMPAT_OUTER_REVERT SYNTHETIC_SETUP NONE null 0x0
[[ "$(cast call "$safe" 'nonce()(uint256)' --rpc-url "$rpc")" -eq $((base_safe_nonce + 5)) ]]
rollback=$(jq -c '.rollback.afterCompatOuterTransactionReverted[0]' "$package")
send_record "$rollback" AFTER_COMPAT_OUTER_REVERT ROLLBACK SUCCESS
[[ "$(universal_killed)" == true ]]
[[ "$(compat_killed)" == true ]]
cast rpc --rpc-url "$rpc" evm_revert "$base_snapshot" >/dev/null

record=$(jq -c '.transactions[14]' "$package")
send_record "$record" PRIMARY PRIMARY SUCCESS 15
[[ "$(universal_killed)" == false ]]
[[ "$(compat_killed)" == false ]]

for index in 0 1; do
  rollback=$(jq -c ".rollback.afterCompatWholeStackMismatch[$index]" "$package")
  send_record "$rollback" AFTER_COMPAT_WHOLE_STACK_MISMATCH ROLLBACK SUCCESS
done
[[ "$(compat_killed)" == true ]]
[[ "$(universal_killed)" == true ]]

python3 - "$package" "$records" "$output" "$upstream" "$actual_block_hash" "$0" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

package_path, records_path, output_path, upstream, actual_block_hash, script_path = sys.argv[1:]
package = json.loads(Path(package_path).read_text())
records = [json.loads(line) for line in Path(records_path).read_text().splitlines()]

for record in records:
    receipt_bytes = (json.dumps(record["receipt"], sort_keys=True, separators=(",", ":")) + "\n").encode()
    tx_bytes = (json.dumps(record["transaction"], sort_keys=True, separators=(",", ":")) + "\n").encode()
    record["receiptCanonicalSha256"] = hashlib.sha256(receipt_bytes).hexdigest()
    record["transactionCanonicalSha256"] = hashlib.sha256(tx_bytes).hexdigest()

primary = sorted((record for record in records if record["recordKind"] == "PRIMARY"), key=lambda value: value["primaryIndex"])
expected_gas = [value["coldPinnedForkGasUsed"] for value in package["transactions"]]
actual_gas = [value["gasUsed"] for value in primary]
if actual_gas != expected_gas:
    raise SystemExit(f"primary cold gas drift: expected {expected_gas}, got {actual_gas}")
if [value["dataKeccak256"].lower() for value in primary] != [value["dataKeccak256"].lower() for value in package["transactions"]]:
    raise SystemExit("primary data hash drift")

branches = {}
for branch in (
    "AFTER_UNIVERSAL_BEFORE_COMPAT",
    "AFTER_COMPAT_OUTER_REVERT",
    "AFTER_COMPAT_WHOLE_STACK_MISMATCH",
):
    values = [record for record in records if record["branch"] == branch]
    if not values:
        raise SystemExit(f"missing rollback branch evidence: {branch}")
    branches[branch] = values

evidence = {
    "schemaVersion": "router-v4-owner-package-rehearsal-evidence-v1",
    "status": "PASS",
    "intentBundleHash": package["intentBundleHash"],
    "sourceBinding": package["sourceBinding"],
    "ownerPayloadsSha256": package["sourceBinding"]["ownerPayloadsSha256"],
    "rehearsalScriptSha256": hashlib.sha256(Path(script_path).read_bytes()).hexdigest(),
    "fork": {
        "chainId": package["chain"]["chainId"],
        "blockNumber": package["chain"]["finalizedBlockNumber"],
        "blockHash": actual_block_hash,
        "upstreamClass": "MAINNET_ARCHIVE",
        "upstreamEndpointRecorded": False,
        "runtime": "ANVIL_1.7.1_OSAKA_ENABLE_TX_GAS_LIMIT_ACCOUNTS_0",
    },
    "primary": {
        "status": "PASS",
        "transactionCount": len(primary),
        "gasUsed": actual_gas,
        "gasTotal": sum(actual_gas),
        "minimumGasMargin": min(value["gasLimit"] - gas for value, gas in zip(package["transactions"], actual_gas)),
        "records": primary,
    },
    "rollbackBranches": {
        "status": "PASS",
        "records": branches,
        "universalKilledReadback": True,
        "completedGraphAdoptionCompatKilledReadback": True,
        "outerRevertBranchSetup": "SYNTHETIC_REVERTING_SAFE_INNER_CALL_PROVES_GS013_OUTER_STATUS_0_EOA_NONCE_CONSUMED_SAFE_NONCE_UNCHANGED",
    },
    "claimBoundary": package["claimBoundary"],
}
encoded = (json.dumps(evidence, indent=2, sort_keys=True) + "\n").encode()
Path(output_path).parent.mkdir(parents=True, exist_ok=True)
Path(output_path).write_bytes(encoded)
print(json.dumps({
    "status": evidence["status"],
    "records": len(records),
    "gasTotal": sum(actual_gas),
    "minimumGasMargin": evidence["primary"]["minimumGasMargin"],
    "outputSha256": hashlib.sha256(encoded).hexdigest(),
}, separators=(",", ":")))
PY
