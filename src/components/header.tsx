import { colors } from "../theme/colors.ts";
import { getThemeName } from "../theme/colors.ts";

export type View = "list" | "board" | "calendar" | "dashboard" | "help";

interface HeaderProps {
  activeView: View;
  onViewChange: (view: View) => void;
  agentActive?: boolean;
  timerActive?: boolean;
}

export function Header({ activeView, onViewChange, agentActive = false, timerActive = false }: HeaderProps) {
  const tabs: { key: string; label: string; view: View }[] = [
    { key: "1", label: "List", view: "list" },
    { key: "2", label: "Board", view: "board" },
    { key: "3", label: "Cal", view: "calendar" },
    { key: "4", label: "Stats", view: "dashboard" },
  ];

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={colors.bgDark}
    >
      <text
        content="  tsk  "
        fg={colors.accent}
        attributes={1} // BOLD
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
