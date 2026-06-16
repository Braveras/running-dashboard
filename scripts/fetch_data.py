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

    # Garmin bloquea la llamada a "social profile" desde IPs de datacenter (CI).
    # client.loads() restaura la sesión OAuth SIN tocar el perfil; inyectamos
    # display_name/unit_system cacheados (display_name = UUID, no es sensible).
    display_name = os.environ.get("GARMIN_DISPLAY_NAME")
    g = Garmin()
    last_err = None
    for intento in range(3):
        try:
            if display_name:
                g.garth.loads(token) if hasattr(g, "garth") else g.client.loads(token)
                g.display_name = display_name
                g.unit_system = os.environ.get("GARMIN_UNIT_SYSTEM", "metric")
            else:
                g.login(tokenstore=token)  # local: carga perfil normalmente
            return g
        except Exception as e:
            last_err = e
            print(f"  login intento {intento + 1}/3 falló: {type(e).__name__}: {e}")
    sys.exit(f"Login Garmin falló tras 3 intentos: {type(last_err).__name__}: {last_err}")


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


def fetch_dailies(g):
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

    return sorted(dailies.values(), key=lambda x: x["date"]), hrv_baseline


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
