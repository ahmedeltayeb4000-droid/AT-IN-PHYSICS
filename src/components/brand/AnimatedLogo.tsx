import { motion, useReducedMotion } from "framer-motion";
import { cn } from "../ui/cn";
export function AnimatedLogo({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  return <motion.div className={cn("inline-flex items-center gap-3 font-display font-extrabold text-text", className)} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
    <motion.svg viewBox="0 0 48 48" aria-hidden="true" className="h-10 w-10 shrink-0 overflow-visible text-accent drop-shadow-[0_0_8px_rgba(37,199,255,.55)]" animate={reduceMotion ? undefined : { rotate: [0,3,-3,0] }} transition={{ duration: 5, repeat: Infinity, repeatDelay: 4 }}>
      <ellipse cx="24" cy="24" rx="21" ry="8" fill="none" stroke="currentColor" strokeWidth="1.4"/><ellipse cx="24" cy="24" rx="21" ry="8" fill="none" stroke="currentColor" strokeWidth="1.4" transform="rotate(60 24 24)"/><ellipse cx="24" cy="24" rx="21" ry="8" fill="none" stroke="currentColor" strokeWidth="1.4" transform="rotate(120 24 24)"/><circle cx="24" cy="24" r="3.2" fill="currentColor"/>
    </motion.svg><span className="leading-none">A.T <span className="text-accent">IN PHYSICS</span></span>
  </motion.div>;
}
