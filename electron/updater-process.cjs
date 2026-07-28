'use strict';

function isChildRunning(child) {
  return child !== null && child.exitCode === null && child.signalCode === null;
}

module.exports = { isChildRunning };
