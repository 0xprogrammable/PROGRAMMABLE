#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
psql_bin="${PSQL:-psql}"

if ! command -v "$psql_bin" >/dev/null 2>&1; then
  echo "psql is required for the two-session concurrency harness" >&2
  exit 127
fi

connection_args=()
if [[ -n "${PROGRAMMABLE_DATABASE_URL:-}" ]]; then
  connection_args=("$PROGRAMMABLE_DATABASE_URL")
elif [[ -n "${DATABASE_URL:-}" ]]; then
  connection_args=("$DATABASE_URL")
fi

tmp_root="${TMPDIR:-/tmp}"
tmp_dir="$(mktemp -d "${tmp_root%/}/programmable-concurrency.XXXXXX")"

cleanup() {
  find "$tmp_dir" -type f -delete
  rmdir "$tmp_dir"
}
trap cleanup EXIT

run_phase() {
  local file="$1"
  local phase="$2"
  shift 2
  local all_phases=("$@")
  local variable_args=()
  local name
  for name in "${all_phases[@]}"; do
    variable_args+=("-v" "${name}=0")
  done
  variable_args+=("-v" "${phase}=1")
  "$psql_bin" "${connection_args[@]}" -X -v ON_ERROR_STOP=1 \
    "${variable_args[@]}" -f "$file"
}

run_pair() {
  local file="$1"
  local phase_a="$2"
  local phase_b="$3"
  shift 3
  local all_phases=("$@")
  local output_a="$tmp_dir/${phase_a}.out"
  local output_b="$tmp_dir/${phase_b}.out"
  local pid_a
  local pid_b
  local status=0

  run_phase "$file" "$phase_a" "${all_phases[@]}" >"$output_a" 2>&1 &
  pid_a=$!
  run_phase "$file" "$phase_b" "${all_phases[@]}" >"$output_b" 2>&1 &
  pid_b=$!

  wait "$pid_a" || status=1
  wait "$pid_b" || status=1
  cat "$output_a"
  cat "$output_b"
  if [[ "$status" -ne 0 ]]; then
    echo "concurrent phase failed: $phase_a / $phase_b" >&2
    exit 1
  fi
}

projector_file="$script_dir/projector_checkpoint_sessions.sql"
projector_phases=(
  setup pointer_a pointer_b lease_a lease_b different_a different_b
  stale_a stale_b checkpoint_setup checkpoint_a checkpoint_b
  reorg_setup reorg_a reorg_b rollback_a rollback_b verify
)
run_phase "$projector_file" setup "${projector_phases[@]}"
run_pair "$projector_file" pointer_a pointer_b "${projector_phases[@]}"
run_pair "$projector_file" lease_a lease_b "${projector_phases[@]}"
run_pair "$projector_file" different_a different_b "${projector_phases[@]}"
run_pair "$projector_file" stale_a stale_b "${projector_phases[@]}"
run_phase "$projector_file" checkpoint_setup "${projector_phases[@]}"
run_pair "$projector_file" checkpoint_a checkpoint_b "${projector_phases[@]}"
run_phase "$projector_file" reorg_setup "${projector_phases[@]}"
run_pair "$projector_file" reorg_a reorg_b "${projector_phases[@]}"
run_pair "$projector_file" rollback_a rollback_b "${projector_phases[@]}"
run_phase "$projector_file" verify "${projector_phases[@]}"

profile_file="$script_dir/profile_claim_sessions.sql"
profile_phases=(
  setup first_wallet_a first_wallet_b first_alias_a first_alias_b after_first
  ownership_a ownership_b recover_a recover_b rekey_a rekey_b
  alias_claim_a alias_claim_b recover_mutate_a recover_mutate_b
  revision_a revision_b verify
)
run_phase "$profile_file" setup "${profile_phases[@]}"
run_pair "$profile_file" first_wallet_a first_wallet_b "${profile_phases[@]}"
run_pair "$profile_file" first_alias_a first_alias_b "${profile_phases[@]}"
run_phase "$profile_file" after_first "${profile_phases[@]}"
run_pair "$profile_file" ownership_a ownership_b "${profile_phases[@]}"
run_pair "$profile_file" recover_a recover_b "${profile_phases[@]}"
run_pair "$profile_file" rekey_a rekey_b "${profile_phases[@]}"
run_pair "$profile_file" alias_claim_a alias_claim_b "${profile_phases[@]}"
run_pair "$profile_file" recover_mutate_a recover_mutate_b "${profile_phases[@]}"
run_pair "$profile_file" revision_a revision_b "${profile_phases[@]}"
run_phase "$profile_file" verify "${profile_phases[@]}"

username_file="$script_dir/username_sessions.sql"
username_phases=(setup collision_a collision_b verify)
run_phase "$username_file" setup "${username_phases[@]}"
run_pair "$username_file" collision_a collision_b "${username_phases[@]}"
run_phase "$username_file" verify "${username_phases[@]}"

echo "two-session concurrency harness passed"
