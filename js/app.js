/* =========================================================
   MoriGraphy — logic trang & luồng đặt lịch
   Không cần build. Dữ liệu lấy từ js/data.js.
   Chỗ cần nối backend được đánh dấu: // TODO(API)
   ========================================================= */
(async function () {
  "use strict";

  /* Lấy dữ liệu mới nhất từ server (admin chỉnh). Không có server → dùng js/data.js */
  let HAS_API = false;
  try {
    // index.html đã bắt đầu tải sẵn từ <head>; không có thì tự tải
    const d = await (window.__MG_DATA || fetch("/api/data", { cache: "no-store" }).then(r => r.ok ? r.json() : null));
    if (d) {
      Object.assign(window, { HERO: d.hero || window.HERO, SECTIONS: d.sections || {}, STUDIO: d.studio, CATEGORIES: d.categories, SERVICES: d.services, PHOTOGRAPHERS: d.photographers, STAFF: d.staff || [], ADDONS: d.addons,
        PRODUCTS: d.products, TRAVEL_ZONES: d.zones, SHIFTS: d.shifts || window.SHIFTS, BOOKING_WINDOW_DAYS: d.bookingWindowDays, EVENING: d.evening, LIVE: d.live || {} });
      HAS_API = true;
    }
  } catch (e) { /* chạy tĩnh */ }

  const S = window.STUDIO, SERVICES = window.SERVICES, PHOTOGRAPHERS = window.PHOTOGRAPHERS,
    ADDONS = window.ADDONS, PRODUCTS = window.PRODUCTS || [] /* đã bỏ mục Sản phẩm; giữ để đọc dữ liệu cũ */, ZONES = window.TRAVEL_ZONES,
    SH = window.SHIFTS, WINDOW_DAYS = window.BOOKING_WINDOW_DAYS;
  // Buổi chụp: sáng / chiều / cả ngày (cả ngày = đầu buổi sáng → hết buổi chiều)
  const SHIFT_LIST = [
    { id: "full", label: "Cả ngày", start: SH.morning.start, end: SH.afternoon.end },
    { id: "morning", label: "Buổi sáng", start: SH.morning.start, end: SH.morning.end },
    { id: "afternoon", label: "Buổi chiều", start: SH.afternoon.start, end: SH.afternoon.end },
  ];
  const shiftById = id => SHIFT_LIST.find(s => s.id === id);
  const shiftText = id => { const s = shiftById(id); return s ? `${s.label} (${s.start} – ${s.end})` : String(id || ""); };
  const M = window.Motion || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------------- Helpers ---------------- */
  const money = n => n.toLocaleString("vi-VN") + "đ";
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = n => String(n).padStart(2, "0");
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const DOW = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
  const DOW_SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  const dateLabel = k => { const d = fromKey(k); return `${DOW[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const initials = name => name.split(" ").slice(-2).map(w => w[0]).join("");
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const svcById = id => SERVICES.find(s => s.id === id);
  const phById = id => PHOTOGRAPHERS.find(p => p.id === id);
  const STAFF = window.STAFF || [];
  const stById = id => STAFF.find(x => x.id === id);
  const zoneById = id => ZONES.find(z => z.id === id) || ZONES[0];
  // Giá đi tỉnh dạng khoảng (fee – feeMax); n = số thám tử
  const feeRange = (z, n = 1) => z.feeMax > z.fee ? `${money(z.fee * n)} – ${money(z.feeMax * n)}` : money(z.fee * n);
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';

  /* ---------------- State (lưu nháp trong trình duyệt) ---------------- */
  const DRAFT_KEY = "mg_draft_v1";
  // Instagram khách: nhận "@ten", "ten" hoặc link instagram.com/ten → "ten"
  const igHandle = v => String(v || "").trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  const IG_RE = /^[A-Za-z0-9._]{1,30}$/;
  const blank = () => ({
    step: 1, serviceId: null, photographerId: "any", staffId: "any", zoneId: ZONES[0].id, nights: 0, address: "",
    date: null, time: "full", evening: false, calMonth: null, addons: {}, products: {},
    customer: { name: "", phone: "", instagram: "", note: "", agree: false },
  });
  let state = blank();
  try { const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); if (saved && saved.step !== "done") state = Object.assign(blank(), saved); } catch (e) { /* bỏ qua */ }
  if (state.date && fromKey(state.date) < today()) { state.date = null; state.time = null; }
  if (state.time && !shiftById(state.time)) state.time = null; // bản nháp cũ còn giờ kiểu "09:00"
  if (!ZONES.some(z => z.id === state.zoneId)) state.zoneId = ZONES[0].id;
  state.products = {}; // mục Sản phẩm đã bỏ — xóa lựa chọn cũ trong bản nháp
  if (!state.photographerId || (state.photographerId !== "any" && !phById(state.photographerId))) state.photographerId = "any";
  state.addons = {}; // form đã bỏ phần dịch vụ đi kèm — xóa lựa chọn cũ trong bản nháp
  delete state.people;
  state.customer = Object.assign({ instagram: "" }, state.customer); delete state.customer.email; state.customer.note = ""; // form đã bỏ ô concept
  if (state.serviceId && !svcById(state.serviceId)) state.serviceId = null;
  if (!state.staffId || (state.staffId !== "any" && !stById(state.staffId))) state.staffId = "any";
  const save = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch (e) { /* bỏ qua */ } };

  /* ---------------- Lịch bận (từ đơn thật trên server) ----------------
     BUSY = { "YYYY-MM-DD": { photographerId: "day" | ["09:00", ...] } } */
  let BUSY = {};
  async function loadBusy() {
    if (!HAS_API) return;
    try { const r = await fetch("/api/availability", { cache: "no-store" }); if (r.ok) BUSY = await r.json(); } catch (e) { /* giữ dữ liệu cũ */ }
  }
  await loadBusy();
  const busyOf = (pid, dateKey) => (BUSY[dateKey] || {})[pid];
  const shiftKey = (k, n) => keyOf(addDays(fromKey(k), n));
  const totalMinutes = () => {
    const s = svcById(state.serviceId); if (!s) return 60;
    return curAddons().reduce((m, a) => m + (a.extraMinutes || 0) * (state.addons[a.id] || 0), 0);
  };
  // Dịch vụ đi kèm theo từng thám tử: chỉ có khi khách chọn đích danh thám tử
  function phAddons(p) { return p ? p.addons || ADDONS || [] : []; }
  function curAddons() { return phAddons(state.photographerId && state.photographerId !== "any" ? phById(state.photographerId) : null); }
  function setPhotographer(id) { // đổi thám tử → bỏ dịch vụ đi kèm của người cũ
    if (id !== state.photographerId && Object.keys(state.addons).length) { state.addons = {}; toast("Dịch vụ đi kèm tùy từng thám tử — đã bỏ các món đã chọn, chọn lại nhé."); }
    state.photographerId = id;
  }
  const eligible = () => { const s = svcById(state.serviceId); return s ? PHOTOGRAPHERS.filter(p => p.services.includes(s.id)) : PHOTOGRAPHERS; };
  function candidates(dateKey) {
    const dow = fromKey(dateKey).getDay();
    const pool = state.photographerId && state.photographerId !== "any" ? [phById(state.photographerId)].filter(Boolean) : eligible();
    return pool.filter(p => p.workDays.includes(dow));
  }
  // Cùng quy tắc với server: đi tỉnh (fullDay) cần trống trọn ngày + số đêm lưu trú
  function freeAt(p, dateKey, shift) {
    if (zoneById(state.zoneId).fullDay) {
      for (let i = 0; i <= (state.nights || 0); i++) if (busyOf(p.id, shiftKey(dateKey, i))) return false;
      return true;
    }
    const e = busyOf(p.id, dateKey); if (e === "day") return false;
    const need = shift === "full" ? ["morning", "afternoon"] : [shift];
    return !need.some(h => e && e.includes(h));
  }
  // Buổi có dùng được với gói + địa điểm đang chọn không (đi tỉnh / gói dài hơn nửa buổi → chỉ "Cả ngày")
  function shiftFits(id, minutes = totalMinutes()) {
    if (id === "full") return true;
    if (zoneById(state.zoneId).fullDay) return false;
    const s = shiftById(id); return minutes <= toMin(s.end) - toMin(s.start);
  }
  const earliestDay = () => addDays(today(), zoneById(state.zoneId).leadDays || 0);
  function slotOpen(dateKey, shift, minutes = totalMinutes()) {
    if (!shiftById(shift) || !shiftFits(shift, minutes)) return false;
    if (fromKey(dateKey) < earliestDay()) return false;
    if (dateKey === keyOf(today())) { const now = new Date(); if (toMin(shiftById(shift).start) <= now.getHours() * 60 + now.getMinutes() + 120) return false; }
    if (!staffFree(dateKey, shift)) return false;
    return candidates(dateKey).some(p => freeAt(p, dateKey, shift));
  }
  // Staff khách chọn đích danh phải làm ngày đó và còn trống buổi đó (để team sắp xếp: không chặn)
  function staffFree(dateKey, shift) {
    const st = state.staffId && state.staffId !== "any" ? stById(state.staffId) : null;
    if (!st) return true;
    return (st.workDays || []).includes(fromKey(dateKey).getDay()) && freeAt(st, dateKey, shift);
  }
  function dayOpen(d) {
    const t = today(); if (d < earliestDay() || d > addDays(t, WINDOW_DAYS)) return false;
    const k = keyOf(d); return SHIFT_LIST.some(s => slotOpen(k, s.id));
  }
  // Ai sẽ chụp (khi để team sắp xếp: thám tử đầu tiên còn trống — server sẽ chốt)
  function assignedPhotographer() {
    if (state.photographerId && state.photographerId !== "any") return phById(state.photographerId);
    if (!state.date || !state.time) return null;
    return candidates(state.date).find(p => freeAt(p, state.date, state.time)) || null;
  }

  /* ---------------- Giá ---------------- */
  // Giá gói theo buổi (cùng quy tắc với server). Chưa chọn buổi: gói/địa điểm chỉ nhận cả ngày thì tính giá cả ngày
  function svcPrice(s) {
    if (!(s.priceFull > 0)) return { v: s.price, label: "Giá gói" };
    const full = state.time ? state.time === "full" : !SHIFT_LIST.some(x => x.id !== "full" && shiftFits(x.id));
    return full ? { v: s.priceFull, label: "Giá gói · cả ngày" } : { v: s.price, label: "Giá gói · nửa ngày" };
  }
  const priceText = s => s.priceFull > 0 ? `${money(s.price)} – ${money(s.priceFull)}` : money(s.price);
  function quote() {
    const s = svcById(state.serviceId), z = zoneById(state.zoneId);
    const rows = []; let total = 0;
    if (s) { const sp = svcPrice(s); rows.push([sp.label, sp.v]); total += sp.v; }
    const p = state.photographerId && state.photographerId !== "any" ? phById(state.photographerId) : null;
    if (p && p.surcharge) { rows.push(["Phụ phí chọn thám tử", p.surcharge]); total += p.surcharge; }
    const stp = state.staffId && state.staffId !== "any" ? stById(state.staffId) : null;
    if (stp && stp.price) { rows.push([`Staff take care · ${stp.name}`, stp.price]); total += stp.price; }
    if (state.evening && EV.price > 0) { rows.push([`Chụp thêm buổi tối đến ${EV.end}`, EV.price]); total += EV.price; }
    if (z.fee && !z.contact) { rows.push([`Phí di chuyển · ${z.short}${z.feeMax > z.fee ? " (mức thấp)" : ""}`, z.fee]); total += z.fee; }
    if (z.perNight && state.nights && !z.contact) { const v = z.perNight * state.nights; rows.push([`Lưu trú ekip × ${state.nights} đêm`, v]); total += v; }
    for (const a of curAddons()) { const q = state.addons[a.id] || 0; if (q) { rows.push([`${a.name} × ${q}`, a.price * q]); total += a.price * q; } }
    for (const pr of PRODUCTS) { const q = state.products[pr.id] || 0; if (q) { rows.push([`${pr.name} × ${q}`, pr.price * q]); total += pr.price * q; } }
    const deposit = Math.round(total * S.depositPercent / 100 / 1000) * 1000;
    return { rows, total, deposit, needsQuote: !!(z.quote || z.contact) };
  }

  /* ---------------- Trang chủ ---------------- */
  function renderStatic() {
    if (window.renderHeroVisual && $("#heroVisual")) $("#heroVisual").innerHTML = window.renderHeroVisual(window.HERO);
    // Chữ trang chủ do admin chỉnh (mục "Trang chủ"); chuỗi rỗng = ẩn dòng
    const ctx = { coc: S.depositPercent, team: S.name };
    if (window.renderHeroCopy && $("#heroCopy")) $("#heroCopy").innerHTML = window.renderHeroCopy(window.HERO, { ...ctx, live: window.LIVE });
    if (window.mergeSections) {
      const secs = window.mergeSections(window.SECTIONS);
      $$("[data-k]").forEach(el => { const [k, f] = el.dataset.k.split("."); const v = (secs[k] || {})[f];
        if (v === undefined) return; el.textContent = window.fillText(v, ctx); el.hidden = !v; });
    }
    $$("[data-studio=name]").forEach(el => (el.textContent = S.name));
    $$("[data-studio=deposit]").forEach(el => (el.textContent = S.depositPercent));
    $("#year").textContent = new Date().getFullYear();
    renderFooter();
    const tel = S.phone.replace(/\s/g, "");
    // Icon nét mảnh cho từng dòng liên hệ (SVG nội tuyến, không tải thêm gì)
    const ic = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const ICONS = {
      "Khu vực": ["pin", ic('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>')],
      "Điện thoại": ["phone", ic('<path d="M5 4h3.5l1.6 4.2-2.1 1.4a11 11 0 0 0 6.4 6.4l1.4-2.1L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5C10.6 20 4 13.4 3.5 5.6A1.5 1.5 0 0 1 5 4z"/>')],
      "Email": ["mail", ic('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5 12 13l8.5-6.5"/>')],
      "Nhận lịch": ["clock", ic('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>')],
      "Facebook": ["fb", ic('<path d="M14.5 8H17V4.5h-2.5A4 4 0 0 0 10.5 8.5V11H8v3.5h2.5V21H14v-6.5h2.6l.4-3.5h-3V9a1 1 0 0 1 1-1z"/>')],
      "Instagram": ["ig", ic('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".9" fill="currentColor" stroke="none"/>')],
    };
    $("#contactList").innerHTML = [
      ["Khu vực", S.area],
      ["Điện thoại", S.phone && `<a href="tel:${tel}">${S.phone}</a> · <a href="https://zalo.me/${tel}" target="_blank" rel="noopener">Zalo</a>`],
      ["Email", S.email && `<a href="mailto:${S.email}">${S.email}</a>`],
      ["Nhận lịch", S.openHours],
      ["Facebook", S.facebook && `<a href="${S.facebook}" target="_blank" rel="noopener">${S.facebook.replace(/^https:\/\/(www\.)?/, "")}</a>`],
      ["Instagram", S.instagram && `<a href="${S.instagram}" target="_blank" rel="noopener">${S.instagram.replace(/^https:\/\/(www\.)?/, "")}</a>`],
    ].filter(([, v]) => v).map(([k, v]) => { const [cls, svg] = ICONS[k] || ["pin", ""];
      return `<li><span class="contact-ic ic-${cls}">${svg}</span><span class="contact-txt"><span class="contact-key">${k}</span><span class="contact-val">${v}</span></span></li>`; }).join("");
  }

  /* Chân trang: lối tắt tới các trang + kênh chat (Zalo / Messenger / Instagram) kèm icon nhỏ */
  function renderFooter() {
    const phone = String(S.phone || "").replace(/[^\d+]/g, "").replace(/^\+84/, "0");
    const handle = (u, host) => { try { const x = new URL(u); if (!x.hostname.includes(host)) return ""; if (x.pathname === "/profile.php") return x.searchParams.get("id") || ""; return x.pathname.split("/").filter(Boolean)[0] || ""; } catch (e) { return ""; } };
    const fb = handle(S.facebook || "", "facebook.com");
    const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
    const ICON = {
      zalo: svg('<rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor"/><path d="M7 9h4.2L7 15h4.4M13.6 8.5V15M15.8 12.6a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
      messenger: svg('<path d="M12 2.5C6.6 2.5 2.5 6.4 2.5 11.6c0 2.7 1.1 5 3 6.6V21.5l2.9-1.6c1.1.3 2.3.5 3.6.5 5.4 0 9.5-3.9 9.5-9.1S17.4 2.5 12 2.5z" fill="currentColor"/><path d="m6.6 14.3 3.2-3.4 2.2 1.8 3.4-1.8-3.2 3.4-2.2-1.8z" fill="#fff"/>'),
      instagram: svg('<rect x="3" y="3" width="18" height="18" rx="5.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/>'),
    };
    const pages = [["#services", "Gói chụp"], ["#team", "Thám tử ảnh"], ["#travel", "Chụp ngoài tỉnh"]].map(([h, l]) => `<a href="${h}">${l}</a>`);
    const social = [
      phone && ["zalo", "Zalo", `https://zalo.me/${phone}`],
      fb && ["messenger", "Messenger", `https://m.me/${fb}`],
      S.instagram && ["instagram", "Instagram", S.instagram],
    ].filter(Boolean).map(([k, l, u]) => `<a href="${u}" target="_blank" rel="noopener" class="fn-social fn-${k}">${ICON[k]}${l}</a>`);
    $("#footerNav").innerHTML = [...pages, ...social].join("");
  }

  let activeCat = "Tất cả";
  function renderServices() {
    $("#categoryFilter").innerHTML = window.CATEGORIES.map(c => `<button type="button" class="chip${c === activeCat ? " is-active" : ""}" data-cat="${c}" aria-pressed="${c === activeCat}">${c}</button>`).join("");
    const list = SERVICES.filter(s => activeCat === "Tất cả" || s.category === activeCat);
    $("#servicesGrid").innerHTML = list.map(s => {
      const no = pad(SERVICES.indexOf(s) + 1);
      return `<article class="card" data-card>
        <div class="card-media folder-media" style="--f: var(--tone-${s.tone || "stone"})" aria-hidden="true">
          <span class="fm-back"></span>
          <span class="fm-paper fm-p2"></span>
          <span class="fm-paper fm-p1"><b>#${no}</b></span>
          <span class="fm-front"><span class="card-tag">HỒ SƠ #${no} · ${s.category.toUpperCase()}</span></span>
        </div>
        <div class="card-body">
          <h3>${s.name}</h3>
          <p class="card-desc">${s.desc}</p>
          <ul class="card-list">${(s.includes || []).map(i => `<li>${i}</li>`).join("")}</ul>
          <div class="card-foot"><span class="price">${s.priceFull > 0 ? `${money(s.price)}<small>nửa ngày</small><br />${money(s.priceFull)}<small>cả ngày</small>` : money(s.price)}</span>
            <span class="card-acts">${s.contact ? `<button type="button" class="btn btn-ghost btn-sm" data-contact-service="${s.id}" aria-expanded="false">Liên hệ team</button>` : ""}<button type="button" class="btn btn-primary btn-sm" data-pick-service="${s.id}">Chọn gói</button></span></div>
          ${s.contact ? `<div class="card-contact" hidden></div>` : ""}
        </div></article>`;
    }).join("");
    if (M.cardsIn) M.cardsIn($$("#servicesGrid [data-card]"));
  }

  function renderTeam() {
    $("#teamGrid").innerHTML = PHOTOGRAPHERS.map((p, i) => `
      <button type="button" class="team-card" data-profile="${p.id}" aria-haspopup="dialog">
        <span class="badge-id">MG-0${i + 1}</span>
        <span class="avatar ph-${p.tone}">${p.avatar ? `<img src="${p.avatar}" alt="" loading="lazy" />` : initials(p.name)}</span>
        <h3>${p.name}</h3>
        <span class="team-meta">${p.role} · ${p.years} năm</span>
        <span class="rating">${STAR}${p.rating} <span class="team-meta">(${p.reviews} đánh giá)</span></span>
        <span class="tags">${p.specialties.map(t => `<span class="tag">${t}</span>`).join("")}</span>
        <span class="more">Xem hồ sơ thám tử →</span>
      </button>`).join("");
  }

  function qtyHTML(kind, id, q, max) {
    return `<span class="qty" role="group" aria-label="Số lượng">
      <button type="button" data-qty="${kind}:${id}:-1" ${q <= 0 ? "disabled" : ""} aria-label="Giảm">−</button>
      <output aria-live="polite">${q}</output>
      <button type="button" data-qty="${kind}:${id}:1" ${q >= (max || 10) ? "disabled" : ""} aria-label="Tăng">+</button></span>`;
  }
  function itemHTML(kind, it, compact) {
    const q = (kind === "addon" ? state.addons : state.products)[it.id] || 0;
    const type = kind === "addon" ? "Dịch vụ" : it.type;
    const control = q || compact ? qtyHTML(kind, it.id, q, it.max) : `<button type="button" class="btn btn-ghost btn-sm" data-qty="${kind}:${it.id}:1">+ Thêm vào hồ sơ</button>`;
    return `<div class="item${q ? " is-selected" : ""}">
      <div class="thumb ph ph-${it.tone}"></div>
      <div class="item-body"><span class="item-type">${type}</span><span class="item-name">${it.name}</span><span class="item-desc">${it.desc}</span>
        <div class="item-foot"><span class="item-price">${money(it.price)} / ${it.unit}</span>${control}</div></div></div>`;
  }
  // Trang chủ: dịch vụ đi kèm gom theo từng thám tử. Bấm thêm = chọn luôn thám tử đó.
  function renderExtras() {
    const groups = PHOTOGRAPHERS.map(p => [p, phAddons(p)]).filter(([, l]) => l.length);
    const grid = $("#addonsGrid"); if (!grid) return; // trang chủ đã bỏ mục này (dịch vụ đi kèm nằm trong form, theo thám tử)
    grid.innerHTML = groups.map(([p, list]) => list.map(a => {
      const mine = state.photographerId === p.id, q = mine ? state.addons[a.id] || 0 : 0;
      const control = q ? qtyHTML("addon", a.id, q, a.max) : `<button type="button" class="btn btn-ghost btn-sm" data-ph-addon="${p.id}:${a.id}">+ Thêm vào hồ sơ</button>`;
      return `<div class="item${q ? " is-selected" : ""}">
      <div class="thumb ph ph-${a.tone}"></div>
      <div class="item-body"><span class="item-type">Thám tử ${esc(p.name)}</span><span class="item-name">${esc(a.name)}</span><span class="item-desc">${esc(a.desc)}</span>
        <div class="item-foot"><span class="item-price">${money(a.price)} / ${esc(a.unit)}</span>${control}</div></div></div>`; }).join("")).join("");
  }

  /* Chụp ngoài tỉnh: chọn nơi chụp + số thám tử → xem phụ phí; bảng đầy đủ gập lại bên dưới */
  const tvState = { zoneId: "", count: 1 };
  const zoneTitle = z => (z.name.split("·")[1] || z.name).trim();
  const zoneFeeText = z => z.contact ? "Liên hệ team" : z.quote ? "Báo giá riêng" : z.fee ? feeRange(z) : "Miễn phí";
  const chatBtns = () => `<div class="chat-links">${chatLinks().map(([l, h, k]) => `<a class="chat-link chat-${k}" href="${esc(h)}" ${k === "call" || k === "sms" ? "" : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join("")}</div>`;
  function travelResult() {
    const z = ZONES.find(x => x.id === tvState.zoneId);
    if (!z) return `<p class="tv-hint">Chọn nơi chụp để xem phụ phí.</p>`;
    const n = tvState.count, per = n > 1 ? ` <small>(${feeRange(z)} × ${n} thám tử)</small>` : "";
    if (z.contact) { smsText = `Chào ${S.name}, mình muốn hỏi phí chụp ở ${zoneTitle(z)}.`; return `<div class="tv-result" aria-live="polite">
        <p class="tv-fee">Phụ phí di chuyển: <strong>Liên hệ team</strong> <small>· thám tử báo giá riêng qua inbox</small></p>
        ${[z.fullDay ? "Chỉ nhận lịch cả ngày" : "", z.leadDays ? `Đặt trước ít nhất ${z.leadDays} ngày` : ""].filter(Boolean).length ? `<p class="tv-extra">${[z.fullDay ? "Chỉ nhận lịch cả ngày" : "", z.leadDays ? `Đặt trước ít nhất ${z.leadDays} ngày` : ""].filter(Boolean).join(" · ")}</p>` : ""}
        ${chatBtns()}
        <button type="button" class="link-btn" data-pick-zone="${z.id}">Chọn nơi này khi đặt lịch →</button></div>`; }
    const main = z.quote ? `<strong>Báo giá riêng</strong>${z.fee ? ` <small>· công tác phí từ ${money(z.fee * n)}/ngày + vé thực tế</small>` : ""}`
      : z.fee ? `<strong>${feeRange(z, n)}</strong> / buổi${per}` : `<strong>Miễn phí di chuyển</strong>`;
    const extra = [
      z.perNight && !z.quote ? `+ ${money(z.perNight * n)} / đêm nếu ekip cần ở lại` : "",
      z.fullDay ? "Chỉ nhận lịch cả ngày" : "",
      z.leadDays ? `Đặt trước ít nhất ${z.leadDays} ngày` : "",
    ].filter(Boolean);
    return `<div class="tv-result" aria-live="polite">
        <p class="tv-fee">Phụ phí di chuyển: ${main}</p>
        ${extra.length ? `<p class="tv-extra">${extra.join(" · ")}</p>` : ""}
        <button type="button" class="link-btn" data-pick-zone="${z.id}">Chọn nơi này khi đặt lịch →</button>
      </div>`;
  }
  function renderTravel() {
    const maxN = Math.max(1, Math.min(6, PHOTOGRAPHERS.length));
    if (tvState.count > maxN) tvState.count = maxN;
    const notes = ZONES.filter(z => z.note).map(z => `<li><b>${esc(zoneTitle(z))}:</b> ${esc(z.note)}</li>`).join("");
    $("#travelGrid").innerHTML = `
      <div class="tv-card reveal">
        <div class="tv-fields">
          <div class="field"><label for="tvZone">Nơi chụp</label>
            <select id="tvZone"><option value="">Chọn nơi chụp…</option>${ZONES.map(z => `<option value="${z.id}" ${z.id === tvState.zoneId ? "selected" : ""}>${esc(zoneTitle(z))} · ${zoneFeeText(z)}</option>`).join("")}</select></div>
          <div class="field"><label for="tvCount">Số thám tử</label>
            <select id="tvCount">${Array.from({ length: maxN }, (_, i) => `<option value="${i + 1}" ${i + 1 === tvState.count ? "selected" : ""}>${i + 1} thám tử</option>`).join("")}</select></div>
        </div>
        <div id="tvResult">${travelResult()}</div>
      </div>
      <details class="tv-table reveal">
        <summary>Xem bảng phụ phí ${ZONES.length} địa điểm</summary>
        <ul class="tv-list">${ZONES.map(z => { const sub = z.examples || z.note || "";
          return `<li><div><b>${esc(zoneTitle(z))}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>
            <div class="tv-price"><strong>${zoneFeeText(z)}</strong>${z.fee && !z.quote && !z.contact ? "<small>/ 1 thám tử</small>" : ""}</div></li>`; }).join("")}</ul>
      </details>
      ${notes ? `<ul class="tv-notes reveal">${notes}</ul>` : ""}`;
  }

  /* ---------------- Đặt lịch ---------------- */
  /* ---------------- Form đặt lịch (gom 1 trang) ---------------- */
  const view = $("#stepView"), errEl = $("#stepError"), btnNext = $("#btnNext");
  // Chụp thêm buổi tối (admin cài giá; 0 = không nhận) và số người tối đa
  const EV = Object.assign({ end: "20:00", price: 500000 }, window.EVENING);
  const halfAllowed = () => SHIFT_LIST.some(s => s.id !== "full" && shiftFits(s.id));
  const isHalf = () => state.time === "morning" || state.time === "afternoon";
  const eveningOk = () => EV.price > 0 && state.time !== "morning";

  // Hộp chọn buổi: Cả ngày / Nửa ngày (→ sáng / chiều). Buổi đã kín ngày đang chọn thì mờ.
  function renderShift() {
    const box = $("#shiftBox"); if (!box) return;
    const s = svcById(state.serviceId), mins = totalMinutes(), z = zoneById(state.zoneId), canHalf = halfAllowed();
    const open = id => (!state.date || slotOpen(state.date, id, mins)) && shiftFits(id, mins);
    const full = shiftById("full"), two = s && s.priceFull > 0;
    const btn = (attr, val, on, ok, label, sub) => `<button type="button" class="seg-btn${on ? " is-on" : ""}" data-${attr}="${val}" aria-pressed="${on}" ${ok ? "" : "disabled"}>${label}<small>${sub}</small></button>`;
    box.innerHTML = `<div class="seg">
        ${btn("time", "full", state.time === "full", open("full"), "Cả ngày", two ? money(s.priceFull) : `${full.start} – ${full.end}`)}
        ${btn("mode", "half", isHalf(), canHalf && (open("morning") || open("afternoon")), "Nửa ngày", two ? money(s.price) : "Sáng hoặc chiều")}
      </div>
      ${isHalf() ? `<div class="seg seg-sub">${["morning", "afternoon"].map(id => { const sh = shiftById(id); return btn("time", id, state.time === id, open(id), sh.label, `${sh.start} – ${sh.end}`); }).join("")}</div>` : ""}
      <p class="hint">${z.fullDay ? "Chụp đi tỉnh chỉ nhận lịch cả ngày."
        : !canHalf ? `Gói này cần khoảng ${Math.ceil(mins / 60)} tiếng nên chỉ nhận lịch cả ngày.`
        : state.date ? "Nút mờ là buổi đó đã kín lịch trong ngày bạn chọn." : `Cả ngày ${full.start} – ${full.end}, nghỉ trưa ${SH.morning.end} – ${SH.afternoon.start}.`}</p>`;
  }
  function renderEvening() {
    const box = $("#eveningBox"); if (!box) return;
    if (!(EV.price > 0)) { box.innerHTML = ""; return; }
    const ok = eveningOk(); if (!ok) state.evening = false;
    box.innerHTML = `<label class="check ev-check${ok ? "" : " is-off"}"><input type="checkbox" name="evening" ${state.evening ? "checked" : ""} ${ok ? "" : "disabled"} />
      <span>Chụp thêm buổi tối đến ${EV.end.replace(":00", "h")} (+${money(EV.price)})${ok ? "" : `<small>Chỉ nhận khi chụp cả ngày hoặc buổi chiều.</small>`}</span></label>`;
  }
  function renderDateNote() { const n = $("#dateNote"); if (n) n.textContent = state.date ? `Đã chọn: ${dateLabel(state.date)}` : "Ngày mờ là đã kín lịch hoặc thám tử nghỉ."; }
  // Vẽ lại các phần phụ thuộc ngày / buổi (không vẽ lại cả form để không mất chỗ đang gõ)
  function renderSlots() { renderShift(); renderEvening(); renderDateNote(); }
  function renderAddons() {
    const box = $("#addonBox"); if (!box) return;
    const list = curAddons();
    if (!list.length) { box.innerHTML = `<p class="hint" style="margin:0">${state.photographerId && state.photographerId !== "any" ? "Thám tử này chưa có dịch vụ đi kèm." : "Mỗi thám tử có đồ riêng — chọn thám tử ở trên để xem dịch vụ đi kèm."}</p>`; return; }
    box.innerHTML = list.map(a => { const q = state.addons[a.id] || 0;
      return `<div class="bk-addon${q ? " is-on" : ""}"><span><b>${esc(a.name)}</b><small>${money(a.price)} / ${esc(a.unit)}</small></span>${qtyHTML("addon", a.id, q, a.max)}</div>`; }).join("");
  }

  function renderForm() {
    const s = svcById(state.serviceId), z = zoneById(state.zoneId), c = state.customer, el = eligible();
    const f = (id, label, type, val, ph, extra = "", hint = "") => `<div class="field" data-field="${id}"><label for="f_${id}">${label}</label>
      <input id="f_${id}" name="${id}" type="${type}" value="${esc(val)}" placeholder="${ph}" ${extra} />${hint ? `<span class="hint">${hint}</span>` : ""}<span class="err"></span></div>`;
    const avatar = x => x && x.avatar ? `<img src="${x.avatar}" alt="" />` : x ? initials(x.name) : "?";
    const pickPh = state.photographerId && state.photographerId !== "any" ? phById(state.photographerId) : null;
    view.innerHTML = `<div class="bk-form">
      <div class="field" data-field="service"><label for="f_service">Gói chụp</label>
        <select id="f_service" name="service"><option value="" ${s ? "" : "selected"} disabled>Chọn gói chụp…</option>
          ${SERVICES.map(x => `<option value="${x.id}" ${x.id === state.serviceId ? "selected" : ""}>${esc(x.name)} · ${priceText(x)}</option>`).join("")}</select>
        ${s ? `<span class="hint">${esc(s.category)}${(s.includes || []).length ? " · " + esc(s.includes.slice(0, 2).join(", ")) : ""}</span>` : ""}<span class="err"></span></div>

      <div class="field" data-field="photographer"><label for="f_photographer">Thám tử muốn chụp</label>
        <div class="bk-pick"><span class="opt-avatar ph-${pickPh ? pickPh.tone : "stone"}" aria-hidden="true">${pickPh ? avatar(pickPh) : "?"}</span>
        <select id="f_photographer" name="photographer"><option value="any" ${!pickPh ? "selected" : ""}>Chưa chọn, để team sắp xếp · không phụ phí</option>
          ${PHOTOGRAPHERS.map(p => { const ok = el.includes(p); return `<option value="${p.id}" ${p === pickPh ? "selected" : ""} ${ok ? "" : "disabled"}>${esc(p.name)}${ok ? (p.surcharge ? " · +" + money(p.surcharge) : "") : " · không nhận gói này"}</option>`; }).join("")}</select></div>
        ${pickPh ? `<button type="button" class="link-btn bk-link" data-profile="${pickPh.id}">Xem hồ sơ ${esc(pickPh.name)}</button>` : ""}</div>

      ${STAFF.length ? `<div class="field" data-field="staff"><label for="f_staff">Staff take care buổi chụp</label>
        <select id="f_staff" name="staff"><option value="any" ${state.staffId === "any" ? "selected" : ""}>Để team sắp xếp · không phụ phí</option>
          ${STAFF.map(x => `<option value="${x.id}" ${x.id === state.staffId ? "selected" : ""}>${esc(x.name)}${x.role ? " · " + esc(x.role) : ""} · ${x.price ? "+" + money(x.price) : "miễn phí"}</option>`).join("")}</select>
        <span class="hint">Hỗ trợ tạo dáng, chỉnh trang phục, đạo cụ trong buổi chụp.</span></div>` : ""}

      <div class="field" data-field="time"><span class="label">Chụp cả ngày hay nửa ngày</span><div id="shiftBox"></div><span class="err"></span></div>


      ${f("name", "Tên bạn", "text", c.name, "Nguyễn Văn A", 'autocomplete="name"')}
      ${f("phone", "Số điện thoại", "tel", c.phone, "0901 234 567", 'autocomplete="tel" inputmode="tel"', "Team gọi / nhắn Zalo số này để xác nhận.")}
      ${f("instagram", "Instagram của bạn", "text", c.instagram, "@tenban", 'autocomplete="off" autocapitalize="off" spellcheck="false"', "Team nhắn Instagram này để gửi concept, ảnh mẫu.")}

      <div class="field" data-field="date"><span class="label">Ngày chụp</span><div id="calendar"></div><p class="hint" id="dateNote"></p><span class="err"></span></div>

      <div class="field" data-field="zone"><label for="f_zone">Tỉnh / thành chụp</label>
        <select id="f_zone" name="zone">${ZONES.map(zz => `<option value="${zz.id}" ${zz.id === state.zoneId ? "selected" : ""}>${esc(zz.name)} · ${zz.contact ? "liên hệ báo giá" : zz.fee ? (zz.quote ? "báo giá riêng" : "+" + feeRange(zz)) : "miễn phí đi lại"}</option>`).join("")}</select>
        ${z.leadDays || z.quote || z.contact ? `<span class="hint">${z.leadDays ? `Đặt trước ít nhất ${z.leadDays} ngày. ` : ""}${z.contact ? "Phí đi lại thám tử báo giá riêng qua inbox." : z.quote ? esc(z.note || "") + " Tạm tính chưa gồm vé di chuyển." : ""}</span>` : ""}</div>
      ${f("address", "Địa điểm cụ thể (trường, quận/huyện)", "text", state.address, "VD: ĐH Thương Mại, Cầu Giấy", 'autocomplete="street-address"')}
      ${z.perNight && !z.quote && !z.contact ? `<div class="field"><label for="f_nights">Ekip ở lại qua đêm</label>
        <select id="f_nights" name="nights">${[0, 1, 2, 3].map(n => `<option value="${n}" ${n === state.nights ? "selected" : ""}>${n ? n + " đêm · +" + money(z.perNight * n) : "Không, đi về trong ngày"}</option>`).join("")}</select></div>` : ""}

      <div id="eveningBox"></div>



      <label class="check" data-field="agree"><input type="checkbox" name="agree" ${c.agree ? "checked" : ""} />
        <span>Tôi đồng ý đặt cọc ${S.depositPercent}% để giữ lịch${(S.payment && S.payment.enabled) || PHOTOGRAPHERS.some(x => x.hasOwnPayment) ? " (chuyển khoản qua mã QR sau khi gửi)" : ""}. Cọc được hoàn nếu báo dời/hủy trước 72 giờ.<span class="err" style="display:block"></span></span></label>
    </div>`;
    renderCalendar(); renderSlots(); renderAddons();
  }

  // Hiện form (sau khi chọn gói / thám tử / khu vực từ trang khác, hoặc đặt lịch mới)
  function showForm({ scroll = false, focus = null } = {}) {
    if (scroll) openPage("booking");
    state.step = 1; errEl.textContent = "";
    renderForm(); refreshSummary(); $("#stepNav").hidden = false;
    btnNext.textContent = "Gửi hồ sơ đặt lịch"; btnNext.disabled = false;
    if (M.stepIn) M.stepIn(view);
    if (focus) { const x = $("#" + focus); if (x) x.focus({ preventScroll: true }); }
  }
  // Vẽ lại form giữ nguyên vị trí cuộn và ô đang chọn
  function rerender(focusId) { const y = window.scrollY; renderForm(); window.scrollTo(0, y); if (focusId) { const x = $("#" + focusId); if (x) x.focus({ preventScroll: true }); } refreshSummary(); }

  function fail(msg, fieldName) {
    errEl.textContent = msg;
    if (fieldName) { const f = view.querySelector(`[data-field="${fieldName}"]`); if (f) { f.classList.add("has-error"); const e = f.querySelector(".err"); if (e) e.textContent = msg;
      f.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      const inp = f.querySelector("input,select"); if (inp) inp.focus({ preventScroll: true }); } }
    if (M.shake) M.shake(errEl);
    return false;
  }

  function validate() {
    $$(".has-error", view).forEach(f => { f.classList.remove("has-error"); const e = f.querySelector(".err"); if (e) e.textContent = ""; });
    errEl.textContent = "";
    const c = state.customer;
    if (!state.serviceId) return fail("Chọn gói chụp.", "service");
    if (!state.photographerId) state.photographerId = "any";
    if (c.name.trim().length < 2) return fail("Nhập tên của bạn.", "name");
    if (!/^(0|\+84)\d{9}$/.test(c.phone.replace(/[\s.-]/g, ""))) return fail("Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).", "phone");
    if (!c.instagram.trim()) return fail("Nhập Instagram của bạn.", "instagram");
    if (!IG_RE.test(igHandle(c.instagram))) return fail("Instagram chưa đúng (chỉ chữ, số, dấu chấm, gạch dưới).", "instagram");
    if (!state.date) return fail("Chọn ngày chụp trên lịch.", "date");
    if (!state.time) return fail("Chọn chụp cả ngày hay nửa ngày (sáng / chiều).", "time");
    if (!slotOpen(state.date, state.time)) { state.time = null; renderSlots(); refreshSummary(); return fail("Buổi này không còn trống hoặc không đủ thời gian cho gói + dịch vụ thêm. Chọn buổi khác.", "time"); }
    if (state.address.trim().length < 5) return fail("Nhập địa điểm cụ thể.", "address");
    if (!c.agree) return fail("Vui lòng đồng ý điều khoản đặt cọc.", "agree");
    return true;
  }

  /* Lịch + khung giờ (vẽ lại riêng để không giật cả bước) */
  function renderCalendar() {
    const box = $("#calendar"); if (!box) return;
    const t = today(), last = addDays(t, WINDOW_DAYS);
    if (!state.calMonth) state.calMonth = state.date ? state.date.slice(0, 7) : keyOf(t).slice(0, 7);
    const [y, m] = state.calMonth.split("-").map(Number);
    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), offset = (first.getDay() + 6) % 7;
    const prevOk = new Date(y, m - 1, 0) >= t, nextOk = new Date(y, m, 1) <= last;
    let cells = DOW_SHORT.map(d => `<span class="cal-dow">${d}</span>`).join("");
    for (let i = 0; i < offset; i++) cells += "<span></span>";
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m - 1, d), k = keyOf(date), open = dayOpen(date);
      const cls = ["cal-day", k === state.date ? "is-selected" : "", k === keyOf(t) ? "is-today" : ""].join(" ");
      cells += `<button type="button" class="${cls}" data-date="${k}" ${open ? "" : "disabled"} aria-pressed="${k === state.date}" aria-label="${dateLabel(k)}${open ? "" : " — không còn lịch"}">${d}</button>`;
    }
    box.innerHTML = `<div class="cal-head"><button type="button" class="cal-nav" data-month="-1" ${prevOk ? "" : "disabled"} aria-label="Tháng trước">‹</button>
      <strong>Tháng ${m}, ${y}</strong><button type="button" class="cal-nav" data-month="1" ${nextOk ? "" : "disabled"} aria-label="Tháng sau">›</button></div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend"><span><i style="background:var(--accent)"></i>Đã chọn</span><span><i style="border:1px solid var(--line);background:var(--surface)"></i>Còn trống</span><span><i style="background:var(--alt)"></i>Hết lịch / thám tử nghỉ</span></div>`;
  }
  function renderSummary(prevTotal) {
    const s = svcById(state.serviceId), z = zoneById(state.zoneId), q = quote();
    const p = state.photographerId === "any" ? null : phById(state.photographerId);
    const row = (k, v) => `<div class="sum-row"><span>${k}</span><span>${v}</span></div>`;
    if (!s) { $("#summaryBody").innerHTML = `<p class="sum-empty">Chưa có gói chụp. Chọn gói ở ô đầu tiên của form.</p>`; return; }
    let html = row("Gói chụp", s.name)
      + row("Thám tử", p ? p.name : state.photographerId === "any" ? "Team sắp xếp" : "—")
      + (STAFF.length ? row("Staff take care", state.staffId !== "any" && stById(state.staffId) ? esc(stById(state.staffId).name) : "Team sắp xếp") : "")
      + row("Địa điểm", z.short + (state.address ? " · " + esc(state.address) : ""))
      + row("Lịch", state.date ? `${dateLabel(state.date).replace(/, (\d+)\/(\d+)\/\d+/, " $1/$2")}${state.time ? " · " + (shiftById(state.time) || {}).label : ""}${state.evening ? " + tối" : ""}` : "—");
    html += `<hr class="sum-sep" />` + q.rows.map(([k, v]) => row(k, money(v))).join("");
    html += `<hr class="sum-sep" /><div class="sum-total"><span>Tạm tính${q.needsQuote ? "*" : ""}</span><strong id="sumTotal">${money(q.total)}</strong></div>`
      + `<div class="sum-row sum-deposit"><span>Đặt cọc ${S.depositPercent}%</span><span>${money(q.deposit)}</span></div>`
      + `<p class="sum-fine">${z.contact ? "* Phí đi lại thám tử báo giá riêng qua inbox. " : q.needsQuote ? "* Chưa gồm vé di chuyển xa, team báo giá riêng. " : ""}${z.feeMax > z.fee && !z.contact ? `Phí di chuyển ${esc(z.short)} thực tế từ ${money(z.fee)} đến ${money(z.feeMax)}, team báo chính xác khi gọi. ` : ""}Thanh toán phần còn lại sau buổi chụp.</p>`;
    $("#summaryBody").innerHTML = html;
    if (prevTotal != null && prevTotal !== q.total && M.pulse) M.pulse($("#sumTotal"));
  }

  let lastTotal = null;
  function refreshSummary() { const t = quote().total; renderSummary(lastTotal); lastTotal = t; save(); }

  function bookingCode() {
    const d = fromKey(state.date), chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let r = ""; for (let i = 0; i < 4; i++) r += chars[Math.floor(Math.random() * chars.length)];
    return `MG-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${r}`;
  }

  /* ---------------- Hoá đơn hồ sơ (ảnh PNG vẽ bằng canvas, khách tải về máy) ---------------- */
  let lastInvoice = null;
  async function drawInvoice(b, q, paid) {
    try { await Promise.race([Promise.all(['800 40px "Baloo 2"', '700 20px "Nunito"', '400 20px "Nunito"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* dùng font hệ thống */ }
    const W = 1080, P = 84, INK = "#15223B", RED = "#B8302A", MUTED = "#6B6A63", PAPER = "#FBF6EA", LINE = "#D9CFB8";
    const SERIF = '"Baloo 2", "Nunito", sans-serif', SANS = '"Nunito", system-ui, sans-serif';
    const s = svcById(b.serviceId) || {}, z = zoneById(b.zoneId) || {};
    const cv = document.createElement("canvas"), x = cv.getContext("2d");
    const wrap = (text, font, max) => { x.font = font; const out = []; let line = "";
      for (const w of String(text).split(/\s+/)) { const t = line ? line + " " + w : w; if (x.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; }
      if (line) out.push(line); return out.length ? out : [""]; };
    const info = [
      ["Khách hàng", b.customer.name], ["Điện thoại", b.customer.phone], b.customer.instagram ? ["Instagram", "@" + igHandle(b.customer.instagram)] : null,
      ["Gói chụp", s.name || ""], ["Thám tử", b.photographerName || "Team sắp xếp"], b.staffName ? ["Staff take care", b.staffName] : null,
      ["Ngày chụp", `${dateLabel(b.date)} · ${shiftText(b.time)}${b.evening ? ` + tối đến ${EV.end}` : ""}`],
      ["Địa điểm", `${z.short || ""} · ${b.address}`],
    ].filter(Boolean);
    const LBL = 250, VAL = W - 2 * P - LBL, VFONT = `700 30px ${SANS}`, IFONT = `600 28px ${SANS}`;
    const plan = []; let y = 0;
    const add = (h, fn) => { plan.push([y, fn]); y += h; };
    // Đầu hoá đơn
    add(270, y0 => {
      x.fillStyle = RED; x.font = `700 24px ${SANS}`; x.fillText("HỒ SƠ ĐẶT LỊCH CHỤP · HOÁ ĐƠN", P, y0 + 70);
      x.fillStyle = INK; x.font = `800 72px ${SERIF}`; x.fillText(S.name, P, y0 + 148);
      x.fillStyle = MUTED; x.font = `600 26px ${SANS}`; const d = new Date();
      x.fillText(`Mã hồ sơ ${b.code} · lập ngày ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`, P, y0 + 222);
    });
    const dash = () => add(44, y0 => { x.strokeStyle = LINE; x.lineWidth = 3; x.setLineDash([14, 10]); x.beginPath(); x.moveTo(P, y0 + 22); x.lineTo(W - P, y0 + 22); x.stroke(); x.setLineDash([]); });
    dash();
    for (const [k, v] of info) { const lines = wrap(v, VFONT, VAL);
      add(18 + lines.length * 42, y0 => { x.fillStyle = MUTED; x.font = `600 26px ${SANS}`; x.fillText(k, P, y0 + 40);
        x.fillStyle = INK; x.font = VFONT; lines.forEach((l, i) => x.fillText(l, P + LBL, y0 + 40 + i * 42)); }); }
    add(20, () => {}); dash();
    add(60, y0 => { x.fillStyle = RED; x.font = `700 24px ${SANS}`; x.fillText("CHI TIẾT", P, y0 + 40); });
    for (const [k, v] of q.rows) { const lines = wrap(k, IFONT, W - 2 * P - 230);
      add(12 + lines.length * 40, y0 => { x.fillStyle = INK; x.font = IFONT; lines.forEach((l, i) => x.fillText(l, P, y0 + 38 + i * 40));
        x.textAlign = "right"; x.font = `700 28px ${SANS}`; x.fillText(money(v), W - P, y0 + 38); x.textAlign = "left"; }); }
    add(20, () => {}); dash();
    const sumRow = (k, v, color, big) => add(big ? 70 : 54, y0 => { x.fillStyle = color; x.font = `${big ? 800 : 700} ${big ? 44 : 30}px ${big ? SERIF : SANS}`;
      x.fillText(k, P, y0 + (big ? 52 : 40)); x.textAlign = "right"; x.fillText(v, W - P, y0 + (big ? 52 : 40)); x.textAlign = "left"; });
    sumRow("Tổng tạm tính", money(q.total) + (q.needsQuote ? "*" : ""), INK, true);
    sumRow(`Đặt cọc ${S.depositPercent}%`, money(q.deposit), RED);
    sumRow("Còn lại thanh toán ngày chụp", money(Math.max(0, q.total - (paid || q.deposit))), MUTED);
    if (q.needsQuote) add(44, y0 => { x.fillStyle = MUTED; x.font = `italic 600 22px ${SANS}`; x.fillText((zoneById(b.zoneId) || {}).contact ? "* Phí đi lại thám tử báo giá riêng qua inbox." : "* Phí đi lại báo giá riêng theo vé thực tế.", P, y0 + 30); });
    add(30, () => {}); dash();
    const foot = [S.phone ? `Liên hệ team: ${S.phone} (Zalo)` : "", "Cảm ơn bạn đã gửi hồ sơ cho văn phòng thám tử ảnh!"].filter(Boolean);
    add(30 + foot.length * 40, y0 => { x.fillStyle = MUTED; x.font = `600 26px ${SANS}`; x.textAlign = "center"; foot.forEach((l, i) => x.fillText(l, W / 2, y0 + 44 + i * 40)); x.textAlign = "left"; });
    const H = y + 60;
    cv.width = W; cv.height = H + 40;
    // Giấy hồ sơ: nền kem, tab kẹp hồ sơ, viền
    x.fillStyle = "#E9DFC6"; x.fillRect(0, 0, W, H + 40);
    x.fillStyle = "#D8C79F"; x.beginPath(); x.roundRect(P - 20, 14, 330, 60, 14); x.fill();
    x.fillStyle = INK; x.font = `700 22px ${SANS}`; x.fillText("HỒ SƠ #" + b.code, P + 2, 52);
    x.fillStyle = PAPER; x.beginPath(); x.roundRect(28, 56, W - 56, H - 30, 22); x.fill();
    x.strokeStyle = LINE; x.lineWidth = 2; x.stroke();
    x.save(); x.translate(0, 40); for (const [y0, fn] of plan) fn(y0); x.restore();
    // Con dấu đỏ
    x.save(); x.translate(W - P - 150, 40 + 112); x.rotate(-0.18); x.globalAlpha = .85;
    x.strokeStyle = RED; x.lineWidth = 6; x.beginPath(); x.roundRect(-150, -58, 300, 116, 12); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.roundRect(-138, -46, 276, 92, 8); x.stroke();
    x.fillStyle = RED; x.textAlign = "center"; x.font = `800 40px ${SERIF}`; x.fillText(paid ? "ĐÃ CỌC" : "ĐÃ MỞ HỒ SƠ", 0, 8);
    x.font = `700 18px ${SANS}`; x.fillText(paid ? `${money(paid)} · giữ lịch` : "CHỜ ĐẶT CỌC", 0, 34); x.restore();
    return cv;
  }
  async function renderInvoice(paid) {
    const box = document.getElementById("invoiceBox"); if (!box || !lastInvoice) return;
    const { b, q } = lastInvoice, cv = await drawInvoice(b, q, paid);
    const url = cv.toDataURL("image/png"), name = `${S.name}-hoa-don-${b.code}.png`;
    box.innerHTML = `<img class="invoice-img" src="${url}" alt="Hoá đơn hồ sơ ${esc(b.code)}: ${esc(b.customer.name)}, tổng ${money(q.total)}, đặt cọc ${money(q.deposit)}" />
      <a class="btn btn-primary" href="${url}" download="${esc(name)}" id="btnInvoice">Tải hoá đơn về máy</a>
      <p class="sum-fine">Trên điện thoại cũng có thể nhấn giữ vào ảnh rồi chọn “Lưu ảnh”.</p>`;
  }

  async function submit() {
    btnNext.disabled = true; btnNext.textContent = "Đang gửi…";
    const q = quote(), ph = assignedPhotographer();
    const payload = { serviceId: state.serviceId, photographerId: state.photographerId, staffId: state.staffId || "any", zoneId: state.zoneId, address: state.address, nights: state.nights,
      date: state.date, time: state.time, evening: !!state.evening, addons: state.addons, products: {}, customer: state.customer };
    let code, photographerName = null, staffName = null, transferNote = null, payTo = null, viewToken = null;
    if (HAS_API) {
      try {
        const r = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const res = await r.json().catch(() => ({}));
        if (r.status === 409) {
          // Giờ vừa bị người khác đặt: tải lại lịch bận, quay về bước 3
          btnNext.disabled = false; btnNext.textContent = "Gửi hồ sơ đặt lịch"; await loadBusy(); state.time = null;
          renderCalendar(); renderSlots(); refreshSummary(); fail(res.error || "Buổi này vừa có người đặt, chọn buổi khác.", "time"); return;
        }
        if (!r.ok) { btnNext.disabled = false; btnNext.textContent = "Gửi hồ sơ đặt lịch"; return fail(res.error || "Không gửi được, thử lại sau."); }
        code = res.code; q.total = res.total; q.deposit = res.deposit; photographerName = res.photographerName; staffName = res.staffName || null; transferNote = res.transferNote; payTo = res.payTo || null; viewToken = res.viewToken || null; // chốt theo server
        await loadBusy();
      } catch (e) { btnNext.disabled = false; btnNext.textContent = "Gửi hồ sơ đặt lịch"; return fail("Mất kết nối, thử lại sau."); }
    } else {
      // Chế độ tĩnh (không có server): chỉ lưu trong trình duyệt để demo
      code = bookingCode();
      try { const all = JSON.parse(localStorage.getItem("mg_bookings") || "[]"); all.push({ code, ...payload }); localStorage.setItem("mg_bookings", JSON.stringify(all)); } catch (e) { /* bỏ qua */ }
    }
    btnNext.disabled = false;
    showSuccess({ code, ...payload, transferNote, payTo, viewToken, photographerName: photographerName || (ph ? ph.name : null),
      staffName: staffName || (STAFF.length ? (stById(state.staffId) || {}).name || "Team sắp xếp" : null) }, q, ph);
  }

  /* QR chuyển khoản tiền cọc (VietQR) — chỉ hiện khi admin đã bật & nhập tài khoản */
  function payBlock(b, q) {
    // Có server: dùng tài khoản server chọn (TK riêng của thám tử nhận đơn, hoặc TK team). Chạy tĩnh: TK team.
    const p = HAS_API ? b.payTo : (S.payment && S.payment.enabled ? S.payment : null);
    if (!p || !q.deposit || !window.VietQR) return "";
    const note = b.transferNote || b.code.replace(/-/g, "") + " COC";
    let url = null;
    try { url = VietQR.dataURL(VietQR.payload({ bin: p.bankBin, account: p.accountNo, amount: q.deposit, info: note })); } catch (e) { return ""; }
    const bank = p.bankLabel || VietQR.bankName(p.bankBin) || "BIN " + p.bankBin;
    const line = (k, v, copy) => `<div class="pay-row"><span>${k}</span><b>${esc(v)}</b>${copy ? `<button type="button" class="link-btn" data-copy="${esc(copy)}">Sao chép</button>` : ""}</div>`;
    return `<section class="pay-box" aria-label="Thanh toán tiền cọc">
      ${url ? `<figure class="pay-qr"><img src="${url}" alt="Mã QR chuyển khoản ${money(q.deposit)} tới ${esc(bank)}" width="220" height="220" /><figcaption>VietQR · quét bằng app ngân hàng</figcaption></figure>` : ""}
      <div class="pay-info">
        <h4>Đặt cọc ${S.depositPercent}% để giữ lịch</h4>${p.owner === "photographer" ? `<p class="sum-fine" style="margin:-2px 0 4px">Chuyển vào tài khoản của thám tử ${esc(p.ownerName)}.</p>` : ""}
        ${line("Ngân hàng", bank)}${line("Số tài khoản", p.accountNo, p.accountNo)}${line("Chủ tài khoản", p.accountName)}
        ${line("Số tiền", money(q.deposit), String(q.deposit))}${line("Nội dung", note, note)}
        ${url ? `<a class="btn btn-ghost btn-sm" href="${url}" download="${S.name}-coc-${b.code}.gif">Tải mã QR</a>` : ""}
        <p class="sum-fine">Số tiền và nội dung đã có sẵn trong mã. Giữ đúng nội dung để team đối soát nhanh.</p>
      </div></section>`;
  }

  async function showSuccess(b, q, ph) {
    if (M.stepOut) await M.stepOut(view);
    const pay = payBlock(b, q);
    // Gói có tick "Liên hệ team": hiện ngay các kênh chat với team trên trang đặt xong
    const svc = svcById(b.serviceId), bz = zoneById(b.zoneId) || {}, contact = svc && (svc.contact || bz.contact) ? (() => {
      smsText = `Chào ${S.name}, mình là ${b.customer.name}, mã hồ sơ ${b.code} (gói “${svc.name}”). Mình muốn trao đổi thêm với team.`;
      return `<section class="success-contact" aria-label="Liên hệ team"><h4>Liên hệ team</h4><p class="sum-fine">${bz.contact ? `Nhắn team để thám tử báo phí đi lại ${esc(bz.short || bz.name)}.` : `Nhắn team để trao đổi thêm về gói “${esc(svc.name)}”.`}</p>
        <div class="chat-links">${chatLinks().map(([l, h, k]) => `<a class="chat-link chat-${k}" href="${esc(h)}" ${k === "call" || k === "sms" ? "" : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join("")}</div></section>`; })() : "";
    view.innerHTML = `<div class="success">
      <svg class="success-icon" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="40"/><path d="M26 41l9 9 19-20"/></svg>
      <h3 tabindex="-1">Hồ sơ đã được mở!</h3>
      <p class="step-sub" style="max-width:480px;margin:0">${pay
        ? "Quét mã bên dưới để đặt cọc giữ lịch. Team đối soát và gọi xác nhận trong vòng 2 giờ làm việc."
        : "Team sẽ gọi xác nhận trong vòng 2 giờ làm việc và gửi thông tin đặt cọc qua Zalo/SMS."}</p>
      <span class="case-code">Mã hồ sơ: ${b.code}</span>
      <div class="invoice" id="invoiceBox" aria-live="polite"><p class="sum-fine">Đang lập hoá đơn…</p></div>
      ${pay}
      ${pay && b.viewToken ? `<div class="deposit-status" id="depositStatus" role="status" aria-live="polite">
        <span class="dot-wait" aria-hidden="true"></span><div><b>Đang chờ tiền cọc…</b><small>Chuyển khoản xong, trang này tự cập nhật trong vài giây.</small></div>
        <button type="button" class="btn btn-ghost btn-sm" id="btnCheckPaid">Tôi đã chuyển khoản</button></div>` : ""}
      ${contact}
      <div id="chatBox"></div>
      <div class="success-actions">
        <button type="button" class="btn btn-ghost" id="btnNew">Đặt lịch mới</button>
      </div></div>`;
    state.step = "done"; $("#stepNav").hidden = true;
    lastInvoice = { b, q }; renderInvoice();
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* bỏ qua */ }
    if (M.successIn) M.successIn(view); else if (M.stepIn) M.stepIn(view);
    $(".success h3").focus({ preventScroll: true });
    if (pay && b.viewToken) watchDeposit(b);
  }

  /* ---------------- Theo dõi tiền cọc → hiện khung chat ----------------
     Server tự chuyển đơn sang "Đã cọc" khi ngân hàng báo có tiền (SePay) hoặc khi admin xác nhận. */
  let depositTimer = null;
  const stopWatch = () => { clearTimeout(depositTimer); depositTimer = null; };
  function watchDeposit(b) {
    stopWatch();
    const until = Date.now() + 30 * 60 * 1000; // theo dõi tối đa 30 phút
    const check = async () => {
      if (!document.getElementById("depositStatus")) return stopWatch(); // đã rời màn hình này
      try {
        const r = await fetch(`/api/bookings/status?code=${encodeURIComponent(b.code)}&t=${encodeURIComponent(b.viewToken)}`, { cache: "no-store" });
        if (r.ok) { const s = await r.json(); if (s.status === "deposited" || s.status === "done") return showPaid(b, s); }
      } catch (e) { /* thử lại lần sau */ }
      const sm = document.querySelector("#depositStatus small");
      if (sm && sm.textContent === "Đang kiểm tra…") sm.textContent = "Chưa thấy tiền về. Ngân hàng có thể chậm 1–2 phút, trang vẫn đang theo dõi.";
      if (Date.now() < until) depositTimer = setTimeout(check, 5000);
      else { const st = document.getElementById("depositStatus"); if (st) st.querySelector("small").textContent = "Chưa thấy tiền về. Team sẽ đối soát và gọi xác nhận cho bạn."; }
    };
    check.now = () => { stopWatch(); check(); };
    watchDeposit.checkNow = check.now;
    depositTimer = setTimeout(check, 4000);
  }
  function showPaid(b, s) {
    stopWatch();
    const st = document.getElementById("depositStatus");
    if (st) { st.classList.add("is-paid"); st.innerHTML = `<span class="dot-ok" aria-hidden="true">✓</span><div><b>Đã nhận cọc ${money(s.paid || s.deposit || 0)}</b><small>Lịch của bạn đã được giữ. Mã hồ sơ ${esc(b.code)}.</small></div>`; }
    const pb = view.querySelector(".pay-box"); if (pb) pb.hidden = true;
    renderInvoice(s.paid || s.deposit || (lastInvoice && lastInvoice.q.deposit)); // hoá đơn đổi dấu thành "ĐÃ CỌC"
    const box = document.getElementById("chatBox"); if (box) { box.innerHTML = chatBlock(b, s.contact); if (M.stepIn) M.stepIn(box); }
  }
  // Kênh chat với team: Zalo (theo SĐT), Messenger, Instagram, gọi điện
  function chatLinks() {
    const out = [], phone = String(S.phone || "").replace(/[^\d+]/g, "").replace(/^\+84/, "0");
    if (phone) out.push(["Zalo", `https://zalo.me/${phone}`, "zalo"]);
    const handle = (u, host) => { try { const x = new URL(u); if (!x.hostname.includes(host)) return ""; if (x.pathname === "/profile.php") return x.searchParams.get("id") || ""; return x.pathname.split("/").filter(Boolean)[0] || ""; } catch (e) { return ""; } };
    const fb = handle(S.facebook || "", "facebook.com"); if (fb) out.push(["Messenger", `https://m.me/${fb}`, "messenger"]);
    const ig = handle(S.instagram || "", "instagram.com"); if (ig) out.push(["Instagram", `https://ig.me/m/${ig}`, "instagram"]);
    if (phone) out.push(["Gọi", `tel:${phone}`, "call"], ["Nhắn SMS", smsLink(phone, smsText), "sms"]);
    return out;
  }
  // Mở app Tin nhắn trên điện thoại khách, điền sẵn nội dung ("?&body=" chạy được cả iPhone lẫn Android)
  let smsText = "";
  const smsLink = (phone, text) => `sms:${phone}?&body=${encodeURIComponent(text)}`;
  function chatBlock(b, contact) {
    smsText = `Chào ${S.name}, mình là ${b.customer.name}, mã hồ sơ ${b.code} (${dateLabel(b.date)} · ${(shiftById(b.time) || {}).label || ""}). Mình đã đặt cọc, muốn trao đổi thêm về buổi chụp.`;
    const links = chatLinks();
    const btns = list => `<div class="chat-links">${list.map(([l, h, k]) => `<a class="chat-link chat-${k}" href="${esc(h)}" ${k === "call" || k === "sms" ? "" : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join("")}</div>`;
    // SĐT riêng của thám tử phụ trách (server chỉ gửi khi đơn đã cọc)
    const ph = contact && /^0\d{9}$/.test(contact.phone || "") ? contact : null;
    if (!links.length && !ph) return "";
    return `<section class="chat-box" aria-label="Liên hệ">
      ${ph ? `<h4>Nhắn trực tiếp thám tử ${esc(ph.name)}</h4>
        <p class="sum-fine">SĐT/Zalo: <b>${esc(ph.phone)}</b> · thám tử phụ trách buổi chụp của bạn. Trao đổi concept, trang phục, địa điểm.</p>
        ${btns([["Zalo", `https://zalo.me/${ph.phone}`, "zalo"], ["Gọi", `tel:${ph.phone}`, "call"], ["Nhắn SMS", smsLink(ph.phone, smsText.replace(`Chào ${S.name}`, `Chào ${ph.name}`)), "sms"]])}
        ${links.length ? `<hr class="sum-sep" /><h4 style="font-size:15px">Hoặc liên hệ team ${esc(S.name)}</h4>` : ""}`
        : `<h4>Nhắn cho team để trao đổi concept</h4>`}
      ${links.length ? btns(links) : ""}
      <p class="sum-fine">Gửi kèm mã hồ sơ <b>${esc(b.code)}</b>${!ph && b.photographerName ? ` · thám tử ${esc(b.photographerName)}` : ""} để được hỗ trợ nhanh.</p>
      <button type="button" class="link-btn" data-copy="${esc(b.code)}">Sao chép mã hồ sơ</button>
    </section>`;
  }

  /* ---------------- Thay đổi state ---------------- */
  function setService(id) {
    if (state.serviceId === id) return;
    state.serviceId = id;
    const p = phById(state.photographerId);
    if (p && !p.services.includes(id)) { state.photographerId = null; toast(`${p.name} không nhận gói này — chọn lại thám tử nhé.`); }
    if (state.time && state.date && !slotOpen(state.date, state.time)) state.time = null;
  }
  function changeQty(kind, id, delta) {
    const bag = kind === "addon" ? state.addons : state.products;
    const it = (kind === "addon" ? curAddons() : PRODUCTS).find(x => x.id === id); if (!it) return 0;
    const next = Math.max(0, Math.min(it.max || 10, (bag[id] || 0) + delta));
    if (next) bag[id] = next; else delete bag[id];
    renderExtras(); renderAddons(); if (state.date && state.time && !slotOpen(state.date, state.time)) { renderSlots(); toast("Thêm giờ làm buổi chụp dài hơn buổi đã chọn, chọn “Cả ngày” nhé."); }
    refreshSummary();
    return next;
  }

  /* ---------------- Modal hồ sơ thám tử ---------------- */
  /* Ảnh thật của thám tử (admin tải lên), thiếu thì dùng ô màu giữ chỗ */
  function portraitHTML(p) {
    const src = p.avatar || ((p.portfolio || [])[0] || {}).src;
    return src
      ? `<div class="profile-portrait has-img"><img src="${src}" alt="Ảnh ${esc(p.name)}" /></div>`
      : `<div class="profile-portrait ph ph-${p.tone}"><span class="ph-label">Ảnh chân dung thám tử</span></div>`;
  }
  function portfolioHTML(p) {
    const list = p.portfolio || [];
    if (!list.length) return `<div class="portfolio">${["warm", "dusk", "rose", "stone"].map(t => `<div class="ph ph-${t}"></div>`).join("")}</div><p class="team-meta" style="margin-top:6px">Ảnh đang được cập nhật.</p>`;
    return `<div class="portfolio">${list.map((it, j) => `<button type="button" class="pf-thumb" data-lightbox="${p.id}:${j}" aria-label="Xem ảnh: ${esc(it.title || "ảnh " + (j + 1))}">
      <img src="${it.src}" alt="${esc(it.title)}" loading="lazy" /></button>`).join("")}</div>`;
  }

  /* ---------------- Lightbox xem ảnh lớn ---------------- */
  let lb = null, lbList = [], lbIdx = 0, lbReturn = null;
  function ensureLightbox() {
    if (lb) return lb;
    lb = document.createElement("div"); lb.className = "lightbox"; lb.hidden = true;
    lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", "Xem ảnh");
    lb.innerHTML = `<button type="button" class="lb-close" data-lb="close" aria-label="Đóng"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg></button>
      <button type="button" class="lb-nav lb-prev" data-lb="-1" aria-label="Ảnh trước">‹</button>
      <figure><img alt="" /><figcaption></figcaption></figure>
      <button type="button" class="lb-nav lb-next" data-lb="1" aria-label="Ảnh sau">›</button>`;
    document.body.appendChild(lb);
    lb.addEventListener("click", e => {
      const b = e.target.closest("[data-lb]");
      if (b) { b.dataset.lb === "close" ? closeLightbox() : showLb(lbIdx + Number(b.dataset.lb)); return; }
      if (e.target === lb) closeLightbox();
    });
    lb.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.stopPropagation(); closeLightbox(); }
      else if (e.key === "ArrowRight") showLb(lbIdx + 1);
      else if (e.key === "ArrowLeft") showLb(lbIdx - 1);
      else if (e.key === "Tab") { const f = $$("button", lb); const i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus(); }
    });
    return lb;
  }
  function showLb(i) {
    lbIdx = (i + lbList.length) % lbList.length;
    const it = lbList[lbIdx], s = svcById(it.serviceId);
    const img = $("img", lb); img.src = it.src; img.alt = it.title || "";
    $("figcaption", lb).textContent = [it.title, s && s.name, `${lbIdx + 1}/${lbList.length}`].filter(Boolean).join(" · ");
    $$(".lb-nav", lb).forEach(b => (b.hidden = lbList.length < 2));
    if (M.lbIn) M.lbIn(img);
  }
  function openLightbox(pid, j, trigger) {
    const p = phById(pid); if (!p || !(p.portfolio || []).length) return;
    ensureLightbox(); lbList = p.portfolio; lbReturn = trigger;
    lb.hidden = false; showLb(j); $(".lb-close", lb).focus();
  }
  function closeLightbox() { if (!lb || lb.hidden) return; lb.hidden = true; if (lbReturn) lbReturn.focus({ preventScroll: true }); }

  const modal = $("#modal"), dialog = $(".modal-dialog", modal);
  let lastFocus = null;
  function openProfile(id) {
    const p = phById(id); if (!p) return;
    const dayOrder = [1, 2, 3, 4, 5, 6, 0];
    $("#modalBody").innerHTML = `<div style="display:contents">
      ${portraitHTML(p)}
      <div class="profile-info">
        <div><p class="eyebrow">${p.role} · ${p.years} năm</p><h2 id="modalTitle">${p.name}</h2>
          <p class="rating" style="margin-top:6px">${STAR}${p.rating} <span class="team-meta">· ${p.reviews} đánh giá · ${p.surcharge ? "Phụ phí chọn đích danh +" + money(p.surcharge) : "Không phụ phí"}</span></p></div>
        <div class="profile-block"><h4>Phong cách</h4><p>${p.style} ${p.bio}</p></div>
        <div class="profile-block"><h4>Chuyên môn</h4><div class="tags">${p.specialties.map(t => `<span class="tag">${t}</span>`).join("")}</div></div>
        ${phAddons(p).length ? `<div class="profile-block"><h4>Dịch vụ đi kèm</h4><div class="tags">${phAddons(p).map(a => `<span class="tag"${a.desc ? ` title="${esc(a.desc)}"` : ""}>${esc(a.name)}</span>`).join("")}</div></div>` : ""}
        <div class="profile-block"><h4>Lịch làm việc</h4><div class="days">${dayOrder.map(d => `<span class="day-pill${p.workDays.includes(d) ? "" : " off"}" title="${DOW[d]}">${d ? "T" + (d + 1) : "CN"}</span>`).join("")}</div></div>
        <div class="profile-block"><h4>Nhận chụp các gói</h4>${p.services.map(svcById).filter(Boolean).length ? `<div class="tags">${p.services.map(svcById).filter(Boolean).map(s => `<span class="tag">${esc(s.name)}</span>`).join("")}</div>` : "<p>—</p>"}</div>
        <div class="profile-block"><h4>Portfolio${(p.portfolio || []).length ? ` · ${p.portfolio.length} ảnh` : ""}</h4>${portfolioHTML(p)}</div>
        <div class="profile-actions"><button type="button" class="btn btn-primary" data-book-with="${p.id}">Đặt lịch với ${p.name.split(" ").pop()} →</button>
          <button type="button" class="btn btn-ghost" data-close>Đóng</button></div>
      </div></div>`;
    lastFocus = document.activeElement;
    modal.hidden = false; document.body.style.overflow = "hidden";
    if (M.modalIn) M.modalIn(dialog, $(".modal-backdrop", modal));
    dialog.focus();
  }
  /* ---------------- Khách đánh giá buổi chụp: /?danhgia=MÃ&t=MÃ_BÍ_MẬT ---------------- */
  let reviewStars = 0;
  function reviewHTML(r, msg) {
    const head = `<p class="eyebrow">Hồ sơ ${esc(r.code)}</p><h2 id="modalTitle">Đánh giá buổi chụp</h2>
      <p class="sum-fine">${esc(r.serviceName)} · thám tử ${esc(r.photographerName)} · ${dateLabel(r.date)}</p>`;
    const stars = (n, live) => `<div class="rv-stars"${live ? ' role="radiogroup" aria-label="Số sao"' : ""}>${[1, 2, 3, 4, 5].map(i => live
      ? `<button type="button" class="rv-star${i <= n ? " is-on" : ""}" data-rv-star="${i}" role="radio" aria-checked="${i === n}" aria-label="${i} sao">${STAR}</button>`
      : `<span class="rv-star${i <= n ? " is-on" : ""}">${STAR}</span>`).join("")}</div>`;
    let body;
    if (r.review) body = `${stars(r.review.stars)}${r.review.text ? `<p>“${esc(r.review.text)}”</p>` : ""}<p class="sum-fine">Cảm ơn ${esc(r.customerName)} đã đánh giá!</p>`;
    else if (!r.done) body = `<p>Hồ sơ chưa khép. Sau buổi chụp, bạn mở lại link này để đánh giá nhé.</p>`;
    else body = `${stars(reviewStars, true)}
      <div class="field"><label for="rv_text">Cảm nhận của bạn <small>(không bắt buộc)</small></label><textarea id="rv_text" maxlength="500" placeholder="Buổi chụp thế nào?"></textarea></div>
      <p class="err" id="rvErr" role="alert">${msg ? esc(msg) : ""}</p>
      <button type="button" class="btn btn-primary" id="btnReview">Gửi đánh giá</button>`;
    return `<div class="review-box">${head}${body}</div>`;
  }
  async function openReview(code, t) {
    let r;
    try { const res = await fetch(`/api/bookings/review?code=${encodeURIComponent(code)}&t=${encodeURIComponent(t)}`); r = await res.json(); if (!res.ok) throw new Error(r.error); }
    catch (e) { toast(e.message || "Không mở được trang đánh giá"); return; }
    reviewStars = 0; openReview.ctx = { code, t, r };
    $("#modalBody").innerHTML = reviewHTML(r);
    lastFocus = document.activeElement; modal.hidden = false; document.body.style.overflow = "hidden";
    if (M.modalIn) M.modalIn(dialog, $(".modal-backdrop", modal));
    dialog.focus();
  }
  async function sendReview() {
    const { code, t } = openReview.ctx || {}, err = $("#rvErr"), btn = $("#btnReview");
    if (!reviewStars) { err.textContent = "Chọn số sao nhé."; return; }
    btn.disabled = true; btn.textContent = "Đang gửi…";
    try {
      const res = await fetch("/api/bookings/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, t, stars: reviewStars, text: $("#rv_text").value }) });
      const r = await res.json(); if (!res.ok) throw new Error(r.error);
      $("#modalBody").innerHTML = reviewHTML(r); history.replaceState(null, "", location.pathname + location.hash);
    } catch (e) { btn.disabled = false; btn.textContent = "Gửi đánh giá"; err.textContent = e.message || "Không gửi được, thử lại sau."; }
  }

  async function closeModal() {
    if (modal.hidden) return;
    if (M.modalOut) await M.modalOut(dialog, $(".modal-backdrop", modal));
    modal.hidden = true; document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("is-visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("is-visible"), 2600); }

  /* ---------------- Sự kiện ---------------- */
  document.addEventListener("click", e => {
    const t = e.target.closest("button, a"); if (!t) return;
    if (t.matches("[data-cat]")) { activeCat = t.dataset.cat; renderServices(); return; }
    if (t.matches("[data-contact-service]")) { // mở / đóng các kênh chat với team ngay trong thẻ gói
      const s = svcById(t.dataset.contactService), box = t.closest(".card-body").querySelector(".card-contact"); if (!s || !box) return;
      const open = box.hidden; box.hidden = !open; t.setAttribute("aria-expanded", String(open));
      if (open) { smsText = `Chào ${S.name}, mình muốn hỏi về gói “${s.name}”.`;
        box.innerHTML = `<p class="hint">Nhắn team để hỏi thêm về gói này:</p><div class="chat-links">${chatLinks().map(([l, h, k]) => `<a class="chat-link chat-${k}" href="${esc(h)}" ${k === "call" || k === "sms" ? "" : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join("")}</div>`; }
      return;
    }
    if (t.matches("[data-pick-service]")) {
      setService(t.dataset.pickService);
      showForm({ scroll: true });
      toast(`Đã chọn “${svcById(state.serviceId).name}”`);
      return;
    }
    if (t.matches("[data-profile]")) { e.preventDefault(); openProfile(t.dataset.profile); return; }
    if (t.matches("[data-copy]")) {
      const v = t.dataset.copy;
      (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast("Đã sao chép: " + v), () => toast("Không sao chép được — hãy chép tay: " + v));
      return;
    }
    if (t.matches("[data-lightbox]")) { const [pid, j] = t.dataset.lightbox.split(":"); openLightbox(pid, Number(j), t); return; }
    if (t.matches("[data-close]")) { closeModal(); return; }
    if (t.matches("[data-rv-star]")) { reviewStars = Number(t.dataset.rvStar); $$("[data-rv-star]").forEach(b => { const on = Number(b.dataset.rvStar) <= reviewStars; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(Number(b.dataset.rvStar) === reviewStars)); }); $("#rvErr").textContent = ""; return; }
    if (t.id === "btnReview") { sendReview(); return; }
    if (t.matches("[data-book-with]")) {
      const p = phById(t.dataset.bookWith); setPhotographer(p.id);
      if (state.serviceId && !p.services.includes(state.serviceId)) state.serviceId = null;
      if (state.time && state.date && state.serviceId && !slotOpen(state.date, state.time)) state.time = null;
      closeModal(); showForm({ scroll: true });
      toast(`Đã chọn thám tử ${p.name}${state.serviceId ? "" : " — chọn gói chụp nhé"}`);
      return;
    }
    if (t.matches("[data-qty]")) {
      const [kind, id, d] = t.dataset.qty.split(":"); const it = (kind === "addon" ? curAddons() : PRODUCTS).find(x => x.id === id); if (!it) return;
      const q = changeQty(kind, id, Number(d));
      if (!view.contains(t)) toast(q ? `${it.name}: ${q} ${it.unit} trong hồ sơ` : `Đã bỏ ${it.name}`);
      return;
    }
    if (t.matches("[data-ph-addon]")) { // trang chủ: thêm dịch vụ của 1 thám tử → chọn thám tử đó
      const [pid, id] = t.dataset.phAddon.split(":"), p = phById(pid), it = phAddons(p).find(x => x.id === id); if (!it) return;
      setPhotographer(pid);
      if (state.serviceId && !p.services.includes(state.serviceId)) { state.serviceId = null; toast(`${p.name} không nhận gói đã chọn — chọn lại gói nhé.`); }
      if (state.date && !dayOpen(fromKey(state.date))) state.date = null;
      if (state.time && state.date && !slotOpen(state.date, state.time)) state.time = null;
      changeQty("addon", id, 1); showForm(); toast(`Đã thêm ${it.name} · thám tử ${p.name}`); return;
    }
    if (t.matches("[data-pick-zone]")) {
      const z = zoneById(t.dataset.pickZone); state.zoneId = z.id; if (!z.perNight || z.quote || z.contact) state.nights = 0;
      if (state.date && fromKey(state.date) < earliestDay()) { state.date = null; state.time = null; }
      showForm({ scroll: true }); toast(`Đã chọn ${z.name}${state.serviceId ? "" : ". Chọn gói chụp nhé"}`);
      return;
    }
    if (t.matches("[data-month]")) {
      const [y, m] = state.calMonth.split("-").map(Number); const d = new Date(y, m - 1 + Number(t.dataset.month), 1);
      state.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; renderCalendar(); return;
    }
    if (t.matches("[data-date]")) { state.date = t.dataset.date; if (state.time && !slotOpen(state.date, state.time)) state.time = null; renderCalendar(); renderSlots(); refreshSummary(); return; }
    if (t.matches("[data-time]")) { state.time = t.dataset.time; renderSlots(); refreshSummary(); errEl.textContent = ""; return; }
    if (t.matches("[data-mode]")) { // Nửa ngày: chọn sẵn buổi còn trống (ưu tiên sáng)
      const ok = id => (!state.date || slotOpen(state.date, id)) && shiftFits(id);
      if (!isHalf()) state.time = ok("morning") ? "morning" : ok("afternoon") ? "afternoon" : null;
      renderSlots(); refreshSummary(); errEl.textContent = ""; return;
    }
    if (t.id === "btnNext") { if (validate()) submit(); return; }
    if (t.id === "btnCheckPaid") { const sm = t.parentElement.querySelector("small"); if (sm) sm.textContent = "Đang kiểm tra…"; if (watchDeposit.checkNow) watchDeposit.checkNow(); return; }
    if (t.id === "btnNew") { stopWatch(); state = blank(); lastTotal = null; renderExtras(); showForm(); return; }
    if (t.id === "navToggle") { const open = t.getAttribute("aria-expanded") !== "true"; t.setAttribute("aria-expanded", open); $("#nav").classList.toggle("is-open", open); return; }
    if (t.closest("#nav") && t.tagName === "A") { $("#nav").classList.remove("is-open"); $("#navToggle").setAttribute("aria-expanded", "false"); }
    // Bấm logo: cuộn lên đầu trang chủ, bỏ #… trên địa chỉ, đóng menu mobile
    if (t.id === "brandLink") {
      e.preventDefault();
      $("#nav").classList.remove("is-open"); $("#navToggle").setAttribute("aria-expanded", "false");
      openPage("home");
      return;
    }
    // "Lên đầu trang" ở chân trang: chỉ cuộn lên, giữ nguyên trang đang xem
    if (t.getAttribute("href") === "#top") { e.preventDefault(); window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); return; }
    // Bấm lại đúng trang đang mở: cuộn về đầu trang đó
    const href = t.getAttribute("href");
    if (href && href.startsWith("#") && href === location.hash) { e.preventDefault(); window.scrollTo({ top: 0 }); }
  });

  document.addEventListener("change", e => {
    if (e.target.id === "tvZone") { tvState.zoneId = e.target.value; $("#tvResult").innerHTML = travelResult(); }
    else if (e.target.id === "tvCount") { tvState.count = Number(e.target.value) || 1; $("#tvResult").innerHTML = travelResult(); }
  });
  view.addEventListener("change", e => {
    const el = e.target;
    if (el.name === "service") { setService(el.value); if (!shiftFits("morning") && isHalf()) state.time = "full"; rerender("f_service"); errEl.textContent = ""; }
    else if (el.name === "staff") { state.staffId = el.value; if (state.time && state.date && !slotOpen(state.date, state.time)) { state.time = null; toast("Staff này đã có lịch vào buổi đã chọn, chọn lại buổi nhé."); } renderCalendar(); renderSlots(); refreshSummary(); errEl.textContent = ""; }
    else if (el.name === "photographer") { setPhotographer(el.value); if (state.date && !dayOpen(fromKey(state.date))) { state.date = null; toast("Thám tử này không trống ngày đã chọn, chọn lại ngày nhé."); } if (state.time && state.date && !slotOpen(state.date, state.time)) state.time = null; rerender("f_photographer"); errEl.textContent = ""; }
    else if (el.name === "evening") { state.evening = el.checked && eveningOk(); refreshSummary(); }
    else if (el.name === "zone") { const z = zoneById(el.value); state.zoneId = z.id; if (!z.perNight || z.quote || z.contact) state.nights = 0;
      if (state.date && fromKey(state.date) < earliestDay()) { state.date = null; state.time = null; toast(`${z.short} cần đặt trước ít nhất ${z.leadDays} ngày — chọn lại ngày nhé.`); }
      if (z.fullDay) state.time = "full"; rerender("f_zone"); }
    else if (el.name === "nights") {
      state.nights = Number(el.value);
      // Đi tỉnh ở lại nhiều đêm cần thám tử trống thêm các ngày sau
      if (state.date && state.time && !slotOpen(state.date, state.time)) { state.time = null; toast("Thám tử không trống đủ số đêm này — chọn lại ngày/giờ."); }
      renderCalendar(); renderSlots(); refreshSummary();
    }
    else if (el.name === "agree") { state.customer.agree = el.checked; save(); }
  });
  view.addEventListener("input", e => {
    const el = e.target;
    if (el.name === "address") { state.address = el.value; refreshSummary(); }
    else if (["name", "phone", "instagram", "note"].includes(el.name)) { state.customer[el.name] = el.value; save(); }
  });
  view.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); btnNext.click(); } });

  document.addEventListener("keydown", e => {
    if (lb && !lb.hidden) return; // lightbox tự xử lý phím
    if (modal.hidden) return;
    if (e.key === "Escape") closeModal();
    if (e.key === "Tab") { // giữ focus trong modal
      const f = $$('button, a[href], input, [tabindex]:not([tabindex="-1"])', dialog).filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return; const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });


  /* ---------------- Khởi động ---------------- */
  renderStatic(); renderServices(); renderTeam(); renderExtras(); renderTravel();
  { const q = new URLSearchParams(location.search); if (q.get("danhgia") && q.get("t") && HAS_API) openReview(q.get("danhgia"), q.get("t")); }
  showForm();

  /* ---------------- Mỗi mục menu là một trang riêng ----------------
     Trang chủ = ảnh bìa + dải kêu gọi; các trang khác chỉ hiện đúng phần đó.
     Địa chỉ vẫn là #services, #team… nên nút quay lại của trình duyệt dùng được. */
  const PAGES = ["services", "team", "travel", "booking", "contact"];
  const CTA_ON = ["home", "services", "team", "travel"];
  const pageOf = () => { const id = decodeURIComponent(location.hash.slice(1)); return PAGES.includes(id) ? id : "home"; };
  let curPage = null;
  function route() {
    const page = pageOf();
    if (page === curPage) return; // hashchange và popstate có thể cùng bắn
    curPage = page;
    const shown = [];
    $$("main > section").forEach(s => {
      const key = s.classList.contains("hero") ? "home" : s.classList.contains("cta-band") ? "cta" : s.id;
      const on = key === "cta" ? CTA_ON.includes(page) : key === page;
      s.hidden = !on; if (on) shown.push(s);
    });
    $$("#nav a").forEach(a => { if (a.getAttribute("href") === "#" + page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    window.scrollTo({ top: 0, behavior: "instant" }); // sang trang mới: lên đầu ngay, không cuộn mượt
    if (window.gsap && M.enabled) gsap.fromTo(shown, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.4, clearProps: "transform,opacity,visibility" });
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  }
  function openPage(page) {
    if (page === "home") { if (location.hash) { history.pushState(null, "", location.pathname + location.search); route(); } else window.scrollTo(0, 0); }
    else if (location.hash !== "#" + page) location.hash = page; // hashchange → route()
    else window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("popstate", route);
  route();
  if (M.init) M.init();
})();
