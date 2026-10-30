# Android correction verification — 2026-10-30

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
| Atomic SFTP overwrite protection | Transfers write to temporary sibling `.termix-part-*` files; original destination is never truncated or deleted prior to full completion and atomic rename. |
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
