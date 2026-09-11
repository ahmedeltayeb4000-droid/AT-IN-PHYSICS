import type { PropsWithChildren } from "react";
import { motion, useReducedMotion } from "framer-motion";

export function PageTransition({ children }: PropsWithChildren) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
      transition={{ duration: reduceMotion ? 0 : 0.25 }}
    >
      {children}
    </motion.div>
  );
}
