#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: ./find-polluter.sh \"<isolated-test-command>\" \"<full-suite-command>\"" >&2
  exit 1
fi

ISOLATED_CMD="$1"
FULL_CMD="$2"

echo "1) Running isolated command..."
if eval "$ISOLATED_CMD"; then
  echo "Isolated test passes."
else
  echo "Isolated test fails; this is not a polluter scenario." >&2
  exit 2
fi

echo "2) Running full suite command..."
if eval "$FULL_CMD"; then
  echo "Full suite passes; no polluter detected by this heuristic."
  exit 0
fi

echo "Full suite fails while isolated passes."
echo "Likely test pollution. Bisect failing order/group manually with your test runner."
