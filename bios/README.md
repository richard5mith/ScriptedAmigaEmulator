# System files

Put your Kickstart ROMs and WHDLoad support files here. Run `python3 serve.py`
from the repository root, then open `http://localhost:8000`. The launcher
scans this folder and its subfolders automatically. Refresh the library
after adding files. Files and folders whose names start with a dot are skipped.

The app looks for:

- **Kickstart ROMs:** `.rom` or `.bin` files, or WHDLoad-style names such as
  `kick34005.A500`, `kick40063.A600`, `kick40068.A1200`, and `kick40068.A4000`.
  ROM candidates must be between 256 KiB and 2 MiB. Recognized ROM contents
  help the launcher match the selected Amiga model; a filename alone does
  not establish compatibility.
- **WHDLoad runtime:** an Amiga executable named `WHDLoad`, either extracted
  or inside an archive such as `WHDLoad_usr.lha`. This is needed to launch
  installed WHDLoad games.
- **WHDLoad Kickstart support:** `.rtb` relocation files, where required by
  a game's kickemu support. Keep their original matching filenames. Known
  Kickstart ROMs are also supplied to WHDLoad under their support names.
- **ROM decryption key:** a file named `rom.key`, if your ROMs require one.
- **System archives:** `.zip`, `.lha`, or `.lzh` archives containing the files
  above. The launcher scans their file entries; archives inside archives are
  not recursively unpacked.

Example layout:

```text
bios/
  README.md
  kick13.rom
  kick31.rom
  WHDLoad_usr.lha
  kick34005.A500.RTB
  rom.key
```

Only include the files you need: `rom.key` and RTB files are not required
for every setup. Kickstart 1.3 is a common A500 choice; the launcher's default
A1200 setup normally uses Kickstart 3.1. Settings let you choose the model,
ROM, and WHDLoad runtime. Games belong in [games/](../games/README.md).

ROMs and WHDLoad binaries are not bundled. Supply your own files; see the
root [README](../README.md) for setup and compatibility details. Only this
README is tracked by Git. All other content in this folder, including
subfolders, is ignored. The app does not treat this README as a system file
to load into the emulator.
