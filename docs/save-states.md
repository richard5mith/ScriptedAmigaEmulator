# Exact-position resume

Status: not implemented. Persistent disk saves are implemented separately in
`launcher/saves.js`. They survive reload but do not resume a running machine.

The SAE core has no state capture/restore API. Most device state is held in private
closures, and RAM alone is insufficient. A reliable snapshot needs:

- CPU registers, flags, supervisor state, PC, prefetch and pending exceptions.
- Chip/fast/slow RAM, memory maps, ROM identity and expansion state.
- Chipset registers and DMA progress: copper, blitter, display, audio and interrupts.
- CIA timers and ports, RTC, input state, floppy mechanics/DMA and IDE commands.
- Cycle counters, pending emulated events and their ordering.
- Mounted media identities plus an immutable copy of disk changes at capture time.

Capture must happen at a defined instruction/frame boundary with the machine
paused and disk writes quiescent. Restore must validate the emulator state-format
version, ROM hashes, configuration and media before changing a running machine.
Host timers, audio devices, DOM/canvas objects and pointer lock must be recreated,
not serialized. A failed restore must leave disk saves and prior snapshots intact.

The launcher flow should offer **Continue from last position** or **Start normally**
only for validated snapshots. Starting normally retains in-game disk saves.
Returning to the library should atomically commit a snapshot and its disk image
revision; periodic checkpoints are needed because browsers cannot guarantee an
asynchronous capture will complete during tab closure.

Acceptance requires actual continuation after a fresh page load: compare CPU/RAM
and device state at the capture boundary, then verify subsequent execution,
input, audio and new disk writes. Cover paused games, pending interrupts, active
DMA, disk access, PAL/NTSC and supported machine models. A screenshot, RAM dump
or saved disk image must not be presented as a working save-state feature.
