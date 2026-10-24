import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health(self):
        self.assertEqual(self.client.get("/api/health").json()["mode"], "demo")

    def test_assessment(self):
        result = self.client.get("/api/assessments/DEMO-001")
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()["demo"])
        self.assertEqual(self.client.get("/api/assessments/unknown").status_code, 404)

    def test_subscription(self):
        payload = {"premise": "DEMO-001", "email": "demo@example.com", "consent": True}
        with TemporaryDirectory() as directory, patch("app.main.DATABASE", Path(directory) / "test.sqlite3"):
            self.assertEqual(self.client.post("/api/subscriptions", json=payload).status_code, 201)
            self.assertEqual(self.client.post("/api/subscriptions", json=payload).status_code, 201)
            payload["consent"] = False
            self.assertEqual(self.client.post("/api/subscriptions", json=payload).status_code, 400)
            payload["email"] = "invalid"
            self.assertEqual(self.client.post("/api/subscriptions", json=payload).status_code, 422)

    def test_location_subscription(self):
        payload = {"location": "24016", "email": "test@example.com", "consent": True}
        with TemporaryDirectory() as directory, patch("app.main.DATABASE", Path(directory) / "test.sqlite3"):
            self.assertEqual(self.client.post("/api/location-subscriptions", json=payload).status_code, 201)
            self.assertEqual(self.client.post("/api/location-subscriptions", json=payload).status_code, 201)
            payload["consent"] = False
            self.assertEqual(self.client.post("/api/location-subscriptions", json=payload).status_code, 400)


if __name__ == "__main__":
    unittest.main()
