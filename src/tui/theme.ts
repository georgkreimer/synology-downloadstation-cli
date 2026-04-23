export const theme = {
  banner: "#8be9fd",
  header: "#cdd6f4",
  tableHeader: "#88c0d0",
  muted: "#999999",

  row: {
    bg: "#1B1D2A",
    selectedBg: "#2F3C51",
    selectedFg: "#E7F6F2",
    indicator: "#4ee1c1",
    title: "#8be9fd",
    progress: "#ffd369",
    speed: "#a6e3a1",
    size: "#f1fa8c",
    destination: "#89b4fa",
  },

  status: {
    downloading: "#4ee1c1",
    paused: "#ffb86c",
    finished: "#a6e3a1",
    seeding: "#84ffff",
    error: "#ff5555",
    default: "#cdd6f4",
  },

  progressBar: {
    fill: "#ffd369",
    track: "#44475a",
  },

  scrollbar: {
    thumb: "#6272a4",
    track: "#282a36",
  },

  detail: "#b4befe",
  emptyState: "#6272a4",
} as const
