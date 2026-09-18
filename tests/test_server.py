import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('server', Path(__file__).resolve().parents[1] / 'serve.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class DiscoveryTests(unittest.TestCase):
    def test_nested_library_and_url_encoding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'games' / 'My Game').mkdir(parents=True)
            (root / 'bios').mkdir()
            (root / 'games' / 'My Game' / 'Game.slave').write_bytes(b'game')
            (root / 'bios' / 'kick31.rom').write_bytes(b'rom')
            files = server.library_files(root)
            self.assertEqual(len(files), 2)
            self.assertEqual(files[0]['path'], 'games/My Game/Game.slave')
            self.assertEqual(files[0]['url'], '/library/games/My%20Game/Game.slave')
            self.assertEqual(files[0]['size'], 4)

    def test_hidden_files_and_symlink_escape_are_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'games').mkdir()
            (root / 'secret').write_text('outside')
            (root / 'games' / 'escape.zip').symlink_to(root / 'secret')
            (root / 'games' / '.hidden.zip').write_bytes(b'hidden')
            self.assertEqual(server.library_files(root), [])

    def test_missing_folders_are_an_empty_library(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(server.library_files(Path(tmp)), [])


if __name__ == '__main__':
    unittest.main()
