import json
import unicodedata
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


    def test_chinese_index_records_are_merged(self):
        metal = next(item for item in self.records if "金属学报" in [item["title"], *item.get("aliases", [])])
        self.assertTrue(metal["pkuCore"])
        self.assertTrue(metal["ei"])

        systems = next(item for item in self.records if "系统工程理论与实践" in [item["title"], *item.get("aliases", [])])
        self.assertTrue(systems["cssci"])
        self.assertTrue(systems["pkuCore"])
        self.assertTrue(systems["ei"])

    def test_xinrui_and_latest_warning_data(self):
        tpami = next(item for item in self.records if item["title"].casefold() == "ieee transactions on pattern analysis and machine intelligence")
        self.assertEqual(tpami["xinrui"]["year"], "2026")
        self.assertEqual(tpami["xinrui"]["zone"], "1")
        self.assertTrue(tpami["xinrui"]["top"])

        acl = next(item for item in self.records if "ACL" in item.get("aliases", []))
        self.assertEqual(acl["xinrui"]["type"], "Conference")
        self.assertEqual(acl["xinrui"]["zone"], "1")

        warnings = [item for item in self.records if item.get("warning")]
        self.assertEqual(len(warnings), 5)
        self.assertEqual({item["warning"]["year"] for item in warnings}, {"2025"})
        computers = next(item for item in warnings if item["title"].casefold() == "computers & electrical engineering")
        self.assertEqual(computers["warning"]["reason"], "\u8bba\u6587\u5de5\u5382")

    def test_no_duplicate_chinese_aliases(self):
        owners = {}
        for index, item in enumerate(self.records):
            for alias in [item.get("title", ""), *item.get("aliases", [])]:
                if not any("CJK UNIFIED IDEOGRAPH" in unicodedata.name(char, "") for char in alias):
                    continue
                key = "".join(char for char in unicodedata.normalize("NFKC", alias).casefold() if char.isalnum())
                owners.setdefault(key, set()).add(index)
        duplicates = {key: indexes for key, indexes in owners.items() if key and len(indexes) > 1}
        self.assertEqual(duplicates, {})


if __name__ == "__main__":
    unittest.main()
