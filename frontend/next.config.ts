import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The Instagram/TikTok scrapers are native CommonJS packages with dynamic require()s
  // (e.g. ruhend-scraper → cheerio). Webpack can't analyze those — it emits a "Critical
  // dependency: the request of a dependency is an expression" warning and they fail at
  // runtime with "Cannot find module 'cheerio'". Mark them external so Next requires them
  // natively from node_modules at runtime instead of bundling them.
  // @ffmpeg-installer/ffmpeg picks its platform binary with a runtime dynamic
  // require (`require('@ffmpeg-installer/<platform>/package.json')`); webpack
  // rewrites __dirname and that require fails ("Cannot find module …/darwin-arm64/
  // package.json"). fluent-ffmpeg has similar dynamic requires. Keep both external.
  serverExternalPackages: [
    'ruhend-scraper', 'cheerio', 'btch-downloader', 'instagram-url-direct',
    '@ffmpeg-installer/ffmpeg', 'fluent-ffmpeg',
  ],
  // The background-removal model (transformers.js → onnxruntime-node, ~355 MB) is CLIENT-ONLY, but
  // Next's serverless file-tracing would otherwise bundle it into the page function, blowing Vercel's
  // 250 MB limit. No server route uses these, so exclude them from all server traces.
  outputFileTracingExcludes: {
    '*': [
      'node_modules/onnxruntime-node/**',
      'node_modules/@huggingface/transformers/**',
    ],
  },
  // transformers.js (background removal) references Node-only deps that must not be pulled into the
  // browser bundle. dev runs with --webpack, so this alias applies (build is webpack by default too).
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = { ...config.resolve.alias, sharp$: false, 'onnxruntime-node$': false };
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy',   value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.tikwm.com' },
      { protocol: 'https', hostname: '**.tiktokcdn.com' },
      { protocol: 'https', hostname: '**.tiktokv.com' },
      { protocol: 'https', hostname: '**.tiktokcdn-us.com' },
    ],
  },
};

export default nextConfig;
