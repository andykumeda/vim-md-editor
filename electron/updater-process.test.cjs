'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isChildRunning } = require('./updater-process.cjs');

test('reports a child as running after a non-terminating signal', () => {
  assert.equal(
    isChildRunning({ killed: true, exitCode: null, signalCode: null }),
    true,
  );
});

test('reports exited and terminated children as stopped', () => {
  assert.equal(isChildRunning(null), false);
  assert.equal(isChildRunning({ exitCode: 0, signalCode: null }), false);
  assert.equal(isChildRunning({ exitCode: null, signalCode: 'SIGTERM' }), false);
});
