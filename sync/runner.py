"""Read Garmin activities and send them to the personal API. Never logs account data."""
import argparse
import base64
import json
import logging
import math
import os
import secrets
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from garminconnect import Garmin, GarminConnectAuthenticationError

AAD = b"booktrip-garmin-session-v1"
logging.disable(logging.CRITICAL)


def encrypt_session(value, key):
    nonce = secrets.token_bytes(12)
    cipher = AESGCM(base64.b64decode(key, validate=True))
    return {"format": 1, "nonce": base64.b64encode(nonce).decode(),
            "ciphertext": base64.b64encode(cipher.encrypt(nonce, value.encode(), AAD)).decode()}


def decrypt_session(value, key):
    if value.get("format") != 1:
        raise ValueError("Unsupported session format")
    return AESGCM(base64.b64decode(key, validate=True)).decrypt(
        base64.b64decode(value["nonce"], validate=True),
        base64.b64decode(value["ciphertext"], validate=True), AAD).decode()


class PersonalAPI:
    def __init__(self, base_url, key):
        if base_url != "https://my-garmin-api.pvasquez1992.workers.dev":
            raise ValueError("Unexpected API origin")
        self.base = base_url
        self.http = requests.Session()
        self.http.trust_env = False
        self.http.headers.update({"Authorization": f"Bearer {key}", "Accept": "application/json"})

    def request(self, method, path, body=None):
        if path not in {"/sync/session", "/sync/status", "/sync/activities"}:
            raise ValueError("Unexpected API path")
        response = self.http.request(method, self.base + path, json=body, timeout=45, allow_redirects=False)
        if not response.ok or response.is_redirect:
            raise RuntimeError(f"Personal API returned HTTP {response.status_code}")
        return response.json()["data"]


def numeric(value, required=False):
    if value is None and not required:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError("Invalid Garmin numeric value")
    return round(value, 3)


def activity_dto(raw):
    identifier = str(raw.get("activityId", ""))
    if not identifier.isascii() or not identifier.isdigit() or identifier.startswith("0") or len(identifier) > 20:
        raise ValueError("Invalid Garmin activity ID")
    start = datetime.fromisoformat(raw["startTimeGMT"].replace(" ", "T").replace("Z", "+00:00"))
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    start = start.astimezone(timezone.utc)
    local = datetime.fromisoformat(raw["startTimeLocal"].replace(" ", "T"))
    offset = (local.replace(tzinfo=None) - start.replace(tzinfo=None)).total_seconds() / 60
    if not offset.is_integer() or abs(offset) > 840:
        raise ValueError("Invalid Garmin local offset")
    result = {
        "id": identifier, "name": raw["activityName"], "sport": raw["activityType"]["typeKey"],
        "startedAt": start.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "localDate": local.date().isoformat(), "utcOffsetMinutes": int(offset),
        # Live Connect JSON is already metres, seconds, m/s and kcal.
        # Export ZIP JSON uses different units and is handled by the C# importer.
        "distanceMeters": numeric(raw.get("distance"), True),
        "durationSeconds": numeric(raw.get("duration"), True),
    }
    optional = {
        "elapsedSeconds": "elapsedDuration", "movingSeconds": "movingDuration",
        "averageSpeedMps": "averageSpeed", "maxSpeedMps": "maxSpeed",
        "elevationGainMeters": "elevationGain", "elevationLossMeters": "elevationLoss",
        "caloriesKcal": "calories", "averageHeartRateBpm": "averageHR", "maxHeartRateBpm": "maxHR",
        "averagePowerWatts": "avgPower", "maxPowerWatts": "maxPower", "steps": "steps",
        "aerobicTrainingEffect": "aerobicTrainingEffect", "anaerobicTrainingEffect": "anaerobicTrainingEffect",
        "trainingLoad": "activityTrainingLoad", "vo2Max": "vO2MaxValue", "lapCount": "lapCount",
    }
    for target, source in optional.items():
        value = raw.get(source)
        # Negative sentinel values from Garmin are unavailable measurements.
        result[target] = None if isinstance(value, (int, float)) and value < 0 else numeric(value)
    for key in ["startLatitude", "startLongitude", "endLatitude", "endLongitude"]:
        value = raw.get(key)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                                  or abs(value) > (90 if "Latitude" in key else 180)):
            raise ValueError("Invalid Garmin coordinate")
        result[key] = round(value, 7) if value is not None else None
    return result


def synchronize(client, api, cutoff=None):
    offset, processed = 0, 0
    seen = set()
    while True:
        raw = client.get_activities(offset, 100)
        if not isinstance(raw, list):
            raise ValueError("Unexpected Garmin activity response")
        if not raw:
            break
        rows = [activity_dto(item) for item in raw]
        fresh = [item for item in rows if item["id"] not in seen]
        if not fresh:
            raise ValueError("Garmin pagination stopped advancing")
        seen.update(item["id"] for item in fresh)
        selected = [item for item in fresh if cutoff is None or item["localDate"] >= cutoff]
        if selected:
            receipt = api.request("POST", "/sync/activities", {"activities": selected})
            if receipt.get("processed") != len(selected):
                raise ValueError("Import receipt mismatch")
            processed += len(selected)
        if len(raw) < 100 or (cutoff is not None and all(item["localDate"] < cutoff for item in rows)):
            break
        offset += len(raw)
        if offset > 100000:
            raise ValueError("Garmin pagination exceeds supported size")
    return processed


def save_session(client, api, cipher_key, revision):
    return api.request("PUT", "/sync/session", {
        "session": encrypt_session(client.client.dumps(), cipher_key), "expectedRevision": revision,
    })["revision"]


def run(full=False):
    api = PersonalAPI(os.environ["GARMIN_API_URL"], os.environ["GARMIN_SYNC_KEY"])
    cipher_key = os.environ["GARMIN_SESSION_KEY"]
    stored = api.request("GET", "/sync/session")
    if not stored:
        print("La sesion de Garmin todavia no esta conectada. Ejecuta scripts/connect-garmin.ps1.")
        return 2
    client = Garmin(prompt_mfa=lambda: (_ for _ in ()).throw(GarminConnectAuthenticationError("Interactive login required")), retry_attempts=1)
    revision = stored["revision"]
    state, processed, session_saved = "failed", 0, False
    try:
        client.login(decrypt_session(stored["session"], cipher_key))
        # Persist any refresh immediately, before an activity request can fail.
        revision = save_session(client, api, cipher_key, revision)
        status = api.request("GET", "/sync/status")
        last = status.get("lastSuccessAt")
        now = datetime.now(timezone.utc)
        previous = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else None
        # First run, daily reconciliation and gaps over 7 days traverse the whole history.
        reconcile = full or previous is None or now.hour == 3 or previous < now - timedelta(days=7)
        cutoff = None if reconcile else (previous - timedelta(days=7)).date().isoformat()
        processed = synchronize(client, api, cutoff)
        save_session(client, api, cipher_key, revision)
        session_saved = True
        state = "ok"
    except GarminConnectAuthenticationError:
        state = "reauth_required"
    except Exception as error:
        # Only the exception class is public; Garmin errors may contain account details.
        print(f"Sincronizacion incompleta ({type(error).__name__}). Se reintentara en la siguiente ejecucion.")
    finally:
        if not session_saved and client.client.is_authenticated:
            try:
                save_session(client, api, cipher_key, revision)
            except Exception:
                state = "failed" if state == "ok" else state
                print("No se pudo guardar la renovacion de sesion.")
        api.request("PUT", "/sync/status", {"state": state, "processed": processed})
    print(f"Estado: {state}. Actividades procesadas: {processed}.")
    if state == "reauth_required":
        print("Garmin requiere autenticar de nuevo. Ejecuta scripts/connect-garmin.ps1 en tu equipo.")
    return 0 if state == "ok" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true")
    args = parser.parse_args()
    try:
        sys.exit(run(args.full))
    except Exception as error:
        print(f"No se pudo ejecutar la sincronizacion ({type(error).__name__}).")
        sys.exit(1)
