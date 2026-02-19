// Tokyo Night inspired palette
export const colors = {
  bg:           "#1a1b26",
  bgDark:       "#16161e",
  bgHighlight:  "#292e42",
  bgModal:      "#24283b",

  fg:           "#c0caf5",
  fgDim:        "#565f89",
  fgBright:     "#e0e6ff",

  accent:       "#7aa2f7",
  accentAlt:    "#bb9af7",

  green:        "#9ece6a",
  yellow:       "#e0af68",
  red:          "#f7768e",
  orange:       "#ff9e64",
  cyan:         "#7dcfff",

  border:       "#3b4261",
  borderFocus:  "#7aa2f7",

  priority: {
    urgent:  "#f7768e",
    high:    "#ff9e64",
    medium:  "#e0af68",
    low:     "#7dcfff",
    none:    "#565f89",
  },

  status: {
    todo:        "#565f89",
    in_progress: "#e0af68",
    done:        "#9ece6a",
    archived:    "#3b4261",
  },
} as const;
