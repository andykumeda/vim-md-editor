import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const identityName = "vimdown-dev";
const loginKeychain = path.join(
  process.env.HOME || "",
  "Library",
  "Keychains",
  "login.keychain-db",
);

function run(command: string, args: string[], env = process.env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function capture(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf-8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status}: ${result.stderr || ""}`,
    );
  }
  return result.stdout || "";
}

function findSigningIdentity() {
  const outputs = [
    capture("security", ["find-identity", "-v", "-p", "codesigning"]),
    capture("security", ["find-identity", loginKeychain]),
  ];
  const escapedName = identityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`([A-F0-9]{40})\\s+"${escapedName}"`);

  for (const output of outputs) {
    const match = output.match(pattern);
    if (match) return match[1];
  }
  return null;
}

if (process.platform !== "darwin") {
  throw new Error("VimDown macOS releases must be built on macOS.");
}

const identity = findSigningIdentity();
if (!identity) {
  throw new Error(
    `Missing ${identityName} signing identity. Run npm run signing:setup first.`,
  );
}

const binDir = path.resolve("node_modules", ".bin");
run("swift", [
  "build",
  "--package-path",
  "macos-updater",
  "-c",
  "release",
  "--product",
  "VimDownUpdater",
]);
const updaterBinDir = capture("swift", [
  "build",
  "--package-path",
  "macos-updater",
  "-c",
  "release",
  "--show-bin-path",
]).trim();
run(path.join(binDir, "vite"), ["build"]);
run(
  path.join(binDir, "electron-builder"),
  ["--mac", "--arm64"],
  {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    VIMDOWN_SIGN_IDENTITY: identity,
    VIMDOWN_UPDATER_BIN_DIR: updaterBinDir,
  },
);

const appPath = path.resolve("release", "mac-arm64", "VimDown.app");
const updaterPath = path.join(appPath, "Contents", "Resources", "VimDownUpdater");
const sparklePath = path.join(appPath, "Contents", "Frameworks", "Sparkle.framework");
if (!fs.existsSync(updaterPath) || !fs.existsSync(sparklePath)) {
  throw new Error("The packaged app is missing the Sparkle updater.");
}
run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath]);
run("codesign", ["--display", "--requirements", "-", appPath]);
run(path.join(appPath, "Contents", "MacOS", "VimDown"), ["--version"], {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
});

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf-8"));
const version = String(packageJson.version);
const dmgName = `VimDown-${version}-arm64.dmg`;
const dmgPath = path.resolve("release", dmgName);
const signUpdatePath = path.resolve(
  "macos-updater",
  ".build",
  "artifacts",
  "sparkle",
  "Sparkle",
  "bin",
  "sign_update",
);
const signatureOutput = capture(signUpdatePath, [dmgPath]);
const signatureMatch = signatureOutput.match(
  /sparkle:edSignature="([^"]+)" length="(\d+)"/,
);
if (!signatureMatch) {
  throw new Error(`Unexpected sign_update output: ${signatureOutput}`);
}

const [, signature, length] = signatureMatch;
const appcast = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
    <channel>
        <title>VimDown Updates</title>
        <link>https://raw.githubusercontent.com/andykumeda/vim-md-editor/main/docs/appcast.xml</link>
        <description>Updates for VimDown, a Vim-keybinding Markdown editor for macOS.</description>
        <language>en</language>
        <item>
            <title>VimDown ${version}</title>
            <pubDate>${new Date().toUTCString()}</pubDate>
            <sparkle:version>${version}</sparkle:version>
            <sparkle:shortVersionString>${version}</sparkle:shortVersionString>
            <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
            <description><![CDATA[
                <p>See the GitHub release page for this version's changes.</p>
            ]]></description>
            <enclosure
                url="https://github.com/andykumeda/vim-md-editor/releases/download/v${version}/${dmgName}"
                sparkle:edSignature="${signature}"
                length="${length}"
                type="application/octet-stream" />
        </item>
    </channel>
</rss>
`;
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync(path.join("docs", "appcast.xml"), appcast);

console.log(
  `Built and Sparkle-signed VimDown ${version} with ${identityName} (${identity}).`,
);
