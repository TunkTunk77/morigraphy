/* =========================================================
   VietQR (chuẩn NAPAS 247 / EMVCo) — tạo mã QR chuyển khoản ngay trên trình duyệt.
   Không gửi số tài khoản/số tiền tới dịch vụ bên ngoài.
   Cần thư viện qrcode-generator (window.qrcode) để vẽ ảnh QR.
   ========================================================= */
(function () {
  "use strict";

  /* Mã BIN ngân hàng (NAPAS). Không có trong danh sách → admin nhập mã BIN 6 số. */
  const BANKS = [
    ["970436", "Vietcombank"], ["970415", "VietinBank"], ["970418", "BIDV"], ["970405", "Agribank"],
    ["970407", "Techcombank"], ["970422", "MB Bank"], ["970416", "ACB"], ["970432", "VPBank"],
    ["970423", "TPBank"], ["970403", "Sacombank"], ["970441", "VIB"], ["970443", "SHB"],
    ["970437", "HDBank"], ["970448", "OCB"], ["970426", "MSB"], ["970440", "SeABank"],
    ["970431", "Eximbank"], ["970449", "LPBank"], ["970428", "Nam A Bank"], ["546034", "CAKE by VPBank"],
  ];

  const tlv = (tag, value) => tag + String(value.length).padStart(2, "0") + value;

  // CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — kiểm tra: "123456789" → 29B1
  function crc16(s) {
    let crc = 0xffff;
    for (let i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }

  // Nội dung chuyển khoản: bỏ dấu, chỉ giữ chữ/số/khoảng trắng (nhiều ngân hàng không nhận ký tự khác)
  function cleanInfo(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
      .replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
  }

  /** Chuỗi dữ liệu VietQR. amount (đồng) & info không bắt buộc. */
  function payload({ bin, account, amount, info }) {
    if (!/^\d{6}$/.test(bin || "")) throw new Error("Mã BIN ngân hàng phải gồm 6 số");
    if (!/^[0-9A-Za-z]{4,19}$/.test(account || "")) throw new Error("Số tài khoản không hợp lệ");
    const amt = amount ? String(Math.round(Number(amount))) : "";
    const note = cleanInfo(info);
    let s = tlv("00", "01") + tlv("01", amt ? "12" : "11")
      + tlv("38", tlv("00", "A000000727") + tlv("01", tlv("00", bin) + tlv("01", account)) + tlv("02", "QRIBFTTA"))
      + tlv("53", "704") + (amt ? tlv("54", amt) : "") + tlv("58", "VN")
      + (note ? tlv("62", tlv("08", note)) : "") + "6304";
    return s + crc16(s);
  }

  /** Ảnh QR dạng data URL (GIF) — dùng cho <img> và nút tải về. null nếu chưa có thư viện. */
  function dataURL(text, cell = 7, margin = 14) {
    if (!window.qrcode) return null;
    const qr = window.qrcode(0, "M"); qr.addData(text, "Byte"); qr.make();
    return qr.createDataURL(cell, margin);
  }

  const bankName = bin => (BANKS.find(b => b[0] === bin) || [])[1] || "";

  window.VietQR = { BANKS, crc16, cleanInfo, payload, dataURL, bankName };
})();
