import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

const appName = "VimDown.app";
const releaseDir = path.resolve("release");
const destination = process.env.VIMDOWN_INSTALL_PATH
  ? path.resolve(process.env.VIMDOWN_INSTALL_PATH)
  : path.join("/Applications", appName);

type AppCandidate = {
  path: string;
  version: string;
  mtimeMs: number;
};

async function exists(target: string) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findAppBundles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const bundles: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory() && entry.name === appName) {
      bundles.push(entryPath);
      continue;
    }

    if (entry.isDirectory()) {
      bundles.push(...(await findAppBundles(entryPath)));
    }
  }

  return bundles;
}

function runChecked(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim();
    throw new Error(`${command} failed${details ? `: ${details}` : ""}`);
  }

  return result.stdout.trim();
}

function readBundleVersion(bundlePath: string) {
  return runChecked("plutil", [
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    "-o",
    "-",
    path.join(bundlePath, "Contents", "Info.plist"),
  ]);
}

function isVimDownRunning() {
  const result = spawnSync("/usr/bin/pgrep", ["-x", "VimDown"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status === 0) {
    return true;
  }

  if (result.status === 1) {
    return false;
  }

  const details = result.stderr.trim() || result.stdout.trim();
  console.warn(
    `Could not check whether VimDown is running${details ? `: ${details}` : ""}`,
  );
  return false;
}

async function findNewestCurrentVersionApp(version: string) {
  const bundlePaths = await findAppBundles(releaseDir);
  const candidates: AppCandidate[] = [];

  for (const bundlePath of bundlePaths) {
    try {
      const bundleVersion = readBundleVersion(bundlePath);

      if (bundleVersion === version) {
        const stats = await stat(bundlePath);
        candidates.push({
          path: bundlePath,
          version: bundleVersion,
          mtimeMs: stats.mtimeMs,
        });
      }
    } catch (error) {
      console.warn(`Skipping ${bundlePath}: ${(error as Error).message}`);
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0];
}

async function installMacApp() {
  if (process.platform !== "darwin") {
    console.log("Skipping /Applications install: this step only runs on macOS.");
    return;
  }

  if (path.basename(destination) !== appName) {
    throw new Error(`Install destination must end with ${appName}: ${destination}`);
  }

  if (isVimDownRunning()) {
    throw new Error("VimDown is running. Quit VimDown, then rerun npm run install:mac.");
  }

  const pkg = JSON.parse(await readFile("package.json", "utf-8")) as { version?: string };
  const version = pkg.version;

  if (!version) {
    throw new Error("package.json is missing a version.");
  }

  const source = await findNewestCurrentVersionApp(version);

  if (!source) {
    throw new Error(`No built ${appName} matching package version ${version} was found in ${releaseDir}.`);
  }

  await mkdir(path.dirname(destination), { recursive: true });

  console.log(`Installing ${source.path} (${source.version}) to ${destination}...`);
  await rm(destination, { recursive: true, force: true });
  runChecked("/usr/bin/ditto", [source.path, destination]);
  runChecked(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", destination],
  );
  console.log(`Installed VimDown ${source.version} to ${destination}.`);
}

installMacApp().catch((error) => {
  console.error(error);
  process.exit(1);
});
