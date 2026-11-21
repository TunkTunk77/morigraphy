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
    const r = await fetch("/api/data", { cache: "no-store" });
    if (r.ok) {
      const d = await r.json();
      Object.assign(window, { HERO: d.hero || window.HERO, SECTIONS: d.sections || {}, STUDIO: d.studio, CATEGORIES: d.categories, SERVICES: d.services, PHOTOGRAPHERS: d.photographers, ADDONS: d.addons,
        PRODUCTS: d.products, TRAVEL_ZONES: d.zones, SHIFTS: d.shifts || window.SHIFTS, BOOKING_WINDOW_DAYS: d.bookingWindowDays });
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
  const zoneById = id => ZONES.find(z => z.id === id) || ZONES[0];
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';

  /* ---------------- State (lưu nháp trong trình duyệt) ---------------- */
  const DRAFT_KEY = "mg_draft_v1";
  const blank = () => ({
    step: 1, maxStep: 1, serviceId: null, photographerId: null, zoneId: ZONES[0].id, nights: 0, address: "",
    date: null, time: null, calMonth: null, addons: {}, products: {},
    customer: { name: "", phone: "", email: "", note: "", agree: false },
  });
  let state = blank();
  try { const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); if (saved && saved.step !== "done") state = Object.assign(blank(), saved); } catch (e) { /* bỏ qua */ }
  if (state.date && fromKey(state.date) < today()) { state.date = null; state.time = null; }
  if (state.time && !shiftById(state.time)) state.time = null; // bản nháp cũ còn giờ kiểu "09:00"
  if (!ZONES.some(z => z.id === state.zoneId)) state.zoneId = ZONES[0].id;
  state.products = {}; // mục Sản phẩm đã bỏ — xóa lựa chọn cũ trong bản nháp
  for (const id of Object.keys(state.addons)) if (!ADDONS.some(a => a.id === id)) delete state.addons[id];
  if (state.photographerId && state.photographerId !== "any" && !phById(state.photographerId)) state.photographerId = null;
  if (state.serviceId && !svcById(state.serviceId)) state.serviceId = null;
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
    return s.duration + ADDONS.reduce((m, a) => m + (a.extraMinutes || 0) * (state.addons[a.id] || 0), 0);
  };
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
    return candidates(dateKey).some(p => freeAt(p, dateKey, shift));
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
  function quote() {
    const s = svcById(state.serviceId), z = zoneById(state.zoneId);
    const rows = []; let total = 0;
    if (s) { rows.push(["Giá gói", s.price]); total += s.price; }
    const p = state.photographerId && state.photographerId !== "any" ? phById(state.photographerId) : null;
    if (p && p.surcharge) { rows.push(["Phụ phí chọn thám tử", p.surcharge]); total += p.surcharge; }
    if (z.fee) { rows.push([`Phí di chuyển · ${z.short}`, z.fee]); total += z.fee; }
    if (z.perNight && state.nights) { const v = z.perNight * state.nights; rows.push([`Lưu trú ekip × ${state.nights} đêm`, v]); total += v; }
    for (const a of ADDONS) { const q = state.addons[a.id] || 0; if (q) { rows.push([`${a.name} × ${q}`, a.price * q]); total += a.price * q; } }
    for (const pr of PRODUCTS) { const q = state.products[pr.id] || 0; if (q) { rows.push([`${pr.name} × ${q}`, pr.price * q]); total += pr.price * q; } }
    const deposit = Math.round(total * S.depositPercent / 100 / 1000) * 1000;
    return { rows, total, deposit, needsQuote: !!z.quote };
  }

  /* ---------------- Trang chủ ---------------- */
  function renderStatic() {
    if (window.renderHeroVisual && $("#heroVisual")) $("#heroVisual").innerHTML = window.renderHeroVisual(window.HERO);
    // Chữ trang chủ do admin chỉnh (mục "Trang chủ"); chuỗi rỗng = ẩn dòng
    const ctx = { coc: S.depositPercent, team: S.name };
    if (window.renderHeroCopy && $("#heroCopy")) $("#heroCopy").innerHTML = window.renderHeroCopy(window.HERO, ctx);
    if (window.mergeSections) {
      const secs = window.mergeSections(window.SECTIONS);
      $$("[data-k]").forEach(el => { const [k, f] = el.dataset.k.split("."); const v = (secs[k] || {})[f];
        if (v === undefined) return; el.textContent = window.fillText(v, ctx); el.hidden = !v; });
    }
    $$("[data-studio=name]").forEach(el => (el.textContent = S.name));
    $$("[data-studio=deposit]").forEach(el => (el.textContent = S.depositPercent));
    $("#year").textContent = new Date().getFullYear();
    const tel = S.phone.replace(/\s/g, "");
    $("#contactList").innerHTML = [
      ["Khu vực", S.area],
      ["Điện thoại", `<a href="tel:${tel}">${S.phone}</a> · <a href="https://zalo.me/${tel}" target="_blank" rel="noopener">Zalo</a>`],
      ["Email", S.email && `<a href="mailto:${S.email}">${S.email}</a>`],
      ["Nhận lịch", S.openHours],
      ["Facebook", S.facebook && `<a href="${S.facebook}" target="_blank" rel="noopener">${S.facebook.replace(/^https:\/\/(www\.)?/, "")}</a>`],
      ["Instagram", S.instagram && `<a href="${S.instagram}" target="_blank" rel="noopener">${S.instagram.replace(/^https:\/\/(www\.)?/, "")}</a>`],
    ].filter(([, v]) => v).map(([k, v]) => `<li><span>${k}</span><span class="contact-val">${v}</span></li>`).join("");
  }

  let activeCat = "Tất cả";
  function renderServices() {
    $("#categoryFilter").innerHTML = window.CATEGORIES.map(c => `<button type="button" class="chip${c === activeCat ? " is-active" : ""}" data-cat="${c}" aria-pressed="${c === activeCat}">${c}</button>`).join("");
    const list = SERVICES.filter(s => activeCat === "Tất cả" || s.category === activeCat);
    $("#servicesGrid").innerHTML = list.map(s => {
      const no = pad(SERVICES.indexOf(s) + 1);
      return `<article class="card" data-card>
        <div class="card-media ph ph-${s.tone}"><span class="card-tag">HỒ SƠ #${no} · ${s.category.toUpperCase()}</span></div>
        <div class="card-body">
          <h3>${s.name}</h3>
          <p class="card-desc">${s.desc}</p>
          <ul class="card-list">${(s.includes || []).map(i => `<li>${i}</li>`).join("")}</ul>
          <div class="card-foot"><span class="price">${money(s.price)}<small>${s.duration} phút</small></span>
            <button type="button" class="btn btn-primary btn-sm" data-pick-service="${s.id}">Chọn gói</button></div>
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
  function renderExtras() {
    $("#addonsGrid").innerHTML = ADDONS.map(a => itemHTML("addon", a)).join("");
  }

  function renderTravel() {
    $("#travelGrid").innerHTML = ZONES.map((z, i) => `
      <article class="zone reveal">
        <span class="zone-no">Hiện trường 0${i + 1}</span>
        <h3>${(z.name.split("·")[1] || z.name).trim()}</h3>
        <p class="zone-ex">${z.short} · ${z.examples}</p>
        <p class="zone-fee">${z.fee ? (z.quote ? "Báo giá riêng" : money(z.fee) + " / buổi") : "Miễn phí"}
          <small>${z.perNight && !z.quote ? "+ " + money(z.perNight) + " / đêm lưu trú nếu cần" : z.note}${z.leadDays ? ` Đặt trước ≥ ${z.leadDays} ngày.` : ""}</small></p>
        <button type="button" class="link-btn" data-pick-zone="${z.id}">Chọn khi đặt lịch →</button>
      </article>`).join("");
  }

  /* ---------------- Đặt lịch ---------------- */
  const STEPS = ["Gói chụp", "Thám tử ảnh", "Địa điểm & thời gian", "Dịch vụ đi kèm", "Thông tin"];
  const view = $("#stepView"), errEl = $("#stepError"), btnNext = $("#btnNext"), btnBack = $("#btnBack");

  function renderStepper() {
    $("#stepper").innerHTML = STEPS.map((l, i) => {
      const n = i + 1, done = state.step === "done" || n < state.step, active = n === state.step;
      const cls = done ? "is-done" : active ? "is-active" : "";
      const inner = `<span class="dot">${done ? "✓" : n}</span><span class="label">${l}</span>`;
      const canJump = state.step !== "done" && n <= state.maxStep && !active;
      return `<li class="${cls}" ${active ? 'aria-current="step"' : ""}>${canJump ? `<button type="button" data-goto="${n}">${inner}</button>` : inner}</li>`;
    }).join("");
  }

  function option({ name, value, checked, disabled, title, sub, side, lead }) {
    return `<label class="option${disabled ? " is-disabled" : ""}">
      <input type="radio" name="${name}" value="${value}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
      ${lead || '<span class="radio" aria-hidden="true"></span>'}
      <span><span class="opt-title">${title}</span><br /><span class="opt-sub">${sub || ""}</span></span>
      <span class="opt-side">${side || ""}</span></label>`;
  }

  const stepRender = {
    1() {
      return `<h3 class="step-title" tabindex="-1">Chọn gói chụp</h3><p class="step-sub">Gói quyết định thời lượng buổi chụp và các thám tử nhận vụ.</p>
        <div class="options one-col">${SERVICES.map(s => option({ name: "service", value: s.id, checked: s.id === state.serviceId,
          title: s.name, sub: [s.category, s.duration + " phút", (s.includes || [])[1]].filter(Boolean).join(" · "), side: money(s.price) })).join("")}</div>`;
    },
    2() {
      const s = svcById(state.serviceId);
      const el = eligible();
      return `<h3 class="step-title" tabindex="-1">Chọn thám tử ảnh</h3><p class="step-sub">Các thám tử nhận gói “${s.name}”. Chọn đích danh có thể có phụ phí.</p>
        <div class="options one-col">
        ${option({ name: "photographer", value: "any", checked: state.photographerId === "any", title: "Để team sắp xếp", sub: "Team chọn thám tử phù hợp và còn trống lịch", side: "Không phụ phí" })}
        ${PHOTOGRAPHERS.map(p => { const ok = el.includes(p);
          return option({ name: "photographer", value: p.id, checked: p.id === state.photographerId, disabled: !ok,
            lead: `<span class="opt-avatar ph-${p.tone}" aria-hidden="true">${p.avatar ? `<img src="${p.avatar}" alt="" />` : initials(p.name)}</span>`,
            title: p.name, sub: ok ? `${p.role} · ★ ${p.rating} · ${p.specialties.slice(0, 2).join(", ")} · <button type="button" class="link-btn" data-profile="${p.id}">Hồ sơ</button>` : "Không nhận gói này",
            side: ok ? (p.surcharge ? "+" + money(p.surcharge) : "Không phụ phí") : "" }); }).join("")}
        </div>`;
    },
    3() {
      const z = zoneById(state.zoneId);
      const away = true; // team không có studio: luôn chụp tại địa điểm khách chọn
      return `<h3 class="step-title" tabindex="-1">Địa điểm & thời gian</h3><p class="step-sub">Team đến chụp tại địa điểm bạn chọn. Phí di chuyển tính theo khu vực.</p>
        <p class="group-label">Khu vực chụp</p>
        <div class="options">${ZONES.map(zz => option({ name: "zone", value: zz.id, checked: zz.id === state.zoneId,
          title: zz.name, sub: zz.examples + (zz.leadDays ? ` · đặt trước ≥ ${zz.leadDays} ngày` : ""),
          side: zz.fee ? (zz.quote ? "Báo giá riêng" : "+" + money(zz.fee)) : "Miễn phí" })).join("")}</div>
        ${away ? `<div class="fields" style="margin-top:16px">
          <div class="field ${z.perNight && !z.quote ? "" : "full"}" data-field="address"><label for="fAddress">Địa chỉ / khu vực chụp *</label>
            <input id="fAddress" name="address" value="${esc(state.address)}" placeholder="VD: Hồ Xuân Hương, Đà Lạt, Lâm Đồng" autocomplete="street-address" /><span class="err"></span></div>
          ${z.perNight && !z.quote ? `<div class="field"><label for="fNights">Ekip ở lại qua đêm</label>
            <select id="fNights" name="nights">${[0, 1, 2, 3].map(n => `<option value="${n}" ${n === state.nights ? "selected" : ""}>${n ? n + " đêm · +" + money(z.perNight * n) : "Không, đi về trong ngày"}</option>`).join("")}</select></div>` : ""}
          </div>${z.quote ? `<p class="note">${z.note} Tổng tạm tính chưa gồm vé di chuyển.</p>` : ""}` : ""}
        <p class="group-label">Ngày & giờ</p>
        <div class="when"><div id="calendar"></div><div id="slots"></div></div>`;
    },
    4() {
      return `<h3 class="step-title" tabindex="-1">Dịch vụ đi kèm</h3><p class="step-sub">Không bắt buộc. Giá cập nhật ngay ở phần tóm tắt.</p>
        <div class="grid" style="gap:10px">${ADDONS.map(a => itemHTML("addon", a, true)).join("") || `<div class="empty">Hiện chưa có dịch vụ đi kèm — bấm Tiếp tục.</div>`}</div>`;
    },
    5() {
      const c = state.customer;
      const f = (id, label, type, val, ph, extra = "", full = false) => `<div class="field${full ? " full" : ""}" data-field="${id}"><label for="f_${id}">${label}</label>
        <input id="f_${id}" name="${id}" type="${type}" value="${esc(val)}" placeholder="${ph}" ${extra} /><span class="err"></span></div>`;
      return `<h3 class="step-title" tabindex="-1">Thông tin người đặt</h3><p class="step-sub">Team dùng thông tin này để gọi xác nhận và gửi hướng dẫn đặt cọc.</p>
        <div class="fields">
          ${f("name", "Họ và tên *", "text", c.name, "Nguyễn Văn A", 'autocomplete="name"')}
          ${f("phone", "Số điện thoại *", "tel", c.phone, "0901 234 567", 'autocomplete="tel" inputmode="tel"')}
          ${f("email", "Email", "email", c.email, "ban@example.com", 'autocomplete="email"', true)}
          <div class="field full"><label for="f_note">Ghi chú cho thám tử</label><textarea id="f_note" name="note" placeholder="Ý tưởng, moodboard, số người, trang phục…">${esc(c.note)}</textarea></div>
          <label class="check field full" data-field="agree"><input type="checkbox" name="agree" ${c.agree ? "checked" : ""} />
            <span>Tôi đồng ý đặt cọc ${S.depositPercent}% để giữ lịch${(S.payment && S.payment.enabled) || PHOTOGRAPHERS.some(x => x.hasOwnPayment) ? " (chuyển khoản qua mã QR ở bước cuối)" : ""}. Cọc được hoàn nếu báo dời/hủy trước 72 giờ.<span class="err" style="display:block"></span></span></label>
        </div>`;
    },
  };

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
  function renderSlots() {
    const box = $("#slots"); if (!box) return;
    if (!state.date) { box.innerHTML = `<div class="empty">Chọn một ngày trên lịch để xem buổi còn trống.</div>`; return; }
    const mins = totalMinutes(), z = zoneById(state.zoneId), halfOk = SHIFT_LIST.some(s => s.id !== "full" && shiftFits(s.id, mins));
    box.innerHTML = `<p style="font-weight:600">${dateLabel(state.date)}</p>
      <p class="step-sub" style="margin:2px 0 14px">${svcById(state.serviceId).name} · ${mins} phút</p>
      <div class="slots shifts">${SHIFT_LIST.map(s => { const ok = slotOpen(state.date, s.id, mins);
        return `<button type="button" class="slot shift${s.id === state.time ? " is-selected" : ""}" data-time="${s.id}" ${ok ? "" : "disabled"} aria-pressed="${s.id === state.time}"><strong>${s.label}</strong><small>${s.start} – ${s.end}</small></button>`; }).join("")}</div>
      <p class="note neutral">${z.fullDay
        ? `Chụp đi tỉnh chỉ nhận lịch cả ngày${state.nights ? `, thám tử cần trống thêm ${state.nights} ngày sau (ở lại qua đêm)` : ""}.`
        : !halfOk ? `Gói này cần khoảng ${Math.ceil(mins / 60)} tiếng nên chỉ nhận lịch cả ngày.`
        : `Buổi mờ là đã có khách. Nghỉ trưa ${SH.morning.end} – ${SH.afternoon.start}.`}</p>`;
  }

  function renderSummary(prevTotal) {
    const s = svcById(state.serviceId), z = zoneById(state.zoneId), q = quote();
    const p = state.photographerId === "any" ? null : phById(state.photographerId);
    const row = (k, v) => `<div class="sum-row"><span>${k}</span><span>${v}</span></div>`;
    if (!s) { $("#summaryBody").innerHTML = `<p class="sum-empty">Chưa có gói chụp. Chọn gói ở bước 1 hoặc bấm “Chọn gói” phía trên.</p>`; return; }
    let html = row("Gói chụp", s.name)
      + row("Thám tử", p ? p.name : state.photographerId === "any" ? "Team sắp xếp" : "—")
      + row("Địa điểm", z.short + (state.address ? " · " + esc(state.address) : ""))
      + row("Lịch", state.date ? `${dateLabel(state.date).replace(/, (\d+)\/(\d+)\/\d+/, " $1/$2")}${state.time ? " · " + (shiftById(state.time) || {}).label : ""}` : "—");
    html += `<hr class="sum-sep" />` + q.rows.map(([k, v]) => row(k, money(v))).join("");
    html += `<hr class="sum-sep" /><div class="sum-total"><span>Tạm tính${q.needsQuote ? "*" : ""}</span><strong id="sumTotal">${money(q.total)}</strong></div>`
      + `<div class="sum-row sum-deposit"><span>Đặt cọc ${S.depositPercent}%</span><span>${money(q.deposit)}</span></div>`
      + `<p class="sum-fine">${q.needsQuote ? "* Chưa gồm vé di chuyển xa, team báo giá riêng. " : ""}Thanh toán phần còn lại sau buổi chụp.</p>`;
    $("#summaryBody").innerHTML = html;
    if (prevTotal != null && prevTotal !== q.total && M.pulse) M.pulse($("#sumTotal"));
  }

  let lastTotal = null;
  function refreshSummary() { const t = quote().total; renderSummary(lastTotal); lastTotal = t; save(); }

  function renderStep() {
    renderStepper();
    errEl.textContent = "";
    if (state.step === "done") return;
    view.innerHTML = stepRender[state.step]();
    if (state.step === 3) { renderCalendar(); renderSlots(); }
    btnBack.style.visibility = state.step === 1 ? "hidden" : "visible";
    btnNext.textContent = state.step === 5 ? "Gửi hồ sơ đặt lịch" : "Tiếp tục →";
    $("#stepNav").hidden = false;
  }

  // Không cho vào bước khi thiếu dữ liệu của bước trước
  function clampStep(n) {
    if (n === "done") return n;
    if (n > 1 && !state.serviceId) return 1;
    if (n > 2 && !state.photographerId) return 2;
    return n;
  }

  async function goTo(n, { scroll = false, focus = true } = {}) {
    n = clampStep(n);
    if (scroll) document.getElementById("booking").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    if (M.stepOut) await M.stepOut(view);
    state.step = n; if (typeof n === "number") state.maxStep = Math.max(state.maxStep, n);
    if (n === 3) await loadBusy(); // lịch luôn mới khi vào bước chọn giờ
    renderStep(); refreshSummary();
    if (M.stepIn) M.stepIn(view);
    if (focus && !scroll) { const h = $(".step-title", view); if (h) h.focus({ preventScroll: true }); }
  }

  function fail(msg, fieldName) {
    errEl.textContent = msg;
    if (fieldName) { const f = view.querySelector(`[data-field="${fieldName}"]`); if (f) { f.classList.add("has-error"); const e = f.querySelector(".err"); if (e) e.textContent = msg; const inp = f.querySelector("input,select"); if (inp) inp.focus(); } }
    if (M.shake) M.shake(errEl);
    return false;
  }

  function validate() {
    $$(".has-error", view).forEach(f => { f.classList.remove("has-error"); const e = f.querySelector(".err"); if (e) e.textContent = ""; });
    switch (state.step) {
      case 1: return state.serviceId ? true : fail("Chọn một gói chụp để tiếp tục.");
      case 2: return state.photographerId ? true : fail("Chọn thám tử hoặc “Để team sắp xếp”.");
      case 3: {
        if (state.address.trim().length < 5) return fail("Nhập địa chỉ hoặc khu vực chụp.", "address");
        if (!state.date) return fail("Chọn ngày chụp.");
        if (!state.time) return fail("Chọn buổi chụp: cả ngày, sáng hoặc chiều.");
        if (!slotOpen(state.date, state.time)) { state.time = null; renderSlots(); return fail("Buổi vừa chọn không còn trống, chọn buổi khác."); }
        return true;
      }
      case 4: {
        if (state.date && state.time && !slotOpen(state.date, state.time)) return fail(`Với dịch vụ thêm, buổi chụp cần khoảng ${Math.ceil(totalMinutes() / 60)} tiếng, dài hơn ${(shiftById(state.time) || {}).label?.toLowerCase()}. Bớt “Thêm giờ” hoặc quay lại bước 3 chọn “Cả ngày”.`);
        return true;
      }
      case 5: {
        const c = state.customer;
        if (c.name.trim().length < 2) return fail("Nhập họ tên.", "name");
        if (!/^(0|\+84)\d{9}$/.test(c.phone.replace(/[\s.-]/g, ""))) return fail("Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).", "phone");
        if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return fail("Email chưa đúng định dạng.", "email");
        if (!c.agree) return fail("Vui lòng đồng ý điều khoản đặt cọc.", "agree");
        return true;
      }
    }
    return true;
  }

  function bookingCode() {
    const d = fromKey(state.date), chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let r = ""; for (let i = 0; i < 4; i++) r += chars[Math.floor(Math.random() * chars.length)];
    return `MG-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${r}`;
  }

  function gcalLink(code) {
    const s = svcById(state.serviceId), z = zoneById(state.zoneId);
    const sh = shiftById(state.time), start = toMin(sh.start), end = toMin(sh.end);
    const ymd = state.date.replace(/-/g, "");
    const fmt = m => `${ymd}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
    const params = new URLSearchParams({ action: "TEMPLATE", text: `Chụp ảnh ${S.name} · ${s.name}`, dates: `${fmt(start)}/${fmt(end)}`, ctz: "Asia/Ho_Chi_Minh",
      details: `Mã hồ sơ: ${code}\nLiên hệ team ${S.name}: ${S.phone}`, location: state.address });
    return "https://calendar.google.com/calendar/render?" + params.toString();
  }

  async function submit() {
    btnNext.disabled = true; btnNext.textContent = "Đang gửi…";
    const q = quote(), ph = assignedPhotographer();
    const payload = { serviceId: state.serviceId, photographerId: state.photographerId, zoneId: state.zoneId, address: state.address, nights: state.nights,
      date: state.date, time: state.time, addons: state.addons, products: {}, customer: state.customer };
    let code, photographerName = null, transferNote = null, payTo = null, viewToken = null;
    if (HAS_API) {
      try {
        const r = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const res = await r.json().catch(() => ({}));
        if (r.status === 409) {
          // Giờ vừa bị người khác đặt: tải lại lịch bận, quay về bước 3
          btnNext.disabled = false; await loadBusy(); state.time = null;
          await goTo(3); fail(res.error || "Buổi này vừa có người đặt, chọn buổi khác."); return;
        }
        if (!r.ok) { btnNext.disabled = false; btnNext.textContent = "Gửi hồ sơ đặt lịch"; return fail(res.error || "Không gửi được, thử lại sau."); }
        code = res.code; q.total = res.total; q.deposit = res.deposit; photographerName = res.photographerName; transferNote = res.transferNote; payTo = res.payTo || null; viewToken = res.viewToken || null; // chốt theo server
        await loadBusy();
      } catch (e) { btnNext.disabled = false; btnNext.textContent = "Gửi hồ sơ đặt lịch"; return fail("Mất kết nối, thử lại sau."); }
    } else {
      // Chế độ tĩnh (không có server): chỉ lưu trong trình duyệt để demo
      code = bookingCode();
      try { const all = JSON.parse(localStorage.getItem("mg_bookings") || "[]"); all.push({ code, ...payload }); localStorage.setItem("mg_bookings", JSON.stringify(all)); } catch (e) { /* bỏ qua */ }
    }
    btnNext.disabled = false;
    showSuccess({ code, ...payload, transferNote, payTo, viewToken, photographerName: photographerName || (ph ? ph.name : null) }, q, ph);
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
    const s = svcById(b.serviceId), z = zoneById(b.zoneId);
    const row = (k, v, strong) => `<div class="sum-row"><span>${k}</span><span${strong ? ' style="font-weight:600"' : ""}>${v}</span></div>`;
    const pay = payBlock(b, q);
    view.innerHTML = `<div class="success">
      <svg class="success-icon" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="40"/><path d="M26 41l9 9 19-20"/></svg>
      <h3 tabindex="-1">Hồ sơ đã được mở!</h3>
      <p class="step-sub" style="max-width:480px;margin:0">${pay
        ? "Quét mã bên dưới để đặt cọc giữ lịch. Team đối soát và gọi xác nhận trong vòng 2 giờ làm việc."
        : "Team sẽ gọi xác nhận trong vòng 2 giờ làm việc và gửi thông tin đặt cọc qua Zalo/SMS."}</p>
      <span class="case-code">Mã hồ sơ: ${b.code}</span>
      <div class="sum-box">
        ${row("Gói chụp", s.name)}${row("Thám tử", b.photographerName || (ph ? ph.name : "Team sắp xếp"))}
        ${row("Địa điểm", `${z.short} · ${esc(b.address)}`)}
        ${row("Lịch chụp", `${dateLabel(b.date)} · ${shiftText(b.time)}`)}
        ${row("Người đặt", `${esc(b.customer.name)} · ${esc(b.customer.phone)}`)}
        ${row("Tổng tạm tính", money(q.total) + (q.needsQuote ? "*" : ""), true)}${row("Cần đặt cọc", `<span style="color:var(--accent)">${money(q.deposit)}</span>`, true)}
      </div>
      ${pay}
      ${pay && b.viewToken ? `<div class="deposit-status" id="depositStatus" role="status" aria-live="polite">
        <span class="dot-wait" aria-hidden="true"></span><div><b>Đang chờ tiền cọc…</b><small>Chuyển khoản xong, trang này tự cập nhật trong vài giây.</small></div>
        <button type="button" class="btn btn-ghost btn-sm" id="btnCheckPaid">Tôi đã chuyển khoản</button></div>` : ""}
      <div id="chatBox"></div>
      <div class="success-actions">
        <a class="btn btn-primary" href="${gcalLink(b.code)}" target="_blank" rel="noopener">Thêm vào Google Calendar</a>
        <button type="button" class="btn btn-ghost" id="btnNew">Đặt lịch mới</button>
      </div></div>`;
    state.step = "done"; renderStepper(); $("#stepNav").hidden = true;
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
    const it = (kind === "addon" ? ADDONS : PRODUCTS).find(x => x.id === id);
    const next = Math.max(0, Math.min(it.max || 10, (bag[id] || 0) + delta));
    if (next) bag[id] = next; else delete bag[id];
    renderExtras(); if (state.step === 4) { const y = window.scrollY; view.innerHTML = stepRender[4](); window.scrollTo(0, y); }
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
        <div class="profile-block"><h4>Lịch làm việc</h4><div class="days">${dayOrder.map(d => `<span class="day-pill${p.workDays.includes(d) ? "" : " off"}" title="${DOW[d]}">${d ? "T" + (d + 1) : "CN"}</span>`).join("")}</div></div>
        <div class="profile-block"><h4>Nhận chụp các gói</h4><p>${p.services.map(svcById).filter(Boolean).map(s => s.name).join(" · ") || "—"}</p></div>
        <div class="profile-block"><h4>Portfolio${(p.portfolio || []).length ? ` · ${p.portfolio.length} ảnh` : ""}</h4>${portfolioHTML(p)}</div>
        <div class="profile-actions"><button type="button" class="btn btn-primary" data-book-with="${p.id}">Đặt lịch với ${p.name.split(" ").pop()} →</button>
          <button type="button" class="btn btn-ghost" data-close>Đóng</button></div>
      </div></div>`;
    lastFocus = document.activeElement;
    modal.hidden = false; document.body.style.overflow = "hidden";
    if (M.modalIn) M.modalIn(dialog, $(".modal-backdrop", modal));
    dialog.focus();
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
    if (t.matches("[data-pick-service]")) {
      setService(t.dataset.pickService);
      goTo(state.photographerId ? 3 : 2, { scroll: true });
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
    if (t.matches("[data-book-with]")) {
      const p = phById(t.dataset.bookWith); state.photographerId = p.id;
      if (state.serviceId && !p.services.includes(state.serviceId)) state.serviceId = null;
      if (state.time && state.date && state.serviceId && !slotOpen(state.date, state.time)) state.time = null;
      closeModal(); goTo(state.serviceId ? 3 : 1, { scroll: true });
      toast(`Đã chọn thám tử ${p.name}${state.serviceId ? "" : " — chọn gói chụp nhé"}`);
      return;
    }
    if (t.matches("[data-qty]")) {
      const [kind, id, d] = t.dataset.qty.split(":"); const it = (kind === "addon" ? ADDONS : PRODUCTS).find(x => x.id === id);
      const q = changeQty(kind, id, Number(d));
      if (!view.contains(t)) toast(q ? `${it.name}: ${q} ${it.unit} trong hồ sơ` : `Đã bỏ ${it.name}`);
      return;
    }
    if (t.matches("[data-pick-zone]")) {
      const z = zoneById(t.dataset.pickZone); state.zoneId = z.id; if (!z.perNight || z.quote) state.nights = 0;
      if (state.date && fromKey(state.date) < earliestDay()) { state.date = null; state.time = null; }
      if (!state.serviceId) { goTo(1, { scroll: true }); toast(`Đã chọn ${z.name}. Chọn gói chụp trước nhé.`); }
      else { state.maxStep = Math.max(state.maxStep, 3); goTo(3, { scroll: true }); toast(`Đã chọn ${z.name}`); }
      return;
    }
    if (t.matches("[data-goto]")) { goTo(Number(t.dataset.goto)); return; }
    if (t.matches("[data-month]")) {
      const [y, m] = state.calMonth.split("-").map(Number); const d = new Date(y, m - 1 + Number(t.dataset.month), 1);
      state.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; renderCalendar(); return;
    }
    if (t.matches("[data-date]")) { state.date = t.dataset.date; if (state.time && !slotOpen(state.date, state.time)) state.time = null; renderCalendar(); renderSlots(); refreshSummary(); return; }
    if (t.matches("[data-time]")) { state.time = t.dataset.time; renderSlots(); refreshSummary(); errEl.textContent = ""; return; }
    if (t.id === "btnNext") { if (!validate()) return; if (state.step === 5) submit(); else goTo(state.step + 1); return; }
    if (t.id === "btnBack") { if (typeof state.step === "number" && state.step > 1) goTo(state.step - 1); return; }
    if (t.id === "btnCheckPaid") { const sm = t.parentElement.querySelector("small"); if (sm) sm.textContent = "Đang kiểm tra…"; if (watchDeposit.checkNow) watchDeposit.checkNow(); return; }
    if (t.id === "btnNew") { stopWatch(); state = blank(); lastTotal = null; renderExtras(); goTo(1); return; }
    if (t.id === "navToggle") { const open = t.getAttribute("aria-expanded") !== "true"; t.setAttribute("aria-expanded", open); $("#nav").classList.toggle("is-open", open); return; }
    if (t.closest("#nav") && t.tagName === "A") { $("#nav").classList.remove("is-open"); $("#navToggle").setAttribute("aria-expanded", "false"); }
    // Bấm logo: cuộn lên đầu trang chủ, bỏ #… trên địa chỉ, đóng menu mobile
    if (t.id === "brandLink") {
      e.preventDefault();
      $("#nav").classList.remove("is-open"); $("#navToggle").setAttribute("aria-expanded", "false");
      window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      history.replaceState(null, "", location.pathname + location.search);
    }
  });

  view.addEventListener("change", e => {
    const el = e.target;
    if (el.name === "service") { setService(el.value); refreshSummary(); errEl.textContent = ""; }
    else if (el.name === "photographer") { state.photographerId = el.value; if (state.time && state.date && !slotOpen(state.date, state.time)) state.time = null; refreshSummary(); errEl.textContent = ""; }
    else if (el.name === "zone") { const z = zoneById(el.value); state.zoneId = z.id; if (!z.perNight || z.quote) state.nights = 0;
      if (state.date && fromKey(state.date) < earliestDay()) { state.date = null; state.time = null; toast(`${z.short} cần đặt trước ít nhất ${z.leadDays} ngày — chọn lại ngày nhé.`); }
      const y = window.scrollY; renderStep(); window.scrollTo(0, y); refreshSummary(); }
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
    else if (["name", "phone", "email", "note"].includes(el.name)) { state.customer[el.name] = el.value; save(); }
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
  state.step = clampStep(typeof state.step === "number" ? state.step : 1);
  state.maxStep = Math.max(state.step, Math.min(state.maxStep || 1, clampStep(5)));
  renderStep(); refreshSummary();
  if (M.init) M.init();
})();
