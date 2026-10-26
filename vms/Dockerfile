# VisionOne VMS – strežnik, VisionOne Admin in VisionOne View
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production DATA_DIR=/data RECORDINGS_ROOT=/recordings PORT=8080 TZ=Europe/Ljubljana
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY web ./web

EXPOSE 8080
VOLUME ["/data", "/recordings"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "src/index.js"]
