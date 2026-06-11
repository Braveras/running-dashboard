"""Funciones puras de métricas derivadas. Sin I/O."""

from datetime import datetime


def pace_s_per_km(distance_m, duration_s):
    """Ritmo en segundos por km. None si falta distancia o duración."""
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
    dt = datetime.fromisoformat(sleep_start_local)
    return round(dt.hour + dt.minute / 60, 2)


def is_party_night(sleep_stress, score):
    """Estrés nocturno alto + score muy bajo = noche de fiesta/alcohol."""
    if sleep_stress is None or score is None:
        return False
    # Umbrales empíricos de los datos del usuario: noches de fiesta reales dieron estrés 60-68 y score 21-29; noches normales estrés <=24.
    return sleep_stress > 40 and score < 35
