export function cameraStreamName(channel: number) {
  return `ch${channel}`;
}

export function buildGo2rtcPlayerUrl(streamBaseUrl: string, streamName: string) {
  const base = streamBaseUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    src: streamName,
    mode: "webrtc,mse,hls",
  });
  return `${base}/stream.html?${params.toString()}`;
}

/** Privzeti RTSP URL (Hikvision-style NVR kanal ali direktna kamera). */
export function resolveRtspUrl(input: { rtspUrl: string; ip: string; channel: number }, nvrIp: string) {
  const explicit = input.rtspUrl.trim();
  if (explicit) return explicit;
  if (nvrIp.trim() && input.channel > 0) {
    // Hikvision-style: kanal 1 main = 101, kanal 2 main = 201, …
    const code = input.channel * 100 + 1;
    return `rtsp://${nvrIp.trim()}:554/Streaming/Channels/${code}`;
  }
  if (input.ip.trim()) {
    return `rtsp://${input.ip.trim()}:554/`;
  }
  return "";
}

export function isLiveConfigured(streamBaseUrl: string, rtspUrl: string) {
  return Boolean(streamBaseUrl.trim() && rtspUrl.trim());
}
