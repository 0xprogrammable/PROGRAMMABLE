#!/bin/zsh
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
port="4178"
url="http://127.0.0.1:${port}/ops/protocol-fee-claim/"

if curl --silent --fail --max-time 1 "$url" >/dev/null 2>&1; then
  open "$url"
  exit 0
fi

cd "$repo_root"
python3 -m http.server "$port" --bind 127.0.0.1 >/tmp/programmable-fee-claim.log 2>&1 &
server_pid="$!"
trap 'kill "$server_pid" >/dev/null 2>&1 || true' EXIT INT TERM

for _ in {1..20}; do
  if curl --silent --fail --max-time 1 "$url" >/dev/null 2>&1; then
    open "$url"
    wait "$server_pid"
    exit 0
  fi
  sleep 0.1
done

echo "Das lokale Claim-Fenster konnte nicht gestartet werden."
echo "Details: /tmp/programmable-fee-claim.log"
exit 1
