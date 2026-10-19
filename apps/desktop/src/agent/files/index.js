'use strict';

/**
 * The file tools Code mode gives the model, one module each. Each takes a `ctx`
 * ({ rootReal, reads }): the project's real path, and what this session has read
 * (an edit needs a read first, and the file must not have changed since). Reading is
 * free; writing is planned (`planEdit`, `planWrite`) and only applied (`applyPlan`)
 * once the user has said yes.
 */

const { LIMITS, sha } = require('./limits');
const { listDirectory } = require('./list');
const { readFile } = require('./read');
const { findFiles } = require('./find');
const { searchText } = require('./search');
const { globToRegExp } = require('./glob');
const { unifiedDiff } = require('./diff');
const { planEdit, planWrite, applyPlan } = require('./edit');
const { suggestFiles } = require('./fuzzy');
const { listEntries, viewFile, existing } = require('./browse');

module.exports = { LIMITS, listEntries, viewFile, existing, suggestFiles, listDirectory, readFile, findFiles, searchText, planEdit, planWrite, applyPlan, unifiedDiff, globToRegExp, sha };
