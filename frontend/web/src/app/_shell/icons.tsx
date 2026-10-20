// Line icons for the menu, drawn on a 24px grid like the app's.
const PATHS = {
  home: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10",
  megaphone: "M3 10v4h3l6 4V6L6 10H3Zm13-2a5 5 0 0 1 0 8",
  plus: "M12 5v14M5 12h14",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  wallet: "M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0 13-4v4M17 14h.01",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4a2 2 0 0 0 4 0",
  at: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm0 0v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1",
  link: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z",
  alert: "M12 4 2 20h20L12 4Zm0 6v4m0 3h.01",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 9v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  check: "M4 12l5 5L20 6",
  card: "M3 6h18v12H3zM3 10h18",
  menu: "M4 6h16M4 12h16M4 18h16",
  logout: "M15 4h4v16h-4M10 16l-4-4 4-4M6 12h11",
  live: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8",
  toggle: "M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7Zm8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  photo: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
