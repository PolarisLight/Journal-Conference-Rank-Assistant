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

    def test_ccf_conference_display_aliases_are_generic(self):
        cvpr = next(item for item in self.records if "CVPR" in item.get("aliases", []))
        normalized_aliases = {" ".join(alias.casefold().replace("/", " ").split()) for alias in cvpr.get("aliases", [])}
        self.assertIn("computer vision and pattern recognition", normalized_aliases)
        self.assertEqual(cvpr["ccf"]["type"], "\u63a8\u8350\u56fd\u9645\u5b66\u672f\u4f1a\u8bae")

        ijcai = next(item for item in self.records if "IJCAI" in item.get("aliases", []))
        self.assertEqual(ijcai["ccf"]["rank"], "B")
        self.assertIn("International Joint Conference on Artificial Intelligence", ijcai.get("aliases", []))

        pattern_recognition = next(item for item in self.records if item["title"].casefold() == "pattern recognition")
        self.assertEqual(pattern_recognition["ccf"]["type"], "\u63a8\u8350\u56fd\u9645\u5b66\u672f\u520a\u7269")



    def test_runtime_catalog_refuses_ambiguous_keys(self):
        shard_a = json.loads((ROOT / "extension/data/catalog-shard-a.private.json").read_text(encoding="utf-8"))
        self.assertIn("aamas", shard_a["x"])
        self.assertIn("acm tran quan comp", shard_a["y"])
        aliases = json.loads((ROOT / "extension/data/catalog-aliases.private.json").read_text(encoding="utf-8"))
        abbreviations = json.loads((ROOT / "extension/data/catalog-abbreviations.private.json").read_text(encoding="utf-8"))
        self.assertNotIn("aamas", aliases)
        self.assertNotIn("cc", aliases)
        self.assertNotIn("acm tran quan comp", abbreviations)
    def test_every_runtime_record_placement_is_reachable(self):
        placements = 0
        aliases = 0
        abbreviations = 0
        unreachable = []
        for shard_path in sorted((ROOT / "extension/data").glob("catalog-shard-*.private.json")):
            shard = json.loads(shard_path.read_text(encoding="utf-8"))
            record_count = len(shard["r"])
            placements += record_count
            aliases += len(shard["a"])
            abbreviations += len(shard["b"])
            self.assertFalse(set(shard["a"]).intersection(shard.get("x", [])), shard_path.name)
            self.assertFalse(set(shard["b"]).intersection(shard.get("y", [])), shard_path.name)
            reachable = set(shard["a"].values()) | set(shard["b"].values())
            self.assertTrue(all(isinstance(index, int) and 0 <= index < record_count for index in reachable))
            for index, record in enumerate(shard["r"]):
                if index not in reachable:
                    unreachable.append((shard_path.name, index, record[0]))
        self.assertEqual(unreachable, [])
        self.assertGreater(placements, 35_000)
        self.assertGreater(aliases, 35_000)
        self.assertGreater(abbreviations, 30_000)

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
