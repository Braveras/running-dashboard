# Running Dashboard — «Zona Dos»

Parte diario de entrenamiento con datos de Garmin Connect, auto-actualizado a diario.
Página editorial en 6 actos (Hoy → Esta semana → Progreso → Intensidad y técnica →
Recuperación → Archivo), tema oscuro/claro, estático sin build, servido en GitHub Pages.

Dashboard: https://braveras.github.io/running-dashboard/

## Setup (una vez)

1. `pip install -r requirements.txt`
2. `python scripts/login.py` — pide email/contraseña Garmin (+ MFA si aplica), genera token y muestra el comando `gh secret set` a ejecutar.
3. `python scripts/fetch_data.py` — primera descarga local (usa `.garmin_tokens`).
4. Push + el workflow hace el resto a diario a las 08:00 UTC.

## Token Garmin

El CI **rota el token a diario**: cada run genera un `.garmin_tokens` nuevo y sobrescribe
el secret `GARMIN_TOKENS_B64` (paso «Rotate token secret», usa `ACTIONS_PAT`).

**ADVERTENCIA: nunca reutilizar ni refrescar un `.garmin_tokens` local antiguo.**
Reusar un refresh token viejo puede revocar la familia entera de tokens y tumbar el CI
(pasó en julio 2026). Si hace falta acceso local a Garmin, generar una **sesión nueva**
con `python scripts/login.py`.

Si el token caduca o se revoca: re-ejecutar `scripts/login.py` y actualizar el secret
con el comando que imprime.

## Workflow diario (`.github/workflows/update.yml`)

1. **Fetch Garmin data** — descarga incremental con el token del secret; deja el token refrescado en `.garmin_tokens_new`.
2. **Commit data** — commitea `data/` si hay cambios.
3. **Build site + deploy Pages** — copia `web/` + `data/` y publica.
4. **Rotate token secret** — al final, sube el token nuevo a `GARMIN_TOKENS_B64` con `ACTIONS_PAT`.

Si falla:
- **Falla en «Fetch Garmin data»** → token Garmin muerto. Regenerar con `login.py` (ver advertencia arriba).
- **Falla solo «Rotate token secret» con 401** → `ACTIONS_PAT` caducado. Los datos y la web se publican igual (el paso va al final a propósito); renovar el PAT y actualizar el secret `ACTIONS_PAT`.

## Desarrollo local

```
python scripts/serve_local.py   # → http://localhost:8000
```

Monta `web/` + `data/` en un temporal con la misma estructura que Pages.

## Estructura

- `scripts/login.py` — login Garmin interactivo, genera token
- `scripts/fetch_data.py` — descarga incremental → `data/*.json`
- `scripts/derive.py` — métricas derivadas compartidas
- `scripts/serve_local.py` — servidor local de desarrollo
- `web/index.html`, `web/style.css` — página única, 6 actos
- `web/js/` — ES modules nativos: `app.js` (orquestación, tema), `state.js` (carga de datos), `helpers.js`, `insights.js` (frases generadas de los datos), `today.js`, `charts.js`, `sparkline.js`, `scatter.js`, `heatmap.js`, `modal.js`
- `web/vendor/chart.umd.min.js` — Chart.js **fijado a 4.4.9**, vendorizado (sin CDN). Para actualizar: descargar `https://cdn.jsdelivr.net/npm/chart.js@X.Y.Z/dist/chart.umd.min.js`, reemplazar el fichero y probar en local.
- `data/` — histórico JSON commiteado:
  - `runs.json` — una entrada por carrera: km, ritmo, FC, cadencia, EF, temperatura, sueño/HRV de la víspera
  - `runs_detail.json` — detalle por id de actividad: `pct_z2` (% tiempo con FC≤142), `splits`, `zones`, `weather`
  - `all_activities.json` — todas las actividades (cualquier deporte), para el heatmap
  - `daily.json` — serie diaria: sueño (score, horas, fases, hora), HRV, peso y Body Battery (`bb_high`/`bb_low`/`bb_last` + `bb_charged`/`bb_drained`)
  - `status.json` — snapshot del día: cargas aguda/crónica, VO2max, HRV baseline, feedback
  - `status_history.json` — histórico diario de `acute_load`/`chronic_load`/`vo2max` (se acumula en cada fetch)
  - `meta.json` — `first_date`, `updated`

## Diseño

Spec del rediseño (paleta validada, tipografía, actos, contratos de cada gráfica):
`docs/superpowers/specs/2026-07-23-zona-dos-redesign-design.md`
