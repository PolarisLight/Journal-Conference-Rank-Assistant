import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("store_stats", Path(__file__).resolve().parents[1] / "scripts/fetch_store_stats.py")
stats = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stats)


class StoreStatsTests(unittest.TestCase):
    def test_chrome_exact_and_rounded_counts(self):
        for label, count, approximate in [("109", 109, False), ("1,234", 1234, False), ("1.2K+", 1200, True), ("0", 0, False)]:
            with self.subTest(label=label):
                html = f'<a href="/{stats.CHROME_ID}">Store</a><div>{label} users</div>'
                result = stats.parse_chrome(html)
                self.assertEqual(result["users"], count)
                self.assertEqual(result["users_display"], label)
                self.assertEqual(result["approximate"], approximate)

    def test_missing_ambiguous_or_script_only_counts_fail(self):
        for body in ["No count", "<div>3 users</div><div>4 users</div>", "<script>109 users</script>"]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                stats.parse_chrome(stats.CHROME_ID + body)

    def test_firefox_zero_is_valid_but_missing_and_wrong_types_fail(self):
        data = {"slug": stats.FIREFOX_SLUG, "average_daily_users": 3, "weekly_downloads": 0}
        self.assertEqual(stats.parse_firefox(data)["weekly_downloads"], 0)
        for value in [None, True, -1, "0"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                stats.parse_firefox({**data, "weekly_downloads": value})
        with self.assertRaises(ValueError):
            stats.parse_firefox({**data, "slug": "another-addon"})

    def test_second_store_failure_preserves_existing_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stats.json"
            original = '{"last_success": true}\n'
            path.write_text(original, encoding="utf-8")
            html = stats.CHROME_ID + "<div>109 users</div>"
            with patch.object(stats, "fetch", side_effect=[html, RuntimeError("Firefox offline")]), patch("sys.argv", ["stats", "--output", str(path)]):
                self.assertEqual(stats.main(), 1)
            self.assertEqual(path.read_text(encoding="utf-8"), original)

    def test_success_writes_a_readable_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stats.json"
            snapshot = {"chrome": {"users": 109}}
            stats.write_snapshot(path, snapshot)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), snapshot)
            self.assertFalse(path.with_suffix(".json.tmp").exists())


if __name__ == "__main__":
    unittest.main()
