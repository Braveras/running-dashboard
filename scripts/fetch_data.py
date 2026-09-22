"""Descarga incremental de Garmin Connect -> data/*.json
Token: env GARMIN_TOKENS (CI) o fichero .garmin_tokens (local).
"""
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from garminconnect import Garmin

sys.path.insert(0, os.path.dirname(__file__))
from derive import bedtime_hour, efficiency_factor, is_party_night, pace_s_per_km

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data")
FIRST_DATE = "2026-03-01"
HISTORY_REFETCH_DAYS = 7  # dailies: re-fetch últimos N días por si sincronizó tarde
MADRID = ZoneInfo("Europe/Madrid")
Z2_MAX_HR = 142  # techo Z2 personal: % de tiempo real por debajo (fase 3)
BB_BACKFILL_MAX = 200  # límite de get_stats() por run al rellenar histórico BB
HEALTH_REFETCH_DAYS = 2  # salud: estos datos cierran en el día; ventana corta (§3.2)
HEALTH_BACKFILL_MAX = 30  # días de health.json a rellenar por run (~4 llamadas/día, §3.6)


def today_madrid():
    return datetime.now(MADRID).date()


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
    token = os.environ.get("GARMIN_TOKENS")
    if not token:
        tf = os.path.join(ROOT, ".garmin_tokens")
        if os.path.exists(tf):
            with open(tf, encoding="utf-8") as f:
                token = f.read().strip()
    if not token:
        sys.exit("Sin token: define GARMIN_TOKENS o ejecuta scripts/login.py")

    # En CI evitamos /userprofile-service (login() lo llama para validar y NO
    # aporta nada que no tengamos): client.loads() restaura la sesión e inyectamos
    # display_name/unit_system cacheados (display_name = UUID, no es sensible).
    # El di_token (acceso) caduca en ~horas; entre runs diarios estará caducado,
    # así que lo refrescamos con el di_refresh_token (vida ~1 año si solo CI lo usa)
    # y al final del run se re-guarda el token rotado en el secret (ver dump_token).
    display_name = os.environ.get("GARMIN_DISPLAY_NAME")
    g = Garmin()
    last_err = None
    for intento in range(3):
        try:
            if display_name:
                g.client.loads(token)
                g.display_name = display_name
                g.unit_system = os.environ.get("GARMIN_UNIT_SYSTEM", "metric")
                if g.client._token_expires_soon():
                    print("  di_token caduca pronto -> refrescando")
                    g.client._refresh_di_token()
            else:
                g.login(tokenstore=token)  # local: carga perfil normalmente
            return g
        except Exception as e:
            last_err = e
            print(f"  login intento {intento + 1}/3 falló: {type(e).__name__}: {e}")
    sys.exit(f"Login Garmin falló tras 3 intentos: {type(last_err).__name__}: {last_err}")


def dump_token(g):
    """Vuelca el token actual (posiblemente rotado tras refresh) al path de
    TOKEN_OUT, para que el workflow lo re-guarde en el secret y la cadena
    sobreviva entre runs diarios. Sin TOKEN_OUT (local), no hace nada."""
    out = os.environ.get("TOKEN_OUT")
    if not out:
        return
    try:
        with open(out, "w", encoding="utf-8") as f:
            f.write(g.client.dumps())
        print(f"  token volcado a {out}")
    except Exception as e:
        print(f"  warn: dump_token falló: {type(e).__name__}: {e}")


def safe(fn, *args, default=None):
    try:
        return fn(*args)
    except Exception as e:
        print(f"  warn: {fn.__name__}({', '.join(repr(a)[:40] for a in args)}) -> {type(e).__name__}: {e}")
        return default


def iso(d):
    return d.strftime("%Y-%m-%d")


def fetch_activities(g):
    existing_all = load_json("all_activities.json", [])
    existing_runs = load_json("runs.json", [])
    today = iso(today_madrid())
    acts = safe(g.get_activities_by_date, FIRST_DATE, today, default=[]) or []
    if len(acts) < len(existing_all):
        print(f"  WARN: API devolvió {len(acts)} actividades, en disco hay {len(existing_all)} — conservo datos existentes")
        return existing_all, existing_runs
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


def pct_time_below_z2(g, activity_id):
    """% de tiempo real con FC <= Z2_MAX_HR, de las muestras de FC del detalle.
    Pondera por el intervalo entre muestras consecutivas (directTimestamp, ms).
    Devuelve (pct, n_muestras) o (None, 0) si no hay serie de FC."""
    d = safe(g.get_activity_details, activity_id, 2000, 0) or {}
    descr = {m.get("key"): m.get("metricsIndex") for m in d.get("metricDescriptors") or []}
    i_hr, i_ts = descr.get("directHeartRate"), descr.get("directTimestamp")
    if i_hr is None:
        return None, 0
    rows = []
    for m in d.get("activityDetailMetrics") or []:
        v = m.get("metrics") or []
        hr = v[i_hr] if i_hr < len(v) else None
        ts = v[i_ts] if i_ts is not None and i_ts < len(v) else None
        if hr is not None:
            rows.append((ts, hr))
    if len(rows) < 10:
        return None, len(rows)
    if all(ts is not None for ts, _ in rows):
        rows.sort(key=lambda x: x[0])
        total = below = 0.0
        for (t0, hr0), (t1, _) in zip(rows, rows[1:]):
            dt = t1 - t0
            if dt <= 0:
                continue
            total += dt
            if hr0 <= Z2_MAX_HR:
                below += dt
        if total > 0:
            return round(below / total * 100, 1), len(rows)
    # sin timestamps fiables: fracción de muestras (equiespaciadas por maxChartSize)
    n_below = sum(1 for _, hr in rows if hr <= Z2_MAX_HR)
    return round(n_below / len(rows) * 100, 1), len(rows)


def fetch_run_details(g, runs):
    details = load_json("runs_detail.json", {})
    # Backfill fase 3: carreras ya detalladas pero sin pct_z2 (clave ausente = pendiente;
    # None con clave presente = ya intentado y sin serie de FC, no se reintenta).
    for r in runs:
        rid = str(r["id"])
        if rid in details and "pct_z2" not in details[rid]:
            pct, n = pct_time_below_z2(g, r["id"])
            details[rid]["pct_z2"] = pct
            print(f"  pct_z2 backfill {rid} ({r['date']}): {pct}% (n={n})")
    for r in runs:
        rid = str(r["id"])
        if rid in details:
            continue
        print(f"  detalle nueva carrera {rid} ({r['date']})")
        d = {"splits": [], "zones": [], "weather": None}
        d["pct_z2"], _ = pct_time_below_z2(g, r["id"])
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
        if isinstance(zones, dict):  # 0.3.5 may wrap the list
            zones = zones.get("zones") or next((v for v in zones.values() if isinstance(v, list)), [])
        d["zones"] = [{"zone": z.get("zoneNumber"), "secs": round(z.get("secsInZone") or 0),
                       "low": z.get("zoneLowBoundary")} for z in zones]
        w = safe(g.get_activity_weather, r["id"])
        if w and w.get("temp") is not None:
            d["weather"] = {
                "temp_c": round((w["temp"] - 32) * 5 / 9, 1),  # API devuelve °F
                "temp_raw": w["temp"],  # temp_raw para verificar unidad en primer backfill
                "humidity": w.get("relativeHumidity"),
            }
        details[rid] = d
    return details


def make_stats_cache(g):
    """§3.1: get_stats(ds) cacheado por fecha — una sola llamada por día alimenta
    tanto daily.json (Body Battery) como health.json (constantes de salud)."""
    cache = {}

    def stats(ds):
        if ds not in cache:
            cache[ds] = safe(g.get_stats, ds, default={}) or {}
        return cache[ds]

    return stats


def harvest_stats(entry, health_entry, ds, stats):
    """§3.1: reparte el resumen diario de get_stats entre ambos ficheros.
    - entry (daily.json): claves BB IDÉNTICAS al add_bb_level original.
    - health_entry (health.json): claves de la tabla §3.2 que salen de get_stats.
    Claves presentes con None = día sin datos ya consultado (no reintentar).
    Si la llamada FALLÓ (safe -> {}), no se escribe NADA: escribir None
    machacaría valores buenos de la ventana de re-fetch y plantaría el sentinel
    de «día consultado» sobre un fallo transitorio (429/timeout) — el día queda
    pendiente y se reintenta en el siguiente run (§3.7/§8.7)."""
    s = stats(ds)
    if not s:
        return
    if entry is not None:
        entry["bb_high"] = s.get("bodyBatteryHighestValue")
        entry["bb_low"] = s.get("bodyBatteryLowestValue")
        entry["bb_last"] = s.get("bodyBatteryMostRecentValue")
    if health_entry is not None:
        floors = s.get("floorsAscended")
        health_entry.update({
            "rhr": s.get("restingHeartRate"),
            "rhr_7d": s.get("lastSevenDaysAvgRestingHeartRate"),
            "hr_min": s.get("minHeartRate"),
            "hr_max": s.get("maxHeartRate"),
            "spo2_avg": s.get("averageSpo2"),
            "spo2_min": s.get("lowestSpo2"),
            "resp_waking": s.get("avgWakingRespirationValue"),
            "stress_avg": s.get("averageStressLevel"),
            "stress_max": s.get("maxStressLevel"),
            "stress_qualifier": s.get("stressQualifier"),
            "stress_rest_pct": s.get("restStressPercentage"),
            "stress_low_pct": s.get("lowStressPercentage"),
            "stress_med_pct": s.get("mediumStressPercentage"),
            "stress_high_pct": s.get("highStressPercentage"),
            "steps": s.get("totalSteps"),
            "step_goal": s.get("dailyStepGoal"),
            "dist_m": s.get("totalDistanceMeters"),
            "active_kcal": s.get("activeKilocalories"),
            "bmr_kcal": s.get("bmrKilocalories"),
            "intensity_mod": s.get("moderateIntensityMinutes"),
            "intensity_vig": s.get("vigorousIntensityMinutes"),
            "floors_up": round(floors, 1) if floors is not None else None,
            "sedentary_s": s.get("sedentarySeconds"),
            "bb_wake": s.get("bodyBatteryAtWakeTime"),
        })


def fetch_dailies(g, stats):
    dailies = {d["date"]: d for d in load_json("daily.json", [])}
    if dailies:
        start = datetime.strptime(max(dailies), "%Y-%m-%d").date() - timedelta(days=HISTORY_REFETCH_DAYS)
        start = max(start, datetime.strptime(FIRST_DATE, "%Y-%m-%d").date())
    else:
        start = datetime.strptime(FIRST_DATE, "%Y-%m-%d").date()
    today = today_madrid()

    bb = {}
    chunk_start = start
    while chunk_start <= today:
        chunk_end = min(chunk_start + timedelta(days=27), today)
        for item in safe(g.get_body_battery, iso(chunk_start), iso(chunk_end), default=[]) or []:
            bb[item.get("date")] = {"bb_charged": item.get("charged"), "bb_drained": item.get("drained")}
        chunk_start = chunk_end + timedelta(days=1)

    weights = {}
    chunk_start = start
    while chunk_start <= today:
        chunk_end = min(chunk_start + timedelta(days=27), today)
        w = safe(g.get_weigh_ins, iso(chunk_start), iso(chunk_end), default={}) or {}
        for ws in w.get("dailyWeightSummaries", []):
            lw = ws.get("latestWeight") or {}
            if lw.get("weight"):
                weights[ws.get("summaryDate")] = round(lw["weight"] / 1000, 1)
        chunk_start = chunk_end + timedelta(days=1)

    d = start
    hrv_baseline = None
    while d <= today:
        ds = iso(d)
        entry = dailies.get(ds, {"date": ds})
        harvest_stats(entry, None, ds, stats)

        sleep = safe(g.get_sleep_data, ds, default={}) or {}
        dto = sleep.get("dailySleepDTO") or {}
        total = dto.get("sleepTimeSeconds")
        if total:
            scores = dto.get("sleepScores") or {}
            start_local = dto.get("sleepStartTimestampLocal")
            # timestampLocal = hora pared codificada como epoch UTC
            start_iso = (datetime.fromtimestamp(start_local / 1000, tz=timezone.utc).isoformat()
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

    # Backfill fase 3 (one-shot repartido): días históricos sin nivel de BB.
    pendientes = [e for e in dailies.values() if "bb_high" not in e]
    if pendientes:
        print(f"  BB backfill: {min(len(pendientes), BB_BACKFILL_MAX)}/{len(pendientes)} días")
        for e in pendientes[:BB_BACKFILL_MAX]:
            harvest_stats(e, None, e["date"], stats)

    return sorted(dailies.values(), key=lambda x: x["date"]), hrv_baseline


def pick_readiness(items):
    """§3.2: la API devuelve hasta 2 entradas de readiness por día. Regla
    determinista: la matinal (inputContext == AFTER_WAKEUP_RESET) si existe;
    si no, la de timestamp más temprano (los resets post-actividad contaminan)."""
    if isinstance(items, dict):
        items = [items]
    items = [i for i in items or [] if isinstance(i, dict)]
    if not items:
        return {}
    for i in items:
        if i.get("inputContext") == "AFTER_WAKEUP_RESET":
            return i
    return min(items, key=lambda i: (i.get("timestamp") is None, i.get("timestamp") or ""))


def harvest_health_day(g, he, ds, stats, activity_dates):
    """§3.2: día completo de health.json — get_stats (cacheado, gratis) +
    spo2 + respiration + readiness (3 llamadas) + hydration solo si hubo actividad.
    Cada sub-llamada solo escribe sus claves si la llamada TUVO ÉXITO (safe con
    default=None y comprobación `is not None`): distingue «API respondió sin
    dato» (sentinel None legítimo, no reintentar) de «llamada falló» (429/
    timeout — no plantar sentinel ni machacar valores previos; se reintenta).
    Crítico durante la semana de backfill (§3.7/§8.7)."""
    harvest_stats(None, he, ds, stats)

    spo2 = safe(g.get_spo2_data, ds, default=None)
    if spo2 is not None:
        he["spo2_sleep"] = (spo2 or {}).get("avgSleepSpO2")  # ojo camelCase: avgSleepSpO2 aquí, averageSpo2 en get_stats

    resp = safe(g.get_respiration_data, ds, default=None)
    if resp is not None:
        resp = resp or {}
        he["resp_sleep"] = resp.get("avgSleepRespirationValue")
        he["resp_low"] = resp.get("lowestRespirationValue")
        he["resp_high"] = resp.get("highestRespirationValue")

    tr = safe(g.get_training_readiness, ds, default=None)
    if tr is not None:
        r = pick_readiness(tr)
        he.update({
            "readiness_score": r.get("score"),  # sentinel: presente con None = respondió sin dato
            "readiness_level": r.get("level"),
            "readiness_feedback": r.get("feedbackShort"),
            "acwr_pct": r.get("acwrFactorPercent"),
            "acute_load": r.get("acuteLoad"),
            "factor_sleep_pct": r.get("sleepScoreFactorPercent"),
            "factor_sleep_hist_pct": r.get("sleepHistoryFactorPercent"),
            "factor_hrv_pct": r.get("hrvFactorPercent"),
            "factor_recovery_pct": r.get("recoveryTimeFactorPercent"),
            "factor_stress_pct": r.get("stressHistoryFactorPercent"),
            "recovery_time_h": r.get("recoveryTime"),
            "hrv_weekly": r.get("hrvWeeklyAverage"),
            # §2.2 pide el feedback por factor para los tooltips; §3.2 no fija sus
            # claves — convención: factor_*_fb espejo de factor_*_pct.
            "factor_sleep_fb": r.get("sleepScoreFactorFeedback"),
            "factor_sleep_hist_fb": r.get("sleepHistoryFactorFeedback"),
            "factor_hrv_fb": r.get("hrvFactorFeedback"),
            "factor_recovery_fb": r.get("recoveryTimeFactorFeedback"),
            "factor_stress_fb": r.get("stressHistoryFactorFeedback"),
            "acwr_fb": r.get("acwrFactorFeedback"),
        })

    if ds in activity_dates:  # §3.2: hydration SOLO días con actividad (sweatLoss)
        hy = safe(g.get_hydration_data, ds, default=None)
        if hy is not None:
            he["sweat_ml"] = (hy or {}).get("sweatLossInML")  # NO exportar goal/ingesta (valueInML:0 siempre)


def fetch_health(g, stats, all_acts):
    """§3.2 + §3.6: data/health.json — lista diaria, una entrada por fecha
    (patrón daily.json). Ventana HEALTH_REFETCH_DAYS + backfill con tope.
    Sentinel: clave 'rhr' presente (aunque valga None) = día ya consultado."""
    health = {h["date"]: h for h in load_json("health.json", [])}
    today = today_madrid()
    activity_dates = {a["date"] for a in all_acts}

    window = [iso(today - timedelta(days=n)) for n in range(HEALTH_REFETCH_DAYS, -1, -1)]
    for ds in window:
        he = health.setdefault(ds, {"date": ds})
        harvest_health_day(g, he, ds, stats, activity_dates)

    # Backfill §3.6: días históricos sin sentinel, tope HEALTH_BACKFILL_MAX/run.
    # Readiness solo existe desde el registro del reloj (~2026-03-10): antes queda None.
    d = datetime.strptime(FIRST_DATE, "%Y-%m-%d").date()
    pendientes = []
    while d <= today:
        ds = iso(d)
        if ds not in window and "rhr" not in health.get(ds, {}):
            pendientes.append(ds)
        d += timedelta(days=1)
    if pendientes:
        lote = pendientes[:HEALTH_BACKFILL_MAX]
        print(f"  health backfill: {len(lote)}/{len(pendientes)} días")
        for ds in lote:
            he = health.setdefault(ds, {"date": ds})
            harvest_health_day(g, he, ds, stats, activity_dates)

    return sorted(health.values(), key=lambda h: h["date"])


def snapshot_trends(g):
    """§3.3: data/trends.json — snapshot diario {date, ...} con dedupe doble:
    (a) ya hay fila de hoy -> skip sin gastar llamadas; (b) fila nueva idéntica
    a la última (salvo fecha) -> skip. 3 llamadas/run. Sin backfill posible
    (max_metrics vacío, verificado): la serie nace 2026-09."""
    trends = load_json("trends.json", [])
    today = iso(today_madrid())
    if any(t.get("date") == today for t in trends):
        return trends

    rp = safe(g.get_race_predictions, default={}) or {}
    if isinstance(rp, list):  # con rango devuelve lista; sin argumentos, dict
        rp = rp[-1] if rp else {}

    fa = safe(g.get_fitnessage_data, today, default={}) or {}
    comps = fa.get("components") or {}

    def comp(name, keys=("value", "targetValue", "potentialAge", "priority", "stale")):
        c = comps.get(name)
        return {k: c.get(k) for k in keys} if isinstance(c, dict) else None

    lt = safe(g.get_lactate_threshold, default={}) or {}
    shr = lt.get("speed_and_heart_rate") or {}
    power = lt.get("power") or {}
    lt_date = shr.get("calendarDate")

    row = {
        "date": today,
        "pred_5k_s": rp.get("time5K"),
        "pred_10k_s": rp.get("time10K"),
        "pred_half_s": rp.get("timeHalfMarathon"),
        "pred_marathon_s": rp.get("timeMarathon"),
        "fitness_age": fa.get("fitnessAge"),
        "fitness_age_achievable": fa.get("achievableFitnessAge"),
        "chrono_age": fa.get("chronologicalAge"),
        "comp_bmi": comp("bmi"),
        "comp_rhr": comp("rhr", keys=("value", "stale")),  # verificado: rhr solo trae {value, stale}
        "comp_vig_days": comp("vigorousDaysAvg"),
        "comp_vig_min": comp("vigorousMinutesAvg"),
        "last_updated": fa.get("lastUpdated"),
        "lt_hr": shr.get("heartRate"),
        # §2.9: unidad de speed sin documentar (0.29444; hipótesis ×10 -> m/s NO
        # confirmada): se guarda crudo y la web no pinta ritmo hasta verificar.
        # Al verificar contra la app Connect se fijan AQUÍ el flag a True y el
        # factor real (p.ej. 10.0) A LA VEZ — la web usa lt_speed_factor, nunca
        # un ×10 hardcodeado.
        "lt_speed_raw": shr.get("speed"),
        "lt_speed_unit_verified": False,
        "lt_speed_factor": None,
        "lt_date": lt_date[:10] if lt_date else None,
        "ftp_w": power.get("functionalThresholdPower"),
        "ftp_origin": power.get("origin"),  # verificado "weight" -> «estimado por peso»
        "ftp_wkg": power.get("powerToWeight"),
    }

    if trends and {k: v for k, v in trends[-1].items() if k != "date"} == \
            {k: v for k, v in row.items() if k != "date"}:
        return trends
    trends.append(row)
    trends.sort(key=lambda t: t["date"])
    return trends


def fetch_prs(g):
    """§3.4: data/prs.json — sobrescritura completa con los 9 PRs oficiales.
    typeId sin documentar (prTypeLabelKey llega null): el mapping vive en JS
    con fallback «Récord tipo N». 1 llamada/run."""
    prs = safe(g.get_personal_record, default=[]) or []
    out = []
    for pr in prs:
        if not isinstance(pr, dict):
            continue
        fecha = pr.get("activityStartDateTimeLocalFormatted")
        out.append({
            "type_id": pr.get("typeId"),
            "value": pr.get("value"),
            "date": fecha[:10] if fecha else None,
            "activity_id": pr.get("activityId"),
            "activity_name": pr.get("activityName"),
        })
    if not out:  # API caída: conservar lo que hay en disco, no vaciar el fichero
        return load_json("prs.json", [])
    return out


def fetch_status(g, hrv_baseline):
    ts = safe(g.get_training_status, iso(today_madrid()), default={}) or {}
    out = {"date": iso(today_madrid()), "hrv_baseline": hrv_baseline}
    try:
        vo2 = (ts.get("mostRecentVO2Max") or {}).get("generic") or {}
        out["vo2max"] = vo2.get("vo2MaxPreciseValue") or vo2.get("vo2MaxValue")
    except Exception:
        pass
    try:
        latest = (ts.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData") or {}
        dev = next(iter(latest.values()), {})
        load = dev.get("acuteTrainingLoadDTO") or {}
        # Comparación explícita con None (no `or`): una carga aguda legítimamente
        # 0 (varios días sin entrenar) es falsy y el `or` la perdería cayendo al
        # campo alternativo, que puede ser None -> acute_load: null falso.
        acute = load.get("dailyTrainingLoadAcute")
        out["acute_load"] = acute if acute is not None else load.get("acuteTrainingLoad")
        chronic = load.get("dailyTrainingLoadChronic")
        out["chronic_load"] = chronic if chronic is not None else load.get("chronicTrainingLoad")
        out["optimal_min"] = load.get("minTrainingLoadChronic")
        out["optimal_max"] = load.get("maxTrainingLoadChronic")
        out["status_feedback"] = dev.get("trainingStatusFeedbackPhrase")
    except Exception:
        pass
    return out


def append_status_history(status):
    """Fase 3: acumula un punto diario de cargas Garmin -> status_history.json.
    Garmin no expone histórico de acute/chronic: se construye día a día desde hoy.
    La web pinta la serie ACWR de Garmin cuando haya suficientes puntos."""
    hist = load_json("status_history.json", [])
    campos = ("acute_load", "chronic_load", "vo2max")
    # §3.0/F0 — limpieza one-shot idempotente al cargar: purgar las filas
    # todo-None históricas (no aportan nada; el guard de abajo impide que se
    # creen otras). Purga también la fila muerta de HOY si la dejó un run
    # anterior con API vacía: el append normal la re-siembra con datos en este
    # mismo run, aunque el punto muerto fuera de un día anterior ya sin arreglo.
    hist = [h for h in hist if not all(h.get(k) is None for k in campos)]
    nuevo = {"date": status["date"], **{k: status.get(k) for k in campos}}
    if any(h.get("date") == status["date"] for h in hist):
        return hist  # ya hay fila de hoy CON datos (las todo-None se purgaron arriba)
    if all(nuevo[k] is None for k in campos):
        return hist  # §3.0: no apendar filas todo-None (nacen muertas y bloquean la corrección)
    hist.append(nuevo)
    hist.sort(key=lambda h: h["date"])
    return hist


def merge_runs_with_dailies(runs, dailies, health):
    by_date = {d["date"]: d for d in dailies}
    by_health = {h["date"]: h for h in health}
    for r in runs:
        night = by_date.get(r["date"], {})  # sueño con fecha X = noche previa al día X
        r["sleep_score_prev"] = night.get("sleep_score")
        r["sleep_hours_prev"] = night.get("sleep_hours")
        r["rem_pct_prev"] = night.get("rem_pct")
        r["bedtime_prev"] = night.get("bedtime")
        r["hrv_morning"] = night.get("hrv")
        r["start_hour"] = bedtime_hour(r["start"])  # hora decimal de salida
        # §3.5: join con health.json para los ejes nuevos del explorador
        h = by_health.get(r["date"], {})
        prev = iso(datetime.strptime(r["date"], "%Y-%m-%d").date() - timedelta(days=1))
        r["rhr_dia"] = h.get("rhr")
        r["stress_prev"] = by_health.get(prev, {}).get("stress_avg")  # día anterior
        r["readiness_dia"] = h.get("readiness_score")
        r["spo2_prev"] = h.get("spo2_sleep")  # noche previa = fecha de la carrera (criterio sleep_score_prev)


def main():
    print("Login...")
    g = get_client()
    # §3.0: dump_token también en fallo — durante las semanas de backfill
    # (~170 llamadas/run) un abort a mitad no puede perder el token rotado.
    try:
        run(g)
    finally:
        dump_token(g)


def run(g):
    stats = make_stats_cache(g)
    print("Actividades...")
    all_acts, runs = fetch_activities(g)
    print(f"  {len(all_acts)} actividades, {len(runs)} carreras")
    details = fetch_run_details(g, runs)
    print("Dailies...")
    dailies, hrv_baseline = fetch_dailies(g, stats)
    print(f"  {len(dailies)} días")
    print("Salud...")
    health = fetch_health(g, stats, all_acts)
    print(f"  {len(health)} días de salud")
    status = fetch_status(g, hrv_baseline)
    trends = snapshot_trends(g)
    prs = fetch_prs(g)
    merge_runs_with_dailies(runs, dailies, health)

    for r in runs:  # temperatura al merge (viene del detalle)
        w = (details.get(str(r["id"])) or {}).get("weather") or {}
        r["temp_c"] = w.get("temp_c")

    save_json("all_activities.json", all_acts)
    save_json("runs.json", runs)
    save_json("runs_detail.json", details)
    save_json("daily.json", dailies)
    save_json("health.json", health)
    save_json("trends.json", trends)
    save_json("prs.json", prs)
    save_json("status.json", status)
    save_json("status_history.json", append_status_history(status))
    save_json("meta.json", {"updated": datetime.now().isoformat(timespec="seconds"),
                            "first_date": FIRST_DATE})
    print("OK")


if __name__ == "__main__":
    main()
