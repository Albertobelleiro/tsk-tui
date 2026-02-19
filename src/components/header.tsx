import { colors } from "../theme/colors.ts";
import { getThemeName } from "../theme/colors.ts";
import type { ExternalSource } from "../store/types.ts";

export type View = "list" | "board" | "calendar" | "dashboard" | "help";

export type SyncStatus = "idle" | "syncing" | "success" | "error";

export interface SyncStatusMap {
  [key: string]: {
    status: SyncStatus;
    lastSync?: string;
    error?: string;
  };
}

interface HeaderProps {
  activeView: View;
  onViewChange: (view: View) => void;
  agentActive?: boolean;
  timerActive?: boolean;
  syncStatus?: SyncStatusMap;
}

export function Header({ activeView, onViewChange, agentActive = false, timerActive = false, syncStatus = {} }: HeaderProps) {
  const tabs: { key: string; label: string; view: View }[] = [
    { key: "1", label: "List", view: "list" },
    { key: "2", label: "Board", view: "board" },
    { key: "3", label: "Cal", view: "calendar" },
    { key: "4", label: "Stats", view: "dashboard" },
  ];

  const getSyncIcon = (status: SyncStatus): string => {
    switch (status) {
      case "syncing": return "⟳";
      case "success": return "✓";
      case "error": return "✗";
      default: return "○";
    }
  };

  const getSyncColor = (status: SyncStatus): string => {
    switch (status) {
      case "syncing": return colors.yellow;
      case "success": return colors.green;
      case "error": return colors.red;
      default: return colors.fgDim;
    }
  };

  const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

  const syncIndicators = Object.entries(syncStatus).map(([provider, info]) => ({
    icon: getSyncIcon(info.status),
    name: capitalize(provider),
    color: getSyncColor(info.status),
  }));

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={colors.bgDark}
    >
      <text
        content="  tsk  "
        fg={colors.accent}
        attributes={1}
      />
      {tabs.map((tab) => {
        const isActive = activeView === tab.view;
        return (
          <text
            key={tab.key}
            content={` [${tab.key}] ${tab.label} `}
            fg={isActive ? colors.accent : colors.fgDim}
            attributes={isActive ? 1 : 0}
          />
        );
      })}
      <box flexGrow={1} />
      {syncIndicators.map((ind) => (
        <text key={ind.name} content={` ${ind.icon} ${ind.name}`} fg={ind.color} />
      ))}
      {timerActive ? (
        <text content=" ⏱ " fg={colors.yellow} />
      ) : null}
      {agentActive ? (
        <text content=" 🤖 Agent " fg={colors.green} />
      ) : null}
      <text
        content=" [?] Help  "
        fg={activeView === "help" ? colors.accent : colors.fgDim}
      />
    </box>
  );
}
