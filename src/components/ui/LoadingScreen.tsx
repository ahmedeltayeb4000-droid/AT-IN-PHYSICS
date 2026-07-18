import { motion } from "framer-motion";
export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas text-center">
      <div>
        <motion.div
          className="mx-auto h-10 w-10 rounded-full border-2 border-accent/30 border-t-accent"
          animate={{ rotate: 360 }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
        />
        <p className="mt-4 text-sm text-text-muted">{label}</p>
      </div>
    </div>
  );
}
