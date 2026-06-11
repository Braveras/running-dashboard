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
