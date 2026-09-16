import React from 'react'

const PATHS = {
  save: (
    <>
      <path d="M4.25 5.75A1.5 1.5 0 0 1 5.75 4.25h6.6l3.4 3.4v6.6a1.5 1.5 0 0 1-1.5 1.5H5.75a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M7.5 4.25v3.25h5V4.25" />
      <path d="M7.5 15.75v-4h5v4" />
    </>
  ),
  folder: (
    <>
      <path d="M3.25 6.25a1.5 1.5 0 0 1 1.5-1.5h2.9l1.6 1.8h6a1.5 1.5 0 0 1 1.5 1.5v5.7a1.5 1.5 0 0 1-1.5 1.5H4.75a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M3.25 8.75h13.5" />
    </>
  ),
  play: <path d="M7 4.9 15.1 10 7 15.1z" />,
  stop: <rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.5" />,
  next: (
    <>
      <path d="M6.25 5.25 13 10l-6.75 4.75z" />
      <path d="M14.75 5.25v9.5" />
    </>
  ),
  pause: (
    <>
      <path d="M7.5 5.25v9.5" />
      <path d="M12.5 5.25v9.5" />
    </>
  ),
  cue: (
    <>
      <path d="M10 3.75v7.75" />
      <path d="M6.75 8.25 10 11.5l3.25-3.25" />
      <path d="M5.25 15.5h9.5" />
    </>
  ),
  loop: (
    <>
      <path d="M5.25 9.5v-.75A2.75 2.75 0 0 1 8 6h6.5" />
      <path d="M12.5 4 14.75 6l-2.25 2" />
      <path d="M14.75 10.5v.75A2.75 2.75 0 0 1 12 14H5.5" />
      <path d="M7.5 12 5.25 14l2.25 2" />
    </>
  ),
  trash: (
    <>
      <path d="M4.75 6.25h10.5" />
      <path d="M8.25 6.25V4.75h3.5v1.5" />
      <path d="M6.4 6.25 7.1 14.6a1.2 1.2 0 0 0 1.2 1.15h3.4a1.2 1.2 0 0 0 1.2-1.15l.7-8.35" />
    </>
  ),
  plus: (
    <>
      <path d="M10 4.75v10.5" />
      <path d="M4.75 10h10.5" />
    </>
  ),
  note: (
    <>
      <path d="M5 4.5a.75.75 0 0 1 .75-.75h5.5l3.75 3.75v8a.75.75 0 0 1-.75.75H5.75a.75.75 0 0 1-.75-.75z" />
      <path d="M11.25 3.75V7.5h3.75" />
      <path d="M7.5 10.25h5" />
      <path d="M7.5 13h3.25" />
    </>
  ),
  monitor: (
    <>
      <rect x="3.25" y="4.25" width="13.5" height="9" rx="1.25" />
      <path d="M7.25 16.25h5.5" />
      <path d="M10 13.25v3" />
    </>
  ),
  network: (
    <>
      <circle cx="10" cy="10" r="6.25" />
      <path d="M3.75 10h12.5" />
      <path d="M10 3.75c1.9 2.05 2.9 4.05 2.9 6.25s-1 4.2-2.9 6.25c-1.9-2.05-2.9-4.05-2.9-6.25s1-4.2 2.9-6.25z" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 3.25v1.75" />
      <path d="M10 15v1.75" />
      <path d="M16.75 10H15" />
      <path d="M5 10H3.25" />
      <path d="M14.77 5.23 13.53 6.47" />
      <path d="M6.47 13.53 5.23 14.77" />
      <path d="M14.77 14.77 13.53 13.53" />
      <path d="M6.47 6.47 5.23 5.23" />
    </>
  ),
  close: (
    <>
      <path d="M5.5 5.5 14.5 14.5" />
      <path d="M14.5 5.5 5.5 14.5" />
    </>
  ),
  check: <path d="M4.75 10.5 8.25 14l7-8" />,
  alert: (
    <>
      <path d="M10 4.25 16.5 15.5a.75.75 0 0 1-.65 1.1H4.15a.75.75 0 0 1-.65-1.1z" />
      <path d="M10 8.5v3.25" />
      <path d="M10 14v.01" />
    </>
  ),
  download: (
    <>
      <path d="M10 3.75v8.5" />
      <path d="M6.5 8.75 10 12.25l3.5-3.5" />
      <path d="M4.25 15.75h11.5" />
    </>
  ),
  'chevron-down': <path d="M6.25 8.25 10 12l3.75-3.75" />,
  'chevron-up': <path d="M6.25 11.75 10 8l3.75 3.75" />,
  grip: (
    <>
      <path d="M7.75 5.5v.01" />
      <path d="M12.25 5.5v.01" />
      <path d="M7.75 10v.01" />
      <path d="M12.25 10v.01" />
      <path d="M7.75 14.5v.01" />
      <path d="M12.25 14.5v.01" />
    </>
  ),
  obs: (
    <>
      <path d="M10 3.75 3.75 7 10 10.25 16.25 7z" />
      <path d="M3.75 12.5 10 15.75l6.25-3.25" />
    </>
  ),
  image: (
    <>
      <rect x="3.75" y="4.75" width="12.5" height="10.5" rx="1.25" />
      <path d="M4.25 13.5 8 10l2.75 2.5 2.25-2 2.75 2.5" />
      <circle cx="7.5" cy="8.25" r="1" />
    </>
  ),
  video: (
    <>
      <rect x="3.75" y="5" width="8.5" height="10" rx="1.75" />
      <path d="M12.25 9.25 16.25 6.75v6.5l-4-2.5z" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="6.25" />
      <path d="M10 6.25V10l2.5 1.75" />
    </>
  ),
  volume: (
    <>
      <path d="M4.25 8h2.5L10 5.25v9.5L6.75 12h-2.5z" />
      <path d="M12.5 8.25a2.75 2.75 0 0 1 0 3.5" />
      <path d="M14.4 6.5a5.25 5.25 0 0 1 0 7" />
    </>
  ),
  refresh: (
    <>
      <path d="M4.75 10a5.25 5.25 0 0 1 9-3.7" />
      <path d="M14.5 3.5v3h-3" />
      <path d="M15.25 10a5.25 5.25 0 0 1-9 3.7" />
      <path d="M5.5 16.5v-3h3" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="6.25" />
      <path d="M10 9.25v4" />
      <path d="M10 6.75v.01" />
    </>
  ),
  lock: (
    <>
      <rect x="4.75" y="8.75" width="10.5" height="7" rx="1.5" />
      <path d="M7.25 8.75V7a2.75 2.75 0 0 1 5.5 0v1.75" />
    </>
  ),
  copy: (
    <>
      <rect x="7.25" y="7.25" width="8.5" height="8.5" rx="1.5" />
      <path d="M12.75 4.25H5.75a1.5 1.5 0 0 0-1.5 1.5v7" />
    </>
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="4.75" />
      <path d="M12.5 12.5 16.25 16.25" />
    </>
  )
}

const baseStyle = { display: 'block', flexShrink: 0 }

const Icon = ({ name, size = 16, style }) => {
  const path = PATHS[name]
  if (!path) return null

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style ? { display: 'block', flexShrink: 0, ...style } : baseStyle}
    >
      {path}
    </svg>
  )
}

export default Icon
