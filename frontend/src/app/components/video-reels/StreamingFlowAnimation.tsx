/**
 * StreamingFlowAnimation
 *
 * Self-contained SVG animation: four streaming-service logos with pulsing
 * lines and travelling dots converging on a single point.
 *
 * Pure SVG + SMIL. No JS, no dependencies, no Tailwind, no CSS vars.
 * Drop in anywhere. Default width is 560px; pass `width` to scale.
 */

type Props = {
  width?: number;
  lineColor?: string;
  pulseColor?: string;
  dotColor?: string;
  logoBackgroundColor?: string;
};

export function StreamingFlowAnimation({
  width = 560,
  lineColor = '#27272a',
  pulseColor = '#ffffff',
  dotColor = '#ffffff',
  logoBackgroundColor = '#27272a',
}: Props) {
  const scale = width / 560;

  return (
    <div style={{ width, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      {/* Four streaming-service logo circles */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: `0 ${16 * scale}px`,
          height: 64 * scale,
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        {/* Spotify */}
        <div
          style={{
            width: 64 * scale,
            height: 64 * scale,
            borderRadius: '50%',
            backgroundColor: logoBackgroundColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg viewBox="0 0 24 24" width={36 * scale} height={36 * scale} fill="white">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
        </div>

        {/* Apple Music */}
        <div
          style={{
            width: 64 * scale,
            height: 64 * scale,
            borderRadius: '50%',
            backgroundColor: logoBackgroundColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg viewBox="0 0 24 24" width={32 * scale} height={32 * scale} fill="white">
            <path d="M23.994 6.124a9.23 9.23 0 0 0-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 0 0-1.877-.726 10.496 10.496 0 0 0-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408a10.61 10.61 0 0 0-.1 1.18c0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03a12.5 12.5 0 0 0 1.57-.1c.822-.106 1.596-.35 2.296-.81a5.046 5.046 0 0 0 1.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.045-1.773-.6-1.943-1.536a1.88 1.88 0 0 1 1.038-2.022c.323-.16.67-.25 1.018-.324.378-.082.758-.153 1.134-.24.274-.063.457-.23.51-.516a.904.904 0 0 0 .02-.193c0-1.815 0-3.63-.002-5.443a.725.725 0 0 0-.026-.185c-.04-.15-.15-.243-.304-.234-.16.01-.318.035-.475.066l-5.597 1.09c-.306.06-.43.197-.437.516v7.37c0 .38-.05.753-.203 1.103-.28.64-.77 1.04-1.434 1.233-.365.106-.742.16-1.123.18-.96.05-1.79-.593-1.96-1.53a1.88 1.88 0 0 1 1.048-2.025c.355-.177.735-.267 1.117-.344.27-.055.54-.102.808-.16.39-.084.594-.292.615-.696.004-.08 0-.16 0-.24V5.992c0-.564.15-.915.57-1.04 1.914-.568 3.83-1.132 5.744-1.697.582-.172 1.164-.345 1.746-.516.47-.14.69-.01.69.478v5.896z" />
          </svg>
        </div>

        {/* TIDAL */}
        <div
          style={{
            width: 64 * scale,
            height: 64 * scale,
            borderRadius: '50%',
            backgroundColor: logoBackgroundColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg viewBox="0 0 24 24" width={32 * scale} height={32 * scale} fill="white">
            <path d="M18.81 4.16v3.03h5.16V4.16h-5.16zm0 4.54v3.03h5.16V8.7h-5.16zm0 4.54v3.03h5.16v-3.03h-5.16zM12.63 4.16v3.03h5.16V4.16h-5.16zm0 4.54v3.03h5.16V8.7h-5.16zm0 4.54v3.03h5.16v-3.03h-5.16zm0 4.54v3.03h5.16v-3.03h-5.16zM6.45 8.7v3.03h5.16V8.7H6.45zm0 4.54v3.03h5.16v-3.03H6.45zm0 4.54v3.03h5.16v-3.03H6.45zM.27 13.24v3.03h5.16v-3.03H.27zm0 4.54v3.03h5.16v-3.03H.27z" />
          </svg>
        </div>

        {/* YouTube */}
        <div
          style={{
            width: 64 * scale,
            height: 64 * scale,
            borderRadius: '50%',
            backgroundColor: logoBackgroundColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg viewBox="0 0 24 24" width={32 * scale} height={32 * scale} fill="white">
            <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 19.104c-3.924 0-7.104-3.18-7.104-7.104S8.076 4.896 12 4.896s7.104 3.18 7.104 7.104-3.18 7.104-7.104 7.104zm0-13.332c-3.432 0-6.228 2.796-6.228 6.228S8.568 18.228 12 18.228s6.228-2.796 6.228-6.228S15.432 5.772 12 5.772zM9.684 15.54V8.46L15.816 12l-6.132 3.54z" />
          </svg>
        </div>
      </div>

      {/* Lines + travelling dots */}
      <svg
        width={width}
        height={258 * scale}
        viewBox="0 0 560 258"
        style={{ overflow: 'visible' }}
      >
        <defs>
          <path id="sfa-lpath1" d="M 48 0 L 48 140 L 280 200 L 280 258" />
          <path id="sfa-lpath2" d="M 203 0 L 203 140 L 280 200 L 280 258" />
          <path id="sfa-lpath3" d="M 357 0 L 357 140 L 280 200 L 280 258" />
          <path id="sfa-lpath4" d="M 512 0 L 512 140 L 280 200 L 280 258" />
        </defs>

        {/* Static vertical feeder lines */}
        <line x1="48" y1="0" x2="48" y2="140" stroke={lineColor} strokeWidth="2" />
        <line x1="203" y1="0" x2="203" y2="140" stroke={lineColor} strokeWidth="2" />
        <line x1="357" y1="0" x2="357" y2="140" stroke={lineColor} strokeWidth="2" />
        <line x1="512" y1="0" x2="512" y2="140" stroke={lineColor} strokeWidth="2" />

        {/* Pulsing white overlay on vertical lines */}
        <line x1="48" y1="0" x2="48" y2="140" stroke={pulseColor} strokeWidth="2" opacity="0">
          <animate attributeName="opacity" values="0;0.2;0" dur="3s" repeatCount="indefinite" />
        </line>
        <line x1="203" y1="0" x2="203" y2="140" stroke={pulseColor} strokeWidth="2" opacity="0">
          <animate attributeName="opacity" values="0;0.2;0" dur="3s" repeatCount="indefinite" begin="0.75s" />
        </line>
        <line x1="357" y1="0" x2="357" y2="140" stroke={pulseColor} strokeWidth="2" opacity="0">
          <animate attributeName="opacity" values="0;0.2;0" dur="3s" repeatCount="indefinite" begin="1.5s" />
        </line>
        <line x1="512" y1="0" x2="512" y2="140" stroke={pulseColor} strokeWidth="2" opacity="0">
          <animate attributeName="opacity" values="0;0.2;0" dur="3s" repeatCount="indefinite" begin="2.25s" />
        </line>

        {/* Static diagonal merge lines */}
        <line x1="48" y1="140" x2="280" y2="200" stroke={lineColor} strokeWidth="2" />
        <line x1="203" y1="140" x2="280" y2="200" stroke={lineColor} strokeWidth="2" />
        <line x1="357" y1="140" x2="280" y2="200" stroke={lineColor} strokeWidth="2" />
        <line x1="512" y1="140" x2="280" y2="200" stroke={lineColor} strokeWidth="2" />

        {/* Pulsing white overlay on diagonal lines */}
        <line x1="48" y1="140" x2="280" y2="200" stroke={pulseColor} strokeWidth="2" opacity="0">
          <animate attributeName="opacity" values="0;0.2;0" dur="3s" repeatCount="indefinite" />
        </line>
        <line x1="203" y1="140" x2="280" y2="200" stroke={pulseColor} strokeWidth="2" opacity="0">
          <animate attributeName="opacity" values="0;0.2;0" dur="3s" repeatCount="indefinite" begin="0.75s" />
        </line>
        <line x1="357" y1="140" x2="280" y2="200" stroke={pulseColor} strokeWidth="2" opacity="0">
          <animate attributeName="opacity" values="0;0.2;0" dur="3s" repeatCount="indefinite" begin="1.5s" />
        </line>
        <line x1="512" y1="140" x2="280" y2="200" stroke={pulseColor} strokeWidth="2" opacity="0">
          <animate attributeName="opacity" values="0;0.2;0" dur="3s" repeatCount="indefinite" begin="2.25s" />
        </line>

        {/* Trunk line */}
        <line x1="280" y1="200" x2="280" y2="258" stroke={lineColor} strokeWidth="2" />
        <line x1="280" y1="200" x2="280" y2="258" stroke={pulseColor} strokeWidth="2" opacity="0">
          <animate attributeName="opacity" values="0;0.2;0" dur="3s" repeatCount="indefinite" />
        </line>

        {/* Travelling dots — two per path, staggered */}
        <circle r="2.5" fill={dotColor} opacity="0">
          <animateMotion dur="4s" repeatCount="indefinite">
            <mpath href="#sfa-lpath1" />
          </animateMotion>
          <animate attributeName="opacity" values="0.3;0.9;0.9;0.3" dur="4s" repeatCount="indefinite" />
          <animate attributeName="r" values="2;2.5;2.5;2" dur="4s" repeatCount="indefinite" />
        </circle>
        <circle r="2.5" fill={dotColor} opacity="0">
          <animateMotion dur="4s" repeatCount="indefinite" begin="2s">
            <mpath href="#sfa-lpath1" />
          </animateMotion>
          <animate attributeName="opacity" values="0.3;0.9;0.9;0.3" dur="4s" repeatCount="indefinite" begin="2s" />
          <animate attributeName="r" values="2;2.5;2.5;2" dur="4s" repeatCount="indefinite" begin="2s" />
        </circle>

        <circle r="2.5" fill={dotColor} opacity="0">
          <animateMotion dur="4s" repeatCount="indefinite" begin="0.5s">
            <mpath href="#sfa-lpath2" />
          </animateMotion>
          <animate attributeName="opacity" values="0.3;0.9;0.9;0.3" dur="4s" repeatCount="indefinite" begin="0.5s" />
          <animate attributeName="r" values="2;2.5;2.5;2" dur="4s" repeatCount="indefinite" begin="0.5s" />
        </circle>
        <circle r="2.5" fill={dotColor} opacity="0">
          <animateMotion dur="4s" repeatCount="indefinite" begin="2.5s">
            <mpath href="#sfa-lpath2" />
          </animateMotion>
          <animate attributeName="opacity" values="0.3;0.9;0.9;0.3" dur="4s" repeatCount="indefinite" begin="2.5s" />
          <animate attributeName="r" values="2;2.5;2.5;2" dur="4s" repeatCount="indefinite" begin="2.5s" />
        </circle>

        <circle r="2.5" fill={dotColor} opacity="0">
          <animateMotion dur="4s" repeatCount="indefinite" begin="1s">
            <mpath href="#sfa-lpath3" />
          </animateMotion>
          <animate attributeName="opacity" values="0.3;0.9;0.9;0.3" dur="4s" repeatCount="indefinite" begin="1s" />
          <animate attributeName="r" values="2;2.5;2.5;2" dur="4s" repeatCount="indefinite" begin="1s" />
        </circle>
        <circle r="2.5" fill={dotColor} opacity="0">
          <animateMotion dur="4s" repeatCount="indefinite" begin="3s">
            <mpath href="#sfa-lpath3" />
          </animateMotion>
          <animate attributeName="opacity" values="0.3;0.9;0.9;0.3" dur="4s" repeatCount="indefinite" begin="3s" />
          <animate attributeName="r" values="2;2.5;2.5;2" dur="4s" repeatCount="indefinite" begin="3s" />
        </circle>

        <circle r="2.5" fill={dotColor} opacity="0">
          <animateMotion dur="4s" repeatCount="indefinite" begin="1.5s">
            <mpath href="#sfa-lpath4" />
          </animateMotion>
          <animate attributeName="opacity" values="0.3;0.9;0.9;0.3" dur="4s" repeatCount="indefinite" begin="1.5s" />
          <animate attributeName="r" values="2;2.5;2.5;2" dur="4s" repeatCount="indefinite" begin="1.5s" />
        </circle>
        <circle r="2.5" fill={dotColor} opacity="0">
          <animateMotion dur="4s" repeatCount="indefinite" begin="3.5s">
            <mpath href="#sfa-lpath4" />
          </animateMotion>
          <animate attributeName="opacity" values="0.3;0.9;0.9;0.3" dur="4s" repeatCount="indefinite" begin="3.5s" />
          <animate attributeName="r" values="2;2.5;2.5;2" dur="4s" repeatCount="indefinite" begin="3.5s" />
        </circle>
      </svg>
    </div>
  );
}
