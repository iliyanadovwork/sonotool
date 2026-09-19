import type { VideoEntry, VideoMode, SlideType } from '../app/types';

export function makeEmptyEntry(id: string, mode: VideoMode = 'twitter', carouselSlideType?: SlideType): VideoEntry {
  return {
    id, url: '', caption: '',
    mode,
    data: null, loading: false, error: '', videoFailed: false,
    ...(carouselSlideType ? { carouselSlideType } : {}),
  };
}
