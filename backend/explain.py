import config

_client = None


def _get_client():
    global _client
    if _client is None:
        from google import genai
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


def _fallback_explanation(work_record):
    """Deterministic rule-based explanation when Gemini is unavailable (quota etc)."""
    reasons = (work_record.get("Anomaly Reason") or "").strip()
    risk = work_record.get("Risk Level") or "LOW"
    is_anomaly = int(work_record.get("Is Anomaly") or 0)
    is_dup = int(work_record.get("possible_duplicate_work") or 0)
    is_delayed = int(work_record.get("is_delayed") or 0)
    dur = work_record.get("duration_days")
    comp = work_record.get("compliance_score")
    anomaly_score = work_record.get("anomaly_score")
    name = work_record.get("Work") or work_record.get("Work ID") or "N/A"
    # Build structured bullet points
    lines = []
    lines.append(f"Project '{name}' — Risk: {risk} | Compliance: {comp if comp is not None else '—'}/100 | Duration: {dur if dur is not None else '—'} days")
    if is_anomaly == 1:
        lines.append(f"• Flagged by Isolation Forest (anomaly_score={anomaly_score:.3f} < -0.05)" if isinstance(anomaly_score, (int,float)) else "• Flagged as anomaly by ML model")
        if reasons and reasons.lower() != "none":
            lines.append(f"• Model reasons: {reasons}")
        else:
            lines.append("• Model reasons: statistical outlier (pipeline rule)")
    else:
        lines.append("• Not flagged as anomaly — falls within normal multivariate distribution")
        if reasons and reasons.lower() != "none":
            lines.append(f"• Note: {reasons}")
    if is_dup == 1:
        dup_desc = work_record.get("Work Description") or work_record.get("Work") or ""
        lines.append(f"• Possible duplicate: same description at same location/constituency (Work Description: '{str(dup_desc)[:80]}') — suggests fund duplication risk")
    else:
        lines.append("• No duplicate detected at this location")
    if is_delayed == 1:
        delay = work_record.get("delay_days")
        lines.append(f"• Delayed: duration {dur} days exceeds 365-day SLA (delay {delay} days) — indicates execution / compliance risk")
    else:
        if dur is not None:
            try:
                if float(dur) > 300:
                    lines.append("• Near SLA limit — monitor for potential overrun")
                else:
                    lines.append("• Duration within SLA")
            except Exception:
                lines.append("• Duration within SLA")
        else:
            lines.append("• Duration within SLA")
    try:
        if comp is not None:
            cf = float(comp)
            if cf < 60:
                lines.append(f"• Low compliance ({cf:.0f}/100) — major documentation / milestone gaps")
            elif cf < 80:
                lines.append(f"• Moderate compliance ({cf:.0f}/100) — minor gaps; review milestones")
            else:
                lines.append(f"• High compliance ({cf:.0f}/100) — well documented")
    except Exception:
        pass
    if risk == "HIGH":
        lines.append("• Overall: HIGH risk — prioritise audit, site inspection and fund-flow verification")
    elif risk == "MEDIUM":
        lines.append("• Overall: MEDIUM risk — schedule review before next disbursement")
    else:
        lines.append("• Overall: LOW risk — routine monitoring")
    return "\n".join(lines)


def explain_work(work_record):
    """Ask Gemini to explain why a work was/was not flagged as an anomaly.

    `work_record` is a dict (from data_store.get_work).
    Falls back to rule-based explanation on quota/error.
    """
    client = _get_client()

    work_name = work_record.get("Work") or work_record.get("Work ID") or "N/A"
    sanction = work_record.get("Sanction Amount ( ₹ )")
    disbursed = work_record.get("Fund Disbursed Amount ( ₹ )")
    duration = work_record.get("duration_days")
    compliance = work_record.get("compliance_score")
    reasons = work_record.get("Anomaly Reason") or "None"
    risk = work_record.get("Risk Level") or "N/A"

    prompt = f"""
    You are an auditor reviewing government MPLADS projects.
    Explain why the following project was flagged/not flagged by our Isolation Forest ML model.
    Keep it concise, professional, and explain the financial/compliance risk in clear points.

    Project Data:
    - Work Name: {work_name}
    - Sanctioned Amount: ₹{sanction}
    - Disbursed Amount: ₹{disbursed}
    - Duration: {duration} days
    - Compliance Score: {compliance}/100
    - Model Anomaly Reasons: {reasons}
    - Risk Level: {risk}
    """

    try:
        response = client.models.generate_content(
            model=config.GEMINI_MODEL,
            contents=prompt,
        )
        text = getattr(response, "text", None)
        if text and text.strip():
            return {"explanation": text.strip(), "model_used": config.GEMINI_MODEL, "fallback": False, "error": None}
        # empty response -> fallback
        return {"explanation": _fallback_explanation(work_record), "model_used": "rule-based", "fallback": True, "error": None}
    except Exception as e:  # noqa: BLE001
        # Quota or network failure → deterministic fallback so UI never shows just error
        return {"explanation": _fallback_explanation(work_record), "model_used": "rule-based", "fallback": True, "error": str(e)}
