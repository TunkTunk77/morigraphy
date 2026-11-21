# MoriGraphy — Website đặt lịch chụp ảnh

## Chạy

Cần Node.js ≥ 18 (không phải cài thêm thư viện).

```powershell
npm start
```

- Trang khách: http://localhost:5173
- Quản trị: http://localhost:5173/admin.html

## Chạy bằng Docker (container)

Cần cài [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/macOS) hoặc Docker Engine (Linux).

```powershell
docker compose up -d --build
```

- Trang khách: http://localhost:5173 · Admin: http://localhost:5173/admin.html
- Thư mục `data/` trên máy được gắn vào container (`/app/data`): tài khoản admin, đơn đặt lịch, ảnh tải lên **giữ nguyên** khi cập nhật hay xóa container.
- Lần đầu chưa có admin: xem mã thiết lập bằng `docker compose logs morigraphy`.
- Cập nhật sau khi sửa code: chạy lại `docker compose up -d --build`.
- Dừng: `docker compose down` (không mất dữ liệu).
- Đổi cổng: sửa `"5173:5173"` trong `docker-compose.yml` thành `"8080:5173"`.
- Trên máy chủ Linux: nếu container báo không ghi được vào `data/`, chạy `sudo chown -R 1000:1000 data` (container chạy bằng user `node`, uid 1000).
- Khi đưa lên mạng: đặt sau reverse proxy có HTTPS (Caddy/Nginx). Cookie đăng nhập tự bật `Secure` khi proxy gửi `X-Forwarded-Proto: https`.

## Đưa lên mạng 24/7 (VPS + tên miền + HTTPS)

Dùng `docker-compose.public.yml`: web chạy sau **Caddy**, tự có HTTPS (Let's Encrypt), cổng 5173 không mở ra ngoài.

1. Thuê VPS Ubuntu (1 CPU, 1 GB RAM là đủ).
2. Ở nơi quản lý tên miền, tạo bản ghi **A** `@` → IP của VPS, và **A** `www` → IP của VPS. Nếu dùng Cloudflare, để **DNS only** (mây xám).
3. Chép thư mục `MoriGraphy` lên VPS (VD: `scp -r MoriGraphy root@IP_VPS:~`), rồi trên VPS:
   ```bash
   cd ~/MoriGraphy
   sudo bash deploy/setup-ubuntu.sh tenmiencuaban.com
   ```
   Script cài Docker, ghi `.env`, build và chạy, rồi in **mã thiết lập admin**.
4. Mở `https://tenmiencuaban.com/admin.html` để tạo tài khoản admin.

Lệnh hay dùng trên VPS (trong thư mục MoriGraphy):

| Việc | Lệnh |
|---|---|
| Cập nhật sau khi sửa code | `docker compose -f docker-compose.public.yml up -d --build` |
| Xem log | `docker compose -f docker-compose.public.yml logs -f` |
| Dừng | `docker compose -f docker-compose.public.yml down` |
| Sao lưu dữ liệu | `tar czf backup-$(date +%F).tgz data` |

`TRUST_PROXY=1` (đã bật trong file public) cho server lấy IP thật của khách từ Caddy, để giới hạn 5 lần đăng nhập sai tính theo từng người. **Không** bật biến này khi cổng server mở thẳng ra mạng.

## Tạo tài khoản admin (lần đầu)

1. Chạy `npm start`. Cửa sổ server in ra dòng **MÃ THIẾT LẬP: XXXXXXXX**.
2. Mở `/admin.html`, nhập mã đó, đặt tên đăng nhập và mật khẩu (tối thiểu 10 ký tự).
3. Mã chỉ dùng một lần. Sau khi có tài khoản, trang chỉ còn màn đăng nhập.

Quên mật khẩu: tắt server, xóa file `data/admin.json`, chạy lại `npm start` để nhận mã thiết lập mới.

## Dữ liệu

| File | Nội dung |
|---|---|
| `data/site.json` | Gói chụp, thám tử, dịch vụ, sản phẩm, khu vực & phí di chuyển, khung giờ, thông tin team. Sửa trong trang admin. |
| `data/bookings.json` | Đơn đặt lịch của khách |
| `data/admin.json` | Tài khoản admin (mật khẩu đã băm) |
| `data/uploads/` | Ảnh đại diện & portfolio thám tử (admin tải lên; tự thu nhỏ ≤ 1600px; ảnh không còn dùng tự xóa sau khi Lưu) |
| `js/data.js` | Dữ liệu mẫu. Chỉ dùng để tạo `site.json` lần đầu, hoặc khi mở `index.html` không có server. |

**Sao lưu thư mục `data/` thường xuyên.** Không đưa `admin.json` và `bookings.json` lên git (đã có trong `.gitignore`).

## Khi đưa lên mạng

- Chạy sau HTTPS (Nginx/Caddy hoặc dịch vụ hosting có HTTPS). Cookie đăng nhập tự bật `Secure` khi qua HTTPS.
- Server mặc định chỉ nghe `127.0.0.1`. Đặt biến môi trường `HOST=0.0.0.0` khi chạy sau reverse proxy, và `PORT` nếu cần đổi cổng.

## Lịch trống

- Khung giờ "đã có khách" lấy từ đơn thật trong `data/bookings.json`. Đơn **Đã hủy** sẽ trả lại giờ.
- Server kiểm tra trùng lịch khi nhận đơn (kể cả hai khách bấm gửi cùng lúc). Khách chọn "Để team sắp xếp" sẽ được giao thám tử đầu tiên còn trống.
- Khu vực bật **Chiếm trọn ngày** (đi tỉnh) khóa cả ngày của thám tử, cộng thêm số đêm ở lại.
