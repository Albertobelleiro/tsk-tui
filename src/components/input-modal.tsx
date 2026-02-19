import { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { TaskPriority } from "../store/types.ts";
import { colors } from "../theme/colors.ts";
import { Modal } from "./modal.tsx";

const PRIORITIES: TaskPriority[] = ["none", "low", "medium", "high", "urgent"];
const PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: "None", low: "Low", medium: "Med", high: "High", urgent: "Urg",
};

const FIELD_COUNT = 6;
// Fields: 0=title, 1=desc, 2=priority, 3=project, 4=dueDate, 5=tags
// Fields 0,1,3,4,5 are <input> fields; field 2 is the priority picker

interface InputModalProps {
  mode: "add" | "edit";
  initialValues?: {
    title?: string;
    description?: string;
    priority?: TaskPriority;
    project?: string;
    tags?: string;
    dueDate?: string;
  };
  onSubmit: (values: {
    title: string;
    description: string;
    priority: TaskPriority;
    project: string | null;
    tags: string[];
    dueDate: string | null;
  }) => void;
  onCancel: () => void;
}

export function InputModal({ mode, initialValues, onSubmit, onCancel }: InputModalProps) {
  const [activeField, setActiveField] = useState(0);
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(initialValues?.priority ?? "none");
  const [project, setProject] = useState(initialValues?.project ?? "");
  const [dueDate, setDueDate] = useState(initialValues?.dueDate ?? "");
  const [tags, setTags] = useState(initialValues?.tags ?? "");
  const [titleError, setTitleError] = useState(false);
  const [dateError, setDateError] = useState(false);

  const submit = useCallback(() => {
    if (!title.trim()) {
      setTitleError(true);
      setActiveField(0);
      return;
    }
    if (dueDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim())) {
      setDateError(true);
      setActiveField(4);
      return;
    }
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      priority,
      project: project.trim() || null,
      tags: tags.trim() ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      dueDate: dueDate.trim() || null,
    });
  }, [title, description, priority, project, dueDate, tags, onSubmit]);

  const nextField = useCallback(() => {
    setActiveField((f) => (f + 1) % FIELD_COUNT);
  }, []);

  const prevField = useCallback(() => {
    setActiveField((f) => (f - 1 + FIELD_COUNT) % FIELD_COUNT);
  }, []);

  useKeyboard((e) => {
    switch (e.name) {
      case "escape":
        e.stopPropagation();
        e.preventDefault();
        onCancel();
        return;

      case "tab":
        e.stopPropagation();
        e.preventDefault();
        if (e.shift) { prevField(); } else { nextField(); }
        return;

      case "down":
        e.stopPropagation();
        e.preventDefault();
        nextField();
        return;

      case "up":
        e.stopPropagation();
        e.preventDefault();
        prevField();
        return;

      case "return":
        // When on the priority field, Enter submits the form
        if (activeField === 2) {
          e.stopPropagation();
          e.preventDefault();
          submit();
        }
        // For <input> fields, the input's onSubmit handles Enter
        return;

      case "left":
        if (activeField === 2) {
          e.stopPropagation();
          e.preventDefault();
          setPriority((p) => {
            const idx = PRIORITIES.indexOf(p);
            return PRIORITIES[(idx - 1 + PRIORITIES.length) % PRIORITIES.length]!;
          });
        }
        return;

      case "right":
        if (activeField === 2) {
          e.stopPropagation();
          e.preventDefault();
          setPriority((p) => {
            const idx = PRIORITIES.indexOf(p);
            return PRIORITIES[(idx + 1) % PRIORITIES.length]!;
          });
        }
        return;
    }
  });

  const modalTitle = mode === "add" ? "Add New Task" : "Edit Task";
  const labelFg = colors.fgDim;

  return (
    <Modal title={modalTitle} width={52} onClose={onCancel}>
      {/* Title */}
      <box flexDirection="row" height={1}>
        <text content="Title:    " fg={labelFg} attributes={1} />
        <input
          focused={activeField === 0}
          value={title}
          onInput={(v) => { setTitle(v); setTitleError(false); }}
          onSubmit={submit}
          placeholder="Task title..."
          flexGrow={1}
          textColor={titleError ? colors.red : colors.fg}
          backgroundColor={colors.bgHighlight}
        />
      </box>
      <box height={1} />

      {/* Description */}
      <box flexDirection="row" height={1}>
        <text content="Desc:     " fg={labelFg} attributes={1} />
        <input
          focused={activeField === 1}
          value={description}
          onInput={setDescription}
          onSubmit={submit}
          placeholder="Description..."
          flexGrow={1}
          textColor={colors.fg}
          backgroundColor={colors.bgHighlight}
        />
      </box>
      <box height={1} />

      {/* Priority - inline selector */}
      <box flexDirection="row" height={1}>
        <text content="Priority: " fg={labelFg} attributes={1} />
        {PRIORITIES.map((p) => (
          <text
            key={p}
            content={` ${PRIORITY_LABELS[p]} `}
            fg={p === priority ? colors.bgDark : colors.priority[p]}
            bg={p === priority ? colors.priority[p] : undefined}
            attributes={p === priority && activeField === 2 ? 1 : 0}
          />
        ))}
        {activeField === 2 ? (
          <text content="  ◂▸" fg={colors.fgDim} />
        ) : null}
      </box>
      <box height={1} />

      {/* Project */}
      <box flexDirection="row" height={1}>
        <text content="Project:  " fg={labelFg} attributes={1} />
        <input
          focused={activeField === 3}
          value={project}
          onInput={setProject}
          onSubmit={submit}
          placeholder="Project name..."
          flexGrow={1}
          textColor={colors.fg}
          backgroundColor={colors.bgHighlight}
        />
      </box>
      <box height={1} />

      {/* Due Date */}
      <box flexDirection="row" height={1}>
        <text content="Due Date: " fg={labelFg} attributes={1} />
        <input
          focused={activeField === 4}
          value={dueDate}
          onInput={(v) => { setDueDate(v); setDateError(false); }}
          onSubmit={submit}
          placeholder="YYYY-MM-DD"
          width={14}
          textColor={dateError ? colors.red : colors.fg}
          backgroundColor={colors.bgHighlight}
        />
        {dateError ? (
          <text content="  Invalid format" fg={colors.red} />
        ) : null}
      </box>
      <box height={1} />

      {/* Tags */}
      <box flexDirection="row" height={1}>
        <text content="Tags:     " fg={labelFg} attributes={1} />
        <input
          focused={activeField === 5}
          value={tags}
          onInput={setTags}
          onSubmit={submit}
          placeholder="tag1, tag2, ..."
          flexGrow={1}
          textColor={colors.fg}
          backgroundColor={colors.bgHighlight}
        />
      </box>
      <box height={1} />

      {/* Footer */}
      <box flexDirection="row">
        <text content=" [Enter] Save  [Tab/↓↑] Fields  [◂▸] Priority  [Esc] Cancel" fg={colors.fgDim} />
      </box>
    </Modal>
  );
}
