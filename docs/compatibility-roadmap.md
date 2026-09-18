# Compatibility work remaining

The upstream [limitations](https://scriptedamigaemulator.net/readme.htm) describe
several independent subsystems. Archive loading alone cannot fix these.

| Area | Current status / next verifiable milestone |
| --- | --- |
| ZIP, ADZ, HDZ | Implemented in frontend file preparation, with corruption checks and explicit limits. |
| LHA/LZH | Implemented for header levels 0–3 and lh0/lh4–lh7/lz4. Add legacy adaptive Huffman methods only with independent archive fixtures. |
| WHDLoad | Bootable FFS generation and an A1200 launcher. Qwak ZIP and Turrican LHA boot verified; expand the game regression set, import icon tooltypes, add configurable slave options. Persistent disk saves and backup export/import are implemented. |
| Exact-position snapshots | Implemented: explicit quit/save choice and fresh-page restore of CPU, memory, device, scheduler and matching disk state. Default A1200 Qwak, Turrican and both SWOS career reloads verified; expand the hardware/game matrix. See [save-states.md](save-states.md). |
| Blitter timing | Plain, disjoint A-to-D copies now advance by rows instead of writing the whole job at completion, fixing a SWOS career setup buffer race. Other modes still use the existing approximation; full bus arbitration remains future work. See [trace and regression coverage](swos-blitter.md). |
| 68000/68010 prefetch | Replace the fake prefetch model with tested instruction-fetch behavior; include self-modifying-code cases. |
| BKPT, CALLM, RTM | Instruction handlers exist as incomplete stubs in sae/cpu.js. Implement from processor manuals with register, exception, and bus-behavior tests. Do not silently treat a stub as a working instruction. |
| Exceptions 2/3, traps, timing | Build targeted CPU fault/exception tests, then implement model-specific frames and timing. This is a likely source of individual game incompatibilities. |
| 68030 MMU | Requires address translation, page walks, access checking and fault semantics. WHDLoad's NoMMU mode avoids requiring this for the launcher. |
| Zorro2 autoconfig | RAM devices currently work; additional device support requires an actual device implementation, not merely advertising it. |
| FDI/IPF | Need image decoders and protected-track integration; verify against known disk images and flux/track behavior. |
| A3000/A4000 onboard SCSI | Implement the relevant controller, DMA and storage protocol; verify booting an appropriate ROM and hardfile. Existing A1200 IDE is used by WHDLoad. |
| Browser keyboard limitations | Meta/Amiga mappings already exist in sae/input.js, but OS/browser interception remains. Add alternate configurable bindings or an on-screen keyboard, with Windows AltGr and German-layout tests. |

A meaningful claim of improved game compatibility needs a repeatable game or
CPU test demonstrating each fix. Avoid speculative changes to the emulation core
while establishing the archive and WHDLoad regression suite.
