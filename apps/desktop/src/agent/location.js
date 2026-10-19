'use strict';

const os = require('node:os');
const path = require('node:path');

/** Where a project is, for telling two with the same name apart: the last few folders, with the home folder as ~. Never the full path. */
function whereIs(directory) {
  const home = os.homedir();
  const shown = (directory.startsWith(home) ? `~${directory.slice(home.length)}` : directory).split(path.sep).join('/');
  const parts = shown.split('/');
  return parts.length > 4 ? `…/${parts.slice(-3).join('/')}` : shown;
}

module.exports = { whereIs };
