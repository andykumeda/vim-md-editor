'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', ...options });
}

function sign(identity, target, extraArgs = []) {
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    identity,
    '--options',
    'runtime',
    '--timestamp=none',
    ...extraArgs,
    target,
  ]);
}

exports.default = async function signMacApp(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const identity = process.env.VIMDOWN_SIGN_IDENTITY;
  const updaterBinDir = process.env.VIMDOWN_UPDATER_BIN_DIR;
  if (!identity) {
    console.log('VIMDOWN_SIGN_IDENTITY is unset; leaving the local build unsigned.');
    return;
  }
  if (!updaterBinDir) {
    throw new Error('VIMDOWN_UPDATER_BIN_DIR is unset; build the Sparkle helper first.');
  }

  const productName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productName}.app`);
  const contentsPath = path.join(appPath, 'Contents');
  const resourcesPath = path.join(contentsPath, 'Resources');
  const frameworksPath = path.join(contentsPath, 'Frameworks');
  const updaterPath = path.join(resourcesPath, 'VimDownUpdater');
  const sparklePath = path.join(frameworksPath, 'Sparkle.framework');
  const sourceUpdaterPath = path.join(updaterBinDir, 'VimDownUpdater');
  const sourceSparklePath = path.join(updaterBinDir, 'Sparkle.framework');

  fs.copyFileSync(sourceUpdaterPath, updaterPath);
  fs.chmodSync(updaterPath, 0o755);
  fs.rmSync(sparklePath, { recursive: true, force: true });
  fs.cpSync(sourceSparklePath, sparklePath, {
    recursive: true,
    verbatimSymlinks: true,
  });

  try {
    run('/usr/bin/install_name_tool', [
      '-add_rpath',
      '@executable_path/../Frameworks',
      updaterPath,
    ]);
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`;
    if (!output.includes('would duplicate path')) throw error;
  }

  const sparkleVersionPath = fs.existsSync(path.join(sparklePath, 'Versions', 'B'))
    ? path.join(sparklePath, 'Versions', 'B')
    : fs
        .readdirSync(path.join(sparklePath, 'Versions'), { withFileTypes: true })
        .find((entry) => entry.isDirectory() && /^[A-Z]$/.test(entry.name))
        ?.name;
  const sparkleBundlePath =
    typeof sparkleVersionPath === 'string' && path.isAbsolute(sparkleVersionPath)
      ? sparkleVersionPath
      : path.join(sparklePath, 'Versions', sparkleVersionPath || 'B');

  const xpcPath = path.join(sparkleBundlePath, 'XPCServices');
  if (fs.existsSync(xpcPath)) {
    for (const entry of fs.readdirSync(xpcPath)) {
      if (entry.endsWith('.xpc')) {
        sign(identity, path.join(xpcPath, entry));
      }
    }
  }

  const sparkleUpdaterApp = path.join(sparkleBundlePath, 'Updater.app');
  if (fs.existsSync(sparkleUpdaterApp)) {
    sign(identity, sparkleUpdaterApp, ['--deep']);
  }
  const sparkleAutoupdate = path.join(sparkleBundlePath, 'Autoupdate');
  if (fs.existsSync(sparkleAutoupdate)) {
    sign(identity, sparkleAutoupdate);
  }
  sign(identity, sparklePath);
  sign(identity, updaterPath, [
    '--entitlements',
    path.resolve('electron', 'vimdown-updater.entitlements'),
  ]);

  const requirement =
    `=designated => identifier "com.kumeda.vimdown" and certificate leaf = H"${identity}"`;

  // Let codesign derive each nested component's designated requirement from its
  // own bundle identifier. Applying the outer app's requirement with --deep
  // makes every helper/framework fail strict validation in Sparkle.
  sign(identity, appPath, [
    '--deep',
    '--entitlements',
    path.resolve('electron', 'vimdown.entitlements'),
  ]);
  sign(identity, appPath, [
    '--entitlements',
    path.resolve('electron', 'vimdown.entitlements'),
    '--requirements',
    requirement,
  ]);

  run('/usr/bin/codesign', [
    '--display',
    '--requirements',
    '-',
    appPath,
  ]);

  console.log(`Embedded Sparkle and signed ${appPath} with ${identity}.`);
};
