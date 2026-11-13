"use strict";
// netwatch UI: plain JS, hash routing, no dependencies.

const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");
const tip = $("#tip");
let range = localStorage.getItem("nw.range") || "24h";
let liveTimer = null;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function bytes(n) {
  n = Number(n) || 0;
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (i === 0 ? n.toFixed(0) : n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)) + " " + u[i];
}
function rate(n) { return n > 0 ? bytes(n) + "/s" : ""; }
function ago(ms) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return Math.round(s) + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}
function dur(ms) {
  const s = Math.max(0, ms / 1000);
  if (s < 60) return Math.round(s) + "s";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return (s / 3600).toFixed(1) + "h";
  return (s / 86400).toFixed(1) + "d";
}
function ts(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.json();
}
const devLink = (key, name) => `<a href="#/device/${encodeURIComponent(key)}">${esc(name || key)}</a>`;
const tgtLink = t => `<a href="#/domain/${encodeURIComponent(t)}">${esc(t)}</a>`;
const kindBadge = k => k && k !== "lan" ? `<span class="badge">${esc(k)}</span>` : "";
const srcBadge = f => f.source === "conntrack" ? `<span class="badge" title="from router conntrack (not seen by sing-box)">${esc(f.inbound)}</span>` : "";

// ---- tables with click-to-sort ----
function table(cols, rows, opts = {}) {
  const id = "t" + Math.random().toString(36).slice(2);
  const state = { key: opts.sort || null, dir: -1 };
  const render = () => {
    let rs = rows.slice();
    if (state.key) {
      const c = cols.find(c => c.key === state.key);
      const v = c.sortv || (r => r[c.key]);
      rs.sort((a, b) => { const x = v(a), y = v(b); return (x > y ? 1 : x < y ? -1 : 0) * state.dir; });
    }
    const head = cols.map(c => `<th class="${c.num ? "num " : ""}${c.key ? "sortable" : ""}" data-k="${c.key || ""}">${esc(c.title)}${state.key && state.key === c.key ? (state.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("");
    const body = rs.length ? rs.map(r => "<tr>" + cols.map(c => `<td class="${c.num ? "num" : ""} ${c.cls || ""}">${c.fmt ? c.fmt(r) : esc(r[c.key])}</td>`).join("") + "</tr>").join("")
      : `<tr><td colspan="${cols.length}" class="muted">${esc(opts.empty || "Nothing in this range.")}</td></tr>`;
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  };
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", e => {
      const th = e.target.closest("th[data-k]");
      if (!th || !th.dataset.k) return;
      state.dir = state.key === th.dataset.k ? -state.dir : -1;
      state.key = th.dataset.k;
      el.innerHTML = render();
    });
  });
  return `<div id="${id}" class="${opts.scroll === false ? "" : "scroll"}">${render()}</div>`;
}
function share(v, max) { return `<div class="bar"><span data-w="${max ? Math.max(1, 100 * v / max).toFixed(1) : 0}"></span></div>`; }
// CSP forbids inline style attributes; apply bar widths after render.
function applyBars() { document.querySelectorAll(".bar span[data-w]").forEach(s => { s.style.width = s.dataset.w + "%"; }); }
new MutationObserver(applyBars).observe(document.getElementById("main"), { childList: true, subtree: true });

// ---- stacked bar chart (download + upload per bucket) ----
function chart(series, bucket) {
  if (!series || !series.length) return `<p class="muted">No traffic in this range.</p>`;
  // Fill empty buckets so gaps in time read as gaps.
  const pts = [];
  const byT = new Map(series.map(p => [p.t, p]));
  const first = series[0].t, last = series[series.length - 1].t;
  const step = bucket % 86400 === 0 ? null : bucket; // day/week buckets shift with DST: use data points
  if (step && (last - first) / step < 2000) {
    for (let t = first; t <= last; t += step) pts.push(byT.get(t) || { t, up: 0, down: 0 });
  } else pts.push(...series);
  const W = 1000, H = 220, L = 56, R = 8, T = 10, B = 24;
  const max = Math.max(1, ...pts.map(p => p.up + p.down));
  const nice = niceMax(max);
  const bw = (W - L - R) / pts.length;
  const gap = Math.min(2, bw * 0.25);
  const y = v => T + (H - T - B) * (1 - v / nice);
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const v = nice * i / 4, yy = y(v);
    g += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${bytes(v)}</text>`;
  }
  let bars = "", hits = "";
  const labelEvery = Math.ceil(pts.length / 8);
  pts.forEach((p, i) => {
    const x = L + i * bw + gap / 2, w = Math.max(1, bw - gap);
    const base = H - B, yd = y(p.down), yu = y(p.down + p.up);
    const r = Math.min(4, w / 2);
    if (p.up > 0) {
      if (p.down > 0) bars += `<rect class="down" x="${x}" y="${yd}" width="${w}" height="${Math.max(0, base - yd)}"/>`;
      bars += roundTop(x, yu, w, Math.max(0, yd - yu - (p.down > 0 ? 2 : 0)), r, "up");
    } else if (p.down > 0) {
      bars += roundTop(x, yd, w, base - yd, r, "down");
    }
    hits += `<rect class="hit" data-i="${i}" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}"/>`;
    if (i % labelEvery === 0) g += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${esc(axisLabel(p.t, bucket))}</text>`;
  });
  const id = "c" + Math.random().toString(36).slice(2);
  setTimeout(() => {
    const svg = document.getElementById(id);
    if (!svg) return;
    svg.addEventListener("mousemove", e => {
      const h = e.target.closest(".hit");
      if (!h) { tip.hidden = true; return; }
      const p = pts[+h.dataset.i];
      tip.innerHTML = `<b>${esc(tipLabel(p.t, bucket))}</b><br><i class="sw-down"></i>Down ${bytes(p.down)}<br><i class="sw-up"></i>Up ${bytes(p.up)}`;
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 12, innerWidth - 200) + "px";
      tip.style.top = e.clientY + 12 + "px";
    });
    svg.addEventListener("mouseleave", () => tip.hidden = true);
  });
  const rows = pts.filter(p => p.up || p.down).map(p => `<tr><td>${esc(tipLabel(p.t, bucket))}</td><td class="num">${bytes(p.down)}</td><td class="num">${bytes(p.up)}</td></tr>`).join("");
  return `<div class="legend"><span><i class="sw-down"></i>Download</span><span><i class="sw-up"></i>Upload</span></div>
    <svg class="chart" id="${id}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Traffic over time">${g}${bars}${hits}</svg>
    <details><summary>Show as table</summary><div class="scroll"><table><thead><tr><th>Time</th><th class="num">Down</th><th class="num">Up</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
function roundTop(x, y, w, h, r, cls) {
  if (h <= 0) return "";
  r = Math.min(r, h);
  return `<path class="${cls}" d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z"/>`;
}
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function axisLabel(t, bucket) {
  const d = new Date(t * 1000);
  if (bucket < 86400) return d.getHours() === 0 ? d.toLocaleDateString([], { month: "short", day: "numeric" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function tipLabel(t, bucket) {
  const a = new Date(t * 1000), b = new Date((t + bucket) * 1000);
  if (bucket < 86400) return a.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + "–" + b.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (bucket === 86400) return a.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return "Week of " + a.toLocaleDateString([], { month: "short", day: "numeric" });
}

const dest = f => esc(f.dst_ip.includes(":") ? `[${f.dst_ip}]:${f.dst_port}` : `${f.dst_ip}:${f.dst_port}`);
const proto = f => esc([f.network, f.protocol].filter(Boolean).join("/"));
const routeOf = f => esc(f.chain || f.outbound || (f.source === "conntrack" ? "direct (bypasses sing-box)" : ""));

function flowsTable(flows, opts = {}) {
  const cols = [
    { title: "Started", key: "created_at", fmt: f => `<span title="${esc(new Date(f.created_at).toLocaleString())}">${esc(ts(f.created_at))}</span>` },
  ];
  if (opts.device !== false) cols.push({ title: "Device", key: "device_name", fmt: f => devLink(f.device_key, f.device_name) });
  if (opts.target !== false) cols.push({ title: "Domain / IP", key: "target", cls: "wrap", fmt: f => tgtLink(f.target) + srcBadge(f) });
  cols.push(
    { title: "Destination", key: "dst_ip", fmt: dest },
    { title: "Proto", key: "protocol", fmt: proto },
    { title: "Route", key: "chain", fmt: routeOf },
    { title: "Down", key: "down", num: true, fmt: f => bytes(f.down) },
    { title: "Up", key: "up", num: true, fmt: f => bytes(f.up) },
    { title: "Duration", key: "dur", num: true, sortv: f => (f.closed_at || Date.now()) - f.created_at, fmt: f => f.closed_at ? dur(f.closed_at - f.created_at) : `<span title="still open">${dur(Date.now() - f.created_at)} ●</span>` },
  );
  return table(cols, flows || [], { empty: "No flows recorded." });
}

// ---- views ----
async function viewDevices() {
  const showAll = localStorage.getItem("nw.all") === "1";
  const d = await api(`/api/devices?range=${range}${showAll ? "&all=1" : ""}`);
  const devs = d.devices || [];
  const max = Math.max(0, ...devs.map(x => x.up + x.down));
  const tot = devs.reduce((a, x) => (a.up += x.up, a.down += x.down, a), { up: 0, down: 0 });
  main.innerHTML = `
    <h1>Devices</h1><div class="sub">Traffic by device over the last ${esc(range)}.</div>
    <div class="tiles">
      <div class="tile"><div class="v">${devs.filter(x => x.up + x.down > 0).length}</div><div class="l">active devices</div></div>
      <div class="tile"><div class="v">${bytes(tot.down)}</div><div class="l">downloaded</div></div>
      <div class="tile"><div class="v">${bytes(tot.up)}</div><div class="l">uploaded</div></div>
    </div>
    <div class="card">
      <div class="toolbar"><label><input type="checkbox" id="all" ${showAll ? "checked" : ""}> include devices with no traffic in range</label></div>
      ${table([
        { title: "Device", key: "name", fmt: x => devLink(x.key, x.name) + kindBadge(x.kind) },
        { title: "Address", key: "last_ip4", fmt: x => esc(x.last_ip4 || (x.kind === "lan" ? x.last_ip6 : "")) },
        { title: "MAC / key", key: "key", fmt: x => `<span class="muted">${esc(x.key)}</span>` },
        { title: "Down", key: "down", num: true, fmt: x => bytes(x.down) },
        { title: "Up", key: "up", num: true, fmt: x => bytes(x.up) },
        { title: "Share", key: "total", sortv: x => x.up + x.down, fmt: x => share(x.up + x.down, max) },
        { title: "Flows", key: "conns", num: true },
        { title: "Domains", key: "targets", num: true },
        { title: "Open", key: "open", num: true },
        { title: "Last seen", key: "last_seen", fmt: x => esc(ago(x.last_seen)) },
      ], devs, { scroll: false })}
    </div>`;
  $("#all").onchange = e => { localStorage.setItem("nw.all", e.target.checked ? "1" : "0"); route(); };
}

async function viewDevice(key) {
  const d = await api(`/api/device?key=${encodeURIComponent(key)}&range=${range}`);
  const dev = d.device;
  const max = Math.max(0, ...(d.top_targets || []).map(x => x.up + x.down));
  main.innerHTML = `
    <h1>${esc(dev.name)} ${kindBadge(dev.kind)}</h1>
    <div class="sub">${esc(dev.key)}${dev.hostname ? " · hostname " + esc(dev.hostname) : ""}${dev.last_ip4 ? " · " + esc(dev.last_ip4) : ""}
      · first seen ${esc(ts(dev.first_seen))} · last seen ${esc(ago(dev.last_seen))}</div>
    <div class="toolbar">
      <input type="text" id="fname" placeholder="Friendly name" value="${esc(dev.friendly_name)}" maxlength="100">
      <button class="btn" id="save">Save name</button><span id="saved" class="muted"></span>
    </div>
    <div class="tiles">
      <div class="tile"><div class="v">${bytes(d.totals.down)}</div><div class="l">downloaded (${esc(range)})</div></div>
      <div class="tile"><div class="v">${bytes(d.totals.up)}</div><div class="l">uploaded</div></div>
      <div class="tile"><div class="v">${d.totals.conns}</div><div class="l">flows</div></div>
      <div class="tile"><div class="v">${d.totals.targets}</div><div class="l">domains / IPs</div></div>
      <div class="tile"><div class="v">${d.open}</div><div class="l">open now</div></div>
    </div>
    <div class="card"><h2>Traffic over time</h2>${chart(d.series, d.bucket)}</div>
    <div class="grid2">
      <div class="card"><h2>Top domains</h2>${table([
        { title: "Domain / IP", key: "target", cls: "wrap", fmt: t => tgtLink(t.target) },
        { title: "Down", key: "down", num: true, fmt: t => bytes(t.down) },
        { title: "Up", key: "up", num: true, fmt: t => bytes(t.up) },
        { title: "", key: "total", sortv: t => t.up + t.down, fmt: t => share(t.up + t.down, max) },
        { title: "Flows", key: "conns", num: true },
      ], d.top_targets || [])}</div>
      <div class="card"><h2>First seen in this range</h2>
        <div class="muted note">Destinations this device contacted for the first time (since netwatch started recording).</div>
        ${table([
          { title: "Domain / IP", key: "target", cls: "wrap", fmt: t => tgtLink(t.target) },
          { title: "First seen", key: "first_seen", fmt: t => esc(ts(t.first_seen)) },
          { title: "Last seen", key: "last_seen", fmt: t => esc(ago(t.last_seen)) },
        ], d.new_targets || [], { empty: "No new destinations in this range." })}</div>
    </div>
    <div class="card"><h2>Recent flows</h2>${flowsTable(d.recent_flows, { device: false })}</div>
    ${d.ips && d.ips.length ? `<div class="card"><h2>Addresses seen</h2>${table([
      { title: "IP", key: "ip" }, { title: "Source", key: "src" },
      { title: "First seen", key: "first_seen", fmt: i => esc(ts(i.first_seen)) },
      { title: "Last seen", key: "last_seen", fmt: i => esc(ago(i.last_seen)) },
    ], d.ips)}</div>` : ""}`;
  $("#save").onclick = async () => {
    try {
      await api("/api/device/name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, name: $("#fname").value }) });
      $("#saved").textContent = "saved";
      setTimeout(route, 400);
    } catch (e) { $("#saved").textContent = e.message; }
  };
}

async function viewDomains() {
  const q = sessionStorage.getItem("nw.q") || "";
  main.innerHTML = `<h1>Domains</h1><div class="sub">Destinations by traffic over the last ${esc(range)}. Flows without a sniffed domain are listed by destination IP.</div>
    <div class="card"><div class="toolbar"><input type="search" id="q" placeholder="Filter (substring)" value="${esc(q)}"></div><div id="dl"><p class="muted">Loading…</p></div></div>`;
  const load = async () => {
    const v = $("#q").value.trim();
    sessionStorage.setItem("nw.q", v);
    const d = await api(`/api/domains?range=${range}&limit=500&q=${encodeURIComponent(v)}`);
    const max = Math.max(0, ...(d.domains || []).map(x => x.up + x.down));
    $("#dl").innerHTML = table([
      { title: "Domain / IP", key: "target", cls: "wrap", fmt: t => tgtLink(t.target) },
      { title: "Devices", key: "devices", num: true },
      { title: "Down", key: "down", num: true, fmt: t => bytes(t.down) },
      { title: "Up", key: "up", num: true, fmt: t => bytes(t.up) },
      { title: "", key: "total", sortv: t => t.up + t.down, fmt: t => share(t.up + t.down, max) },
      { title: "Flows", key: "conns", num: true },
    ], d.domains || [], { scroll: false });
  };
  let deb;
  $("#q").oninput = () => { clearTimeout(deb); deb = setTimeout(load, 250); };
  await load();
}

async function viewDomain(target) {
  const d = await api(`/api/domain?target=${encodeURIComponent(target)}&range=${range}`);
  const devs = d.devices || [];
  const tot = devs.reduce((a, x) => (a.up += x.up, a.down += x.down, a.c += x.conns, a), { up: 0, down: 0, c: 0 });
  main.innerHTML = `<h1 class="wrap">${esc(target)}</h1><div class="sub">Who contacted this destination in the last ${esc(range)}.</div>
    <div class="tiles">
      <div class="tile"><div class="v">${devs.length}</div><div class="l">devices</div></div>
      <div class="tile"><div class="v">${bytes(tot.down)}</div><div class="l">downloaded</div></div>
      <div class="tile"><div class="v">${bytes(tot.up)}</div><div class="l">uploaded</div></div>
      <div class="tile"><div class="v">${tot.c}</div><div class="l">flows</div></div>
    </div>
    <div class="card"><h2>Traffic over time</h2>${chart(d.series, d.bucket)}</div>
    <div class="card"><h2>Devices</h2>${table([
      { title: "Device", key: "name", fmt: x => devLink(x.key, x.name) + kindBadge(x.kind) },
      { title: "Down", key: "down", num: true, fmt: x => bytes(x.down) },
      { title: "Up", key: "up", num: true, fmt: x => bytes(x.up) },
      { title: "Flows", key: "conns", num: true },
      { title: "First contact", key: "target_first_seen", fmt: x => esc(ts(x.target_first_seen)) },
      { title: "Last contact", key: "target_last_seen", fmt: x => esc(ago(x.target_last_seen)) },
    ], devs)}</div>
    <div class="card"><h2>Recent flows</h2>${flowsTable(d.recent_flows, { target: false })}</div>`;
}

async function viewLive() {
  const f = sessionStorage.getItem("nw.lf") || "";
  main.innerHTML = `<h1>Live</h1><div class="sub">Currently open connections (sing-box stream + conntrack bypass flows), refreshed every 3 s.</div>
    <div class="card"><div class="toolbar"><input type="search" id="lf" placeholder="Filter device / domain / IP" value="${esc(f)}"><span id="lc" class="muted"></span></div><div id="ll"></div></div>`;
  const load = async () => {
    if (!$("#ll")) return;
    const d = await api("/api/live");
    const q = $("#lf").value.trim().toLowerCase();
    sessionStorage.setItem("nw.lf", q);
    const rows = (d.flows || []).filter(x => !q || [x.device_name, x.target, x.dst_ip, x.src_ip, x.device_key].some(s => (s || "").toLowerCase().includes(q)));
    const ru = rows.reduce((a, x) => a + (x.rate_up || 0), 0), rd = rows.reduce((a, x) => a + (x.rate_down || 0), 0);
    $("#lc").textContent = `${rows.length} open · ↓ ${bytes(rd)}/s · ↑ ${bytes(ru)}/s`;
    $("#ll").innerHTML = table([
      { title: "Device", key: "device_name", fmt: x => devLink(x.device_key, x.device_name) },
      { title: "Domain / IP", key: "target", cls: "wrap", fmt: x => tgtLink(x.target) + srcBadge(x) },
      { title: "Destination", key: "dst_ip", fmt: dest },
      { title: "Proto", key: "protocol", fmt: proto },
      { title: "Route", key: "chain", fmt: routeOf },
      { title: "↓ rate", key: "rate_down", num: true, fmt: x => rate(x.rate_down) },
      { title: "↑ rate", key: "rate_up", num: true, fmt: x => rate(x.rate_up) },
      { title: "Down", key: "down", num: true, fmt: x => bytes(x.down) },
      { title: "Up", key: "up", num: true, fmt: x => bytes(x.up) },
      { title: "Age", key: "created_at", num: true, sortv: x => -x.created_at, fmt: x => dur(d.now - x.created_at) },
    ], rows, { scroll: false, empty: "No open connections." });
  };
  $("#lf").oninput = load;
  await load();
  liveTimer = setInterval(() => load().catch(() => {}), 3000);
}

// ---- routing ----
async function route() {
  clearInterval(liveTimer);
  tip.hidden = true;
  const h = location.hash.replace(/^#\/?/, "");
  const [view, ...rest] = h.split("/");
  const arg = decodeURIComponent(rest.join("/"));
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active",
    a.dataset.nav === (view === "device" || view === "" ? "devices" : view === "domain" ? "domains" : view)));
  $("#range").classList.toggle("hidden", view === "live");
  try {
    if (view === "device") await viewDevice(arg);
    else if (view === "domains") await viewDomains();
    else if (view === "domain") await viewDomain(arg);
    else if (view === "live") await viewLive();
    else await viewDevices();
  } catch (e) {
    main.innerHTML = `<p class="err">Error: ${esc(e.message)}</p>`;
  }
}

function setRange(r) {
  range = r;
  localStorage.setItem("nw.range", r);
  document.querySelectorAll("#range button").forEach(b => b.classList.toggle("active", b.dataset.r === r));
}
$("#range").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  setRange(b.dataset.r);
  route();
});

async function status() {
  const el = $("#status");
  try {
    const s = await api("/api/status");
    const ok = s.stream && s.stream.connected;
    const ct = s.conntrack ? ` · conntrack ${s.conntrack.Open} open` : "";
    el.innerHTML = `<span class="dot ${ok ? "dot-ok" : "dot-bad"}"></span>${ok ? "stream connected" : "stream down"} · ${s.open} open${ct}`;
    el.title = ok ? "" : (s.stream.last_error || "");
  } catch { el.textContent = "netwatch unreachable"; }
}

setRange(range);
addEventListener("hashchange", route);
route();
status();
setInterval(status, 10000);
