# Build Yogurt + Coast

This fork currently ships as source. You can run it directly on a Mac, or build a local app bundle for Applications.

## Run on your Mac

Use an Apple silicon Mac with at least 8 GB of memory and macOS 14.4 or later. To add screenshots, also install a version of Coast Local compatible with your macOS version. Coast is optional for recording and transcription. [Set up Coast Local](README.md#attach-screenshots-after-a-call)

1. Install Node.js 24, pnpm 10.7.0, CMake, and Apple’s Xcode Command Line Tools (`xcode-select --install`).
2. Clone the fork and build the native audio, transcription, calendar, OCR, and MCP helpers:

   ```sh
   git clone https://github.com/guglielmofonda/yogurt-coast.git
   cd yogurt-coast
   pnpm install --frozen-lockfile
   pnpm -C app native
   ```

3. Quit any running copy of Yogurt, then start the fork:

   ```sh
   pnpm dev
   ```

   Complete model downloads and allow microphone and system audio access when prompted. To use a separate meeting library, set `YOGURT_USER_DATA` to an absolute directory before starting the app. The default profile is shared with upstream Yogurt.

## Package Yogurt + Coast on macOS

After the setup above, choose a valid Apple code-signing identity from your keychain. Find its fingerprint with `security find-identity -v -p codesigning`, then build:

```sh
export YOGURT_COAST_CERTIFICATE="YOUR_CERTIFICATE_FINGERPRINT"
pnpm -C app build
pnpm -C app package:coast
```

The bundle is at `app/dist/mac-arm64/Yogurt + Coast.app`. Quit the source app before opening the bundle. Copy it into Applications to use the installed paths in the [user guide](README.md#connect-an-agent). This local build is signed, unnotarized, and has automatic updates disabled.

## Test a change

```sh
pnpm -C app typecheck
pnpm -C app test
pnpm -C app e2e
```

The end-to-end suite uses isolated profiles. The Coast screenshot test records a simulated call, skips its paused interval, imports a fixture slide, and checks that the meeting can be found by text on that slide.

## Connect Hermes on another computer

The [Hermes setup guide](README.md#hermes-on-another-computer) covers read-only access over SSH.

## Other platforms

The Coast screenshot workflow and Apple Calendar picker require macOS. The inherited Windows and Linux targets have their own calendar options. [Windows and Linux calendar setup](google-calendar.md)

To work on those targets, install Node.js 24, pnpm 10.7.0, CMake, Rust, and the Vulkan SDK. Windows also needs Visual Studio C++ Build Tools. Linux needs `libpulse-dev` and `pkg-config`. On Ubuntu 24.04 or later, `libvulkan-dev`, `glslc`, and `spirv-headers` can replace the Vulkan SDK. Clone into a path without spaces on Linux. If Electron’s sandbox needs configuration, `pnpm dev` prints the commands for your installation.
