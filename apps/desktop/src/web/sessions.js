'use strict';

const { normalizeUrl } = require('./guard');

/**
 * Which addresses the model may open in a conversation: ones the user wrote, ones a search returned, and links on
 * pages it has read. Nothing else, so a page can't talk the model into opening an address it made up (with the
 * conversation or a file's contents written into it): an address can only be used as it was found.
 */

const MAX_SESSIONS = 12;
const MAX_URLS = 600;
const ID_SHAPE = /^[A-Za-z0-9_-]{4,80}$/;

class WebSessions {
  constructor() {
    this.sessions = new Map();
  }

  #get(id) {
    const key = String(id);
    if (!ID_SHAPE.test(key)) return null;
    let urls = this.sessions.get(key);
    if (!urls) {
      urls = new Set();
      if (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value);
    } else this.sessions.delete(key); // most recently used goes last
    this.sessions.set(key, urls);
    return urls;
  }

  allow(id, urls) {
    const set = this.#get(id);
    if (!set) return;
    for (const url of urls) {
      if (set.size >= MAX_URLS) set.delete(set.values().next().value);
      set.add(normalizeUrl(url));
    }
  }

  allows(id, url) {
    return this.#get(id)?.has(normalizeUrl(url)) ?? false;
  }
}

module.exports = { WebSessions };
