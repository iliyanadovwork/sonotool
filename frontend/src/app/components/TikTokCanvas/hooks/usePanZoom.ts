'use client';

import { useEffect } from 'react';
import type { RefObject, MutableRefObject } from 'react';

interface UsePanZoomParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoScaleRef: MutableRefObject<number>;
  setVideoScale: (s: number) => void;
}

export function usePanZoom({ canvasRef, videoScaleRef, setVideoScale }: UsePanZoomParams) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const newScale = Math.max(0.5, Math.min(3, videoScaleRef.current * (1 + (-e.deltaY) * 0.01)));
        videoScaleRef.current = newScale;
        setVideoScale(newScale);
      }
    }

    let initialDistance = 0;
    let initialScale = 1;

    function getTouchDistance(touches: TouchList): number {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        initialDistance = getTouchDistance(e.touches);
        initialScale = videoScaleRef.current;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && initialDistance > 0) {
        e.preventDefault();
        const newScale = Math.max(0.5, Math.min(3, initialScale * (getTouchDistance(e.touches) / initialDistance)));
        videoScaleRef.current = newScale;
        setVideoScale(newScale);
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) initialDistance = 0;
    }

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, []);
}
