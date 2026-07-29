'use strict';

const path = require('path');

/**
 * Validate and normalize a user-supplied file name (basename only).
 * Throws Error with a user-facing message on invalid input.
 */
function normalizeFileName(requestedName) {
  const newName = typeof requestedName === 'string' ? requestedName.trim() : '';
  if (!newName) throw new Error('Enter a file name.');
  if (newName === '.' || newName === '..' || path.basename(newName) !== newName) {
    throw new Error('File names cannot include folder separators.');
  }
  return newName;
}

module.exports = { normalizeFileName };
