// Predvajalnik žive slike (go2rtc MSE/WebRTC prek posrednika /go2rtc)
import { VideoRTC } from './video-rtc.js';

class V1Player extends VideoRTC {
  oninit() {
    super.oninit();
    this.video.controls = false;
    this.video.muted = true;
    this.video.style.objectFit = 'contain';
    this.video.addEventListener('playing', () => this.setState('live'));
    this.video.addEventListener('waiting', () => this.setState('buffer'));
    // MJPEG način prikazuje sličice kot 'poster'
    new MutationObserver(() => this.setState('live')).observe(this.video, { attributes: true, attributeFilter: ['poster'] });
  }
  onconnect() {
    const r = super.onconnect();
    if (r) this.setState('connecting');
    return r;
  }
  onclose() {
    this.setState('reconnect');
    return super.onclose();
  }
  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.dispatchEvent(new CustomEvent('state', { detail: s }));
  }
}
if (!customElements.get('v1-player')) customElements.define('v1-player', V1Player);

const H264 = !!(window.MediaSource || window.ManagedMediaSource) && (window.MediaSource || window.ManagedMediaSource).isTypeSupported('video/mp4; codecs="avc1.42E01E"');
export const supportsH264 = H264;

// stream: ime toka v go2rtc (cam_1, cam_1_sub, pb_xxxx)
export function createPlayer(stream, { audio = false, mic = false, mode } = {}) {
  const p = document.createElement('v1-player');
  // brskalniki brez H.264 (npr. nekatere Linux različice Chromiuma) dobijo MJPEG, ki ga pripravi go2rtc
  p.mode = mode || (mic ? 'webrtc' : H264 ? 'mse,webrtc,hls,mjpeg' : 'mjpeg');
  p.media = mic ? 'video,audio,microphone' : audio ? 'video,audio' : 'video';
  p.visibilityThreshold = 0;
  p.style.cssText = 'position:absolute;inset:0;display:block';
  p.streamName = stream;
  p.start = () => { p.src = `/go2rtc/api/ws?src=${encodeURIComponent(stream)}`; };
  return p;
}
