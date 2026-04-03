#!/usr/bin/env bash
set -euo pipefail

# Install Pi Bran Toolkit into global Pi config (~/.pi/agent/)
# Run from the repo root after cloning.

PI_GLOBAL="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing Pi Bran Toolkit..."
echo "  Source: $REPO_DIR"
echo "  Target: $PI_GLOBAL"
echo ""

# Create global dirs
mkdir -p "$PI_GLOBAL/agents"
mkdir -p "$PI_GLOBAL/skills"
mkdir -p "$PI_GLOBAL/extensions"
mkdir -p "$PI_GLOBAL/packages"

# Agents
cp -R "$REPO_DIR/.pi/agents/"*.md "$PI_GLOBAL/agents/"
echo "  ✓ Agents ($(ls "$REPO_DIR/.pi/agents/"*.md | wc -l | tr -d ' '))"

# Skills
for skill in "$REPO_DIR/.pi/skills/"*/; do
  name="$(basename "$skill")"
  rm -rf "$PI_GLOBAL/skills/$name"
  cp -R "$skill" "$PI_GLOBAL/skills/$name"
done
echo "  ✓ Skills ($(ls -d "$REPO_DIR/.pi/skills/"*/ | wc -l | tr -d ' '))"

# Extensions
cp "$REPO_DIR/.pi/extensions/"*.ts "$PI_GLOBAL/extensions/"
echo "  ✓ Extensions ($(ls "$REPO_DIR/.pi/extensions/"*.ts | wc -l | tr -d ' '))"

# Vendored packages
rm -rf "$PI_GLOBAL/packages/subagents"
cp -R "$REPO_DIR/.pi/packages/subagents" "$PI_GLOBAL/packages/subagents"
echo "  ✓ Vendored subagents package"

# AGENTS.md
cp "$REPO_DIR/AGENTS.md" "$PI_GLOBAL/AGENTS.md"
echo "  ✓ AGENTS.md"

# Register subagents package in global settings (preserving existing settings)
SETTINGS="$PI_GLOBAL/settings.json"
PACKAGE_PATH="$PI_GLOBAL/packages/subagents"

if [ -f "$SETTINGS" ]; then
  # Check if already registered
  if grep -q "$PACKAGE_PATH" "$SETTINGS" 2>/dev/null; then
    echo "  ✓ Package already registered in settings.json"
  else
    # Add to existing packages array (or create one)
    TMP=$(mktemp)
    python3 -c "
import json, sys
with open('$SETTINGS') as f:
    s = json.load(f)
pkgs = s.get('packages', [])
pkgs.append('$PACKAGE_PATH')
s['packages'] = pkgs
with open('$TMP', 'w') as f:
    json.dump(s, f, indent=2)
    f.write('\n')
"
    mv "$TMP" "$SETTINGS"
    echo "  ✓ Package registered in settings.json"
  fi
else
  echo "{\"packages\":[\"$PACKAGE_PATH\"]}" | python3 -m json.tool > "$SETTINGS"
  echo "  ✓ Created settings.json with package"
fi

echo ""
echo "Done! Restart pi to pick up changes."
