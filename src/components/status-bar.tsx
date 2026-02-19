import { colors } from "../theme/colors.ts";

interface StatusBarProps {
  mode: string;
  taskCount: number;
  totalCount?: number;
  statusFilter?: string;
  sortBy?: string;
  searchActive?: boolean;
  message?: string | null;
}

export function StatusBar({
  mode,
  taskCount,
  totalCount,
  statusFilter = "all",
  sortBy = "priority",
  searchActive = false,
  message = null,
}: StatusBarProps) {
  const total = totalCount ?? taskCount;
  const countStr = taskCount !== total
    ? `${taskCount}/${total} tasks`
    : `${total} tasks`;

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={colors.bgDark}
    >
      <text
        content={`  ${mode.toUpperCase()} `}
        fg={colors.bgDark}
        bg={colors.accent}
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
      {searchActive ? (
        <>
          <text content="│" fg={colors.border} />
          <text content=" / " fg={colors.accent} attributes={1} />
        </>
      ) : null}
      {message ? (
        <>
          <text content="│" fg={colors.border} />
          <text content={` ${message} `} fg={colors.green} attributes={1} />
        </>
      ) : null}
    </box>
  );
}
