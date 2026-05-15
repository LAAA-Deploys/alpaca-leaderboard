/* ============================================================
   Alpaca Paper Comp — leaderboard client
   ============================================================ */

// Backend lives on the existing Lightsail box behind nginx + Let's Encrypt
// at a sslip.io subdomain (no Glen DNS needed). Friends never see this URL
// directly — it's hidden inside the Claude prompt the modal generates.
const API_BASE = (() => {
  if (window.location.protocol === "file:") return null;
  return "https://32.194.248.231.nip.io";
})();

const REFRESH_MS = 60_000;
const STARTING_CAPITAL = 100_000;

const ME_HANDLE_KEY = "alpaca_me_handle";
let myHandle = localStorage.getItem(ME_HANDLE_KEY) || null;

// Empty board — file:// preview shows the "no players yet" state.
// Real data comes from the live API. We never fall back to fake users.
const EMPTY_BOARD = {
  starting_capital: 100000,
  as_of: new Date().toISOString(),
  leaderboard: []
};

/* ============================================================
   API
   ============================================================ */
async function fetchLeaderboard() {
  if (!API_BASE) return { ...EMPTY_BOARD, _preview: true };
  try {
    const r = await fetch(`${API_BASE}/api/leaderboard`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn("leaderboard fetch failed", e);
    return { ...EMPTY_BOARD, _error: true };
  }
}

async function fetchHistory(handle) {
  if (!API_BASE) return [];
  try {
    const r = await fetch(`${API_BASE}/api/user/${encodeURIComponent(handle)}/history`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn(`history fetch failed for ${handle}`, e);
    return [];
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
// Server title-cases handles. Mirror it defensively on the client so any
// legacy/odd-case handle still renders uniformly ("john doe" -> "John Doe").
const fmtHandle = (s) => {
  if (!s) return "";
  return String(s).trim().split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
};
// Leaderboard display: "First L." when last_name is set, else the bare handle.
const fmtDisplayName = (p) => {
  const first = fmtHandle(p.handle);
  if (!p.last_name) return first;
  const ln = String(p.last_name).trim();
  if (!ln) return first;
  return `${first} ${ln.charAt(0).toUpperCase()}.`;
};

/* ============================================================
   Render
   ============================================================ */
const $ = (sel) => document.querySelector(sel);
let chartInstance = null;
const expandedRows = new Set();
const lastData = { board: [], asOf: null, mock: false, spy: null };

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
  } else if (state === "preview") {
    label.textContent = "PREVIEW";
    footer.textContent = "local preview";
  } else if (state === "error") {
    dot.classList.add("err");
    label.classList.add("err");
    label.textContent = "OFFLINE";
    footer.textContent = "can't reach server";
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
  nameEl.textContent = fmtHandle(leader.handle);
  roiEl.textContent = `${pct(leader.roi_pct)} · ${usd(leader.pnl, { sign: true })}`;
  roiEl.classList.toggle("pos", leader.roi_pct >= 0);
  roiEl.classList.toggle("neg", leader.roi_pct < 0);
}

const NUM_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
  "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];

function renderHeroCount(board) {
  const el = document.getElementById("hero-count");
  if (!el) return;
  const n = board.length;
  const word = (n >= 0 && n < NUM_WORDS.length) ? NUM_WORDS[n] : String(n);
  el.textContent = `${word} ${n === 1 ? "friend" : "friends"}.`;
}

function renderStats(board, spy) {
  const live = board.filter(p => p.equity != null);
  $("#stat-players").textContent = `${live.length} / ${board.length}`;

  const spreadEl = $("#stat-spread");
  spreadEl.classList.remove("pos", "neg");

  if (!live.length) {
    $("#stat-days").textContent = "—";
    $("#stat-top-roi").textContent = "—";
    spreadEl.textContent = "—";
    return;
  }

  const rois = live.map(p => p.roi_pct);
  const topRoi = Math.max(...rois);
  $("#stat-top-roi").textContent = pct(topRoi);
  $("#stat-top-roi").classList.toggle("pos", topRoi >= 0);
  $("#stat-top-roi").classList.toggle("neg", topRoi < 0);

  // #1 VS SPY: leader's ROI minus SPY's return since 5/12 close. Positive = alpha.
  if (spy && typeof spy.return_pct === "number") {
    const alpha = topRoi - spy.return_pct;
    spreadEl.textContent = `${alpha >= 0 ? "+" : ""}${alpha.toFixed(2)} pp`;
    spreadEl.classList.toggle("pos", alpha >= 0);
    spreadEl.classList.toggle("neg", alpha < 0);
  } else {
    spreadEl.textContent = "—";
  }

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
        <td class="col-rank-cell muted">—</td>
        <td class="handle-cell">${escapeHtml(fmtDisplayName(p))}${isMe ? ` <span class="me-pill">YOU</span>` : ""}</td>
        <td colspan="6" class="num muted">no snapshot yet</td>
        <td class="col-caret-cell"></td>
      `;
      tbody.appendChild(tr);
      return;
    }

    const roiCls = p.roi_pct >= 0 ? "pos" : "neg";
    const dayCls = (p.day_pnl ?? 0) >= 0 ? "pos" : "neg";

    tr.innerHTML = `
      <td class="col-rank-cell ${rankCls}"><span class="rank-hash">#</span>${rank}</td>
      <td class="handle-cell">${escapeHtml(fmtDisplayName(p))}${isMe ? ` <span class="me-pill">YOU</span>` : ""}</td>
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
  lastData.spy = data.spy || null;
  if (data._preview) setStatus("preview");
  else if (data._error) setStatus("error");
  else setStatus("live");
  renderHeroCount(lastData.board);
  renderChampion(lastData.board);
  renderStats(lastData.board, lastData.spy);
  renderBoard(lastData.board);
  renderRefresh(lastData.asOf, lastData.mock);
}

/* ============================================================
   Connect Account modal — device-code flow
   ============================================================ */
const STAGES = ["stage-handle", "stage-code", "stage-success"];
const codeFlow = {
  code: null,
  handle: null,
  expiresAt: null,
  pollTimer: null,
  countdownTimer: null,
};

function showStage(id) {
  STAGES.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.hidden = (s !== id);
  });
}

function openModal() {
  resetModal();
  $("#modal-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#f-handle")?.focus(), 80);
}
function closeModal() {
  $("#modal-backdrop").hidden = true;
  document.body.style.overflow = "";
  stopPolling();
}
function resetModal() {
  showStage("stage-handle");
  $("#form-msg").hidden = true;
  $("#form-msg").className = "form-msg";
  $("#code-msg").hidden = true;
  $("#code-msg").className = "form-msg";
  $("#connect-form")?.reset();
  setSubmitting(false);
  stopPolling();
}
function setSubmitting(on) {
  const btn = $("#modal-submit");
  if (!btn) return;
  const label = btn.querySelector(".btn-label");
  const spin = btn.querySelector(".btn-spin");
  btn.disabled = on;
  if (label) label.hidden = on;
  if (spin) spin.hidden = !on;
}
function showFormMsg(text, kind = "err", target = "#form-msg") {
  const el = $(target);
  if (!el) return;
  el.textContent = text;
  el.className = `form-msg ${kind}`;
  el.hidden = false;
}

function stopPolling() {
  if (codeFlow.pollTimer) { clearInterval(codeFlow.pollTimer); codeFlow.pollTimer = null; }
  if (codeFlow.countdownTimer) { clearInterval(codeFlow.countdownTimer); codeFlow.countdownTimer = null; }
}

function buildClaudePrompt(code) {
  const url = API_BASE || "https://32.194.248.231.nip.io";
  return `I want to join the Alpaca Trading Competition leaderboard.

My one-time code is: ${code}

Find my Alpaca *paper* API key + secret. Try in this order:
  1. Env vars: $ALPACA_API_KEY and $ALPACA_SECRET_KEY
  2. ~/.env or similar dotenv files in my home dir
  3. ~/.alpaca/credentials
  4. Ask me if you can't find them

The paper API key starts with "PK" (NOT "AK" — never use a live key here).

Then run this curl, substituting my real key + secret:

  curl -X POST ${url}/api/code/claim \\
    -H "Content-Type: application/json" \\
    -d '{"code":"${code}","api_key":"<MY_KEY>","secret_key":"<MY_SECRET>"}'

Report back what the server returns. On success the JSON has "ok":true and my equity.`;
}

async function submitHandle(e) {
  e.preventDefault();
  const handle = $("#f-handle").value.trim();
  const lastName = $("#f-lastname").value.trim();
  if (!handle || handle.length > 32) {
    showFormMsg("First name must be 1–32 characters.");
    return;
  }
  if (!/^[A-Za-z0-9 _.\-]+$/.test(handle)) {
    showFormMsg("First name: letters, digits, space, underscore, dot, dash only.");
    return;
  }
  if (!lastName || lastName.length > 32) {
    showFormMsg("Last name must be 1–32 characters.");
    return;
  }
  if (!/^[A-Za-z][A-Za-z '\-]*$/.test(lastName)) {
    showFormMsg("Last name: letters, apostrophe, hyphen, space only.");
    return;
  }

  setSubmitting(true);
  $("#form-msg").hidden = true;

  // file:// preview mode: fake a code, auto-claim after 6s
  if (!API_BASE) {
    await new Promise(r => setTimeout(r, 500));
    setSubmitting(false);
    const fakeCode = "K8M-J3P";
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    enterCodeStage({ code: fakeCode, handle, last_name: lastName, expires_at: expiresAt });
    setTimeout(() => onConnectSuccess({ handle, equity: 100000 }), 6000);
    return;
  }

  try {
    const r = await fetch(`${API_BASE}/api/code/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle, last_name: lastName }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      showFormMsg(body.detail || `Request failed (HTTP ${r.status})`);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    enterCodeStage(body);
  } catch (err) {
    setSubmitting(false);
    showFormMsg(`Network error: ${err.message}. Is the server up?`);
  }
}

function enterCodeStage({ code, handle, expires_at }) {
  codeFlow.code = code;
  codeFlow.handle = handle;
  codeFlow.expiresAt = expires_at;
  $("#code-box").textContent = code;
  $("#code-handle").textContent = handle;
  $("#prompt-text").textContent = buildClaudePrompt(code);
  showStage("stage-code");
  startCountdown();
  startPolling();
}

function startCountdown() {
  const target = new Date(codeFlow.expiresAt).getTime();
  const update = () => {
    const ms = target - Date.now();
    const el = $("#code-countdown");
    if (!el) return;
    if (ms <= 0) {
      el.textContent = "EXPIRED";
      showFormMsg("This code expired. Generate a new one.", "err", "#code-msg");
      stopPolling();
      return;
    }
    const s = Math.floor(ms / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  update();
  codeFlow.countdownTimer = setInterval(update, 1000);
}

function startPolling() {
  if (!API_BASE) return; // preview handles its own auto-claim
  const tick = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/code/status?code=${encodeURIComponent(codeFlow.code)}`);
      if (!r.ok) return;
      const body = await r.json();
      if (body.status === "claimed") {
        stopPolling();
        onConnectSuccess({ handle: body.handle, equity: body.equity });
      } else if (body.status === "expired") {
        stopPolling();
        showFormMsg("This code expired. Generate a new one.", "err", "#code-msg");
      }
    } catch { /* ignore transient errors */ }
  };
  tick();
  codeFlow.pollTimer = setInterval(tick, 2500);
}

function onConnectSuccess(body) {
  const h = fmtHandle(body.handle);
  myHandle = h;
  localStorage.setItem(ME_HANDLE_KEY, h);
  $("#success-title").textContent = `Welcome, ${h}!`;
  if (body.equity != null) {
    $("#success-msg").textContent =
      `Starting equity ${usd(body.equity)}. You'll appear on the leaderboard within a minute.`;
  } else {
    $("#success-msg").textContent =
      `You're connected. Your snapshot will appear on the leaderboard within a minute.`;
  }
  showStage("stage-success");
  setTimeout(load, 1500);
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<span class="copy-icon">✓</span> Copied';
      btn.classList.add("copied");
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove("copied"); }, 1400);
    }
  } catch {
    if (btn) btn.textContent = "Copy failed";
  }
}

function bindModal() {
  $("#cta-connect-hero")?.addEventListener("click", openModal);
  $("#cta-connect-top")?.addEventListener("click", openModal);
  $("#modal-close")?.addEventListener("click", closeModal);
  $("#modal-cancel")?.addEventListener("click", closeModal);
  $("#code-cancel")?.addEventListener("click", closeModal);
  $("#code-newhandle")?.addEventListener("click", () => { resetModal(); setTimeout(() => $("#f-handle")?.focus(), 50); });
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
  $("#connect-form")?.addEventListener("submit", submitHandle);
  $("#copy-code")?.addEventListener("click", (e) => copyToClipboard(codeFlow.code || "", e.currentTarget));
  $("#copy-prompt")?.addEventListener("click", (e) => copyToClipboard($("#prompt-text")?.textContent || "", e.currentTarget));
}

document.addEventListener("DOMContentLoaded", () => {
  bindModal();
  load();
  setInterval(load, REFRESH_MS);
  setInterval(() => renderRefresh(lastData.asOf, lastData.mock), 5000);
});
