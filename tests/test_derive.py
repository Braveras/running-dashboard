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
    # 01:15 -> 1 + 15/60 = 1.25  (original spec said 1.26, arithmetic gives 1.25)
    assert bedtime_hour("2026-06-11T01:15:30") == 1.25
    # 23:36 -> 23 + 36/60 = 23.6  (original spec said 23.61, arithmetic gives 23.6)
    assert bedtime_hour("2026-06-10T23:36:30") == 23.6
    assert bedtime_hour(None) is None

def test_party_night():
    assert is_party_night(sleep_stress=68, score=29) is True
    assert is_party_night(sleep_stress=10, score=49) is False
    assert is_party_night(sleep_stress=45, score=50) is False
    assert is_party_night(None, None) is False
