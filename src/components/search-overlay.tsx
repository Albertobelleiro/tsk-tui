import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { Task } from "../store/types.ts";
import { colors } from "../theme/colors.ts";
import { Modal } from "./modal.tsx";

const STATUS_ICON: Record<Task["status"], string> = {
  todo: "○",
  in_progress: "◉",
  done: "✓",
  archived: "▪",
};

const PRIORITY_BADGE: Record<Task["priority"], string> = {
  urgent: "U",
  high: "H",
  medium: "M",
  low: "L",
  none: "-",
};

interface SearchOverlayProps {
  initialQuery: string;
  results: Task[];
  onQueryChange: (query: string) => void;
  onSelect: (task: Task) => void;
  onClose: () => void;
}

export function SearchOverlay({
  initialQuery,
  results,
  onQueryChange,
  onSelect,
  onClose,
}: SearchOverlayProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useKeyboard((e) => {
    switch (e.name) {
      case "escape":
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;

      case "down":
        e.stopPropagation();
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
        return;

      case "up":
        e.stopPropagation();
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;

      case "return":
        e.stopPropagation();
        e.preventDefault();
        if (results.length > 0 && results[selectedIdx]) {
          onSelect(results[selectedIdx]);
        }
        return;
    }
  });

  return (
    <Modal title="Search" width={50} onClose={onClose}>
      <box flexDirection="row" height={1}>
        <text content=" / " fg={colors.accent} attributes={1} />
        <input
          focused={true}
          value={initialQuery}
          onInput={(v) => {
            onQueryChange(v);
            setSelectedIdx(0);
          }}
          onSubmit={() => {
            if (results.length > 0 && results[selectedIdx]) {
              onSelect(results[selectedIdx]);
            }
          }}
          placeholder="Search tasks..."
          flexGrow={1}
          textColor={colors.fg}
          backgroundColor={colors.bgHighlight}
        />
      </box>
      <box height={1} />

      {results.length === 0 ? (
        <text content="  No matching tasks" fg={colors.fgDim} />
      ) : (
        <>
          <text content={`  ${results.length} result${results.length !== 1 ? "s" : ""}:`} fg={colors.fgDim} />
          <box height={1} />
          {results.slice(0, 10).map((task, i) => {
            const isSelected = i === selectedIdx;
            const bg = isSelected ? colors.bgHighlight : undefined;
            const project = task.project
              ? task.project.length > 8 ? task.project.slice(0, 7) + "…" : task.project
              : "";
            return (
              <box key={task.id} flexDirection="row" height={1} backgroundColor={bg}>
                <text content={isSelected ? " ▸ " : "   "} fg={colors.accent} />
                <text content={STATUS_ICON[task.status]} fg={colors.status[task.status]} />
                <text content=" " />
                <text content={task.title} fg={colors.fg} flexGrow={1} overflow="hidden" />
                {project ? (
                  <text content={`  ${project}`} fg={colors.accentAlt} />
                ) : null}
                <text content={`  ${PRIORITY_BADGE[task.priority]}`} fg={colors.priority[task.priority]} />
                <text content=" " />
              </box>
            );
          })}
        </>
      )}

      <box height={1} />
      <text
        content=" [Enter] Go to  [↑↓] Navigate  [Esc] Close"
        fg={colors.fgDim}
      />
    </Modal>
  );
}
