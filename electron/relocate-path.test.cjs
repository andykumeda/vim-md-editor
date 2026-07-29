'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { relocatePath } = require('./relocate-path.cjs');
const { normalizeFileName } = require('./file-name.cjs');

test('normalizeFileName accepts a plain basename', () => {
  assert.equal(normalizeFileName(' notes.md '), 'notes.md');
});

test('normalizeFileName rejects empty and path-like names', () => {
  assert.throws(() => normalizeFileName(''), /Enter a file name/);
  assert.throws(() => normalizeFileName('..'), /folder separators/);
  assert.throws(() => normalizeFileName('../escape.md'), /folder separators/);
  assert.throws(() => normalizeFileName('a/b.md'), /folder separators/);
});

test('relocatePath renames on the same volume', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vimdown-relocate-'));
  const source = path.join(dir, 'source.md');
  const dest = path.join(dir, 'dest.md');
  fs.writeFileSync(source, 'hello\n');

  relocatePath(source, dest);

  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('relocatePath overwrites an existing destination via rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vimdown-relocate-'));
  const source = path.join(dir, 'source.md');
  const dest = path.join(dir, 'dest.md');
  fs.writeFileSync(source, 'new\n');
  fs.writeFileSync(dest, 'old\n');

  relocatePath(source, dest);

  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'new\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('relocatePath EXDEV path copies via temp, then unlinks source', () => {
  const ops = [];
  const files = new Map([
    ['/volA/source.md', 'content'],
  ]);
  let renameCount = 0;

  const io = {
    renameSync(from, to) {
      ops.push(['rename', from, to]);
      renameCount += 1;
      if (renameCount === 1) {
        const error = new Error('cross-device link');
        error.code = 'EXDEV';
        throw error;
      }
      const data = files.get(from);
      files.delete(from);
      files.set(to, data);
    },
    copyFileSync(from, to) {
      ops.push(['copy', from, to]);
      assert.ok(files.has(from));
      files.set(to, files.get(from));
    },
    openSync(target) {
      ops.push(['open', target]);
      return 7;
    },
    fsyncSync(fd) {
      ops.push(['fsync', fd]);
    },
    closeSync(fd) {
      ops.push(['close', fd]);
    },
    unlinkSync(target) {
      ops.push(['unlink', target]);
      files.delete(target);
    },
    existsSync(target) {
      return files.has(target);
    },
  };

  relocatePath('/volA/source.md', '/volB/dest.md', io);

  assert.equal(files.has('/volA/source.md'), false);
  assert.equal(files.get('/volB/dest.md'), 'content');
  assert.ok(ops.some(([op]) => op === 'copy'));
  assert.ok(ops.some(([op]) => op === 'fsync'));
  assert.ok(![...files.keys()].some((name) => name.includes('.vimdown-tmp-')));
});

test('relocatePath EXDEV cleans up temp file when copy fails', () => {
  const files = new Map([['/volA/source.md', 'content']]);
  let renameCount = 0;

  const io = {
    renameSync() {
      renameCount += 1;
      if (renameCount === 1) {
        const error = new Error('cross-device link');
        error.code = 'EXDEV';
        throw error;
      }
    },
    copyFileSync() {
      const error = new Error('disk full');
      error.code = 'ENOSPC';
      throw error;
    },
    openSync() {
      throw new Error('should not open');
    },
    fsyncSync() {},
    closeSync() {},
    unlinkSync(target) {
      files.delete(target);
    },
    existsSync(target) {
      return files.has(target);
    },
  };

  assert.throws(
    () => relocatePath('/volA/source.md', '/volB/dest.md', io),
    /disk full/,
  );
  assert.equal(files.get('/volA/source.md'), 'content');
  assert.equal(files.has('/volB/dest.md'), false);
});
