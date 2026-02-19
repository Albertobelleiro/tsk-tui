import { useState, useCallback, useSyncExternalStore } from "react";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { TaskStore } from "./store/task-store.ts";
import type { Task, TaskPriority, FilterState } from "./store/types.ts";
import { DEFAULT_FILTER } from "./store/types.ts";
import { colors } from "./theme/colors.ts";
import { Header, type View } from "./components/header.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { TaskListView } from "./views/task-list.tsx";
import { ProjectView } from "./views/project-view.tsx";
import { CalendarView } from "./views/calendar-view.tsx";
import { HelpView } from "./views/help-view.tsx";
import { InputModal } from "./components/input-modal.tsx";
import { ConfirmModal } from "./components/confirm-modal.tsx";
import { SelectModal } from "./components/select-modal.tsx";

type ModalType =
  | { type: "add" }
  | { type: "edit"; task: Task }
  | { type: "confirm-delete"; task: Task }
  | { type: "select-priority"; task: Task }
  | { type: "select-project"; task: Task }
  | { type: "select-tags"; task: Task }
  | { type: "input-due-date"; task: Task };

interface AppProps {
  store: TaskStore;
}

const PRIORITY_OPTIONS = [
  { name: "None", description: "No priority", value: "none" },
  { name: "Low", description: "Low priority", value: "low" },
  { name: "Medium", description: "Medium priority", value: "medium" },
  { name: "High", description: "High priority", value: "high" },
  { name: "Urgent", description: "Urgent priority", value: "urgent" },
];

const STATUS_DISPLAY: Record<string, string> = {
  all: "all",
  todo: "todo",
  in_progress: "in progress",
  done: "done",
};

const SORT_DISPLAY: Record<string, string> = {
  priority: "priority",
  dueDate: "due",
  createdAt: "created",
  title: "title",
  order: "order",
};

export function App({ store }: AppProps) {
  const renderer = useRenderer();
  const { height } = useTerminalDimensions();
  const [activeView, setActiveView] = useState<View>("list");
  const [modalStack, setModalStack] = useState<ModalType[]>([]);
  const [filter, setFilter] = useState<FilterState>({ ...DEFAULT_FILTER });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const _snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const filteredTasks = store.getFiltered(filter);
  const stats = store.getStats();

  const pushModal = useCallback((modal: ModalType) => {
    setModalStack((s) => [...s, modal]);
  }, []);
  const popModal = useCallback(() => {
    setModalStack((s) => s.slice(0, -1));
  }, []);

  const activeModal = modalStack[modalStack.length - 1] ?? null;
  const isModalOpen = modalStack.length > 0;

  const handleFilterChange = useCallback((update: Partial<FilterState>) => {
    setFilter((prev) => ({ ...prev, ...update }));
  }, []);

  useKeyboard((e) => {
    // Ctrl+S force save — intercept before views handle plain 's'
    if (e.name === "s" && e.ctrl) {
      store.save();
      setStatusMessage("Saved!");
      setTimeout(() => setStatusMessage(null), 1500);
      return;
    }
    if (isModalOpen) return;
    switch (e.name) {
      case "1": setActiveView("list"); break;
      case "2": setActiveView("board"); break;
      case "3": setActiveView("calendar"); break;
      case "?": setActiveView(activeView === "help" ? "list" : "help"); break;
      case "q": renderer.destroy(); break;
    }
  });

  // Modal callbacks
  const handleAddTask = useCallback((values: {
    title: string; description: string; priority: TaskPriority;
    project: string | null; tags: string[]; dueDate: string | null;
  }) => {
    store.addTask(values);
    popModal();
  }, [store, popModal]);

  const handleEditTask = useCallback((task: Task, values: {
    title: string; description: string; priority: TaskPriority;
    project: string | null; tags: string[]; dueDate: string | null;
  }) => {
    store.updateTask(task.id, values);
    popModal();
  }, [store, popModal]);

  // Build project/tag options from current data
  const projectOptions = store.getProjects().map((p) => ({
    name: p, description: "", value: p,
  }));
  const tagOptions = store.getTags().map((t) => ({
    name: t, description: "", value: t,
  }));

  // StatusBar display strings
  const statusFilterStr = filter.status === "all"
    ? "all"
    : STATUS_DISPLAY[filter.status[0] as string] ?? "all";
  const dirArrow = filter.sortDirection === "asc" ? "↑" : "↓";
  const sortStr = `${SORT_DISPLAY[filter.sortBy] ?? filter.sortBy} ${dirArrow}`;
  const searchActive = filter.search.length > 0;

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={colors.bg}>
      <Header activeView={activeView} onViewChange={setActiveView} />

      {activeView === "list" ? (
        <TaskListView
          store={store}
          tasks={filteredTasks}
          totalCount={stats.total}
          pushModal={pushModal}
          isModalOpen={isModalOpen}
          filter={filter}
          onFilterChange={handleFilterChange}
        />
      ) : activeView === "board" ? (
        <ProjectView
          store={store}
          tasks={store.tasks.filter((t) => t.status !== "archived")}
          pushModal={pushModal}
          isModalOpen={isModalOpen}
        />
      ) : activeView === "calendar" ? (
        <CalendarView store={store} pushModal={pushModal} isModalOpen={isModalOpen} />
      ) : activeView === "help" ? (
        <HelpView onClose={() => setActiveView("list")} />
      ) : null}

      {height >= 15 && (
        <StatusBar
          mode="normal"
          taskCount={filteredTasks.length}
          totalCount={stats.total}
          statusFilter={statusFilterStr}
          sortBy={sortStr}
          searchActive={searchActive}
          message={statusMessage}
        />
      )}

      {/* Modal overlay */}
      {activeModal?.type === "add" && (
        <InputModal
          mode="add"
          onSubmit={handleAddTask}
          onCancel={popModal}
        />
      )}
      {activeModal?.type === "edit" && (
        <InputModal
          mode="edit"
          initialValues={{
            title: activeModal.task.title,
            description: activeModal.task.description,
            priority: activeModal.task.priority,
            project: activeModal.task.project ?? "",
            tags: activeModal.task.tags.join(", "),
            dueDate: activeModal.task.dueDate ?? "",
          }}
          onSubmit={(values) => handleEditTask(activeModal.task, values)}
          onCancel={popModal}
        />
      )}
      {activeModal?.type === "confirm-delete" && (
        <ConfirmModal
          title="Delete Task"
          message={`Delete "${activeModal.task.title}"?\nThis cannot be undone.`}
          onConfirm={() => {
            store.deleteTask(activeModal.task.id);
            popModal();
          }}
          onCancel={popModal}
        />
      )}
      {activeModal?.type === "select-priority" && (
        <SelectModal
          title="Set Priority"
          options={PRIORITY_OPTIONS}
          selectedValue={activeModal.task.priority}
          onSelect={(value) => {
            store.updateTask(activeModal.task.id, { priority: value as TaskPriority });
            popModal();
          }}
          onCancel={popModal}
        />
      )}
      {activeModal?.type === "select-project" && (
        <SelectModal
          title="Set Project"
          options={projectOptions}
          selectedValue={activeModal.task.project ?? undefined}
          allowNew={true}
          onSelect={(value) => {
            if (value === "__new__") {
              // Close select, user can use edit modal to type project
              popModal();
              return;
            }
            store.updateTask(activeModal.task.id, { project: value || null });
            popModal();
          }}
          onCancel={popModal}
        />
      )}
      {activeModal?.type === "select-tags" && (
        <SelectModal
          title="Tags"
          options={tagOptions}
          selectedValues={activeModal.task.tags}
          multiSelect={true}
          allowNew={true}
          onSelect={() => {}}
          onMultiSelect={(values) => {
            store.updateTask(activeModal.task.id, { tags: values });
            popModal();
          }}
          onCancel={popModal}
        />
      )}
      {activeModal?.type === "input-due-date" && (
        <InputModal
          mode="edit"
          initialValues={{ title: activeModal.task.title, dueDate: activeModal.task.dueDate ?? "" }}
          onSubmit={(values) => {
            store.updateTask(activeModal.task.id, { dueDate: values.dueDate });
            popModal();
          }}
          onCancel={popModal}
        />
      )}
    </box>
  );
}
