import { useState, useEffect, useCallback, useRef } from "react";
import { colors } from "../theme/colors.ts";

export type ToastLevel = "success" | "warning" | "error" | "info";

export interface ToastMessage {
  id: string;
  text: string;
  level: ToastLevel;
  createdAt: number;
}

const TOAST_COLORS: Record<ToastLevel, string> = {
  success: "#9ece6a",  // will use colors.green at render time
  warning: "#e0af68",
  error: "#f7768e",
  info: "#7dcfff",
};

const TOAST_ICONS: Record<ToastLevel, string> = {
  success: "✓",
  warning: "⚠",
  error: "✗",
  info: "ℹ",
};

const MAX_TOASTS = 3;
const DISMISS_MS = 3000;

// ── Global toast state (hook-based) ──────────────────

let _toasts: ToastMessage[] = [];
let _listeners: Array<() => void> = [];

function notifyListeners() {
  for (const fn of _listeners) fn();
}

export function showToast(text: string, level: ToastLevel = "info"): void {
  const toast: ToastMessage = {
    id: crypto.randomUUID(),
    text,
    level,
    createdAt: Date.now(),
  };
  _toasts = [toast, ..._toasts].slice(0, MAX_TOASTS);
  notifyListeners();
  // Auto-dismiss
  setTimeout(() => {
    _toasts = _toasts.filter((t) => t.id !== toast.id);
    notifyListeners();
  }, DISMISS_MS);
}

export function useToasts(): ToastMessage[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    _listeners.push(listener);
    return () => {
      _listeners = _listeners.filter((l) => l !== listener);
    };
  }, []);
  return _toasts;
}

// ── Toast display component ──────────────────────────

export function ToastContainer() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <box
      position="absolute"
      top={2}
      right={2}
      flexDirection="column"
      width={40}
    >
      {toasts.map((toast) => (
        <box
          key={toast.id}
          flexDirection="row"
          height={1}
          backgroundColor={colors.bgModal}
          borderColor={colors.border}
        >
          <text
            content={` ${TOAST_ICONS[toast.level]} `}
            fg={TOAST_COLORS[toast.level]}
          />
          <text
            content={toast.text}
            fg={colors.fg}
            flexGrow={1}
            overflow="hidden"
          />
          <text content=" " />
        </box>
      ))}
    </box>
  );
}
