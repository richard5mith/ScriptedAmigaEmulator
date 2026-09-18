# Game files

Put your Amiga games here. Run `python3 serve.py` from the repository root,
then open `http://localhost:8000`. The launcher scans this folder and its
subfolders automatically. Refresh the library after adding files. Files and
folders whose names start with a dot are skipped.

Supported content:

- Floppy/game images: `.adf`, `.adz`, `.dms`, `.scp`, `.img`, and `.exe`.
- Hard disk images: `.hdf`, `.hdz`, and `.vhd`.
- Gzip-compressed images, including `.adf.gz` and `.hdf.gz`.
- `.zip`, `.lha`, and `.lzh` archives containing supported images or an
  installed WHDLoad game.
- Extracted WHDLoad installations: put each game in its own subfolder with
  its `.Slave` file and all game data. Installers requiring original disks
  are not ready-to-play installations.

For multi-disk games, names such as `Game Disk 1.adf` and `Game Disk 2.adf`
are grouped into one library entry. Archives containing multiple disks or
WHDLoad slaves let you select the disk or game variant in the launcher.

Example layout:

```text
games/
  README.md
  Qwak.zip
  Turrican.lha
  Another Game/
    AnotherGame.Slave
    data/
  Disk Game Disk 1.adf
  Disk Game Disk 2.adf
```

Kickstart ROMs and the WHDLoad runtime belong in [bios/](../bios/README.md).
IPF and FDI images are not supported. Archive support does not guarantee that
every game works with the emulator; see the root [README](../README.md) for
archive limits and compatibility details.

Only this README is tracked by Git. All other content in this folder,
including subfolders, is ignored. The launcher does not use this README as
game media. Game saves and checkpoints are stored in the browser; source game
files here are not modified.
