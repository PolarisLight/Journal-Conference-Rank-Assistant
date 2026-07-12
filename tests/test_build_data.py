import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records = json.loads((ROOT / "build/journals.private.json").read_text(encoding="utf-8"))

    def test_dataset_has_expected_scale(self):
        self.assertGreater(len(self.records), 20_000)

    def test_nature_has_jcr_and_cas(self):
        nature = next(item for item in self.records if item["title"].casefold() == "nature")
        self.assertEqual(nature["jcr"]["quartile"], "Q1")
        self.assertTrue(nature["jcr"]["impactFactor"])
        self.assertTrue(nature["cas"]["largeZone"])
        self.assertEqual(nature["wos"], "SCIE")

    def test_jacm_has_ccf_rank(self):
        jacm = next(item for item in self.records if "JACM" in item.get("aliases", []))
        self.assertEqual(jacm["ccf"]["rank"], "A")


if __name__ == "__main__":
    unittest.main()
