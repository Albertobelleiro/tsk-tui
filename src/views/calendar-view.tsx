import { useMemo, useState, useSyncExternalStore } from "react";
import { useKeyboard } from "@opentui/react";
import type { Task } from "../store/types.ts";
import type { TaskStore } from "../store/task-store.ts";
import { colors } from "../theme/colors.ts";
import {
  getDaysInMonth,
  getFirstWeekdayOfMonth,
  formatMonthYear,
  toISODate,
} from "../utils/date.ts";

const WEEKDAYS = "  Mo  Tu  We  Th  Fr  Sa  Su";

const PRIORITY_WEIGHT: Record<Task["priority"], number> = {
  none: 0, low: 1, medium: 2, high: 3, urgent: 4,
};

const STATUS_ICON: Record<Task["status"], string> = {
  todo: "○", in_progress: "◉", done: "✓", archived: "▪",
};

interface ModalAdd { type: "add" }
type ModalType = ModalAdd;

interface CalendarViewProps {
  store: TaskStore;
  pushModal: (modal: ModalType) => void;
  isModalOpen: boolean;
}

export function buildDayTaskMap(
  tasks: Task[],
  viewYear: number,
  viewMonth: number,
  daysInMonth: number,
): Map<number, Task[]> {
  const map = new Map<number, Task[]>();
  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-`;
  for (const task of tasks) {
    if (!task.dueDate || !task.dueDate.startsWith(monthPrefix)) continue;
    const day = Number(task.dueDate.slice(8, 10));
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth) continue;
    const bucket = map.get(day);
    if (bucket) {
      bucket.push(task);
    } else {
      map.set(day, [task]);
    }
  }
  return map;
}

export function CalendarView({ store, pushModal, isModalOpen }: CalendarViewProps) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(now.getDate());

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstWeekday = getFirstWeekdayOfMonth(viewYear, viewMonth);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // Build task map: day → tasks
  const dayTaskMap = useMemo(() => {
    return buildDayTaskMap(snapshot, viewYear, viewMonth, daysInMonth);
  }, [daysInMonth, snapshot, viewMonth, viewYear]);

  const isToday = (day: number) =>
    viewYear === now.getFullYear() && viewMonth === now.getMonth() && day === now.getDate();

  // Build week rows
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array(firstWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  // Navigation helpers
  const goToMonth = (y: number, m: number) => {
    if (m < 0) { setViewYear(y - 1); setViewMonth(11); }
    else if (m > 11) { setViewYear(y + 1); setViewMonth(0); }
    else { setViewYear(y); setViewMonth(m); }
    setSelectedDay(1);
  };

  const clampDay = (d: number) => Math.max(1, Math.min(d, daysInMonth));

  useKeyboard((e) => {
    if (isModalOpen) return;
    switch (e.name) {
      case "h": case "left":
        if (selectedDay <= 1) {
          // Go to prev month last day
          const pm = viewMonth - 1;
          const py = pm < 0 ? viewYear - 1 : viewYear;
          const pMonth = pm < 0 ? 11 : pm;
          const pDays = getDaysInMonth(py, pMonth);
          setViewYear(py); setViewMonth(pMonth); setSelectedDay(pDays);
        } else {
          setSelectedDay((d) => d - 1);
        }
        return;
      case "l": case "right":
        if (selectedDay >= daysInMonth) {
          goToMonth(viewYear, viewMonth + 1);
        } else {
          setSelectedDay((d) => d + 1);
        }
        return;
      case "k": case "up":
        if (selectedDay - 7 < 1) {
          const pm = viewMonth - 1;
          const py = pm < 0 ? viewYear - 1 : viewYear;
          const pMonth = pm < 0 ? 11 : pm;
          const pDays = getDaysInMonth(py, pMonth);
          const target = pDays + (selectedDay - 7);
          setViewYear(py); setViewMonth(pMonth); setSelectedDay(Math.max(1, target));
        } else {
          setSelectedDay((d) => d - 7);
        }
        return;
      case "j": case "down":
        if (selectedDay + 7 > daysInMonth) {
          const nm = viewMonth + 1;
          const ny = nm > 11 ? viewYear + 1 : viewYear;
          const nMonth = nm > 11 ? 0 : nm;
          const target = selectedDay + 7 - daysInMonth;
          const nDays = getDaysInMonth(ny, nMonth);
          setViewYear(ny); setViewMonth(nMonth); setSelectedDay(Math.min(target, nDays));
        } else {
          setSelectedDay((d) => d + 7);
        }
        return;
      case "H":
        goToMonth(viewYear, viewMonth - 1);
        return;
      case "L":
        goToMonth(viewYear, viewMonth + 1);
        return;
      case "t":
        setViewYear(now.getFullYear());
        setViewMonth(now.getMonth());
        setSelectedDay(now.getDate());
        return;
      case "a": {
        const iso = toISODate(viewYear, viewMonth, clampDay(selectedDay));
        pushModal({ type: "add" });
        // Note: ideally we'd pre-fill dueDate but InputModal gets it via initialValues
        // from app.tsx. We'll keep it simple — user presses 'a' from calendar and fills date.
        return;
      }
    }
  });

  const selectedTasks = dayTaskMap.get(selectedDay) ?? [];
  const monthLabel = formatMonthYear(viewYear, viewMonth);

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1}>
      {/* Month header */}
      <text content={`  ${monthLabel}`} fg={colors.fgBright} attributes={1} />
      <box height={1} />

      {/* Weekday headers */}
      <text content={WEEKDAYS} fg={colors.fgDim} />

      {/* Calendar grid */}
      {weeks.map((wk, wi) => (
        <box key={wi} flexDirection="row" height={1}>
          {wk.map((day, di) => {
            if (day === null) {
              return <text key={di} content="    " />;
            }
            const hasTasks = dayTaskMap.has(day);
            const isTodayDay = isToday(day);
            const isSel = day === selectedDay;
            const isWeekend = di >= 5;

            // Build cell content (4 chars wide)
            let label: string;
            if (isTodayDay) {
              label = `[${String(day).padStart(2)}]`;
            } else if (hasTasks) {
              label = `${String(day).padStart(3)}●`;
            } else {
              label = String(day).padStart(4);
            }

            // Determine dot color from highest priority task
            let fg: string = isWeekend ? colors.fgDim : colors.fg;
            if (hasTasks && !isTodayDay) {
              const tasks = dayTaskMap.get(day)!;
              const highest = tasks.reduce((best, t) =>
                PRIORITY_WEIGHT[t.priority] > PRIORITY_WEIGHT[best.priority] ? t : best,
              tasks[0]!);
              fg = colors.priority[highest.priority];
            }
            if (isTodayDay) fg = colors.accent;

            return (
              <text
                key={di}
                content={label}
                fg={fg}
                bg={isSel ? colors.bgHighlight : undefined}
                attributes={isTodayDay || isSel ? 1 : 0}
              />
            );
          })}
        </box>
      ))}

      <box height={1} />
      <box height={1} backgroundColor={colors.border} />
      <box height={1} />

      {/* Selected day detail */}
      {selectedTasks.length === 0 ? (
        <text
          content={`  No tasks due on ${monthLabel.split(" ")[0]} ${selectedDay}`}
          fg={colors.fgDim}
        />
      ) : (
        <>
          <text
            content={`  Due on ${monthLabel.split(" ")[0]} ${selectedDay}:`}
            fg={colors.fgBright}
            attributes={1}
          />
          <box height={1} />
          <scrollbox scrollY={true} flexGrow={1}>
            {selectedTasks.map((task) => (
              <box key={task.id} flexDirection="row" height={1} paddingLeft={2}>
                <text content={STATUS_ICON[task.status]} fg={colors.status[task.status]} />
                <text content={` ${task.title}`} fg={colors.fg} flexGrow={1} />
                <text content={` (${task.priority})`} fg={colors.priority[task.priority]} />
              </box>
            ))}
          </scrollbox>
        </>
      )}

      <box flexGrow={1} />
      <box height={1} backgroundColor={colors.bgDark}>
        <text
          content=" [h/j/k/l] Navigate  [H/L] Month  [t] Today  [a] Add task"
          fg={colors.fgDim}
        />
      </box>
    </box>
  );
}
