import json
import unittest
from copy import deepcopy
from unittest.mock import patch
from types import SimpleNamespace
from cryptography.exceptions import InvalidTag
from runner import activity_dto, decrypt_session, encrypt_session, synchronize, run, GarminConnectAuthenticationError

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

    def run_with_fault(self, fault):
        key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        events = []
        stored = {"revision": 1, "session": encrypt_session('{"di_token":"test-session"}', key)}
        class SessionAPI:
            def __init__(self, *_): pass
            def request(self, method, path, body=None):
                events.append((method, path, body))
                if path == '/sync/session':
                    if method == 'GET': return deepcopy(stored)
                    self.assert_revision(body)
                    stored.update(revision=stored['revision'] + 1, session=body['session'])
                    return {"revision": stored['revision']}
                if path == '/sync/status': return {} if method == 'GET' else body
                return {"processed": len(body['activities'])}
            def assert_revision(self, body):
                if body['expectedRevision'] != stored['revision']: raise RuntimeError('Stale session')
        class SessionClient:
            def __init__(self, **_):
                self.client = SimpleNamespace(is_authenticated=False, dumps=lambda: '{"di_token":"refreshed"}')
            def login(self, value):
                if fault == 'auth': raise GarminConnectAuthenticationError('Expired session')
                if json.loads(value)['di_token'] != 'test-session': raise ValueError('Incorrect session')
                self.client.is_authenticated = True
            def get_activities(self, offset, limit):
                if fault == 'activities': raise RuntimeError('Temporary service error')
                return [sample()] if offset == 0 else []
        with patch('runner.PersonalAPI', SessionAPI), patch('runner.Garmin', SessionClient), patch.dict('os.environ', {
            'GARMIN_API_URL': 'test-only', 'GARMIN_SYNC_KEY': 'test-only', 'GARMIN_SESSION_KEY': key,
        }), patch('builtins.print'):
            exit_code = run(full=True)
        return exit_code, events, stored

    def test_refresh_is_saved_before_activity_reads_and_after_a_network_failure(self):
        code, events, stored = self.run_with_fault('activities')
        self.assertEqual(code, 1)
        saves = [event for event in events if event[:2] == ('PUT', '/sync/session')]
        self.assertEqual(len(saves), 2)
        self.assertEqual(stored['revision'], 3)
        status = [event for event in events if event[:2] == ('PUT', '/sync/status')][0][2]
        self.assertEqual(status['state'], 'failed')
        code, events, _ = self.run_with_fault(None)
        self.assertEqual(code, 0)
        first_save = next(i for i, event in enumerate(events) if event[:2] == ('PUT', '/sync/session'))
        first_import = next(i for i, event in enumerate(events) if event[:2] == ('POST', '/sync/activities'))
        self.assertLess(first_save, first_import)

    def test_expired_session_requests_reauthentication_without_import_or_overwrite(self):
        code, events, stored = self.run_with_fault('auth')
        self.assertEqual(code, 1)
        self.assertEqual(stored['revision'], 1)
        self.assertFalse(any(path == '/sync/activities' for _, path, _ in events))
        status = [event for event in events if event[:2] == ('PUT', '/sync/status')][0][2]
        self.assertEqual(status['state'], 'reauth_required')

if __name__ == "__main__": unittest.main()
