export const theme = {
  banner: "#89b4fa",
  muted: "#6c7086",
  border: "#313244",

  row: {
    selectedBg: "#313244",
    selectedFg: "#cdd6f4",
    indicator: "#89b4fa",
    title: "#cdd6f4",
    progress: "#f9e2af",
    speed: "#a6e3a1",
    size: "#9399b2",
  },

  status: {
    downloading: "#89b4fa",
    paused: "#fab387",
    finished: "#a6e3a1",
    seeding: "#94e2d5",
    error: "#f38ba8",
    default: "#cdd6f4",
  },

  progress: {
    filledFg: "#1e1e2e",
    filledBg: "#89b4fa",
    trackFg: "#6c7086",
    trackBg: "#181825",
  },

  scrollbar: {
    thumb: "#45475a",
    track: "#181825",
  },

  keyhint: {
    key: "#89b4fa",
    label: "#585b70",
  },

  detail: "#b4befe",
  emptyState: "#45475a",
} as const
