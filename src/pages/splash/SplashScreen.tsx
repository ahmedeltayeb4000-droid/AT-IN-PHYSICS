import { useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { AnimatedLogo } from "../../components/brand/AnimatedLogo";
import { PhysicsBackground } from "../../components/brand/PhysicsBackground";
export function SplashScreen() {
  const navigate = useNavigate();
  useEffect(() => {
    const timeout = window.setTimeout(
      () => navigate("/", { replace: true }),
      2000,
    );
    return () => window.clearTimeout(timeout);
  }, [navigate]);
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-navy">
      <PhysicsBackground />
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center"
      >
        <AnimatedLogo className="text-3xl text-white" />
        <div className="mx-auto mt-6 h-1 w-36 overflow-hidden rounded bg-white/10">
          <motion.div
            className="h-full bg-cyan"
            initial={{ x: "-100%" }}
            animate={{ x: "0%" }}
            transition={{ duration: 1.1 }}
          />
        </div>
      </motion.div>
    </main>
  );
}
