import unittest

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class WeatherMapValidationTests(unittest.TestCase):
    """These checks fail before any outside weather provider is contacted."""

    def test_replay_needs_valid_dates(self):
        self.assertEqual(client.get("/api/weathermap/grid?mode=observed").status_code, 422)
        self.assertEqual(client.get("/api/weathermap/grid?mode=observed&start=nope&end=2025-02-13").status_code, 422)

    def test_replay_range_is_limited(self):
        self.assertEqual(client.get("/api/weathermap/grid?mode=forecast&start=2025-01-01&end=2025-03-01").status_code, 422)
        self.assertEqual(client.get("/api/weathermap/tropical?start=2025-03-01&end=2025-01-01").status_code, 422)

    def test_unknown_mode_is_rejected(self):
        self.assertEqual(client.get("/api/weathermap/grid?mode=sideways").status_code, 422)

    def test_storm_time_must_be_a_timestamp(self):
        self.assertEqual(client.get("/api/weathermap/storms?time=yesterday").status_code, 422)


if __name__ == "__main__":
    unittest.main()
