import { useState, useEffect } from "react";
import { colors } from "../theme/colors.ts";

interface StatusBarProps {
  mode: string;
  taskCount: number;
  totalCount?: number;
  statusFilter?: string;
  sortBy?: string;
  searchActive?: boolean;
  message?: string | null;
  undoCount?: number;
  redoCount?: number;
  timerText?: string | null;
  showClock?: boolean;
  visualCount?: number;
}

export function StatusBar({
  mode,
  taskCount,
  totalCount,
  statusFilter = "all",
  sortBy = "priority",
  searchActive = false,
  message = null,
  undoCount = 0,
  redoCount = 0,
  timerText = null,
  showClock = true,
  visualCount = 0,
}: StatusBarProps) {
  const [clock, setClock] = useState(formatClock());

  useEffect(() => {
    if (!showClock) return;
    const timer = setInterval(() => setClock(formatClock()), 60000);
    return () => clearInterval(timer);
  }, [showClock]);

  const total = totalCount ?? taskCount;
  const countStr = taskCount !== total
    ? `${taskCount}/${total} tasks`
    : `${total} tasks`;

  const displayMode = visualCount > 0 ? `VISUAL — ${visualCount} selected` : mode.toUpperCase();
  const modeBg = visualCount > 0 ? colors.accentAlt : colors.accent;

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={colors.bgDark}
    >
      <text
        content={`  ${displayMode} `}
        fg={colors.bgDark}
        bg={modeBg}
        attributes={1}
      />
      <text
        content={` ${countStr} `}
        fg={colors.fgDim}
      />
      <text content="│" fg={colors.border} />
      <text
        content={` Filter: ${statusFilter} `}
        fg={colors.fgDim}
      />
      <text content="│" fg={colors.border} />
      <text
        content={` Sort: ${sortBy} `}
        fg={colors.fgDim}
      />
      {undoCount > 0 ? (
        <>
          <text content="│" fg={colors.border} />
          <text content={` Undo (${undoCount}) `} fg={colors.fgDim} />
        </>
      ) : null}
      {searchActive ? (
        <>
          <text content="│" fg={colors.border} />
          <text content=" / " fg={colors.accent} attributes={1} />
        </>
      ) : null}
      {timerText ? (
        <>
          <text content="│" fg={colors.border} />
          <text content={` ⏱ ${timerText} `} fg={colors.yellow} attributes={1} />
        </>
      ) : null}
      {message ? (
        <>
          <text content="│" fg={colors.border} />
          <text content={` ${message} `} fg={colors.green} attributes={1} />
        </>
      ) : null}
      {/* Spacer + clock on right */}
      <box flexGrow={1} />
      {showClock ? (
        <text content={`${clock}  `} fg={colors.fgDim} />
      ) : null}
    </box>
  );
}

function formatClock(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}
