/* =========================================================
   MoriGraphy — dữ liệu mẫu
   Sửa trực tiếp file này để thay thông tin thật của studio.
   Sau này có backend: thay các mảng dưới bằng dữ liệu gọi từ API.
   ========================================================= */

/* MoriGraphy là team nhiếp ảnh (không có studio cố định): mọi buổi chụp ở địa điểm khách chọn. */
window.STUDIO = {
  name: "MoriGraphy",
  tagline: "Mọi khoảnh khắc đều có manh mối",
  phone: "0900 000 000",           // số điện thoại / Zalo
  email: "hello@morigraphy.vn",
  area: "TP. Hồ Chí Minh & các tỉnh lân cận", // khu vực hoạt động
  openHours: "08:00 – 20:00, tất cả các ngày",
  facebook: "",                    // link trang Facebook (để trống nếu chưa có)
  instagram: "",                   // link Instagram (để trống nếu chưa có)
  depositPercent: 30, // % đặt cọc khi xác nhận lịch
  // Tài khoản nhận cọc qua VietQR — nhập trong trang admin (Thông tin team → Thanh toán cọc).
  // Để enabled: false cho tới khi điền tài khoản THẬT; khi tắt, khách được báo team sẽ gửi thông tin chuyển khoản.
  payment: { enabled: false, bankBin: "", bankLabel: "", accountNo: "", accountName: "" },
};

/* Nội dung trang chủ: chỉnh trong admin → "Trang chủ".
   Chữ phần đầu trang & tiêu đề các mục lấy mặc định trong js/hero.js (DEFAULT_HERO, DEFAULT_SECTIONS). */
window.SECTIONS = {};
/* Ảnh bìa trang chủ (tập hồ sơ CASE FILE) */
window.HERO = {
  photo: "",                         // ảnh trong khung polaroid (tải lên trong admin); trống = ô màu giữ chỗ
  photoTone: "dusk",                 // màu ô giữ chỗ khi chưa có ảnh
  caption: "Bằng chứng #001 — ảnh mẫu",
  tab: "CASE FILE · MG-001",         // nhãn trên tập hồ sơ
  stampTitle: "CASE FILE",           // con dấu đỏ — dòng to
  stampSub: "MG · ĐÃ XÁC NHẬN",      // con dấu đỏ — dòng nhỏ
  showStamp: true,
  showMagnifier: true,
  folderTone: "warm",                // màu tập hồ sơ
};

/* Danh mục gói chụp */
window.CATEGORIES = ["Tất cả", "Cá nhân", "Cặp đôi", "Gia đình", "Kỷ yếu", "Doanh nghiệp"];

/* Gói chụp chính
   duration: phút — dùng để tính số khung giờ liên tiếp cần trống */
window.SERVICES = [
  {
    id: "sv-portrait", name: "Chân dung cá nhân", category: "Cá nhân", duration: 60, price: 1200000, tone: "warm",
    desc: "Chân dung tại địa điểm bạn chọn: quán cà phê, công viên, nhà riêng… Phù hợp ảnh profile, CV, mạng xã hội.",
    includes: ["1 concept, 1 trang phục", "15 ảnh chỉnh sửa", "Toàn bộ file gốc"],
  },
  {
    id: "sv-concept", name: "Concept nghệ thuật", category: "Cá nhân", duration: 120, price: 2800000, tone: "dusk",
    desc: "Lên ý tưởng theo moodboard, ekip mang theo ánh sáng và đạo cụ theo chủ đề.",
    includes: ["2 concept", "30 ảnh chỉnh sửa", "Tư vấn moodboard trước buổi chụp"],
  },
  {
    id: "sv-couple", name: "Couple / Pre-wedding", category: "Cặp đôi", duration: 180, price: 4500000, tone: "rose",
    desc: "Bộ ảnh đôi với 3 bối cảnh, phù hợp kỷ niệm hoặc save-the-date.",
    includes: ["3 concept", "40 ảnh chỉnh sửa", "Video behind-the-scenes 30s"],
  },
  {
    id: "sv-family", name: "Gia đình", category: "Gia đình", duration: 90, price: 2200000, tone: "sage",
    desc: "Ảnh gia đình tối đa 6 người tại nhà hoặc ngoài trời, không khí tự nhiên, thoải mái cho cả bé.",
    includes: ["Tối đa 6 người", "25 ảnh chỉnh sửa", "1 ảnh in 30×40 cm"],
  },
  {
    id: "sv-yearbook", name: "Kỷ yếu nhóm", category: "Kỷ yếu", duration: 180, price: 6000000, tone: "sky",
    desc: "Nhóm 10–30 người, chụp tại trường hoặc địa điểm nhóm chọn. Giá tính cho cả nhóm.",
    includes: ["Tối đa 30 người", "60 ảnh chỉnh sửa", "Ảnh nhóm + ảnh cá nhân"],
  },
  {
    id: "sv-business", name: "Profile doanh nghiệp", category: "Doanh nghiệp", duration: 120, price: 3500000, tone: "stone",
    desc: "Chụp tại văn phòng của bạn: ảnh đội ngũ, chân dung lãnh đạo, không gian làm việc cho website và hồ sơ năng lực.",
    includes: ["Tối đa 10 người", "Phông nền di động đồng bộ", "Bàn giao trong 5 ngày"],
  },
];

/* Thám tử ảnh (thợ ảnh)
   workDays: ngày làm việc (0 = Chủ nhật, 1 = Thứ 2 ... 6 = Thứ 7)
   surcharge: phụ phí khi chọn đích danh (0 = không phụ phí)
   services: id các gói nhận chụp */
window.PHOTOGRAPHERS = [
  {
    id: "ph-an", name: "Nguyễn Minh An", role: "Thám tử trưởng", years: 9, rating: 4.9, reviews: 312, surcharge: 800000, tone: "warm",
    specialties: ["Chân dung", "Concept nghệ thuật", "Ánh sáng studio"],
    style: "Tông ấm, ánh sáng mềm, chú trọng cảm xúc khuôn mặt.",
    bio: "9 năm chụp chân dung và editorial. Từng thực hiện ấn phẩm cho nhiều thương hiệu thời trang trong nước.",
    workDays: [1, 2, 3, 4, 5, 6],
    services: ["sv-portrait", "sv-concept", "sv-couple", "sv-business"],
  },
  {
    id: "ph-linh", name: "Trần Khánh Linh", role: "Thám tử cấp cao", years: 6, rating: 4.8, reviews: 204, surcharge: 500000, tone: "rose",
    specialties: ["Cặp đôi", "Pre-wedding", "Gia đình"],
    style: "Tự nhiên, kể chuyện, bắt khoảnh khắc không dàn dựng.",
    bio: "Chuyên ảnh đôi và gia đình. Giỏi giúp người không quen ống kính thả lỏng trong buổi chụp.",
    workDays: [0, 2, 3, 5, 6],
    services: ["sv-portrait", "sv-couple", "sv-family"],
  },
  {
    id: "ph-quan", name: "Lê Hoàng Quân", role: "Thám tử", years: 4, rating: 4.7, reviews: 141, surcharge: 0, tone: "sky",
    specialties: ["Kỷ yếu", "Nhóm đông người", "Doanh nghiệp"],
    style: "Năng động, bố cục gọn, xử lý tốt nhóm lớn.",
    bio: "Phụ trách các buổi chụp nhóm và doanh nghiệp, quen điều phối 20–30 người trong một khung hình.",
    workDays: [0, 1, 3, 4, 6],
    services: ["sv-yearbook", "sv-business", "sv-family", "sv-portrait"],
  },
  {
    id: "ph-vy", name: "Phạm Tường Vy", role: "Thám tử", years: 3, rating: 4.8, reviews: 96, surcharge: 0, tone: "sage",
    specialties: ["Chân dung nữ", "Beauty", "Concept"],
    style: "Trong trẻo, tông pastel, retouch da tự nhiên.",
    bio: "Mạnh về chân dung nữ và beauty, phối hợp chặt với makeup artist của studio.",
    workDays: [0, 1, 2, 4, 5, 6],
    services: ["sv-portrait", "sv-concept", "sv-couple"],
  },
];

/* Dịch vụ đi kèm (thêm vào buổi chụp)
   extraMinutes: cộng thêm thời lượng buổi chụp (để kiểm tra khung giờ) */
window.ADDONS = [
  { id: "ad-makeup", name: "Makeup & làm tóc", price: 600000, unit: "người", tone: "rose", desc: "Makeup artist của studio, khoảng 45 phút/người." },
  { id: "ad-outfit", name: "Thuê trang phục", price: 300000, unit: "bộ", tone: "dusk", desc: "Chọn từ tủ đồ studio, đã giặt ủi." },
  { id: "ad-hour", name: "Thêm 1 giờ chụp", price: 700000, unit: "giờ", tone: "warm", desc: "Kéo dài buổi chụp, thêm khung giờ liền sau.", extraMinutes: 60, max: 3 },
  { id: "ad-concept", name: "Thêm 1 concept", price: 800000, unit: "concept", tone: "sage", desc: "Thêm bối cảnh, đạo cụ và ánh sáng riêng." },
  { id: "ad-retouch", name: "Retouch nâng cao", price: 80000, unit: "ảnh", tone: "sky", desc: "Chỉnh chi tiết da, dáng, ghép nền.", max: 50 },
  { id: "ad-express", name: "Giao ảnh nhanh 48h", price: 500000, unit: "lần", tone: "stone", desc: "Nhận ảnh hoàn thiện trong 48 giờ.", max: 1 },
];

/* Mục "Sản phẩm" (album, ảnh in…) đã bỏ theo yêu cầu — để trống. */
window.PRODUCTS = [];

/* Khu vực chụp & chi phí di chuyển (SỐ LIỆU MẪU — sửa theo giá thật)
   Team không có studio: mọi buổi chụp ở địa điểm khách chọn, khách luôn nhập địa chỉ.
   fee: phí di chuyển mỗi buổi (0 = miễn phí)
   perNight: phí lưu trú cho ekip mỗi đêm (0 = không áp dụng)
   quote: true = báo giá riêng (vé máy bay/xe theo thực tế)
   leadDays: phải đặt trước ít nhất bao nhiêu ngày (để ekip sắp xếp di chuyển)
   fullDay: true = buổi chụp chiếm trọn ngày của thám tử (đi tỉnh), cộng thêm số đêm lưu trú
   Tên tỉnh theo địa giới hành chính sau sáp nhập 2025. */
window.TRAVEL_ZONES = [
  { id: "z1", name: "Vùng 1 · Trong TP.HCM", short: "Vùng 1", fee: 0, perNight: 0, leadDays: 0, fullDay: false, examples: "Nội thành, khu Bình Dương & Vũng Tàu cũ", note: "Miễn phí di chuyển." },
  { id: "z2", name: "Vùng 2 · Dưới 150 km", short: "Vùng 2", fee: 1200000, perNight: 0, leadDays: 2, fullDay: true, examples: "Đồng Nai, Tây Ninh…", note: "Đi về trong ngày." },
  { id: "z3", name: "Vùng 3 · 150 – 350 km", short: "Vùng 3", fee: 2500000, perNight: 700000, leadDays: 3, fullDay: true, examples: "Cần Thơ, Lâm Đồng (Đà Lạt)…", note: "Có thể cần ở lại qua đêm." },
  { id: "z4", name: "Vùng 4 · Trên 350 km", short: "Vùng 4", fee: 1500000, perNight: 700000, leadDays: 7, fullDay: true, quote: true, examples: "Đà Nẵng, Hà Nội… (đi máy bay)", note: "Công tác phí 1.500.000đ/ngày + vé thực tế, báo giá riêng." },
];

/* Khung giờ bắt đầu chụp mỗi ngày (bước 60 phút; nghỉ trưa 12:00) */
window.TIME_SLOTS = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

/* Số ngày tối đa cho phép đặt trước */
window.BOOKING_WINDOW_DAYS = 60;
