// Sample still frames from a <video> for overlay-caption extraction (Gemini
// vision). Shared by TikTokCanvas (grid cards) and the CaptionComposer.
//
// IMPORTANT: the <video> MUST be same-origin (e.g. served through our
// /api/video-reels/proxy) — drawing a cross-origin video to a canvas taints it
// and toDataURL() throws. The composer and the canvas both use proxied URLs.

// Which timestamps to grab when the caller doesn't specify. Two frames by
// default (early + midpoint): the creator's overlay caption is identical in
// both, while burned-in speech subtitles differ — that contrast is what lets
// the model exclude the subtitles. Very short clips get a single t=0 frame.
export function defaultFrameTimes(duration: number): number[] {
  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  // Two frames for clips over 2s: a fixed 0.5s early frame (in this branch
  // dur/4 is always > 0.5, so the early frame is simply 0.5s) plus the midpoint.
  return dur > 2 ? [0.5, dur / 2] : [0];
}

// Seek a video to `t` and resolve once it has actually presented that frame,
// with a hard timeout so a stalled seek (unbuffered region of a still-streaming
// proxy video) can't hang. Ignores stale 'seeked' events from a prior seek.
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      resolve();
    };
    const onSeeked = () => {
      if (video.seeking || Math.abs(video.currentTime - t) > 0.3) return;
      finish();
    };
    const timer = setTimeout(finish, 3000);
    video.addEventListener('seeked', onSeeked);
    video.currentTime = t;
  });
}

// Grab JPEG data-URL frames from the video at the given (or default) times.
// Returns distinct frames only — a stalled seek that re-captures the same
// displayed frame would otherwise tell the model "this text appears twice", the
// exact signal it uses to keep subtitles OUT. Returns null if the video isn't
// ready or a frame can't be drawn. Never throws.
export async function sampleVideoFrames(video: HTMLVideoElement | null, times?: number[]): Promise<string[] | null> {
  if (!video || video.readyState < 2 || !video.videoWidth) return null;

  const prevTime = video.currentTime;
  const wasPaused = video.paused;
  video.pause();
  try {
    const capTimes = times ?? defaultFrameTimes(video.duration);
    // Downscale to ~720px wide: plenty for text legibility, keeps payload small.
    const scale = Math.min(1, 720 / video.videoWidth);
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = Math.round(video.videoWidth * scale);
    frameCanvas.height = Math.round(video.videoHeight * scale);
    const frameCtx = frameCanvas.getContext('2d');
    if (!frameCtx) return null;

    const frames: string[] = [];
    for (const t of capTimes) {
      await seekTo(video, t);
      frameCtx.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
      frames.push(frameCanvas.toDataURL('image/jpeg', 0.85));
    }
    return frames.filter((f, i) => frames.indexOf(f) === i);
  } catch (e) {
    // Distinguish a real failure (e.g. an unexpected drawImage/toDataURL throw)
    // from a benign not-ready return — the old inline version logged this too.
    console.error('[frame-sampler] frame extraction failed:', e);
    return null;
  } finally {
    // Restore the preview to where it was.
    await seekTo(video, prevTime);
    if (!wasPaused) video.play().catch(() => {});
  }
}
