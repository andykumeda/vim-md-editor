# Installing and updating VimDown on a MacBook

## First install

VimDown currently ships an Apple Silicon build for M-series Macs. The latest
public release is published on
[GitHub Releases](https://github.com/andykumeda/vim-md-editor/releases/latest)
and announced by the Sparkle feed at
[`docs/appcast.xml`](./appcast.xml) on `main`.

1. Download `VimDown-<version>-arm64.dmg` from the latest GitHub release.
2. Open the DMG and drag **VimDown** into **Applications**.
3. On first launch, right-click **VimDown** in Applications and choose
   **Open**, then confirm **Open**.

The extra first-launch step is required because VimDown uses a stable
self-signed identity (`vimdown-dev`) rather than an Apple Developer ID. The
downloaded update itself is protected by Sparkle's EdDSA signature.

## In-app updates

VimDown embeds Sparkle through a native helper (`VimDownUpdater`).

- VimDown checks for new releases once a day while the app is running.
- To check immediately, choose **VimDown → Check for Updates…**.
- Sparkle downloads the new DMG, verifies its EdDSA signature, replaces the
  application, and relaunches VimDown.
- Quitting VimDown stops the updater helper so it does not linger after exit.

Documents are never stored inside the application bundle, so replacing or
updating VimDown does not affect them.

## Manual fallback

If an in-app update fails:

1. Quit VimDown.
2. Download the newest DMG from
   [GitHub Releases](https://github.com/andykumeda/vim-md-editor/releases/latest).
3. Drag VimDown into Applications and replace the existing copy.
4. Launch VimDown again.

## Publishing a release

Official releases must be built on the Mac mini, where the Sparkle EdDSA key
and persistent `vimdown-dev` signing identity live.

```bash
npm ci
npm run signing:setup
npm run check
npm test
npm run release:mac
```

`release:mac` compiles the Sparkle helper, builds the Electron app, embeds and
signs the framework, verifies the complete app bundle with macOS strict nested
code-signing checks, creates the DMG, signs the DMG with Sparkle, and rewrites
`docs/appcast.xml`. A failed code-signing check stops the release before an
invalid updater package can be published.

Commit the version bump and updated appcast, merge to `main`, then tag and
publish the matching DMG:

```bash
git tag v<version>
git push origin main v<version>
gh release create v<version> release/VimDown-<version>-arm64.dmg \
  --repo andykumeda/vim-md-editor \
  --title "VimDown <version>" \
  --generate-notes
```

The tag, package version, appcast version, appcast asset URL, and DMG filename
must all match exactly.
