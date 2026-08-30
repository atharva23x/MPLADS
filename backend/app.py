import os
import json

from flask import Flask, jsonify, request, send_from_directory, Response

import config
import data_store
import explain

app = Flask(__name__, static_folder=None)


@app.route("/")
def index():
    return send_from_directory(os.path.join(config.BASE_DIR, "..", "frontend"), "index.html")


@app.route("/<path:path>")
def static_files(path):
    frontend_dir = os.path.normpath(os.path.join(config.BASE_DIR, "..", "frontend"))
    full = os.path.join(frontend_dir, path)
    if os.path.isfile(full):
        return send_from_directory(frontend_dir, path)
    # SPA-style fallback
    return send_from_directory(frontend_dir, "index.html")


@app.route("/geo/india_states.geojson")
def geojson():
    return send_from_directory(os.path.join(config.BASE_DIR, "data", "geo"), "india_states.geojson")


def _scope_args():
    role = request.args.get("role")
    scope = {}
    state = request.args.get("state")
    # support both single value and repeated / comma-separated values
    raw_constituencies = request.args.getlist("constituency")
    # Flask getlist returns [] if not present; also handle comma case
    constituencies = []
    for v in raw_constituencies:
        if not v:
            continue
        # split comma-separated
        for part in v.split(","):
            part = part.strip()
            if part:
                constituencies.append(part)
    # fallback for single param with comma
    single = request.args.get("constituencies")
    if single:
        for part in single.split(","):
            part = part.strip()
            if part and part not in constituencies:
                constituencies.append(part)
    district = request.args.get("district")
    # also collect repeated district
    raw_districts = request.args.getlist("district")
    districts = []
    for v in raw_districts:
        if v:
            for part in v.split(","):
                part = part.strip()
                if part:
                    districts.append(part)
    if state:
        scope["state"] = state.strip()
    if constituencies:
        # keep both single and list forms for compatibility
        scope["constituency"] = constituencies[0] if len(constituencies) == 1 else constituencies
        scope["constituencies"] = constituencies
    if districts:
        scope["district"] = districts[0] if len(districts) == 1 else districts
        scope["districts"] = districts
    elif district:
        scope["district"] = district.strip()
        scope["districts"] = [district.strip()]
    return role, scope


_READ_ONLY = {"anomalies", "duplicates", "delays", "works", "work", "explain"}


def _deny_public(role):
    if role == "public":
        return jsonify({"error": "Read-only access: work-level drill-down not permitted"}), 403
    return None


@app.route("/api/summary")
def api_summary():
    house = request.args.get("house", "all")
    role, scope = _scope_args()
    return jsonify(data_store.get_summary(house, role, scope))


@app.route("/api/statewise")
def api_statewise():
    house = request.args.get("house", "all")
    role, scope = _scope_args()
    return jsonify(data_store.get_statewise(house, role, scope))


@app.route("/api/works")
def api_works():
    role, scope = _scope_args()
    deny = _deny_public(role)
    if deny:
        return deny
    house = request.args.get("house", "all")
    risk = request.args.get("risk")
    search = request.args.get("search")
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        limit, offset = 50, 0
    return jsonify(data_store.get_works(house, risk, search, limit, offset, role, scope))


@app.route("/api/anomalies")
def api_anomalies():
    role, scope = _scope_args()
    deny = _deny_public(role)
    if deny:
        return deny
    house = request.args.get("house", "all")
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        limit, offset = 50, 0
    return jsonify(data_store.get_anomalies(house, limit, offset, role, scope))


@app.route("/api/duplicates")
def api_duplicates():
    role, scope = _scope_args()
    deny = _deny_public(role)
    if deny:
        return deny
    house = request.args.get("house", "all")
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        limit, offset = 50, 0
    return jsonify(data_store.get_duplicates(house, limit, offset, role, scope))


@app.route("/api/delays")
def api_delays():
    role, scope = _scope_args()
    deny = _deny_public(role)
    if deny:
        return deny
    house = request.args.get("house", "all")
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        limit, offset = 50, 0
    return jsonify(data_store.get_delays(house, limit, offset, role, scope))


@app.route("/api/work/<path:work_id>")
def api_work(work_id):
    role, scope = _scope_args()
    deny = _deny_public(role)
    if deny:
        return deny
    house = request.args.get("house", "all")
    rec = data_store.get_work(house, work_id, role, scope)
    if rec is None:
        return jsonify({"error": "Work not found"}), 404
    return jsonify(rec)


@app.route("/api/explain")
def api_explain():
    role, scope = _scope_args()
    deny = _deny_public(role)
    if deny:
        return deny
    house = request.args.get("house", "all")
    work_id = request.args.get("work_id")
    if not work_id:
        return jsonify({"error": "work_id required"}), 400
    rec = data_store.get_work(house, work_id, role, scope)
    if rec is None:
        return jsonify({"error": "Work not found"}), 404
    result = explain.explain_work(rec)
    return jsonify(result)


@app.route("/api/houses")
def api_houses():
    return jsonify(data_store.list_houses())


@app.route("/api/filters")
def api_filters():
    state = request.args.get("state")
    return jsonify(data_store.get_filters(state))


@app.route("/api/analytics")
def api_analytics():
    house = request.args.get("house", "all")
    role, scope = _scope_args()
    return jsonify(data_store.get_analytics(house, role, scope))


def main():
    app.run(host=config.HOST, port=config.PORT, debug=False)


if __name__ == "__main__":
    main()
