import { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { SelectOption } from "@opentui/core";
import { colors } from "../theme/colors.ts";
import { Modal } from "./modal.tsx";

interface SelectModalOption {
  name: string;
  description: string;
  value: string;
}

interface SelectModalProps {
  title: string;
  options: SelectModalOption[];
  selectedValue?: string;
  selectedValues?: string[];
  multiSelect?: boolean;
  allowNew?: boolean;
  onSelect: (value: string) => void;
  onMultiSelect?: (values: string[]) => void;
  onCancel: () => void;
}

export function SelectModal({
  title,
  options,
  selectedValue,
  selectedValues,
  multiSelect = false,
  allowNew = false,
  onSelect,
  onMultiSelect,
  onCancel,
}: SelectModalProps) {
  const allOptions = allowNew
    ? [...options, { name: "+ New...", description: "Create new", value: "__new__" }]
    : options;

  const initialIndex = selectedValue
    ? Math.max(0, allOptions.findIndex((o) => o.value === selectedValue))
    : 0;

  const [toggled, setToggled] = useState<Set<string>>(
    () => new Set(selectedValues ?? []),
  );

  const selectOptions: SelectOption[] = allOptions.map((o) => {
    let prefix = "";
    if (multiSelect) {
      prefix = toggled.has(o.value) ? "✓ " : "  ";
    } else if (o.value === selectedValue) {
      prefix = "▸ ";
    }
    return { name: `${prefix}${o.name}`, description: o.description, value: o.value };
  });

  const handleSelect = useCallback(
    (_index: number, option: SelectOption | null) => {
      if (!option) return;
      const val = option.value as string;
      if (multiSelect) {
        setToggled((prev) => {
          const next = new Set(prev);
          if (next.has(val)) next.delete(val);
          else next.add(val);
          return next;
        });
      } else {
        onSelect(val);
      }
    },
    [multiSelect, onSelect],
  );

  useKeyboard((e) => {
    if (e.name === "escape") {
      e.stopPropagation();
      e.preventDefault();
      onCancel();
    } else if (multiSelect && e.name === "return") {
      e.stopPropagation();
      e.preventDefault();
      onMultiSelect?.([...toggled]);
    }
  });

  return (
    <Modal title={title} width={30} onClose={onCancel}>
      <select
        focused={true}
        options={selectOptions}
        selectedIndex={initialIndex}
        onSelect={handleSelect}
        backgroundColor={colors.bgModal}
        textColor={colors.fg}
        focusedBackgroundColor={colors.bgHighlight}
        focusedTextColor={colors.fgBright}
        selectedBackgroundColor={colors.bgHighlight}
        selectedTextColor={colors.accent}
        descriptionColor={colors.fgDim}
        showDescription={false}
        flexGrow={1}
      />
      <box height={1} />
      <text
        content={multiSelect ? " [Space] Toggle  [Enter] Done  [Esc] Cancel" : " [Enter] Select  [Esc] Cancel"}
        fg={colors.fgDim}
      />
    </Modal>
  );
}
