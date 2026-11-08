"""Pure severity policy; no model can bypass these limits."""
import math


def clamp(value, low=0.0, high=1.0):
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("Score inputs must be finite")
    return min(high, max(low, value))


def score_signal(magnitude, exposure, credibility, urgency, adjustment, critical_capable, pinned=False):
    m, fraction, c, u = map(clamp, (magnitude, exposure, credibility, urgency))
    e = min(fraction / 0.1, 1)
    adjustment = clamp(adjustment, -15, 15)
    severity = round(clamp(100 * (.35*m + .25*e + .20*c + .20*u) + adjustment, 0, 100), 2)
    level = "Critical" if severity >= 75 else "Normal" if severity >= 40 else "OK"
    # E in the spec is normalized exposure. The hard gate uses E >= .05, i.e. .5% of net worth.
    if level == "Critical" and not (m >= .6 and critical_capable and (fraction >= .005 or pinned)):
        level = "Normal"
    return severity, level


def cd_value(principal, apy, days):
    return principal * (1 + apy / 365) ** max(0, days)
