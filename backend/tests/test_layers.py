import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app
from app.layers import load_layer


class LayerTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_catalog(self):
        result = self.client.get("/api/layers")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(len(result.json()["layers"]), 5)

    def test_validation(self):
        self.assertEqual(self.client.get("/api/layers/customers").status_code, 404)
        for bounds in ["bad", "1,2,3", "nan,0,1,2", "5,0,1,2"]:
            self.assertEqual(self.client.get("/api/layers/damage", params={"bbox": bounds}).status_code, 422)

    def test_bbox_and_limit(self):
        features = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [-80, 37]}, "properties": {}}] * 3
        with patch("app.layers.load_layer", return_value=features):
            body = self.client.get("/api/layers/damage?bbox=-81,36,-79,38&limit=2").json()
            self.assertEqual(len(body["features"]), 2)
            self.assertTrue(body["metadata"]["truncated"])
            self.assertEqual(len(self.client.get("/api/layers/damage?bbox=0,0,1,1").json()["features"]), 0)

    def test_local_damage(self):
        from app.layers import DATA, LAYERS
        if not (DATA / LAYERS["damage"][1]).exists():
            self.skipTest("Local dataset not downloaded")
        features = load_layer("damage")
        self.assertGreater(len(features), 0)
        self.assertIn("reported", features[0]["properties"])
        self.assertNotIn("premise_nu", features[0]["properties"])


if __name__ == "__main__":
    unittest.main()
