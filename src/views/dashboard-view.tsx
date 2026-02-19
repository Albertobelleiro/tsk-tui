import { useMemo } from "react";
import type { Task } from "../store/types.ts";
import type { TaskStore } from "../store/task-store.ts";
import { colors } from "../theme/colors.ts";

interface DashboardViewProps {
  store: TaskStore;
}

const PRIORITY_ORDER: Task["priority"][] = ["urgent", "high", "medium", "low", "none"];
const PRIORITY_LABELS: Record<Task["priority"], string> = {
  urgent: "Urgent", high: "High", medium: "Medium", low: "Low", none: "None",
};

function bar(count: number, max: number, width: number = 10): string {
  if (max === 0) return "░".repeat(width);
  const filled = Math.round((count / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function sparkline(values: number[]): string {
  const chars = "▁▂▃▄▅▆▇█";
  const max = Math.max(...values, 1);
  return values.map((v) => chars[Math.min(Math.round((v / max) * 7), 7)]).join("");
}

export function DashboardView({ store }: DashboardViewProps) {
  const stats = useMemo(() => {
    const tasks = store.tasks.filter((t) => t.status !== "archived");
    const done = tasks.filter((t) => t.status === "done");
    const todo = tasks.filter((t) => t.status === "todo");
    const inProgress = tasks.filter((t) => t.status === "in_progress");

    // This week
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
    weekStart.setHours(0, 0, 0, 0);
    const weekStartISO = weekStart.toISOString();

    const doneThisWeek = done.filter((t) => t.completedAt && t.completedAt >= weekStartISO);
    const addedThisWeek = tasks.filter((t) => t.createdAt >= weekStartISO);
    const overdue = tasks.filter((t) => {
      if (!t.dueDate || t.status === "done") return false;
      return new Date(t.dueDate) < now;
    });

    // By priority
    const byPriority = PRIORITY_ORDER.map((p) => ({
      priority: p,
      count: tasks.filter((t) => t.priority === p && t.status !== "done").length,
    }));

    // By project
    const projectMap = new Map<string, number>();
    for (const t of tasks.filter((t) => t.status !== "done")) {
      const key = t.project ?? "(none)";
      projectMap.set(key, (projectMap.get(key) ?? 0) + 1);
    }
    const byProject = [...projectMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    // Completion history (last 14 days)
    const history: number[] = [];
    const dayNames: string[] = [];
    const dayChars = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const count = done.filter((t) =>
        t.completedAt && t.completedAt.slice(0, 10) === iso
      ).length;
      history.push(count);
      dayNames.push(dayChars[d.getDay() === 0 ? 6 : d.getDay() - 1]!);
    }

    // Streak
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const count = done.filter((t) =>
        t.completedAt && t.completedAt.slice(0, 10) === iso
      ).length;
      if (count > 0) streak++;
      else break;
    }

    // Total time spent this week
    const timeThisWeek = tasks.reduce((sum, t) => sum + (t.actualMinutes ?? 0), 0);

    const total = tasks.length;
    const doneCount = done.length;
    const completionPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

    return {
      total, doneCount, todo: todo.length, inProgress: inProgress.length,
      doneThisWeek: doneThisWeek.length,
      addedThisWeek: addedThisWeek.length,
      overdue: overdue.length,
      byPriority, byProject, history, dayNames,
      streak, timeThisWeek, completionPct,
      avgPerDay: streak > 0 ? (doneCount / Math.max(streak, 1)).toFixed(1) : "0",
    };
  }, [store.tasks]);

  const maxPriCount = Math.max(...stats.byPriority.map((p) => p.count), 1);
  const maxProjectCount = stats.byProject.length > 0 ? Math.max(...stats.byProject.map((p) => p[1]), 1) : 1;

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1}>
      <text content="  tsk Dashboard" fg={colors.fgBright} attributes={1} />
      <box height={1} />

      {/* Summary row */}
      <box flexDirection="row" height={5}>
        <box flexDirection="column" width="33%">
          <text content="  This Week" fg={colors.accent} attributes={1} />
          <text content={`  Done:    ${stats.doneThisWeek}`} fg={colors.green} />
          <text content={`  Added:   ${stats.addedThisWeek}`} fg={colors.fg} />
          <text content={`  Overdue: ${stats.overdue}`} fg={stats.overdue > 0 ? colors.red : colors.fgDim} />
        </box>
        <box flexDirection="column" width="33%">
          <text content="  All Time" fg={colors.accent} attributes={1} />
          <text content={`  Total:    ${stats.total}`} fg={colors.fg} />
          <text content={`  Done:     ${stats.doneCount}`} fg={colors.green} />
          <text content={`  Active:   ${stats.todo + stats.inProgress}`} fg={colors.yellow} />
        </box>
        <box flexDirection="column" width="34%">
          <text content="  Streak" fg={colors.accent} attributes={1} />
          <text content={`  🔥 ${stats.streak} day${stats.streak !== 1 ? "s" : ""}`} fg={colors.orange} />
          <text content={`  Avg/day: ${stats.avgPerDay}`} fg={colors.fgDim} />
        </box>
      </box>

      <box height={1} />

      {/* Progress bar */}
      <box flexDirection="row" height={1}>
        <text content={`  ${bar(stats.doneCount, stats.total, 30)}  ${stats.completionPct}% complete`} fg={colors.green} />
      </box>

      <box height={1} />

      {/* Priority + Project columns */}
      <box flexDirection="row" height={8}>
        <box flexDirection="column" width="50%">
          <text content="  By Priority" fg={colors.accent} attributes={1} />
          {stats.byPriority.map((p) => (
            <box key={p.priority} flexDirection="row" height={1}>
              <text content={`  ${PRIORITY_LABELS[p.priority].padEnd(7)} `} fg={colors.priority[p.priority]} />
              <text content={`${bar(p.count, maxPriCount, 6)} ${p.count}`} fg={colors.priority[p.priority]} />
            </box>
          ))}
        </box>
        <box flexDirection="column" width="50%">
          <text content="  By Project" fg={colors.accent} attributes={1} />
          {stats.byProject.map(([name, count]) => (
            <box key={name} flexDirection="row" height={1}>
              <text content={`  ${name.slice(0, 8).padEnd(8)} `} fg={colors.accentAlt} />
              <text content={`${bar(count, maxProjectCount, 6)} ${count}`} fg={colors.fg} />
            </box>
          ))}
          {stats.byProject.length === 0 ? (
            <text content="  No projects" fg={colors.fgDim} />
          ) : null}
        </box>
      </box>

      <box height={1} />

      {/* Completion history */}
      <text content="  Completion History (last 14 days)" fg={colors.accent} attributes={1} />
      <box flexDirection="row" height={1} paddingLeft={2}>
        <text content={sparkline(stats.history)} fg={colors.green} />
      </box>
      <box flexDirection="row" height={1} paddingLeft={2}>
        <text content={stats.dayNames.join("")} fg={colors.fgDim} />
      </box>

      {stats.timeThisWeek > 0 ? (
        <>
          <box height={1} />
          <text
            content={`  Time Tracked: ${Math.floor(stats.timeThisWeek / 60)}h ${stats.timeThisWeek % 60}m`}
            fg={colors.cyan}
          />
        </>
      ) : null}

      <box flexGrow={1} />
      <box height={1} backgroundColor={colors.bgDark}>
        <text
          content=" Press [1-3] to switch views  [?] Help"
          fg={colors.fgDim}
        />
      </box>
    </box>
  );
}
