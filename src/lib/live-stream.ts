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

export type LiveCameraInput = {
  id: string;
  name: string;
  channel: number;
  ip: string;
  rtspUrl: string;
  status: string;
};

export type LiveSiteInput = {
  id: string;
  name: string;
  nvrIp: string;
  streamBaseUrl: string;
};

export function buildCameraLiveSession(camera: LiveCameraInput, site: LiveSiteInput) {
  const streamName = cameraStreamName(camera.channel);
  const rtspUrl = resolveRtspUrl(
    { rtspUrl: camera.rtspUrl, ip: camera.ip, channel: camera.channel },
    site.nvrIp,
  );
  const streamBaseUrl = site.streamBaseUrl.trim();
  if (!isLiveConfigured(streamBaseUrl, rtspUrl)) return null;
  return {
    camera: { id: camera.id, name: camera.name, channel: camera.channel, status: camera.status },
    site: { id: site.id, name: site.name },
    streamName,
    rtspUrl,
    playerUrl: buildGo2rtcPlayerUrl(streamBaseUrl, streamName),
  };
}
