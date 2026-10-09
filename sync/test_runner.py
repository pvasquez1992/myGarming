import json
import unittest
from copy import deepcopy
from cryptography.exceptions import InvalidTag
from runner import activity_dto, decrypt_session, encrypt_session, synchronize

def sample(identifier=100):
    return {"activityId": identifier, "activityName": "Carrera de prueba", "activityType": {"typeKey": "running"},
            "startTimeGMT": "2026-10-09 12:00:00", "startTimeLocal": "2026-10-09 08:00:00",
            "distance": 5000.5, "duration": 1800.2, "averageSpeed": 2.778, "calories": 300,
            "elevationGain": 80, "startLatitude": 0, "startLongitude": 0, "averageHR": None}

class FakeClient:
    def __init__(self, pages): self.pages = pages
    def get_activities(self, offset, limit): return self.pages.get(offset, [])

class FakeAPI:
    def __init__(self): self.rows = {}
    def request(self, method, path, body):
        for activity in body["activities"]: self.rows[activity["id"]] = activity
        return {"processed": len(body["activities"])}

class SyncTests(unittest.TestCase):
    def test_live_units_local_date_and_zero_coordinates(self):
        result = activity_dto(sample(12345678901234567890))
        self.assertEqual(result["id"], "12345678901234567890")
        self.assertEqual(result["distanceMeters"], 5000.5)
        self.assertEqual(result["durationSeconds"], 1800.2)
        self.assertEqual(result["caloriesKcal"], 300)
        self.assertEqual(result["averageSpeedMps"], 2.778)
        self.assertEqual(result["utcOffsetMinutes"], -240)
        self.assertEqual(result["startLatitude"], 0)
        self.assertIsNone(result["averageHeartRateBpm"])
        raw = sample(); raw.update(startTimeGMT="2026-10-10 01:00:00", startTimeLocal="2026-10-09 21:00:00")
        self.assertEqual(activity_dto(raw)["localDate"], "2026-10-09")

    def test_encryption_rejects_tampering_and_wrong_keys(self):
        key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        value = json.dumps({"di_token": "private", "di_refresh_token": "private"})
        encrypted = encrypt_session(value, key)
        self.assertNotIn("private", json.dumps(encrypted))
        self.assertEqual(decrypt_session(encrypted, key), value)
        changed = deepcopy(encrypted); changed["nonce"] = "BBBBBBBBBBBBBBBB"
        with self.assertRaises(InvalidTag): decrypt_session(changed, key)
        with self.assertRaises(InvalidTag): decrypt_session(encrypted, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=")

    def test_pagination_includes_all_history_and_replays_without_duplicates(self):
        client = FakeClient({0: [sample(i) for i in range(1, 101)], 100: [sample(101)]})
        api = FakeAPI()
        self.assertEqual(synchronize(client, api), 101)
        self.assertEqual(synchronize(client, api), 101)
        self.assertEqual(len(api.rows), 101)

    def test_cutoff_is_inclusive_and_bad_data_prevents_batch_import(self):
        client = FakeClient({0: [sample()]}); api = FakeAPI()
        self.assertEqual(synchronize(client, api, "2026-10-09"), 1)
        self.assertEqual(synchronize(client, api, "2026-10-10"), 0)
        invalid = sample(101); invalid["duration"] = -2
        with self.assertRaises(ValueError): synchronize(FakeClient({0: [sample(), invalid]}), FakeAPI())

if __name__ == "__main__": unittest.main()
