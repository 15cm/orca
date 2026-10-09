import importlib.util
import json
import sys
import unittest
from pathlib import Path

path = Path(__file__).with_name('runtime.py')
spec = importlib.util.spec_from_file_location('orca_linux_runtime_test', path)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)

class NiriRuntimeTest(unittest.TestCase):
    def test_parse_windows(self):
        windows = runtime.parse_windows(json.dumps([{"id": 42, "title": "Firefox", "app_id": "firefox", "pid": 9, "workspace_id": 6, "is_focused": True, "geometry": {"pos": {"x": 10, "y": 20}, "size": {"width": 800, "height": 600}}}]))
        self.assertEqual(windows[0].id, 42)
        self.assertEqual(windows[0].bounds, {"x": 10, "y": 20, "width": 800, "height": 600})

    def test_malformed_output(self):
        with self.assertRaisesRegex(RuntimeError, 'malformed Niri output'):
            runtime.parse_windows('{')

    def test_match_pid_and_title(self):
        window = runtime.Window(1, 'Firefox', 'firefox', 99, 6, True, 0, 0, 1, 1)
        self.assertTrue(runtime.match(window, 'pid:99'))
        self.assertTrue(runtime.match(window, 'fire'))

    def test_snapshot_has_no_elements(self):
        window = runtime.Window(1, 'Firefox', 'firefox', 99, 6, True, 0, 0, 1, 1)
        snapshot = runtime.snapshot(window, False)
        self.assertEqual(snapshot['elements'], [])
        self.assertEqual(snapshot['windowId'], 1)

if __name__ == '__main__':
    unittest.main()
