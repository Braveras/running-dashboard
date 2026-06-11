# Running Dashboard

Dashboard de progreso running con datos de Garmin Connect, auto-actualizado a diario.

## Setup (una vez)

1. `pip install -r requirements.txt`
2. `python scripts/login.py` — pide email/contraseña Garmin (+ MFA si aplica), genera token y muestra el comando `gh secret set` a ejecutar.
3. `python scripts/fetch_data.py` — primera descarga local (usa `.garmin_tokens`).
4. Push + el workflow hace el resto a diario a las 08:00 UTC.

## Token caducado (~1 año)

Re-ejecutar `scripts/login.py` y actualizar el secret `GARMIN_TOKENS`.

## Estructura

- `scripts/fetch_data.py` — descarga incremental → `data/*.json`
- `web/` — dashboard estático (Chart.js)
- `data/` — histórico JSON commiteado
