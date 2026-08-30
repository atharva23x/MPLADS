"use strict";

/* ---------------- Theme (light/dark) ---------------- */
const THEME_KEY = "mplads-theme-v2";
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = t === "light" ? "☀️" : "🌙";
  try { localStorage.setItem(THEME_KEY, t); } catch(e) {}
  // update chart colors for readability
  if (window.Chart) {
    Chart.defaults.color = t === "light" ? "#475569" : "#94a3b8";
    Chart.defaults.borderColor = t === "light" ? "#e2e8f0" : "#334155";
  }
  // re-render charts with new colors if already drawn
  if (typeof loadOverview === "function" && !document.body.classList.contains("locked")) {
    try { loadOverview(); loadAnalytics(); } catch(e) {}
  }
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch(e) {}
  // Default to dark (black) as requested — ignore system light preference on first visit
  const theme = saved || "dark";
  applyTheme(theme);
}

/* ---------------- Session (role + scope) ---------------- */
const session = { role: null, state: null, constituency: null, constituencies: null, district: null };

const scopeQS = () => {
  const p = [];
  if (session.role) p.push("role=" + encodeURIComponent(session.role));
  if (session.state) p.push("state=" + encodeURIComponent(session.state));
  // DA can have multiple constituencies – send as repeated param (backend supports both repeated & comma)
  if (session.constituencies && Array.isArray(session.constituencies) && session.constituencies.length) {
    session.constituencies.forEach((c) => p.push("constituency=" + encodeURIComponent(c)));
  } else if (session.constituency) {
    p.push("constituency=" + encodeURIComponent(session.constituency));
  }
  if (session.district) p.push("district=" + encodeURIComponent(session.district));
  return p.length ? "&" + p.join("&") : "";
};

const API = {
  filters: (st) => (st ? `/api/filters?state=${encodeURIComponent(st)}` : `/api/filters`),
  summary: (h) => `/api/summary?house=${h}${scopeQS()}`,
  statewise: (h) => `/api/statewise?house=${h}${scopeQS()}`,
  works: (h, risk, search, limit, offset) =>
    `/api/works?house=${h}&limit=${limit}&offset=${offset}` +
    (risk ? `&risk=${risk}` : "") +
    (search ? `&search=${encodeURIComponent(search)}` : "") + scopeQS(),
  anomalies: (h, search, limit, offset) =>
    `/api/anomalies?house=${h}&limit=${limit}&offset=${offset}` +
    (search ? `&search=${encodeURIComponent(search)}` : "") + scopeQS(),
  duplicates: (h, search, limit, offset) =>
    `/api/duplicates?house=${h}&limit=${limit}&offset=${offset}` +
    (search ? `&search=${encodeURIComponent(search)}` : "") + scopeQS(),
  delays: (h, search, limit, offset) =>
    `/api/delays?house=${h}&limit=${limit}&offset=${offset}` +
    (search ? `&search=${encodeURIComponent(search)}` : "") + scopeQS(),
  work: (h, id) => `/api/work/${encodeURIComponent(id)}?house=${h}` + scopeQS(),
  explain: (h, id) => `/api/explain?work_id=${encodeURIComponent(id)}&house=${h}` + scopeQS(),
  analytics: (h) => `/api/analytics?house=${h}${scopeQS()}`,
  geojson: () => `/geo/india_states.geojson`,
};

const LIMIT = 50;
const COLORS = { HIGH: "#ef4444", MEDIUM: "#f59e0b", LOW: "#22c55e", accent: "#38bdf8" };
const state = {
  house: "all",
  lists: {
    anomalies: { offset: 0, total: 0, search: "" },
    duplicates: { offset: 0, total: 0, search: "" },
    delays: { offset: 0, total: 0, search: "" },
  },
};
const charts = {};

const $ = (s) => document.querySelector(s);
const fmt = (n) => {
  if (n === null || n === undefined || (typeof n === "number" && isNaN(n))) return "—";
  if (typeof n === "number") return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return n;
};
const money = (n) => {
  if (n === null || n === undefined || (typeof n === "number" && isNaN(n))) return "—";
  if (n >= 1e7) return "₹" + (n / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 1 }) + " Cr";
  if (n >= 1e5) return "₹" + (n / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 1 }) + " L";
  return "₹" + n.toLocaleString("en-IN");
};

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

if (window.Chart) {
  Chart.defaults.color = "#94a3b8";
  Chart.defaults.borderColor = "#334155";
  Chart.defaults.font.family = "Segoe UI, system-ui, sans-serif";
  Chart.defaults.animation = { duration: 900, easing: "easeOutQuart" };
}

function drawChart(key, config) {
  if (!window.Chart) {
    const box = document.querySelector(config.canvas)?.closest(".chart-box");
    if (box) box.innerHTML = `<div class="explain-loading" style="color:#ef4444;padding:20px;text-align:center">Chart.js not loaded — showing data as bars below. Check internet for CDN.</div>`;
    console.warn("[drawChart] Chart.js not loaded for", key);
    return;
  }
  try {
    if (charts[key]) charts[key].destroy();
    const canvas = $(config.canvas);
    if (!canvas) { console.warn("[drawChart] canvas not found", config.canvas); return; }
    // ensure canvas has size before draw (fixes 0-height when tab just became visible)
    const box = canvas.closest(".chart-box");
    if (box && box.clientHeight < 50) { box.style.height = "240px"; box.style.minHeight = "240px"; }
    const opts = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 700 } }, config.options || {});
    charts[key] = new Chart(canvas, {
      type: config.type,
      data: config.data,
      options: opts,
    });
    requestAnimationFrame(()=> requestAnimationFrame(()=> { try{ charts[key].resize(); }catch(e){ console.warn(e); } }));
    console.log("[drawChart] OK", key);
  } catch (e) {
    console.error("[drawChart] failed", key, e);
    const box = document.querySelector(config.canvas)?.closest(".chart-box");
    if (box) box.innerHTML = `<div class="explain-loading" style="color:#ef4444">Chart error: ${e.message}</div>`;
  }
}

/* ---------------- Number count-up animation ---------------- */
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function animateCount(el, target, { duration = 1100, formatter = (v)=> fmt(v), start = 0 } = {}) {
  if (!el) return;
  const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced || target == null || isNaN(target) || target === 0) { el.textContent = formatter(target); el.classList.add("count-done"); return; }
  const t0 = performance.now();
  const delta = target - start;
  el.classList.remove("count-done");
  function step(now) {
    const p = Math.min(1, (now - t0) / duration);
    const e = easeOutCubic(p);
    const cur = start + delta * e;
    // for ints show integer, for floats keep fraction
    const display = target % 1 === 0 ? Math.round(cur) : cur;
    el.textContent = formatter(display);
    if (p < 1) requestAnimationFrame(step);
    else { el.textContent = formatter(target); el.classList.add("count-done"); }
  }
  requestAnimationFrame(step);
}
function animateMoney(el, target, duration = 1200) {
  if (!el || target == null || isNaN(target)) { if(el) el.textContent = money(target); return; }
  animateCount(el, target, { duration, formatter: (v)=> money(Math.round(v)) });
}

/* ---------------- Role metadata ---------------- */
const ROLES = [
  { key: "mospi", title: "MoSPI", icon: "🏛️", desc: "Full Access (All India)", scope: null, scope2: null, g1: "#38bdf8", g2: "#6366f1" },
  { key: "sna", title: "State Nodal Authority", icon: "🗺️", desc: "State-level only", scope: "state", scope2: null, g1: "#22c55e", g2: "#0ea5e9" },
  { key: "da", title: "District Authority", icon: "🏢", desc: "District-level only", scope: "state", scope2: "constituency", g1: "#f59e0b", g2: "#ef4444" },
  { key: "mp", title: "MP", icon: "🧑‍💼", desc: "Constituency-level only", scope: "state", scope2: "constituency", g1: "#a78bfa", g2: "#38bdf8" },
  { key: "public", title: "Public", icon: "👁️", desc: "Read-only (limited)", scope: null, scope2: null, g1: "#64748b", g2: "#94a3b8" },
];

function scope2Label(kind) {
  return kind === "district" ? "District" : "Constituency";
}

function badgeText() {
  if (session.role === "sna") return `SNA · State: ${session.state}`;
  if (session.role === "da") {
    if (session.constituencies && session.constituencies.length) {
      const n = session.constituencies.length;
      const preview = n <= 2 ? session.constituencies.join(", ") : `${session.constituencies.slice(0,2).join(", ")} +${n-2} more`;
      return `DA · ${session.state} · ${n} Constituenc${n===1?"y":"ies"}: ${preview}`;
    }
    if (session.constituency) return `DA · ${session.state} · Constituency: ${session.constituency}`;
    return `DA · ${session.state} · All constituencies`;
  }
  if (session.role === "mp") return `MP · ${session.state} · Constituency: ${session.constituency}`;
  if (session.role === "public") return "Public · Read-only";
  return "MoSPI · All India";
}
function overviewSub() {
  if (session.role === "mospi") return "Portfolio-wide risk posture across both Houses of Parliament";
  if (session.role === "sna") return `Risk posture for state: ${session.state} (all constituencies)`;
  if (session.role === "da") {
    if (session.constituencies && session.constituencies.length) {
      return `Risk posture for ${session.constituencies.length} constituenc${session.constituencies.length===1?'y':'ies'} in ${session.state}`;
    }
    return `Risk posture for state: ${session.state} — all constituencies (District Authority)`;
  }
  if (session.role === "mp") return `Risk posture for constituency: ${session.constituency} (${session.state}) — single constituency only`;
  if (session.role === "public") return "Limited read-only overview (aggregates only)";
  return "";
}

function applyRoleUI() {
  const isMospi = session.role === "mospi";
  const isPublic = session.role === "public";
  // Only MoSPI sees House selector; others are scoped to their mandate
  $("#houseWrap").style.display = isMospi ? "" : "none";
  const badge = $("#scopeBadge");
  if (isMospi) {
    badge.style.display = "none";
  } else {
    badge.style.display = "";
    badge.textContent = badgeText();
  }
  $("#logout").style.display = "";
  document.querySelectorAll(".tab-detail").forEach((t) => (t.style.display = isPublic ? "none" : ""));
  $("#overviewSub").textContent = overviewSub();
  // hide/show house-specific note: for MP, data comes from Lok only; for DA/SNA show aggregated
}

function doLogin(role, st, con, cons, dist) {
  session.role = role;
  session.state = st;
  // con is single for MP, cons is array for DA
  if (role === "da") {
    session.constituencies = cons && cons.length ? cons : null;
    session.constituency = null;
  } else {
    session.constituency = con || null;
    session.constituencies = null;
  }
  session.district = dist || null;
  state.house = role === "mp" ? "lok" : "all"; // MP is constituency-bound -> Lok Sabha only
  document.body.classList.remove("locked");
  applyRoleUI();
  switchPage("overview");
  reloadAll();
}

function logout() {
  session.role = null;
  session.state = null;
  session.constituency = null;
  session.constituencies = null;
  session.district = null;
  document.body.classList.add("locked");
  renderLogin();
}

async function renderLogin() {
  const grid = $("#loginGrid");
  // Render instantly — no await before first paint (fixes "something for few sec" flash)
  grid.innerHTML = ROLES.map((r) => {
    let stateSel = "";
    let depSel = "";
    let note = "";
    if (r.scope === "state") {
      stateSel = `<select class="login-sel" id="st-${r.key}"><option value="">Loading states…</option></select>`;
      if (r.scope2) {
        if (r.key === "da") {
          // DA: MANUAL multi-constituency picker – no "All" default, user picks what they want
          depSel = `<div class="login-dep-wrap" id="wrap-${r.key}" style="display:none">
            <div class="scope-note" style="margin:6px 0 4px;display:flex;justify-content:space-between;align-items:center">
              <span>Pick constituencies — tick 1 or more</span>
              <span style="display:flex;gap:6px">
                <button type="button" class="link" id="selAll-${r.key}" style="font-size:11px;padding:2px 6px">Select all</button>
                <button type="button" class="link" id="clrAll-${r.key}" style="font-size:11px;padding:2px 6px">Clear</button>
              </span>
            </div>
            <div class="login-multi" id="dep-${r.key}" style="max-height:140px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:6px;background:var(--panel-2);font-size:13px">
              <span class="muted">Select a state first…</span>
            </div>
            <div id="cnt-${r.key}" class="login-count" style="margin-top:4px"></div>
            <p class="scope-note" style="margin-top:2px;color:#f59e0b !important">You must select at least one constituency</p>
          </div>`;
          note = `<p class="scope-note">District Authority: one State → hand-picked Constituencies (multi-select)</p>`;
        } else {
          const lbl = scope2Label(r.scope2);
          depSel = `<select class="login-sel" id="dep-${r.key}" disabled><option value="">Select ${lbl}…</option></select>`;
          note = `<p class="scope-note">MP: State → Single Constituency only</p>`;
        }
      }
    }
    return `<div class="login-role" id="card-${r.key}">
      <div class="login-role-icon" style="--g1:${r.g1};--g2:${r.g2}">${r.icon}</div>
      <div class="login-role-body"><h3>${r.title}</h3><p>${r.desc}</p>${stateSel}${depSel}${note}</div>
      <button class="login-role-btn" data-role="${r.key}">Login</button>
    </div>`;
  }).join("");
  grid.insertAdjacentHTML("afterend", `<button id="loginReset" class="login-reset">✕ Clear selection — show all logins</button>`);

  // Fill state options in background — keeps login instantly visible (no "something for few sec")
  getJSON(API.filters()).then(filters => {
    ROLES.forEach(r => {
      const st = document.getElementById(`st-${r.key}`);
      if (st && r.scope === "state") {
        const prev = st.value;
        st.innerHTML = `<option value="">Select State…</option>` + (filters.states||[]).map(s=>`<option>${s}</option>`).join("");
        if (prev) st.value = prev;
      }
    });
  }).catch(()=> {
    ROLES.forEach(r => {
      const st = document.getElementById(`st-${r.key}`);
      if (st && r.scope==="state") st.innerHTML = `<option value="">Failed to load states</option>`;
    });
  });

  const loginReset = $("#loginReset");
  const updateExclusive = () => {
    // if any state/con has value, dim the rest
    let activeKey = null;
    ROLES.forEach((r) => {
      const st = $(`#st-${r.key}`);
      const depSingle = $(`#dep-${r.key}`);
      let hasVal = false;
      if (st && st.value) hasVal = true;
      if (r.key === "da") {
        const box = $(`#dep-${r.key}`);
        const anyChecked = box && [...box.querySelectorAll('input[type="checkbox"]:checked')].length > 0;
        if (anyChecked) hasVal = true;
      } else if (depSingle && depSingle.tagName === "SELECT" && depSingle.value) hasVal = true;
      if (hasVal) activeKey = r.key;
    });
    // prioritize last interacted – scan and last wins
    const cards = [...document.querySelectorAll(".login-role")];
    if (activeKey) {
      cards.forEach((c) => {
        const k = c.id.replace("card-","");
        if (k === activeKey) { c.classList.add("login-active"); c.classList.remove("login-dimmed"); }
        else { c.classList.add("login-dimmed"); c.classList.remove("login-active"); }
      });
      loginReset.classList.add("show");
    } else {
      cards.forEach((c) => c.classList.remove("login-dimmed","login-active"));
      loginReset.classList.remove("show");
    }
  };
  loginReset.addEventListener("click", () => {
    ROLES.forEach((r) => {
      const st = $(`#st-${r.key}`); if (st) { st.value = ""; st.classList.remove("invalid"); }
      if (r.key === "da") {
        const wrap = $(`#wrap-${r.key}`); if (wrap) wrap.style.display = "none";
        const box = $(`#dep-${r.key}`); if (box) { box.innerHTML = `<span class="muted">Select a state first…</span>`; box.classList.remove("invalid"); }
        const cnt = $(`#cnt-${r.key}`); if (cnt) cnt.textContent = "";
      } else {
        const dep = $(`#dep-${r.key}`); if (dep) { dep.innerHTML = `<option value="">Select ${scope2Label(r.scope2)}…</option>`; dep.disabled = true; dep.classList.remove("invalid"); }
      }
    });
    updateExclusive();
  });

  // Cascade: populate district/constituency after a state is chosen
  ROLES.forEach((r) => {
    if (!r.scope2) {
      // mospi/public – clicking select should also trigger exclusive (no select to dim, but login btn will)
      return;
    }
    const st = $(`#st-${r.key}`);
    if (r.key === "da") {
      const wrap = $(`#wrap-${r.key}`);
      const box = $(`#dep-${r.key}`);
      const cnt = $(`#cnt-${r.key}`);
      const selAll = $(`#selAll-${r.key}`);
      const clrAll = $(`#clrAll-${r.key}`);
      const refreshCount = () => {
        const n = box.querySelectorAll('input[type="checkbox"]:checked').length;
        const total = box.querySelectorAll('input[type="checkbox"]').length;
        cnt.textContent = n ? `${n} selected / ${total}` : "";
        if (n) box.classList.remove("invalid");
        updateExclusive();
      };
      st.addEventListener("change", async () => {
        st.classList.remove("invalid");
        if (!st.value) {
          wrap.style.display = "none";
          box.innerHTML = `<span class="muted">Select a state first…</span>`;
          cnt.textContent = "";
          updateExclusive();
          return;
        }
        updateExclusive();
        wrap.style.display = "";
        box.innerHTML = `<span class="muted">Loading…</span>`;
        cnt.textContent = "";
        try {
          const f = await getJSON(API.filters(st.value));
          const opts = f.constituencies || [];
          if (!opts.length) {
            box.innerHTML = `<span class="muted">No constituency data</span>`;
          } else {
            box.innerHTML = opts.map((o) => `<label style="display:flex;gap:6px;align-items:center;padding:2px 0;cursor:pointer"><input type="checkbox" value="${o}" /> ${o}</label>`).join("");
            box.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.addEventListener("change", refreshCount));
          }
        } catch (e) {
          box.innerHTML = `<span class="muted">Error loading</span>`;
        }
      });
      st.addEventListener("click", updateExclusive);
      selAll.addEventListener("click", () => { box.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = true)); refreshCount(); });
      clrAll.addEventListener("click", () => { box.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = false)); refreshCount(); });
    } else {
      const dep = $(`#dep-${r.key}`);
      const lbl = scope2Label(r.scope2);
      st.addEventListener("change", async () => {
        st.classList.remove("invalid");
        if (dep) dep.classList.remove("invalid");
        if (!st.value) {
          dep.disabled = true;
          dep.innerHTML = `<option value="">Select ${lbl}…</option>`;
          updateExclusive();
          return;
        }
        updateExclusive();
        dep.disabled = true;
        dep.innerHTML = `<option value="">Loading…</option>`;
        try {
          const f = await getJSON(API.filters(st.value));
          const opts = r.scope2 === "district" ? f.districts : f.constituencies;
          if (!opts.length) {
            dep.innerHTML = `<option value="">No ${lbl} data — State only</option>`;
          } else {
            dep.disabled = false;
            dep.innerHTML = `<option value="">Select ${lbl}…</option>` + opts.map((o) => `<option>${o}</option>`).join("");
          }
        } catch (e) {
          dep.innerHTML = `<option value="">Error loading</option>`;
        }
      });
      st.addEventListener("click", updateExclusive);
      if (dep) {
        dep.addEventListener("change", () => { dep.classList.remove("invalid"); updateExclusive(); });
        dep.addEventListener("click", updateExclusive);
      }
    }
  });

  grid.querySelectorAll(".login-role-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const key = b.dataset.role;
      const role = ROLES.find((x) => x.key === key);
      const st = $(`#st-${key}`);
      let stateVal = null;
      let conVal = null;
      let consVal = null;
      let distVal = null;
      if (role.scope === "state") {
        if (!st || !st.value) {
          if (st) st.classList.add("invalid");
          st?.focus();
          return;
        }
        stateVal = st.value;
      }
      if (role.scope2 === "constituency") {
        if (role.key === "mp") {
          const dep = $(`#dep-${key}`);
          if (!dep || !dep.value) {
            if (dep) dep.classList.add("invalid");
            dep?.focus();
            return;
          }
          conVal = dep.value;
        } else if (role.key === "da") {
          // DA: MUST pick at least one – no "All" fallback
          const box = $(`#dep-${key}`);
          const checked = [...(box?.querySelectorAll('input[type="checkbox"]:checked') || [])].map((cb) => cb.value);
          if (!checked.length) {
            box.classList.add("invalid");
            box.scrollIntoView({ behavior: "smooth", block: "nearest" });
            return;
          }
          consVal = checked;
        }
      }
      if (role.scope2 === "district") {
        const dep = $(`#dep-${key}`);
        distVal = dep && dep.value ? dep.value : null;
      }
      // roles without scope (mospi/public) go straight through
      if (role.key === "da") doLogin(key, stateVal, null, consVal, distVal);
      else doLogin(key, stateVal, conVal, null, distVal);
    })
  );
}

/* ---------------- Navigation ---------------- */
function switchPage(page) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.page === page));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${page}`));
  if (page === "map") setTimeout(()=> loadMap(), 80);
  if (page === "analytics") setTimeout(()=> { console.log("[switchPage] loading analytics"); loadAnalytics(); }, 80);
}

/* ---------------- Overview ---------------- */
async function loadOverview() {
  const [cur, lok, rajya, states, analytics] = await Promise.all([
    getJSON(API.summary(state.house)),
    getJSON(API.summary("lok")),
    getJSON(API.summary("rajya")),
    getJSON(API.statewise(state.house)),
    getJSON(API.analytics(state.house)),
  ]);
  renderHero(cur);
  renderStatCards(cur, lok, rajya);
  renderStatewise(states);
  renderOverviewCharts(analytics.risk_breakdown || {}, cur);
}

function renderHero(s) {
  animateCount($("#heroWorks"), s.total_works || 0, { duration: 1000, formatter: (v)=> fmt(Math.round(v)) });
  animateCount($("#heroAnom"), s.anomalies || 0, { duration: 1100, formatter: (v)=> fmt(Math.round(v)) });
  animateCount($("#heroDup"), s.duplicates || 0, { duration: 1200, formatter: (v)=> fmt(Math.round(v)) });
}

function splitLine(lok, rajya) {
  if (session.role === "all" || session.role === "mospi" || session.role === "public" || !session.role) {
    return `${fmt(lok.total_works)} Lok · ${fmt(rajya.total_works)} Rajya`;
  }
  return (session.role === "lok" ? "Lok Sabha" : "Rajya Sabha") + " only";
}

function renderStatCards(cur, lok, rajya) {
  const total = cur.total_works || 1;
  const pct = ((cur.anomalies || 0) / total * 100).toFixed(1);
  const cards = [
    { id:"sc-works", label: "Total Works Tracked", value: cur.total_works, fmt:"int", cls: "accent", sub: splitLine(lok, rajya) },
    { id:"sc-anom", label: "Anomalies Detected", value: cur.anomalies, fmt:"int", sub: `${pct}% of works flagged` },
    { id:"sc-dup", label: "Possible Duplicate Works", value: cur.duplicates, fmt:"int", sub: "possible duplicate entries" },
    { id:"sc-delay", label: "Delayed Beyond 365 Days", value: cur.delayed, fmt:"int", sub: "beyond 365-day SLA" },
    {
      id:"sc-comp", label: "Average Compliance Score",
      value: cur.avg_compliance_score, fmt:"float1",
      sub: "mean compliance score",
    },
    { id:"sc-funds", label: "Funds Disbursed", value: cur.total_disbursed, fmt:"money", sub: `of ${money(cur.total_sanction)} sanctioned`, subMoney: cur.total_sanction },
  ];
  $("#summary").innerHTML = cards
    .map(
      (c) =>
        `<div class="card" style="animation-delay:${0.06 + Math.random()*0.04}s"><div class="label">${c.label}</div>
         <div class="value ${c.cls || ""}" id="${c.id}">—</div>
         <div class="card-sub" id="${c.id}-sub">${c.sub}</div></div>`
    )
    .join("");
  // stagger count-ups
  setTimeout(()=> animateCount(document.getElementById("sc-works"), cur.total_works||0, {duration:1000, formatter:(v)=>fmt(Math.round(v))}), 80);
  setTimeout(()=> animateCount(document.getElementById("sc-anom"), cur.anomalies||0, {duration:1100, formatter:(v)=>fmt(Math.round(v))}), 180);
  setTimeout(()=> animateCount(document.getElementById("sc-dup"), cur.duplicates||0, {duration:1150, formatter:(v)=>fmt(Math.round(v))}), 260);
  setTimeout(()=> animateCount(document.getElementById("sc-delay"), cur.delayed||0, {duration:1000, formatter:(v)=>fmt(Math.round(v))}), 320);
  setTimeout(()=> {
    const el=document.getElementById("sc-comp");
    if(cur.avg_compliance_score!=null) animateCount(el, cur.avg_compliance_score, {duration:1200, formatter:(v)=> Number(v).toFixed(1), start: 0});
    else if(el) el.textContent="—";
  }, 360);
  setTimeout(()=> {
    const el=document.getElementById("sc-funds");
    if(el) animateMoney(el, cur.total_disbursed||0, 1300);
    const sub=document.getElementById("sc-funds-sub");
    if(sub) sub.innerHTML = `of <span class="count-target">${money(cur.total_sanction)}</span> sanctioned`;
  }, 420);
}

function showChartDistribution(title, rows) {
  const modal = document.getElementById("modal");
  const body = document.getElementById("modalBody");
  if (!modal || !body) return;
  modal.classList.remove("hidden");
  const htmlRows = rows.map(([k,v])=> `<tr><td style="font-weight:700">${k}</td><td>${v}</td></tr>`).join("");
  body.innerHTML = `<div class="dash-detail"><h2>${title}</h2><table class="dash-table"><tbody>${htmlRows}</tbody></table><div class="dash-foot"><button class="logout-btn" onclick="document.getElementById('modal').classList.add('hidden')" style="flex:1">Close</button></div></div>`;
}

function renderOverviewCharts(rb, summary) {
  if (!window.Chart) return;
  const risk = { HIGH: rb.HIGH || 0, MEDIUM: rb.MEDIUM || 0, LOW: rb.LOW || 0 };
  const totalR = (risk.HIGH+risk.MEDIUM+risk.LOW) || 1;
  // write distribution below chart
  const riskDistEl = document.getElementById("riskOvDist");
  if (riskDistEl) riskDistEl.innerHTML = `<span class="badge HIGH">High ${fmt(risk.HIGH)} (${((risk.HIGH/totalR)*100).toFixed(1)}%)</span> <span class="badge MEDIUM">Medium ${fmt(risk.MEDIUM)} (${((risk.MEDIUM/totalR)*100).toFixed(1)}%)</span> <span class="badge LOW">Low ${fmt(risk.LOW)} (${((risk.LOW/totalR)*100).toFixed(1)}%)</span>`;
  drawChart("riskOv", {
    canvas: "#cRiskOv",
    type: "doughnut",
    data: {
      labels: ["High", "Medium", "Low"],
      datasets: [{ data: [risk.HIGH, risk.MEDIUM, risk.LOW], backgroundColor: [COLORS.HIGH, COLORS.MEDIUM, COLORS.LOW], borderColor: "#1e293b" }],
    },
    options: {
      onClick: (evt, els) => {
        if (!els.length) return showChartDistribution("Risk Distribution — All 97,182 works", [
          ["High", `${fmt(risk.HIGH)} (${((risk.HIGH/totalR)*100).toFixed(1)}%)`],
          ["Medium", `${fmt(risk.MEDIUM)} (${((risk.MEDIUM/totalR)*100).toFixed(1)}%)`],
          ["Low", `${fmt(risk.LOW)} (${((risk.LOW/totalR)*100).toFixed(1)}%)`],
          ["Total", fmt(totalR)],
        ]);
        const idx = els[0].index;
        const label = ["High","Medium","Low"][idx];
        const val = [risk.HIGH, risk.MEDIUM, risk.LOW][idx];
        showChartDistribution(`Risk Distribution — ${label}`, [[label, `${fmt(val)} (${((val/totalR)*100).toFixed(1)}%)`],["Total", fmt(totalR)],["Scope", badgeText ? badgeText() : session.role]]);
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          backgroundColor:"rgba(15,23,42,0.92)", titleColor:"#e2e8f0", bodyColor:"#cbd5e1", borderColor:"#334155", borderWidth:1, padding:10,
          callbacks: { label: (ctx)=> ` ${ctx.label}: ${fmt(ctx.parsed)} (${((ctx.parsed/totalR)*100).toFixed(1)}%)` }
        }
      }
    },
  });

  const flagged = summary.anomalies || 0;
  const clean = Math.max(0, (summary.total_works || 0) - flagged);
  const totalI = (flagged+clean) || 1;
  const integDistEl = document.getElementById("integrityDist");
  if (integDistEl) integDistEl.innerHTML = `<span class="badge yes">Flagged ${fmt(flagged)} (${((flagged/totalI)*100).toFixed(1)}%)</span> <span class="badge no">Clean ${fmt(clean)} (${((clean/totalI)*100).toFixed(1)}%)</span>`;
  drawChart("integrity", {
    canvas: "#cIntegrity",
    type: "doughnut",
    data: {
      labels: ["Flagged", "Clean"],
      datasets: [{ data: [flagged, clean], backgroundColor: ["#ef4444", "#22c55e"], borderColor: "#1e293b" }],
    },
    options: {
      onClick: (evt, els) => {
        if (!els.length) return showChartDistribution("Integrity Breakdown", [["Flagged", `${fmt(flagged)} (${((flagged/totalI)*100).toFixed(1)}%)`],["Clean", `${fmt(clean)} (${((clean/totalI)*100).toFixed(1)}%)`]]);
        const idx = els[0].index;
        const label = ["Flagged","Clean"][idx];
        const val = [flagged, clean][idx];
        showChartDistribution(`Integrity — ${label}`, [[label, `${fmt(val)} (${((val/totalI)*100).toFixed(1)}%)`],["Total", fmt(totalI)]]);
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          backgroundColor:"rgba(15,23,42,0.92)", titleColor:"#e2e8f0", bodyColor:"#cbd5e1", borderColor:"#334155", borderWidth:1, padding:10,
          callbacks: { label: (ctx)=> ` ${ctx.label}: ${fmt(ctx.parsed)} (${((ctx.parsed/totalI)*100).toFixed(1)}%)` }
        }
      }
    },
  });
}

function renderStatewise(rows) {
  // Show ALL states ranked most → least (by Risk_Rate_%, not just top 10)
  let list = [...(rows || [])];
  list = list.sort((a,b)=>
    ((b["Risk_Rate_%"]||0) - (a["Risk_Rate_%"]||0)) ||
    ((b["High_Risk_%"]||0) - (a["High_Risk_%"]||0)) ||
    ((b.Total_Works||0) - (a.Total_Works||0))
  );
  const head = document.querySelector("#stateTable thead tr");
  if (head) {
    if (session.role === "mp") head.innerHTML = `<th>#</th><th>State / UT</th><th>Works (your constituency)</th><th>Risk Rate %</th><th>High %</th><th>Medium %</th><th>Avg Risk</th>`;
    else if (session.role === "da" && session.constituencies && session.constituencies.length) head.innerHTML = `<th>#</th><th>State / UT</th><th>Works (selected ${session.constituencies.length})</th><th>Risk Rate %</th><th>High %</th><th>Medium %</th><th>Avg Risk</th>`;
    else head.innerHTML = `<th>#</th><th>State / UT</th><th>Works</th><th>Risk Rate %</th><th>High %</th><th>Medium %</th><th>Avg Risk</th>`;
  }
  const colCount = 7;
  $("#stateTable tbody").innerHTML =
    list
      .map(
        (r, idx) => `<tr><td>${idx+1}</td><td style="font-weight:700">${r.State || "—"}</td><td>${fmt(r.Total_Works)}</td>
        <td style="font-weight:800;color:${r["Risk_Rate_%"]>20?'#ef4444':r["Risk_Rate_%"]>10?'#f59e0b':'#22c55e'}">${r["Risk_Rate_%"] != null ? r["Risk_Rate_%"] + "%" : "—"}</td>
        <td>${r["High_Risk_%"] != null ? r["High_Risk_%"] + "%" : "—"}</td>
        <td>${r["Medium_Risk_%"] != null ? r["Medium_Risk_%"] + "%" : "—"}</td>
        <td>${r.Avg_Risk_Score != null ? r.Avg_Risk_Score : "—"}</td></tr>`
      )
      .join("") || `<tr><td colspan="${colCount}">No data in scope</td></tr>`;
}

/* ---------------- Generic list (Anomalies / Duplicates / Delays) ---------------- */
const LIST_CFG = {
  anomalies: {
    api: API.anomalies,
    table: "#anomTable",
    prev: "#anomPrev",
    next: "#anomNext",
    page: "#anomPage",
    search: "#anomSearch",
    cols: (r) => [
      r["Work ID"], r["Work"], r["State"], r["Vendor Name"],
      fmt(r["Sanction Amount ( ₹ )"]), r["anomaly_score"] != null ? r["anomaly_score"].toFixed(2) : "—",
      (r["Anomaly Reason"] || "—").slice(0, 60),
    ],
  },
  duplicates: {
    api: API.duplicates,
    table: "#dupTable",
    prev: "#dupPrev",
    next: "#dupNext",
    page: "#dupPage",
    search: "#dupSearch",
    cols: (r) => [
      r["Work ID"], r["Work"], r["Constituency"], r["State"], r["Vendor Name"],
      fmt(r["Sanction Amount ( ₹ )"]), r["compliance_score"] != null ? r["compliance_score"].toFixed(0) : "—",
    ],
  },
  delays: {
    api: API.delays,
    table: "#delayTable",
    prev: "#delayPrev",
    next: "#delayNext",
    page: "#delayPage",
    search: "#delaySearch",
    cols: (r) => [
      r["Work ID"], r["Work"], r["State"], r["Vendor Name"],
      r["duration_days"] != null ? r["duration_days"] : "—",
      r["delay_days"] != null ? r["delay_days"] : "—",
      r["compliance_score"] != null ? r["compliance_score"].toFixed(0) : "—",
    ],
  },
};

async function loadList(name) {
  const cfg = LIST_CFG[name];
  const ls = state.lists[name];
  const data = await getJSON(cfg.api(state.house, ls.search, LIMIT, ls.offset));
  ls.total = data.total || 0;
  const showDetails = session.role !== "public";
  const body = (data.records || [])
    .map(
      (r) =>
        `<tr>${cfg.cols(r).map((c) => `<td>${c ?? "—"}</td>`).join("")}
        <td>${showDetails ? `<button class="link" data-id="${r["Work ID"]}">Details</button>` : "—"}</td></tr>`
    )
    .join("");
  $(cfg.table + " tbody").innerHTML = body || `<tr><td colspan="8">No records found</td></tr>`;
  if (showDetails) {
    $(cfg.table + " tbody")
      .querySelectorAll(".link")
      .forEach((b) => b.addEventListener("click", () => openWork(b.dataset.id)));
  }
  const page = Math.floor(ls.offset / LIMIT) + 1;
  $(cfg.page).textContent = `Page ${page} (${fmt(ls.total)} total)`;
  $(cfg.prev).disabled = ls.offset <= 0;
  $(cfg.next).disabled = ls.offset + LIMIT >= ls.total;
}

/* ---------------- State Map (house images + ranked side panel) ---------------- */
let _mapCache = { house: null, data: null };
async function loadMap() {
  const view = $("#mapView");
  const title = $("#mapTitle");
  const sub = $("#mapSub");
  const rankingEl = $("#mapRanking");
  const detailEl = $("#mapDetail");
  const toggle = $("#mapHouseToggle");
  const LOK = `<figure class="map-fig"><img src="assets/lok_sabha.png" alt="Lok Sabha" loading="lazy" />
      <figcaption>Lok Sabha</figcaption></figure>`;
  const RAJYA = `<figure class="map-fig"><img src="assets/rajya_sabha.jpeg" alt="Rajya Sabha" loading="lazy" />
      <figcaption>Rajya Sabha</figcaption></figure>`;

  // house toggle UI
  if (toggle) {
    toggle.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.house === state.house);
      b.onclick = () => {
        if (state.house === b.dataset.house) return;
        state.house = b.dataset.house;
        // also sync topbar select if visible
        const sel = $("#house");
        if (sel) sel.value = state.house;
        loadMap();
        // refresh overview as well to keep consistent house filter
        loadOverview().catch(()=>{});
      };
    });
  }

  // image area – combination vs single
  if (state.house === "all" && session.role === "mospi") {
    title.textContent = "State Map — Lok Sabha & Rajya Sabha (Combined)";
    if (sub) sub.textContent = "All houses combined — ranking shows every state’s high-risk % (most → least). Click a state for details.";
    view.innerHTML = `<div class="map-pair">${LOK}${RAJYA}</div>`;
  } else if (state.house === "lok" && session.role === "mospi") {
    title.textContent = "State Map — Lok Sabha";
    if (sub) sub.textContent = "Lok Sabha only — ranking filtered to Lok data. All-India combined view is ‘All’.";
    view.innerHTML = `<div class="map-single">${LOK}</div>`;
  } else if (state.house === "rajya" && session.role === "mospi") {
    title.textContent = "State Map — Rajya Sabha";
    if (sub) sub.textContent = "Rajya Sabha only — ranking filtered to Rajya data.";
    view.innerHTML = `<div class="map-single">${RAJYA}</div>`;
  } else {
    let label = "your scope";
    if (session.role === "sna") label = session.state + " (all constituencies)";
    else if (session.role === "da") {
      if (session.constituencies && session.constituencies.length) label = `${session.state} — ${session.constituencies.length} constituency(ies): ${session.constituencies.slice(0,3).join(", ")}${session.constituencies.length>3?' …':''}`;
      else label = `${session.state} — All constituencies (District Authority)`;
    } else if (session.role === "mp") label = `${session.constituency} (${session.state}) — Lok Sabha only`;
    else if (session.role === "public") label = "Public — read-only";
    else label = state.house === "all" ? "All houses combined" : state.house === "lok" ? "Lok Sabha" : "Rajya Sabha";
    title.textContent = `State Map — ${label}`;
    if (sub) sub.textContent = state.house === "all"
      ? "Combined Lok + Rajya — ranking shows your scoped states (most → least high-risk). Use the All/Lok/Rajya pills to switch."
      : `Filtered to ${state.house === "lok" ? "Lok Sabha" : "Rajya Sabha"} — click a state for rank & breakdown.`;
    view.innerHTML = `<div class="map-single">${LOK}${RAJYA}</div>`;
  }

  // ranked side panel – fetch statewise for selected house (scope-aware, same as overview)
  if (!rankingEl) return;
  rankingEl.innerHTML = `<div class="explain-loading" style="padding:12px">Loading ranking…</div>`;
  if (detailEl) detailEl.classList.add("hidden");
  try {
    let data = await getJSON(API.statewise(state.house));
    // backend sorts by High_Risk_% only (which is 0 for this dataset) -> re-sort by real risk for meaningful rank
    data = [...data].sort((a,b)=>
      ((b["Risk_Rate_%"]||0) - (a["Risk_Rate_%"]||0)) ||
      ((b["High_Risk_%"]||0) - (a["High_Risk_%"]||0)) ||
      ((b["Medium_Risk_%"]||0) - (a["Medium_Risk_%"]||0)) ||
      ((b.Total_Works||0) - (a.Total_Works||0))
    );
    _mapCache = { house: state.house, data };
    if (!data || !data.length) {
      rankingEl.innerHTML = `<div class="explain-loading" style="padding:12px">No state data in this scope / house.</div>`;
      return;
    }
    const maxPct = Math.max(...data.map((d)=> (d["Risk_Rate_%"] ?? d["High_Risk_%"] ?? 0)), 1);
    rankingEl.innerHTML = data.map((r, idx) => {
      const rank = idx + 1;
      const pct = r["Risk_Rate_%"] ?? r["High_Risk_%"] ?? 0;
      const highPct = r["High_Risk_%"] ?? 0;
      const bar = Math.max(4, (pct / maxPct) * 100);
      const works = r.Total_Works ?? r.total_works ?? 0;
      const avg = r.Avg_Risk_Score ?? r.avg_risk ?? "—";
      return `<div class="map-rank-row" data-state="${r.State}">
        <div class="map-rank-num">${rank}</div>
        <div class="map-rank-main">
          <div class="map-rank-state">${r.State}</div>
          <div class="map-rank-meta"><span>${fmt(works)} works</span><span>Avg ${avg}</span><span>${r["Medium_Risk_%"] ?? 0}% med</span></div>
          <div class="map-rank-bar"><div class="map-rank-fill" style="width:${bar}%"></div></div>
        </div>
        <div class="map-rank-right"><div class="map-rank-pct">${pct}%</div><div class="map-rank-works">${highPct}% high</div></div>
      </div>`;
    }).join("");

    rankingEl.querySelectorAll(".map-rank-row").forEach((row) => {
      row.addEventListener("click", () => {
        rankingEl.querySelectorAll(".map-rank-row").forEach((x)=> x.classList.remove("active"));
        row.classList.add("active");
        const stateName = row.dataset.state;
        const rec = data.find((d)=> d.State === stateName);
        if (!rec || !detailEl) return;
        const rank = data.indexOf(rec) + 1;
        detailEl.classList.remove("hidden");
        detailEl.innerHTML = `
          <h4><span style="background:var(--accent);color:#0f172a;border-radius:999px;padding:2px 8px;font-size:12px">#${rank}</span> ${rec.State} — ${state.house === "all" ? "Lok+Rajya combined" : state.house === "lok" ? "Lok Sabha" : "Rajya Sabha"} <span class="muted" style="font-weight:400">click another state to compare</span></h4>
          <div class="map-detail-grid">
            <div class="map-kv"><div class="k">Rank (high-risk %)</div><div class="v">#${rank} / ${data.length}</div></div>
            <div class="map-kv"><div class="k">High-risk %</div><div class="v" style="color:var(--high)">${rec["High_Risk_%"] ?? "—"}%</div></div>
            <div class="map-kv"><div class="k">Total Works</div><div class="v">${fmt(rec.Total_Works)}</div></div>
            <div class="map-kv"><div class="k">High / Medium / Low</div><div class="v">${fmt(rec.HIGH)} / ${fmt(rec.MEDIUM)} / ${fmt(rec.LOW)}</div></div>
            <div class="map-kv"><div class="k">Avg Risk Score</div><div class="v">${rec.Avg_Risk_Score ?? "—"}</div></div>
            <div class="map-kv"><div class="k">Risk Rate % (High+Med)</div><div class="v">${rec["Risk_Rate_%"] ?? "—"}%</div></div>
          </div>
          <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap">
            <span class="dash-badge ${state.house==="lok"?"mp":state.house==="rajya"?"state":"full"}">${state.house==="all"?"Combined":state.house==="lok"?"Lok Sabha":"Rajya Sabha"}</span>
            <span class="muted" style="font-size:12px">Sorted most → least High %. Scope: ${badgeText ? badgeText() : session.role}</span>
          </div>`;
        detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  } catch (e) {
    rankingEl.innerHTML = `<div class="explain-loading" style="padding:12px;color:#ef4444">Failed to load ranking: ${e.message}</div>`;
  }
}

/* ---------------- Analytics (Chart.js) ---------------- */
async function loadAnalytics() {
  const analyticsPage = document.getElementById("page-analytics");
  if (!window.Chart) {
    if (analyticsPage) analyticsPage.insertAdjacentHTML("afterbegin", `<div class="explain-loading" style="color:#ef4444;padding:12px;border:1px solid #ef4444;border-radius:8px;margin-bottom:12px">Charts unavailable — Chart.js not loaded. Check internet or <code>/chart.umd.min.js</code> (local fallback). Dist data below still shows.</div>`);
    // still try to show dist even without charts
  }
  let a;
  try {
    a = await getJSON(API.analytics(state.house));
  } catch (e) {
    if (analyticsPage) analyticsPage.insertAdjacentHTML("afterbegin", `<div class="explain-loading" style="color:#ef4444">Failed to load analytics data: ${e.message}</div>`);
    return;
  }
  // debug visible so user can see if data arrived
  console.log("[Analytics] data", a);

  const rb = a.risk_breakdown || {};
  const totalRisk = (rb.HIGH||0)+(rb.MEDIUM||0)+(rb.LOW||0) || 1;
  const riskDistEl = document.getElementById("riskDist");
  if (riskDistEl) riskDistEl.innerHTML = `<span class="badge HIGH">High ${fmt(rb.HIGH||0)} (${((rb.HIGH||0)/totalRisk*100).toFixed(1)}%)</span> <span class="badge MEDIUM">Medium ${fmt(rb.MEDIUM||0)} (${((rb.MEDIUM||0)/totalRisk*100).toFixed(1)}%)</span> <span class="badge LOW">Low ${fmt(rb.LOW||0)} (${((rb.LOW||0)/totalRisk*100).toFixed(1)}%)</span>`;
  drawChart("risk", {
    canvas: "#cRisk",
    type: "doughnut",
    data: {
      labels: ["High", "Medium", "Low"],
      datasets: [{ data: [rb.HIGH || 0, rb.MEDIUM || 0, rb.LOW || 0], backgroundColor: [COLORS.HIGH, COLORS.MEDIUM, COLORS.LOW], borderColor: "#1e293b" }],
    },
    options: {
      onClick: (evt, els) => {
        if (!els.length) return showChartDistribution("Risk Distribution — All", [["High", `${fmt(rb.HIGH||0)} (${((rb.HIGH||0)/totalRisk*100).toFixed(1)}%)`],["Medium", `${fmt(rb.MEDIUM||0)} (${((rb.MEDIUM||0)/totalRisk*100).toFixed(1)}%)`],["Low", `${fmt(rb.LOW||0)} (${((rb.LOW||0)/totalRisk*100).toFixed(1)}%)`],["Total", fmt(totalRisk)]]);
        const idx = els[0].index; const label=["High","Medium","Low"][idx]; const val=[rb.HIGH||0,rb.MEDIUM||0,rb.LOW||0][idx];
        showChartDistribution(`Risk — ${label}`, [[label, `${fmt(val)} (${((val/totalRisk)*100).toFixed(1)}%)`],["Total", fmt(totalRisk)]]);
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.92)", titleColor:"#e2e8f0", bodyColor:"#cbd5e1", borderColor:"#334155", borderWidth:1, padding:10,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed || 0;
              const pct = ((v/totalRisk)*100).toFixed(1);
              return ` ${ctx.label}: ${fmt(v)} (${pct}%)`;
            }
          }
        }
      }
    },
  });

  const tr = a.sanction_trend || [];
  const trendDistEl = document.getElementById("trendDist");
  if (trendDistEl && tr.length) {
    const totalS = tr.reduce((s,x)=>s+(x.sanction||0),0);
    const peak = tr.reduce((m,x)=> (x.sanction||0)>(m.sanction||0)?x:m, tr[0]);
    trendDistEl.innerHTML = `<span class="badge" style="background:rgba(56,189,248,0.15);color:#38bdf8">Total ${money(totalS)} over ${tr.length} months</span> <span class="muted">peak ${peak.month}: ${money(peak.sanction)}</span>`;
  }
  drawChart("trend", {
    canvas: "#cTrend",
    type: "line",
    data: {
      labels: tr.map((d) => d.month),
      datasets: [{ label: "Sanction", data: tr.map((d) => d.sanction), borderColor: COLORS.accent, tension: 0.3, fill: true, backgroundColor: "rgba(56,189,248,0.12)", pointRadius: 2, pointHoverRadius: 5 }],
    },
    options: {
      interaction: { intersect:false, mode:"index" },
      onClick: (evt, els) => {
        if (!els.length) return;
        const idx = els[0].index; const rec = tr[idx];
        if (!rec) return;
        showChartDistribution(`Sanction Trend — ${rec.month}`, [["Sanction", money(rec.sanction)],["Works", rec.count?fmt(rec.count):"—"],["Avg/work", rec.count?money((rec.sanction||0)/rec.count):"—"]]);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor:"rgba(15,23,42,0.92)", titleColor:"#e2e8f0", bodyColor:"#cbd5e1", borderColor:"#334155", borderWidth:1, padding:10,
          callbacks: {
            title: (items) => items[0].label + " — Sanction Trend",
            label: (ctx) => {
              const idx = ctx.dataIndex;
              const rec = tr[idx] || {};
              const sanction = rec.sanction || ctx.parsed.y;
              const count = rec.count ? ` • ${fmt(rec.count)} works` : "";
              return ` Sanction: ${money(sanction)}${count}`;
            },
            afterLabel: (ctx) => {
              const rec = tr[ctx.dataIndex] || {};
              if (rec.count) return ` Avg: ${money((rec.sanction||0)/(rec.count||1))}/work`;
              return "";
            }
          }
        }
      },
      scales: { y: { ticks: { callback: (v) => (v / 1e7).toFixed(1) + "Cr" } } }
    },
  });

  const fs = a.flagged_by_state || [];
  const flaggedDistEl = document.getElementById("flaggedDist");
  if (flaggedDistEl && fs.length) flaggedDistEl.innerHTML = fs.slice(0,3).map(d=> `<span class="badge HIGH">${d.state} ${fmt(d.flagged)}</span>`).join(" ") + ` <span class="muted">of ${fmt(fs.reduce((s,x)=>s+x.flagged,0))} flagged</span>`;
  drawChart("flagged", {
    canvas: "#cFlagged",
    type: "bar",
    data: { labels: fs.map((d) => d.state), datasets: [{ label: "Flagged", data: fs.map((d) => d.flagged), backgroundColor: COLORS.HIGH, borderRadius:4 }] },
    options: {
      indexAxis: "y",
      onClick: (evt, els) => {
        if (!els.length) return;
        const rec = fs[els[0].index];
        if (!rec) return;
        showChartDistribution(`Flagged — ${rec.state}`, [["Flagged works", fmt(rec.flagged)],["Share of flagged", `${(rec.flagged/(fs.reduce((s,x)=>s+x.flagged,0)||1)*100).toFixed(1)}%`]]);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor:"rgba(15,23,42,0.92)", titleColor:"#e2e8f0", bodyColor:"#cbd5e1", borderColor:"#334155", borderWidth:1, padding:10,
          callbacks: {
            label: (ctx) => ` Flagged: ${fmt(ctx.parsed.x)} works`,
            afterLabel: (ctx) => {
              const total = fs[ctx.dataIndex]?.flagged || ctx.parsed.x;
              const all = a.flagged_by_state?.reduce((s,x)=>s+x.flagged,0) || total;
              return ` Share: ${((total/all)*100).toFixed(1)}% of flagged`;
            }
          }
        }
      }
    },
  });

  const ws = a.work_status || [];
  const totalStatus = ws.reduce((s,x)=>s+x.count,0) || 1;
  const statusDistEl = document.getElementById("statusDist");
  if (statusDistEl) statusDistEl.innerHTML = ws.slice(0,3).map(d=> `<span class="badge" style="background:rgba(56,189,248,0.12);color:var(--accent)">${d.status} ${fmt(d.count)}</span>`).join(" ");
  drawChart("status", {
    canvas: "#cStatus",
    type: "doughnut",
    data: { labels: ws.map((d) => d.status), datasets: [{ data: ws.map((d) => d.count), backgroundColor: ["#38bdf8", "#a78bfa", "#22c55e", "#f59e0b", "#ef4444", "#94a3b8"], borderColor:"#1e293b" }] },
    options: {
      onClick: (evt, els) => {
        if (!els.length) return showChartDistribution("Work Status — All", ws.map(d=> [d.status, `${fmt(d.count)} (${(d.count/totalStatus*100).toFixed(1)}%)`]));
        const rec = ws[els[0].index];
        if (!rec) return;
        showChartDistribution(`Work Status — ${rec.status}`, [[rec.status, `${fmt(rec.count)} (${(rec.count/totalStatus*100).toFixed(1)}%)`],["Total", fmt(totalStatus)]]);
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          backgroundColor:"rgba(15,23,42,0.92)", titleColor:"#e2e8f0", bodyColor:"#cbd5e1", borderColor:"#334155", borderWidth:1, padding:10,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed || 0;
              const pct = ((v/totalStatus)*100).toFixed(1);
              return ` ${ctx.label}: ${fmt(v)} (${pct}%)`;
            }
          }
        }
      }
    },
  });

  const so = a.sanction_outlay || [];
  const outlayDistEl = document.getElementById("outlayDist");
  if (outlayDistEl && so.length) outlayDistEl.innerHTML = so.slice(0,3).map(d=> `<span class="badge" style="background:rgba(56,189,248,0.15);color:#38bdf8">${d.state} ${money(d.sanction)}</span>`).join(" ");
  drawChart("outlay", {
    canvas: "#cOutlay",
    type: "bar",
    data: { labels: so.map((d) => d.state), datasets: [{ label: "Sanction", data: so.map((d) => d.sanction), backgroundColor: COLORS.accent, borderRadius:4 }] },
    options: {
      onClick: (evt, els) => {
        if (!els.length) return;
        const rec = so[els[0].index];
        if (!rec) return;
        showChartDistribution(`Sanction Outlay — ${rec.state}`, [["Sanction", money(rec.sanction)],["Share", `${(rec.sanction/(so.reduce((s,x)=>s+x.sanction,0)||1)*100).toFixed(1)}%`]]);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor:"rgba(15,23,42,0.92)", titleColor:"#e2e8f0", bodyColor:"#cbd5e1", borderColor:"#334155", borderWidth:1, padding:10,
          callbacks: {
            label: (ctx) => ` Sanction: ${money(ctx.parsed.y)}`,
            afterLabel: (ctx) => {
              const total = so.reduce((s,x)=>s+x.sanction,0) || 1;
              return ` Share: ${((ctx.parsed.y/total)*100).toFixed(1)}% of outlay`;
            }
          }
        }
      },
      scales: { y: { ticks: { callback: (v) => (v / 1e7).toFixed(1) + "Cr" } } }
    },
  });

  const tv = a.top_vendors || [];
  const vendorsDistEl = document.getElementById("vendorsDist");
  if (vendorsDistEl && tv.length) vendorsDistEl.innerHTML = `<span class="badge" style="background:rgba(167,139,250,0.15);color:#a78bfa">${tv[0].vendor} ${money(tv[0].sanction)}</span> <span class="muted">top of ${tv.length}</span>`;
  drawChart("vendors", {
    canvas: "#cVendors",
    type: "bar",
    data: { labels: tv.map((d) => d.vendor), datasets: [{ label: "Outlay", data: tv.map((d) => d.sanction), backgroundColor: "#a78bfa", borderRadius:4 }] },
    options: {
      indexAxis: "y",
      onClick: (evt, els) => {
        if (!els.length) return;
        const rec = tv[els[0].index];
        if (!rec) return;
        showChartDistribution(`Vendor — ${rec.vendor}`, [["Outlay", money(rec.sanction)],["Works", fmt(rec.works)],["Avg/work", money((rec.sanction||0)/(rec.works||1))]]);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor:"rgba(15,23,42,0.92)", titleColor:"#e2e8f0", bodyColor:"#cbd5e1", borderColor:"#334155", borderWidth:1, padding:10,
          callbacks: {
            label: (ctx) => ` Outlay: ${money(ctx.parsed.x)}`,
            afterLabel: (ctx) => {
              const rec = tv[ctx.dataIndex] || {};
              return rec.works ? ` Works: ${fmt(rec.works)} • Avg: ${money((rec.sanction||0)/(rec.works||1))}/work` : "";
            }
          }
        }
      },
      scales: { x: { ticks: { callback: (v) => (v / 1e7).toFixed(1) + "Cr" } } }
    },
  });
}

/* ---------------- Work detail modal ---------------- */
async function openWork(id) {
  if (session.role === "public") return;
  const modal = $("#modal");
  const body = $("#modalBody");
  modal.classList.remove("hidden");
  body.innerHTML = `<h2>Work ${id}</h2><div class="explain-loading">Loading…</div>`;
  try {
    const rec = await getJSON(API.work(state.house, id));
    const keys = Object.keys(rec).filter((k) => k !== "House" && rec[k] !== null && rec[k] !== "");
    const grid = keys.map((k) => `<div class="k">${k}</div><div class="v">${fmt(rec[k])}</div>`).join("");
    body.innerHTML = `<h2>Work ${id}</h2><div class="detail-grid">${grid}</div>
      <h3>AI Explanation</h3><div id="explain" class="explain-box explain-loading">Requesting explanation…</div>`;
    const exp = await getJSON(API.explain(state.house, id));
    const box = $("#explain");
    // Show rule-based fallback nicely even if Gemini quota hit (error + explanation present)
    if (exp.explanation) {
      const isFallback = exp.fallback === true || exp.model_used === "rule-based";
      const badge = isFallback
        ? `<span class="dash-badge" style="background:rgba(100,116,139,0.15);color:#94a3b8;border:1px solid rgba(100,116,139,0.3);font-size:10px;margin-left:8px">Rule-based (Gemini quota fallback)</span>`
        : `<span class="dash-badge full" style="font-size:10px;margin-left:8px">Gemini ${exp.model_used || ""}</span>`;
      const warn = exp.error && isFallback ? `<div class="muted" style="margin-bottom:8px;font-size:12px;color:#f59e0b">Gemini temporarily unavailable — showing deterministic audit reasoning (same logic as pipeline).</div>` : "";
      box.innerHTML = `${warn}<div style="white-space:pre-wrap;line-height:1.6">${exp.explanation}</div><div style="margin-top:10px;display:flex;gap:6px;align-items:center"><span class="muted" style="font-size:11px">Why flagged? Anomaly=${rec["Is Anomaly"] ?? "—"} · Duplicate=${rec["possible_duplicate_work"] ?? "—"} · Delayed=${rec["is_delayed"] ?? "—"} · Risk ${rec["Risk Level"] ?? "—"}</span>${badge}</div>`;
    } else if (exp.error) {
      box.innerHTML = `<span class="explain-loading">Explanation unavailable: ${exp.error}</span>`;
    } else {
      box.textContent = "No explanation returned.";
    }
  } catch (e) {
    body.innerHTML = `<h2>Work ${id}</h2><div class="explain-loading" style="color:#ef4444">Error: ${e.message}</div>`;
  }
}

/* ---------------- Stakeholder Dashboards detail (replaces Portals) ---------------- */
const DASHBOARD_INFO = {
  mospi: {
    title: "MoSPI (Ministry)",
    icon: "🏛️",
    badge: "Full Access — All India",
    badgeClass: "full",
    rows: [
      ["Dashboard", "National-level summary (all states, districts, MPs, projects)"],
      ["Projects", "All projects across India"],
      ["Alerts", "All high-risk projects nationwide"],
      ["Reports", "National-level reports"],
      ["Actions", "Full control – monitor, audit, generate reports"],
    ],
  },
  sna: {
    title: "State Nodal Authority (SNA)",
    icon: "🗺️",
    badge: "State Scope",
    badgeClass: "state",
    rows: [
      ["Dashboard", "State-level summary (only their state)"],
      ["Projects", "All projects in their state"],
      ["Alerts", "High-risk projects in their state"],
      ["Reports", "State-level reports"],
      ["Actions", "Monitor state, flag issues, coordinate with districts"],
    ],
  },
  da: {
    title: "District Authority (DA)",
    icon: "🏢",
    badge: "Hand-picked Constituencies",
    badgeClass: "district",
    rows: [
      ["Dashboard", 'Constituency-level summary (acts as their "district")'],
      ["Projects", "All projects in selected constituencies (multi-select)"],
      ["Alerts", "High-risk projects in selected constituencies"],
      ["Reports", "Constituency-level reports for selected set"],
      ["Actions", "Mark Investigated, Flag for Audit, Update Status"],
    ],
  },
  mp: {
    title: "MP",
    icon: "🧑‍💼",
    badge: "Single Constituency Only",
    badgeClass: "mp",
    rows: [
      ["Dashboard", "Their constituency only"],
      ["Projects", "Works they recommended"],
      ["Alerts", "High-risk projects in their constituency"],
      ["Reports", "Constituency-level transparency report"],
      ["Actions", "Track works, view status, demonstrate accountability"],
    ],
  },
  public: {
    title: "Public (Read-Only)",
    icon: "👁️",
    badge: "Transparency View",
    badgeClass: "public",
    rows: [
      ["Dashboard", "National / State / District / Constituency-level summary (transparency view)"],
      ["Projects", "Completed works with asset photos and sanction amounts"],
      ["Alerts", "❌ Not visible (internal only)"],
      ["Reports", "Public transparency reports (PDF)"],
      ["Actions", "❌ No actions – view only"],
    ],
  },
};

function openDashboard(key) {
  const info = DASHBOARD_INFO[key];
  if (!info) return;
  const modal = $("#modal");
  const body = $("#modalBody");
  modal.classList.remove("hidden");
  const rowsHtml = info.rows.map(([k,v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  body.innerHTML = `<div class="dash-detail">
    <h2><span style="font-size:26px">${info.icon}</span> ${info.title} <span class="dash-badge ${info.badgeClass}">${info.badge}</span></h2>
    <p class="dash-sub">What this role sees is strictly enforced by login scope. Click "Go to login" to sign in as this role.</p>
    <table class="dash-table"><thead><tr><th>What They See</th><th>Details</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    <div class="dash-foot">
      <button id="dashLoginBtn" data-role="${key === 'mospi' ? 'mospi' : key === 'public' ? 'public' : key}">Go to login →</button>
      <button class="logout-btn" onclick="document.getElementById('modal').classList.add('hidden')" style="flex:0">Close</button>
    </div>
  </div>`;
  $("#dashLoginBtn").addEventListener("click", () => {
    modal.classList.add("hidden");
    // scroll to login is already behind, but if logged in, highlight scope; if not, just scroll up and flash
    const loginEl = document.getElementById("login");
    if (loginEl) {
      loginEl.scrollIntoView({ behavior: "smooth" });
      // flash the matching login card if not yet logged in
      const target = document.getElementById("card-" + (key === "mospi" ? "mospi" : key));
      if (target && document.body.classList.contains("locked")) {
        target.style.transition = "box-shadow 0.3s";
        target.classList.add("login-active");
        setTimeout(()=> target.classList.remove("login-active"), 1800);
      }
    }
  });
}

/* ---------------- Portal login placeholder (legacy) ---------------- */
function openPortal(name) {
  const modal = $("#modal");
  const body = $("#modalBody");
  modal.classList.remove("hidden");
  body.innerHTML = `<h2>${name} — Login</h2>
    <p class="explain-loading">Secure sign-in for ${name} is not configured in this demo build.
    Wire this to your identity provider (SSO / OAuth) to enable role-based access.</p>`;
}

/* ---------------- Bootstrap ---------------- */
function reloadAll() {
  loadOverview();
  loadList("anomalies");
  loadList("duplicates");
  loadList("delays");
  const active = document.querySelector(".tab.active");
  if (active) {
    if (active.dataset.page === "map") loadMap();
    if (active.dataset.page === "analytics") loadAnalytics();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("#house").addEventListener("change", (e) => {
    state.house = e.target.value;
    Object.values(state.lists).forEach((l) => (l.offset = 0));
    reloadAll();
  });

  $("#logout").addEventListener("click", logout);

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => switchPage(t.dataset.page))
  );

  document.querySelectorAll(".portal-btn").forEach((b) =>
    b.addEventListener("click", () => openPortal(b.dataset.portal))
  );

  document.querySelectorAll(".dashboard-card").forEach((c) => {
    c.addEventListener("click", () => openDashboard(c.dataset.dashboard));
    c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDashboard(c.dataset.dashboard); } });
  });

  Object.entries(LIST_CFG).forEach(([name, cfg]) => {
    let timer;
    $(cfg.search).addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.lists[name].search = e.target.value.trim();
        state.lists[name].offset = 0;
        loadList(name);
      }, 300);
    });
    $(cfg.prev).addEventListener("click", () => {
      state.lists[name].offset = Math.max(0, state.lists[name].offset - LIMIT);
      loadList(name);
    });
    $(cfg.next).addEventListener("click", () => {
      state.lists[name].offset += LIMIT;
      loadList(name);
    });
  });

  $("#modalClose").addEventListener("click", () => $("#modal").classList.add("hidden"));
  $("#modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") e.target.classList.add("hidden");
  });

  // theme toggle
  initTheme();
  const tt = document.getElementById("themeToggle");
  if (tt) tt.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(cur);
  });

  renderLogin();
});
