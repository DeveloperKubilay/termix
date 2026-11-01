# Android correction verification — 2026-10-30

## Toolbar, keychain and settings pass

Final source: `npm run android:test` **60 passed, 0 failed**. JavaScript syntax
checks and `git diff --check` passed (CRLF warnings only). Preview APK built
successfully, then installed with `adb install -r` on Samsung SM-G990B2 / Android
16 without clearing app data. A second build included a host-drawer variable-scope
correction caught during integration review.

### Physical-device observations in this pass

- Toolbar DOM and screenshot show two rows: **Tab Esc Ctrl Clear ↑ ↓** /
  **Copy Paste Alt ← → Kbd**. Existing modifier/arrow regression tests pass.
- New Host drawer previously had 33 CSS px redundant top padding. It now has 0;
  first form group moved from y=106 to y=65, with content padding reduced to 8px.
  Native status-bar/cutout insets remain. New/Edit share this drawer styling;
  a saved-host Edit interaction was not separately exercised.
- New Key opened Android's real system document picker. Imported the explicitly
  authorized PEM as an opaque file, without reading its bytes into tooling/model
  context. Native result and key card expose metadata only. Permission check was
  `-rw-------`. Shared-storage temporary key copy was removed immediately after
  import. Picker cancellation left the list unchanged. The visible Delete button
  opened confirmation and removed only the generated imported key.
- New Host certificate dropdown accepted input and displayed Import New Key.
  Backend tests cover deletion confinement, referenced keys in current/other
  profiles, invalid-profile fail-closed behavior, and the bridge delete route.
- Save All Settings displayed Saved and persisted Copy Selection. After a full
  WebView reload, both stored setting and rendered toggle remained false. Original
  terminal preferences were restored. A native process-kill/restart was not used
  for this check.
- Physical WebView touch injections selected `alpha`, extended to 65 characters,
  and kept viewport=40 throughout. With Copy Selection off, clipboard stayed at
  the QA sentinel. With it on, clipboard stayed unchanged during dragging and
  matched selection only after touch end. Previous clipboard was restored.
- Independently compared the disposable local fixture's SHA256 host identity
  before accepting its first-use prompt. Unknown/changed/rejected/expired/aborted
  trust paths and profile/concurrent-approval races have regression coverage.
- SFTP downloaded **5,242,897 bytes** to private staging and SAF exported it.
  SAF re-imported that generated file; SFTP uploaded it to the disposable fixture,
  including app backgrounding via HOME. Remote-to-private roundtrip checksum,
  exported file checksum and fixture source checksum all matched:
  `ca3bcb25372399ddd47a2b91877aeae15dfe99be9f67916608ff87b562da4c8e`.
  The first checksum was taken before native export completed (empty destination);
  only the successful export result and final matching checksum count as passing.
  This is a short background check, not a long-duration/OEM-kill guarantee.
- Removed generated download, imported key, temporary transfer profile, fixture
  Known Hosts entry and private staging directories; restored original profile,
  terminal settings and clipboard. No production commands, SFTP or file changes.

### Production connection limitation

The explicitly authorized host reached SSH host-key verification. Its first-use
identity was not independently verified, so the test rejected it with
`Host denied (verification failed)` rather than silently accepting it. Authentication
and connect/disconnect success are **not claimed**. No terminal input was sent.
The original desktop key was never changed or opened. The temporary imported
phone key was deleted after this attempt.

### Transfer, notification and runtime limits

Transfers stream through native 64 KiB SAF buffers and SFTP fastGet/fastPut;
payloads are not encoded into the 4 MiB JSON bridge. Private staging still needs
file-sized free space, and export supports regular files rather than directories.
Matching hashes establish integrity for this fixture, not Windows performance
parity or an unconditional security guarantee. Picker cancellation has regression
coverage; export cancellation/cleanup was physically checked in the earlier pass,
not repeated in this pass.

Foreground service/ongoing notification/wake lock reduce background interruption,
but cannot defeat force-stop, Android/OEM battery management, memory pressure or
service time limits. Android 14+ permits dismissal of foreground notifications;
there is no supported universal non-dismissable flag for an ordinary SSH app.
Existing ongoing/NO_CLEAR/restore behavior is unchanged. Runtime remains the EOL
Node 18 / 4 KiB-page preview, not a production-security or 16 KiB support claim.
Desktop UI was not launched; desktop keychain/settings behavior has unit coverage.
No commit, push or release was performed.

## Android gesture correction (subsequent pass)

The previous gesture tests dispatched events directly on a mock body and missed
xterm's competing bubbling touch handlers. Android now owns terminal touch events
in the wrapper's capture phase, before xterm can scroll its viewport.

- Normal swipe scrolls; release adds decaying momentum, stopped by a new touch.
- A 450ms hold selects a word. Dragging that gesture extends selection, not scroll.
- Two Android-only endpoint handles adjust completed selections. An outside tap
  clears selection without opening the keyboard; an outside swipe clears and scrolls.
- Selection auto-scroll requires dragging more than 8 CSS px outside the terminal
  and dwelling for 250ms. Merely selecting first/last visible rows does not scroll.
- Resize saves the viewport before queued fitting can change it, retaining history
  and following the bottom only when it was already following without selection.
- Desktop code, native Java, SSH backend, and xterm dependencies are unchanged.

### Device observations

Updated debug APK installed with user approval and `adb install -r` on the connected
Samsung SM-G990B2 (Android 16). No uninstall or app-data clearing. Used a new,
unsaved local SSH fixture tab, never a saved host connection.

- CDP `Input.dispatchTouchEvent` on the actual WebView: long press selected `beta`;
  multi-line drag and a hold within the lower interior edge kept viewport at 70.
- End-handle drag changed the selected range while viewport remained 70.
- Fast swipe cleared selection; after release viewport continued 75 → 85; a new
  touch stopped further movement (85 → 85).
- Keyboard open/close changed 28 → 12 → 28 rows while viewport stayed 70 and the
  selected buffer range/text remained unchanged. The first device pass exposed a
  pre-RAF fitting race; snapshot timing was corrected and this check then passed.
- With the keyboard already open, long press and multi-line drag kept viewport 54.
- Deliberate drag above the boundary did not scroll at 150ms; after dwell moved
  viewport 70 → 68; re-entering stopped it at 68.
- Copy read-back matched all 153 selected characters. Previous clipboard text was
  restored immediately afterward.

These are automated touch injections into a physical Android WebView, not a claim
that a person has evaluated the final finger feel. xterm still renders scrollback
in terminal rows; the momentum is native-like, not a replacement with Android's
native text/scroll widget. Rotation and desktop UI were not exercised in this pass.

Automated DOM regressions now use jsdom's real capture/bubble path, simulated
competing xterm listeners, deterministic timers/RAF, and terminal cell coordinates.
They cover selection isolation, handles, inertia/bounds, cancellation, multi-touch,
compatibility mouse events, Unicode wide cells, disposal, and pre-RAF resize races.

The build and test counts below describe the earlier pass, not this gesture pass.
Final gesture-pass results are recorded at the end of this document.

## Build and test result

- `npm run android:test`: **20 passed, 0 failed**.
- JavaScript syntax checks passed for Android mobile/bridge, connection and SFTP modules.
- `npm run android:build:preview`: **BUILD SUCCESSFUL**.
- Updated APK installed with `adb install -r` on a physical Android 16 test device. No uninstall or app-data clearing (`pm clear`).
- Artifact: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Actual physical-device checks

All SSH/SFTP mutations used the disposable local fixture, reached through ADB reverse. No production-host commands or file operations were used for these checks.

| Check | Observed result |
| --- | --- |
| Fast keyboard typing (`beforeinput`) | Intercepted rapid soft-keyboard typing (`echo HELLO_FAST_INPUT\r`) without dropped characters; fixture received 100% of characters in exact sequence. |
| Touch text selection | Long-press gesture (~450ms) on terminal body detected cell coordinates and buffer word boundaries; selected `'terminal'` (`hasSelection: true`), and Copy button copied the selected text directly to the native Android clipboard. |
| Foreground Service (`TermixService`) | Active SSH session started `TermixService` with `PARTIAL_WAKE_LOCK` and ongoing notification "1 terminal session active" with "Stop All" action (`isForeground=true`). |
| App backgrounding / screen-off keepalive | App backgrounded via HOME key (`input keyevent 3`); `TermixService` remained foreground; commands sent while backgrounded (`echo BACKGROUND_ALIVE\r`) were received and processed by SSH fixture. App resumed without session drop. |
| Automatic service shutdown | Closing the terminal tab cleared active connections, and `TermixService` immediately stopped (`isForeground=false`, notification removed). |
| Ctrl tap, then Samsung soft-keyboard C | Fixture received byte `03`. |
| Held Ctrl, then Samsung soft-keyboard C | Fixture received byte `03`; release did not leave modifier latched. |
| Alt+x | Fixture received `1b 78`. Character inserted through CDP into the focused xterm textarea. |
| Toolbar arrows | Fixture received `ESC[A`, `ESC[B`, `ESC[D`, `ESC[C`. |
| Application cursor mode Up | Fixture received `ESC OA`. |
| Copy (without selection) | Native clipboard read-back contained the visible fixture terminal lines. |
| IME open/close | Terminal changed from 28 to 12 rows, then returned to 28. At open: body 261 CSS px, xterm screen 244 CSS px, toolbar starts at y=309; cursor and long-output prompt remained above toolbar. |
| Three tabs | Widths 150 / 155.19 / 155.19 CSS px; horizontal overflow enabled, vertical overflow hidden. |
| File long-press | Touch hold opened menu with Download to Device. |
| Small download | Native Android save picker opened; saved 32-byte file hash matched source. |
| Large download | 5 MiB + 17 bytes saved successfully, larger than the 4 MiB bridge frame limit; saved hash matched source. |
| Export cancellation | UI reported cancellation; staging directory inspection found no previous export directories remaining. |
| Move | Move did not open Rename; cut → destination folder → Paste removed source and created destination. Destination hash matched original bytes. |
| Same-directory move | Rejected without deleting source. |
| Failed copy during move | Simulated copy failure through the test page's adapter; source stayed intact and destination was not created. Adapter restored immediately afterward. |
| SFTP overwrite staging | Existing regular-file targets use `.termix-part-*` temporary siblings. Remote upload overwrite currently removes the old target before rename; it is not atomic replacement. New targets are written directly and may remain partial after interruption. |
| Native streaming upload | `native:pick-upload-file` streams directly from SAF `openInputStream` via 64KB buffers to app-private staging and remote SFTP, bypassing DOM Base64 chunking. |

Small download SHA-256: `7d4446c6c86669085ad7886c206623677c760fcb40f3927ce127a6119fedf054`.

Large download SHA-256: `1c51cd366c7e30f976574f40eebdb1a55fa1aba86f87964a0d1a267f6c3ce4ac`.

Move SHA-256: `2d47338150acbe9285f2c1f3797d01ecf408054de40921607c02742652593380`.

## Preservation and cleanup

- Used a separate disposable local profile for SFTP tests, restored the original profile afterward, and removed only the generated QA profile.
- Original profile and saved hosts remained intact after restoration; no saved host list replacement was performed on it.
- Removed the two uniquely named generated download files from the phone after hash verification.
- Stopped the local fixture and removed the ADB reverse/debug forwards.
- No commits, pushes, releases or GitHub Actions runs were performed.
- These corrections are scoped to Android UI/bridge behavior. Desktop Electron was not launched as part of this correction pass; no desktop UI verification is claimed.

## Remaining scope limits

- Download/export supports regular files, not folders; folder attempts show an explicit error.
- Runtime remains the existing EOL Node 18 / 4 KB-page preview. This is not a production-runtime or 16 KB-page compatibility claim.
- UI tests used the installed phone app and a disposable SSH/SFTP fixture, not a real `top` process on a production host. Ctrl+C wire correctness was checked directly at the SSH fixture.

## Gesture-pass final results

- `npm run android:test`: **38 passed, 0 failed** (28 mobile / 10 backend+bridge).
- `node --check` passed for `public/android/mobile.js` and the mobile test suite.
- `git diff --check` passed (only repository CRLF conversion warnings).
- `npm run android:build:preview`: exit code 0; final debug APK installed with
  data preserved. Selection isolation and fling interruption were repeated on
  that final installed build.
- Generated fixture terminal closed; app returned to Dashboard. Local fixture
  stopped and its temporary filesystem removed. Only the newly created ADB
  reverse on 22222 and debug forward on 9223 were removed; the pre-existing
  forward on 9222 was left untouched.
- No saved hosts/profiles replaced, app data cleared, commits, pushes, or releases.

## Android Direct SFTP Streaming & Auto Host-Key Pinning — 2026-10-31

### 1. Zero-Staging Direct SFTP Streaming
- **Data Path**: Direct streaming over dedicated binary Unix domain socket (`t.sock` / Android `LocalSocket` to Node `net.Server`). Replaces whole-file duplication into `data/local/staging`.
  - **Upload**: Android SAF `openInputStream` → native 64 KiB chunks → `t.sock` → Node SFTP writeStream. Remote file is written to `.termix-part-<UUID>` with atomic commit on EOF.
  - **Download**: Remote SFTP readStream → Node backpressured stream → `t.sock` → native 64 KiB buffer → Android SAF `openOutputStream`. Explicit framed ACK validates completed byte count before finalizing.
  - **Zero Staging Verification**: `files/data/local/staging` remained empty (0 bytes) during transfers. No intermediate whole-file buffering in memory or on internal flash.
  - **Preservation & Overwrite**: When destination exists on SFTP server, atomic POSIX rename (`posix-rename@openssh.com`) is used. If unsupported, the original remote file is strictly preserved and an error is reported; no unsafe unlink-before-rename.
  - **Desktop SFTP Isolation**: Desktop/Windows SFTP implementation (`util/sftp/manager.js`) remains completely untouched except for opt-in `onSessionReady`/`onSessionClose` listeners.

### 2. Automatic First-Use Host Key Pinning
- **No First-Use Dialog**: The interactive "Trust SSH Server?" prompt on first connection has been eliminated on Android.
- **Pinning**: First encountered host key is automatically stored in the active profile's `knownHosts` storage.
- **Verification**: Matching pins pass silently and instantly. Any subsequent connection where the host key has changed is strictly blocked with an error notification (fail-closed security).
- **Isolation**: Host key pins are strictly isolated to the active profile; switching profiles maintains separate trust domains.

### 3. Test & Build Results
- `npm run android:test`: **72 passed, 0 failed** across all 10 Android test suites (transfers, trust, bridge, sessions, UI, transport).
- `npm run android:build:preview`: **BUILD SUCCESSFUL**.
- Installed on physical test device (Samsung SM-G990B2, serial `R5CX70L35PX`) with `adb -s R5CX70L35PX install -r android/app/build/outputs/apk/debug/app-debug.apk` without clearing app data.
- Verified bridge capabilities (`ssh: true`, `sftp: true`, `knownHosts: true`) and zero staging usage on device.
- All ADB commands strictly targeted device `R5CX70L35PX`; no uninstalls or data wipes. Private PEM keys were never read, inspected, or logged into model context.


## Spacebar deduplication, landscape toolbar and picker URI pass

- **Spacebar double-space fix**: Android WebView dispatches both `keypress` (handled by xterm's internal `term.onData`) and `beforeinput` (`inputType: "insertText"`) for Space (keyCode 32). Implemented bidirectional cross-source deduplication in `public/android/mobile.js` using an 80ms tracking window, and guarded `sendTerminalInput` in `public/modules/connection/connection.js`. Verified on physical device via CDP: rapid space input emits exactly one space character, while deliberate multi-space typing after 80ms remains intact.
- **Landscape terminal toolbar suppression**: Added `@media (orientation: landscape) { .termix-android .android-terminal-toolbar { display: none !important; } }` in `public/android/mobile.css`. Verified on physical Samsung SM-G990B2: in portrait `toolbarDisplay: "grid"`, upon rotation to landscape `toolbarDisplay: "none"`, expanding terminal body and triggering `ResizeObserver`/`fitAddon`.
- **System picker Downloads navigation hint**: Added `DocumentsContract.EXTRA_INITIAL_URI` pointing to system downloads provider in `MainActivity.java` for both `native:import-key` and `native:pick-upload-file` on Android 8.0+.
- **Test suite**: `npm run android:test` passed **60 passed, 0 failed**.
- **Build & deploy**: `npm run android:build:preview` compiled successfully. Updated APK installed with `adb install -r` without app-data clearance. Device checks passed.

## Landscape layout expansion and safe-area double-inset fix

- **Double-inset elimination**: In `MainActivity.java`, native window insets (`bars.left`, `bars.top`, `bars.right`, `Math.max(bars.bottom, ime.bottom)`) are applied to the root container layout. Having `padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);` on `body` and `.right-drawer` in `public/android/mobile.css` was applying safe-area margins twice (33 CSS px on left, 15 CSS px on bottom), creating blank margins in landscape. Updated `body` and `.right-drawer` padding to `0`.
- **Compact landscape tab bar**: Reduced `.pane-tabbar`, `.tab`, and `.sidebar-toggle` height from 48px to 38px in `@media (orientation: landscape)`.
- **Physical device verification**: Installed-build CDP measurement on Samsung SM-G990B2: landscape WebView 747 × 315 CSS px, body padding `0px`, tab bar 38px, terminal body 747 × 277 CSS px, toolbar `display: none`. No injected test stylesheet was present. The terminal fills the native-provided content area. Native status/navigation/camera-cutout bands remain deliberately reserved; this is not an immersive full-screen change.
- **PEM test placement**: Staged opaque `id_rsa.pem` directly to `/sdcard/id_rsa.pem` (root) and `/sdcard/Download/id_rsa.pem` (Downloads) on the device using ADB without reading or logging private key bytes into context.

## Host key picker import icon alignment

- Scoped `.cert-import-item > i` to static positioning with no transform in Android CSS. The shared `.input-with-icon-left i` selector was positioning the dropdown's plus icon as if it were the input's leading icon.
- Rebuilt and installed APK with data preserved; physical WebView computed style reports `position: static`, `transform: none`, and icon/row center difference below 0.5 CSS px. All 60 Android tests passed; whitespace check passed with CRLF conversion warnings.

## Automatic exit tab closure and Modern-only UI — 2026-11-01

- Corrected after user clarification: clean shell exit (`exitCode === 0`) automatically closes its terminal tab on PC and Android through the shared TabManager cleanup. It no longer displays an ended-session or Enter-to-restart prompt. Network/error disconnect handling remains separate.
- Android notification stop-all remains a separate explicit tab/SFTP cleanup path. Regression tests verify active/ended tab cleanup and return to dashboard/hosts.
- Modern is the only application UI theme; Classic/legacy settings normalize to Modern. Initial HTML and root palette are Modern; the settings theme toggle is removed. Independent terminal color schemes are unchanged.
- All 76 tests passed, along with JavaScript syntax and whitespace checks. APK built and installed with `install -r` on device `R5CX70L35PX` without clearing app data.
- Physical WebView test against the disposable localhost SSH fixture verified actual `exit` automatically removed the tab and its terminal DOM. Modern remains active. Earlier settings verification confirmed the theme toggle is absent. Fixture pin and temporary ADB mappings were cleaned up.
- Desktop renderer/normalization regressions passed, but actual desktop GUI verification was blocked: the checkout has no installed Electron module/executable. No desktop GUI success is claimed.

## Transfer staging limits clarified

- Users select documents through Android's system picker; moving them into shared-storage root is not required.
- Upload first streams the selected document into one full app-private staging copy, then SFTP reads that path. Download first writes a full staging file, then streams it to the chosen document provider. Buffers are bounded, but staging consumes file-sized disk space; during download export both staging and the destination can coexist.
- Normal completion/error/cancellation paths attempt staging cleanup. Cleanup failures are swallowed in some paths. No startup sweep of orphan staging was found; force-stop, process death, or power loss can leave files behind. No numeric failure probability is established.
- Native export errors delete the staging source, not the partially written SAF destination. A destination document may therefore remain incomplete. Remote upload cleanup is likewise best-effort, especially after connection loss. These limits were identified by source inspection, not a new process-kill test.
