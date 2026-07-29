'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Move a file from sourcePath to destPath.
 * On cross-device EXDEV failures, copy to a temp file on the destination
 * volume, fsync, atomically rename over the destination, then unlink the source.
 * If anything fails after a partial temp write, the temp file is cleaned up and
 * the original source is left intact when possible.
 */
function relocatePath(sourcePath, destPath, io = fs) {
  if (sourcePath === destPath) return;

  try {
    io.renameSync(sourcePath, destPath);
    return;
  } catch (error) {
    if (!error || error.code !== 'EXDEV') throw error;
  }

  const destDir = path.dirname(destPath);
  const tmpPath = path.join(
    destDir,
    `.${path.basename(destPath)}.vimdown-tmp-${process.pid}-${Date.now()}`,
  );

  try {
    io.copyFileSync(sourcePath, tmpPath);

    const fd = io.openSync(tmpPath, 'r+');
    try {
      io.fsyncSync(fd);
    } finally {
      io.closeSync(fd);
    }

    // Atomic replace on the destination volume (overwrites an existing dest).
    io.renameSync(tmpPath, destPath);

    try {
      const dirFd = io.openSync(destDir, 'r');
      try {
        io.fsyncSync(dirFd);
      } finally {
        io.closeSync(dirFd);
      }
    } catch {
      // Directory fsync is best-effort; not supported on every filesystem.
    }

    io.unlinkSync(sourcePath);
  } catch (error) {
    try {
      if (typeof io.existsSync === 'function' ? io.existsSync(tmpPath) : true) {
        io.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup failures; surface the original error.
    }
    throw error;
  }
}

module.exports = { relocatePath };
