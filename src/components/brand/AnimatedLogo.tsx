import { motion } from "framer-motion";
import { cn } from "../ui/cn";
export function AnimatedLogo({ className }: { className?: string }) {
  return (
    <motion.div
      className={cn(
        "inline-flex items-center gap-2 font-display font-extrabold tracking-wide text-text",
        className,
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.span
        className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm text-white"
        animate={{ rotate: [0, 8, -8, 0] }}
        transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 3 }}
      >
        A
      </motion.span>
      <span>
        A.T <span className="text-accent">IN PHYSICS</span>
      </span>
    </motion.div>
  );
}
