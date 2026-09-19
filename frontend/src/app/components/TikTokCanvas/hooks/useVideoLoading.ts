'use client';

import { useState, useEffect, useRef } from 'react';
import type { RefObject, MutableRefObject } from 'react';
import { CANVAS_W, CANVAS_H, VIDEO_TARGET_W, BASE_HEADER_HEIGHT } from '../constants';
import type { Box } from '../types';

// A src that isn't a fully-formed proxy URL never starts a load, so it can never be "loading"
function isLoadableVideoSrc(src: string): boolean {
  return !!src && src.includes('url=') && !src.endsWith('url=');
}

function calcVideoBox(vw: number, vh: number, currentBrand: string): Box {
  if (currentBrand === 'clean') {
    const scale = CANVAS_W / vw;
    const drawH = vh * scale;
    const y = (CANVAS_H - drawH) / 2;
    return { x: 0, y, w: CANVAS_W, h: drawH };
  }
  const scale = Math.min(VIDEO_TARGET_W / vw, CANVAS_H / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const x = (CANVAS_W - drawW) / 2;
  const y = (CANVAS_H - drawH) / 2;
  return { x, y, w: drawW, h: drawH };
}

interface UseVideoLoadingParams {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoSrc: string;
  brand: string;
  rowNumber: number;
  videoId?: string;
  boxRef: MutableRefObject<Box>;
  setBox: (b: Box) => void;
  videoOffsetRef: MutableRefObject<{ x: number; y: number }>;
  videoScaleRef: MutableRefObject<number>;
  setVideoScale: (s: number) => void;
  onVideoError?: () => void;
}

export function useVideoLoading({
  videoRef, videoSrc, brand, rowNumber, videoId,
  boxRef, setBox, videoOffsetRef, videoScaleRef, setVideoScale, onVideoError,
}: UseVideoLoadingParams) {
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(0);

  // Recalculate box on brand change (for already-loaded video)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const b = calcVideoBox(video.videoWidth, video.videoHeight, brand);
    boxRef.current = b;
    setBox(b);
    videoOffsetRef.current = { x: 0, y: 0 };
    videoScaleRef.current = 1;
    setVideoScale(1);
  }, [brand]);

  // Set box and duration on metadata load
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleLoadedMetadata = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      console.log('[Row ' + (rowNumber + 1) + '] Video loaded successfully:', { videoId, vw, vh });
      if (vw && vh) {
        const b = calcVideoBox(vw, vh, brand);
        boxRef.current = b;
        setBox(b);
        videoOffsetRef.current = { x: 0, y: 0 };
        videoScaleRef.current = 1;
        setVideoScale(1);
      }
      const dur = isFinite(video.duration) ? video.duration : 0;
      setVideoDuration(dur);
      setTrimStart(0);
      setTrimEnd(dur);
      trimStartRef.current = 0;
      trimEndRef.current = dur;
      setCurrentTime(0);
    };
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, [videoSrc, brand]);

  // Derived, not state: an unloadable src is never loading (avoids a setState-in-effect round trip)
  const hasLoadableSrc = isLoadableVideoSrc(videoSrc);

  // Load new video src
  useEffect(() => {
    if (!isLoadableVideoSrc(videoSrc)) {
      return;
    }
    console.log('[Row ' + (rowNumber + 1) + '] Video source changed:', videoId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this effect drives an external system (the <video> element: pause/load/src + listeners); these two lines are the React-side mirror of that imperative load starting, and the trigger is a prop change, so there is no event handler to move them into and no render-time derivation for "a load was just kicked off"
    setVideoError(null);
    setIsVideoLoading(true);

    const video = videoRef.current;
    if (!video) { setIsVideoLoading(false); return; }

    video.pause();
    video.removeAttribute('src');
    video.load();
    video.src = videoSrc;

    const handleLoadedData = () => { if (video.readyState >= 2) setIsVideoLoading(false); };
    const handleError = () => setIsVideoLoading(false);

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('error', handleError);

    const timeoutId = setTimeout(() => {
      if (video.readyState < 2) {
        console.error('[Row ' + (rowNumber + 1) + '] Video timeout:', videoId);
        setVideoError('Video failed to load. The video URL may be invalid.');
        setIsVideoLoading(false);
        onVideoError?.();
      }
    }, 120000);

    return () => {
      clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('error', handleError);
    };
  }, [videoSrc]);

  return {
    isVideoLoading: hasLoadableSrc && isVideoLoading, videoError, setVideoError,
    videoDuration, trimStart, trimEnd, setTrimStart, setTrimEnd,
    currentTime, setCurrentTime, trimStartRef, trimEndRef,
  };
}
