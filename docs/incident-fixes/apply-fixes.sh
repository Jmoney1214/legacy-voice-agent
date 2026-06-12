#!/usr/bin/env bash
# apply-fixes.sh — apply all four incident fixes to local clones of the
# production repos. Idempotent: re-running on already-fixed checkouts is a
# no-op (each step checks for its own marker).
#
# Usage:
#   ./apply-fixes.sh \
#       --inventory-sync   ~/Projects/legacy-inventory-sync \
#       --elevenlabs-agent ~/Projects/legacy-elevenlabs-agent
#
# Then in each repo:
#   git diff                # review
#   git checkout -b fix/...
#   git commit -am "..."
#   git push -u origin HEAD
#
# Does NOT commit or push — you review first.

set -euo pipefail

INV=""
EL=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNIPPETS="$SCRIPT_DIR/snippets"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --inventory-sync)   INV="$2";        shift 2 ;;
    --elevenlabs-agent) EL="$2";         shift 2 ;;
    -h|--help)          sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$INV" && -z "$EL" ]]; then
  echo "Pass at least one of --inventory-sync or --elevenlabs-agent" >&2
  exit 2
fi

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m   %s\n' "$*"; }
skip(){ printf '\033[1;33m—\033[0m   %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m   %s\n' "$*" >&2; exit 1; }

# ---------- Fix 01: Lightspeed User-Agent ----------
if [[ -n "$INV" ]]; then
  log "Fix 01 — Lightspeed User-Agent in $INV"
  [[ -d "$INV/.git" ]] || die "not a git repo: $INV"
  src="$INV/src/index.ts"
  [[ -f "$src" ]] || die "missing $src"

  if grep -q 'legacy-inventory-sync/1.1' "$src"; then
    skip "User-Agent already present in $src"
  else
    # Surgical sed using awk so we don't mangle other fetch() blocks.
    python3 - "$src" <<'PY'
import re, sys
p = sys.argv[1]
src = open(p).read()
orig = src

ua = '"User-Agent": "legacy-inventory-sync/1.1 (+legacywineandliquor.com)"'

# Fix 1: refreshToken — headers: { "Content-Type": "..." }
src = re.sub(
    r'(headers:\s*\{\s*"Content-Type":\s*"application/x-www-form-urlencoded"\s*)\}',
    r'\1, ' + ua + r' }',
    src, count=1,
)

# Fix 2: fetchAllItems — headers: { Authorization: `Bearer ${token}` }
src = re.sub(
    r'(headers:\s*\{\s*Authorization:\s*`Bearer\s+\$\{token\}`\s*)\}',
    r'\1, ' + ua + r', Accept: "application/json" }',
    src, count=1,
)

if src == orig:
    print("WARN: no patterns matched; apply the patch manually from", file=sys.stderr)
    print("  docs/incident-fixes/snippets/01-lightspeed-user-agent.patch", file=sys.stderr)
    sys.exit(3)

open(p, 'w').write(src)
print("patched", p)
PY
    ok "Patched $src"
  fi
fi

# ---------- Fix 02 + 03 + 04 + 06: elevenlabs-agent ----------
if [[ -n "$EL" ]]; then
  log "Fixes 02/03/04/06 — in $EL"
  [[ -d "$EL/.git" ]] || die "not a git repo: $EL"

  # 02 — phone helper
  mkdir -p "$EL/src/util"
  if [[ -f "$EL/src/util/phone.ts" ]]; then
    skip "src/util/phone.ts already exists — leaving in place"
  else
    cp "$SNIPPETS/02-phone.ts" "$EL/src/util/phone.ts"
    ok "Wrote src/util/phone.ts"
  fi

  # 03 + 04 — drop reference handlers under a docs/ folder inside the target
  # repo so they're visible to reviewers, then print the manual wiring step.
  mkdir -p "$EL/docs/incident-fixes-snippets"
  cp "$SNIPPETS/03-lookup-customer.ts" "$EL/docs/incident-fixes-snippets/lookup-customer.reference.ts"
  cp "$SNIPPETS/04-check-inventory-fallback.ts" "$EL/docs/incident-fixes-snippets/check-inventory.reference.ts"
  ok "Wrote reference impls under docs/incident-fixes-snippets/"

  # 06 — post-call receiver
  mkdir -p "$EL/src/routes"
  if [[ -f "$EL/src/routes/post-call.ts" ]]; then
    skip "src/routes/post-call.ts already exists — leaving in place"
  else
    cp "$SNIPPETS/06-post-call-receiver.ts" "$EL/src/routes/post-call.ts"
    ok "Wrote src/routes/post-call.ts (you still need: app.post('/post-call', postCallHandler))"
  fi
fi

echo
log "Done. Next steps:"
if [[ -n "$INV" ]]; then
  cat <<EOF
  cd $INV
  git diff
  git checkout -b fix/lightspeed-user-agent
  git commit -am "fix: add User-Agent to Lightspeed API calls (Cloudflare 1010)"
  git push -u origin HEAD
  npx wrangler deploy

EOF
fi

if [[ -n "$EL" ]]; then
  cat <<EOF
  cd $EL
  git diff
  # Manual wiring still needed:
  #   1. Import { toBareDigits } from "./util/phone" in lookup_customer, log_caller, add_to_waitlist
  #      (see docs/incident-fixes-snippets/lookup-customer.reference.ts).
  #   2. Replace check_inventory body with docs/incident-fixes-snippets/check-inventory.reference.ts.
  #   3. Mount the post-call route in your main app:
  #        import { postCallHandler } from "./routes/post-call";
  #        app.post("/post-call", postCallHandler);
  #   4. Add ELEVENLABS_WEBHOOK_SECRET binding to wrangler.toml / Cloudflare secrets.
  git checkout -b fix/phone-and-inventory-and-webhook
  git commit -am "fix: phone normalization, inventory miss fallback, post-call receiver"
  git push -u origin HEAD
  npx wrangler deploy

  # Verify webhook is back online:
  ELEVENLABS_API_KEY=... \\
  WEBHOOK_URL=https://legacy-elevenlabs-agent.<your-acct>.workers.dev/post-call \\
    $SNIPPETS/05-elevenlabs-webhook-check.sh

EOF
fi
