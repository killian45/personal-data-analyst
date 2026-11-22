#!/bin/sh
# Installs the Personal Data Analyst background service and app icon for
# the current user (no administrator rights needed). Safe to run again.
set -eu
PROJECT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
NODE=$(command -v node)
if flatpak info org.gnome.Epiphany >/dev/null 2>&1; then
  BROWSER="flatpak run org.gnome.Epiphany"
elif command -v epiphany >/dev/null 2>&1; then
  BROWSER="epiphany"
else
  BROWSER="xdg-open"
fi
UNIT_DIR="$HOME/.config/systemd/user"
APP_DIR="$HOME/.local/share/applications"
mkdir -p "$UNIT_DIR" "$APP_DIR"
sed -e "s#@PROJECT_DIR@#$PROJECT_DIR#g" -e "s#@NODE@#$NODE#g" \
  "$PROJECT_DIR/scripts/app/personal-data-analyst.service.in" > "$UNIT_DIR/personal-data-analyst.service"
sed -e "s#@PROJECT_DIR@#$PROJECT_DIR#g" -e "s#@BROWSER@#$BROWSER#g" \
  "$PROJECT_DIR/scripts/app/personal-data-analyst.desktop.in" > "$APP_DIR/personal-data-analyst.desktop"
systemctl --user daemon-reload
systemctl --user enable personal-data-analyst.service
echo "Installed: service (starts at login) and the 'Personal Data Analyst' icon (opens with: $BROWSER)."
echo "Next: stop 'npm run dev' if it is running, then run: npm run app:update"
