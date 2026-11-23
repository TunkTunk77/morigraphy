/* =========================================================
   MoriGraphy — báo có đơn mới (không cần thư viện)
   - Telegram: bot của bạn gửi tin vào chat / nhóm đã chọn
   - Ứng dụng trên điện thoại: trang admin cài lên màn hình chính (PWA)
     và nhận thông báo đẩy chuẩn Web Push (VAPID + mã hóa aes128gcm, RFC 8291/8292)
   Cấu hình + khóa bí mật lưu ở data/notify.json (không công khai, không lên git).
   ========================================================= */
"use strict";
const crypto = require("node:crypto");

const TG_API = process.env.MG_TELEGRAM_API || "https://api.telegram.org"; // đổi được khi chạy thử
const b64u = buf => Buffer.from(buf).toString("base64url");
const fromB64u = s => Buffer.from(String(s || ""), "base64url");

module.exports = function createNotifier({ file, readJSON, writeJSON }) {
  let chain = Promise.resolve(); // ghi tuần tự để không mất đăng ký
  const update = fn => (chain = chain.then(async () => { const cfg = await load(); const out = await fn(cfg); await writeJSON(file, cfg); return out; }));

  async function load() {
    const cfg = (await readJSON(file, null)) || {};
    cfg.telegram ||= { token: "", chatIds: [] };
    cfg.push ||= { subs: [] };
    if (!cfg.push.vapid) { // tạo cặp khóa VAPID một lần
      const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
      cfg.push.vapid = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
      await writeJSON(file, cfg);
    }
    return cfg;
  }

  /* ---------- Telegram ---------- */
  const tgCall = async (token, method, body, ms = 10000) => {
    const r = await fetch(`${TG_API}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(ms) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || `Telegram lỗi ${r.status}`);
    return j.result;
  };
  async function telegramSend(cfg, text) {
    const { token, chatIds } = cfg.telegram;
    if (!token || !chatIds.length) return 0;
    let sent = 0;
    for (const chat_id of chatIds) { try { await tgCall(token, "sendMessage", { chat_id, text, disable_web_page_preview: true }); sent++; } catch (e) { console.error("• Telegram:", e.message); } }
    return sent;
  }
  /* ---------- Bot trả lời lệnh (xem lịch trong Telegram) ----------
     Hỏi Telegram liên tục kiểu "long polling": không cần tên miền/https, chạy được cả trên máy nhà. */
  const COMMANDS = [
    { command: "homnay", description: "Lịch chụp hôm nay" }, { command: "mai", description: "Lịch chụp ngày mai" },
    { command: "tuan", description: "Lịch 7 ngày tới" }, { command: "lich", description: "Tất cả lịch sắp tới" },
    { command: "moi", description: "Đơn mới chưa xác nhận" }, { command: "don", description: "Xem chi tiết 1 đơn: /don MG-261129-ABCD" },
    { command: "help", description: "Danh sách lệnh" },
  ];
  const bot = { token: null, username: "", offset: 0, running: false, seen: new Map(), handler: null };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const splitMsg = t => { const out = []; let cur = ""; for (const line of String(t).split("\n")) { if ((cur + "\n" + line).length > 3900) { out.push(cur); cur = line; } else cur = cur ? cur + "\n" + line : line; } if (cur) out.push(cur); return out; };
  async function pollLoop() {
    if (bot.running) return; bot.running = true;
    for (;;) {
      let cfg; try { cfg = await load(); } catch (e) { await sleep(5000); continue; }
      const token = cfg.telegram.token;
      if (!token || !bot.handler) { bot.token = null; await sleep(5000); continue; }
      if (token !== bot.token) {
        bot.token = token; bot.offset = 0; bot.seen.clear();
        try { await tgCall(token, "deleteWebhook", {}); await tgCall(token, "setMyCommands", { commands: COMMANDS }); bot.username = (await tgCall(token, "getMe")).username; }
        catch (e) { console.error("• Telegram bot:", e.message); await sleep(15000); bot.token = null; continue; }
      }
      try {
        const ups = await tgCall(token, "getUpdates", { offset: bot.offset, timeout: 25, allowed_updates: ["message", "my_chat_member"] }, 35000);
        for (const u of ups) {
          bot.offset = u.update_id + 1;
          const m = u.message, c = (m || u.my_chat_member || {}).chat; if (!c) continue;
          bot.seen.set(String(c.id), { id: String(c.id), name: c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || String(c.id), type: c.type });
          if (!m || !m.text) continue;
          let reply; try { reply = await bot.handler(m.text, cfg.telegram.chatIds.includes(String(c.id)), String(c.id)); } catch (e) { reply = "Có lỗi khi đọc lịch: " + e.message; }
          if (reply) for (const part of splitMsg(reply)) await tgCall(token, "sendMessage", { chat_id: c.id, text: part, disable_web_page_preview: true }).catch(e => console.error("• Telegram bot:", e.message));
        }
      } catch (e) {
        if (!/aborted|timeout/i.test(e.message)) console.error("• Telegram bot:", e.message);
        await sleep(/Unauthorized|Not Found/i.test(e.message) ? 60000 : 3000);
      }
    }
  }

  // Các chat vừa nhắn cho bot (để lấy chat ID): người dùng gửi /start cho bot, hoặc thêm bot vào nhóm rồi nhắn 1 câu
  async function telegramChats(token) {
    // Bot đang chạy với đúng mã này thì lấy danh sách nó đã thấy (gọi getUpdates song song sẽ bị Telegram từ chối)
    if (bot.token === token && bot.running) return { bot: bot.username, chats: [...bot.seen.values()] };
    const ups = await tgCall(token, "getUpdates", { limit: 50 });
    const seen = new Map();
    for (const u of ups) { const c = (u.message || u.channel_post || u.my_chat_member || {}).chat; if (c) seen.set(String(c.id), { id: String(c.id), name: c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || String(c.id), type: c.type }); }
    const me = await tgCall(token, "getMe");
    return { bot: me.username, chats: [...seen.values()] };
  }

  /* ---------- Web Push ---------- */
  function vapidAuth(endpoint, vapid, subject) {
    const aud = new URL(endpoint).origin;
    const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
    const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
    const pub = fromB64u(vapid.publicKey);
    const key = crypto.createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: vapid.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
    const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
    return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
  }
  const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
  // RFC 8291: mã hóa nội dung cho trình duyệt nhận (chỉ trình duyệt đó giải được)
  function encrypt(sub, payload) {
    const uaPublic = fromB64u(sub.keys.p256dh), authSecret = fromB64u(sub.keys.auth);
    const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
    const asPublic = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPublic);
    const prkKey = hmac(authSecret, shared);
    const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
    const salt = crypto.randomBytes(16), prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
    const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
    const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([2])])), c.final(), c.getAuthTag()]);
    const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = asPublic.length;
    return Buffer.concat([header, asPublic, ct]);
  }
  async function pushOne(sub, vapid, subject, payload) {
    const r = await fetch(sub.endpoint, { method: "POST", signal: AbortSignal.timeout(10000), body: encrypt(sub, payload),
      headers: { Authorization: vapidAuth(sub.endpoint, vapid, subject), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" } });
    return r.status;
  }
  async function pushSend(cfg, msg, subject) {
    const gone = []; let sent = 0;
    for (const s of cfg.push.subs) {
      try { const st = await pushOne(s, cfg.push.vapid, subject, JSON.stringify(msg)); if (st === 404 || st === 410) gone.push(s.id); else if (st < 300) sent++; else console.error(`• Push ${s.name}: HTTP ${st}`); }
      catch (e) { console.error(`• Push ${s.name}:`, e.message); }
    }
    if (gone.length) await update(c => { c.push.subs = c.push.subs.filter(s => !gone.includes(s.id)); });
    return sent;
  }

  return {
    // Gửi tới mọi kênh đã bật; không bao giờ ném lỗi (đặt lịch không được hỏng vì thông báo)
    async send(msg, subject = "mailto:admin@example.com") {
      try { const cfg = await load(); const [tg, push] = await Promise.all([telegramSend(cfg, msg.text || `${msg.title}\n${msg.body}`), pushSend(cfg, msg, subject)]); return { telegram: tg, push }; }
      catch (e) { console.error("• Thông báo lỗi:", e.message); return { telegram: 0, push: 0 }; }
    },
    async status() {
      const cfg = await load();
      return { telegram: { token: cfg.telegram.token, chatIds: cfg.telegram.chatIds }, push: { publicKey: cfg.push.vapid.publicKey, devices: cfg.push.subs.map(s => ({ id: s.id, name: s.name, createdAt: s.createdAt })) } };
    },
    saveTelegram(token, chatIds) {
      return update(cfg => { cfg.telegram = { token, chatIds }; });
    },
    telegramChats,
    startBot(handler) { bot.handler = handler; pollLoop(); },
    subscribe(sub, name) {
      return update(cfg => {
        const existing = cfg.push.subs.find(s => s.endpoint === sub.endpoint);
        if (existing) { existing.keys = sub.keys; existing.name = name; return existing.id; }
        const id = crypto.randomBytes(6).toString("hex");
        cfg.push.subs.push({ id, name, endpoint: sub.endpoint, keys: sub.keys, createdAt: new Date().toISOString() });
        if (cfg.push.subs.length > 30) cfg.push.subs.shift();
        return id;
      });
    },
    unsubscribe(id) { return update(cfg => { cfg.push.subs = cfg.push.subs.filter(s => s.id !== id && s.endpoint !== id); }); },
    _encrypt: encrypt, // để kiểm thử
  };
};
