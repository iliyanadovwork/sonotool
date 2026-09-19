import { describe, it, expect } from 'vitest';
import { defaultFrameTimes, sampleVideoFrames } from './frame-sampler';

describe('defaultFrameTimes', () => {
  it('samples an early (<=0.5s) frame and the midpoint for clips longer than 2s', () => {
    expect(defaultFrameTimes(10)).toEqual([0.5, 5]);
    // Early frame is always capped at 0.5s even for long clips.
    expect(defaultFrameTimes(100)).toEqual([0.5, 50]);
  });

  it('always uses a fixed 0.5s early frame in the two-frame branch', () => {
    // In the dur>2 branch dur/4 is always > 0.5, so the early frame is 0.5s.
    expect(defaultFrameTimes(2.01)).toEqual([0.5, 1.005]);
    expect(defaultFrameTimes(3)).toEqual([0.5, 1.5]);
  });

  it('falls back to a single t=0 frame for very short clips', () => {
    expect(defaultFrameTimes(2)).toEqual([0]);
    expect(defaultFrameTimes(1)).toEqual([0]);
    expect(defaultFrameTimes(0)).toEqual([0]);
  });

  it('treats a non-finite or negative duration as a single t=0 frame (never NaN times)', () => {
    expect(defaultFrameTimes(NaN)).toEqual([0]);
    expect(defaultFrameTimes(Infinity)).toEqual([0]);
    expect(defaultFrameTimes(-5)).toEqual([0]);
  });
});

describe('sampleVideoFrames — readiness guard', () => {
  it('returns null (never throws) when the video is missing or not ready', async () => {
    expect(await sampleVideoFrames(null)).toBeNull();
    // readyState < 2 → not enough data buffered to draw a frame.
    expect(await sampleVideoFrames({ readyState: 1, videoWidth: 720 } as unknown as HTMLVideoElement)).toBeNull();
    // No decoded dimensions yet.
    expect(await sampleVideoFrames({ readyState: 4, videoWidth: 0 } as unknown as HTMLVideoElement)).toBeNull();
  });
});
