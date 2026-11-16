#!/usr/bin/env bash
# One-time Garage setup for diagrams: a bucket, a read-write key for this
# service only, and the key in Vault where config.yaml's `secrets:` reads it.
#
#   VAULT_TOKEN=... bash scripts/garage-setup.sh
#   homelabctl vault --apply      # then let the service read kv/diagrams/s3
#
# Safe to re-run: the bucket and key are check-then-create (garage's
# `key create` mints a NEW key on every call, name is not unique, so it
# must never run twice), and the grant is re-applied every time.
#
# Without VAULT_TOKEN it prints the vault command instead of running it.
# The secret appears in that output: put it in Vault and clear the
# terminal.
set -euo pipefail

NS="${GARAGE_NS:-garage}"
POD="${GARAGE_POD:-garage-0}"
BUCKET="${DIAGRAMS_BUCKET:-diagrams}"
KEY="${DIAGRAMS_KEY:-diagrams}"
VAULT_PATH="${DIAGRAMS_VAULT_PATH:-kv/diagrams/s3}"

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
if [ -z "$id" ] || [ -z "$secret" ]; then
  echo "FATAL: could not read the key id and secret from 'garage key info'" >&2
  exit 1
fi

if [ -n "${VAULT_TOKEN:-}" ]; then
  vault kv put "$VAULT_PATH" access-key-id="$id" secret-access-key="$secret" >/dev/null
  echo "vault: wrote $VAULT_PATH (access-key-id, secret-access-key)"
else
  echo
  echo "VAULT_TOKEN is not set. Put the key in Vault yourself, then clear this output:"
  echo "  vault kv put $VAULT_PATH access-key-id=$id secret-access-key=$secret"
fi

echo
echo "next: homelabctl vault --apply   (from the diagrams directory)"
