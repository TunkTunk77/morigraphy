/* =========================================================
   MoriGraphy — server (Node.js ≥ 18, không cần cài thư viện)
   - Phục vụ trang web tĩnh (index.html, admin.html, css/, js/, assets/) + ảnh tải lên /uploads/ (data/uploads/)
   - API công khai:  GET /api/data · POST /api/bookings
   - API admin:      /api/admin/*  (đăng nhập bằng cookie phiên)
   Dữ liệu lưu trong thư mục data/ (file JSON). Chạy: npm start
   ========================================================= */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.MG_DATA_DIR ? path.resolve(process.env.MG_DATA_DIR) : path.join(ROOT, "data");
const FILES = {
  site: path.join(DATA_DIR, "site.json"),
  bookings: path.join(DATA_DIR, "bookings.json"),
  admin: path.join(DATA_DIR, "admin.json"),
  payhook: path.join(DATA_DIR, "payhook.json"), // khóa bí mật webhook SePay (không công khai)
};
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";
const SESSION_HOURS = 8;
const PUBLIC_DIRS = ["css", "js", "assets"];
const PUBLIC_FILES = ["index.html", "admin.html", "favicon.ico", "robots.txt"];
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const BOOKING_STATUSES = ["new", "confirmed", "deposited", "done", "cancelled"];

/* ---------------- Lưu trữ JSON (ghi nguyên tử) ---------------- */
async function readJSON(file, fallback) { try { return JSON.parse(await fsp.readFile(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return fallback; throw e; } }
let writeChain = Promise.resolve();
function writeJSON(file, value) {
  writeChain = writeChain.then(async () => {
    const tmp = file + "." + process.pid + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await fsp.rename(tmp, file);
  });
  return writeChain;
}

/* Lần chạy đầu: lấy dữ liệu mẫu từ js/data.js */
function seedFromDataJs() {
  const code = fs.readFileSync(path.join(ROOT, "js", "data.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { timeout: 1000 });
  const w = sandbox.window;
  return { hero: w.HERO, sections: w.SECTIONS || {}, studio: w.STUDIO, categories: w.CATEGORIES, services: w.SERVICES, photographers: w.PHOTOGRAPHERS, addons: w.ADDONS,
    products: w.PRODUCTS || [], zones: w.TRAVEL_ZONES, shifts: w.SHIFTS, bookingWindowDays: w.BOOKING_WINDOW_DAYS };
}

/* ---------------- Kiểm tra dữ liệu admin gửi lên ---------------- */
const TONES = ["warm", "rose", "sage", "sky", "dusk", "stone"];
class Invalid extends Error {}
const clean = (v, max = 400) => { if (typeof v !== "string") throw new Invalid("Thiếu chữ"); const s = v.replace(/[<>]/g, "").trim(); if (s.length > max) throw new Invalid(`Quá dài (tối đa ${max} ký tự): "${s.slice(0, 30)}…"`); return s; };
const req = (v, label, max) => { const s = clean(v ?? "", max); if (!s) throw new Invalid(`Thiếu ${label}`); return s; };
const int = (v, label, min = 0, max = 1e10) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new Invalid(`${label} phải là số nguyên từ ${min.toLocaleString("vi-VN")} đến ${max.toLocaleString("vi-VN")}`); return n; };
const idOf = (v, label) => { const s = req(v, label, 40); if (!/^[a-z0-9-]+$/.test(s)) throw new Invalid(`Mã ${label} chỉ gồm chữ thường, số, dấu gạch: "${s}"`); return s; };
const tone = v => (TONES.includes(v) ? v : "stone");
const strList = (v, label, maxItems = 20) => { if (!Array.isArray(v)) throw new Invalid(`${label} phải là danh sách`); return v.slice(0, maxItems).map(x => clean(String(x), 120)).filter(Boolean); };
function uniqueIds(list, label) { const seen = new Set(); for (const x of list) { if (seen.has(x.id)) throw new Invalid(`Trùng mã ${label}: ${x.id}`); seen.add(x.id); } }
function arr(v, label, max = 100) { if (!Array.isArray(v)) throw new Invalid(`${label} phải là danh sách`); if (v.length > max) throw new Invalid(`${label} tối đa ${max} mục`); return v; }

/* ---------------- Ảnh tải lên (portfolio, ảnh đại diện) ---------------- */
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const MAX_UPLOAD = 6 * 1024 * 1024, MAX_PORTFOLIO = 30;
const IMG_TYPES = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };
const UPLOAD_RE = /^\/uploads\/[a-f0-9]{24}\.(webp|jpg|png)$/;
const uploadSrc = v => { if (typeof v !== "string" || !UPLOAD_RE.test(v)) throw new Invalid("Đường dẫn ảnh không hợp lệ"); return v; };
// Nhận dạng ảnh theo byte đầu file (không tin Content-Type)
function sniffImage(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}
class TooLarge extends Invalid {}
// Đọc hết body (bỏ phần thừa) để trả được lỗi 413 rõ ràng thay vì cắt kết nối
function readRaw(req, limit, msg = `Ảnh quá lớn (tối đa ${Math.round(limit / 1048576)} MB)`) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"]) > limit) { req.resume(); req.on("end", () => reject(new TooLarge(msg))); return; }
    let size = 0, over = false; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) over = true; else if (!over) chunks.push(c); });
    req.on("end", () => (over ? reject(new TooLarge(msg)) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}
// Xóa ảnh không còn dùng (bỏ qua ảnh mới tải < 30 phút, có thể đang nằm trong bản nháp chưa lưu)
async function cleanUploads(site) {
  const used = new Set(); for (const p of site.photographers) { if (p.avatar) used.add(path.basename(p.avatar)); for (const it of p.portfolio || []) used.add(path.basename(it.src)); }
  if (site.hero && site.hero.photo) used.add(path.basename(site.hero.photo)); // ảnh bìa trang chủ
  let names = []; try { names = await fsp.readdir(UPLOAD_DIR); } catch { return 0; }
  let removed = 0;
  for (const n of names) {
    if (used.has(n) || !/^[a-f0-9]{24}\.(webp|jpg|png)$/.test(n)) continue;
    const st = await fsp.stat(path.join(UPLOAD_DIR, n)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 30 * 60000) { await fsp.unlink(path.join(UPLOAD_DIR, n)).catch(() => {}); removed++; }
  }
  return removed;
}

/* Tài khoản nhận cọc (VietQR). Chỉ bật khi đủ thông tin. */
function validatePayment(p, label = "Thanh toán cọc") {
  p = p || {};
  const out = { enabled: !!p.enabled, bankBin: clean(String(p.bankBin || ""), 6), accountNo: clean(String(p.accountNo || ""), 19).replace(/\s/g, ""),
    accountName: clean(String(p.accountName || ""), 60).toUpperCase(), bankLabel: clean(String(p.bankLabel || ""), 40) };
  if (out.enabled) {
    if (!/^\d{6}$/.test(out.bankBin)) throw new Invalid(`${label}: chọn ngân hàng (mã BIN 6 số)`);
    if (!/^[0-9A-Za-z]{4,19}$/.test(out.accountNo)) throw new Invalid(`${label}: số tài khoản không hợp lệ`);
    if (!out.accountName) throw new Invalid(`${label}: thiếu tên chủ tài khoản`);
  }
  return out;
}
// Tài khoản nhận cọc cho một đơn: ưu tiên tài khoản riêng của thám tử, không có thì dùng tài khoản team
function payToFor(site, ph) {
  const pick = (p, owner, ownerName) => p && p.enabled ? { owner, ownerName, bankBin: p.bankBin, bankLabel: p.bankLabel, accountNo: p.accountNo, accountName: p.accountName } : null;
  return pick(ph && ph.payment, "photographer", ph && ph.name) || pick(site.studio.payment, "team", site.studio.name);
}
// SĐT riêng của thám tử (không bắt buộc): 0xxxxxxxxx hoặc +84xxxxxxxxx
function phoneOf(v, who) {
  const s = clean(String(v || ""), 20).replace(/[\s.-]/g, "").replace(/^\+84/, "0");
  if (s && !/^0\d{9}$/.test(s)) throw new Invalid(`Số điện thoại của ${who || "thám tử"} không hợp lệ (10 số, bắt đầu bằng 0)`);
  return s;
}
// Dữ liệu công khai: ẩn số tài khoản và SĐT riêng của thám tử (chỉ gửi cho khách có đơn: TK khi đặt, SĐT khi đã cọc)
function publicSite(site) {
  return { ...site, photographers: site.photographers.map(({ payment, phone, ...p }) => ({ ...p, hasOwnPayment: !!(payment && payment.enabled) })) };
}
// Nội dung chuyển khoản theo mã hồ sơ (không dấu, không ký tự đặc biệt)
const transferNote = code => code.replace(/-/g, "") + " COC";

/* Ảnh bìa trang chủ (tập hồ sơ CASE FILE) — admin tự chỉnh */
const HERO_DEFAULT = { photo: "", photoTone: "dusk", caption: "Bằng chứng #001 — ảnh mẫu", tab: "CASE FILE · MG-001",
  stampTitle: "CASE FILE", stampSub: "MG · ĐÃ XÁC NHẬN", showStamp: true, showMagnifier: true, folderTone: "warm" };
// Chữ phần đầu trang: chỉ lưu trường admin đã gửi (thiếu → trang dùng mặc định trong js/hero.js; chuỗi rỗng → ẩn dòng đó)
const HERO_TEXT_LIMITS = { eyebrow: 80, title1: 40, title2: 40, sub: 300, btnPrimary: 30, btnGhost: 30 };
function validateHero(h) {
  const src = h || {};
  h = { ...HERO_DEFAULT, ...src };
  const out = { photo: h.photo ? uploadSrc(h.photo) : "", photoTone: tone(h.photoTone), caption: clean(String(h.caption), 60), tab: clean(String(h.tab), 40),
    stampTitle: clean(String(h.stampTitle), 16), stampSub: clean(String(h.stampSub), 30), showStamp: h.showStamp !== false, showMagnifier: h.showMagnifier !== false,
    folderTone: tone(h.folderTone) };
  for (const [k, max] of Object.entries(HERO_TEXT_LIMITS)) if (typeof src[k] === "string") out[k] = clean(src[k], max);
  if (Array.isArray(src.stats)) out.stats = arr(src.stats, "Con số thống kê", 4).map(s => ({ value: clean(String((s && s.value) || ""), 12), label: clean(String((s && s.label) || ""), 30) })).filter(s => s.value || s.label);
  return out;
}
// Tiêu đề các mục trang chủ (chỉ nhận đúng các mục/trường đã biết)
const SECTION_FIELDS = { services: ["eyebrow", "title", "sub"], team: ["eyebrow", "title", "sub"], extras: ["eyebrow", "title", "sub"], travel: ["eyebrow", "title", "sub"],
  booking: ["eyebrow", "title", "sub"], cta: ["title", "sub", "btn"], contact: ["eyebrow", "title", "sub"] };
function validateSections(s) {
  const out = {};
  for (const [k, fields] of Object.entries(SECTION_FIELDS)) {
    const v = (s || {})[k]; if (!v || typeof v !== "object") continue;
    out[k] = {}; for (const f of fields) if (typeof v[f] === "string") out[k][f] = clean(v[f], f === "sub" ? 300 : f === "btn" ? 30 : 90);
  }
  return out;
}

function validateSite(d) {
  if (!d || typeof d !== "object") throw new Invalid("Dữ liệu không hợp lệ");
  const s = d.studio || {};
  const url = (v, label) => { const u = clean(v || "", 300); if (u && !/^https:\/\/[^\s"']+$/.test(u)) throw new Invalid(`${label} phải là link bắt đầu bằng https://`); return u; };
  const studio = { name: req(s.name, "tên team", 60), tagline: clean(s.tagline || "", 120), phone: req(s.phone, "số điện thoại", 30), email: clean(s.email || "", 120),
    area: clean(s.area || "", 200), openHours: clean(s.openHours || "", 120), facebook: url(s.facebook, "Facebook"), instagram: url(s.instagram, "Instagram"),
    depositPercent: int(s.depositPercent, "% đặt cọc", 0, 100), payment: validatePayment(s.payment) };
  const services = arr(d.services, "Gói chụp").map(x => ({ id: idOf(x.id, "gói"), name: req(x.name, "tên gói", 80), category: req(x.category, "danh mục", 40),
    duration: int(x.duration, "Thời lượng (phút)", 15, 720), price: int(x.price, "Giá gói"), tone: tone(x.tone), desc: clean(x.desc || "", 300), includes: strList(x.includes || [], "Bao gồm", 8) }));
  uniqueIds(services, "gói"); if (!services.length) throw new Invalid("Cần ít nhất 1 gói chụp");
  const svcIds = new Set(services.map(x => x.id));
  const photographers = arr(d.photographers, "Thám tử").map(x => ({ id: idOf(x.id, "thám tử"), name: req(x.name, "tên thám tử", 60), role: clean(x.role || "", 60),
    years: int(x.years || 0, "Số năm", 0, 60), rating: Math.min(5, Math.max(0, Number(x.rating) || 0)), reviews: int(x.reviews || 0, "Số đánh giá", 0, 1e6),
    phone: phoneOf(x.phone, x.name), surcharge: int(x.surcharge || 0, "Phụ phí"), tone: tone(x.tone), specialties: strList(x.specialties || [], "Chuyên môn", 8), style: clean(x.style || "", 300), bio: clean(x.bio || "", 600),
    workDays: arr(x.workDays || [], "Ngày làm", 7).map(n => int(n, "Ngày làm", 0, 6)), services: arr(x.services || [], "Gói nhận chụp", 50).map(String).filter(id => svcIds.has(id)),
    avatar: x.avatar ? uploadSrc(x.avatar) : "",
    portfolio: arr(x.portfolio || [], "Portfolio", MAX_PORTFOLIO).map(it => ({ id: /^[a-z0-9]{4,16}$/.test(it.id) ? it.id : crypto.randomBytes(4).toString("hex"),
      src: uploadSrc(it.src), title: clean(it.title || "", 80), serviceId: svcIds.has(it.serviceId) ? it.serviceId : "" })),
    payment: validatePayment(x.payment, `Tài khoản của ${String(x.name || x.id)}`) }));
  uniqueIds(photographers, "thám tử");
  const item = (x, kind) => ({ id: idOf(x.id, kind), name: req(x.name, "tên " + kind, 80), price: int(x.price, "Giá " + kind), unit: req(x.unit || "cái", "đơn vị", 20),
    tone: tone(x.tone), desc: clean(x.desc || "", 200), max: x.max ? int(x.max, "Tối đa", 1, 100) : undefined });
  const addons = arr(d.addons, "Dịch vụ").map(x => ({ ...item(x, "dịch vụ"), extraMinutes: x.extraMinutes ? int(x.extraMinutes, "Thêm phút", 0, 480) : undefined }));
  /* Mục Sản phẩm đã bỏ khỏi web/admin; vẫn đọc được dữ liệu cũ */
  const products = arr(d.products || [], "Sản phẩm").map(x => ({ ...item(x, "sản phẩm"), type: req(x.type || "Khác", "loại", 30) }));
  uniqueIds(addons, "dịch vụ"); uniqueIds(products, "sản phẩm");
  const zones = arr(d.zones, "Vùng", 20).map(x => ({ id: idOf(x.id, "vùng"), name: req(x.name, "tên vùng", 80), short: req(x.short, "tên ngắn", 30), fee: int(x.fee || 0, "Phí vùng"),
    perNight: int(x.perNight || 0, "Phí lưu trú"), leadDays: int(x.leadDays || 0, "Số ngày đặt trước", 0, 90), quote: !!x.quote, fullDay: !!x.fullDay,
    examples: clean(x.examples || "", 160), note: clean(x.note || "", 200) }));
  uniqueIds(zones, "vùng"); if (!zones.length) throw new Invalid("Cần ít nhất 1 khu vực chụp");
  const shifts = validateShifts(d.shifts);
  const categories = ["Tất cả", ...[...new Set(services.map(x => x.category))]];
  return { studio, categories, services, photographers, addons, products, zones, shifts, bookingWindowDays: int(d.bookingWindowDays, "Số ngày mở lịch", 1, 365),
    hero: validateHero(d.hero), sections: validateSections(d.sections) };
}

/* ---------------- Buổi chụp: sáng / chiều / cả ngày ----------------
   site.shifts = { morning: {start, end}, afternoon: {start, end} } — "Cả ngày" = sáng.start → chiều.end */
const DEFAULT_SHIFTS = { morning: { start: "08:00", end: "12:00" }, afternoon: { start: "13:00", end: "17:00" } };
const SHIFT_IDS = ["morning", "afternoon", "full"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
function validateShifts(s) {
  s = s && typeof s === "object" ? s : DEFAULT_SHIFTS;
  const one = (x, def, label) => {
    x = x && typeof x === "object" ? x : def;
    const start = String(x.start || def.start), end = String(x.end || def.end);
    if (!HHMM.test(start) || !HHMM.test(end)) throw new Invalid(`Giờ ${label} không hợp lệ`);
    if (toMin(end) <= toMin(start)) throw new Invalid(`Giờ kết thúc ${label} phải sau giờ bắt đầu`);
    return { start, end };
  };
  const morning = one(s.morning, DEFAULT_SHIFTS.morning, "buổi sáng"), afternoon = one(s.afternoon, DEFAULT_SHIFTS.afternoon, "buổi chiều");
  if (toMin(afternoon.start) < toMin(morning.end)) throw new Invalid("Buổi chiều phải bắt đầu sau khi buổi sáng kết thúc");
  return { morning, afternoon };
}
// Quy đổi khung giờ cũ (["07:00","08:00",…]) sang buổi: sáng = giờ đầu → hết giờ cuối trước trưa; chiều = giờ đầu sau trưa → hết giờ cuối
function shiftsFromSlots(slots) {
  const toT = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const ms = (Array.isArray(slots) ? slots : []).filter(t => HHMM.test(t)).map(toMin).sort((a, b) => a - b);
  const am = ms.filter(m => m < 720), pm = ms.filter(m => m >= 720);
  if (!am.length || !pm.length) return DEFAULT_SHIFTS;
  const out = { morning: { start: toT(am[0]), end: toT(Math.min(am[am.length - 1] + 60, pm[0])) }, afternoon: { start: toT(pm[0]), end: toT(Math.min(pm[pm.length - 1] + 60, 1439)) } };
  try { return validateShifts(out); } catch { return DEFAULT_SHIFTS; }
}
// Khoảng giờ của một buổi (phút trong ngày)
function shiftRange(shifts, id) {
  const s = shifts || DEFAULT_SHIFTS;
  if (id === "full") return [toMin(s.morning.start), toMin(s.afternoon.end)];
  return [toMin(s[id].start), toMin(s[id].end)];
}
// Đơn chiếm những nửa buổi nào. Đơn cũ (giờ "09:00") được quy đổi theo giờ bắt đầu + thời lượng.
function halvesOf(b, shifts) {
  if (b.time === "full") return ["morning", "afternoon"];
  if (b.time === "morning" || b.time === "afternoon") return [b.time];
  if (!HHMM.test(b.time || "")) return ["morning", "afternoon"];
  const noon = toMin((shifts || DEFAULT_SHIFTS).morning.end), start = toMin(b.time), end = start + (b.minutes || 60), out = [];
  if (start < noon) out.push("morning");
  if (end > noon || start >= noon) out.push("afternoon");
  return out;
}

/* ---------------- Tính giá phía server (không tin giá từ trình duyệt) ---------------- */
const pad = n => String(n).padStart(2, "0");
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayDiff = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
function priceBooking(site, b) {
  const s = site.services.find(x => x.id === b.serviceId); if (!s) throw new Invalid("Gói chụp không tồn tại");
  const z = site.zones.find(x => x.id === b.zoneId); if (!z) throw new Invalid("Địa điểm không hợp lệ");
  let p = null;
  if (b.photographerId !== "any") { p = site.photographers.find(x => x.id === b.photographerId); if (!p || !p.services.includes(s.id)) throw new Invalid("Thám tử không nhận gói này"); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) throw new Invalid("Ngày không hợp lệ");
  const ahead = dayDiff(b.date, todayKey());
  if (ahead < (z.leadDays || 0) || ahead > site.bookingWindowDays) throw new Invalid("Ngày chụp nằm ngoài thời gian nhận lịch");
  if (!SHIFT_IDS.includes(b.time)) throw new Invalid("Buổi chụp không hợp lệ");
  if (z.fullDay && b.time !== "full") throw new Invalid("Chụp đi tỉnh chỉ nhận lịch cả ngày");
  if (p && !p.workDays.includes(new Date(b.date + "T00:00:00").getDay())) throw new Invalid("Thám tử nghỉ ngày này");
  const lines = []; let total = s.price; lines.push(["Giá gói", s.price]);
  if (p && p.surcharge) { total += p.surcharge; lines.push(["Phụ phí chọn thám tử", p.surcharge]); }
  if (z.fee) { total += z.fee; lines.push(["Phí đi tỉnh · " + z.short, z.fee]); }
  const nights = z.perNight && !z.quote ? int(b.nights || 0, "Số đêm", 0, 10) : 0;
  if (nights) { total += z.perNight * nights; lines.push([`Lưu trú × ${nights} đêm`, z.perNight * nights]); }
  let minutes = s.duration;
  const pick = (bag, list, label) => { const out = {}; for (const [id, q] of Object.entries(bag || {})) { const it = list.find(x => x.id === id); if (!it) throw new Invalid(`${label} không tồn tại`); const n = int(q, "Số lượng", 0, it.max || 10); if (n) { out[id] = n; total += it.price * n; lines.push([`${it.name} × ${n}`, it.price * n]); if (it.extraMinutes) minutes += it.extraMinutes * n; } } return out; };
  const addons = pick(b.addons, site.addons, "Dịch vụ"), products = pick(b.products, site.products, "Sản phẩm");
  if (b.time !== "full") { const [st, en] = shiftRange(site.shifts, b.time); if (minutes > en - st) throw new Invalid(`Buổi chụp cần ${Math.ceil(minutes / 60)} tiếng, dài hơn nửa buổi. Chọn “Cả ngày”.`); }
  const deposit = Math.round(total * site.studio.depositPercent / 100 / 1000) * 1000;
  return { service: s, zone: z, photographer: p, nights, addons, products, lines, total, deposit, minutes, needsQuote: !!z.quote };
}

/* ---------------- Lịch bận theo đơn thật ----------------
   Đơn chưa hủy khóa buổi (sáng/chiều) của thám tử được giao; "Cả ngày" khóa cả hai.
   Đơn đi tỉnh (zone.fullDay) khóa trọn ngày + số đêm lưu trú. */
const addDaysKey = (k, n) => { const d = new Date(k + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function busyMap(bookings, shifts, fromKey = todayKey()) {
  const map = {};
  const mark = (date, pid, t) => {
    if (date < fromKey) return;
    const day = (map[date] ||= {});
    if (t === "day") day[pid] = "day";
    else if (day[pid] !== "day") (day[pid] ||= new Set()).add(t);
  };
  for (const b of bookings) {
    if (b.status === "cancelled" || !b.photographerId || b.photographerId === "any") continue;
    if (b.fullDay) for (let i = 0; i <= (b.nights || 0); i++) mark(addDaysKey(b.date, i), b.photographerId, "day");
    else for (const h of halvesOf(b, shifts)) mark(b.date, b.photographerId, h);
  }
  return map;
}
function isFree(map, pid, date, shift, fullDay, nights) {
  if (fullDay) { for (let i = 0; i <= nights; i++) if (map[addDaysKey(date, i)]?.[pid]) return false; return true; }
  const e = map[date]?.[pid]; if (e === "day") return false;
  const need = shift === "full" ? ["morning", "afternoon"] : [shift];
  return !need.some(h => e && e.has(h));
}
const serializeBusy = map => Object.fromEntries(Object.entries(map).map(([d, ps]) => [d, Object.fromEntries(Object.entries(ps).map(([p, v]) => [p, v === "day" ? "day" : [...v].sort()]))]));
// Khóa tuần tự: kiểm tra trùng + ghi đơn không bị chen ngang
let bookingLock = Promise.resolve();
function withBookingLock(fn) { const run = bookingLock.then(fn, fn); bookingLock = run.catch(() => {}); return run; }

/* ---------------- Mật khẩu & phiên ---------------- */
const hashPassword = (pw, salt = crypto.randomBytes(16).toString("hex")) => ({ salt, hash: crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex") });
function verifyPassword(pw, rec) { const h = crypto.scryptSync(pw, rec.salt, 64, { N: 16384, r: 8, p: 1 }); const ref = Buffer.from(rec.hash, "hex"); return ref.length === h.length && crypto.timingSafeEqual(ref, h); }
const sessions = new Map(); // token -> { user, expires }
const loginFails = new Map(); // ip -> { count, until }
let setupToken = null;

function getSession(req) {
  const m = /(?:^|;\s*)mg_admin=([a-f0-9]{64})/.exec(req.headers.cookie || ""); if (!m) return null;
  const s = sessions.get(m[1]); if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(m[1]); return null; }
  return { token: m[1], ...s };
}
function sessionCookie(req, token, maxAge) {
  const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `mg_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
// TRUST_PROXY=1 khi chạy sau reverse proxy (Caddy/Nginx): lấy IP khách ở cuối X-Forwarded-For
// (mục do chính proxy thêm vào, khách không giả được). Chỉ bật khi cổng server KHÔNG mở thẳng ra mạng.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const clientIp = req => {
  if (TRUST_PROXY) { const xff = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean); if (xff.length) return xff[xff.length - 1]; }
  return req.socket.remoteAddress || "?";
};
function tooManyFails(ip) { const f = loginFails.get(ip); return f && f.count >= 5 && f.until > Date.now(); }
function noteFail(ip) { const f = loginFails.get(ip); const now = Date.now(); if (!f || f.until < now) loginFails.set(ip, { count: 1, until: now + 15 * 60000 }); else f.count++; }

/* ---------------- HTTP helpers ---------------- */
const SEC_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" };
function send(res, status, body, headers = {}) {
  const isObj = typeof body === "object" && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SEC_HEADERS, "Content-Type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/.test(req.headers["content-type"] || "")) { req.resume(); return reject(new Invalid("Cần Content-Type: application/json")); }
    readRaw(req, limit, "Dữ liệu quá lớn").then(buf => { try { resolve(JSON.parse(buf.toString("utf8") || "{}")); } catch { reject(new Invalid("JSON không hợp lệ")); } }, reject);
  });
}
// Chống CSRF: request ghi dữ liệu phải đến từ cùng origin
function sameOrigin(req) { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch { return false; } }

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (rel === "" ) rel = "index.html";
  if (rel === "admin") rel = "admin.html";
  const top = rel.split("/")[0];
  // Ảnh tải lên: /uploads/<tên-ngẫu-nhiên>.<đuôi> → data/uploads/
  if (top === "uploads") {
    const m = /^uploads\/([a-f0-9]{24}\.(webp|jpg|png))$/.exec(rel); if (!m) return send(res, 404, "Not found");
    try { const data = await fsp.readFile(path.join(UPLOAD_DIR, m[1]));
      res.writeHead(200, { ...SEC_HEADERS, "Content-Type": MIME["." + m[2]], "Cache-Control": "public, max-age=31536000, immutable" }); return res.end(data);
    } catch { return send(res, 404, "Not found"); }
  }
  if (!(PUBLIC_FILES.includes(rel) || PUBLIC_DIRS.includes(top))) return send(res, 404, "Not found");
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden");
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { ...SEC_HEADERS, "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": rel.startsWith("assets/") ? "public, max-age=86400" : "no-cache" });
    res.end(data);
  } catch { send(res, 404, "Not found"); }
}

/* ---------------- Định tuyến API ---------------- */
async function api(req, res, url) {
  const p = url.pathname, method = req.method;
  if (method !== "GET" && !sameOrigin(req)) return send(res, 403, { error: "Sai nguồn gửi" });

  if (p === "/api/data" && method === "GET") return send(res, 200, publicSite(await readJSON(FILES.site)));
  // Chỉ trả về giờ bận theo thám tử — không lộ thông tin khách
  if (p === "/api/availability" && method === "GET") return send(res, 200, serializeBusy(busyMap(await readJSON(FILES.bookings, []), (await readJSON(FILES.site)).shifts)));

  if (p === "/api/bookings" && method === "POST") {
    const b = await readBody(req, 50_000);
    return withBookingLock(() => createBooking(b, res));
  }
  // Khách xem trạng thái đơn của mình (cần mã đơn + mã bí mật trả về lúc đặt)
  if (p === "/api/bookings/status" && method === "GET") {
    const code = String(url.searchParams.get("code") || ""), t = String(url.searchParams.get("t") || "");
    const bk = (await readJSON(FILES.bookings, [])).find(x => x.code === code);
    if (!bk || !bk.viewToken || !safeEqual(t, bk.viewToken)) return send(res, 404, { error: "Không tìm thấy hồ sơ" });
    const paidUp = bk.status === "deposited" || bk.status === "done";
    let contact = null; // SĐT thám tử chỉ gửi khi khách đã cọc
    if (paidUp) { const ph = ((await readJSON(FILES.site)).photographers || []).find(x => x.id === bk.photographerId); if (ph && ph.phone) contact = { name: ph.name, phone: ph.phone }; }
    return send(res, 200, { code: bk.code, status: bk.status, paid: paidOf(bk), deposit: bk.deposit, depositedAt: bk.depositedAt || null, contact });
  }
  // Webhook SePay: ngân hàng báo có tiền vào → tự chuyển đơn sang "Đã cọc"
  if (p === "/api/webhooks/sepay" && method === "POST") return sepayWebhook(req, res);
  return adminApi(req, res, p, method);
}

/* ---------------- Tự xác nhận cọc (SePay) ----------------
   SePay theo dõi tài khoản ngân hàng và gọi POST /api/webhooks/sepay mỗi khi có giao dịch,
   kèm header "Authorization: Apikey <khóa>". Nội dung CK chứa mã hồ sơ (VD "MG261201GUYT COC"). */
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const paidOf = bk => (bk.payments || []).reduce((s, x) => s + (x.amount || 0), 0);
const CODE_RE = /MG(\d{6})([A-HJKMNP-Z2-9]{4})/;
async function sepayWebhook(req, res) {
  const hook = await readJSON(FILES.payhook, null);
  const auth = String(req.headers.authorization || "").replace(/^Apikey\s+/i, "").trim();
  if (!hook || !hook.apiKey || !safeEqual(auth, hook.apiKey)) return send(res, 401, { success: false, error: "Sai khóa API" });
  const t = await readBody(req, 20_000);
  if (t.transferType !== "in") return send(res, 200, { success: true, note: "bỏ qua giao dịch tiền ra" });
  const amount = Math.round(Number(t.transferAmount) || 0);
  const m = CODE_RE.exec(String(t.content || t.description || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
  if (!m || amount <= 0) { console.log(`• SePay: giao dịch ${t.id} (${amount}đ) không khớp mã hồ sơ nào`); return send(res, 200, { success: true, matched: false }); }
  const code = `MG-${m[1]}-${m[2]}`;
  return withBookingLock(async () => {
    const all = await readJSON(FILES.bookings, []); const bk = all.find(x => x.code === code);
    if (!bk) { console.log(`• SePay: không có hồ sơ ${code}`); return send(res, 200, { success: true, matched: false }); }
    bk.payments ||= [];
    const txId = String(t.id ?? t.referenceCode ?? "");
    if (txId && bk.payments.some(x => x.txId === txId)) return send(res, 200, { success: true, duplicate: true });
    bk.payments.push({ txId, amount, at: new Date().toISOString(), bank: clean(String(t.gateway || ""), 40), account: clean(String(t.accountNumber || ""), 30), via: "sepay" });
    if (paidOf(bk) >= (bk.deposit || 0) && (bk.status === "new" || bk.status === "confirmed")) { bk.status = "deposited"; bk.depositedAt = new Date().toISOString(); }
    bk.updatedAt = new Date().toISOString(); await writeJSON(FILES.bookings, all);
    console.log(`• SePay: ${code} nhận ${amount}đ → ${bk.status}`);
    return send(res, 200, { success: true, matched: true, status: bk.status });
  });
}

async function createBooking(b, res) {
    const site = await readJSON(FILES.site);
    const q = priceBooking(site, b);
    const c = b.customer || {};
    const customer = { name: req2(c.name, "họ tên", 80), phone: clean(String(c.phone || ""), 20).replace(/[\s.-]/g, ""), email: clean(c.email || "", 120), note: clean(c.note || "", 1000) };
    if (!/^(0|\+84)\d{9}$/.test(customer.phone)) throw new Invalid("Số điện thoại không hợp lệ");
    if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new Invalid("Email không hợp lệ");
    if (c.agree !== true) throw new Invalid("Chưa đồng ý điều khoản đặt cọc");
    const address = req2(b.address, "địa chỉ chụp", 200);
    // Kiểm tra trùng lịch với đơn thật & giao thám tử khi khách để team sắp xếp
    const all = await readJSON(FILES.bookings, []);
    const map = busyMap(all, site.shifts), fullDay = !!q.zone.fullDay, dow = new Date(b.date + "T00:00:00").getDay();
    let ph = q.photographer;
    if (ph) {
      if (!isFree(map, ph.id, b.date, b.time, fullDay, q.nights)) return send(res, 409, { error: `${ph.name} vừa có lịch vào buổi này. Chọn buổi khác hoặc để team sắp xếp.`, conflict: true });
    } else {
      ph = site.photographers.find(p => p.services.includes(q.service.id) && p.workDays.includes(dow) && isFree(map, p.id, b.date, b.time, fullDay, q.nights));
      if (!ph) return send(res, 409, { error: "Buổi này vừa kín lịch. Vui lòng chọn buổi khác.", conflict: true });
    }
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let r = ""; for (let i = 0; i < 4; i++) r += chars[crypto.randomInt(chars.length)];
    const code = `MG-${b.date.slice(2, 4)}${b.date.slice(5, 7)}${b.date.slice(8, 10)}-${r}`;
    const booking = { code, status: "new", createdAt: new Date().toISOString(), serviceId: q.service.id, serviceName: q.service.name,
      requestedPhotographer: q.photographer ? q.photographer.id : "any", photographerId: ph.id, photographerName: ph.name + (q.photographer ? "" : " (team xếp)"),
      zoneId: q.zone.id, zoneName: q.zone.name, fullDay, address, nights: q.nights, date: b.date, time: b.time, minutes: q.minutes,
      addons: q.addons, products: q.products, lines: q.lines, total: q.total, deposit: q.deposit, needsQuote: q.needsQuote, customer, adminNote: "",
      transferNote: transferNote(code), payTo: payToFor(site, ph), viewToken: crypto.randomBytes(16).toString("hex"), payments: [] };
    all.push(booking); await writeJSON(FILES.bookings, all);
    return send(res, 201, { code, total: q.total, deposit: q.deposit, photographerId: ph.id, photographerName: ph.name, transferNote: booking.transferNote, payTo: booking.payTo, viewToken: booking.viewToken });
}

async function adminApi(req, res, p, method) {
  /* ---- Admin ---- */
  if (p === "/api/admin/status" && method === "GET") {
    const admin = await readJSON(FILES.admin, null); const s = getSession(req);
    return send(res, 200, { setupRequired: !admin, loggedIn: !!s, user: s ? s.user : null });
  }
  if (p === "/api/admin/setup" && method === "POST") {
    if (await readJSON(FILES.admin, null)) return send(res, 409, { error: "Đã có tài khoản admin" });
    const ip = clientIp(req); if (tooManyFails(ip)) return send(res, 429, { error: "Thử lại sau 15 phút" });
    const b = await readBody(req, 5000);
    if (!setupToken || typeof b.token !== "string" || b.token.trim().toUpperCase() !== setupToken) { noteFail(ip); return send(res, 403, { error: "Mã thiết lập không đúng (xem cửa sổ chạy server)" }); }
    const user = req2(b.username, "tên đăng nhập", 40);
    if (typeof b.password !== "string" || b.password.length < 10) throw new Invalid("Mật khẩu tối thiểu 10 ký tự");
    await writeJSON(FILES.admin, { user, ...hashPassword(b.password), createdAt: new Date().toISOString() });
    setupToken = null;
    return login(req, res, user);
  }
  if (p === "/api/admin/login" && method === "POST") {
    const ip = clientIp(req); if (tooManyFails(ip)) return send(res, 429, { error: "Sai quá 5 lần. Thử lại sau 15 phút." });
    const b = await readBody(req, 5000); const admin = await readJSON(FILES.admin, null);
    const ok = admin && typeof b.username === "string" && typeof b.password === "string" && b.username.trim() === admin.user && verifyPassword(b.password, admin);
    if (!ok) { noteFail(ip); return send(res, 401, { error: "Sai tên đăng nhập hoặc mật khẩu" }); }
    loginFails.delete(ip);
    return login(req, res, admin.user);
  }
  if (p === "/api/admin/logout" && method === "POST") {
    const s = getSession(req); if (s) sessions.delete(s.token);
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  const s = getSession(req);
  if (p.startsWith("/api/admin/") && !s) return send(res, 401, { error: "Chưa đăng nhập" });

  if (p === "/api/admin/data" && method === "GET") return send(res, 200, await readJSON(FILES.site));
  if (p === "/api/admin/data" && method === "PUT") {
    const site = validateSite(await readBody(req, 2_000_000));
    await writeJSON(FILES.site, site);
    cleanUploads(site).catch(e => console.error("Dọn ảnh lỗi:", e.message));
    return send(res, 200, { ok: true, data: site });
  }
  if (p === "/api/admin/upload" && method === "POST") {
    const ext = IMG_TYPES[(req.headers["content-type"] || "").split(";")[0].trim()];
    if (!ext) throw new Invalid("Chỉ nhận ảnh JPG, PNG hoặc WebP");
    const buf = await readRaw(req, MAX_UPLOAD);
    if (sniffImage(buf) !== ext) throw new Invalid("File không phải ảnh hợp lệ");
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    const name = crypto.randomBytes(12).toString("hex") + "." + ext;
    await fsp.writeFile(path.join(UPLOAD_DIR, name), buf);
    return send(res, 201, { src: "/uploads/" + name });
  }
  if (p === "/api/admin/bookings" && method === "GET") return send(res, 200, (await readJSON(FILES.bookings, [])).slice().reverse());
  const bm = /^\/api\/admin\/bookings\/(MG-[A-Z0-9-]{4,20})$/.exec(p);
  if (bm && method === "PATCH") {
    const b = await readBody(req, 5000);
    return withBookingLock(async () => {
      const all = await readJSON(FILES.bookings, []);
      const bk = all.find(x => x.code === bm[1]); if (!bk) return send(res, 404, { error: "Không tìm thấy đơn" });
      if (b.status !== undefined) { if (!BOOKING_STATUSES.includes(b.status)) throw new Invalid("Trạng thái không hợp lệ"); bk.status = b.status; if (b.status === "deposited" && !bk.depositedAt) bk.depositedAt = new Date().toISOString(); }
      if (b.adminNote !== undefined) bk.adminNote = clean(String(b.adminNote), 1000);
      bk.updatedAt = new Date().toISOString(); await writeJSON(FILES.bookings, all);
      return send(res, 200, bk);
    });
  }
  // Cấu hình tự xác nhận cọc (SePay): xem / tạo khóa mới / tắt
  if (p === "/api/admin/payhook" && method === "GET") { const h = await readJSON(FILES.payhook, null); return send(res, 200, { apiKey: h?.apiKey || "", path: "/api/webhooks/sepay" }); }
  if (p === "/api/admin/payhook" && method === "POST") {
    const b = await readBody(req, 1000);
    if (b.action === "rotate") { const apiKey = crypto.randomBytes(24).toString("hex"); await writeJSON(FILES.payhook, { apiKey, createdAt: new Date().toISOString() }); return send(res, 200, { apiKey }); }
    if (b.action === "disable") { await writeJSON(FILES.payhook, { apiKey: "" }); return send(res, 200, { apiKey: "" }); }
    throw new Invalid("Thao tác không hợp lệ");
  }
  if (p === "/api/admin/password" && method === "POST") {
    const b = await readBody(req, 5000); const admin = await readJSON(FILES.admin, null);
    if (typeof b.current !== "string" || !verifyPassword(b.current, admin)) return send(res, 403, { error: "Mật khẩu hiện tại không đúng" });
    if (typeof b.next !== "string" || b.next.length < 10) throw new Invalid("Mật khẩu mới tối thiểu 10 ký tự");
    await writeJSON(FILES.admin, { ...admin, ...hashPassword(b.next), updatedAt: new Date().toISOString() });
    for (const [t, v] of sessions) if (t !== s.token && v.user === admin.user) sessions.delete(t); // đăng xuất các thiết bị khác
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: "Không có API này" });
}
const req2 = (v, label, max) => req(v, label, max);
function login(req, res, user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { user, expires: Date.now() + SESSION_HOURS * 3600000 });
  return send(res, 200, { ok: true, user }, { "Set-Cookie": sessionCookie(req, token, SESSION_HOURS * 3600) });
}

/* ---------------- Khởi động ---------------- */
async function main() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const current = await readJSON(FILES.site, null);
  if (!current) { await writeJSON(FILES.site, validateSite(seedFromDataJs())); console.log("• Đã tạo data/site.json từ js/data.js"); }
  else if (current.studio && (current.studio.address !== undefined || current.zones.some(z => z.id === "studio"))) {
    // Chuyển dữ liệu cũ (studio có địa chỉ) sang mô hình team không có studio
    const oldAddr = current.studio.address || "";
    current.studio.area = current.studio.area || (oldAddr.startsWith("123 Đường Ví Dụ") ? "TP. Hồ Chí Minh & các tỉnh lân cận" : oldAddr); delete current.studio.address;
    current.zones = current.zones.filter(z => z.id !== "studio");
    for (const z of current.zones) if (z.fullDay === undefined) z.fullDay = (z.leadDays || 0) >= 2; // vùng xa: chiếm trọn ngày
    // Chỉ thay mô tả mẫu cũ còn nhắc "studio" (nếu admin chưa tự sửa)
    const OLD_DESC = {
      "Chụp chân dung trong studio, phù hợp ảnh profile, CV, mạng xã hội.": "Chân dung tại địa điểm bạn chọn: quán cà phê, công viên, nhà riêng… Phù hợp ảnh profile, CV, mạng xã hội.",
      "Nhóm 10–30 người, chụp tại studio hoặc trường. Giá tính cho cả nhóm.": "Nhóm 10–30 người, chụp tại trường hoặc địa điểm nhóm chọn. Giá tính cho cả nhóm.",
    };
    for (const s of current.services) if (OLD_DESC[s.desc]) s.desc = OLD_DESC[s.desc];
    await fsp.copyFile(FILES.site, FILES.site.replace(/\.json$/, `.backup-${Date.now()}.json`)); // giữ bản sao trước khi chuyển
    await writeJSON(FILES.site, validateSite(current)); console.log("• Đã chuyển data/site.json sang mô hình team (bỏ studio/địa chỉ)");
  }
  const site2 = await readJSON(FILES.site, null);
  if (site2 && !site2.shifts) {
    // Chuyển từ khung giờ từng tiếng sang buổi sáng / chiều / cả ngày (đơn cũ giữ nguyên, tự quy đổi khi xem lịch)
    await fsp.copyFile(FILES.site, FILES.site.replace(/\.json$/, `.backup-${Date.now()}.json`));
    site2.shifts = shiftsFromSlots(site2.timeSlots); delete site2.timeSlots;
    await writeJSON(FILES.site, validateSite(site2)); console.log("• Đã chuyển lịch nhận khách sang buổi sáng / chiều / cả ngày");
  }
  if (!(await readJSON(FILES.bookings, null))) await writeJSON(FILES.bookings, []);
  if (!(await readJSON(FILES.admin, null))) {
    setupToken = crypto.randomBytes(4).toString("hex").toUpperCase();
    console.log("\n=== CHƯA CÓ TÀI KHOẢN ADMIN ===");
    console.log(`Mở http://localhost:${PORT}/admin.html và nhập MÃ THIẾT LẬP: ${setupToken}`);
    console.log("(Mã chỉ dùng một lần, đổi mỗi khi khởi động lại server.)\n");
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try {
      if (url.pathname.startsWith("/api/")) await api(req, res, url);
      else if (req.method === "GET" || req.method === "HEAD") await serveStatic(req, res, url.pathname);
      else send(res, 405, "Method not allowed");
    } catch (e) {
      if (e instanceof Invalid) send(res, e instanceof TooLarge ? 413 : 400, { error: e.message });
      else { console.error(e); send(res, 500, { error: "Lỗi máy chủ" }); }
    }
  }).listen(PORT, HOST, () => console.log(`MoriGraphy đang chạy: http://localhost:${PORT}  ·  Admin: http://localhost:${PORT}/admin.html`));
  setInterval(() => { const now = Date.now(); for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t); }, 600000).unref();
  // Dừng êm (Docker/systemd gửi SIGTERM): ngừng nhận request, chờ ghi file xong rồi thoát
  const shutdown = sig => {
    console.log(`Nhận ${sig}, đang dừng server…`);
    server.close(() => writeChain.finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
main();
