#!/bin/sh
# Removes the background service and the app icon. Your data (in the
# browser) and the project files are not touched.
set -eu
systemctl --user disable --now personal-data-analyst.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/personal-data-analyst.service" "$HOME/.local/share/applications/personal-data-analyst.desktop"
systemctl --user daemon-reload
echo "Removed the service and the icon. Your data in the browser is unchanged."
