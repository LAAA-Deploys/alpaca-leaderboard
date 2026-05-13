/* ============================================================
   Alpaca Paper Comp — leaderboard client
   ============================================================ */

const API_BASE = (() => {
  if (window.location.protocol === "file:") return null;
  return window.location.origin;
})();

const REFRESH_MS = 60_000;
const STARTING_CAPITAL = 100_000;

const ME_HANDLE_KEY = "alpaca_me_handle";
let myHandle = localStorage.getItem(ME_HANDLE_KEY) || null;

const MOCK = {
  starting_capital: 100000,
  as_of: new Date().toISOString(),
  leaderboard: [
    {
      handle: "Filip",
      equity: 100161.0, cash: 48884.0, pnl: 161.0, roi_pct: 0.161,
      day_pnl: 161.0, num_positions: 2,
      last_update: new Date(Date.now() - 5_000).toISOString(),
      positions: [
        { sym: "LEG",  qty: 2587, mv: 24628.24, upnl: -310.44 },
        { sym: "ELVN", qty: 630,  mv: 26649.0,  upnl: 472.5  }
      ],
      history: mockCurve(100, 100161, 0.005)
    },
    {
      handle: "Daniel",
      equity: 100920.0, cash: 12340.0, pnl: 920.0, roi_pct: 0.92,
      day_pnl: 412.0, num_positions: 4,
      last_update: new Date(Date.now() - 60_000).toISOString(),
      positions: [
        { sym: "NVDA", qty: 30, mv: 38400.0, upnl: 220.5 },
        { sym: "AAPL", qty: 80, mv: 14920.0, upnl: 90.0 },
        { sym: "MSFT", qty: 25, mv: 11250.0, upnl: -60.0 },
        { sym: "TSLA", qty: 15, mv: 24010.0, upnl: 670.0 }
      ],
      history: mockCurve(100, 100920, 0.012)
    },
    {
      handle: "Mike",
      equity: 99540.0, cash: 95000.0, pnl: -460.0, roi_pct: -0.46,
      day_pnl: -120.0, num_positions: 1,
      last_update: new Date(Date.now() - 4 * 3600_000).toISOString(),
      positions: [
        { sym: "GME", qty: 200, mv: 4540.0, upnl: -460.0 }
      ],
      history: mockCurve(100, 99540, 0.006)
    },
    {
      handle: "Ari",
      equity: 102340.0, cash: 50100.0, pnl: 2340.0, roi_pct: 2.34,
      day_pnl: 880.0, num_positions: 3,
      last_update: new Date(Date.now() - 30_000).toISOString(),
      positions: [
        { sym: "META", qty: 50, mv: 28000.0, upnl: 1200.0 },
        { sym: "AMD",  qty: 80, mv: 12640.0, upnl: 540.0 },
        { sym: "PLTR", qty: 600, mv: 11600.0, upnl: 600.0 }
      ],
      history: mockCurve(100, 102340, 0.018)
    },
    {
      handle: "Sara",
      equity: null, cash: null, pnl: null, roi_pct: null,
      day_pnl: null, num_positions: 0,
      last_update: null,
      positions: [],
      history: []
    },
    {
      handle: "Jamal",
      equity: 98220.0, cash: 30000.0, pnl: -1780.0, roi_pct: -1.78,
      day_pnl: -240.0, num_positions: 2,
      last_update: new Date(Date.now() - 90_000).toISOString(),
      positions: [
        { sym: "COIN", qty: 100, mv: 22000.0, upnl: -1280.0 },
        { sym: "MARA", qty: 1500, mv: 46220.0, upnl: -500.0 }
      ],
      history: mockCurve(100, 98220, 0.022)
    }
  ]
};

function mockCurve(n, end, vol) {
  const out = [];
  const start = STARTING_CAPITAL;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const drift = start + (end - start) * t;
    const wobble = drift * vol * (Math.sin(i * 0.7) + Math.sin(i * 0.21) * 0.5);
    const ts = new Date(Date.now() - (n - i) * 24 * 3600_000).toISOString();
    out.push({ ts, equity: Math.round((drift + wobble) * 100) / 100 });
  }
  return out;
}

/* ============================================================
   API
   ============================================================ */
async function fetchLeaderboard() {
  if (!API_BASE) return MOCK;
  try {
    const r = await fetch(`${API_BASE}/api/leaderboard`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn("leaderboard fetch failed, using mock", e);
    return { ...MOCK, _mock: true };
  }
}

async function fetchHistory(handle) {
  if (!API_BASE) return MOCK.leaderboard.find(p => p.handle === handle)?.history || [];
  try {
    const r = await fetch(`${API_BASE}/api/user/${encodeURIComponent(handle)}/history`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn(`history fetch failed for ${handle}, using mock`, e);
    return MOCK.leaderboard.find(p => p.handle === handle)?.history || [];
  }
}

/* ============================================================
   Format helpers
   ============================================================ */
const usd = (v, { sign = false, decimals = 2 } = {}) => {
  if (v == null || isNaN(v)) return "—";
  const abs = Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  });
  const prefix = sign ? (v >= 0 ? "+$" : "-$") : "$";
  return `${prefix}${abs}`;
};
const pct = (v) => {
  if (v == null || isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
};
const fmtAgo = (iso) => {
  if (!iso) return "no data";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};
const fmtTs = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
};

/* ============================================================
   Render
   ============================================================ */
const $ = (sel) => document.querySelector(sel);
let chartInstance = null;
const expandedRows = new Set();
const lastData = { board: [], asOf: null, mock: false };

function setStatus(state) {
  const dot = $("#live-dot");
  const label = $("#live-label");
  const footer = $("#footer-status");
  dot.classList.remove("on", "err");
  label.classList.remove("on", "err");
  if (state === "live") {
    dot.classList.add("on");
    label.classList.add("on");
    label.textContent = "LIVE";
    footer.textContent = "online";
  } else if (state === "mock") {
    dot.classList.add("err");
    label.classList.add("err");
    label.textContent = "DEMO";
    footer.textContent = "offline (showing mock data)";
  } else {
    label.textContent = "CONNECTING";
    footer.textContent = "connecting…";
  }
}

function renderChampion(board) {
  const live = board.filter(p => p.equity != null);
  const nameEl = document.getElementById("champion-name");
  const roiEl  = document.getElementById("champion-roi");
  if (!nameEl || !roiEl) return;

  if (!live.length) {
    nameEl.textContent = "TBD";
    roiEl.textContent = "no snapshots yet";
    roiEl.classList.remove("pos", "neg");
    return;
  }
  // board is already sorted descending by roi_pct upstream
  const leader = live[0];
  nameEl.textContent = leader.handle;
  roiEl.textContent = `${pct(leader.roi_pct)} · ${usd(leader.equity)}`;
  roiEl.classList.toggle("pos", leader.roi_pct >= 0);
  roiEl.classList.toggle("neg", leader.roi_pct < 0);
}

function renderStats(board) {
  const live = board.filter(p => p.equity != null);
  $("#stat-players").textContent = `${live.length} / ${board.length}`;

  if (!live.length) {
    $("#stat-days").textContent = "—";
    $("#stat-top-roi").textContent = "—";
    $("#stat-spread").textContent = "—";
    return;
  }

  const rois = live.map(p => p.roi_pct);
  const topRoi = Math.max(...rois);
  const botRoi = Math.min(...rois);
  $("#stat-top-roi").textContent = pct(topRoi);
  $("#stat-top-roi").classList.toggle("pos", topRoi >= 0);
  $("#stat-top-roi").classList.toggle("neg", topRoi < 0);
  $("#stat-spread").textContent = `${(topRoi - botRoi).toFixed(2)} pp`;

  // Days live = max history length across live players (approximate)
  // We don't have history in /api/leaderboard so fall back to "since earliest snapshot"
  const earliest = live
    .map(p => p.last_update ? new Date(p.last_update).getTime() : null)
    .filter(Boolean)
    .reduce((a, b) => Math.min(a, b), Date.now());
  const days = Math.max(1, Math.round((Date.now() - earliest) / (24 * 3600_000)));
  $("#stat-days").textContent = `${days}`;
}

function renderBoard(board) {
  const tbody = $("#board-body");
  tbody.innerHTML = "";

  if (!board.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">NO PLAYERS REGISTERED YET</td></tr>`;
    return;
  }

  board.forEach((p, i) => {
    const noData = p.equity == null;
    const rank = i + 1;
    const rankCls = rank === 1 ? "r1" : rank === 2 ? "r2" : rank === 3 ? "r3" : "";
    const isMe = myHandle && p.handle.toLowerCase() === myHandle.toLowerCase();

    const tr = document.createElement("tr");
    tr.className = "row" + (expandedRows.has(p.handle) ? " open" : "");
    tr.dataset.handle = p.handle;

    if (noData) {
      tr.innerHTML = `
        <td class="col-rank-cell ${rankCls}">—</td>
        <td class="handle-cell">${escapeHtml(p.handle)}${isMe ? ` <span class="me-pill">YOU</span>` : ""}</td>
        <td colspan="6" class="num muted">no snapshot yet</td>
        <td class="col-caret-cell"></td>
      `;
      tbody.appendChild(tr);
      return;
    }

    const roiCls = p.roi_pct >= 0 ? "pos" : "neg";
    const dayCls = (p.day_pnl ?? 0) >= 0 ? "pos" : "neg";

    tr.innerHTML = `
      <td class="col-rank-cell ${rankCls}">${rank}</td>
      <td class="handle-cell">${escapeHtml(p.handle)}${isMe ? ` <span class="me-pill">YOU</span>` : ""}</td>
      <td class="num">${usd(p.equity)}</td>
      <td class="num ${roiCls}">${usd(p.pnl, { sign: true })}</td>
      <td class="num ${roiCls}">${pct(p.roi_pct)}</td>
      <td class="num ${dayCls} hide-sm">${p.day_pnl == null ? "—" : usd(p.day_pnl, { sign: true })}</td>
      <td class="num hide-sm">${p.num_positions ?? 0}</td>
      <td class="num muted hide-md">${fmtAgo(p.last_update)}</td>
      <td class="col-caret-cell">›</td>
    `;
    tr.addEventListener("click", () => toggleRow(p.handle));
    tbody.appendChild(tr);

    if (expandedRows.has(p.handle)) {
      tbody.appendChild(buildDetailRow(p));
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function buildDetailRow(p) {
  const tr = document.createElement("tr");
  tr.className = "detail-row";
  const td = document.createElement("td");
  td.colSpan = 9;
  td.innerHTML = `
    <div class="detail">
      <div class="detail-grid">
        <div>
          <h3>POSITIONS (${p.num_positions ?? 0})</h3>
          <div id="positions-${cssId(p.handle)}">
            <div class="empty-positions">loading…</div>
          </div>
        </div>
        <div>
          <h3>EQUITY CURVE</h3>
          <div class="chart-box">
            <canvas id="chart-${cssId(p.handle)}"></canvas>
          </div>
        </div>
      </div>
    </div>
  `;
  tr.appendChild(td);
  setTimeout(() => populateDetail(p), 0);
  return tr;
}

function cssId(handle) {
  return handle.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function populateDetail(p) {
  // Positions
  const posWrap = document.getElementById(`positions-${cssId(p.handle)}`);
  if (posWrap) {
    const positions = parsePositions(p);
    if (!positions.length) {
      posWrap.innerHTML = `<div class="empty-positions">all cash</div>`;
    } else {
      posWrap.innerHTML = `
        <table class="positions">
          <thead>
            <tr><th>Sym</th><th>Qty</th><th>Mkt Value</th><th>Unrealized P&amp;L</th></tr>
          </thead>
          <tbody>
            ${positions.map(pos => `
              <tr>
                <td>${escapeHtml(pos.sym)}</td>
                <td>${(+pos.qty).toLocaleString()}</td>
                <td>${usd(pos.mv)}</td>
                <td class="${pos.upnl >= 0 ? "pos" : "neg"}">${usd(pos.upnl, { sign: true })}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }
  }
  // Chart
  drawChart(p);
}

function parsePositions(p) {
  if (Array.isArray(p.positions)) return p.positions;
  if (typeof p.positions_json === "string") {
    try { return JSON.parse(p.positions_json); } catch { return []; }
  }
  return [];
}

async function drawChart(p) {
  const canvas = document.getElementById(`chart-${cssId(p.handle)}`);
  if (!canvas || typeof Chart === "undefined") return;

  const history = await fetchHistory(p.handle);
  if (!history || history.length === 0) {
    canvas.parentElement.innerHTML = `<div class="chart-empty">NO HISTORY YET</div>`;
    return;
  }

  const labels = history.map(h => new Date(h.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  const data = history.map(h => h.equity);
  const last = data[data.length - 1];
  const positive = last >= STARTING_CAPITAL;
  const color = positive ? "#22d57b" : "#ff5468";
  const fill  = positive ? "rgba(34,213,123,0.10)" : "rgba(255,84,104,0.10)";

  if (chartInstance && chartInstance.canvas === canvas) chartInstance.destroy();
  chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data,
          borderColor: color,
          backgroundColor: fill,
          borderWidth: 1.8,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.28,
        },
        {
          data: data.map(() => STARTING_CAPITAL),
          borderColor: "rgba(217,225,236,0.18)",
          borderDash: [3, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#11161f",
          borderColor: "#1f2733",
          borderWidth: 1,
          titleFont: { family: "JetBrains Mono", size: 11 },
          bodyFont:  { family: "JetBrains Mono", size: 12 },
          callbacks: {
            label: (ctx) => ctx.datasetIndex === 0 ? usd(ctx.parsed.y) : ""
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#475063", font: { family: "JetBrains Mono", size: 10 }, maxTicksLimit: 6 },
          grid:  { color: "rgba(31,39,51,0.5)", drawTicks: false }
        },
        y: {
          ticks: {
            color: "#475063",
            font: { family: "JetBrains Mono", size: 10 },
            callback: (v) => `$${(v / 1000).toFixed(0)}K`
          },
          grid: { color: "rgba(31,39,51,0.5)" }
        }
      }
    }
  });
}

function toggleRow(handle) {
  if (expandedRows.has(handle)) expandedRows.delete(handle);
  else expandedRows.add(handle);
  renderBoard(lastData.board);
}

function renderRefresh(asOf, mock) {
  $("#last-refresh").textContent =
    `${mock ? "mock data" : "updated"} ${fmtAgo(asOf)}`;
}

/* ============================================================
   Boot + loop
   ============================================================ */
async function load() {
  setStatus("connecting");
  const data = await fetchLeaderboard();
  lastData.board = data.leaderboard || [];
  lastData.asOf = data.as_of;
  lastData.mock = !!data._mock;
  setStatus(data._mock ? "mock" : "live");
  renderChampion(lastData.board);
  renderStats(lastData.board);
  renderBoard(lastData.board);
  renderRefresh(lastData.asOf, lastData.mock);
}

/* ============================================================
   Connect Account modal
   ============================================================ */
function openModal() {
  resetModal();
  $("#modal-backdrop").hidden = false;
  setTimeout(() => $("#f-handle")?.focus(), 80);
  document.body.style.overflow = "hidden";
}
function closeModal() {
  $("#modal-backdrop").hidden = true;
  document.body.style.overflow = "";
}
function resetModal() {
  $("#connect-form").hidden = false;
  $("#modal-success").hidden = true;
  $("#form-msg").hidden = true;
  $("#form-msg").className = "form-msg";
  $("#connect-form").reset();
  setSubmitting(false);
}
function setSubmitting(on) {
  const btn = $("#modal-submit");
  const label = btn.querySelector(".btn-label");
  const spin = btn.querySelector(".btn-spin");
  btn.disabled = on;
  label.hidden = on;
  spin.hidden = !on;
}
function showFormMsg(text, kind = "err") {
  const el = $("#form-msg");
  el.textContent = text;
  el.className = `form-msg ${kind}`;
  el.hidden = false;
}

async function submitConnect(e) {
  e.preventDefault();
  const handle = $("#f-handle").value.trim();
  const api_key = $("#f-key").value.trim();
  const secret_key = $("#f-secret").value.trim();

  if (!handle || handle.length > 32) {
    showFormMsg("Display name must be 1–32 characters."); return;
  }
  if (!api_key || !secret_key) {
    showFormMsg("Both API key and secret key are required."); return;
  }
  if (!/^PK[A-Z0-9]+$/i.test(api_key)) {
    showFormMsg("That doesn't look like an Alpaca paper API key (should start with 'PK')."); return;
  }

  setSubmitting(true);
  $("#form-msg").hidden = true;

  // Preview mode (file://): simulate success
  if (!API_BASE) {
    await new Promise(r => setTimeout(r, 700));
    setSubmitting(false);
    onConnectSuccess({ handle, equity: 100000 });
    return;
  }

  try {
    const r = await fetch(`${API_BASE}/api/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle, api_key, secret_key })
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = body.detail || `Connection failed (HTTP ${r.status})`;
      showFormMsg(msg);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onConnectSuccess(body);
  } catch (err) {
    setSubmitting(false);
    showFormMsg(`Network error: ${err.message}`);
  }
}

function onConnectSuccess(body) {
  myHandle = body.handle;
  localStorage.setItem(ME_HANDLE_KEY, body.handle);
  $("#success-title").textContent = `Welcome, ${body.handle}!`;
  if (body.equity != null) {
    $("#success-msg").textContent =
      `Your starting equity is ${usd(body.equity)}. You'll appear on the leaderboard within a minute.`;
  }
  $("#connect-form").hidden = true;
  $("#modal-success").hidden = false;
  setTimeout(load, 1500);
}

function bindModal() {
  $("#cta-connect-hero")?.addEventListener("click", openModal);
  $("#cta-connect-top")?.addEventListener("click", openModal);
  $("#modal-close")?.addEventListener("click", closeModal);
  $("#modal-cancel")?.addEventListener("click", closeModal);
  $("#success-done")?.addEventListener("click", () => {
    closeModal();
    document.querySelector(".board-card")?.scrollIntoView({ behavior: "smooth" });
  });
  $("#modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#modal-backdrop").hidden) closeModal();
  });
  $("#connect-form")?.addEventListener("submit", submitConnect);
}

document.addEventListener("DOMContentLoaded", () => {
  bindModal();
  load();
  setInterval(load, REFRESH_MS);
  setInterval(() => renderRefresh(lastData.asOf, lastData.mock), 5000);
});
