#!/usr/bin/env bash
# One-time Garage setup for diagrams: a bucket, a read-write key for this
# service only, and the key in Vault where config.yaml's `secrets:` reads it.
#
#   VAULT_TOKEN="$(op item get homelab-vault-root --fields password --reveal)" \
#     bash scripts/garage-setup.sh
#   homelabctl vault --apply      # then let the service read kv/diagrams/s3
#
# Safe to re-run: the bucket and key are check-then-create (garage's
# `key create` mints a NEW key on every call, name is not unique, so it
# must never run twice), and the grant is re-applied every time.
#
# The secret goes from garage into Vault on stdin, through `vault kv put`
# run inside the Vault pod, so it never reaches this terminal or a command
# line. Without VAULT_TOKEN it stops before changing anything.
set -euo pipefail

NS="${GARAGE_NS:-garage}"
POD="${GARAGE_POD:-garage-node-0}"
BUCKET="${DIAGRAMS_BUCKET:-diagrams}"
KEY="${DIAGRAMS_KEY:-diagrams}"
VAULT_PATH="${DIAGRAMS_VAULT_PATH:-kv/diagrams/s3}"
VAULT_NS="${VAULT_NS:-default}"
VAULT_POD="${VAULT_POD:-vault-0}"

g_try() { kubectl exec -n "$NS" "$POD" -- /garage "$@" 2>/dev/null; }
g() {
  local err rc=0
  err="$(mktemp)"
  trap 'rm -f "$err"' RETURN
  kubectl exec -n "$NS" "$POD" -- /garage "$@" 2>"$err" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: garage $* failed (exit $rc):" >&2
    cat "$err" >&2
  fi
  return "$rc"
}

if [ -z "${VAULT_TOKEN:-}" ]; then
  echo "VAULT_TOKEN is not set; nothing was changed. Run it as the header says." >&2
  exit 1
fi

echo "=== diagrams garage setup: ns=$NS pod=$POD bucket=$BUCKET key=$KEY ==="

if g_try bucket info "$BUCKET" >/dev/null; then
  echo "bucket: $BUCKET exists"
else
  g bucket create "$BUCKET" >/dev/null
  echo "bucket: $BUCKET created"
fi

if g_try key info "$KEY" >/dev/null; then
  echo "key: $KEY exists"
else
  g key create "$KEY" >/dev/null
  echo "key: $KEY created"
fi

g bucket allow --read --write "$BUCKET" --key "$KEY" >/dev/null
echo "grant: $KEY has RW on $BUCKET"

info="$(g key info "$KEY" --show-secret)"
id="$(printf '%s\n' "$info" | sed -n 's/^Key ID: *//p' | head -1)"
secret="$(printf '%s\n' "$info" | sed -n 's/^Secret key: *//p' | head -1)"
unset info
if [ -z "$id" ] || [ -z "$secret" ]; then
  echo "FATAL: could not read the key id and secret from 'garage key info'" >&2
  exit 1
fi

printf '%s' "$secret" | kubectl exec -i -n "$VAULT_NS" "$VAULT_POD" -- \
  env VAULT_TOKEN="$VAULT_TOKEN" vault kv put "$VAULT_PATH" access-key-id="$id" secret-access-key=- >/dev/null
unset secret
echo "vault: wrote $VAULT_PATH (access-key-id, secret-access-key)"

echo
echo "next: homelabctl vault --apply   (from the diagrams directory)"
