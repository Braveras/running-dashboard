"""Sondeo one-shot (rama sonda-salud): qué endpoints de salud devuelve esta
cuenta/reloj y con qué campos. No toca data/. Reusa el login CI de fetch_data
(incluido TOKEN_OUT para que el workflow rote el secret — obligatorio)."""
import json
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from fetch_data import get_client, dump_token, iso, today_madrid

HOY = today_madrid()
AYER = iso(HOY - timedelta(days=1))
HACE7 = iso(HOY - timedelta(days=7))
HOY = iso(HOY)


def resumen(v, prof=0):
    """Estructura compacta: claves y tipos, sin volcar series enteras."""
    if isinstance(v, dict):
        if prof >= 2:
            return {k: type(x).__name__ for k, x in v.items()}
        return {k: resumen(x, prof + 1) for k, x in v.items()}
    if isinstance(v, list):
        return f"list[{len(v)}]" if not v else [f"list[{len(v)}], primero:", resumen(v[0], prof + 1)]
    return v if isinstance(v, (int, float, bool)) or v is None else (
        v if isinstance(v, str) and len(v) <= 60 else f"str[{len(v)}]")


def main():
    g = get_client()
    print("Login OK\n")
    sondas = [
        ("stats", lambda: g.get_stats(AYER)),
        ("heart_rates", lambda: g.get_heart_rates(AYER)),
        ("rhr_day", lambda: g.get_rhr_day(AYER)),
        ("stress_data", lambda: g.get_stress_data(AYER)),
        ("all_day_stress", lambda: g.get_all_day_stress(AYER)),
        ("respiration", lambda: g.get_respiration_data(AYER)),
        ("spo2", lambda: g.get_spo2_data(AYER)),
        ("intensity_minutes", lambda: g.get_intensity_minutes_data(AYER)),
        ("steps_data", lambda: g.get_steps_data(AYER)),
        ("daily_steps", lambda: g.get_daily_steps(HACE7, AYER)),
        ("floors", lambda: g.get_floors(AYER)),
        ("hydration", lambda: g.get_hydration_data(AYER)),
        ("body_composition", lambda: g.get_body_composition(HACE7, AYER)),
        ("fitnessage", lambda: g.get_fitnessage_data(AYER)),
        ("training_readiness", lambda: g.get_training_readiness(AYER)),
        ("morning_training_readiness", lambda: g.get_morning_training_readiness(AYER)),
        ("endurance_score", lambda: g.get_endurance_score(HACE7, AYER)),
        ("hill_score", lambda: g.get_hill_score(HACE7, AYER)),
        ("race_predictions", lambda: g.get_race_predictions()),
        ("lactate_threshold", lambda: g.get_lactate_threshold()),
        ("running_tolerance", lambda: g.get_running_tolerance()),
        ("max_metrics", lambda: g.get_max_metrics(AYER)),
        ("personal_record", lambda: g.get_personal_record()),
        ("all_day_events", lambda: g.get_all_day_events(AYER)),
        ("lifestyle_logging", lambda: g.get_lifestyle_logging_data(AYER)),
        ("devices", lambda: g.get_devices()),
        ("primary_training_device", lambda: g.get_primary_training_device()),
    ]
    out = {}
    for nombre, fn in sondas:
        try:
            r = fn()
            vacio = r is None or r == [] or r == {}
            out[nombre] = {"ok": True, "vacio": vacio, "forma": resumen(r)}
            print(f"[OK ] {nombre}{' (VACÍO)' if vacio else ''}")
        except Exception as e:
            out[nombre] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:120]}"}
            print(f"[ERR] {nombre}: {type(e).__name__}: {str(e)[:80]}")
    with open("probe_result.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    disponibles = [n for n, v in out.items() if v.get("ok") and not v.get("vacio")]
    print(f"\nDisponibles con datos: {len(disponibles)}/{len(sondas)}")
    print("  " + ", ".join(disponibles))
    dump_token(g)
    print("OK")


if __name__ == "__main__":
    main()
