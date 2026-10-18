'use strict';

/** True when an IPC message comes from the app's own pages (app://quo), not from anything else a window might show. */
function trusted(event) {
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'app:' && url.host === 'quo';
  } catch {
    return false;
  }
}

module.exports = { trusted };
