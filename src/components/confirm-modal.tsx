import { useKeyboard } from "@opentui/react";
import { colors } from "../theme/colors.ts";
import { Modal } from "./modal.tsx";

interface ConfirmModalProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ title, message, onConfirm, onCancel }: ConfirmModalProps) {
  useKeyboard((e) => {
    switch (e.name) {
      case "y":
        e.stopPropagation();
        e.preventDefault();
        onConfirm();
        break;
      case "n":
      case "escape":
        e.stopPropagation();
        e.preventDefault();
        onCancel();
        break;
    }
  });

  return (
    <Modal title={title} width={40} onClose={onCancel}>
      <text content={message} fg={colors.fg} wrapMode="word" />
      <box height={1} />
      <box flexDirection="row">
        <text content="  [y] Yes    [n/Esc] No" fg={colors.fgDim} />
      </box>
    </Modal>
  );
}
