'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * The window icon on Linux. Wayland desktops find a window's icon through its app id (package.json "desktopName",
 * quo-desktop) and an installed .desktop file; without one (an AppImage started straight from the download, or `npm run
 * dev`) Plasma and GNOME show a generic icon, a "W" on Plasma. Electron also hands the icon to the window itself
 * (xdg-toplevel-icon on Wayland, _NET_WM_ICON on X11), which those desktops use when they have nothing better.
 * macOS and Windows take the icon from the app bundle or the .exe, so nothing is set there.
 */
function windowIcon({ platform = process.platform, packaged = false, resourcesPath = process.resourcesPath } = {}) {
  if (platform !== 'linux') return undefined;
  const file = packaged ? path.join(resourcesPath ?? '', 'icon.png') : path.join(__dirname, '..', 'build', 'icon.png');
  return fs.existsSync(file) ? file : undefined;
}

module.exports = { windowIcon };
