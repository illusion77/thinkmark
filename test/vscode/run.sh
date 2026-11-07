#!/bin/sh
# Smoke test in an isolated instance of the installed VS Code (separate profile + extensions dir).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# VS Code's integrated terminal exports ELECTRON_RUN_AS_NODE=1, which would start the Code binary as
# plain Node and make it reject every flag below.
unset ELECTRON_RUN_AS_NODE
TMP="${THINKMARK_TMP:-$(mktemp -d)}"
APP="${VSCODE_APP:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}"
rm -rf "$TMP/work" && mkdir -p "$TMP/work"
export THINKMARK_TEST_DIR="$TMP/work"
export THINKMARK_TEST_NO_TRASH=1
# VS Code's IPC socket path must stay under 103 chars, so keep the profile short.
PROFILE="$(mktemp -d /tmp/tmk.XXXX)"
"$APP" --new-window --disable-extensions --skip-welcome --skip-release-notes --disable-workspace-trust \
  --user-data-dir "$PROFILE/u" --extensions-dir "$PROFILE/e" \
  --extensionDevelopmentPath="$ROOT" --extensionTestsPath="$ROOT/test/vscode/smoke.cjs" \
  "$TMP/work" > "$TMP/stdout.log" 2>&1 &
PID=$!
for i in $(seq 1 ${THINKMARK_WAIT:-90}); do
  [ -f "$TMP/work/results.json" ] && break
  kill -0 $PID 2>/dev/null || break
  sleep 1
done
sleep 1; kill $PID 2>/dev/null; sleep 1; if [ -n "$KEEP_PROFILE" ]; then echo "profile: $PROFILE" >&2; else rm -rf "$PROFILE"; fi
if [ -f "$TMP/work/results.json" ]; then cat "$TMP/work/results.json"; else echo "no results"; tail -30 "$TMP/stdout.log"; fi
