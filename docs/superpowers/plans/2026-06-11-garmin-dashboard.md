# Garmin Running Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard web estático en GitHub Pages con datos Garmin de Alejandro, actualizado a diario por GitHub Actions.

**Architecture:** Script Python (`garminconnect`) descarga datos incrementalmente y los guarda como JSON commiteados en el repo. Web estática (Chart.js por CDN, sin build) lee los JSON. Workflow cron diario: fetch → commit → deploy Pages. Repo privado `Braveras/running-dashboard`.

**Tech Stack:** Python 3.11+, garminconnect, pytest, Chart.js 4 (CDN), GitHub Actions, GitHub Pages.

**Working directory:** `C:\Users\braveras\Desktop\garmin\running-dashboard` (git repo ya iniciado, spec commiteado).

---

### Task 1: Scaffolding

**Files:**
- Create: `.gitignore`, `requirements.txt`, `README.md`

- [ ] **Step 1: Write `.gitignore`**

```gitignore
__pycache__/
.pytest_cache/
*.pyc
.garmin_tokens*
.env
```

- [ ] **Step 2: Write `requirements.txt`**

```
garminconnect>=0.2.19
pytest>=8.0
```

- [ ] **Step 3: Write `README.md`**

```markdown
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
```

- [ ] **Step 4: Commit**

```powershell
git add .gitignore requirements.txt README.md
git commit -m "chore: scaffolding"
```

---

### Task 2: Lógica derivada con TDD (`scripts/derive.py`)

Funciones puras: pace, EF, hora de acostarse, flag fiesta, merge carrera↔noche. Únicas con tests — el resto del fetch es I/O contra API real.

**Files:**
- Create: `scripts/derive.py`
- Test: `tests/test_derive.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_derive.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from derive import pace_s_per_km, efficiency_factor, bedtime_hour, is_party_night

def test_pace():
    assert pace_s_per_km(3288.08, 1845.47) == 561  # carrera 10-jun: 9:21/km

def test_pace_zero_distance():
    assert pace_s_per_km(0, 100) is None

def test_ef():
    # 3288m/1845s = 1.782 m/s = 106.9 m/min / 140 ppm = 0.764
    assert efficiency_factor(3288.08, 1845.47, 140) == 0.76

def test_ef_no_hr():
    assert efficiency_factor(3000, 1500, None) is None

def test_bedtime_hour():
    # epoch ms 2026-06-11 01:15:30 Madrid -> 1.26 (hora decimal)
    assert bedtime_hour("2026-06-11T01:15:30") == 1.26
    assert bedtime_hour("2026-06-10T23:36:30") == 23.61
    assert bedtime_hour(None) is None

def test_party_night():
    assert is_party_night(sleep_stress=68, score=29) is True
    assert is_party_night(sleep_stress=10, score=49) is False
    assert is_party_night(sleep_stress=45, score=50) is False
    assert is_party_night(None, None) is False
```

- [ ] **Step 2: Run, verify FAIL**

Run: `python -m pytest tests/ -v` (desde la raíz del repo)
Expected: FAIL — `ModuleNotFoundError: No module named 'derive'`

- [ ] **Step 3: Implement `scripts/derive.py`**

```python
"""Funciones puras de métricas derivadas. Sin I/O."""


def pace_s_per_km(distance_m, duration_s):
    if not distance_m or not duration_s:
        return None
    return round(duration_s / (distance_m / 1000))


def efficiency_factor(distance_m, duration_s, avg_hr):
    """Velocidad (m/min) / FC media. Métrica de progreso aeróbico."""
    if not distance_m or not duration_s or not avg_hr:
        return None
    speed_m_min = distance_m / duration_s * 60
    return round(speed_m_min / avg_hr, 2)


def bedtime_hour(sleep_start_local):
    """Hora decimal de acostarse desde ISO local 'YYYY-MM-DDTHH:MM:SS'."""
    if not sleep_start_local:
        return None
    hh, mm = int(sleep_start_local[11:13]), int(sleep_start_local[14:16])
    return round(hh + mm / 60, 2)


def is_party_night(sleep_stress, score):
    """Estrés nocturno alto + score muy bajo = noche de fiesta/alcohol."""
    if sleep_stress is None or score is None:
        return False
    return sleep_stress > 40 and score < 35
```

- [ ] **Step 4: Run, verify PASS**

Run: `python -m pytest tests/ -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```powershell
git add scripts/derive.py tests/test_derive.py
git commit -m "feat: derived metrics with tests"
```

---

### Task 3: `scripts/login.py` (token bootstrap, interactivo local)

**Files:**
- Create: `scripts/login.py`

- [ ] **Step 1: Write `scripts/login.py`**

```python
"""One-time local: login Garmin -> token base64 -> instrucciones para gh secret.
Uso: python scripts/login.py
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

    token_b64 = garmin.garth.dumps()
    with open(TOKEN_FILE, "w") as f:
        f.write(token_b64)

    print(f"\nToken guardado en {os.path.abspath(TOKEN_FILE)} (gitignored).")
    print("Ahora ejecuta:\n")
    print(f'  gh secret set GARMIN_TOKENS --repo Braveras/running-dashboard --body-file "{os.path.abspath(TOKEN_FILE)}"')


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-check sintaxis**

Run: `python -m py_compile scripts/login.py`
Expected: sin salida, exit 0. (Ejecución real la hace el usuario en Task 5.)

- [ ] **Step 3: Commit**

```powershell
git add scripts/login.py
git commit -m "feat: one-time Garmin token bootstrap"
```

---

### Task 4: `scripts/fetch_data.py`

Descarga incremental. Token desde env `GARMIN_TOKENS` (CI) o `.garmin_tokens` (local). Todo endpoint secundario envuelto en try/except — un fallo puntual (clima, peso) no tumba el fetch.

**Files:**
- Create: `scripts/fetch_data.py`

- [ ] **Step 1: Write `scripts/fetch_data.py`**

```python
"""Descarga incremental de Garmin Connect -> data/*.json
Token: env GARMIN_TOKENS (CI) o fichero .garmin_tokens (local).
"""
import json
import os
import sys
from datetime import date, datetime, timedelta

from garminconnect import Garmin

sys.path.insert(0, os.path.dirname(__file__))
from derive import bedtime_hour, efficiency_factor, is_party_night, pace_s_per_km

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data")
FIRST_DATE = "2026-03-01"
HISTORY_REFETCH_DAYS = 7  # dailies: re-fetch últimos N días por si sincronizó tarde


def load_json(name, default):
    path = os.path.join(DATA, name)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(name, obj):
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)


def get_client():
    g = Garmin()
    token = os.environ.get("GARMIN_TOKENS")
    if not token:
        tf = os.path.join(ROOT, ".garmin_tokens")
        if os.path.exists(tf):
            with open(tf) as f:
                token = f.read().strip()
    if not token:
        sys.exit("Sin token: define GARMIN_TOKENS o ejecuta scripts/login.py")
    g.login(token)
    return g


def safe(fn, *args, default=None):
    try:
        return fn(*args)
    except Exception as e:
        print(f"  warn: {fn.__name__}{args} -> {type(e).__name__}: {e}")
        return default


def iso(d):
    return d.strftime("%Y-%m-%d")


def fetch_activities(g):
    today = iso(date.today())
    acts = safe(g.get_activities_by_date, FIRST_DATE, today, default=[]) or []
    all_acts, runs = [], []
    for a in acts:
        start = (a.get("startTimeLocal") or "").replace(" ", "T")
        item = {
            "id": a.get("activityId"),
            "date": start[:10],
            "start": start,
            "type": (a.get("activityType") or {}).get("typeKey", "unknown"),
            "km": round((a.get("distance") or 0) / 1000, 2),
            "dur_s": round(a.get("duration") or 0),
        }
        all_acts.append(item)
        if "running" in item["type"]:
            runs.append({
                **item,
                "hr": a.get("averageHR"),
                "hr_max": a.get("maxHR"),
                "cadence": round(a.get("averageRunningCadenceInStepsPerMinute") or 0) or None,
                "calories": a.get("calories"),
                "pace_s": pace_s_per_km(a.get("distance"), a.get("duration")),
                "ef": efficiency_factor(a.get("distance"), a.get("duration"), a.get("averageHR")),
            })
    all_acts.sort(key=lambda x: x["start"])
    runs.sort(key=lambda x: x["start"])
    return all_acts, runs


def fetch_run_details(g, runs):
    details = load_json("runs_detail.json", {})
    for r in runs:
        rid = str(r["id"])
        if rid in details:
            continue
        print(f"  detalle nueva carrera {rid} ({r['date']})")
        d = {"splits": [], "zones": [], "weather": None}
        splits = safe(g.get_activity_splits, r["id"]) or {}
        for lap in splits.get("lapDTOs", []):
            d["splits"].append({
                "km": round((lap.get("distance") or 0) / 1000, 2),
                "dur_s": round(lap.get("duration") or 0),
                "hr": lap.get("averageHR"),
                "hr_max": lap.get("maxHR"),
                "cadence": round(lap.get("averageRunCadence") or 0) or None,
                "elev_gain": lap.get("elevationGain"),
                "elev_loss": lap.get("elevationLoss"),
                "power": lap.get("averagePower"),
            })
        zones = safe(g.get_activity_hr_in_timezones, r["id"]) or []
        d["zones"] = [{"zone": z.get("zoneNumber"), "secs": round(z.get("secsInZone") or 0),
                       "low": z.get("zoneLowBoundary")} for z in zones]
        w = safe(g.get_activity_weather, r["id"])
        if w and w.get("temp") is not None:
            d["weather"] = {
                "temp_c": round((w["temp"] - 32) * 5 / 9, 1),  # API devuelve °F
                "humidity": w.get("relativeHumidity"),
            }
        details[rid] = d
    return details


def fetch_dailies(g):
    dailies = {d["date"]: d for d in load_json("daily.json", [])}
    if dailies:
        start = datetime.strptime(max(dailies), "%Y-%m-%d").date() - timedelta(days=HISTORY_REFETCH_DAYS)
        start = max(start, datetime.strptime(FIRST_DATE, "%Y-%m-%d").date())
    else:
        start = datetime.strptime(FIRST_DATE, "%Y-%m-%d").date()
    today = date.today()

    # body battery por rango (una llamada)
    bb = {}
    for item in safe(g.get_body_battery, iso(start), iso(today), default=[]) or []:
        bb[item.get("date")] = {"bb_charged": item.get("charged"), "bb_drained": item.get("drained")}

    # peso por rango
    weights = {}
    w = safe(g.get_weigh_ins, iso(start), iso(today), default={}) or {}
    for ws in w.get("dailyWeightSummaries", []):
        lw = ws.get("latestWeight") or {}
        if lw.get("weight"):
            weights[ws.get("summaryDate")] = round(lw["weight"] / 1000, 1)

    d = start
    hrv_baseline = None
    while d <= today:
        ds = iso(d)
        entry = dailies.get(ds, {"date": ds})

        sleep = safe(g.get_sleep_data, ds, default={}) or {}
        dto = sleep.get("dailySleepDTO") or {}
        total = dto.get("sleepTimeSeconds")
        if total:
            scores = dto.get("sleepScores") or {}
            start_local = dto.get("sleepStartTimestampLocal")
            start_iso = (datetime.fromtimestamp(start_local / 1000).isoformat()
                         if start_local else None)
            entry.update({
                "sleep_hours": round(total / 3600, 2),
                "sleep_score": (scores.get("overall") or {}).get("value"),
                "deep_pct": round((dto.get("deepSleepSeconds") or 0) / total * 100, 1),
                "rem_pct": round((dto.get("remSleepSeconds") or 0) / total * 100, 1),
                "sleep_stress": dto.get("avgSleepStress"),
                "bedtime": bedtime_hour(start_iso),
            })
            entry["party"] = is_party_night(entry.get("sleep_stress"), entry.get("sleep_score"))

        hrv = (safe(g.get_hrv_data, ds, default={}) or {}).get("hrvSummary") or {}
        if hrv.get("lastNightAvg"):
            entry["hrv"] = hrv["lastNightAvg"]
            entry["hrv_status"] = hrv.get("status")
            if hrv.get("baseline"):
                hrv_baseline = hrv["baseline"]

        entry.update(bb.get(ds, {}))
        if ds in weights:
            entry["weight_kg"] = weights[ds]
        dailies[ds] = entry
        d += timedelta(days=1)

    return sorted(dailies.values(), key=lambda x: x["date"]), hrv_baseline


def fetch_status(g, hrv_baseline):
    ts = safe(g.get_training_status, iso(date.today()), default={}) or {}
    out = {"date": iso(date.today()), "hrv_baseline": hrv_baseline}
    try:
        vo2 = (ts.get("mostRecentVO2Max") or {}).get("generic") or {}
        out["vo2max"] = vo2.get("vo2MaxPreciseValue") or vo2.get("vo2MaxValue")
    except Exception:
        pass
    try:
        latest = (ts.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData") or {}
        dev = next(iter(latest.values()), {})
        load = dev.get("acuteTrainingLoadDTO") or {}
        out["acute_load"] = load.get("dailyTrainingLoadAcute") or load.get("acuteTrainingLoad")
        out["chronic_load"] = load.get("dailyTrainingLoadChronic") or load.get("chronicTrainingLoad")
        out["optimal_min"] = load.get("minTrainingLoadChronic")
        out["optimal_max"] = load.get("maxTrainingLoadChronic")
        out["status_feedback"] = dev.get("trainingStatusFeedbackPhrase")
    except Exception:
        pass
    return out


def merge_runs_with_dailies(runs, dailies):
    by_date = {d["date"]: d for d in dailies}
    for r in runs:
        night = by_date.get(r["date"], {})  # sueño con fecha X = noche previa al día X
        r["sleep_score_prev"] = night.get("sleep_score")
        r["sleep_hours_prev"] = night.get("sleep_hours")
        r["rem_pct_prev"] = night.get("rem_pct")
        r["bedtime_prev"] = night.get("bedtime")
        r["hrv_morning"] = night.get("hrv")
        r["start_hour"] = bedtime_hour(r["start"])  # hora decimal de salida


def main():
    print("Login...")
    g = get_client()
    print("Actividades...")
    all_acts, runs = fetch_activities(g)
    print(f"  {len(all_acts)} actividades, {len(runs)} carreras")
    details = fetch_run_details(g, runs)
    print("Dailies...")
    dailies, hrv_baseline = fetch_dailies(g)
    print(f"  {len(dailies)} días")
    status = fetch_status(g, hrv_baseline)
    merge_runs_with_dailies(runs, dailies)

    for r in runs:  # temperatura al merge (viene del detalle)
        w = (details.get(str(r["id"])) or {}).get("weather") or {}
        r["temp_c"] = w.get("temp_c")

    save_json("all_activities.json", all_acts)
    save_json("runs.json", runs)
    save_json("runs_detail.json", details)
    save_json("daily.json", dailies)
    save_json("status.json", status)
    save_json("meta.json", {"updated": datetime.now().isoformat(timespec="seconds"),
                            "first_date": FIRST_DATE})
    print("OK")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verificar sintaxis + tests siguen verdes**

Run: `python -m py_compile scripts/fetch_data.py; python -m pytest tests/ -q`
Expected: 7 passed

- [ ] **Step 4: Commit**

```powershell
git add scripts/fetch_data.py
git commit -m "feat: incremental Garmin data fetcher"
```

---

### Task 5: ⚠️ USER ACTION — login real + primera descarga

**Requiere al usuario** (credenciales Garmin). No automatizable.

- [ ] **Step 1: Usuario ejecuta login**

```powershell
cd C:\Users\braveras\Desktop\garmin\running-dashboard
pip install -r requirements.txt
python scripts/login.py
```

- [ ] **Step 2: Primera descarga local**

Run: `python scripts/fetch_data.py`
Expected: crea `data/*.json` — verificar que `runs.json` contiene ~24 carreras y `daily.json` ~100 días.

- [ ] **Step 3: Inspección de datos reales**

Verificar a mano: carrera 2026-06-10 tiene `pace_s` 561, `ef` ≈ 0.76, `sleep_score_prev` 62. Ajustar extracción si algún campo viene null por nombre de clave distinto (especialmente `status.json` y `weather`).

- [ ] **Step 4: Commit datos**

```powershell
git add data/
git commit -m "data: initial backfill"
```

---

### Task 6: Web — HTML + CSS

**Files:**
- Create: `web/index.html`, `web/style.css`

- [ ] **Step 1: Write `web/index.html`**

Estructura completa: header con meta de actualización + selector de rango (botones 7d/30d/90d/todo), panel "estado de hoy", grid de tarjetas resumen, canvas por gráfica (`dist`, `pacehr`, `maxhr`, `monthly`, `ef`, `sleep`, `hrv`, `bb`, `load`, `cadence`, `weight`, `scatter` con dos `<select>` + presets, contenedor `#heatmap` en SVG/divs, tabla `#runsTable`, y `<div id="modal">` oculto para drill-down). Chart.js por CDN. Script `app.js` al final. Idioma español, `lang="es"`.

(El HTML exacto es largo; el ejecutor lo escribe siguiendo la estructura de `C:\Users\braveras\Desktop\garmin\progreso.html` — misma paleta y tipografía, ampliada con los elementos nuevos. Todos los IDs citados aquí son contrato con app.js.)

- [ ] **Step 2: Write `web/style.css`**

Migrar el `<style>` de `progreso.html` (variables CSS, tarjetas, grid) + añadir: `.range-btn.active`, `#modal` (overlay fixed + panel scrollable), `.heatmap-cell` (12px, radius 2, colores por intensidad km: 0=#1c2330, <3km=#1e4d3d, <5km=#2d7a5а→ verde brillante #4dd0a6), `.semaforo.verde/.ambar/.rojo`, tabla compacta.

- [ ] **Step 3: Commit**

```powershell
git add web/index.html web/style.css
git commit -m "feat: dashboard markup and styles"
```

---

### Task 7: Web — `app.js` núcleo (carga, rango, tarjetas, gráficas generales)

**Files:**
- Create: `web/app.js`

- [ ] **Step 1: Write núcleo de `app.js`**

Contenido obligatorio:

```javascript
// Carga de datos
const [runs, dailies, status, allActs, details, meta] = await Promise.all(
  ["runs", "daily", "status", "all_activities", "runs_detail", "meta"]
    .map(n => fetch(`data/${n}.json`).then(r => r.json())));

// Estado global de rango
let rangeDays = null; // null = todo
const inRange = dateStr => !rangeDays ||
  (Date.now() - new Date(dateStr)) / 864e5 <= rangeDays;

// renderAll() destruye y recrea todas las Chart instances con datos filtrados
```

Implementar: tarjetas resumen (km, nº, tiempo, VO2max de status.json, racha = carreras/semana últimas 4 semanas, km mes actual vs anterior), y las gráficas 2-11 del spec. Sueño: barras de score coloreadas por tramo (<50 rojo, <70 ámbar, ≥70 verde) con noches `party:true` con borde distinto + tooltip "🍺 fiesta"; línea de horas y de REM% en ejes secundarios. HRV: línea + banda baseline sombreada (plugin de fondo con `status.hrv_baseline.balancedLow/balancedUpper`). Carga: aguda vs crónica + banda óptima (`optimal_min/max`). Cadencia: puntos + banda objetivo 160-165. Peso: línea solo si hay datos (`dailies.filter(d => d.weight_kg)`); ocultar sección si vacío. Tabla últimas 10 carreras (click → drill-down de Task 8).

Formato pace reutilizable: `const paceFmt = s => Math.floor(s/60) + ":" + String(Math.round(s%60)).padStart(2,"0")`.

- [ ] **Step 2: Verificación manual local**

**Decisión de rutas:** app.js siempre usa `fetch("data/...")`. En Pages el artifact tiene esa estructura (`site/` = web + `site/data/`). En local, replicarla con `scripts/serve_local.py`:

```python
"""Sirve el dashboard en local con la misma estructura que el artifact de Pages."""
import http.server, os, shutil, tempfile

root = os.path.join(os.path.dirname(__file__), "..")
site = os.path.join(tempfile.gettempdir(), "rd_site")
shutil.rmtree(site, ignore_errors=True)
shutil.copytree(os.path.join(root, "web"), site)
shutil.copytree(os.path.join(root, "data"), os.path.join(site, "data"))
os.chdir(site)
print("http://localhost:8000")
http.server.HTTPServer(("", 8000), http.server.SimpleHTTPRequestHandler).serve_forever()
```

Run: `python scripts/serve_local.py` y abrir `http://localhost:8000`
Expected: dashboard carga sin errores de consola, todas las gráficas pintan con datos reales.

- [ ] **Step 3: Commit**

```powershell
git add web/app.js scripts/serve_local.py
git commit -m "feat: dashboard core charts"
```

---

### Task 8: Web — interactivos

**Files:**
- Modify: `web/app.js` (añadir al final)

- [ ] **Step 1: Drill-down por carrera**

Click en punto/barra/fila → modal con: splits (tabla km|pace|FC|cadencia|desnivel), barras de tiempo en zonas FC, clima (`temp_c`, humedad), sueño noche anterior (score, horas, REM, hora acostarse) y HRV matinal. Datos de `details[String(id)]` + campos `*_prev` del run.

- [ ] **Step 2: Explorador de correlaciones**

Dos `<select>` (X/Y) sobre variables de runs.json: `temp_c, start_hour, sleep_hours_prev, sleep_score_prev, rem_pct_prev, bedtime_prev, hrv_morning, hr, pace_s, ef, km`. Scatter + regresión lineal por mínimos cuadrados + R² mostrado. 3 presets botón: "Calor→FC" (temp_c vs hr), "Sueño→Rendimiento" (sleep_score_prev vs ef), "Acostarse→Sueño" (bedtime vs score, usando dailies no runs). Filtrar pares con null.

```javascript
function linreg(pts){ // pts: [{x,y}]
  const n = pts.length, sx = pts.reduce((a,p)=>a+p.x,0), sy = pts.reduce((a,p)=>a+p.y,0);
  const sxy = pts.reduce((a,p)=>a+p.x*p.y,0), sxx = pts.reduce((a,p)=>a+p.x*p.x,0), syy = pts.reduce((a,p)=>a+p.y*p.y,0);
  const b = (n*sxy - sx*sy) / (n*sxx - sx*sx), a = (sy - b*sx)/n;
  const r = (n*sxy - sx*sy) / Math.sqrt((n*sxx - sx*sx)*(n*syy - sy*sy));
  return {a, b, r2: r*r};
}
```

- [ ] **Step 3: Curva EF**

Línea de `ef` por carrera + tendencia (linreg sobre índice) + anotación de party-nights previas excluidas del trend si `ef` null.

- [ ] **Step 4: Heatmap consistencia**

Grid semanas×7 desde `first_date`, celda por día: gris sin actividad, verde escalado por km si running, azul si otro tipo (fuerza). Tooltip nativo `title="2026-06-10 · 3.3 km"`. Click en día con carrera → drill-down.

- [ ] **Step 5: Panel "estado de hoy"**

```javascript
function todayPanel(dailies, runs){
  const today = dailies[dailies.length-1] || {};
  const lastRun = runs[runs.length-1];
  const daysSince = lastRun ? Math.floor((Date.now()-new Date(lastRun.date))/864e5) : 99;
  const reasons = [];
  let level = "verde", msg = "Corre hoy (Z2 suave)";
  const low = (status.hrv_baseline||{}).balancedLow || 45;
  if (today.party) { level="rojo"; reasons.push("noche de fiesta detectada"); }
  if (today.hrv && today.hrv < low) { level="rojo"; reasons.push(`HRV ${today.hrv} bajo baseline (${low})`); }
  if (today.sleep_score != null && today.sleep_score < 40) { level="rojo"; reasons.push(`sueño ${today.sleep_score} POOR`); }
  if (level !== "rojo") {
    if (daysSince === 0) { level="ambar"; msg="Ya corriste hoy — descansa"; }
    else if (today.sleep_score < 55 || (today.hrv && today.hrv < low+7)) { level="ambar"; msg="Suave u opcional: fuerza"; reasons.push("recuperación a medias"); }
  } else msg = "Descansa hoy";
  if (daysSince >= 3 && level === "verde") reasons.push(`${daysSince} días sin correr — toca salir`);
  return {level, msg, reasons, daysSince};
}
```

- [ ] **Step 6: Verificación manual completa**

Servir local, probar: cambiar rango re-filtra todo, click carrera abre modal con splits reales, scatter con preset Calor→FC muestra puntos y R², heatmap pinta marzo-junio, semáforo coherente con datos del día.

- [ ] **Step 7: Commit**

```powershell
git add web/app.js
git commit -m "feat: interactive features"
```

---

### Task 9: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/update.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: Update dashboard
on:
  schedule:
    - cron: "0 8 * * *"   # 10:00 Madrid (verano)
  workflow_dispatch:

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install garminconnect
      - name: Fetch Garmin data
        env:
          GARMIN_TOKENS: ${{ secrets.GARMIN_TOKENS }}
        run: python scripts/fetch_data.py
      - name: Commit data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/
          git diff --cached --quiet || git commit -m "data: daily update $(date -u +%F)"
          git push
      - name: Build site
        run: |
          mkdir -p site
          cp -r web/* site/
          cp -r data site/data
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```powershell
git add .github/workflows/update.yml
git commit -m "ci: daily fetch + pages deploy"
```

---

### Task 10: Repo GitHub + secret + Pages + primer deploy

- [ ] **Step 1: Crear repo privado y push**

```powershell
gh repo create Braveras/running-dashboard --private --source . --push
```

- [ ] **Step 2: Set secret (tras Task 5)**

```powershell
gh secret set GARMIN_TOKENS --repo Braveras/running-dashboard --body-file .garmin_tokens
```

- [ ] **Step 3: Habilitar Pages (build type: workflow)**

```powershell
gh api -X POST repos/Braveras/running-dashboard/pages -f build_type=workflow
```

Expected: 201. **Si 403/422 por plan gratuito** (Pages requiere Pro en repos privados): preguntar al usuario antes de `gh repo edit Braveras/running-dashboard --visibility public` (fallback acordado en spec).

- [ ] **Step 4: Primer run manual**

```powershell
gh workflow run update.yml --repo Braveras/running-dashboard
gh run watch --repo Braveras/running-dashboard
```

Expected: run verde, Pages desplegado.

- [ ] **Step 5: Verificación final**

Abrir `https://braveras.github.io/running-dashboard/` — dashboard completo con datos reales. Verificar consola sin errores y que `meta.updated` es de hoy.

- [ ] **Step 6: Commit final + push**

```powershell
git push
```
