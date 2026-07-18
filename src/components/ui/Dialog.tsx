import { AnimatePresence, motion } from "framer-motion";
import type { PropsWithChildren, ReactNode } from "react";
import { useEffect } from "react";
type Props = PropsWithChildren<{
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
}>;
export function Dialog({ open, onClose, title, children }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : "Dialog"}
            className="w-full max-w-lg rounded-2xl border border-border bg-panel p-6 shadow-2xl"
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {title && (
              <h2 className="font-display text-xl font-bold text-text">
                {title}
              </h2>
            )}
            <div className={title ? "mt-4" : ""}>{children}</div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
