"""One-time local: login Garmin -> token base64 -> instrucciones para gh secret.
Uso: python scripts/login.py

NOTE (garminconnect 0.3.5): tokens are stored on garmin.client (GarminClient),
not garmin.garth. garmin.client.dumps() serialises di_token / di_refresh_token /
di_client_id to JSON; garmin.client.loads() reverses it.
"""
import getpass
import os

from garminconnect import Garmin

TOKEN_FILE = os.path.join(os.path.dirname(__file__), "..", ".garmin_tokens")


def main():
    email = input("Email Garmin: ").strip()
    password = getpass.getpass("Contraseña Garmin: ")
    garmin = Garmin(email=email, password=password, return_on_mfa=True)
    result1, result2 = garmin.login()
    if result1 == "needs_mfa":
        mfa = input("Código MFA: ").strip()
        garmin.resume_login(result2, mfa)

    # garminconnect 0.3.5: token store lives on garmin.client, not garmin.garth
    token_json = garmin.client.dumps()
    with open(TOKEN_FILE, "w") as f:
        f.write(token_json)

    print(f"\nToken guardado en {os.path.abspath(TOKEN_FILE)} (gitignored).")
    print("Ahora ejecuta:\n")
    print(f'  gh secret set GARMIN_TOKENS --repo Braveras/running-dashboard --body-file "{os.path.abspath(TOKEN_FILE)}"')


if __name__ == "__main__":
    main()
