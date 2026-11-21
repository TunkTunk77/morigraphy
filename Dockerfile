# =========================================================
# MoriGraphy — website đặt lịch chụp + trang admin
# Không cần cài thư viện npm (server chỉ dùng module có sẵn của Node).
# Build:  docker build -t morigraphy .
# Chạy:   docker compose up -d      (xem docker-compose.yml)
# =========================================================
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5173

WORKDIR /app

# Mã nguồn web + server (dữ liệu thật KHÔNG nằm trong image — xem .dockerignore)
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node js ./js
COPY --chown=node:node css ./css
COPY --chown=node:node assets ./assets
COPY --chown=node:node index.html admin.html ./

# Thư mục dữ liệu: gắn volume vào đây để giữ admin, đơn đặt lịch, ảnh tải lên
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
VOLUME ["/app/data"]

# Chạy bằng user thường, không dùng root
USER node

EXPOSE 5173

# Tự kiểm tra server còn trả lời
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/data" > /dev/null || exit 1

CMD ["node", "server/server.js"]
