# Build and run Yogurt locally

## You need

- Node.js 24 and pnpm 10.7.0
- CMake
- **Mac:** Xcode Command Line Tools
- **Windows:** Rust, the Vulkan SDK, Visual Studio C++ Build Tools
- **Linux:** Rust, the Vulkan SDK, `libpulse-dev`, `pkg-config`. On Ubuntu 24.04 or newer, these packages can stand in for the Vulkan SDK:

  ```sh
  sudo apt install libpulse-dev pkg-config libvulkan-dev glslc spirv-headers
  ```

On Linux, clone into a folder whose path has no spaces: Electron's sandbox can't start from one.

## Run it

```sh
git clone https://github.com/guglielmofonda/yogurt-coast.git
cd yogurt-coast
pnpm install --frozen-lockfile
pnpm -C app native   # builds the audio, system and transcription helpers (first time, and after they change)
pnpm dev             # opens Yogurt from source
```

The first run downloads the AI models, like the installed app.

- **Separate profile:** `YOGURT_USER_DATA=/tmp/yogurt-dev pnpm dev` keeps your real meetings out of it.
- **Without models:** `YOGURT_FAKE=1 pnpm dev` swaps in a fake transcriber, notes model and call audio, so the whole app runs in seconds.
- **Linux sandbox:** on Ubuntu 24.04 and other systems that turn off unprivileged user namespaces, Electron's sandbox helper must be owned by root. `pnpm dev` prints the two `sudo` commands when it isn't, and they're needed again after `node_modules` is reinstalled.

## Test

```sh
pnpm -C app typecheck
pnpm -C app test   # unit tests
pnpm -C app e2e    # builds, then drives the app with Playwright in fake mode
```

## Package Yogurt + Coast on macOS

The Mac build uses Apple Calendar without publisher credentials. An optional Windows or Linux build with direct Google sign-in includes the publisher’s Desktop OAuth client in `app/resources/google-calendar-client.json`. [Configure Google Calendar](google-calendar.md)

Use a valid Apple code-signing identity from your keychain. Set `YOGURT_COAST_CERTIFICATE` to its certificate fingerprint (listed by `security find-identity -v -p codesigning`), then run:

```sh
pnpm -C app build
pnpm -C app package:coast
```

Open `app/dist/mac-arm64/Yogurt + Coast.app` or copy it to Applications. The local package keeps upstream's Yogurt profile. Quit the other copy before opening it. This signing path produces a local build without notarization or an update feed.

## Connect Hermes on another computer

If the Hermes computer already has authenticated SSH access to your Mac, configure the Mac as an SSH host named `meeting-mac` and run this on the Hermes computer:

```sh
hermes mcp add yogurt-coast --command /usr/bin/ssh --args -T meeting-mac '"/Applications/Yogurt + Coast.app/Contents/Resources/bin/yogurt-mcp" --read-only'
hermes mcp test yogurt-coast
```

Use a new Hermes session or run `/reload-mcp` in an open one. The Mac holding the meetings must be awake and reachable.

## Upstream release process

`sh app/scripts/release.sh X.Y.Z` sets the version, tags it and pushes. GitHub Actions builds Mac (signed and notarized), Windows and Linux, and publishes one release once all three pass. Installed copies update from it.
