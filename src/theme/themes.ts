import type { ThemeName } from "../config/config.ts";

export interface ThemeColors {
  bg: string;
  bgDark: string;
  bgHighlight: string;
  bgModal: string;
  fg: string;
  fgDim: string;
  fgBright: string;
  accent: string;
  accentAlt: string;
  green: string;
  yellow: string;
  red: string;
  orange: string;
  cyan: string;
  border: string;
  borderFocus: string;
  priority: {
    urgent: string;
    high: string;
    medium: string;
    low: string;
    none: string;
  };
  status: {
    todo: string;
    in_progress: string;
    done: string;
    archived: string;
  };
}

const tokyoNight: ThemeColors = {
  bg: "#1a1b26",
  bgDark: "#16161e",
  bgHighlight: "#292e42",
  bgModal: "#24283b",
  fg: "#c0caf5",
  fgDim: "#565f89",
  fgBright: "#e0e6ff",
  accent: "#7aa2f7",
  accentAlt: "#bb9af7",
  green: "#9ece6a",
  yellow: "#e0af68",
  red: "#f7768e",
  orange: "#ff9e64",
  cyan: "#7dcfff",
  border: "#3b4261",
  borderFocus: "#7aa2f7",
  priority: { urgent: "#f7768e", high: "#ff9e64", medium: "#e0af68", low: "#7dcfff", none: "#565f89" },
  status: { todo: "#565f89", in_progress: "#e0af68", done: "#9ece6a", archived: "#3b4261" },
};

const catppuccin: ThemeColors = {
  bg: "#1e1e2e",
  bgDark: "#181825",
  bgHighlight: "#313244",
  bgModal: "#1e1e2e",
  fg: "#cdd6f4",
  fgDim: "#6c7086",
  fgBright: "#f5f5f5",
  accent: "#89b4fa",
  accentAlt: "#cba6f7",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  red: "#f38ba8",
  orange: "#fab387",
  cyan: "#89dceb",
  border: "#45475a",
  borderFocus: "#89b4fa",
  priority: { urgent: "#f38ba8", high: "#fab387", medium: "#f9e2af", low: "#89dceb", none: "#6c7086" },
  status: { todo: "#6c7086", in_progress: "#f9e2af", done: "#a6e3a1", archived: "#45475a" },
};

const gruvbox: ThemeColors = {
  bg: "#282828",
  bgDark: "#1d2021",
  bgHighlight: "#3c3836",
  bgModal: "#282828",
  fg: "#ebdbb2",
  fgDim: "#928374",
  fgBright: "#fbf1c7",
  accent: "#83a598",
  accentAlt: "#d3869b",
  green: "#b8bb26",
  yellow: "#fabd2f",
  red: "#fb4934",
  orange: "#fe8019",
  cyan: "#8ec07c",
  border: "#504945",
  borderFocus: "#83a598",
  priority: { urgent: "#fb4934", high: "#fe8019", medium: "#fabd2f", low: "#83a598", none: "#928374" },
  status: { todo: "#928374", in_progress: "#fabd2f", done: "#b8bb26", archived: "#504945" },
};

const nord: ThemeColors = {
  bg: "#2e3440",
  bgDark: "#242933",
  bgHighlight: "#3b4252",
  bgModal: "#2e3440",
  fg: "#d8dee9",
  fgDim: "#4c566a",
  fgBright: "#eceff4",
  accent: "#88c0d0",
  accentAlt: "#b48ead",
  green: "#a3be8c",
  yellow: "#ebcb8b",
  red: "#bf616a",
  orange: "#d08770",
  cyan: "#8fbcbb",
  border: "#434c5e",
  borderFocus: "#88c0d0",
  priority: { urgent: "#bf616a", high: "#d08770", medium: "#ebcb8b", low: "#88c0d0", none: "#4c566a" },
  status: { todo: "#4c566a", in_progress: "#ebcb8b", done: "#a3be8c", archived: "#434c5e" },
};

const dracula: ThemeColors = {
  bg: "#282a36",
  bgDark: "#21222c",
  bgHighlight: "#44475a",
  bgModal: "#282a36",
  fg: "#f8f8f2",
  fgDim: "#6272a4",
  fgBright: "#ffffff",
  accent: "#8be9fd",
  accentAlt: "#bd93f9",
  green: "#50fa7b",
  yellow: "#f1fa8c",
  red: "#ff5555",
  orange: "#ffb86c",
  cyan: "#8be9fd",
  border: "#44475a",
  borderFocus: "#bd93f9",
  priority: { urgent: "#ff5555", high: "#ffb86c", medium: "#f1fa8c", low: "#8be9fd", none: "#6272a4" },
  status: { todo: "#6272a4", in_progress: "#f1fa8c", done: "#50fa7b", archived: "#44475a" },
};

const solarizedDark: ThemeColors = {
  bg: "#002b36",
  bgDark: "#001f27",
  bgHighlight: "#073642",
  bgModal: "#002b36",
  fg: "#839496",
  fgDim: "#586e75",
  fgBright: "#fdf6e3",
  accent: "#268bd2",
  accentAlt: "#6c71c4",
  green: "#859900",
  yellow: "#b58900",
  red: "#dc322f",
  orange: "#cb4b16",
  cyan: "#2aa198",
  border: "#073642",
  borderFocus: "#268bd2",
  priority: { urgent: "#dc322f", high: "#cb4b16", medium: "#b58900", low: "#268bd2", none: "#586e75" },
  status: { todo: "#586e75", in_progress: "#b58900", done: "#859900", archived: "#073642" },
};

export const THEMES: Record<ThemeName, ThemeColors> = {
  "tokyo-night": tokyoNight,
  catppuccin,
  gruvbox,
  nord,
  dracula,
  "solarized-dark": solarizedDark,
};

export const THEME_NAMES: ThemeName[] = [
  "tokyo-night", "catppuccin", "gruvbox", "nord", "dracula", "solarized-dark",
];

export const MONOCHROME_THEME: ThemeColors = {
  bg: "black",
  bgDark: "black",
  bgHighlight: "gray",
  bgModal: "black",
  fg: "white",
  fgDim: "gray",
  fgBright: "white",
  accent: "white",
  accentAlt: "white",
  green: "white",
  yellow: "white",
  red: "white",
  orange: "white",
  cyan: "white",
  border: "gray",
  borderFocus: "white",
  priority: { urgent: "white", high: "white", medium: "white", low: "white", none: "gray" },
  status: { todo: "gray", in_progress: "white", done: "white", archived: "gray" },
};
