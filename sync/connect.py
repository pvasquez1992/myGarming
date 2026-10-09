"""One-time interactive login. Password/MFA never leave this local terminal except to Garmin."""
import getpass
import json
import os
from pathlib import Path

from garminconnect import Garmin
from runner import PersonalAPI, save_session

result_path = Path(__file__).resolve().parent.parent / "data" / "sync-connect-result.json"
result_path.parent.mkdir(parents=True, exist_ok=True)
try:
    print("Conectar Garmin a tu web. Usuario/contrasena se envian solo a Garmin.", flush=True)
    email = input("Correo de Garmin: ").strip()
    password = getpass.getpass("Contrasena de Garmin (no se muestra): ")
    client = Garmin(email, password, prompt_mfa=lambda: getpass.getpass("Codigo MFA de Garmin: "), retry_attempts=1)
    print("Autenticando y comprobando acceso a actividades...", flush=True)
    client.login()
    password = None
    client.email = None
    recent = client.get_activities(0, 1)
    total = client.count_activities()
    api = PersonalAPI(os.environ["GARMIN_API_URL"], os.environ["GARMIN_SYNC_KEY"])
    stored = api.request("GET", "/sync/session")
    save_session(client, api, os.environ["GARMIN_SESSION_KEY"], stored["revision"] if stored else None)
    result_path.write_text(json.dumps({"state": "connected", "activityCount": total,
                                       "latestDate": recent[0]["startTimeLocal"][:10] if recent else None}), encoding="utf-8")
    print(f"Cuenta conectada. Garmin contiene {total} actividades. La sesion se guardo cifrada.", flush=True)
except Exception as error:
    result_path.write_text(json.dumps({"state": "failed", "errorClass": type(error).__name__}), encoding="utf-8")
    print(f"No se pudo completar la conexion ({type(error).__name__}).", flush=True)
finally:
    input("Pulsa Enter para cerrar esta ventana.")
