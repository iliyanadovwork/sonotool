/** Navigation sections in the sidebar */
export type AppSection = 'template-editor' | 'posts' | 'branding' | 'chart-reels' | 'video-reels' | 'account';

export type SlideType = 'main' | 'supporting_1' | 'supporting_2';

export interface BrandLogo {
  id: string;
  url: string;
  label?: string;
  position: number;
}

export interface BrandFont {
  id: string;
  label: string;   // family name shown in the font picker
  url: string;     // public URL of the uploaded font file
}

/** Brand-kit data passed to canvas templates */
export interface BrandProps {
  logoSrc: string;
  logos: BrandLogo[];
  fonts: BrandFont[];
  displayName: string;
  handle: string;
}

export interface Author {
  uniqueId: string;
  nickname: string;
  avatarThumb: string;
}

export interface VideoData {
  id: string;
  title: string;
  cover: string;
  author: Author;
  play: string;
  wmplay: string;
  hdplay: string;
  duration: number;
  size: number;
  images?: string[];
}

export type VideoMode = 'twitter' | 'caption' | 'carousel';

export interface VideoEntry {
  id: string;
  url: string;
  caption: string;
  mode: VideoMode;
  data: VideoData | null;
  loading: boolean;
  error: string;
  videoFailed: boolean;
  // local video upload (twitter/caption templates)
  localVideoSrc?: string;
  localVideoName?: string;
  // carousel-specific
  imageSrc?: string;
  headline?: string;
  subheadline?: string;
  carouselSubMode?: 'image' | 'video';
  carouselSlideType?: SlideType;
}
