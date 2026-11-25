/* =========================================================
   Ảnh bìa trang chủ (tập hồ sơ CASE FILE)
   Dùng chung cho trang khách và bản xem trước trong admin.
   ========================================================= */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TONES = ["warm", "rose", "sage", "sky", "dusk", "stone"];
  const tone = t => (TONES.includes(t) ? t : "warm");

  window.DEFAULT_HERO = {
    // Chữ phần đầu trang
    eyebrow: "Hồ sơ số 2017 · Văn phòng nhiếp ảnh Mori",
    title1: "Mọi khoảnh khắc", title2: "đều có manh mối",
    sub: "Giao “hồ sơ” cho chúng tôi: chọn gói chụp, thám tử ảnh, địa điểm và thời gian. Ánh sáng, góc máy, biểu cảm — để đội ngũ điều tra lo.",
    btnPrimary: "Mở hồ sơ đặt lịch", btnGhost: "Xem các hồ sơ gói",
    stats: [{ value: "2.400+", label: "hồ sơ đã khép" }, { value: "4.8/5", label: "đánh giá trung bình" }, { value: "4", label: "thám tử ảnh" }],
    // Ảnh bìa (tập hồ sơ CASE FILE)
    photo: "", photoTone: "dusk", caption: "Bằng chứng #001 — ảnh mẫu", tab: "CASE FILE · MG-001",
    stampTitle: "CASE FILE", stampSub: "MG · ĐÃ XÁC NHẬN", showStamp: true, showMagnifier: true, folderTone: "warm",
  };

  /* Tiêu đề các mục trên trang chủ. {coc} = % đặt cọc, {team} = tên team */
  window.DEFAULT_SECTIONS = {
    services: { eyebrow: "Hồ sơ 01 — Gói chụp", title: "Chọn hồ sơ phù hợp với bạn",
      sub: "Giá đã gồm ekip, thiết bị ánh sáng và chỉnh sửa cơ bản. Team đến tận nơi bạn chọn; dịch vụ đi kèm và phí đi tỉnh thêm khi đặt lịch." },
    team: { eyebrow: "Hồ sơ 02 — Thám tử ảnh", title: "Đội thám tử ảnh của Mori",
      sub: "Mỗi thám tử một “nghiệp vụ” riêng. Bấm vào để xem phong cách, chuyên môn và lịch làm việc." },
    extras: { eyebrow: "Hồ sơ 03 — Dịch vụ đi kèm", title: "Trang bị thêm cho “vụ án”",
      sub: "Bấm “Thêm vào hồ sơ” để đưa vào đơn đặt lịch, hoặc chọn lại ở bước 4." },
    travel: { eyebrow: "Hồ sơ 04 — Chụp ngoài tỉnh", title: "Thám tử đi “hiện trường”",
      sub: "Team không có studio cố định — chúng tôi đến tận nơi. Phí di chuyển tính theo khu vực, cộng vào đơn ở bước 3." },
    booking: { eyebrow: "Hồ sơ 05 — Đặt lịch", title: "Mở hồ sơ đặt lịch", sub: "Điền 1 form. Team gọi xác nhận trong vòng 2 giờ làm việc." },
    cta: { title: "Bạn có một khoảnh khắc cần điều tra?", sub: "Điền 1 form · Team gọi xác nhận trong 2 giờ làm việc · Đặt cọc {coc}%", btn: "Mở hồ sơ ngay →" },
    contact: { eyebrow: "Liên hệ", title: "Gọi cho đội thám tử",
      sub: "{team} là team nhiếp ảnh di động, không có studio cố định. Chúng tôi đến chụp tại địa điểm bạn chọn: nhà riêng, quán cà phê, công viên, văn phòng, trường học…" },
  };
  window.SECTION_LABELS = { services: "Gói chụp", team: "Thám tử ảnh", travel: "Chụp ngoài tỉnh", booking: "Đặt lịch", cta: "Dải kêu gọi cuối trang", contact: "Liên hệ" };

  /** Gộp dữ liệu đã lưu với mặc định (trường trống/thiếu → mặc định) */
  window.mergeSections = function (s) {
    const out = {};
    for (const [k, def] of Object.entries(window.DEFAULT_SECTIONS)) out[k] = Object.assign({}, def, (s || {})[k] || {});
    return out;
  };
  /** Thay {coc}, {team} trong chữ */
  window.fillText = (str, ctx) => String(str ?? "").replace(/\{coc\}/g, ctx.coc ?? "").replace(/\{team\}/g, ctx.team ?? "");

  /** HTML phần chữ đầu trang (tiêu đề, giới thiệu, nút, thống kê) — dùng cho trang khách & xem trước admin */
  window.renderHeroCopy = function (h, ctx = {}) {
    h = Object.assign({}, window.DEFAULT_HERO, h || {});
    const f = s => esc(window.fillText(s, ctx));
    return `${h.eyebrow ? `<p class="eyebrow hero-anim">${f(h.eyebrow)}</p>` : ""}
      <h1 class="hero-title hero-anim">${f(h.title1)}${h.title2 ? `<br /><em>${f(h.title2)}</em>` : ""}</h1>
      ${h.sub ? `<p class="hero-sub hero-anim">${f(h.sub)}</p>` : ""}
      <div class="hero-actions hero-anim">
        ${h.btnPrimary ? `<a class="btn btn-primary" href="#booking">${f(h.btnPrimary)}</a>` : ""}
        ${h.btnGhost ? `<a class="btn btn-ghost" href="#services">${f(h.btnGhost)}</a>` : ""}
      </div>
      ${(h.stats || []).length ? `<dl class="hero-stats hero-anim">${h.stats.map(s => `<div><dt>${f(s.value)}</dt><dd>${f(s.label)}</dd></div>`).join("")}</dl>` : ""}`;
  };

  /** HTML của tập hồ sơ. h = dữ liệu hero (thiếu trường nào lấy mặc định). */
  window.renderHeroVisual = function (h) {
    h = Object.assign({}, window.DEFAULT_HERO, h || {});
    const photo = h.photo
      ? `<div class="ph has-img"><img src="${esc(h.photo)}" alt="" /></div>`
      : `<div class="ph ph-${tone(h.photoTone)}"></div>`;
    return `<div class="folder" style="--folder: var(--tone-${tone(h.folderTone)})">
        ${h.tab ? `<span class="folder-tab">${esc(h.tab)}</span>` : ""}
        <figure class="polaroid">${photo}${h.caption ? `<figcaption>${esc(h.caption)}</figcaption>` : `<figcaption>&nbsp;</figcaption>`}</figure>
        ${h.showStamp ? `<div class="stamp"><strong>${esc(h.stampTitle)}</strong>${h.stampSub ? `<span>${esc(h.stampSub)}</span>` : ""}</div>` : ""}
        ${h.showMagnifier ? `<svg class="hero-mag" viewBox="0 0 32 32"><circle cx="13" cy="13" r="9" class="mag-glass"/><path d="M20 20l8 8" class="mag-handle-ink"/></svg>` : ""}
      </div>`;
  };
})();
