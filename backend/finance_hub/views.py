"""Read models shared by alert lists, mutation responses and demo injection."""
from sqlalchemy import select

from .db import Evaluation, Trigger, row_dict


def alert_view(alert, trigger, evaluation, demo):
    breakdown = None
    if evaluation:
        breakdown = {key: getattr(evaluation, key) for key in
                     ("magnitude", "credibility", "urgency", "adjustment")}
        breakdown["exposure"] = min(evaluation.exposure / .1, 1)
    return {**row_dict(alert), "trigger_name": trigger.spec["name"] if trigger else "Removed trigger",
            "rationale": evaluation.triage.get("rationale") if evaluation else None,
            "breakdown": breakdown, "demo": demo}


async def load_alert_view(session, alert, demo):
    trigger = await session.get(Trigger, alert.trigger_id)
    evaluation = await session.scalar(select(Evaluation).where(
        Evaluation.id == alert.evaluation_id, Evaluation.ts == alert.evaluation_ts))
    return alert_view(alert, trigger, evaluation, demo)
