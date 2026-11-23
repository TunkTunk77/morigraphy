/* =========================================================
   MoriGraphy — trang quản trị
   Sửa bản nháp → bấm "Lưu thay đổi" → server kiểm tra rồi ghi data/site.json.
   ========================================================= */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = n => (Number(n) || 0).toLocaleString("vi-VN") + "đ";
  const clone = o => JSON.parse(JSON.stringify(o));
  const TONES = ["warm", "rose", "sage", "sky", "dusk", "stone"];
  const DAYS = [[1, "T2"], [2, "T3"], [3, "T4"], [4, "T5"], [5, "T6"], [6, "T7"], [0, "CN"]];
  const PF_MAX = 30;
  const STATUS = { new: "Mới", confirmed: "Đã xác nhận", deposited: "Đã cọc", done: "Hoàn tất", cancelled: "Đã hủy" };
  const SHIFT_NAMES = { full: "Cả ngày", morning: "Buổi sáng", afternoon: "Buổi chiều" }; // đơn cũ vẫn hiện giờ "09:00"

  async function api(path, opts = {}) {
    const r = await fetch(path, { credentials: "same-origin", ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    const body = await r.json().catch(() => ({}));
    if (r.status === 401 && !path.includes("/login") && !path.includes("/setup")) { showAuth(false); throw new Error(body.error || "Phiên đăng nhập đã hết"); }
    if (!r.ok) throw new Error(body.error || "Lỗi " + r.status);
    return body;
  }
  let toastTimer;
  // Thông báo nhỏ; action = { label, run } để hiện nút (VD "Hoàn tác")
  function toast(msg, action) {
    const t = $("#toast"); t.textContent = msg;
    t.classList.toggle("has-action", !!action);
    if (action) { const b = document.createElement("button"); b.type = "button"; b.className = "toast-action"; b.textContent = action.label;
      b.addEventListener("click", ev => { ev.stopPropagation(); t.classList.remove("is-visible"); action.run(); }); t.appendChild(b); }
    t.classList.add("is-visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("is-visible"), action ? 6000 : 2800);
  }
  /* Hộp xác nhận tự vẽ — thay confirm() của trình duyệt (có trình duyệt chặn hộp thoại gốc) */
  function askConfirm(message, okLabel = "Đồng ý") {
    return new Promise(resolve => {
      const back = document.activeElement;
      const o = document.createElement("div"); o.className = "confirm";
      o.innerHTML = `<div class="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="cfmMsg"><p id="cfmMsg">${esc(message)}</p>
        <div class="confirm-actions"><button type="button" class="btn btn-ghost btn-sm" data-cfm="0">Hủy</button><button type="button" class="btn btn-primary btn-sm" data-cfm="1">${esc(okLabel)}</button></div></div>`;
      const done = v => { document.removeEventListener("keydown", onKey, true); o.remove(); if (back && back.focus) back.focus({ preventScroll: true }); resolve(v); };
      const onKey = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
        if (e.key === "Tab") { const bs = $$("button", o); e.preventDefault(); bs[(bs.indexOf(document.activeElement) + 1) % bs.length].focus(); } };
      o.addEventListener("click", e => { e.stopPropagation(); const b = e.target.closest("[data-cfm]"); if (b) done(b.dataset.cfm === "1"); else if (e.target === o) done(false); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(o); $('[data-cfm="1"]', o).focus();
    });
  }
  // Xóa có thể hoàn tác: chụp bản nháp trước khi xóa, bấm "Hoàn tác" để khôi phục
  function withUndo(message, mutate) {
    const before = clone(draft), wasDirty = dirty;
    mutate(); setDirty(true); renderSection();
    toast(message, { label: "Hoàn tác", run: () => { draft = before; setDirty(wasDirty); renderSection(); toast("Đã khôi phục"); } });
  }

  /* ---------------- Đăng nhập / thiết lập ---------------- */
  let setupMode = false;
  function field(id, label, type, extra = "", hint = "") {
    return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" ${extra} />${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
  }
  function showAuth(setup) {
    setupMode = setup;
    $("#appView").hidden = true; $("#authView").hidden = false;
    $("#authFields").innerHTML = setup
      ? `<h1>Tạo tài khoản admin</h1><p class="auth-help">Lần đầu sử dụng. Nhập <b>mã thiết lập</b> đang hiện trong cửa sổ chạy server (dòng <code>MÃ THIẾT LẬP</code>).</p>
         ${field("token", "Mã thiết lập", "text", 'autocomplete="one-time-code" required')}
         ${field("username", "Tên đăng nhập", "text", 'autocomplete="username" required value="admin"')}
         ${field("password", "Mật khẩu", "password", 'autocomplete="new-password" required minlength="10"', "Tối thiểu 10 ký tự")}
         ${field("password2", "Nhập lại mật khẩu", "password", 'autocomplete="new-password" required')}`
      : `<h1>Đăng nhập quản trị</h1>
         ${field("username", "Tên đăng nhập", "text", 'autocomplete="username" required')}
         ${field("password", "Mật khẩu", "password", 'autocomplete="current-password" required')}`;
    $("#authSubmit").textContent = setup ? "Tạo tài khoản & vào trang quản trị" : "Đăng nhập";
    $("#authError").textContent = "";
    const first = $("#authFields input"); if (first) first.focus();
  }
  $("#authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)); const err = $("#authError"); err.textContent = "";
    if (setupMode && f.password !== f.password2) { err.textContent = "Hai mật khẩu không khớp."; return; }
    if (setupMode && (f.password || "").length < 10) { err.textContent = "Mật khẩu tối thiểu 10 ký tự."; return; }
    const btn = $("#authSubmit"); btn.disabled = true;
    try {
      const r = await api(setupMode ? "/api/admin/setup" : "/api/admin/login", { method: "POST", body: JSON.stringify(setupMode ? { token: f.token, username: f.username, password: f.password } : { username: f.username, password: f.password }) });
      await enterApp(r.user);
    } catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; }
  });

  /* ---------------- Dữ liệu ---------------- */
  let saved = null, draft = null, bookings = [], section = "studio", dirty = false;

  async function enterApp(user) {
    saved = await api("/api/admin/data"); saved.staff ||= []; draft = clone(saved);
    $("#who").textContent = "Đăng nhập: " + user;
    $("#authView").hidden = true; $("#appView").hidden = false;
    await loadBookings(false);
    go(location.hash.slice(1) || "bookings");
  }
  async function loadBookings(render = true) { try { bookings = await api("/api/admin/bookings"); } catch (e) { toast(e.message); } renderNav(); if (render && section === "bookings") renderSection(); }

  function setDirty(v) { dirty = v; $("#savebar").hidden = !v; }
  window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------------- Cấu hình form theo nhóm dữ liệu ---------------- */
  const COLLECTIONS = {
    services: { title: "Gói chụp", intro: "Giá, thời lượng và nội dung các gói. Gói dài hơn nửa buổi thì khách chỉ chọn được “Cả ngày”.", prefix: "sv",
      blank: () => ({ name: "Gói mới", category: "Cá nhân", duration: 60, price: 1000000, tone: "stone", desc: "", includes: [] }),
      side: x => money(x.price), sub: x => `${x.category} · ${x.duration} phút`,
      fields: [["name", "Tên gói", "text"], ["category", "Danh mục", "text"], ["tone", "Màu ảnh giữ chỗ", "tone"], ["price", "Giá (đ)", "money"], ["duration", "Thời lượng (phút)", "number"],
        ["desc", "Mô tả ngắn", "textarea", "full"], ["includes", "Bao gồm (mỗi dòng một ý)", "lines", "full"]] },
    photographers: { title: "Thám tử ảnh", intro: "Thông tin thợ, ngày làm việc, các gói nhận chụp và phụ phí khi khách chọn đích danh.", prefix: "ph",
      blank: () => ({ name: "Thám tử mới", phone: "", role: "Thám tử", years: 1, rating: 5, reviews: 0, surcharge: 0, tone: "stone", specialties: [], style: "", bio: "", workDays: [1, 2, 3, 4, 5, 6], services: [], avatar: "", portfolio: [] }),
      side: x => (x.surcharge ? "+" + money(x.surcharge) : "Không phụ phí"), sub: x => `${x.role}${x.phone ? " · " + x.phone : ""} · ${x.years} năm · ★ ${x.rating} · ${(x.portfolio || []).length} ảnh portfolio${x.payment && x.payment.enabled ? " · có TK nhận cọc riêng" : ""}`,
      fields: [["avatar", "Ảnh đại diện", "image"], ["name", "Họ tên", "text"], ["phone", "Số điện thoại / Zalo riêng", "text"], ["role", "Chức danh", "text"], ["years", "Số năm kinh nghiệm", "number"], ["rating", "Điểm đánh giá (0–5)", "decimal"], ["reviews", "Số đánh giá", "number"],
        ["surcharge", "Phụ phí chọn đích danh (đ)", "money"], ["tone", "Màu dự phòng (khi chưa có ảnh)", "tone"], ["specialties", "Chuyên môn (mỗi dòng một ý)", "lines"], ["workDays", "Ngày làm việc", "days", "full"], ["services", "Nhận chụp các gói", "services", "full"],
        ["style", "Phong cách", "textarea", "full"], ["bio", "Giới thiệu", "textarea", "full"], ["portfolio", "Portfolio — ảnh thám tử đã chụp", "portfolio", "full"], ["payment", "Tài khoản nhận cọc riêng", "bank", "full"]] },
    addons: { title: "Dịch vụ đi kèm", intro: "Khách chọn số lượng ở bước 4. “Thêm phút” cộng vào thời lượng buổi chụp.", prefix: "ad",
      blank: () => ({ name: "Dịch vụ mới", price: 100000, unit: "lần", tone: "stone", desc: "" }),
      side: x => `${money(x.price)} / ${x.unit}`, sub: x => x.desc,
      fields: [["name", "Tên dịch vụ", "text"], ["price", "Giá (đ)", "money"], ["unit", "Đơn vị", "text"], ["max", "Tối đa mỗi đơn (trống = 10)", "optnumber"], ["extraMinutes", "Thêm phút chụp / đơn vị", "optnumber"], ["tone", "Màu ảnh giữ chỗ", "tone"], ["desc", "Mô tả", "textarea", "full"]] },
    zones: { title: "Phí chụp ngoài tỉnh", intro: "Team không có studio: mọi buổi chụp ở địa điểm khách chọn. Đặt phí di chuyển theo vùng, phí lưu trú, số ngày đặt trước. “Chiếm trọn ngày” khóa cả ngày của thám tử (và số đêm ở lại).", prefix: "z",
      blank: () => ({ name: "Vùng mới · Mô tả", short: "Vùng mới", fee: 0, perNight: 0, leadDays: 1, quote: false, fullDay: true, examples: "", note: "" }),
      side: x => (x.quote ? "Báo giá riêng" : x.fee ? money(x.fee) + (x.feeMax > x.fee ? " – " + money(x.feeMax) : "") : "Miễn phí"), sub: x => `${x.examples} · đặt trước ${x.leadDays} ngày`,
      
      fields: [["name", "Tên đầy đủ", "text"], ["short", "Tên ngắn", "text"], ["fee", "Phí di chuyển / buổi (đ)", "money"], ["feeMax", "Phí tối đa (đ), để 0 nếu giá cố định", "money"], ["leadDays", "Đặt trước tối thiểu (ngày)", "number"], ["quote", "Báo giá riêng (vé thực tế)", "bool"], ["fullDay", "Chiếm trọn ngày của thám tử", "bool"],
        ["examples", "Ví dụ khu vực", "text", "full"], ["note", "Ghi chú hiển thị", "text", "full"]] },
  };

  COLLECTIONS.staff = { title: "Staff take care", intro: "Người chăm sóc khách trong buổi chụp (hỗ trợ tạo dáng, trang phục, đạo cụ…). Khách chọn khi đặt lịch; giá để 0 là miễn phí, “Để team sắp xếp” không tính tiền. Mỗi staff chỉ nhận một buổi tại một thời điểm.", prefix: "st",
    blank: () => ({ name: "Staff mới", role: "Take care", phone: "", price: 0, tone: "sage", avatar: "", bio: "", workDays: [0, 1, 2, 3, 4, 5, 6] }),
    side: x => `${x.price ? "+" + money(x.price) : "Miễn phí"} · ${(x.workDays || []).length} ngày/tuần`, sub: x => `${x.role || "Take care"}${x.phone ? " · " + x.phone : ""}`,
    fields: [["name", "Tên", "text"], ["role", "Vai trò", "text"], ["phone", "Số điện thoại / Zalo (chỉ admin thấy)", "text"], ["price", "Giá / buổi (đ) — 0 là miễn phí", "money"], ["tone", "Màu ảnh giữ chỗ", "tone"],
      ["avatar", "Ảnh đại diện", "image", "full"], ["workDays", "Ngày làm việc", "days", "full"], ["bio", "Giới thiệu ngắn (khách thấy)", "textarea", "full"]] };

  const NAV = [["bookings", "Đơn đặt lịch"], ["studio", "Thông tin team"], ["hero", "Trang chủ"], "—", ["services", "Gói chụp"], ["photographers", "Thám tử ảnh"], ["schedule", "Lịch bận thám tử"], ["staff", "Staff take care"], ["addons", "Dịch vụ đi kèm"], ["zones", "Phí chụp ngoài tỉnh"], "—", ["account", "Tài khoản"]];
  function renderNav() {
    const fresh = bookings.filter(b => b.status === "new").length;
    $("#sidenav").innerHTML = NAV.map(n => n === "—" ? "<hr />" : `<button type="button" data-nav="${n[0]}" ${n[0] === section ? 'aria-current="page"' : ""}>${n[1]}${n[0] === "bookings" && fresh ? `<span class="count">${fresh}</span>` : ""}</button>`).join("");
  }
  function go(s) {
    if (!NAV.some(n => n[0] === s)) s = "bookings";
    section = s; history.replaceState(null, "", "#" + s); renderNav(); renderSection(); $("#content").focus({ preventScroll: true }); window.scrollTo(0, 0);
  }

  /* ---------------- Ô nhập ---------------- */
  function input(path, label, type, val, cls = "") {
    const id = "f-" + path.replace(/\./g, "-");
    const wrap = (inner, lab = true) => `<div class="field ${cls}">${lab ? `<label for="${id}">${label}</label>` : `<span class="label" style="font-size:13px;font-weight:500">${label}</span>`}${inner}</div>`;
    switch (type) {
      case "textarea": return wrap(`<textarea id="${id}" data-path="${path}" data-type="text">${esc(val)}</textarea>`);
      case "lines": return wrap(`<textarea id="${id}" data-path="${path}" data-type="lines" rows="4">${esc((val || []).join("\n"))}</textarea>`);
      case "money": return wrap(`<input id="${id}" data-path="${path}" data-type="int" type="number" min="0" step="10000" value="${esc(val ?? 0)}" />${`<span class="hint" data-money-for="${path}">${money(val)}</span>`}`);
      case "number": return wrap(`<input id="${id}" data-path="${path}" data-type="int" type="number" min="0" step="1" value="${esc(val ?? 0)}" />`);
      case "optnumber": return wrap(`<input id="${id}" data-path="${path}" data-type="optint" type="number" min="0" step="1" value="${esc(val ?? "")}" placeholder="—" />`);
      case "decimal": return wrap(`<input id="${id}" data-path="${path}" data-type="float" type="number" min="0" max="5" step="0.1" value="${esc(val ?? 0)}" />`);
      case "bool": return wrap(`<label class="check" style="margin-top:8px"><input id="${id}" type="checkbox" data-path="${path}" data-type="bool" ${val ? "checked" : ""} /> Có</label>`, false);
      case "tone": return wrap(`<div class="tones" role="radiogroup" aria-label="${label}">${TONES.map(t => `<label class="tone-opt ph-${t}" title="${t}"><input type="radio" name="${id}" data-path="${path}" data-type="text" value="${t}" ${val === t ? "checked" : ""} aria-label="${t}" /></label>`).join("")}</div>`, false);
      case "days": return wrap(`<div class="check-row">${DAYS.map(([d, l]) => `<label class="pill-check"><input type="checkbox" data-path="${path}" data-type="set-int" value="${d}" ${(val || []).includes(d) ? "checked" : ""} />${l}</label>`).join("")}</div>`, false);
      case "image": return wrap(`<div class="img-field">
          <div class="img-preview ${val ? "" : "ph-" + (getAt(path.replace(/\.avatar$/, ".tone")) || "stone")}">${val ? `<img src="${esc(val)}" alt="" />` : ""}</div>
          <div class="img-actions"><label class="btn btn-ghost btn-sm">${val ? "Đổi ảnh" : "Tải ảnh lên"}<input type="file" accept="image/jpeg,image/png,image/webp" data-upload="avatar" data-target="${path}" class="visually-hidden" /></label>
            ${val ? `<button type="button" class="link-btn" data-clear-img="${path}">Gỡ ảnh</button>` : ""}<span class="hint">Ảnh vuông đẹp nhất</span></div></div>`, false);
      case "bank": return wrap(`<div class="bank-box">${payFields(path, "Khách của thám tử này chuyển cọc vào tài khoản riêng", "Tắt: dùng tài khoản team (Thông tin team → Thanh toán cọc).")}</div>`, false);
      case "portfolio": {
        const list = val || [];
        const opts = sel => `<option value="">— Gói chụp —</option>` + draft.services.map(s => `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
        return wrap(`<p class="hint" style="margin:0 0 8px">${list.length}/${PF_MAX} ảnh · Ảnh tự thu nhỏ trước khi tải. Ảnh đầu tiên làm ảnh bìa trong hồ sơ.</p>
          <div class="pf-grid">${list.map((it, j) => `
            <figure class="pf-item">
              <img src="${esc(it.src)}" alt="${esc(it.title)}" loading="lazy" />
              <input type="text" data-path="${path}.${j}.title" data-type="text" value="${esc(it.title)}" placeholder="Tiêu đề ảnh" aria-label="Tiêu đề ảnh ${j + 1}" />
              <select data-path="${path}.${j}.serviceId" data-type="text" aria-label="Gói chụp của ảnh ${j + 1}">${opts(it.serviceId)}</select>
              <div class="pf-actions">
                <button type="button" class="icon-btn" data-pf-move="${path}:${j}:-1" ${j === 0 ? "disabled" : ""} aria-label="Đưa lên trước">←</button>
                <button type="button" class="icon-btn" data-pf-move="${path}:${j}:1" ${j === list.length - 1 ? "disabled" : ""} aria-label="Đưa ra sau">→</button>
                <button type="button" class="icon-btn danger" data-pf-del="${path}:${j}" aria-label="Xóa ảnh">✕</button>
              </div>
            </figure>`).join("")}
            ${list.length < PF_MAX ? `<label class="pf-add"><input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload="portfolio" data-target="${path}" class="visually-hidden" /><span>+</span>Thêm ảnh<small>JPG · PNG · WebP</small></label>` : ""}
          </div>`, false);
      }
      case "services": return wrap(`<div class="check-row">${draft.services.map(s => `<label class="pill-check"><input type="checkbox" data-path="${path}" data-type="set-str" value="${esc(s.id)}" ${(val || []).includes(s.id) ? "checked" : ""} />${esc(s.name)}</label>`).join("")}</div>`, false);
      default: return wrap(`<input id="${id}" data-path="${path}" data-type="text" type="text" value="${esc(val)}" />`);
    }
  }
  function getAt(path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), draft); }
  function setAt(path, v) { const ks = path.split("."), last = ks.pop(); const o = ks.reduce((a, k) => a[k], draft); if (v === undefined) delete o[last]; else o[last] = v; }

  /* ---------------- Các trang ---------------- */
  function renderSection() {
    const c = $("#content");
    $("#studioName").textContent = draft.studio.name;
    if (section === "bookings") return renderBookings(c);
    if (section === "studio") return renderStudio(c);
    if (section === "hero") return renderHeroPage(c);
    if (section === "account") return renderAccount(c);
    if (section === "schedule") return renderSchedule(c);
    const cfg = COLLECTIONS[section], list = draft[section];
    const openIds = new Set($$("details.row[open]").map(d => d.dataset.id));
    c.innerHTML = `<div class="page-head"><div><h1>${cfg.title}</h1><p>${cfg.intro}</p></div><button type="button" class="btn btn-primary btn-sm" data-add="${section}">+ Thêm mới</button></div>
      <div class="rows">${list.map((x, i) => `
        <details class="row" data-id="${esc(x.id)}" ${openIds.has(x.id) || x._new ? "open" : ""}>
          <summary>
            <span class="row-swatch ph-${x.tone || "stone"}" aria-hidden="true">${x.avatar ? `<img src="${esc(x.avatar)}" alt="" />` : ""}</span>
            <span><span class="row-title" data-live="${section}.${i}.name">${esc(x.name)}</span><br /><span class="row-sub">${esc(cfg.sub(x))}</span></span>
            <span class="row-side">${esc(cfg.side(x))}</span>
            <span class="row-actions">
              <button type="button" class="icon-btn" data-move="${section}:${i}:-1" ${i === 0 ? "disabled" : ""} aria-label="Lên trên">↑</button>
              <button type="button" class="icon-btn" data-move="${section}:${i}:1" ${i === list.length - 1 ? "disabled" : ""} aria-label="Xuống dưới">↓</button>
              <button type="button" class="icon-btn danger" data-del="${section}:${i}" ${cfg.locked && cfg.locked(x) ? "disabled" : ""} aria-label="Xóa">✕</button>
            </span>
          </summary>
          <div class="row-body"><div class="form-grid">
            ${cfg.fields.map(([k, l, t, cls]) => input(`${section}.${i}.${k}`, l, t, x[k], cls || "")).join("")}
            <div class="field full"><span class="id-tag">Mã: ${esc(x.id)}</span></div>
          </div></div>
        </details>`).join("") || `<div class="empty">Chưa có mục nào.</div>`}</div>`;
    list.forEach(x => delete x._new);
    updatePayPreview();
  }

  function renderStudio(c) {
    const s = draft.studio;
    c.innerHTML = `<div class="page-head"><div><h1>Thông tin team</h1><p>Hiện ở header, phần liên hệ, chân trang và trong đơn đặt lịch. Team không có studio nên không cần địa chỉ.</p></div></div>
      <div class="panel"><div class="form-grid">
        ${input("studio.name", "Tên team", "text", s.name)}${input("studio.phone", "Điện thoại", "text", s.phone)}${input("studio.email", "Email", "text", s.email)}
        ${input("studio.area", "Khu vực hoạt động", "text", s.area, "half")}${input("studio.openHours", "Giờ nhận lịch", "text", s.openHours)}
        ${input("studio.facebook", "Link Facebook (https://…)", "text", s.facebook)}${input("studio.instagram", "Link Instagram (https://…)", "text", s.instagram)}${input("studio.tagline", "Khẩu hiệu", "text", s.tagline)}${input("studio.depositPercent", "% đặt cọc", "number", s.depositPercent)}
      </div></div>
      <div class="page-head" style="margin-top:28px"><div><h1 style="font-size:24px">Lịch nhận khách</h1><p>Khách chọn <b>Cả ngày</b>, <b>Buổi sáng</b> hoặc <b>Buổi chiều</b>. Cả ngày = từ đầu buổi sáng đến hết buổi chiều. Chụp đi tỉnh chỉ nhận cả ngày.</p></div></div>
      <div class="panel"><div class="form-grid">
        ${["morning", "afternoon"].map(k => { const l = k === "morning" ? "Buổi sáng" : "Buổi chiều", v = (draft.shifts || {})[k] || {};
          return `<div class="field"><label for="sh-${k}-s">${l}: bắt đầu</label><input id="sh-${k}-s" type="time" step="900" data-path="shifts.${k}.start" data-type="text" value="${esc(v.start || "")}" /></div>
            <div class="field"><label for="sh-${k}-e">${l}: kết thúc</label><input id="sh-${k}-e" type="time" step="900" data-path="shifts.${k}.end" data-type="text" value="${esc(v.end || "")}" /></div>`; }).join("")}
        ${input("bookingWindowDays", "Mở lịch trước tối đa (ngày)", "number", draft.bookingWindowDays)}
      </div></div>
      ${paymentPanel()}
      <div class="page-head" style="margin-top:28px"><div><h1 style="font-size:24px">Tự động xác nhận cọc (SePay)</h1>
        <p>Khi khách chuyển khoản đúng nội dung, đơn tự chuyển sang <b>Đã cọc</b> và khách thấy ngay nút nhắn Zalo/Messenger với team. Cần web đã chạy public có tên miền HTTPS.</p></div></div>
      <div class="panel" id="payhookPanel"><p class="hint">Đang tải…</p></div>`;
    loadPayhook();
    updatePayPreview();
  }

  /* ---------------- Webhook SePay (khóa lưu riêng ở server, không nằm trong dữ liệu trang) ---------------- */
  async function loadPayhook(next) {
    const box = document.getElementById("payhookPanel"); if (!box) return;
    let h; try { h = next || await api("/api/admin/payhook"); } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
    const url = location.origin + "/api/webhooks/sepay", on = !!h.apiKey;
    const row = (label, val) => `<div class="field full"><label>${label}</label><div style="display:flex;gap:8px"><input type="text" readonly value="${esc(val)}" style="font-family:var(--font-mono)" /><button type="button" class="btn btn-ghost btn-sm" data-copy-text="${esc(val)}">Sao chép</button></div></div>`;
    box.innerHTML = on ? `<div class="form-grid">${row("URL nhận webhook (dán vào SePay)", url)}${row("API Key (SePay → Kiểu chứng thực: API Key)", h.apiKey)}</div>
        <ol class="hint" style="margin:12px 0 0;padding-left:18px;line-height:1.7">
          <li>Đăng ký <b>sepay.vn</b>, liên kết tài khoản ngân hàng nhận cọc (team và thám tử có TK riêng).</li>
          <li>Vào <b>Tích hợp WebHooks → Thêm webhook</b>: sự kiện <b>Có tiền vào</b>, dán URL và API Key ở trên.</li>
          <li>Phần “Bỏ qua nếu nội dung không có code thanh toán”: chọn <b>Không</b>.</li></ol>
        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button type="button" class="btn btn-ghost btn-sm" data-payhook="rotate">Tạo khóa mới</button><button type="button" class="btn btn-ghost btn-sm" data-payhook="disable">Tắt tự động</button></div>`
      : `<p class="hint" style="margin:0 0 12px">Đang tắt. Đơn chỉ chuyển sang “Đã cọc” khi bạn tự đổi trạng thái.</p><button type="button" class="btn btn-primary btn-sm" data-payhook="rotate">Bật &amp; tạo API Key</button>`;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") box.insertAdjacentHTML("beforeend", `<p class="hint" style="margin-top:10px">Lưu ý: bạn đang mở bằng ${esc(location.host)}, SePay không gọi tới máy này được. URL thật sẽ là https://tên-miền-của-bạn/api/webhooks/sepay.</p>`);
  }

  /* ---------------- Thanh toán cọc (VietQR) ---------------- */
  const BLANK_PAY = () => ({ enabled: false, bankBin: "", bankLabel: "", accountNo: "", accountName: "" });
  function paymentPanel() {
    draft.studio.payment ||= BLANK_PAY();
    return `<div class="page-head" style="margin-top:28px"><div><h1 style="font-size:24px">Thanh toán cọc (VietQR) — tài khoản team</h1>
        <p>Màn đặt lịch thành công hiện mã QR có sẵn số tiền cọc và nội dung là mã hồ sơ. Thám tử có tài khoản riêng (mục Thám tử ảnh) thì cọc chuyển vào tài khoản thám tử; còn lại dùng tài khoản này.</p></div></div>
      <div class="panel">${payFields("studio.payment", "Bật mã QR đặt cọc bằng tài khoản team", "Tắt và thám tử cũng không có tài khoản riêng: khách được báo team sẽ gửi thông tin chuyển khoản khi gọi xác nhận.")}</div>`;
  }
  // Khối nhập tài khoản ngân hàng dùng chung (team & từng thám tử). base = đường dẫn dữ liệu, VD "photographers.2.payment"
  function payFields(base, toggleLabel, toggleHint) {
    const p = getAt(base) || (setAt(base, BLANK_PAY()), getAt(base));
    const key = base.replace(/\./g, "-");
    const banks = window.VietQR ? VietQR.BANKS : [];
    const known = banks.some(b => b[0] === p.bankBin);
    return `<div class="pay-panel">
        <div class="form-grid">
          <div class="field full"><label class="check"><input type="checkbox" data-path="${base}.enabled" data-type="bool" ${p.enabled ? "checked" : ""} /> ${toggleLabel}</label>
            <span class="hint">${toggleHint}</span></div>
          <div class="field"><label for="bank-${key}">Ngân hàng</label>
            <select id="bank-${key}" data-pay-bank="${base}"><option value="">— Chọn ngân hàng —</option>${banks.map(([bin, n]) => `<option value="${bin}" ${bin === p.bankBin ? "selected" : ""}>${esc(n)}</option>`).join("")}
              <option value="other" ${p.bankBin && !known ? "selected" : ""}>Ngân hàng khác (nhập mã BIN)</option></select></div>
          <div class="field" ${p.bankBin && !known ? "" : "hidden"} id="binf-${key}"><label for="bin-${key}">Mã BIN (6 số)</label><input id="bin-${key}" data-path="${base}.bankBin" data-type="text" inputmode="numeric" maxlength="6" value="${esc(p.bankBin)}" /></div>
          ${input(base + ".accountNo", "Số tài khoản", "text", p.accountNo)}
          ${input(base + ".accountName", "Tên chủ tài khoản (không dấu)", "text", p.accountName)}
        </div>
        <div class="pay-preview">
          <div class="pay-qr" data-pay-preview="${base}"></div>
          <p class="hint">QR thử 10.000đ, nội dung “MORIGRAPHY TEST”. <b>Hãy quét bằng app ngân hàng</b> để chắc tên chủ tài khoản hiện đúng, rồi bấm Lưu.</p>
        </div>
      </div>`;
  }
  let payTimer;
  function updatePayPreview() {
    clearTimeout(payTimer);
    payTimer = setTimeout(() => {
      for (const box of $$("[data-pay-preview]")) {
        const p = getAt(box.dataset.payPreview) || {};
        if (!window.VietQR || !window.qrcode) { box.innerHTML = `<div class="empty">Không tải được thư viện QR (kiểm tra mạng).</div>`; continue; }
        if (!p.bankBin && !p.accountNo) { box.innerHTML = `<div class="empty">Chọn ngân hàng và nhập số tài khoản để xem QR thử.</div>`; continue; }
        try {
          const url = VietQR.dataURL(VietQR.payload({ bin: p.bankBin, account: p.accountNo, amount: 10000, info: "MORIGRAPHY TEST" }), 5, 10);
          box.innerHTML = `<img src="${url}" alt="Mã QR thử" /><small>${esc(VietQR.bankName(p.bankBin) || "BIN " + p.bankBin)} · ${esc(p.accountNo)}<br />${esc(p.accountName || "")}</small>`;
        } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
      }
    }, 200);
  }

  /* ---------------- Ảnh bìa trang chủ (tập hồ sơ CASE FILE) ---------------- */
  function renderHeroPage(c) {
    const h = (draft.hero = Object.assign({}, window.DEFAULT_HERO || {}, draft.hero || {}));
    h.stats = (h.stats || []).map(s => ({ ...s }));
    const secs = (draft.sections = window.mergeSections ? window.mergeSections(draft.sections) : (draft.sections || {}));
    const L = window.SECTION_LABELS || {};
    c.innerHTML = `<div class="page-head"><div><h1>Trang chủ</h1><p>Chỉnh mọi chữ và ảnh bìa trên trang chủ. Xem trước cập nhật ngay; bấm Lưu để đăng lên web.
        <br />Để trống một ô = ẩn dòng đó. Gõ <code>{coc}</code> để hiện % đặt cọc, <code>{team}</code> để hiện tên team.</p></div>
        <button type="button" class="btn btn-ghost btn-sm" data-hero-reset>Khôi phục chữ mặc định</button></div>
      <div class="hero-editor">
        <div class="hero-forms">
        <div class="panel"><h2 class="panel-title">Phần đầu trang — chữ</h2><div class="form-grid">
          ${input("hero.eyebrow", "Dòng nhỏ trên cùng", "text", h.eyebrow, "full")}
          ${input("hero.title1", "Tiêu đề — dòng 1", "text", h.title1)}
          ${input("hero.title2", "Tiêu đề — dòng 2 (nghiêng, màu đỏ)", "text", h.title2, "half")}
          ${input("hero.sub", "Đoạn giới thiệu", "textarea", h.sub, "full")}
          ${input("hero.btnPrimary", "Chữ nút chính (tới Đặt lịch)", "text", h.btnPrimary)}
          ${input("hero.btnGhost", "Chữ nút phụ (tới Gói chụp)", "text", h.btnGhost, "half")}
          <div class="field full"><span class="label" style="font-size:13px;font-weight:500">Các con số thống kê (tối đa 4)</span>
            <div class="stat-rows">${h.stats.map((s, i) => `<div class="stat-row">
              <input type="text" data-path="hero.stats.${i}.value" data-type="text" value="${esc(s.value)}" placeholder="VD: 2.400+" aria-label="Con số ${i + 1}" />
              <input type="text" data-path="hero.stats.${i}.label" data-type="text" value="${esc(s.label)}" placeholder="VD: hồ sơ đã khép" aria-label="Mô tả con số ${i + 1}" />
              <button type="button" class="icon-btn danger" data-stat-del="${i}" aria-label="Xóa con số ${i + 1}">✕</button></div>`).join("")}</div>
            ${h.stats.length < 4 ? `<button type="button" class="link-btn" data-stat-add style="margin-top:8px;align-self:flex-start">+ Thêm con số</button>` : ""}</div>
        </div></div>
        <div class="panel"><h2 class="panel-title">Ảnh bìa — tập hồ sơ CASE FILE</h2><div class="form-grid hero-form">
          <div class="field full"><span class="label" style="font-size:13px;font-weight:500">Ảnh trong khung polaroid</span>
            <div class="img-field">
              <div class="img-preview square ${h.photo ? "" : "ph-" + h.photoTone}">${h.photo ? `<img src="${esc(h.photo)}" alt="" />` : ""}</div>
              <div class="img-actions"><label class="btn btn-ghost btn-sm">${h.photo ? "Đổi ảnh" : "Tải ảnh lên"}<input type="file" accept="image/jpeg,image/png,image/webp" data-upload="photo" data-target="hero.photo" class="visually-hidden" /></label>
                ${h.photo ? `<button type="button" class="link-btn" data-clear-img="hero.photo">Gỡ ảnh (dùng ô màu)</button>` : ""}<span class="hint">Ảnh vuông đẹp nhất · tự thu nhỏ trước khi tải</span></div></div></div>
          ${input("hero.caption", "Chú thích dưới ảnh", "text", h.caption, "full")}
          ${input("hero.tab", "Nhãn trên tập hồ sơ", "text", h.tab, "full")}
          ${input("hero.stampTitle", "Con dấu — dòng to", "text", h.stampTitle)}
          ${input("hero.stampSub", "Con dấu — dòng nhỏ", "text", h.stampSub, "half")}
          ${input("hero.showStamp", "Hiện con dấu đỏ", "bool", h.showStamp)}
          ${input("hero.showMagnifier", "Hiện kính lúp", "bool", h.showMagnifier)}
          <div class="field"></div>
          ${input("hero.folderTone", "Màu tập hồ sơ", "tone", h.folderTone, "half")}
          ${input("hero.photoTone", "Màu ô ảnh (khi chưa có ảnh)", "tone", h.photoTone)}
        </div></div>
        ${Object.keys(secs).map(k => `<div class="panel"><h2 class="panel-title">Mục “${esc(L[k] || k)}”</h2><div class="form-grid">
          ${k === "cta"
            ? input(`sections.cta.title`, "Tiêu đề", "text", secs.cta.title, "full") + input(`sections.cta.sub`, "Mô tả", "text", secs.cta.sub, "full") + input(`sections.cta.btn`, "Chữ nút", "text", secs.cta.btn)
            : input(`sections.${k}.eyebrow`, "Dòng nhỏ", "text", secs[k].eyebrow) + input(`sections.${k}.title`, "Tiêu đề", "text", secs[k].title, "half") + input(`sections.${k}.sub`, "Mô tả", "textarea", secs[k].sub, "full")}
        </div></div>`).join("")}
        </div>
        <div class="hero-preview-wrap"><p class="hint" style="margin:0 0 10px">Xem trước phần đầu trang</p>
          <div class="hero-copy mini" id="heroCopyPreview"></div>
          <div class="hero-visual" id="heroPreview" style="margin-top:44px"></div></div>
      </div>`;
    updateHeroPreview();
  }
  function updateHeroPreview() {
    const ctx = { coc: draft.studio.depositPercent, team: draft.studio.name };
    const p = $("#heroPreview"); if (p && window.renderHeroVisual) p.innerHTML = window.renderHeroVisual(draft.hero);
    const cp = $("#heroCopyPreview"); if (cp && window.renderHeroCopy) cp.innerHTML = window.renderHeroCopy(draft.hero, ctx);
  }

  function renderAccount(c) {
    c.innerHTML = `<div class="page-head"><div><h1>Tài khoản</h1><p>Đổi mật khẩu sẽ đăng xuất các thiết bị khác.</p></div></div>
      <form class="panel" id="pwForm" style="max-width:520px;display:flex;flex-direction:column;gap:14px" novalidate>
        <div class="field"><label for="pwCur">Mật khẩu hiện tại</label><input id="pwCur" name="current" type="password" autocomplete="current-password" required /></div>
        <div class="field"><label for="pwNew">Mật khẩu mới</label><input id="pwNew" name="next" type="password" autocomplete="new-password" minlength="10" required /><span class="hint">Tối thiểu 10 ký tự</span></div>
        <div class="field"><label for="pwNew2">Nhập lại mật khẩu mới</label><input id="pwNew2" name="next2" type="password" autocomplete="new-password" required /></div>
        <p class="step-error" id="pwErr" style="text-align:left"></p>
        <button class="btn btn-primary" type="submit" style="align-self:flex-start">Đổi mật khẩu</button>
      </form>`;
    $("#pwForm").addEventListener("submit", async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), err = $("#pwErr"); err.textContent = "";
      if (f.next.length < 10) return (err.textContent = "Mật khẩu mới tối thiểu 10 ký tự.");
      if (f.next !== f.next2) return (err.textContent = "Hai mật khẩu mới không khớp.");
      try { await api("/api/admin/password", { method: "POST", body: JSON.stringify({ current: f.current, next: f.next }) }); e.target.reset(); toast("Đã đổi mật khẩu"); }
      catch (ex) { err.textContent = ex.message; }
    });
  }

  let bkFilter = "all", bkQuery = "";
  function renderBookings(c) {
    const q = bkQuery.trim().toLowerCase();
    const list = bookings.filter(b => (bkFilter === "all" || b.status === bkFilter) && (!q || [b.code, b.customer.name, b.customer.phone, b.serviceName, b.address].join(" ").toLowerCase().includes(q)));
    const cnt = s => bookings.filter(b => s === "all" || b.status === s).length;
    c.innerHTML = `<div class="page-head"><div><h1>Đơn đặt lịch</h1><p>${bookings.length} đơn · mới nhất ở trên. Đổi trạng thái sau khi gọi xác nhận / nhận cọc.</p></div>
        <button type="button" class="btn btn-ghost btn-sm" id="btnReload">Tải lại</button></div>
      <div class="toolbar">
        ${[["all", "Tất cả"], ...Object.entries(STATUS)].map(([k, l]) => `<button type="button" class="chip${bkFilter === k ? " is-active" : ""}" data-bkf="${k}">${l} (${cnt(k)})</button>`).join("")}
        <input type="search" id="bkSearch" placeholder="Tìm mã, tên, SĐT…" value="${esc(bkQuery)}" aria-label="Tìm đơn" />
      </div>
      <div class="bk-list">${list.map(b => `
        <article class="bk">
          <div><span class="code">${esc(b.code)}</span> <span class="status st-${b.status}">${STATUS[b.status]}</span>
            <span class="when">${esc(b.date.split("-").reverse().join("/"))} · ${esc(SHIFT_NAMES[b.time] || b.time)}</span><small>${b.minutes} phút · tạo ${new Date(b.createdAt).toLocaleString("vi-VN")}</small></div>
          <div><b>${esc(b.customer.name)}</b> · <a href="tel:${esc(b.customer.phone)}">${esc(b.customer.phone)}</a>${b.customer.email ? `<small>${esc(b.customer.email)}</small>` : ""}
            <small>${esc(b.serviceName)} · ${esc(b.photographerName)}${b.staffName ? " · Staff: " + esc(b.staffName) : ""}</small>
            <small>${esc(b.zoneName)}${b.address ? " · " + esc(b.address) : ""}${b.nights ? ` · ${b.nights} đêm` : ""}${b.fullDay ? " · khóa trọn ngày" : ""}</small>
            ${b.customer.note ? `<small>Ghi chú khách: “${esc(b.customer.note)}”</small>` : ""}</div>
          <div><span class="money">${money(b.total)}${b.needsQuote ? "*" : ""}</span><small>Cọc ${money(b.deposit)}</small>
            ${b.transferNote ? `<small>Nội dung CK: <b style="font-family:var(--font-mono)">${esc(b.transferNote)}</b></small>` : ""}
            ${(b.payments || []).length ? `<small class="paid-line">Đã nhận ${money(b.payments.reduce((s, x) => s + x.amount, 0))} tự động${b.depositedAt ? " · " + new Date(b.depositedAt).toLocaleString("vi-VN") : ""}</small>` : ""}
            ${b.payTo ? `<small>Cọc vào: ${b.payTo.owner === "photographer" ? "TK riêng của " + esc(b.payTo.ownerName) : "TK team"} · ${esc(b.payTo.bankLabel || b.payTo.bankBin)} ${esc(b.payTo.accountNo)}</small>` : ""}
            <small>${(b.lines || []).slice(1).map(l => esc(l[0])).join(" · ")}</small></div>
          <div><label class="visually-hidden" for="st-${esc(b.code)}">Trạng thái</label>
            <select id="st-${esc(b.code)}" data-status="${esc(b.code)}">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === b.status ? "selected" : ""}>${l}</option>`).join("")}</select>
            <textarea data-note="${esc(b.code)}" placeholder="Ghi chú nội bộ…" aria-label="Ghi chú nội bộ">${esc(b.adminNote)}</textarea></div>
        </article>`).join("") || `<div class="empty">${bookings.length ? "Không có đơn phù hợp bộ lọc." : "Chưa có đơn đặt lịch nào."}</div>`}</div>`;
  }

  /* ---------------- Lịch bận thám tử ----------------
     Mặc định thám tử RẢNH. Ngày nào có việc riêng thì tích vào (cả ngày / chỉ sáng / chỉ chiều)
     → khách không đặt được buổi đó. Ngày đã có khách đặt hiện sẵn, không cần tích. Bấm là lưu ngay. */
  const pad2 = n => String(n).padStart(2, "0");
  const keyOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const BLOCK_LABEL = { day: "Bận cả ngày", morning: "Bận sáng", afternoon: "Bận chiều" };
  const sched = { pid: null, month: keyOf(new Date()).slice(0, 7), mode: "day", data: null, busy: false };
  async function loadSchedule() {
    try { sched.data = await api("/api/admin/blocks"); } catch (e) { toast(e.message); sched.data = { blocks: {}, booked: {} }; }
    if (section === "schedule") renderSection();
  }
  function renderSchedule(c) {
    const people = saved.photographers || [];
    if (!people.length) { c.innerHTML = `<div class="page-head"><div><h1>Lịch bận thám tử</h1></div></div><div class="empty">Chưa có thám tử nào. Thêm ở mục Thám tử ảnh.</div>`; return; }
    if (!people.some(p => p.id === sched.pid)) sched.pid = people[0].id;
    if (!sched.data) { c.innerHTML = `<div class="page-head"><div><h1>Lịch bận thám tử</h1></div></div><div class="empty">Đang tải lịch…</div>`; loadSchedule(); return; }
    const ph = people.find(p => p.id === sched.pid);
    const mine = sched.data.blocks[sched.pid] || {};
    const [y, m] = sched.month.split("-").map(Number);
    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), lead = (first.getDay() + 6) % 7; // tuần bắt đầu T2
    const today = keyOf(new Date()), thisMonth = today.slice(0, 7);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(`<span class="sc-cell is-blank"></span>`);
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m - 1, d), k = keyOf(date);
      const past = k < today, off = !(ph.workDays || []).includes(date.getDay());
      const bk = (sched.data.booked[k] || {})[sched.pid]; // "day" | ["morning", ...]
      const bkText = !bk ? "" : bk === "day" || bk.length === 2 ? "Có khách cả ngày" : bk[0] === "morning" ? "Có khách sáng" : "Có khách chiều";
      const v = mine[k];
      const cls = ["sc-cell", past && "is-past", off && "is-off", v && "is-blocked", bk && "is-booked", k === today && "is-today"].filter(Boolean).join(" ");
      const note = off ? "Ngày nghỉ" : v ? BLOCK_LABEL[v] : bkText || "Rảnh";
      cells.push(`<button type="button" class="${cls}" data-sday="${k}" ${past || off ? "disabled" : ""} aria-pressed="${!!v}" aria-label="Ngày ${d}: ${note}${v && bkText ? ", " + bkText : ""}">
        <span class="sc-num">${d}</span>${v ? `<span class="sc-tick" aria-hidden="true">✓</span>` : ""}
        <small>${esc(note)}</small>${v && bkText ? `<small class="sc-bk">${bkText}</small>` : ""}</button>`);
    }
    const nBlocked = Object.keys(mine).filter(k => k.startsWith(sched.month)).length;
    c.innerHTML = `<div class="page-head"><div><h1>Lịch bận thám tử</h1><p>Mặc định là <b>rảnh</b>. Ngày nào thám tử có việc riêng thì bấm vào để tích <b>bận</b>, khách sẽ không đặt được. Bấm lần nữa để bỏ tích. Lưu ngay, không cần bấm Lưu.</p></div></div>
      <div class="panel sc-panel">
        <div class="toolbar">${people.map(p => `<button type="button" class="chip${p.id === sched.pid ? " is-active" : ""}" data-spid="${esc(p.id)}">${esc(p.name)}</button>`).join("")}</div>
        <div class="sc-bar">
          <div class="sc-modes" role="group" aria-label="Kiểu bận khi tích">
            <span class="hint">Khi tích, đánh dấu:</span>
            ${Object.entries({ day: "Cả ngày", morning: "Chỉ buổi sáng", afternoon: "Chỉ buổi chiều" }).map(([k, l]) => `<button type="button" class="chip${sched.mode === k ? " is-active" : ""}" data-smode="${k}" aria-pressed="${sched.mode === k}">${l}</button>`).join("")}
          </div>
          <div class="sc-month">
            <button type="button" class="icon-btn" data-smonth="-1" ${sched.month <= thisMonth ? "disabled" : ""} aria-label="Tháng trước">‹</button>
            <strong>Tháng ${m}/${y}</strong>
            <button type="button" class="icon-btn" data-smonth="1" aria-label="Tháng sau">›</button>
          </div>
        </div>
        <div class="sc-grid">${["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map(d => `<span class="sc-dow">${d}</span>`).join("")}${cells.join("")}</div>
        <p class="sc-legend"><span class="lg lg-free"></span>Rảnh <span class="lg lg-blocked"></span>Đã tích bận <span class="lg lg-booked"></span>Có khách đặt <span class="lg lg-off"></span>Ngày nghỉ (đổi ở Thám tử ảnh)
          · ${esc(ph.name)} có <b>${nBlocked}</b> ngày tích bận trong tháng này</p>
      </div>`;
  }
  async function toggleBlock(date) {
    if (sched.busy) return;
    const cur = (sched.data.blocks[sched.pid] || {})[date];
    const value = cur === sched.mode ? "" : sched.mode;
    const vn = date.split("-").reverse().join("/");
    sched.busy = true;
    try {
      const r = await api("/api/admin/blocks", { method: "POST", body: JSON.stringify({ pid: sched.pid, date, value }) });
      sched.data.blocks = r.blocks; renderSection();
      toast(value ? `${vn}: ${BLOCK_LABEL[value]}` : `${vn}: đã bỏ tích, thám tử rảnh`);
    } catch (e) { toast(e.message); }
    finally { sched.busy = false; }
  }

  /* ---------------- Sự kiện ---------------- */
  document.addEventListener("click", async e => {
    // Bấm logo: về trang đầu quản trị (Đơn đặt lịch), cuộn lên đầu — bản nháp chưa lưu vẫn giữ nguyên
    const home = e.target.closest("#adminHome");
    if (home) { e.preventDefault(); go("bookings"); return; }
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.nav) { if (t.dataset.nav === "schedule") sched.data = null; go(t.dataset.nav); return; }
    if (t.dataset.spid) { sched.pid = t.dataset.spid; renderSection(); return; }
    if (t.dataset.smode) { sched.mode = t.dataset.smode; renderSection(); return; }
    if (t.dataset.smonth) { const [y, m] = sched.month.split("-").map(Number); sched.month = keyOf(new Date(y, m - 1 + Number(t.dataset.smonth), 1)).slice(0, 7); renderSection(); return; }
    if (t.dataset.sday) { toggleBlock(t.dataset.sday); return; }
    if (t.dataset.copyText !== undefined) { try { await navigator.clipboard.writeText(t.dataset.copyText); toast("Đã sao chép"); } catch (err) { toast("Không sao chép được, hãy chọn và copy thủ công"); } return; }
    if (t.dataset.payhook) {
      const act = t.dataset.payhook;
      if (act === "disable" && !(await askConfirm("Tắt tự động xác nhận cọc? SePay sẽ không cập nhật đơn được nữa."))) return;
      if (act === "rotate" && document.querySelector('[data-payhook="disable"]') && !(await askConfirm("Tạo khóa mới? Khóa cũ ngừng hoạt động, bạn phải dán khóa mới vào SePay."))) return;
      try { loadPayhook(await api("/api/admin/payhook", { method: "POST", body: JSON.stringify({ action: act }) })); toast(act === "disable" ? "Đã tắt tự động xác nhận cọc" : "Đã tạo API Key mới"); } catch (err) { toast(err.message); }
      return;
    }
    if (t.dataset.pfMove) { const [p, j, d] = t.dataset.pfMove.split(":"); const a = getAt(p), n = +j + +d; [a[j], a[n]] = [a[n], a[j]]; setDirty(true); renderSection(); return; }
    if (t.dataset.pfDel) {
      const [p, j] = t.dataset.pfDel.split(":"); const it = getAt(p)[+j];
      withUndo(`Đã xóa ảnh “${it.title || "không tên"}” — bấm Lưu để áp dụng`, () => getAt(p).splice(+j, 1));
      return;
    }
    if (t.dataset.clearImg) { setAt(t.dataset.clearImg, ""); setDirty(true); renderSection(); return; }
    if (t.matches("[data-stat-add]")) { draft.hero.stats.push({ value: "", label: "" }); setDirty(true); renderSection(); $(`[data-path="hero.stats.${draft.hero.stats.length - 1}.value"]`)?.focus(); return; }
    if (t.dataset.statDel !== undefined) { const i = +t.dataset.statDel; withUndo("Đã xóa con số — bấm Lưu để áp dụng", () => draft.hero.stats.splice(i, 1)); return; }
    if (t.matches("[data-hero-reset]")) {
      withUndo("Đã khôi phục chữ mặc định — bấm Lưu để áp dụng", () => {
        const d = window.DEFAULT_HERO;
        Object.assign(draft.hero, { eyebrow: d.eyebrow, title1: d.title1, title2: d.title2, sub: d.sub, btnPrimary: d.btnPrimary, btnGhost: d.btnGhost,
          stats: d.stats.map(s => ({ ...s })), caption: d.caption, tab: d.tab, stampTitle: d.stampTitle, stampSub: d.stampSub, showStamp: true, showMagnifier: true });
        draft.sections = JSON.parse(JSON.stringify(window.DEFAULT_SECTIONS));
      });
      return;
    }
    if (t.dataset.add) {
      const key = t.dataset.add, cfg = COLLECTIONS[key];
      let id; do { id = cfg.prefix + "-" + Math.random().toString(36).slice(2, 6); } while (draft[key].some(x => x.id === id));
      draft[key].unshift({ id, ...cfg.blank(), _new: true }); setDirty(true); renderSection(); return;
    }
    if (t.dataset.move) { e.preventDefault(); const [k, i, d] = t.dataset.move.split(":"); const a = draft[k], n = +i + +d; [a[i], a[n]] = [a[n], a[i]]; setDirty(true); renderSection(); return; }
    if (t.dataset.del) {
      e.preventDefault(); const [k, i] = t.dataset.del.split(":"); const x = draft[k][i];
      withUndo(`Đã xóa “${x.name}” — bấm Lưu để áp dụng`, () => {
        draft[k].splice(i, 1);
        if (k === "services") draft.photographers.forEach(p => (p.services = p.services.filter(s => s !== x.id)));
      });
      return;
    }
    if (t.dataset.bkf) { bkFilter = t.dataset.bkf; renderSection(); return; }
    if (t.id === "btnReload") { await loadBookings(); toast("Đã tải lại danh sách đơn"); return; }
    if (t.id === "btnRevert") { if (!(await askConfirm("Bỏ mọi thay đổi chưa lưu?", "Bỏ thay đổi"))) return; draft = clone(saved); setDirty(false); renderSection(); return; }
    if (t.id === "btnSave") {
      t.disabled = true; t.textContent = "Đang lưu…";
      try { const r = await api("/api/admin/data", { method: "PUT", body: JSON.stringify(draft) }); saved = r.data; draft = clone(saved); setDirty(false); renderSection(); toast("Đã lưu — trang khách cập nhật ngay"); }
      catch (ex) { toast("Chưa lưu được: " + ex.message); }
      finally { t.disabled = false; t.textContent = "Lưu thay đổi"; }
      return;
    }
    if (t.id === "btnLogout") {
      if (dirty && !(await askConfirm("Có thay đổi chưa lưu. Vẫn đăng xuất?", "Đăng xuất"))) return;
      await fetch("/api/admin/logout", { method: "POST", headers: { "Content-Type": "application/json" } }); setDirty(false); showAuth(false); return;
    }
  });

  function onEdit(el) {
    const path = el.dataset.path; if (!path) return;
    const type = el.dataset.type; let v;
    if (type === "int") v = Math.max(0, Math.round(Number(el.value) || 0));
    else if (type === "optint") v = el.value === "" ? undefined : Math.max(0, Math.round(Number(el.value) || 0));
    else if (type === "float") v = Math.min(5, Math.max(0, Number(el.value) || 0));
    else if (type === "bool") v = el.checked;
    else if (type === "lines") v = el.value.split("\n").map(s => s.trim()).filter(Boolean);
    else if (type === "set-int" || type === "set-str") {
      v = $$(`input[data-path="${path}"]`).filter(i => i.checked).map(i => (type === "set-int" ? Number(i.value) : i.value));
    } else v = el.value;
    setAt(path, v); setDirty(true);
    const m = $(`[data-money-for="${path}"]`); if (m) m.textContent = money(v);
    const live = $(`[data-live="${path}"]`); if (live) live.textContent = v;
    if (path === "studio.name") $("#studioName").textContent = v;
    if (path.startsWith("sections.") || path.startsWith("studio.depositPercent")) updateHeroPreview();
    if (path.startsWith("hero.")) { updateHeroPreview(); if (path === "hero.photoTone" && !draft.hero.photo) { const pv = $(".img-preview.square"); if (pv) pv.className = "img-preview square ph-" + v; } }
    if (/(^studio|\.\d+)\.payment\./.test(path)) updatePayPreview();
  }
  $("#content").addEventListener("input", e => { if (e.target.dataset.path && e.target.type !== "checkbox" && e.target.type !== "radio") onEdit(e.target); if (e.target.id === "bkSearch") { bkQuery = e.target.value; const pos = e.target.selectionStart; renderSection(); const s = $("#bkSearch"); s.focus(); s.setSelectionRange(pos, pos); } });
  /* ---------------- Tải ảnh (thu nhỏ trên trình duyệt rồi gửi lên) ---------------- */
  async function shrink(file, max) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(`${file.name}: chỉ nhận ảnh JPG, PNG, WebP`);
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
    let blob = await new Promise(r => c.toBlob(r, "image/webp", 0.85));
    if (!blob || blob.type !== "image/webp") blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.86));
    return blob;
  }
  async function uploadOne(file, max) {
    const blob = await shrink(file, max);
    const r = await fetch("/api/admin/upload", { method: "POST", credentials: "same-origin", headers: { "Content-Type": blob.type }, body: blob });
    const b = await r.json().catch(() => ({}));
    if (r.status === 401) { showAuth(false); throw new Error("Phiên đăng nhập đã hết"); }
    if (!r.ok) throw new Error(`${file.name}: ${b.error || "lỗi " + r.status}`);
    return b.src;
  }
  async function handleUpload(el) {
    const files = [...el.files]; el.value = ""; if (!files.length) return;
    const target = el.dataset.target, kind = el.dataset.upload;
    const errors = [];
    if (kind === "avatar" || kind === "photo") {
      toast(kind === "avatar" ? "Đang tải ảnh đại diện…" : "Đang tải ảnh bìa…");
      try { setAt(target, await uploadOne(files[0], kind === "avatar" ? 800 : 1400)); } catch (ex) { errors.push(ex.message); }
    } else {
      const list = getAt(target) || []; setAt(target, list);
      const room = PF_MAX - list.length;
      if (files.length > room) errors.push(`Chỉ thêm được ${room} ảnh nữa (tối đa ${PF_MAX}).`);
      const take = files.slice(0, Math.max(0, room));
      for (let i = 0; i < take.length; i++) {
        toast(`Đang tải ảnh ${i + 1}/${take.length}…`);
        try { const src = await uploadOne(take[i], 1600); list.push({ id: Math.random().toString(36).slice(2, 10), src, title: take[i].name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80), serviceId: "" }); }
        catch (ex) { errors.push(ex.message); }
      }
    }
    setDirty(true); renderSection();
    toast(errors.length ? errors.join(" · ") : "Đã tải ảnh — bấm Lưu thay đổi để đăng lên web");
  }

  $("#content").addEventListener("change", async e => {
    const el = e.target;
    if (el.dataset.upload) { handleUpload(el); return; }
    if (el.matches("[data-pay-bank]")) {
      const base = el.dataset.payBank, key = base.replace(/\./g, "-"), p = getAt(base), other = el.value === "other";
      document.getElementById("binf-" + key).hidden = !other;
      p.bankBin = other ? "" : el.value; p.bankLabel = other ? "" : VietQR.bankName(el.value);
      if (other) { const b = document.getElementById("bin-" + key); b.value = ""; b.focus(); }
      setDirty(true); updatePayPreview(); return;
    }
    if (el.dataset.path && (el.type === "checkbox" || el.type === "radio")) onEdit(el);
    if (el.dataset.status) {
      try { const bk = await api("/api/admin/bookings/" + encodeURIComponent(el.dataset.status), { method: "PATCH", body: JSON.stringify({ status: el.value }) });
        Object.assign(bookings.find(b => b.code === bk.code), bk); renderNav(); renderSection(); toast(`${bk.code}: ${STATUS[bk.status]}`); }
      catch (ex) { toast(ex.message); }
    }
    if (el.dataset.note) {
      try { const bk = await api("/api/admin/bookings/" + encodeURIComponent(el.dataset.note), { method: "PATCH", body: JSON.stringify({ adminNote: el.value }) });
        Object.assign(bookings.find(b => b.code === bk.code), bk); toast("Đã lưu ghi chú"); }
      catch (ex) { toast(ex.message); }
    }
  });
  document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && dirty) { e.preventDefault(); $("#btnSave").click(); } });

  /* ---------------- Khởi động ---------------- */
  (async () => {
    try {
      const st = await api("/api/admin/status");
      if (st.loggedIn) await enterApp(st.user); else showAuth(st.setupRequired);
    } catch (e) {
      $("#authView").hidden = false;
      $("#authFields").innerHTML = `<h1>Không kết nối được server</h1><p class="auth-help">Trang quản trị cần chạy server: mở thư mục dự án và chạy <code>npm start</code>, rồi vào <code>http://localhost:5173/admin.html</code>.</p>`;
      $("#authSubmit").hidden = true;
    }
  })();
})();
