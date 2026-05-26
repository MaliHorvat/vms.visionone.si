#!/bin/bash
set -euo pipefail

INSTALL_DIR="/opt/visionone-vms-gateway"
GO2RTC_VERSION="${GO2RTC_VERSION:-1.9.8}"
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) GO2RTC_BIN="go2rtc_linux_arm64" ;;
  armv7l|armv6l) GO2RTC_BIN="go2rtc_linux_arm" ;;
  x86_64|amd64) GO2RTC_BIN="go2rtc_linux_amd64" ;;
  *) echo "Nepodprta arhitektura: $ARCH"; exit 1 ;;
esac

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Zaženi kot root: sudo bash install-go2rtc.sh"
  exit 1
fi

mkdir -p "$INSTALL_DIR"
if [[ ! -x "$INSTALL_DIR/go2rtc" ]]; then
  curl -fsSL "https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/${GO2RTC_BIN}" -o "$INSTALL_DIR/go2rtc"
  chmod +x "$INSTALL_DIR/go2rtc"
fi

cp "$(dirname "$0")/sync-go2rtc-config.py" "$INSTALL_DIR/"

cat > /etc/systemd/system/visionone-go2rtc.service <<EOF
[Unit]
Description=VisionOne go2rtc live stream
After=network-online.target visionone-vms-gateway.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStartPre=/usr/bin/python3 ${INSTALL_DIR}/sync-go2rtc-config.py
ExecStart=${INSTALL_DIR}/go2rtc -config ${INSTALL_DIR}/go2rtc.yaml
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/visionone-go2rtc-sync.timer <<EOF
[Unit]
Description=Refresh go2rtc config from VisionOne VMS

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF

cat > /etc/systemd/system/visionone-go2rtc-sync.service <<EOF
[Unit]
Description=Sync go2rtc config from VisionOne VMS

[Service]
Type=oneshot
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/sync-go2rtc-config.py
EOF

systemctl daemon-reload
systemctl enable visionone-go2rtc.service visionone-go2rtc-sync.timer
systemctl restart visionone-go2rtc.service || true
systemctl start visionone-go2rtc-sync.timer
echo "go2rtc nameščen. Lokalno: http://$(hostname -I | awk '{print $1}'):1984"
