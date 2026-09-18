# Exact-position resume

The launcher stores one full machine checkpoint per game in IndexedDB. **Back to
library** pauses the machine and offers:

- **Yes, and save state** — replace the checkpoint, then quit after storage commits.
- **Yes and don't save state** — quit, retaining any older checkpoint. Normal disk
  writes are still saved.
- **No, continue playing** — return to the game, preserving its previous pause state.

The next launch offers **Continue playing** or **Start normally**, with the saved
time shown. Starting normally uses normal persistent disk saves. Resuming uses the
checkpoint's matching disks, including disks ejected earlier in the session; this
can roll disk contents back to the saved position.

**Delete saved position** in a game's settings removes only its checkpoint.
**Delete stored data** removes its checkpoint and disk saves together. `.saesave`
exports remain disk backups; they do not contain machine checkpoints. Checkpoints
belong to the browser profile and origin. There is no automatic checkpoint on tab
closure, and no periodic checkpointing.

## Capture and restore

`sae/state.js` captures the machine after the CPU has acknowledged pause. The
current instruction and JavaScript device callbacks have returned, and guest
writes are quiescent. It includes:

- CPU registers, flags, PC, prefetch/cache contents, exception and halt state.
- RAM, ROM bytes, memory maps and expansion state.
- Chipset registers, copper state, pending blitter rows, drawing/DMA state, Paula
  channels, CIA timers, interrupts and input queues.
- Floppy mechanics/track buffers, IDE commands/sector buffers, mounted media and
  file seek positions.
- Emulated clocks, pending event callbacks and event ordering.

The graph codec preserves cycles, typed-array buffer aliases and references shared
between globals and private device fields. Closure-backed devices keep their fresh
live instances. Read-only lookup tables retain their identities. Callbacks are
resolved against named functions and deterministic paths in the initialized core;
no executable code is stored or evaluated. Unknown callbacks cause a visible save
error, not an incomplete checkpoint.

`tools/generate-state-access.cjs` generates explicit, non-enumerable getters and
setters in the core constructors. Its reviewed exclusion list omits browser audio
resources, host sample queues, animation-frame IDs, wall-clock pacing and derived
CPU tables. DOM/canvas/WebGL resources and pointer lock are recreated by normal
startup. Restore runs after device reset and `custom_prepare`, before the first
guest instruction. Audio rate and renderer must match.

The launcher validates the core build fingerprint, schema, settings, ROM SHA-256
and original prepared media hashes. The presentation-only Picture setting is
excluded from compatibility checks, so CRT can be changed without losing resume. Compressed machine data has a SHA-256 checksum;
checkpoint disk copies have individual checksums. All graph references and device
schemas are decoded/validated before setters run. Failure stops the fresh machine
and leaves prior stored disks and checkpoints intact.

`launcher/checkpoints.js` stores gzip-compressed data and requires browser
CompressionStream/DecompressionStream support. Immutable copies of the machine and
matching disks are committed in one IndexedDB record. A failed replacement leaves
the old record intact and the game paused for retry or continuation. Web Locks and
revision checks protect against competing tabs. After successful restore, mounted
file callbacks target the new persistence session, so subsequent writes still save.

## Maintaining the schema

After changing a core state field, callback or immutable table, regenerate:

```sh
# TypeScript is a development dependency only; install/provide it on NODE_PATH.
node tools/generate-state-access.cjs
node tools/generate-state-access.cjs --check
```

`SAE_TYPESCRIPT` can instead point to an installed TypeScript module. The generator
also updates `sae/state-globals.js` with a hash of core sources. A changed core build shows a warning and offers **Try restoring** when no other
compatibility checks differ. Restore still validates the state schema, callbacks,
device fields and runtime environment; failures stop the attempted launch and
leave the stored checkpoint intact. A successful restore cannot guarantee that
changed emulation code will behave identically. Older event-scheduler states may
contain `is_syncline` and `is_syncline_end`; the loader discards these retired
browser pacing fields while requiring every current guest-state field. Other
schema mismatches report the missing or unexpected field names.
Ordinary disk saves remain usable. Do not add a mutable object to the immutable
constant registry; review the exclusion list whenever host/device state changes.

## Verification

`node --test tests/*.test.cjs` covers graph aliasing/cycles, closure rebinding,
immutable table identities, special numeric values, compressed integrity, missing
callbacks/fields, checkpoint disk adoption and a partially completed blit restored
into a fresh device with the correct final interrupt.

`tests/state.browser.cjs` uses local game/BIOS fixtures and an isolated Chromium
profile. It exercises the real UI and reloads the page between capture and restore.
It compares CPU/RAM/clocks at the pre-instruction boundary, then runs the restored
machine, uses controls, writes through the restored disk handle, and checks normal
launch, pause preservation, storage failure, deletion and stale writer rejection.
It also compares CIA, copper, blitter, Paula and scheduler fields.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROMIUM_EXECUTABLE=/path/to/chromium node tests/state.browser.cjs

# Installed game fixtures are not distributed with the tests.
STATE_GAME='Sensible World Of Soccer 97-98' STATE_BOOT_MS=35000 STATE_CAREER=1 \
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROMIUM_EXECUTABLE=/path/to/chromium node tests/state.browser.cjs
```

Validated with Qwak ZIP, Turrican LHA, and SWOS 96–97 and 97–98 LHA careers on
the default PAL A1200, including continued menu input and disk writes after a fresh
page load. Qwak also passes with NTSC and Canvas rendering. The disk-save browser
test verifies the version-one database upgrade. Corrupt checkpoints, quota failure,
stale writers and checkpoint-only deletion have separate checks. This is not an
exhaustive compatibility claim for every CPU, chipset mode or protected floppy
format; existing emulator limitations still apply.
