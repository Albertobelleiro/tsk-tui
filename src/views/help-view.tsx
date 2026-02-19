import { useKeyboard } from "@opentui/react";
import { colors } from "../theme/colors.ts";

interface HelpViewProps {
  onClose: () => void;
}

function Section({ title }: { title: string }) {
  return <text content={title} fg={colors.accent} attributes={1} />;
}

function Binding({ keys, desc }: { keys: string; desc: string }) {
  return (
    <box flexDirection="row" height={1}>
      <text content={keys.padEnd(8)} fg={colors.fgBright} attributes={1} />
      <text content={desc} fg={colors.fg} />
    </box>
  );
}

export function HelpView({ onClose }: HelpViewProps) {
  useKeyboard((e) => {
    if (e.name === "escape" || e.name === "?") {
      e.stopPropagation();
      e.preventDefault();
      onClose();
    }
  });

  return (
    <box
      flexGrow={1}
      justifyContent="center"
      alignItems="center"
      backgroundColor={colors.bgDark}
    >
      <box
        flexDirection="column"
        width={62}
        backgroundColor={colors.bgModal}
        borderStyle="single"
        borderColor={colors.borderFocus}
        border={true}
        title="tsk Keybindings"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <scrollbox scrollY={true} flexGrow={1}>
          <box flexDirection="row">
            {/* Left column */}
            <box flexDirection="column" width="50%">
              <Section title="NAVIGATION" />
              <box height={1} />
              <Binding keys="j / ↓" desc="Move down" />
              <Binding keys="k / ↑" desc="Move up" />
              <Binding keys="g" desc="Go to top" />
              <Binding keys="G" desc="Go to bottom" />
              <Binding keys="J / K" desc="Jump 10 up/down" />
              <Binding keys="Tab" desc="Switch panel" />
              <Binding keys="Enter" desc="Open / Select" />
              <Binding keys="Esc" desc="Back / Close" />
              <box height={1} />

              <Section title="VIEWS" />
              <box height={1} />
              <Binding keys="1" desc="Task List" />
              <Binding keys="2" desc="Project Board" />
              <Binding keys="3" desc="Calendar" />
              <Binding keys="?" desc="This help" />
              <box height={1} />

              <Section title="GENERAL" />
              <box height={1} />
              <Binding keys="q" desc="Quit" />
              <Binding keys="Ctrl+C" desc="Quit" />
            </box>

            {/* Right column */}
            <box flexDirection="column" width="50%">
              <Section title="ACTIONS" />
              <box height={1} />
              <Binding keys="a" desc="Add new task" />
              <Binding keys="e" desc="Edit task" />
              <Binding keys="d" desc="Mark done/undone" />
              <Binding keys="x" desc="Delete task" />
              <Binding keys="/" desc="Search" />
              <Binding keys="!" desc="Set priority" />
              <Binding keys="p" desc="Set project" />
              <Binding keys="t" desc="Add/remove tag" />
              <Binding keys="D" desc="Set due date" />
              <Binding keys="s" desc="Cycle sort" />
              <Binding keys="f" desc="Cycle filter" />
              <Binding keys="u" desc="Undo" />
              <box height={1} />

              <Section title="BOARD VIEW" />
              <box height={1} />
              <Binding keys="h / l" desc="Switch column" />
              <Binding keys="H / L" desc="Move task ←/→" />
              <box height={1} />

              <Section title="CALENDAR" />
              <box height={1} />
              <Binding keys="h/j/k/l" desc="Navigate days" />
              <Binding keys="H / L" desc="Prev/Next month" />
              <Binding keys="t" desc="Jump to today" />
            </box>
          </box>
        </scrollbox>

        <box height={1} />
        <text content="Press Esc or ? to close" fg={colors.fgDim} />
      </box>
    </box>
  );
}
