'use strict';

const { AgentError } = require('../agent/safety');

/** A web request that can't be made or answered. The model is told why, in words, so it can adjust. */
class WebError extends AgentError {}

module.exports = { WebError };
