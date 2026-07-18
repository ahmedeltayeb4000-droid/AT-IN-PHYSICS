import { motion } from "framer-motion";
export function PhysicsBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <motion.div
        className="absolute left-[10%] top-[15%] h-56 w-56 rounded-full border border-accent/20"
        animate={{ rotate: 360 }}
        transition={{ duration: 32, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        className="absolute right-[12%] top-[25%] h-3 w-3 rounded-full bg-accent shadow-[0_0_36px_8px_rgba(14,165,233,.35)]"
        animate={{ y: [0, 72, 0], x: [0, 24, 0] }}
        transition={{ duration: 7, repeat: Infinity }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(14,165,233,.13),transparent_30%)]" />
    </div>
  );
}
