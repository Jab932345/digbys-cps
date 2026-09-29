#!/usr/bin/env bash
# Digby's print server — install or update.
#
# On the Pi, over SSH (the first time asks for the Pi's password once):
#     curl -fsSL https://digbys-cps.vercel.app/pi/update.sh | bash
# After that, CPS → Manage → Printer can install updates by itself.
#
# Backs up the running server, installs the new one, checks it answers, and
# puts the previous one back if it doesn't. The pre-2.0 server is kept so its
# extra routes (receipt printer, butchery labels) keep working under the new one.
set -uo pipefail

BASE="${DIGBYS_UPDATE_BASE:-https://digbys-cps.vercel.app/pi}"
APP_USER="$(id -un)"
STATE="$HOME/.digbys"
PY="$HOME/printserver-env/bin/python"
SERVER="$HOME/printserver.py"
FROM_APP=0
[ "${1:-}" = "--from-app" ] && FROM_APP=1

say()  { printf '%s\n' "$*"; }
fail() { say "Stopped: $*"; exit 1; }
restart_server() {
  sudo -n /usr/bin/systemctl restart digbys-cps 2>/dev/null || sudo /usr/bin/systemctl restart digbys-cps
}

[ -x "$PY" ] || fail "no Python at $PY — is this the Digby's Pi?"
mkdir -p "$STATE/backups"
TS="$(date +%Y%m%d-%H%M%S)"

if [ -f "$SERVER" ]; then
  cp "$SERVER" "$STATE/backups/printserver-$TS.py"
  if ! grep -q DIGBYS_PRINTSERVER_V2 "$SERVER" && [ ! -f "$STATE/legacy_printserver.py" ]; then
    cp "$SERVER" "$STATE/legacy_printserver.py"
    say "Kept the previous server's routes (receipt printer, butchery labels)."
  fi
fi
# Only the last 10 backups
ls -1t "$STATE"/backups/printserver-*.py 2>/dev/null | tail -n +11 | xargs -r rm -f

say "Downloading the print server…"
curl -fsSL "$BASE/printserver.py?v=$TS" -o "$STATE/printserver.new.py" || fail "couldn't download — is the Pi online?"
grep -q DIGBYS_PRINTSERVER_V2 "$STATE/printserver.new.py" || fail "the download isn't the print server — nothing changed."
"$PY" -m py_compile "$STATE/printserver.new.py" || fail "the download is damaged — nothing changed."

if [ "$FROM_APP" -eq 0 ]; then
  say "Setting up permissions (the Pi's password, if asked)…"
  RULES="$STATE/sudoers.tmp"
  cat > "$RULES" <<EOF
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart digbys-cps, /bin/systemctl restart digbys-cps, /usr/bin/systemctl start --no-block digbys-cps-update, /bin/systemctl start --no-block digbys-cps-update, /usr/sbin/shutdown -h now, /sbin/shutdown -h now
EOF
  sudo visudo -cf "$RULES" >/dev/null || { rm -f "$RULES"; fail "permission rules rejected — nothing changed."; }
  sudo install -m 0440 -o root -g root "$RULES" /etc/sudoers.d/digbys-cps || fail "couldn't set permissions — nothing changed."
  rm -f "$RULES"
  UNIT="$STATE/update.service.tmp"
  cat > "$UNIT" <<EOF
[Unit]
Description=Update Digby's print server
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$APP_USER
ExecStart=/bin/bash -c 'curl -fsSL $BASE/update.sh | bash -s -- --from-app'
EOF
  sudo install -m 0644 -o root -g root "$UNIT" /etc/systemd/system/digbys-cps-update.service && rm -f "$UNIT"
  sudo /usr/bin/systemctl daemon-reload
fi

cp "$STATE/printserver.new.py" "$SERVER"
say "Restarting…"
restart_server

for _ in $(seq 1 30); do
  sleep 1
  OUT="$(curl -fsS --max-time 3 http://127.0.0.1:3000/status 2>/dev/null || true)"
  if printf '%s' "$OUT" | grep -q '"version"'; then
    "$PY" - "$OUT" <<'EOF'
import json, sys
d = json.loads(sys.argv[1])
printer = ('printer at ' + d['printer_ip']) if d.get('printer_ip') else 'looking for the printer'
kept = ', '.join(d.get('legacy_routes') or []) or 'none'
print("Done — print server %s is running · %s · kept routes: %s" % (d.get('version'), printer, kept))
EOF
    exit 0
  fi
done

say "The new server didn't answer — putting the previous one back."
if [ -f "$STATE/backups/printserver-$TS.py" ]; then
  cp "$STATE/backups/printserver-$TS.py" "$SERVER"
  restart_server
fi
exit 1
