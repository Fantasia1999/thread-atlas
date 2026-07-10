import importlib.util
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("thread_atlas_annotate", REPO_ROOT / "scripts" / "annotate.py")
assert SPEC and SPEC.loader
ANNOTATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ANNOTATE)


class AnnotationGeometryTest(unittest.TestCase):
    def test_fully_offscreen_dynamic_box_uses_scaled_fallback(self):
        original_positions = ANNOTATE.positions
        ANNOTATE.positions = {
            "searchInput": {"x": -224, "y": 187, "w": 142, "h": 28}
        }
        try:
            box, marker = ANNOTATE.get_geometry(
                "searchInput",
                (12, 113, 194, 141),
                720,
                960,
                (103, 127),
            )
        finally:
            ANNOTATE.positions = original_positions

        self.assertEqual(box, (4, 100, 72, 125))
        self.assertEqual(marker, (38, 112))


if __name__ == "__main__":
    unittest.main()
