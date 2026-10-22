export function cameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError': case 'SecurityError': return 'Camera permission was denied. Allow camera access or choose a file.';
    case 'NotFoundError': return 'No camera was found. Connect a camera or choose a file.';
    case 'NotReadableError': return 'The camera is in use or unavailable. Close other camera apps or choose a file.';
    case 'UnsupportedError': return 'Camera capture requires a supported browser on HTTPS or localhost. Choose a file instead.';
    default: return error?.message || 'Unable to open the camera. Choose a file instead.';
  }
}

export class CameraSession {
  constructor({ getUserMedia, canvas = () => document.createElement('canvas') } = {}) {
    this.getUserMedia = getUserMedia;
    this.canvas = canvas;
    this.closed = false;
    this.stream = null;
  }
  async open(video) {
    if (!this.getUserMedia) throw Object.assign(new Error(), { name: 'UnsupportedError' });
    const stream = await this.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    if (this.closed) { stream.getTracks().forEach(track => track.stop()); return false; }
    this.stream = stream;
    video.srcObject = stream;
    await video.play();
    return !this.closed;
  }
  async capture(video) {
    if (this.closed || !this.stream || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      throw new Error('The camera is not ready. Wait for the live preview.');
    }
    const canvas = this.canvas();
    // Bound the captured image size for mobile cameras and the 5 MB upload limit.
    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to capture an image. Choose a file instead.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (this.closed) return null;
    if (!blob) throw new Error('Unable to capture an image. Try again or choose a file.');
    if (blob.size > 5 * 1024 * 1024) throw new Error('Captured image exceeds 5 MB. Choose a smaller file.');
    return blob;
  }
  close() {
    this.closed = true;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
  }
}
