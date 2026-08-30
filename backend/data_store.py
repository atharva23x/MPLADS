import math
import pandas as pd

import config

_HOUSES = {}


def _clean_scalar(v):
    """Return None for NaN/inf and convert numpy scalars to Python natives for JSON."""
    try:
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            return None
        # pandas / numpy NaN check (covers np.nan, pd.NA)
        if pd.isna(v):
            return None
    except Exception:
        pass
    # convert numpy generic scalars (int64, float64, bool_) to Python natives
    try:
        if hasattr(v, "item"):
            # np.generic has .item() -> python scalar
            try:
                v = v.item()
            except Exception:
                pass
    except Exception:
        pass
    # after conversion, check again for inf/nan if numeric
    try:
        if isinstance(v, float):
            if math.isnan(v) or math.isinf(v):
                return None
    except Exception:
        pass
    # handle pandas Timestamp -> ISO string
    try:
        if isinstance(v, pd.Timestamp):
            if pd.isna(v):
                return None
            return v.isoformat()
    except Exception:
        pass
    # numpy integers already converted; ensure bool stays bool
    return v


def _load_csv(path, house):
    df = pd.read_csv(path, low_memory=False, encoding="utf-8")
    df["House"] = house
    # Drop spurious total/ghost row that has NaN Work ID (was inserted as summary)
    if "Work ID" in df.columns:
        df = df.dropna(subset=["Work ID"])
        # also drop rows where Work ID is blank string after strip
        df = df[df["Work ID"].astype(str).str.strip() != ""]
        df = df[df["Work ID"].astype(str).str.strip().str.lower() != "nan"]
    return df


def _ensure_numeric(df):
    num_cols = [
        "Sanction Amount ( ₹ )",
        "Amount Disbursed ( ₹ )",
        "Fund Disbursed Amount ( ₹ )",
        "expenditure_ratio",
        "amount_ratio",
        "unspent_amount",
        "expenditure_overrun",
        "disbursement_overrun",
        "recommendation_to_sanction_days",
        "sanction_to_expenditure_days",
        "sanction_to_completion_days",
        "duration_days",
        "delay_days",
        "is_delayed",
        "average_payment",
        "is_completed",
        "spend_without_completion",
        "high_spend_incomplete",
        "payment_status_missing",
        "possible_duplicate_work",
        "duplicate_description",
        "rule_expenditure_over_sanction",
        "rule_disbursement_over_sanction",
        "rule_completion_before_sanction",
        "rule_expenditure_before_sanction",
        "rule_recommendation_after_sanction",
        "model_prediction",
        "Is Anomaly",
        "anomaly_score",
        "compliance_score",
        "payment_count",
    ]
    for c in num_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def _fix_rajya_duplicates(df):
    """Repair Rajya Sabha possible_duplicate_work bug (pipeline counted 0/1 flags, giving 100%).
    For Rajya there is no Constituency, so duplicate should be description_clean only."""
    if "possible_duplicate_work" in df.columns and "description_clean" in df.columns:
        # Only fix if it's the buggy 100% case; recompute from description_clean
        # Lok with constituency uses location-based logic which is already correct, so we only
        # touch Rajya (House == Rajya Sabha) or any df where Constituency is missing/empty
        is_rajya = False
        if "House" in df.columns:
            # if all House values are Rajya Sabha (pure rajya df), fix it
            try:
                is_rajya = (df["House"].astype(str).str.strip() == "Rajya Sabha").all()
            except Exception:
                is_rajya = False
        # also consider combined: we recompute per-row via description_clean grouping for the rajya slice inside combined
        # For simplicity, recompute for the whole df if it contains rajya rows: we compute correct grouping
        # using description_clean alone for rows where House==Rajya Sabha, and location grouping for Lok
        try:
            # compute correct possible_duplicate using proper logic
            if is_rajya:
                desc = df["description_clean"].fillna("").astype(str).str.strip()
                cnt = desc.value_counts()
                df["possible_duplicate_work"] = (desc.map(cnt) > 1).astype(int)
            else:
                # For combined: need to keep Lok's location logic correct, fix Rajya slice inside combined
                # Recompute separately per house group
                df_fixed = df.copy()
                for h, mask in [("Lok Sabha", df["House"] == "Lok Sabha"), ("Rajya Sabha", df["House"] == "Rajya Sabha")]:
                    sub = df[mask]
                    if sub.empty:
                        continue
                    desc_sub = sub["description_clean"].fillna("").astype(str).str.strip()
                    if h == "Lok Sabha" and "Constituency" in sub.columns:
                        loc = desc_sub + "_" + sub["Constituency"].fillna("").astype(str).str.lower().str.strip()
                        cnt2 = loc.value_counts()
                        df_fixed.loc[mask, "possible_duplicate_work"] = (loc.map(cnt2) > 1).astype(int).values
                    else:
                        cnt2 = desc_sub.value_counts()
                        df_fixed.loc[mask, "possible_duplicate_work"] = (desc_sub.map(cnt2) > 1).astype(int).values
                df["possible_duplicate_work"] = df_fixed["possible_duplicate_work"]
        except Exception:
            pass
    return df


def _init():
    lok = _ensure_numeric(_load_csv(config.LOK_CSV, "Lok Sabha"))
    rajya = _ensure_numeric(_load_csv(config.RAJYA_CSV, "Rajya Sabha"))
    # repair bug before concat
    lok = _fix_rajya_duplicates(lok)
    rajya = _fix_rajya_duplicates(rajya)
    combined = pd.concat([lok, rajya], ignore_index=True, sort=False)
    combined = _fix_rajya_duplicates(combined)
    _HOUSES["lok"] = lok
    _HOUSES["rajya"] = rajya
    _HOUSES["all"] = combined


def _get(house):
    if not _HOUSES:
        _init()
    return _HOUSES.get(house, _HOUSES["all"])


def _norm_house(house):
    house = (house or "all").lower()
    if house not in _HOUSES:
        house = "all"
    return house


# ---------------------------------------------------------------------------
# Role-based scoping
#   mospi  -> full access (all India)
#   public -> read-only, limited (aggregates only; no work-level drill-down)
#   sna    -> state-level only (sees all constituencies in that state)
#   da     -> district authority: sees ONE state but MULTIPLE constituencies
#             (optional filter – if no constituency list, sees whole state)
#   mp     -> MP: strictly ONE constituency in ONE state
# ---------------------------------------------------------------------------
def _normalize_list(val):
    if val is None:
        return []
    if isinstance(val, (list, tuple, set)):
        return [str(x).strip() for x in val if str(x).strip()]
    # single string – may be comma-separated
    s = str(val).strip()
    if not s:
        return []
    if "," in s:
        return [p.strip() for p in s.split(",") if p.strip()]
    return [s]


def _apply_scope(df, role, scope):
    if not role or role in ("mospi", "public"):
        return df
    scope = scope or {}
    # helper to safely filter by State if column exists
    def filter_state(dframe, state_val):
        if not state_val or "State" not in dframe.columns:
            return dframe
        return dframe[dframe["State"].astype(str).str.strip() == str(state_val).strip()]

    def filter_constituencies(dframe, cons_list):
        if not cons_list or "Constituency" not in dframe.columns:
            return dframe
        # Rajya Sabha rows have no Constituency – they will be dropped if constituency filter is active
        # That's correct for MP (Lok only). For DA/SNA viewing Rajya, constituency filter is skipped
        # if column missing -> no filtering
        return dframe[dframe["Constituency"].astype(str).str.strip().isin([str(c).strip() for c in cons_list])]

    if role == "sna":
        st = scope.get("state")
        df = filter_state(df, st)
        # SNA always sees whole state – ignore any constituency/district passed
        return df

    if role == "da":
        st = scope.get("state")
        df = filter_state(df, st)
        # DA can see multiple constituencies at once. If none specified -> whole state (all constituencies)
        cons = _normalize_list(scope.get("constituencies") or scope.get("constituency"))
        # also handle district -> map to constituency filter if District column missing
        # if District column exists, filter by it; otherwise constituency filter is the authority boundary
        if "District" in df.columns:
            dists = _normalize_list(scope.get("districts") or scope.get("district"))
            if dists:
                df = df[df["District"].astype(str).str.strip().isin(dists)]
        if cons:
            df = filter_constituencies(df, cons)
        return df

    if role == "mp":
        # MP MUST have exactly one constituency + state. Enforce single.
        st = scope.get("state")
        cons = _normalize_list(scope.get("constituencies") or scope.get("constituency"))
        # Take only first if multiple supplied (defence in depth)
        if cons:
            cons = cons[:1]
        df = filter_state(df, st)
        if cons:
            # if Constituency column missing (e.g. Rajya Sabha df), then MP sees nothing from that house – that's correct
            if "Constituency" in df.columns:
                df = filter_constituencies(df, cons)
            else:
                # no constituency to match -> empty for this house slice
                df = df.iloc[0:0]
        else:
            # No constituency supplied -> MP should see nothing (not whole state)
            df = df.iloc[0:0]
        return df

    return df


def get_filters(state=None):
    if not _HOUSES:
        _init()
    df = _HOUSES["all"]
    states = sorted(df["State"].dropna().astype(str).str.strip().unique().tolist())
    if state:
        sdf = df[df["State"].astype(str).str.strip() == str(state)]
        cons = sorted(sdf["Constituency"].dropna().astype(str).str.strip().unique().tolist())
        districts = (
            sorted(sdf["District"].dropna().astype(str).str.strip().unique().tolist())
            if "District" in sdf.columns
            else []
        )
    else:
        cons = sorted(df["Constituency"].dropna().astype(str).str.strip().unique().tolist())
        districts = sorted(df["District"].dropna().astype(str).str.strip().unique().tolist()) if "District" in df.columns else []
    return {"states": states, "constituencies": cons, "districts": districts}


def _records(df, columns):
    out = []
    for _, row in df.iterrows():
        rec = {}
        for c in columns:
            if c in df.columns:
                rec[c] = _clean_scalar(row[c])
            else:
                rec[c] = None
        out.append(rec)
    return out


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
def get_summary(house, role=None, scope=None):
    df = _apply_scope(_get(_norm_house(house)), role, scope)
    total = len(df)
    anomalies = int(df["Is Anomaly"].fillna(0).sum())
    duplicates = int(df["possible_duplicate_work"].fillna(0).sum())
    delayed = int(df["is_delayed"].fillna(0).sum())
    risk_counts = df["Risk Level"].value_counts().to_dict()
    avg_compliance = _clean_scalar(df["compliance_score"].mean())
    total_sanction = _clean_scalar(df["Sanction Amount ( ₹ )"].sum())
    total_disbursed = _clean_scalar(df["Fund Disbursed Amount ( ₹ )"].sum())
    return {
        "house": house,
        "total_works": total,
        "anomalies": anomalies,
        "duplicates": duplicates,
        "delayed": delayed,
        "risk_levels": {
            "HIGH": int(risk_counts.get("HIGH", 0)),
            "MEDIUM": int(risk_counts.get("MEDIUM", 0)),
            "LOW": int(risk_counts.get("LOW", 0)),
        },
        "avg_compliance_score": avg_compliance,
        "total_sanction": total_sanction,
        "total_disbursed": total_disbursed,
    }


# ---------------------------------------------------------------------------
# Statewise risk (for the map + table)
# ---------------------------------------------------------------------------
def get_statewise(house, role=None, scope=None):
    df = _apply_scope(_get(_norm_house(house)), role, scope).copy()
    df = df.dropna(subset=["State"])
    df["State"] = df["State"].astype(str).str.strip()
    risk_map = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}
    df["risk_score"] = df["Risk Level"].map(risk_map).fillna(1)

    ct = pd.crosstab(df["State"], df["Risk Level"]).reset_index()
    for col in ["HIGH", "MEDIUM", "LOW"]:
        if col not in ct.columns:
            ct[col] = 0
    ct["HIGH"] = ct["HIGH"].astype(int)
    ct["MEDIUM"] = ct["MEDIUM"].astype(int)
    ct["LOW"] = ct["LOW"].astype(int)
    ct["Total_Works"] = ct["HIGH"] + ct["MEDIUM"] + ct["LOW"]
    ct["High_Risk_%"] = (ct["HIGH"] / ct["Total_Works"] * 100).round(2)
    ct["Medium_Risk_%"] = (ct["MEDIUM"] / ct["Total_Works"] * 100).round(2)
    ct["Low_Risk_%"] = (ct["LOW"] / ct["Total_Works"] * 100).round(2)
    ct["Risk_Rate_%"] = ((ct["HIGH"] + ct["MEDIUM"]) / ct["Total_Works"] * 100).round(2)
    avg = df.groupby("State")["risk_score"].mean().round(3)
    ct["Avg_Risk_Score"] = ct["State"].map(avg).round(3)

    # Standardize names for the GeoJSON join
    ct["map_name"] = ct["State"].replace(config.STATE_NAME_MAPPING)

    cols = [
        "State", "map_name", "Total_Works", "HIGH", "MEDIUM", "LOW",
        "High_Risk_%", "Medium_Risk_%", "Low_Risk_%", "Risk_Rate_%",
        "Avg_Risk_Score",
    ]
    records = _records(ct, cols)
    records.sort(key=lambda r: (r["High_Risk_%"] or 0), reverse=True)
    return records


# ---------------------------------------------------------------------------
# Generic work list with filters (used by the table views)
# ---------------------------------------------------------------------------
_FIELDS = [
    "Work ID", "House", "Work", "Work Category", "State",
    "Hon'ble Members of Parliament", "Constituency", "Vendor Name",
    "Sanction Amount ( ₹ )", "Amount Disbursed ( ₹ )",
    "Fund Disbursed Amount ( ₹ )", "duration_days", "delay_days",
    "is_delayed", "possible_duplicate_work", "Is Anomaly", "anomaly_score",
    "compliance_score", "Risk Level", "Risk Alert", "Anomaly Reason",
]


def get_works(house, risk=None, search=None, limit=50, offset=0, role=None, scope=None):
    df = _apply_scope(_get(_norm_house(house)), role, scope).copy()
    if risk:
        df = df[df["Risk Level"].astype(str).str.upper() == risk.upper()]
    if search:
        mask = (
            df["Work ID"].astype(str).str.contains(search, case=False, na=False)
            | df["Work"].astype(str).str.contains(search, case=False, na=False)
            | df["State"].astype(str).str.contains(search, case=False, na=False)
            | df["Vendor Name"].astype(str).str.contains(search, case=False, na=False)
            | df["Hon'ble Members of Parliament"].astype(str).str.contains(search, case=False, na=False)
        )
        df = df[mask]
    total = len(df)
    df = df.sort_values("anomaly_score", na_position="last").iloc[offset: offset + limit]
    return {"total": total, "count": len(df), "records": _records(df, _FIELDS)}


def get_anomalies(house, limit=50, offset=0, role=None, scope=None):
    df = _apply_scope(_get(_norm_house(house)), role, scope).copy()
    df = df[df["Is Anomaly"] == 1]
    total = len(df)
    df = df.sort_values("anomaly_score").iloc[offset: offset + limit]
    cols = [
        "Work ID", "House", "Work", "State", "Vendor Name",
        "Sanction Amount ( ₹ )", "Fund Disbursed Amount ( ₹ )",
        "duration_days", "compliance_score", "anomaly_score",
        "Risk Level", "Anomaly Reason",
    ]
    return {"total": total, "count": len(df), "records": _records(df, cols)}


def get_duplicates(house, limit=50, offset=0, role=None, scope=None):
    df = _apply_scope(_get(_norm_house(house)), role, scope).copy()
    df = df[df["possible_duplicate_work"] == 1]
    total = len(df)
    df = df.sort_values("compliance_score").iloc[offset: offset + limit]
    cols = [
        "Work ID", "House", "Work", "Work Description", "State",
        "Constituency", "Vendor Name", "Sanction Amount ( ₹ )",
        "compliance_score", "Risk Level", "Anomaly Reason",
    ]
    return {"total": total, "count": len(df), "records": _records(df, cols)}


def get_delays(house, limit=50, offset=0, role=None, scope=None):
    df = _apply_scope(_get(_norm_house(house)), role, scope).copy()
    df = df[df["is_delayed"] == 1]
    total = len(df)
    df = df.sort_values("duration_days", ascending=False).iloc[offset: offset + limit]
    cols = [
        "Work ID", "House", "Work", "State", "Vendor Name",
        "Sanction Date", "Completion Date", "duration_days", "delay_days",
        "compliance_score", "Risk Level", "Anomaly Reason",
    ]
    return {"total": total, "count": len(df), "records": _records(df, cols)}


def get_work(house, work_id, role=None, scope=None):
    df = _apply_scope(_get(_norm_house(house)), role, scope)
    match = df[df["Work ID"].astype(str) == str(work_id)]
    if match.empty and role in (None, "mospi", "public"):
        # try across all houses (only for unrestricted roles)
        match = _HOUSES["all"][_HOUSES["all"]["Work ID"].astype(str) == str(work_id)]
    if match.empty:
        return None
    row = match.iloc[0]
    cols = list(df.columns) if not match.empty else []
    rec = {}
    for c in match.columns:
        rec[c] = _clean_scalar(row[c])
    return rec


def list_houses():
    return ["lok", "rajya", "all"]


# ---------------------------------------------------------------------------
# Analytics aggregations (used by the Analytics page)
# ---------------------------------------------------------------------------
def get_analytics(house, role=None, scope=None):
    df = _apply_scope(_get(_norm_house(house)), role, scope).copy()

    # Risk breakdown
    risk_counts = df["Risk Level"].value_counts().to_dict()
    risk_breakdown = {
        "HIGH": int(risk_counts.get("HIGH", 0)),
        "MEDIUM": int(risk_counts.get("MEDIUM", 0)),
        "LOW": int(risk_counts.get("LOW", 0)),
    }

    # Sanction trend (time-series by sanction month)
    sd = pd.to_datetime(df["Sanction Date"], errors="coerce")
    df["_month"] = sd.dt.to_period("M").astype(str)
    trend = (
        df.dropna(subset=["_month"])
        .groupby("_month")
        .agg(sanction=("Sanction Amount ( ₹ )", "sum"), count=("Work ID", "count"))
        .reset_index()
        .sort_values("_month")
    )
    sanction_trend = [
        {
            "month": r["_month"],
            "sanction": _clean_scalar(r["sanction"]),
            "count": int(r["count"]),
        }
        for _, r in trend.iterrows()
    ]

    # Flagged works by state (anomaly ranking)
    flagged = df[df["Is Anomaly"] == 1]
    fs = (
        flagged.groupby("State")
        .size()
        .reset_index(name="flagged")
        .sort_values("flagged", ascending=False)
        .head(15)
    )
    flagged_by_state = [
        {"state": (r["State"] or "Unknown"), "flagged": int(r["flagged"])}
        for _, r in fs.iterrows()
    ]

    # Work status progress tracker
    ws = df["Work Status"].fillna("Unknown").value_counts()
    work_status = [{"status": str(k), "count": int(v)} for k, v in ws.items()]

    # Sanction outlay by state (fund allocation)
    so = (
        df.groupby("State")["Sanction Amount ( ₹ )"]
        .sum()
        .reset_index()
        .sort_values("Sanction Amount ( ₹ )", ascending=False)
        .head(15)
    )
    sanction_outlay = [
        {"state": (r["State"] or "Unknown"), "sanction": _clean_scalar(r["Sanction Amount ( ₹ )"])}
        for _, r in so.iterrows()
    ]

    # Top vendors (concentration)
    top = (
        df.groupby("Vendor Name")
        .agg(works=("Work ID", "count"), sanction=("Sanction Amount ( ₹ )", "sum"))
        .reset_index()
        .sort_values("sanction", ascending=False)
        .head(15)
    )
    top_vendors = [
        {
            "vendor": (str(r["Vendor Name"]) or "Unknown")[:40],
            "works": int(r["works"]),
            "sanction": _clean_scalar(r["sanction"]),
        }
        for _, r in top.iterrows()
    ]

    return {
        "house": house,
        "risk_breakdown": risk_breakdown,
        "sanction_trend": sanction_trend,
        "flagged_by_state": flagged_by_state,
        "work_status": work_status,
        "sanction_outlay": sanction_outlay,
        "top_vendors": top_vendors,
    }
