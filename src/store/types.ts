export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done" | "archived";
  priority: "none" | "low" | "medium" | "high" | "urgent";
  project: string | null;
  tags: string[];
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  order: number;
}

export type TaskStatus = Task["status"];
export type TaskPriority = Task["priority"];

export interface FilterState {
  status: TaskStatus[] | "all";
  priority: TaskPriority[] | "all";
  project: string | null;
  tag: string | null;
  search: string;
  sortBy: "priority" | "dueDate" | "createdAt" | "title" | "order";
  sortDirection: "asc" | "desc";
}

export type SortField = FilterState["sortBy"];

export const DEFAULT_FILTER: FilterState = {
  status: "all",
  priority: "all",
  project: null,
  tag: null,
  search: "",
  sortBy: "priority",
  sortDirection: "desc",
};
