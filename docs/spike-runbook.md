# Week-0 spike runbook (KIT-001)

Executable form of the seven acceptance tests in [spike.md](spike.md), in that order, for a human at an Apple Silicon Mac with (a) the Vega Virtual Device and (b) a Fire OS Fire TV stick. Results go into [device-matrix.md](device-matrix.md); every rough edge goes into the consuming app's `docs/friction/` (§6).

Conventions:
- `<PLACEHOLDER>` — a value you supply; the step says where to get it.
- `UNVERIFIED` — the sources did not confirm this name/flag/version. The text gives the current best guess and the step that settles it. Everything else carries a link to its source.
- Repo layout assumed throughout: the kit at `~/hackathon/vega-media-kit` and the sample app cloned as a sibling at `~/hackathon/react-native-multi-tv-app-sample`.
- "VVD" = Vega Virtual Device. "Stick" = Fire OS Fire TV stick. The third matrix column (Fire TV Stick 4K Select, Vega OS) is optional; §1.6 covers it.

Two facts change the shape of the Vega adapter and are worth reading before anything else. Both are **confirmed against primary sources** — treat them as settled, not as things the spike still has to establish:
1. In `@amazon-devices/react-native-w3cmedia`, **`VideoPlayer` is a TypeScript class implementing `HTMLVideoElement`, not a React component**. You construct it (`new VideoPlayer()`) and **`await el.initialize()` before touching it**; the on-screen surface is a separate `KeplerVideoSurfaceView` whose `onSurfaceViewCreated` callback hands you a handle you pass to `el.setSurfaceHandle(handle)` (and release in `onSurfaceViewDestroyed` via `clearSurfaceHandle`) ([Vega API README](https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_react-native-w3cmedia.html), [vega-video-sample PlayerScreen.tsx](https://github.com/AmazonAppDev/vega-video-sample/blob/main/src/screens/PlayerScreen.tsx)). The scaffold's `<w3c.VideoPlayer ref={media}>` at [`src/player/adapters/vega.tsx:88`](../src/player/adapters/vega.tsx) therefore cannot work as written; §2.4 gives the scratch-branch shim.
2. **Shaka is not an npm dependency on Vega.** It is a patched build — Shaka 4.8.5 plus **44 Amazon patch files** (numbered 0001–0045 with 0016 absent; the subject lines still read `[PATCH n/45]`) — vendored into the app's `src/` by a post-install script, and attached to the media element with the **constructor form `new shaka.Player(mediaElement)`** ([vega-video-sample package.json](https://github.com/AmazonAppDev/vega-video-sample/blob/main/package.json), [shaka-setup/build.sh](https://github.com/AmazonAppDev/vega-video-sample/blob/main/shaka-setup/build.sh), tarball `src/shakaplayer/ShakaPlayer.ts`). The scaffold's `require('shaka-player')` needs a Metro alias (§2.3).

---

## 1. Prerequisites and setup

### 1.1 Mac toolchain

```sh
# Homebrew + the packages Amazon's installer expects, plus Rosetta 2 (Apple Silicon)
[[ $(arch) == "arm64" ]] && softwareupdate --install-rosetta --agree-to-license
brew update && brew install binutils coreutils gawk findutils grep jq lz4 gnu-sed watchman
```
Source: [Install the Vega Developer Tools (0.24)](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html) — that page lists exactly this command, 20 GB free disk, macOS 10.15+, and Node 18+.

Node/package managers. Three repos, three pins:

| Repo | Node | Package manager | Source |
|---|---|---|---|
| `vega-media-kit` (this repo) | 20 (CI) | `pnpm@9.15.9` (`packageManager`) | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), [`package.json`](../package.json) |
| `react-native-multi-tv-app-sample` | ≥ 18 | `yarn@4.5.0` (`packageManager`) | [README](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/README.md), [root package.json](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/package.json) |
| `vega-video-sample` (reference only) | ≥ 22 (`engines`) | npm | [package.json](https://github.com/AmazonAppDev/vega-video-sample/blob/main/package.json) |

```sh
brew install fnm && eval "$(fnm env)"
fnm install 20 && fnm use 20
corepack enable            # makes `yarn` (4.5.0) and `pnpm` (9.15.9) follow each repo's packageManager field
node --version             # v20.x
```
`UNVERIFIED — confirm in step 2.6`: whether the Vega app in the sample builds on Node 20 under SDK 0.24; the sample README only says "v18 or higher".

Android platform-tools (for the stick):
```sh
brew install --cask android-platform-tools   # provides adb, fastboot
adb version
```
Source: [Homebrew cask android-platform-tools](https://formulae.brew.sh/cask/android-platform-tools).

Only for test 6 (own HLS package):
```sh
brew install ffmpeg awscli
# On Apple Silicon Homebrew lives in /opt/homebrew and /usr/local/bin is root-owned, so both
# of these need sudo (or drop the binary somewhere on your own PATH instead).
sudo curl -L -o /usr/local/bin/packager https://github.com/shaka-project/shaka-packager/releases/download/v3.9.3/packager-osx-arm64
sudo chmod +x /usr/local/bin/packager && packager --version
```
Source: [shaka-packager release v3.9.3 assets](https://github.com/shaka-project/shaka-packager/releases/latest) (`packager-osx-arm64`).

### 1.2 Vega SDK (Vega Developer Tools) on Apple Silicon

1. Install VS Code first (the installer adds the Vega Studio extension) — [install page](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html).
2. Close VS Code, then:
   ```sh
   curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash && source ~/vega/env
   ```
   Accept the default install path `~/vega/sdk`. The CLI lands in `~/vega/bin`; the installer appends to your shell rc files. Source: [install page](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html).
3. Verify:
   ```sh
   vega --version          # prints "Active SDK Version" and "Vega CLI Version"
   ```
   Record the active SDK version in `device-matrix.md`'s column header if it is not 0.24.
4. No account login is required for the SDK/VVD ([install page](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html) has no auth step). `vega devmode login` is only needed for a physical Vega stick (§1.6).
5. Virtual device lifecycle ([Run your app, 0.24](https://developer.amazon.com/docs/vega/0.24/run-apps.html), [CLI reference](https://developer.amazon.com/docs/vega/0.24/cli-tools.html)):
   ```sh
   vega virtual-device start            # add --timeout 120 if it times out
   vega virtual-device status
   vega device list                     # expect a device named VirtualDevice
   vega virtual-device stop
   ```
   On Apple Silicon the VVD runs the `aarch64` package; the vpkg architecture must match the host ([Run your app](https://developer.amazon.com/docs/vega/0.24/run-apps.html)).
6. Enable developer mode inside the VVD once ([Run your app](https://developer.amazon.com/docs/vega/0.24/run-apps.html)):
   ```sh
   vega device shell -d VirtualDevice
   vsm developer-mode enable
   exit
   ```
7. SDK 0.24 notes that matter here ([0.24 release notes](https://developer.amazon.com/docs/vega/0.24/vega-release-notes.html)): React Native 0.83 is new and 0.72 is still supported (the sample app is on 0.72); a fix landed for debug builds of media apps hanging on a loading screen or playing audio with a blank surface — if you see that, you are on an older SDK.

### 1.3 Fire OS stick: ADB over the network

On the stick ([Connect to Fire TV through ADB](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html)):
1. Settings › My Fire TV › About › select the device name row and press the D-pad centre 7 times if "Developer options" is hidden.
2. Settings › My Fire TV › Developer options › **ADB debugging = ON**, **Apps from Unknown Sources = ON**.
3. Settings › My Fire TV › About › Network → note `<STICK_IP>`.

On the Mac:
```sh
adb connect <STICK_IP>:5555      # accept "Allow USB debugging? Always allow" on the TV the first time
adb devices -l                   # <STICK_IP>:5555  device
```
Sources: [Amazon ADB doc](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html) (port range 5555–5585), [Android adb reference](https://developer.android.com/tools/adb).

### 1.4 Clone the sample app and the kit side by side

```sh
mkdir -p ~/hackathon && cd ~/hackathon
git clone https://github.com/AmazonAppDev/react-native-multi-tv-app-sample.git
# vega-media-kit is already at ~/hackathon/vega-media-kit
cd react-native-multi-tv-app-sample && yarn install
```
Source for layout and commands: [sample README](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/README.md). Layout: `apps/expo-multi-tv` (Expo SDK 54 + `react-native-tvos` 0.81 + `react-native-video ^6.8.0`; [package.json](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/apps/expo-multi-tv/package.json)), `apps/vega` (RN 0.72 + `@amazon-devices/react-native-kepler ^2.0.0` + `@amazon-devices/react-native-w3cmedia ~2.1.0`; [package.json](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/apps/vega/package.json)), `packages/shared-ui` (screens + navigation, exported from `src/index.ts`).

Note the sample already has Vega-specific player files — `packages/shared-ui/src/screens/PlayerScreen.vega.tsx`, `components/player/VideoPlayer.vega.tsx`, `utils/VideoHandler.kepler.ts` — and the Vega Metro config resolves `.vega.tsx` before `.tsx` ([apps/vega/metro.config.js](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/apps/vega/metro.config.js)). The sample's Vega player is **URL mode (`video.src = uri; video.load()`), MP4 only, no Shaka** ([VideoHandler.kepler.ts](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/packages/shared-ui/src/utils/VideoHandler.kepler.ts)); URL mode is not supported for HLS ([Selecting the playback mode](https://developer.amazon.com/docs/vega/0.24/media-player-select-playback.html)), so the harness must bring Shaka (§2.3).

### 1.5 Sanity-run the untouched sample before adding anything

Fire OS:
```sh
cd ~/hackathon/react-native-multi-tv-app-sample
adb devices                      # stick listed
yarn dev:android                 # = yarn workspace @multi-tv/expo-multi-tv android = EXPO_TV=1 expo run:android
```
Sources: [root package.json scripts](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/package.json), [expo-multi-tv package.json](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/apps/expo-multi-tv/package.json), [Expo: building for TV](https://docs.expo.dev/guides/building-for-tv/). If more than one adb device is attached, `cd apps/expo-multi-tv && EXPO_TV=1 npx expo run:android --device` and pick the stick ([Expo CLI reference](https://docs.expo.dev/more/expo-cli/)).

Vega:
```sh
vega virtual-device start
yarn build:vega:debug            # = yarn workspace @multi-tv/vega run build:debug = react-native build-kepler --build-type Debug
ls apps/vega/build/              # find the aarch64 debug vpkg
vega run-app apps/vega/build/<ARCH_DIR>/<APP>_aarch64.vpkg com.giolaq.multitv.vega.main -d VirtualDevice
```
Sources: [apps/vega/package.json](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/apps/vega/package.json) (`build:debug` script; app name `MultiTVVega`), [apps/vega/manifest.toml](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/apps/vega/manifest.toml) (package id `com.giolaq.multitv.vega`, main component `com.giolaq.multitv.vega.main`), [run-app syntax](https://developer.amazon.com/docs/vega/0.24/cli-tools.html). `UNVERIFIED — confirm in this step`: the vpkg file/directory name for a debug build (vega-video-sample's release build is `build/aarch64-release/keplervideoapp_aarch64.vpkg`; the SDK 0.24 CLI reference names the build subcommand `react-native build-vega` while the sample scripts still call `build-kepler`).

### 1.6 Optional: Fire TV Stick 4K Select (Vega OS) column

Only if you have one. Requires an Amazon developer account ([Enable Developer Mode, 0.24](https://developer.amazon.com/docs/vega/0.24/developer-mode.html)):
1. On the stick: Settings › My Fire TV › About › select the device name, press centre 7 times → Developer options → Developer mode. A 6-digit code appears.
2. `vega devmode login` (opens the browser), then `vega devmode enable-device --code <6-DIGIT-CODE>` within 5 minutes. The stick reboots.
3. `vega device list` shows the serial. Build for `armv7`: `vega device -d <SERIAL> install-app --packagePath apps/vega/build/armv7-release/<APP>_armv7.vpkg` then `vega device -d <SERIAL> launch-app --appName com.giolaq.multitv.vega.main` ([Run your app](https://developer.amazon.com/docs/vega/0.24/run-apps.html)).

---

## 2. The throwaway harness screen

Lives in the sample app, never in this repo. Everything in §2 is disposable.

### 2.1 Link the kit into `shared-ui` (Yarn 4 `portal:`)

Yarn 4's `link:` is for folders **without** a `package.json`; a sibling package with dependencies must use `portal:` ([Yarn `link:`](https://yarnpkg.com/protocol/link), [Yarn `portal:`](https://yarnpkg.com/protocol/portal)). The path is relative to the declaring `package.json`.

```sh
cd ~/hackathon/react-native-multi-tv-app-sample/packages/shared-ui
yarn add @moizp/vega-media-kit@portal:../../../vega-media-kit
cd ../.. && yarn install
```

The kit's `package.json` has `"react-native": "./src/index.ts"` so Metro bundles TypeScript source directly — no `pnpm build` needed. Both apps' Metro configs prefer the `react-native` main field (the Vega one lists `['react-native', 'browser', 'main']` — [apps/vega/metro.config.js](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/apps/vega/metro.config.js)).

Metro must be told about the kit directory and must not pick up the kit's own `node_modules/react` (React 19 in the kit's devDependencies vs 18.2 / 19.1 in the apps — a second React copy breaks hooks). Do both:

```sh
rm -rf ~/hackathon/vega-media-kit/node_modules     # restore later with `pnpm install` before running kit tests
```

`apps/vega/metro.config.js` — add the kit to `watchFolders` (the file already lists `../../packages/shared-ui` and sets `unstable_enableSymlinks: true`):
```js
const kitDir = path.resolve(__dirname, '../../../vega-media-kit');
// watchFolders: [ ...existing, kitDir ]
```
`apps/expo-multi-tv/metro.config.js` — same `watchFolders` addition. `watchFolders` semantics: [Metro configuration](https://github.com/facebook/metro/blob/main/docs/Configuration.md) ("directories outside of projectRoot that can contain source files").

**Stub the other platform's packages, or neither bundle builds.** The kit ships both adapters, and each one `require`s its platform's player: `react-native-video` in [`src/player/adapters/fireos.tsx`](../src/player/adapters/fireos.tsx), `@amazon-devices/react-native-w3cmedia` and `shaka-player` in [`src/player/adapters/vega.tsx`](../src/player/adapters/vega.tsx). Metro resolves **every static `require()` it can see, whether or not the branch ever runs**, and an unresolvable one fails the bundle. The sample's root `.yarnrc.yml` sets `nmHoistingLimits: workspaces`, so nothing hoists to a root `node_modules` and each app sees only its own dependencies: the Vega bundle cannot resolve `react-native-video`, and the Expo/Fire OS bundle cannot resolve `@amazon-devices/react-native-w3cmedia` or `shaka-player` (the Shaka alias of §2.3 is added to the Vega config only). Give each app an inert stub for the packages it does not have:

```sh
cd ~/hackathon/react-native-multi-tv-app-sample
for app in apps/vega apps/expo-multi-tv; do
  mkdir -p "$app/metro-stub"
  cat > "$app/metro-stub/package.json" <<'EOF'
{ "name": "kit-spike-metro-stub", "main": "index.js" }
EOF
  cat > "$app/metro-stub/index.js" <<'EOF'
// Resolution-only stub: the other platform's adapter is never executed in this bundle, but Metro
// still resolves its static require(). Keep it inert — Babel's ESM interop reads `.default` and
// `__esModule` at import time, so nothing here may throw.
module.exports = {}
EOF
done
```
`apps/vega/metro.config.js` — in `resolver` (merge with the `shaka-player` entry from §2.3, one `extraNodeModules` object):
```js
extraNodeModules: { 'react-native-video': path.resolve(__dirname, 'metro-stub') },
```
`apps/expo-multi-tv/metro.config.js` — in `resolver`:
```js
extraNodeModules: {
  '@amazon-devices/react-native-w3cmedia': path.resolve(__dirname, 'metro-stub'),
  'shaka-player': path.resolve(__dirname, 'metro-stub'),
},
```
A `resolver.resolveRequest(context, moduleName, platform)` that returns `{ type: 'sourceFile', filePath: <stub> }` for those names does the same job and wins over the default resolver if `extraNodeModules` (which is consulted *after* the standard lookup) proves too late — both are documented in [Metro configuration](https://github.com/facebook/metro/blob/main/docs/Configuration.md). Remove the stubs when you delete the harness.

### 2.2 Vega app: manifest permissions and w3cmedia version

**Nothing to add here — checked.** The sample's `apps/vega/manifest.toml` already `wants` `com.amazon.media.server`, `com.amazon.audio.stream`, `com.amazon.audio.control`, DRM and network services **and** every extra that SDK 0.24's media setup page lists: `com.amazon.mediametrics.service`, `com.amazon.media.playersession.service`, `com.amazon.mediabuffer.service`, `com.amazon.mediatransform.service`, plus the `com.amazon.devconf.privilege.accessibility` privilege for captions (raw file, ~lines 47–71) ([manifest.toml](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/apps/vega/manifest.toml), [Media player setup, 0.24](https://developer.amazon.com/docs/vega/0.24/media-player-setup.html)). Read the file once to confirm it still matches on the SDK version you installed, then move on — only a genuine mismatch is worth a friction entry.

Version: the setup page says `"@amazon-devices/react-native-w3cmedia": "~2.1.80"`; the sample pins `~2.1.0`; vega-video-sample (RN 0.83) pins `~2.3.2`. Run `cd apps/vega && vega project doctor` ([CLI reference](https://developer.amazon.com/docs/vega/0.24/cli-tools.html)) and record what the installed SDK resolves — this answers checklist item N1 (§5).

### 2.3 Vega app: vendor Shaka and alias `shaka-player`

Use vega-video-sample's scripts verbatim; they are the only fully documented path.

```sh
cd ~/hackathon
git clone --depth 1 https://github.com/AmazonAppDev/vega-video-sample.git
cp -R vega-video-sample/shaka-setup react-native-multi-tv-app-sample/apps/vega/shaka-setup
cd react-native-multi-tv-app-sample/apps/vega/shaka-setup
./build.sh && ./copyOutputs.sh
```
What this does ([build.sh](https://github.com/AmazonAppDev/vega-video-sample/blob/main/shaka-setup/build.sh), [copyOutputs.sh](https://github.com/AmazonAppDev/vega-video-sample/blob/main/shaka-setup/copyOutputs.sh), tarball `shaka-setup/shaka-rel-v4.8.5-r1.2.tar.gz` in the same repo): clones shaka-player from GitHub, checks out `v4.8.5`, extracts the tarball over it, `git am`s the **44 Amazon patch files** (0001–0045, 0016 absent; subjects read `[PATCH n/45]`), runs `build/all.py` (needs Python 3 and a JRE ≥ 21 per the [sample README](https://github.com/AmazonAppDev/vega-video-sample/blob/main/README.md)), then copies `dist/` to `../src/w3cmedia/shakaplayer/dist/` and deletes `wrapper.js`.

**`ShakaPlayer.ts` will not be there afterwards — copy it in by hand.** `copyOutputs.sh` runs `rm -f shaka-player/shaka-rel/src/shakaplayer/ShakaPlayer.ts` *before* `cp -R shaka-player/shaka-rel/src/. ../src/w3cmedia/`, because vega-video-sample keeps its own edited copy of that file checked in and does not want the tarball's version clobbering it — the multi-tv sample has no such file. So after the commands above, `apps/vega/src/w3cmedia/` has `polyfills/` (Document, Element, TextDecoder, W3CMedia, Misc, DOMParser), `PlayerInterface.ts` and `shakaplayer/dist/`, but **no `shakaplayer/ShakaPlayer.ts`** — and the alias below (`require('../shakaplayer/ShakaPlayer')`) would fail to resolve. Take the checked-in copy from vega-video-sample:

```sh
cd ~/hackathon/react-native-multi-tv-app-sample
cp ~/hackathon/vega-video-sample/src/w3cmedia/shakaplayer/ShakaPlayer.ts \
   apps/vega/src/w3cmedia/shakaplayer/ShakaPlayer.ts
ls apps/vega/src/w3cmedia/shakaplayer     # expect ShakaPlayer.ts and dist/
ls apps/vega/src/w3cmedia/polyfills       # expect the polyfill .ts files
```
(Equivalent: re-extract `shaka-setup/shaka-rel-v4.8.5-r1.2.tar.gz` and lift `shaka-rel/src/shakaplayer/ShakaPlayer.ts` out of it.) This answers open question 3.

Then confirm the import both helpers depend on actually exists in *this* app's w3cmedia version — `ShakaPlayer.ts` and `W3CMediaPolyfill.ts` both import from `@amazon-devices/react-native-w3cmedia/dist/headless`, which is only verified present in the `~2.3.2` that vega-video-sample pins, while this app pins `~2.1.0`:
```sh
ls apps/vega/node_modules/@amazon-devices/react-native-w3cmedia/dist/headless
```
If it is missing, that is an N1 result and a friction entry: either bump the pin in `apps/vega/package.json` to a version that has it, or rewrite the two imports against what the installed version exports.

Alternative (documented, not tested here): SDK 0.24 lists supported builds `4.16.13-r1.2`, `4.8.5-r1.7`, `4.6.18-r2.16`, `4.3.6-r2.5`, downloadable as `https://amzndevresources.com/vega/media-player/shaka-rel-v<VERSION>-devices_scope.tar.gz` and installed with `shaka-rel/scripts/setup.sh` from inside the tarball — both the URL pattern and the script path are given on that page ([Play adaptive content with Shaka Player, 0.24](https://developer.amazon.com/docs/vega/0.24/media-player-shaka-player.html)). The checked-in `r1.2` tarball is sufficient for the spike. Record which one you used (checklist N6).

The polyfills must be installed before any Shaka code runs (ShakaPlayer.ts does this at import time; it also re-registers Shaka's `http`/`https` schemes with `HttpFetchPlugin` and calls `shaka.polyfill.installAll()` inside `load()`). Create a tiny alias package so the kit's `require('shaka-player')` resolves:

`apps/vega/src/w3cmedia/shaka-player-alias/package.json`
```json
{ "name": "shaka-player", "main": "index.js" }
```
`apps/vega/src/w3cmedia/shaka-player-alias/index.js`
```js
// Install Amazon's polyfills (side effect of importing the sample helper), then export the compiled Shaka.
require('../shakaplayer/ShakaPlayer');
const m = require('../shakaplayer/dist/shaka-player.compiled');
module.exports = m.default ?? m;
```
`apps/vega/metro.config.js` — add to `resolver`:
```js
extraNodeModules: { 'shaka-player': path.resolve(__dirname, 'src/w3cmedia/shaka-player-alias') },
```
— one object, merged with the `react-native-video` stub entry from §2.1. `extraNodeModules` is "a mapping of package names to directories that is consulted after the standard lookup" ([Metro configuration](https://github.com/facebook/metro/blob/main/docs/Configuration.md)). `UNVERIFIED — confirm in step 2.6`: that Metro applies `extraNodeModules` to a `require` issued from inside the portal-linked kit directory.

Shaka's networking on Vega: ShakaPlayer.ts (tarball) unregisters and re-registers `http`/`https` with `shaka.net.HttpFetchPlugin` before creating the player, and configures `streaming.alwaysStreamText: true` and `autoShowText: shaka.config.AutoShowText.ALWAYS`. The shim below copies exactly those calls.

### 2.4 Kit scratch branch: Vega adapter shim

Tests 1–5 on Vega cannot pass with the scaffold as-is (facts 1 and 2 at the top). Do this on a scratch branch of the kit — never on `main` — and let the results feed the real adapter change (its own ticket, with a changeset):

```sh
cd ~/hackathon/vega-media-kit && git switch -c spike/KIT-001-vega-shim
```

Replace the body of `src/player/adapters/vega.tsx` with the sketch below. It follows the tarball's `AppPreBuffering.tsx` and `ShakaPlayer.ts` line by line where they exist, and marks what they do not cover.

```tsx
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { View } from 'react-native'
import { fromShakaText, fromShakaVariants } from '../../core'
import type { Cue, Tracks } from '../../core'
import type { AdapterProps, KitPlayerRef } from '../types'
import { fetchHlsVtt } from './fireos'

// Verified names (vega-video-sample, tarball AppPreBuffering.tsx): VideoPlayer (class), KeplerVideoSurfaceView, KeplerCaptionsView.
type VegaEl = HTMLVideoElement & {
  initialize(): Promise<void>; deinitialize(): Promise<void>
  setSurfaceHandle(h: string): void; clearSurfaceHandle(h: string): void
  setCaptionViewHandle(h: string): void; clearCaptionViewHandle(h: string): void
}
// Read the flag LAZILY. `apps/vega/index.js` uses ESM `import`, which Babel hoists above every
// statement in that file, so a module-scope read here would run before any assignment made there
// and run A would silently execute in scheduler mode (§4 test 3).
const textMode = (): 'capture' | 'scheduler' =>
  ((globalThis as { KIT_VEGA_TEXT?: string }).KIT_VEGA_TEXT ?? 'scheduler') as 'capture' | 'scheduler'

export const VegaAdapter = forwardRef<KitPlayerRef, AdapterProps>(function VegaAdapter(props, ref) {
  const w3c = require('@amazon-devices/react-native-w3cmedia') as {
    VideoPlayer: new () => VegaEl; KeplerVideoSurfaceView: React.ComponentType<any>; KeplerCaptionsView: React.ComponentType<any>
  }
  const shaka = require('shaka-player') as any            // via the Metro alias in §2.3
  const media = useRef<VegaEl | null>(null)
  const player = useRef<any>(null)
  const surface = useRef<string | null>(null)
  const tracks = useRef<Tracks>({ audio: [], text: [] })
  const captured = useRef<Map<string, Cue[]>>(new Map())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const el = new w3c.VideoPlayer()
      await el.initialize()                               // sample: initialize() before anything else
      if (cancelled) return
      el.autoplay = false
      media.current = el
      if (surface.current) el.setSurfaceHandle(surface.current)   // surface may have been created first
      shaka.polyfill.installAll()
      shaka.net.NetworkingEngine.unregisterScheme('http'); shaka.net.NetworkingEngine.unregisterScheme('https')
      shaka.net.NetworkingEngine.registerScheme('http', shaka.net.HttpFetchPlugin.parse, shaka.net.NetworkingEngine.PluginPriority.APPLICATION, true)
      shaka.net.NetworkingEngine.registerScheme('https', shaka.net.HttpFetchPlugin.parse, shaka.net.NetworkingEngine.PluginPriority.APPLICATION, true)
      const p = new shaka.Player(el)                      // sample form. UNVERIFIED alt: new shaka.Player() + await p.attach(el)  (N2)
      player.current = p
      p.configure({
        streaming: { bufferingGoal: 20, alwaysStreamText: true },
        autoShowText: shaka.config.AutoShowText.ALWAYS,
        ...(textMode() === 'capture'
          ? { textDisplayFactory: () => new CaptureDisplayer((id, cues) => { captured.current.set(id, cues); props.onCue?.([...captured.current.values()].flat()) }, () => activeTextId(p)) }
          : { textDisplayFactory: () => new NullTextDisplayer() }),   // N3: honoured per lib/player.js 2116/3505; run A confirms at runtime
      })
      // 'variantchanged' is the event selectVariantTrack() → switchVariant_() dispatches (4.8.5
      // lib/player.js 4388 → 6337). 'adaptation' is ABR-only, so without this line an explicit
      // audio switch never re-publishes tracks and test 2's `tracks` criterion is unobservable.
      p.addEventListener('trackschanged', publishTracks); p.addEventListener('variantchanged', publishTracks); p.addEventListener('adaptation', publishTracks)
      p.addEventListener('buffering', (e: any) => props.onState?.(e.buffering ? 'buffering' : 'playing'))
      p.addEventListener('error', (e: any) => props.onError?.({ code: `SHAKA_${e.detail?.code ?? '?'}`, message: e.detail?.message ?? 'Playback error', fatal: true, cause: e.detail }))
      el.addEventListener('timeupdate', () => props.onPosition?.(el.currentTime))
      el.addEventListener('play', () => props.onState?.('playing')); el.addEventListener('pause', () => props.onState?.('paused'))
      el.addEventListener('ended', () => props.onState?.('ended'))
      props.onState?.('loading')
      await p.load(props.source.uri, props.startAt)
      props.onState?.('ready'); publishTracks(); setReady(true)
      if (props.autoplay) void el.play()
    })()
    return () => { cancelled = true; const p = player.current; const el = media.current
      ;(async () => { if (p) { p.detach?.(); await p.destroy() } await el?.deinitialize() })() }    // sample: unload() then deinitialize()
  }, [props.source.uri]) // eslint-disable-line react-hooks/exhaustive-deps

  function publishTracks() {
    const p = player.current; if (!p) return
    tracks.current = { audio: fromShakaVariants(p.getVariantTracks()), text: fromShakaText(p.getTextTracks()) }
    props.onTracks?.(tracks.current)
  }

  useImperativeHandle(ref, () => ({
    play: () => void media.current?.play(), pause: () => media.current?.pause(),
    seek: (s) => { if (media.current) media.current.currentTime = s },
    setRate: (r) => { if (media.current) media.current.playbackRate = r },
    selectAudio: (id) => { const p = player.current; if (!p) return
      const v = p.getVariantTracks().find((t: any) => String(t.audioId ?? t.id) === id)
      if (v) p.selectVariantTrack(v, true, 0.5) },
    selectText: async (ids) => {
      const p = player.current; if (!p) return
      if (textMode() === 'capture') {                       // Shaka shows ONE text track at a time: the first id wins here (N3/N4)
        const t = p.getTextTracks().find((x: any) => String(x.id) === ids[0]); if (t) { p.selectTextTrack(t); p.setTextTrackVisibility(true) }
        return
      }
      for (const id of ids) {                              // scheduler path: fetch VTT and hand it to KitPlayer's CueScheduler
        try { props.onTextTrackData?.(id, await vttForTrack(p, id, props.source.headers?.['x-kit-text-urls'])) }
        catch (e) { props.onError?.({ code: 'TEXT_FETCH', message: `Could not load text track ${id}`, fatal: false, cause: e }) }
      }
    },
    getPosition: () => media.current?.currentTime ?? 0, getTracks: () => tracks.current,
  }))

  return (
    <View style={props.style ?? { flex: 1 }} testID={props.testID}>
      <w3c.KeplerVideoSurfaceView style={{ flex: 1 }}
        onSurfaceViewCreated={(h: string) => { surface.current = h; media.current?.setSurfaceHandle(h) }}
        onSurfaceViewDestroyed={(h: string) => media.current?.clearSurfaceHandle(h)} />
      {/* No KeplerCaptionsView: the kit's CueOverlay draws. Add one (show) only to compare against native rendering in test 3. */}
    </View>
  )
})

function activeTextId(p: any): string { const t = p.getTextTracks().find((x: any) => x.active); return t ? String(t.id) : 'text' }

/** Text-stream URIs from Shaka's manifest (N4). Falls back to the x-kit-text-urls header. */
async function vttForTrack(p: any, id: string, header?: string): Promise<string> {
  const manifest = p.getManifest()                          // shaka.Player#getManifest → shaka.extern.Manifest { textStreams }
  const stream = manifest?.textStreams?.find((s: any) => String(s.id) === id)
  if (stream) {
    await stream.createSegmentIndex()
    const uris: string[] = []
    for (const ref of stream.segmentIndex) if (ref) uris.push(...ref.getUris())   // SegmentIndex is Iterable; SegmentReference#getUris()
    const parts = await Promise.all(uris.map((u) => fetch(u).then((r) => r.text())))
    return 'WEBVTT\n\n' + parts.map((t) => t.replace(/^WEBVTT[^\n]*\n(?:X-TIMESTAMP-MAP[^\n]*\n)?/m, '')).join('\n')
  }
  const urls = header ? (JSON.parse(header) as Record<string, string>) : {}
  const lang = p.getTextTracks().find((x: any) => String(x.id) === id)?.language
  const url = urls[id] ?? (lang ? urls[lang] : undefined)
  if (!url) throw new Error(`no VTT url for track ${id}`)
  return fetchHlsVtt(url)
}

class NullTextDisplayer { configure() {} append() {} destroy() { return Promise.resolve() } remove() { return true } isTextVisible() { return false } setTextVisibility() {} setTextLanguage() {} }

type ShakaCue = { startTime: number; endTime: number; payload: string; line?: number; nestedCues?: ShakaCue[] }

/** Shaka 4.8.5's VTT parser puts tagged text (`<i>`, `<v>`, `<c>`) into `nestedCues` and leaves the
 *  ROOT `payload` empty (lib/text/vtt_text_parser.js 426, 786), so reading `payload` alone logs blank
 *  cues and grades run A as broken. Read the leaves. */
function cueText(c: ShakaCue): string {
  if (c.payload) return c.payload
  return (c.nestedCues ?? []).map(cueText).join('')
}

/** shaka.extern.TextDisplayer that forwards cues to the kit (plan (b) in the scaffold). */
class CaptureDisplayer {
  private cues: Cue[] = []
  constructor(private emit: (trackId: string, cues: Cue[]) => void, private trackId: () => string) {}
  configure() {}
  append(newCues: ShakaCue[]) {
    const id = this.trackId()
    for (const c of newCues) this.cues.push({ trackId: id, id: `${c.startTime}`, start: c.startTime, end: c.endTime, text: cueText(c) })
    this.emit(id, this.cues)
  }
  remove(start: number, end: number) { this.cues = this.cues.filter((c) => c.end <= start || c.start >= end); this.emit(this.trackId(), this.cues); return true }
  destroy() { this.cues = []; return Promise.resolve() }
  isTextVisible() { return true } setTextVisibility() {} setTextLanguage() {}
}
```
Sources for the API calls: [shaka.Player](https://shaka-project.github.io/shaka-player/docs/api/shaka.Player.html) (`getManifest`, `getTextTracks`, `selectTextTrack`, `setTextTrackVisibility`, `getVariantTracks`, `selectVariantTrack`, `destroy`, events), [shaka.extern.Manifest](https://shaka-project.github.io/shaka-player/docs/api/shaka.extern.html) (`textStreams`), [SegmentIndex](https://shaka-project.github.io/shaka-player/docs/api/shaka.media.SegmentIndex.html) (Iterable), [SegmentReference#getUris](https://shaka-project.github.io/shaka-player/docs/api/shaka.media.SegmentReference.html), [TextDisplayer interface](https://shaka-project.github.io/shaka-player/docs/api/shaka.extern.TextDisplayer.html) (`configure/destroy/append/remove/isTextVisible/setTextVisibility/setTextLanguage`), [text displayer tutorial](https://shaka-project.github.io/shaka-player/docs/api/tutorial-text-displayer.html) (`textDisplayFactory` set via `configure`, before load). Note `CaptureDisplayer.append` emits **all** cues of the track, not the active set; KitPlayer forwards `onCue` straight through in capture mode, so in that mode the harness must filter by position itself (or pipe captured cues into `CueScheduler` — see test 3 notes).

Important Shaka-on-Vega fact for N3: Amazon patch `0023-Fix-captions-rendering.patch` (tarball) changes Shaka's *default* text displayer selection to `if ('addTextTrack' in this.video_) return new shaka.text.SimpleTextDisplayer(...)` — i.e. by default Shaka pushes cues into the W3C `TextTrack` on the `VideoPlayer`, which `KeplerCaptionsView` renders natively ([Implement closed captions, 0.24](https://developer.amazon.com/docs/vega/0.24/implement-closed-captions-vega.html): "the player handles text track creation and cue management internally"). A custom `textDisplayFactory` bypasses that default entirely, and **it is honoured**: 4.8.5's `lib/player.js` calls `this.config_.textDisplayFactory()` unconditionally at lines 2116 and 3505, and patch 0023 edits only the *default* branch, not those calls. The residual risk is runtime-only — the shipped patched build behaving unlike the source read — and test 3 run A settles it.

### 2.5 Harness screen

`packages/shared-ui/src/screens/KitSpikeScreen.tsx` — one file, both platforms. Everything it logs is prefixed `KIT-SPIKE` so the log commands in §2.7 can filter on it.

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
// NOTE: the kit does NOT export `isVega` — `src/platform/index.ts` re-exports only contentLauncher,
// personalization, mediaControls, parentalControls and remote; `src/platform/os.ts` is internal.
// Importing it gives `undefined` and calling it throws on the first render. Use Platform.OS here.
import { CueOverlay, KitPlayer } from '@moizp/vega-media-kit'
import type { Cue, KitPlayerRef, PlayerState, Tracks } from '@moizp/vega-media-kit'

// Switch streams by editing these two lines (see §3). Angel One: en/de/it/fr/es audio; en/el/fr/pt-BR WebVTT.
const URI = 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8'
// Fire OS only: the fireos adapter keys text URLs by react-native-video's track *index*. Verify indexes in the on-screen track list
// after first load (expected manifest order en=0, el=1, fr=2, pt-BR=3 — UNVERIFIED) and fix the keys if they differ.
const TEXT_URLS = {
  '0': 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/playlist_s-en.webvtt.m3u8',
  '2': 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/playlist_s-fr.webvtt.m3u8',
  en: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/playlist_s-en.webvtt.m3u8',
  fr: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/playlist_s-fr.webvtt.m3u8',
}
const SEEK_TARGET = 0 // test 5: set to a cue start time read from the VTT (see §4 test 5)
// Order matters: selText[0] is CueOverlay's primaryTrackId, and test 4 wants fr primary.
// The same list drives KitPlayer's preferredText AND the initial HUD seed, so they cannot drift.
const PREFERRED_TEXT = ['fr', 'en']

const log = (...a: unknown[]) => console.log('KIT-SPIKE', new Date().toISOString(), ...a)

export default function KitSpikeScreen() {
  const ref = useRef<KitPlayerRef>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [state, setState] = useState<PlayerState>('idle')
  const [pos, setPos] = useState(0)
  const [tracks, setTracks] = useState<Tracks>({ audio: [], text: [] })
  const [selText, setSelText] = useState<string[]>([])
  const [rate, setRate] = useState<0.75 | 1>(1)
  const rateMark = useRef<{ wall: number; media: number } | null>(null)
  const lastState = useRef<{ s: PlayerState; at: number }>({ s: 'idle', at: Date.now() })
  const posRef = useRef(0)                 // heartbeat reads these, so the interval needs no deps
  const stateRef = useRef<PlayerState>('idle')
  const seeded = useRef(false)

  const onState = useCallback((s: PlayerState) => {
    const now = Date.now(); const prev = lastState.current
    log('state', s, 'prev', prev.s, 'heldMs', now - prev.at)      // test 2: buffering→playing gap is "heldMs" on the playing line
    lastState.current = { s, at: now }; stateRef.current = s; setState(s)
  }, [])
  const onPosition = useCallback((p: number) => {
    posRef.current = p; setPos(p)
    const m = rateMark.current
    if (m && Date.now() - m.wall >= 20000) { log('rateCheck wallS', (Date.now() - m.wall) / 1000, 'mediaS', p - m.media); rateMark.current = null }
  }, [])
  const onTracks = useCallback((t: Tracks) => {
    log('tracks', JSON.stringify(t)); setTracks(t)
    // Seed the HUD once from the tracks KitPlayer auto-selected via preferredText. Without this,
    // selText starts empty while the player already has fr+en selected: the checkboxes and
    // primaryTrackId lie, and the first toggle REPLACES the auto-selection with a single track.
    if (!seeded.current && t.text.length) {
      seeded.current = true
      const ids = PREFERRED_TEXT.map((l) => t.text.find((x) => x.language === l)?.id).filter((x): x is string => !!x)
      if (ids.length) { setSelText(ids); log('seedText', ids) }
    }
  }, [])
  const onCue = useCallback((active: Cue[]) => { log('cue', JSON.stringify(active.map((c) => [c.trackId, c.start, c.end, c.text]))); setCues(active) }, [])

  // Deps MUST be []. With [pos, state] this interval is torn down and re-created on every
  // onPosition (≤ 4 Hz), so it never reaches 1000 ms while playing and `pos` lines appear only
  // when paused — which silently breaks the pass criteria of tests 1, 2 and 5.
  useEffect(() => {
    log('Platform.OS', Platform.OS)                                // N5
    const id = setInterval(() => log('pos', posRef.current.toFixed(2), 'state', stateRef.current), 1000)
    return () => clearInterval(id)
  }, [])

  const toggleText = (id: string) => { const next = selText.includes(id) ? selText.filter((x) => x !== id) : [...selText, id]; setSelText(next); log('selectText', next); ref.current?.selectText(next) }
  const cycleAudio = () => { const a = tracks.audio; if (!a.length) return; const i = a.findIndex((t) => t.active); const n = a[(i + 1) % a.length]; log('selectAudio', n.id, n.language, n.roles, 'atPos', pos); ref.current?.selectAudio(n.id)
    // Fire OS emits onTracks only from onLoad, so no `tracks` line follows a switch there.
    // Re-read the adapter's own view 2 s later so test 2 has one observable line on both platforms.
    setTimeout(() => log('tracksAfterSwitch', JSON.stringify(ref.current?.getTracks())), 2000) }
  const toggleRate = () => { const r = rate === 1 ? 0.75 : 1; setRate(r); rateMark.current = { wall: Date.now(), media: pos }; log('setRate', r, 'atPos', pos); ref.current?.setRate(r) }

  return (
    <View style={s.root}>
      <KitPlayer ref={ref}
        source={{ uri: URI, type: 'hls', headers: { 'x-kit-text-urls': JSON.stringify(TEXT_URLS) } }}
        autoplay
        preferredAudio={{ language: 'en', role: 'main' }}
        preferredText={{ languages: PREFERRED_TEXT }}
        onTracks={onTracks} onCue={onCue} onState={onState} onPosition={onPosition}
        onError={(e) => log('error', e.code, e.message)}
        style={StyleSheet.absoluteFill} />
      <CueOverlay active={cues} primaryTrackId={selText[0]} scale={Platform.OS === 'kepler' ? 1 : 0.5} />
      <View style={s.hud}>
        <Text style={s.mono}>{`${state} ${pos.toFixed(1)}s rate ${rate} audio ${tracks.audio.map((t) => `${t.id}:${t.language}${t.active ? '*' : ''}`).join(' ')} text ${tracks.text.map((t) => `${t.id}:${t.language}`).join(' ')} sel ${selText.join('+')}`}</Text>
        <View style={s.row}>
          <Btn label="Play/Pause" onPress={() => (state === 'playing' ? ref.current?.pause() : ref.current?.play())} first />
          <Btn label="-10s" onPress={() => ref.current?.seek(Math.max(0, pos - 10))} />
          <Btn label="+10s" onPress={() => ref.current?.seek(pos + 10)} />
          <Btn label={`Seek ${SEEK_TARGET}s`} onPress={() => { log('seekTo', SEEK_TARGET); ref.current?.seek(SEEK_TARGET) }} />
          <Btn label="Audio ▶" onPress={cycleAudio} />
          <Btn label={`Rate ${rate === 1 ? '0.75' : '1'}`} onPress={toggleRate} />
          {tracks.text.map((t) => <Btn key={t.id} label={`${selText.includes(t.id) ? '☑' : '☐'} ${t.language}`} onPress={() => toggleText(t.id)} />)}
        </View>
      </View>
    </View>
  )
}

// Vega has no platform focus ring (docs/fire-os-and-vega-one-codebase.md): draw focus ourselves.
function Btn({ label, onPress, first }: { label: string; onPress(): void; first?: boolean }) {
  const [f, setF] = useState(false)
  return (
    <Pressable onPress={onPress} onFocus={() => setF(true)} onBlur={() => setF(false)} hasTVPreferredFocus={first} style={[s.btn, f && s.btnFocus]}>
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  hud: { position: 'absolute', left: 0, right: 0, top: 0, padding: 12, backgroundColor: 'rgba(0,0,0,0.5)' },
  mono: { color: '#fff', fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 2, borderColor: 'transparent', backgroundColor: '#333' },
  btnFocus: { borderColor: '#fff', transform: [{ scale: 1.08 }] },
  btnText: { color: '#fff', fontSize: 16 },
})
```
(The HUD colours are harness-only; the kit itself stays colour-free per `CLAUDE.md`.)

Register it (both navigators are native stacks with screens `Details` and `Player`; the Vega one imports from `@amazon-devices/react-navigation__native-stack` — [RootNavigator.tsx](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/packages/shared-ui/src/navigation/RootNavigator.tsx), [VegaRootNavigator.tsx](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/apps/vega/src/navigation/VegaRootNavigator.tsx), [types.ts](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/blob/main/packages/shared-ui/src/navigation/types.ts)):

1. `packages/shared-ui/src/navigation/types.ts`: add `KitSpike: undefined` to `RootStackParamList`.
2. `packages/shared-ui/src/index.ts`: `export { default as KitSpikeScreen } from './screens/KitSpikeScreen';`
3. `packages/shared-ui/src/navigation/RootNavigator.tsx` and `apps/vega/src/navigation/VegaRootNavigator.tsx`: add `<Stack.Screen name="KitSpike" component={KitSpikeScreen} />` and set `initialRouteName="KitSpike"` on `Stack.Navigator` so the app boots straight into the harness (no drawer navigation needed from the remote). Revert both when done.

### 2.6 Build and run the harness

Fire OS (Platform.OS is `android` → `FireOsAdapter`):
```sh
cd ~/hackathon/react-native-multi-tv-app-sample && adb connect <STICK_IP>:5555 && yarn dev:android
```
Vega (Platform.OS is `kepler` → `VegaAdapter`; see N5):
```sh
cd ~/hackathon/react-native-multi-tv-app-sample
yarn build:vega:debug
vega run-app apps/vega/build/<ARCH_DIR>/<APP>_aarch64.vpkg com.giolaq.multitv.vega.main -d VirtualDevice
```
Fast iteration on Vega: Metro (`yarn dev:vega` = `react-native start` in `apps/vega`) serves JS to a debug build; rebuild the vpkg only when native deps or the manifest change. `UNVERIFIED — confirm in this step`: that the debug vpkg connects to Metro on the host without extra flags.

### 2.7 Capturing evidence

Vega — logs (three equivalent routes; pick the one that works first):
```sh
vega device start-log-stream --device VirtualDevice                         # CLI reference; Ctrl-C then stop-log-stream
vega exec vda shell loggingctl log -v "com.giolaq.multitv.vega" -f | tee vega-<TEST>.log   # filter by package id
vega exec vda shell loggingctl log -v "com.giolaq.multitv.vega" -p info -f | grep KIT-SPIKE
```
Sources: [CLI reference](https://developer.amazon.com/docs/vega/0.24/cli-tools.html) (`start-log-stream --device <name>`), [Loggingctl](https://developer.amazon.com/docs/vega/0.24/loggingctl.html) (`-v <package id>`, `-p <priority>`, `-f`; `console.log` maps to INFO; loggingctl only sees apps installed before the session started — reinstall and restart if the filter is empty), [VDA reference](https://developer.amazon.com/docs/vega/0.24/vda-tools.html) (`vega exec vda shell …`). VS Code's Vega Studio "Show Logs" button is the documented GUI alternative ([Logs](https://developer.amazon.com/docs/vega/0.24/logs.html)).

Vega — screenshot ([VDA reference](https://developer.amazon.com/docs/vega/0.24/vda-tools.html)):
```sh
vega exec vda shell gwsi-tool-screenshooter /tmp/<TEST>.png
vega exec vda pull /tmp/<TEST>.png ./evidence/vega-<TEST>.png       # pull syntax from the same page; on-device path UNVERIFIED
```
Vega — screen recording: no documented command found; record the VVD window with macOS QuickTime (File › New Screen Recording) — `UNVERIFIED` that no CLI exists.

Fire OS ([Android adb](https://developer.android.com/tools/adb), [logcat](https://developer.android.com/tools/logcat)):
```sh
adb logcat -c
adb logcat -v time | grep KIT-SPIKE | tee fireos-<TEST>.log          # primary: the harness prefix
adb logcat -v time ReactNativeJS:V *:S                                # narrower; tag name UNVERIFIED against RN docs
adb exec-out screencap -p > evidence/fireos-<TEST>.png
adb shell screenrecord --time-limit 60 /sdcard/<TEST>.mp4 && adb pull /sdcard/<TEST>.mp4 evidence/
```

Keep `evidence/` outside both repos (e.g. `~/hackathon/spike-evidence/`); link file names from the matrix "Notes" column.

---

## 3. Test streams

| Purpose | URL | What it has (verified by fetching the master playlist on 2026-09-15) |
|---|---|---|
| Multi-language audio + multi WebVTT (tests 1–5 primary) | `https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8` | Audio: en (2ch, DEFAULT), de, it, fr, es, en 6ch. Subtitles (WebVTT playlists): en (`playlist_s-en.webvtt.m3u8`), el, fr, pt-BR. Listed in [Shaka demo assets](https://raw.githubusercontent.com/shaka-project/shaka-player/main/demo/common/assets.js) as "Angel One (HLS, MP4, multilingual)". |
| Apple "bipbop advanced" fMP4 (test 1 cross-check) | `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8` | Audio: three English renditions (AAC 2ch, AC-3 6ch, EC-3 6ch) — same language, different codec, so **not** a language-switch test. One WebVTT subtitle track (en, `s1/en/prog_index.m3u8`) plus CEA-608 CC. Apple hosts it under the [HLS examples](https://developer.apple.com/streaming/examples/) index; Shaka's demo list carries a mirror at `https://storage.googleapis.com/shaka-demo-assets/apple-advanced-stream-fmp4/master.m3u8`. |
| Apple bipbop advanced HEVC | `https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8` | [Shaka demo assets](https://raw.githubusercontent.com/shaka-project/shaka-player/main/demo/common/assets.js); HEVC — use only if the device declines AVC for some reason. |
| Angel One DASH (Vega-only comparison if HLS text fails) | `https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd` | Multiple languages + subtitles ([Shaka demo assets](https://raw.githubusercontent.com/shaka-project/shaka-player/main/demo/common/assets.js)). |

Read the first English cue start for test 5:
```sh
curl -s https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/playlist_s-en.webvtt.m3u8 | grep -v '^#' | head -1   # first segment name
curl -s https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/<FIRST_SEGMENT> | head -20                          # first "hh:mm:ss.mmm --> " line
```
Put that start time in `SEEK_TARGET`.

### 3.1 Test 6: own HLS package (ffmpeg → Shaka Packager → S3 + CloudFront)

Goal: one video rendition, two AAC audio renditions with HLS `CHARACTERISTICS` marking one as audio description (HLS has no `ROLE` attribute; RFC 8216 uses `CHARACTERISTICS="public.accessibility.describes-video"` on an AUDIO rendition — [RFC 8216 §4.3.4.1](https://datatracker.ietf.org/doc/html/rfc8216); the kit's `normalizeRoles` maps that string to `description` in [`src/core/tracks.ts`](../src/core/tracks.ts)), and two WebVTT tracks.

1. Inputs: `source.mp4` (any short clip with speech), `ad.wav` (your audio-description mix, same duration), `en.vtt`, `fr.vtt` (hand-written; keep them tiny — use `<v Speaker>` and a `[sound]` cue so the parser features are exercised).
2. Elementary streams with ffmpeg ([ffmpeg docs: `-map`, `-metadata:s:a:0 language=`, `-c:a`, `-vn/-an`](https://ffmpeg.org/ffmpeg.html)):
   ```sh
   ffmpeg -i source.mp4 -map 0:v:0 -c:v libx264 -preset veryfast -b:v 2500k -an video.mp4
   ffmpeg -i source.mp4 -map 0:a:0 -c:a aac -b:a 128k -vn -metadata:s:a:0 language=eng audio_main.mp4
   ffmpeg -i ad.wav     -map 0:a:0 -c:a aac -b:a 128k -vn -metadata:s:a:0 language=eng audio_ad.mp4
   ```
3. Package ([Shaka Packager HLS tutorial](https://shaka-project.github.io/shaka-packager/html/tutorials/hls.html), [stream descriptor fields](https://shaka-project.github.io/shaka-packager/html/documentation.html): `hls_name`, `hls_group_id`, `hls_characteristics`, `language`, `playlist_name`, `segment_template`, `--hls_master_playlist_output`, `--segment_duration`, `--default_language`):
   ```sh
   mkdir out && cd out
   packager \
     'in=../video.mp4,stream=video,segment_template=v/$Number$.m4s,playlist_name=v/main.m3u8' \
     'in=../audio_main.mp4,stream=audio,segment_template=a-main/$Number$.m4s,playlist_name=a-main/main.m3u8,hls_group_id=audio,hls_name=English,language=en' \
     'in=../audio_ad.mp4,stream=audio,segment_template=a-ad/$Number$.m4s,playlist_name=a-ad/main.m3u8,hls_group_id=audio,hls_name=English AD,language=en,hls_characteristics=public.accessibility.describes-video' \
     'in=../en.vtt,stream=text,segment_template=t-en/$Number$.vtt,playlist_name=t-en/main.m3u8,hls_group_id=text,hls_name=English,language=en' \
     'in=../fr.vtt,stream=text,segment_template=t-fr/$Number$.vtt,playlist_name=t-fr/main.m3u8,hls_group_id=text,hls_name=Français,language=fr' \
     --segment_duration 4 --default_language en --hls_master_playlist_output master.m3u8
   grep EXT-X-MEDIA master.m3u8     # expect two AUDIO lines (one with CHARACTERISTICS) and two SUBTITLES lines
   ```
   `UNVERIFIED`: that `hls_characteristics` accepts the value without quoting on the packager command line — check the grep output. (`dash_roles=description` may be added for a DASH twin; not needed for HLS.)
4. S3 + CORS. Shaka on Vega and the kit's `fetch` of VTT are cross-origin requests from an app origin, so the bucket must answer with `Access-Control-Allow-Origin` ([S3 CORS elements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html)):
   ```sh
   aws s3 mb s3://<BUCKET>
   cat > cors.json <<'EOF'
   {"CORSRules":[{"AllowedHeaders":["*"],"AllowedMethods":["GET","HEAD"],"AllowedOrigins":["*"],"ExposeHeaders":["Content-Length","Content-Range"],"MaxAgeSeconds":3000}]}
   EOF
   # --cors-configuration wants the CORSRules wrapper; a bare array is a parameter-validation error.
   aws s3api put-bucket-cors --bucket <BUCKET> --cors-configuration file://cors.json
   aws s3 sync ./out s3://<BUCKET>/spike/ --exclude "*" --include "*.m3u8" --content-type application/vnd.apple.mpegurl
   aws s3 sync ./out s3://<BUCKET>/spike/ --exclude "*.m3u8"
   ```
   Sources: [put-bucket-cors](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-bucket-cors.html), [s3 sync `--content-type`/`--exclude`](https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html). `UNVERIFIED`: whether the Vega media stack sends an `Origin` header at all (if it does not, CORS never triggers there; Fire OS/ExoPlayer never sends one). The scheduler path's `fetch()` from React Native also does not enforce CORS — the configuration is defence for the web harness and for any future WebView.
5. CloudFront: create a standard distribution with the S3 bucket as origin using "Use recommended origin settings" (OAC) ([Get started with a standard distribution](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GettingStarted.SimpleDistribution.html)), then on the default behaviour attach the managed policies **origin request `CORS-S3Origin`** (id `88a5eaf4-2fd4-4709-b370-b4c650ea3fcf`; forwards `Origin`, `Access-Control-Request-Headers/Method`) and **response headers `CORS-With-Preflight`** (id `5cc3b908-e619-4b99-88e5-2cf7f45965bd`; adds `Access-Control-Allow-Origin: *` when the origin did not) ([managed origin request policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html), [managed response headers policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-response-headers-policies.html)). The stream URL becomes `https://<DIST>.cloudfront.net/spike/master.m3u8`. Verify from the Mac:
   ```sh
   curl -sI -H 'Origin: https://example.test' https://<DIST>.cloudfront.net/spike/master.m3u8 | grep -i 'access-control\|content-type'
   ```

---

## 4. The seven tests

Each test: goal · Vega steps · Fire OS steps · pass/fail (observable) · capture · matrix cell. Run tests 1–5 first on Angel One, then repeat them on the CloudFront package for test 6. Tick the cell as `✅`, `❌` or `⚠️ partial` and write the evidence file names plus one line in "Notes".

### Test 1 — Plays on both from one shared component

Goal: the same `KitSpikeScreen.tsx` renders video and audio on VVD and on the stick; the kit chose the right adapter.

Vega: `vega virtual-device start` → §2.6 run → wait for the HUD to read `playing`. Confirm in the log: `KIT-SPIKE … tracks {"audio":[…],"text":[…]}` with ≥ 2 audio and ≥ 2 text entries and `KIT-SPIKE … state playing`.
Fire OS: `yarn dev:android` → same observations.

Pass: within 10 s of launch, HUD state is `playing`, `pos` increases monotonically for 30 s (compare two `pos` log lines 30 s apart: Δ ≥ 29 s at rate 1), audio audible, no `KIT-SPIKE … error` line. Fail otherwise.
Capture: screenshot at ~15 s, first 40 lines of the log (`tracks` line included).
Matrix: row **Playback**, columns VVD / Fire TV Stick (Fire OS).

### Test 2 — Lists audio tracks; switching audio language mid-playback keeps sync (no rebuffer > 1 s)

Goal: `onTracks` lists ≥ 2 languages; `selectAudio` mid-playback switches within one rebuffer ≤ 1 s and playback continues from the same position.

Both platforms: let playback reach ~30 s. Focus **Audio ▶** and press select once (en → de). Wait 15 s. Press again (de → it). Wait 15 s.

Pass, measured from the log for each press:
- the `selectAudio <id> <lang> … atPos P` line is followed within ~2 s by a line whose `active` audio is the new language. **Which line differs by platform.** On Vega it is a `tracks` line, and only because the shim subscribes **`variantchanged`** (§2.4): `selectVariantTrack` → `switchVariant_` dispatches that event, never `adaptation` (ABR-only) or `trackschanged`. On Fire OS the adapter emits `onTracks` only from `onLoad` (`onAudioTracks` is not wired), so **no `tracks` line will ever follow a press** — grade from the harness's own `tracksAfterSwitch` line, which re-reads `ref.current.getTracks()` 2 s after the press, or by ear and the HUD's `audio …*` marker. Do not fail Fire OS for a missing `tracks` line; if `tracksAfterSwitch` also shows the old language while the audio audibly changed, note it as a reporting gap in the adapter, not a playback failure;
- every `state playing prev buffering heldMs N` line in the 10 s after the press has `N ≤ 1000`, and there is at most one such buffering interval per press. On Vega the shim calls `selectVariantTrack(v, clearBuffer=true, safeMargin=0.5)` ([shaka.Player](https://shaka-project.github.io/shaka-player/docs/api/shaka.Player.html)), so a short buffering event is expected; the threshold is the 1 s;
- the first `pos` line after the switch is ≥ P − 0.5 (no rewind) and the next `pos` line 1 s later is ≥ +0.9 (no stall);
- by ear: the spoken language changes and lips match (Angel One has on-screen dialogue).
Fail: any `heldMs > 1000`, position jumping back > 0.5 s, or audio staying in the old language.
Capture: screen recording covering both presses (Fire OS: `screenrecord --time-limit 60`; Vega: QuickTime), full log for the 60 s window.
Matrix: row **Audio switch**.

### Test 3 — Text-track cue events arrive on Vega (Shaka textDisplayer capture) — or fall back to scheduler over fetched VTT

Goal: decide the cue delivery path for the Vega adapter (the `TODO(spike)` at [`src/player/adapters/vega.tsx:77`](../src/player/adapters/vega.tsx)). Fire OS is `n/a (scheduler)` in the matrix by design — but run the Fire OS scheduler path anyway as the reference for cue timing.

Vega, run A (capture): set the flag in **its own module, imported first** — do not assign it inline at the top of `apps/vega/index.js`. That file uses ESM `import`, which Babel hoists above every statement you write there, so the kit module would evaluate the flag before the assignment ran and run A would silently execute in scheduler mode, recording N3 from the wrong run. Instead:
```sh
cd ~/hackathon/react-native-multi-tv-app-sample
echo "globalThis.KIT_VEGA_TEXT = 'capture';" > apps/vega/kit-spike-flag.js
```
and make `import './kit-spike-flag';` the **first line** of `apps/vega/index.js`, above every other import. (The shim reads the flag lazily via `textMode()`, so a module imported first is enough.) Rebuild and launch; the harness's `preferredText={{ languages: PREFERRED_TEXT }}` makes KitPlayer call `selectText(['fr','en'])`; the shim selects the first. Watch for `KIT-SPIKE … cue [...]` lines while dialogue is on screen.
Vega, run B (scheduler): delete the `import './kit-spike-flag';` line (or set the flag to `'scheduler'`, the default). Launch; the shim resolves the VTT segment URIs from `player.getManifest().textStreams[…]` and hands the joined VTT to `onTextTrackData`; KitPlayer's `CueScheduler` emits `onCue` on `onPosition` updates.
Fire OS (reference): launch; the `FireOsAdapter` fetches the `x-kit-text-urls` playlists. If no `cue` lines appear, the index keys in `TEXT_URLS` are wrong — read the `tracks` line, fix the keys, relaunch.

Run B and the Fire OS reference both depend on **KIT-009**, the fix for a real kit bug: `KitPlayer` applied `preferredText` straight to the adapter (`adapterRef.current.selectText(...)`), bypassing `api.selectText` — the only path that populates `selectedText` — so `handleTextTrackData` dropped every fetched VTT and no cues ever reached the overlay at launch. These steps assume that fix has landed on `main`. **Fallback:** if the kit checkout you linked in §2.1 predates KIT-009, you will see zero `cue` lines at launch; press one text-track toggle (☑ fr → ☐ → ☑, or just ☐ en) once and grade from there. Do not patch `KitPlayer` on the scratch branch.

Pass (Vega, at least one of A/B): `cue` lines appear whose `[trackId, start, end, text]` entries change as playback crosses cue boundaries, and text on screen (the kit's `CueOverlay`) matches the audio within ±0.5 s by eye against the screen recording. Record which run passed — that answers N3 (§5). If both pass, prefer B for the adapter (same code path as Fire OS, multi-track for free); note in "Notes" whether A's `append()` batches arrive early (whole-track) or per-segment.
Fail: no `cue` lines in 60 s of dialogue on both runs, or cues visibly > 1 s off.
Capture: log (`cue` lines), one screenshot with a cue visible, screen recording 30 s.
Matrix: row **Cue events**, VVD column; write `A`/`B`/`A+B` in Notes.

### Test 4 — Two text tracks visible at once in the kit overlay

Goal: two text tracks selected at once show both languages simultaneously in `CueOverlay` (fr primary large, en secondary above — `primaryTrackId` is `selText[0]`, which the harness seeds from `PREFERRED_TEXT = ['fr','en']` on the first `tracks` callback, so it is `fr` before anything is pressed).

Both platforms: once the first `tracks` line has been logged, the **fr** and **en** buttons should already read ☑ and the HUD `sel` should read `fr+en` — that is the seed matching KitPlayer's own `preferredText` selection, and it is what keeps the checkboxes, `sel` and `primaryTrackId` honest. (If you see a `seedText` line but unchecked boxes, the track languages did not match `PREFERRED_TEXT`; read the `tracks` line and fix the constant.) On Vega this only works in scheduler mode; in capture mode Shaka selects a single track — [selectTextTrack](https://shaka-project.github.io/shaka-player/docs/api/shaka.Player.html) — which is precisely why the fallback exists. Now toggle fr off, then on again.

Pass: during a stretch of dialogue, two caption boxes stack at the bottom with different languages, and `cue` lines contain entries with both track ids at the same time. Toggling fr off removes its box within one cue boundary; toggling on restores it (and `sel` returns to two ids — note that re-adding puts fr *last*, so the overlay's primary becomes en until you reload; that is the harness's ordering, not a kit behaviour). The `sel` field in the HUD reads `fr+en` at rest.
Fail: only one language ever renders, or the second selection replaces the first.
Capture: screenshot with both boxes visible; log excerpt showing a `cue` line with two track ids.
Matrix: row **Two text tracks**.

### Test 5 — Seek to cue start, pause, resume; playbackRate 0.75 works on both

Goal: seek lands on a cue boundary and the cue shows; pause/resume are clean; 0.75× is real on both engines.

Both platforms:
1. Press **Seek <SEEK_TARGET>s** (the constant you set in §3). Expect the target cue in the overlay within 1 s and a `cue` line whose entry has `start == SEEK_TARGET`.
2. Press **Play/Pause**: HUD reads `paused`, `pos` stops changing (two consecutive `pos` lines equal). Press again: `playing`, `pos` resumes from the same value ± 0.3 s.
3. Press **Rate 0.75**. Do nothing for 20 s. The harness logs `rateCheck wallS 20.x mediaS M`.

Pass: (1) as stated; (2) as stated; (3) `M` between 14 and 16 (0.75 × 20 = 15) and pitch/lip movement visibly slower; on Fire OS react-native-video's `rate` is documented on Android ([props: rate](https://docs.thewidlarzgroup.com/react-native-video/docs/v6/component/props/)); on Vega it is `HTMLMediaElement.playbackRate` on the `VideoPlayer` — `UNVERIFIED` that the Vega stack honours 0.75 (N7).
Fail: `M` outside 14–16, or rate change stalls playback (`buffering` held > 2 s), or seek does not produce the target cue.
Capture: log lines `seekTo`, `state paused/playing`, `setRate`, `rateCheck`; 30 s recording.
Matrix: row **Seek / rate**.

### Test 6 — Own HLS (ffmpeg → Shaka Packager) from S3 + CloudFront; repeat 1–5

Goal: the kit works against content you control, including an audio rendition tagged as description and two WebVTT tracks.

Both platforms: set `URI` to `https://<DIST>.cloudfront.net/spike/master.m3u8`; set `TEXT_URLS` to `{ '0': …/spike/t-en/main.m3u8, '1': …/spike/t-fr/main.m3u8, en: …, fr: … }` (verify indexes from the `tracks` line as before); set `preferredAudio={{ role: 'description' }}`. Rebuild/relaunch and rerun tests 1–5.

Pass: tests 1–5 pass on this stream **and** the `tracks` line shows one audio track with `"roles":["description"]` (Vega: from Shaka's `audioRoles`; Fire OS: `fromRnvAudio` only infers `description` from the track *title* — if the CloudFront stream shows `main` for the AD rendition on Fire OS, that is a real finding: ExoPlayer via react-native-video exposes `title/language/type` only ([onLoad payload](https://docs.thewidlarzgroup.com/react-native-video/docs/v6/component/props/)) and `hls_name=English AD` is what makes the regex match). Also `curl -sI` from §3.1 step 5 shows `access-control-allow-origin`.
Fail: any of 1–5 fails here but passed on Angel One (then it is a packaging/CDN problem — bisect by playing the S3 URL directly in the web harness).
Capture: the master playlist as uploaded, CloudFront `curl -sI` output, plus the per-test captures.
Matrix: row **Own HLS via CloudFront**.

### Test 7 — Optional, informational: two media elements at once on Vega

Goal: learn whether two `VideoPlayer` instances (two `KitPlayer`s) can coexist — relevant to picture-in-picture previews later.

Vega only: temporarily render a second `<KitPlayer source={{ uri: URI, type: 'hls' }} autoplay style={{ position: 'absolute', right: 40, bottom: 40, width: 480, height: 270 }} />` in the harness with no `preferredText` (the docs say "Multiple `KeplerCaptionsView` instances within the same process are not supported" — [Implement closed captions, 0.24](https://developer.amazon.com/docs/vega/0.24/implement-closed-captions-vega.html); the shim renders none, but keep text off to isolate the surface question).

Record, not pass/fail: does the second surface show video, which one has audio, any `error` lines, memory via `vega exec vda shell ace_memusage` ([VDA reference](https://developer.amazon.com/docs/vega/0.24/vda-tools.html)).
Matrix: no dedicated row; write one line in the **Notes** of **Playback** (VVD) prefixed `T7:`. (The **Content Launcher intent** row is outside KIT-001 — leave it.)

---

## 5. Naming questions to resolve during the spike

Tick each when the answer is written where the row says. **During the spike the only things you write are the matrix Notes column and the friction entries of §6** — the scratch branch is thrown away and nothing here is a licence to edit `main`. The `src/…`, `docs/…`, `README.md` and `package.json` targets named under "Follow-up ticket" are the checklist for the separate adapter ticket that lands the real change with a changeset, once the spike has produced the answers.

- [ ] **N1 — Package name, component names, version.** Expected: package `@amazon-devices/react-native-w3cmedia`; exports used: `VideoPlayer` (class), `KeplerVideoSurfaceView`, `KeplerCaptionsView` ([API README](https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_react-native-w3cmedia.html), [sample PlayerScreen](https://github.com/AmazonAppDev/vega-video-sample/blob/main/src/screens/PlayerScreen.tsx)). Run/observe: `grep -n "export" node_modules/@amazon-devices/react-native-w3cmedia/dist/index.d.ts` in `apps/vega` and `cat node_modules/@amazon-devices/react-native-w3cmedia/package.json | jq .version`; harness boots (test 1); plus the `dist/headless` check in §2.3. Record in: test 1 Notes. Follow-up ticket: the `TODO(spike)` header comment of `src/player/adapters/vega.tsx` (then delete the TODO, per `CLAUDE.md`), `docs/getting-started.md` Vega step 2, `package.json` peerDependency range.
- [ ] **N2 — How the media element is obtained and whether `shaka.Player().attach()` works.** Expected: `new VideoPlayer()` + `await initialize()` is the element (no ref); Shaka in the sample is `new shaka.Player(mediaElement)`. Run/observe: with the shim as written, test 1 passes ⇒ constructor form works. Then swap to `const p = new shaka.Player(); await p.attach(el)` and rerun test 1 ⇒ record whether attach works. Record in: test 1 Notes. Follow-up ticket: adapter comment.
- [ ] **N3 — Is `textDisplayFactory` honoured?** Expected: **yes — confirmed statically.** Shaka 4.8.5's `lib/player.js` calls `this.config_.textDisplayFactory()` unconditionally at lines 2116 and 3505, and Amazon's `0023-Fix-captions-rendering.patch` changes only the *default* factory, not those call sites. What is left is runtime confirmation that the shipped patched build behaves like the source. Run/observe: test 3 run A produces `cue` lines. If it does not, check whether captions appear natively by adding a `<KeplerCaptionsView show onCaptionViewCreated={(h) => media.current?.setCaptionViewHandle(h)} />` — native captions with no `cue` lines would mean the factory was ignored after all, and that is a notable finding worth a friction entry. Record in: test 3 Notes with `A`/`B`. Follow-up ticket: resolves the `TODO(spike)` at `vega.tsx:77`.
- [ ] **N4 — Can a text stream URI be obtained from Shaka, or must the kit parse the master playlist?** Expected: `player.getManifest().textStreams[i]` → `createSegmentIndex()` → `segmentIndex` iteration → `SegmentReference.getUris()` yields VTT segment URLs ([shaka.extern.Manifest](https://shaka-project.github.io/shaka-player/docs/api/shaka.extern.html), [SegmentReference](https://shaka-project.github.io/shaka-player/docs/api/shaka.media.SegmentReference.html)). Run/observe: test 3 run B; add `log('vtt uris', uris.length, uris[0])` inside `vttForTrack`. If `textStreams` is empty or `segmentIndex` is null after `createSegmentIndex()` (Amazon patches touch segment-index performance), fall back to the header and record that `src/player/hls.ts` (referenced in the scaffold comments, not yet in the tree) is required. Record in: test 3/4 Notes. Follow-up ticket: the `TODO(spike KIT-001)` in `src/player/adapters/fireos.tsx`.
- [ ] **N5 — `Platform.OS` on Vega.** Expected: `'kepler'`. Read the source carefully: the [RN for Vega Platform reference](https://developer.amazon.com/docs/react-native-vega/0.72/platform.html) literally types `Platform.OS` as `enum('kelper')` — a typo in Amazon's docs, not a second value. The `Platform.select` keys on the same page are `kepler`/`native`/`default`, and `'kepler'` is the real runtime value. The kit already maps `kepler` → `VegaAdapter` ([`src/player/adapters/index.ts`](../src/player/adapters/index.ts)) and `isVega()` checks it ([`src/platform/os.ts`](../src/platform/os.ts) — internal, and **not** re-exported from the package; see the note in §2.5). Run/observe: the harness logs `Platform.OS` on mount; read it in test 1. Record in: test 1 Notes. Follow-up ticket: `docs/getting-started.md` Vega step 4 (currently says `'vega'` expected — correct it), `resolveAdapter` comment.
- [ ] **N6 — How Shaka is vendored and which version.** Expected: `shaka-setup/build.sh` clones shaka-player, checks out `v4.8.5`, applies the `r1.2` tarball's 44 patch files (0001–0045, 0016 absent; subjects read `[PATCH n/45]`), `build/all.py`, copies `dist/shaka-player.compiled.js` to `src/w3cmedia/shakaplayer/dist/`; SDK 0.24 docs also list `4.16.13-r1.2` and `4.8.5-r1.7` ([Shaka on Vega, 0.24](https://developer.amazon.com/docs/vega/0.24/media-player-shaka-player.html)). Run/observe: §2.3; `grep -o 'v4\.[0-9.]*' apps/vega/src/w3cmedia/shakaplayer/dist/shaka-player.compiled.js | head -1`; and confirm you had to restore `shakaplayer/ShakaPlayer.ts` by hand (`copyOutputs.sh` deletes it — §2.3). Record in: test 1 Notes. Follow-up ticket: `README.md` install line, `docs/getting-started.md` Vega step 2.
- [ ] **N7 — `playbackRate` support on the Vega element.** Expected: `HTMLMediaElement.playbackRate` exists ([HTMLMediaElement API](https://developer.amazon.com/docs/vega-api/0.24/HTMLMediaElement.classes.HTMLMediaElement.amazon-devices_react-native-w3cmedia.html) — page exists; field list `UNVERIFIED`). Run/observe: test 5 `rateCheck`. Record in: test 5 Notes. Follow-up ticket: `KitPlayerRef.setRate` doc comment if only a subset of rates works.
- [ ] **N8 — Multi-track text on Vega.** Expected: only via the scheduler path. Run/observe: test 4. Record in: test 4 Notes. Follow-up ticket: `docs/getting-started.md`, adapter comment ("Multi text-track selection is a feature" — `CLAUDE.md`).

---

## 6. Friction logging

Every rough edge — an install step that needed a retry, a doc that named the wrong command, a header that leaks to the CDN, a permission missing from the sample's manifest — is a friction entry in the **consuming app's** `docs/friction/` (`described/docs/friction`, `lingo/docs/friction`), in the hackathon format: **task · steps · expected · actual · severity · workaround · suggestion** (per [`CLAUDE.md`](../CLAUDE.md)). Then add a link line to [docs/friction.md](friction.md) in this repo when the entry concerns the kit's platform surface. Candidates already visible from this runbook:
- `VideoPlayer` is a class, not a component, and docs/samples disagree on the w3cmedia version (`~2.1.0` / `~2.1.80` / `~2.3.2`).
- Shaka must be vendored by script; no npm package.
- `shaka-setup/copyOutputs.sh` deletes `shakaplayer/ShakaPlayer.ts` before copying, so the file the alias needs is missing in any app that does not already have its own copy checked in (§2.3).
- Both `ShakaPlayer.ts` and `W3CMediaPolyfill.ts` import `@amazon-devices/react-native-w3cmedia/dist/headless`, which may not exist in the version the sample pins (§2.3) — only if the check fails.
- The sample's `nmHoistingLimits: workspaces` plus Metro's eager resolution of unexecuted `require()`s means a cross-platform library cannot be bundled without per-app stubs for the other platform's packages (§2.1).
- `x-kit-text-urls` is sent to the CDN as a real HTTP header by react-native-video (the `headers` prop goes to the HTTP client — [props: source](https://docs.thewidlarzgroup.com/react-native-video/docs/v6/component/props/)).
- Fire OS text-track ids are ExoPlayer indexes; language-keyed URLs need the kit's own playlist parser.
- No documented CLI screen recording for the VVD.

---

## OPEN QUESTIONS

Things this runbook could not verify from the sources; treat the corresponding steps as best guesses until ticked.

1. The debug vpkg path and file name for the sample's Vega app (`apps/vega/build/<ARCH_DIR>/<APP>_aarch64.vpkg`), and whether SDK 0.24's CLI expects `react-native build-vega` while the sample's scripts call `build-kepler` (§1.5).
2. Whether the sample's Vega app (RN 0.72, `react-native-kepler ^2.0.0`) builds unchanged under SDK 0.24 on Node 20, or needs `vega project update` (§1.1, §2.2).
3. ~~Whether `copyOutputs.sh` copies the tarball's `ShakaPlayer.ts`/polyfills into `src/w3cmedia/`, or only `dist/`.~~ **Answered (§2.3):** it copies the polyfills and `PlayerInterface.ts`, but `rm -f`s `shakaplayer/ShakaPlayer.ts` first (vega-video-sample keeps its own copy checked in; the multi-tv sample has none), so that one file must be restored by hand. Still open in the same area: whether `@amazon-devices/react-native-w3cmedia/dist/headless` — imported by both `ShakaPlayer.ts` and `W3CMediaPolyfill.ts` — exists in the `~2.1.0` this app pins; it is only verified against `~2.3.2`. §2.3 has the one-line check.
4. Whether Metro's `extraNodeModules` alias resolves a `require('shaka-player')` issued from the portal-linked kit directory, whether the same mechanism is enough to stub each app's *foreign* platform packages or `resolveRequest` is needed instead, and whether `unstable_enableSymlinks` is needed in the Expo app too (§2.1, §2.3).
5. Whether the debug vpkg talks to a host Metro without extra flags (§2.6).
6. `new shaka.Player().attach(el)` vs `new shaka.Player(el)` on the Vega element (N2).
7. Runtime confirmation only for `textDisplayFactory` under Amazon's patched Shaka — the source says it is honoured unconditionally (4.8.5 `lib/player.js` 2116 and 3505; patch 0023 edits only the default factory), so the open part is whether the shipped build matches the source, plus whether `append()` receives cues per segment or in bulk (N3).
8. `getManifest().textStreams[].segmentIndex` availability after `createSegmentIndex()` under Amazon's segment-index patches (N4).
9. react-native-video/ExoPlayer text-track index order equals manifest order (harness `TEXT_URLS` keys).
10. Whether the Vega media stack sends an `Origin` header (does CORS matter on device at all) and whether `hls_characteristics` needs quoting on the packager CLI (§3.1).
11. `playbackRate` 0.75 on the Vega `VideoPlayer` (N7).
12. On-device path for `gwsi-tool-screenshooter` output and `vega exec vda pull` of it; existence of any VVD screen-recording CLI (§2.7).
13. The `ReactNativeJS` logcat tag as the filter for `console.log` on Fire OS (§2.7) — the harness prefix `KIT-SPIKE` sidesteps it.
14. Fire OS: whether `fromRnvAudio` can ever report `description` from a CloudFront stream without relying on the track title (test 6).
15. Test 7: two `VideoPlayer` instances in one process — no documentation either way beyond the single-`KeplerCaptionsView` limit.

## Sources relied on

Amazon Vega (0.24 unless noted): [Install VDT](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html) · [Run your app](https://developer.amazon.com/docs/vega/0.24/run-apps.html) · [CLI reference](https://developer.amazon.com/docs/vega/0.24/cli-tools.html) · [VDA reference](https://developer.amazon.com/docs/vega/0.24/vda-tools.html) · [Loggingctl](https://developer.amazon.com/docs/vega/0.24/loggingctl.html) · [Logs](https://developer.amazon.com/docs/vega/0.24/logs.html) · [Developer mode](https://developer.amazon.com/docs/vega/0.24/developer-mode.html) · [W3C Media API](https://developer.amazon.com/docs/vega/0.24/media-player.html) · [Media player setup](https://developer.amazon.com/docs/vega/0.24/media-player-setup.html) · [Selecting the playback mode](https://developer.amazon.com/docs/vega/0.24/media-player-select-playback.html) · [Shaka Player on Vega](https://developer.amazon.com/docs/vega/0.24/media-player-shaka-player.html) · [Implement closed captions](https://developer.amazon.com/docs/vega/0.24/implement-closed-captions-vega.html) · [Media player FAQ](https://developer.amazon.com/docs/vega/0.24/media-player-faq.html) · [w3cmedia API README](https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_react-native-w3cmedia.html) · [RN for Vega: Platform](https://developer.amazon.com/docs/react-native-vega/0.72/platform.html) · [RN for Vega overview](https://developer.amazon.com/docs/vega/0.24/vega-rn-overview.html) · [0.24 release notes](https://developer.amazon.com/docs/vega/0.24/vega-release-notes.html).
Amazon samples: [vega-video-sample](https://github.com/AmazonAppDev/vega-video-sample) (README, package.json, manifest.toml, `src/screens/PlayerScreen.tsx`, `shaka-setup/build.sh`, `shaka-setup/copyOutputs.sh`, `shaka-setup/shaka-rel-v4.8.5-r1.2.tar.gz` → `src/shakaplayer/ShakaPlayer.ts`, `src/AppPreBuffering.tsx`, `src/polyfills/*`, `shaka-patch/0023-Fix-captions-rendering.patch`) · [react-native-multi-tv-app-sample](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample) (README, root/apps/packages `package.json`, `apps/vega/manifest.toml`, `apps/vega/metro.config.js`, `apps/vega/src/navigation/VegaRootNavigator.tsx`, `packages/shared-ui/src/{index.ts,navigation/*,screens/PlayerScreen.vega.tsx,utils/VideoHandler.kepler.ts}`).
Fire OS / Android: [Connect to Fire TV through ADB](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html) · [adb](https://developer.android.com/tools/adb) · [logcat](https://developer.android.com/tools/logcat) · [react-native-video v6 props](https://docs.thewidlarzgroup.com/react-native-video/docs/v6/component/props/) · [Expo: building for TV](https://docs.expo.dev/guides/building-for-tv/) · [Expo CLI](https://docs.expo.dev/more/expo-cli/).
Shaka: [Player API](https://shaka-project.github.io/shaka-player/docs/api/shaka.Player.html) · [shaka.extern](https://shaka-project.github.io/shaka-player/docs/api/shaka.extern.html) · [TextDisplayer](https://shaka-project.github.io/shaka-player/docs/api/shaka.extern.TextDisplayer.html) · [Text displayer tutorial](https://shaka-project.github.io/shaka-player/docs/api/tutorial-text-displayer.html) · [SegmentIndex](https://shaka-project.github.io/shaka-player/docs/api/shaka.media.SegmentIndex.html) · [SegmentReference](https://shaka-project.github.io/shaka-player/docs/api/shaka.media.SegmentReference.html) · [demo assets](https://raw.githubusercontent.com/shaka-project/shaka-player/main/demo/common/assets.js) · [Packager HLS tutorial](https://shaka-project.github.io/shaka-packager/html/tutorials/hls.html) · [Packager docs](https://shaka-project.github.io/shaka-packager/html/documentation.html) · [Packager releases](https://github.com/shaka-project/shaka-packager/releases/latest).
Tooling/AWS: [Yarn link:](https://yarnpkg.com/protocol/link) · [Yarn portal:](https://yarnpkg.com/protocol/portal) · [Metro configuration](https://github.com/facebook/metro/blob/main/docs/Configuration.md) · [Homebrew android-platform-tools](https://formulae.brew.sh/cask/android-platform-tools) · [ffmpeg](https://ffmpeg.org/ffmpeg.html) · [RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216) · [S3 CORS elements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html) · [put-bucket-cors](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-bucket-cors.html) · [s3 sync](https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html) · [CloudFront getting started](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GettingStarted.SimpleDistribution.html) · [managed origin request policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html) · [managed response headers policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-response-headers-policies.html).
