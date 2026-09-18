# SWOS career setup and delayed blits

## Reproduction

Use the default A1200 configuration, Kickstart 3.1, 2 MiB Chip RAM,
8 MiB Fast RAM and the generated WHDLoad disk. Leave immediate blits disabled.
In SWOS, choose Career, Choose Team, Europe, Germany, 1. Liga, then Schalke.

With the original core, the supplied 97/98 installation reaches a WHDLoad
illegal-instruction requester at `$200024`. The supplied 96/97 installation
instead remains on a black screen after choosing the team.

With the row-progress fix, both supplied installations reach the chairman's
welcome and Schalke's career fixtures screen. Verified in Chromium with
`immediate=false`, `waiting=1`, `cycle_exact=false`, using the original game
archives and slaves. No game-specific launcher preference is applied.

These observations concern career creation. They do not establish that every
match, season transition or game revision works.

## Trace from 97/98

The supplied slave identifies itself as the 29 August 2001 FINAL version.
The `.saesave` export contains WHDLoad's register, memory and core-dump files.
Live memory captures confirmed the same corruption; this was not a truncated
dump or a disk-persistence failure.

1. The routine at `$183f10` copies 22 words × 68 rows using `BLTCON0=$09f0`.
   The destination is `$127a8` and source `$1e35a` in the traced run.
2. It clears blitter **priority** with `DMACON=$0400` and writes
   `BLTSIZE=$0016`. Blitter DMA remains enabled. The zero height field means
   1024 rows, not zero rows. Pointers have advanced by 2,992 bytes from the
   preceding copy.
3. The CPU loads `data/team.014` into `$127a8` and starts RNC decompression.
   All 13,744 compressed bytes match the archive at decompressor entry.
4. The deferred bulk blit then overwrites that input from offset 2,992 while
   decompression is running. The resulting team table is corrupt.
5. The lookup at `$1c6808` cannot find team `$0e1d`. It runs beyond the table
   into mirrored custom registers. Reads of write-only registers trigger a
   large clearing blit; game code is erased, leading to the later exception.

Immediate blits avoid this sequence, but changing that preference globally
would hide the deferred-copy problem.

## Core change and limits

The approximate blitter now advances ordinary, non-overlapping, contiguous
A-to-D copies one row per scheduled event. Completed rows are not written again
at the end of the job. Busy state, completion interrupt and copper notification
remain tied to the final row. DMA disable pauses progress, and register changes
finish the remaining rows before updating the job's registers.

The new path is restricted to unshifted, ascending copies with zero source and
destination modulos and ranges contained in Chip RAM. Overlapping, shifted,
strided, descending, fill and line operations retain their existing paths;
splitting those needs additional pipeline/shifter handling. This is still an
approximate scheduler, not cycle-exact bus arbitration.

`node --test tests/blitter.test.cjs` covers CPU reuse of completed rows,
completion timing, register changes with display slowdown, DMA pause/resume,
row masks, zero-height encoding, overlapping/strided fallback and immediate mode.
The CPU-reuse regression fails against the original blitter.
