import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { AnimatedLogo } from "../../components/brand/AnimatedLogo";
import { PhysicsBackground } from "../../components/brand/PhysicsBackground";
export function SplashScreen() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const timeout = window.setTimeout(
      () => navigate("/", { replace: true }),
      2000,
    );
    return () => window.clearTimeout(timeout);
  }, [navigate]);
  return (
    <main className="student-premium relative grid min-h-screen place-items-center overflow-hidden bg-canvas text-text">
      <PhysicsBackground />
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.5 }}
        className="text-center"
      >
        <AnimatedLogo className="text-3xl text-white" />
        <p className="mt-4 text-xs font-bold uppercase tracking-[.24em] text-cyan-light">Physicist / Ahmed Eltayeb</p>
        <div className="mx-auto mt-6 h-1 w-36 overflow-hidden rounded bg-white/10">
          <motion.div
            className="h-full bg-cyan"
            initial={reduceMotion ? false : { x: "-100%" }}
            animate={{ x: "0%" }}
            transition={{ duration: reduceMotion ? 0 : 1.1 }}
          />
        </div>
      </motion.div>
    </main>
  );
}
