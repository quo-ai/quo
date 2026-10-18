'use strict';

/** A problem with a provider request that the page can be told about, with a code it can act on. */
class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

module.exports = { ProviderError };
