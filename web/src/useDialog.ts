import { useEffect, type RefObject } from "react";

interface DialogOptions {
  /** Whether the dialog is mounted; the listeners only exist while it is. */
  open: boolean;
  onClose: () => void;
  /** The dialog panel, used to scope Tab containment. */
  panelRef: RefObject<HTMLElement | null>;
  /** Element focused on open, usually the close button. */
  initialFocusRef: RefObject<HTMLElement | null>;
}

/**
 * Modal behaviour shared by the settings panel and the note reader: Escape
 * closes, Tab stays inside the panel, and focus returns to whatever opened it.
 */
export function useDialog({ open, onClose, panelRef, initialFocusRef }: DialogOptions): void {
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    initialFocusRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose, panelRef, initialFocusRef]);
}
