// Viewzo mark: the segmented "status" ring around the V. Same drawing as icon.svg.
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="viewzo-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B74FF" />
          <stop offset="1" stopColor="#FF6B6B" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#16151D" />
      <circle
        cx="32"
        cy="32"
        r="21"
        fill="none"
        stroke="url(#viewzo-ring)"
        strokeWidth="4.5"
        strokeDasharray="22.4 4"
        strokeLinecap="round"
        transform="rotate(-80 32 32)"
      />
      <path
        d="M23 25 32 41 41 25"
        fill="none"
        stroke="#fff"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
