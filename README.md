# Scripted Amiga Emulator

Amiga emulation in JavaScript and HTML5. Original project: https://scriptedamigaemulator.net/

## Launching games

Run `python3 serve.py`, then open `http://localhost:8000`.
Put your games in `games/` and system files in `bios/` beside the launcher:

```text
games/
  Qwak.zip
  Turrican.lha
bios/
  kick31.rom
  WHDLoad_usr.lha
```

The launcher discovers these folders, lists games, selects a Kickstart ROM and
WHDLoad runtime, and boots an A1200 with 2 MiB Chip RAM and 8 MiB Fast RAM.
Click **Play**. ZIP, LHA, disk images and extracted WHDLoad installations use the
same library. `whdload.htm` redirects to this launcher.

Use `python3 serve.py --library /path/to/collection` for folders elsewhere.
A plain static server with directory listings also supports automatic discovery.
Alternatively, use **Add games** to select files or a folder, or drop them onto
the page. Browsers cannot scan arbitrary local folders without that initial
selection. Where supported, folder permission is remembered for reconnection.
Files are processed locally; they are not uploaded.

**Settings** sets defaults; the settings button on a game overrides them for that
game. Display, controls, system files and advanced hardware are collapsed until
needed. Click the game display to capture the mouse; Escape releases it without
stopping the game. Disable capture under Controls if preferred. The expand button
fills the browser page; click it again to restore the player size.
For CRT scanlines, phosphor texture and softened colour, choose **Display & sound →
Picture → CRT (S-Video)**. This optional WebGL display filter works with both
emulator renderers and falls back to the normal picture if unavailable.
Audio uses AudioWorklet on supported browsers (localhost or HTTPS), with legacy
ScriptProcessor output as a fallback.
Multi-disk games have a disk selector while playing. Favorites, recent
plays and preferences are saved in the browser.

Supported media: ZIP/LHA/LZH containing floppy or hardfile images, ADZ/HDZ and
`.adf.gz`/`.hdf.gz`, plus uncompressed ADF, DMS, SCP, IMG, EXE, HDF and VHD.
Decompression does not add support for unsupported formats such as IPF or FDI.

## WHDLoad games

An installed game must contain its `.Slave` file and game data. Put the official
`WHDLoad_usr.lha` archive or extracted `WHDLoad` executable in `bios/`, along with
your Kickstart ROMs. The launcher detects them automatically. Choose a particular
slave under the game's settings if a package has several versions.

You can download that from https://www.whdload.de/index.html. 

The launcher builds an FFS hardfile with the game, runtime and startup script,
using `PRELOAD NoMMU NoWriteCache`, plus an explicit filesystem flush after disk I/O. No Workbench HDF is required for the tested games. Known
ROMs are also copied under their WHDLoad support names in `Devs/Kickstarts/`.
Games using kickemu may need matching RTB files in `bios/` or a support archive
there. ROMs, games and WHDLoad binaries are not bundled.

Installers requiring original disks are not preinstalled games. Icon tooltypes
and custom options are not automatically imported. Existing emulator compatibility
limits still apply.

## Game saves

Use the game's own Save/Load menu. Writable disk changes are stored automatically
in IndexedDB and restored on the next launch, including after a page reload.
WHDLoad runs with `NoWriteCache` so saves reach the disk during play instead of
waiting for WHDLoad to exit. `C/FlushSaves` sends the filesystem an `ACTION_FLUSH`
packet after disk access, allowing `WriteDelay=0` without leaving dirty filesystem
buffers behind. It falls back to the original safety delay if flushing fails.
Source: [native/FlushSaves.s](native/FlushSaves.s). Let the game's save operation
finish before leaving.
The launcher shows when disk changes have been stored and waits for pending
storage writes when returning to the library.

In a game's settings, **Saved games** offers **Export backup** and **Import backup**
using `.saesave` files. **Delete stored data** removes that game's browser-stored
disks and saved position, including saved progress and crash dumps, after confirmation. The next
launch uses fresh disks from the original game files. Exported backups and other
games are kept. Close the game in other launcher tabs before deleting its data.
Backups contain modified disk images. Browser storage is
specific to the browser profile and site address; clearing site data removes
saves. Export backups before clearing data, switching browsers or changing the
server address. Source archives and files in games/ are never modified.

Saves are matched to the game, disk member and original media SHA-256. A different
archive/build or regenerated WHDLoad disk with different BIOS/runtime contents
will not silently reuse an incompatible save image. Read-only media can restore
existing saves but cannot write new changes. A quota/storage error is shown with
Retry and Export backup actions; pending changes stay in memory for recovery.
Concurrent tabs cannot play the same game when Web Locks is available; IndexedDB
revision checks also prevent a stale writer from overwriting newer saves.

**Back to library** now offers **Yes, and save state**, **Yes and don't save state**,
or **No, continue playing**. A save state captures the whole running machine and
its matching disks. Next time, choose **Continue playing** to resume that position
or **Start normally** to boot with your usual disk saves. Quitting without saving a
new state retains any older checkpoint.

Game settings also offer **Delete saved position**, which keeps ordinary disk
saves. Checkpoints are local to this browser and are not included in `.saesave`
disk backups. They require matching settings, ROM and game media. If only the emulator build
has changed, **Try restoring** attempts the old checkpoint with a warning. Invalid
or incompatible state data is caught during restoration. There is no automatic checkpoint when
closing the tab. See [save-state details and tests](docs/save-states.md).

## Archive limits

- ZIP: stored and Deflate members; encrypted, split, and ZIP64 archives are rejected.
- LHA: header levels 0–3; `lh0`, `lh4`, `lh5`, `lh6`, `lh7`, and stored `lz4`.
  Other compression methods are reported as unsupported.
- ZIP/gzip decoding requires browser `DecompressionStream` support, including
  `deflate-raw` for ZIP. LHA decoding is JavaScript and needs no external service.
- Up to 10,000 archive entries, 256 MiB per expanded file, 512 MiB total declared
  expanded data and input size. WHDLoad imports have a tighter 40 MiB game/support
  limit and generate hardfiles up to 48 MiB, with 30-byte Latin-1 Amiga names.
  Long WHDLoad slave filenames receive short aliases inside the generated image;
  game data filenames and original archives are preserved.
- Unsafe paths, symbolic links, conflicting Amiga paths, and corrupt data fail
  explicitly. A failed load leaves the previously selected media in place.

## Embedding

The emulator's file API remains synchronous. Load `sae/lha.js` and
`sae/archive.js` alongside SAE, then prepare compressed files **before** setting
configuration or calling `start()`/`insert()`:

```js
const archive = await SAEF_Archive.open(file.name, await file.arrayBuffer());
const entry = archive.entries.find(e => /\.adf$/i.test(e.name));
if (!entry) throw new Error('Choose an ADF entry');
const data = await entry.read();
Object.assign(config.floppy.drive[0].file, {
  name: entry.name, data, size: data.length, crc32: false
});
```

The optional `sae/ffs.js` and `sae/whdload.js` modules provide
`SAEF_WHDLoad.runtime(archive)` and
`SAEF_WHDLoad.prepare(gameArchive, slavePath, runtimeBytes, supportArchive)`.
The latter returns an FFS partition as a `Uint8Array`; see `launcher/system.js` for the
IDE geometry and boot configuration. These asynchronous preparation modules are
loaded separately from the original compiled emulator bundle.

## Verification and remaining work

Run `node --test tests/*.test.cjs` with Node 22 or later, and
`python3 -m unittest discover -s tests -p 'test_*.py'` for folder discovery. Tests cover ZIP/gzip/LHA
round trips, header variants, integrity failures, media selection, FFS directory
hashing, file extensions, allocation bitmaps, and WHDLoad startup generation.
Launcher tests cover ROM matching and library grouping.
The optional real-game tests run when `games/Qwak.zip` and `games/Turrican.lha` exist locally;
they are not bundled test fixtures.

See [docs/compatibility-roadmap.md](docs/compatibility-roadmap.md) for the other
README limitations. This change addresses compressed media and WHDLoad loading;
it does not claim to implement the missing CPU instructions, MMU, SCSI, or
protected-disk formats.

The optional browser integration test is `node tests/saves.browser.cjs`. It needs
Playwright, Python, and local Qwak/BIOS files. Set `PLAYWRIGHT_MODULE` and
`CHROMIUM_EXECUTABLE` when they are installed outside this project. It verifies
real disk writes, page reload restoration, backup download, deletion and cancellation,
running-game protection, fresh launch after deletion, and stale-write rejection.
