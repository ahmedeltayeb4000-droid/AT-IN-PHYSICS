import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { firebaseAuth } from "../../lib/firebase";
import { AnimatedLogo } from "../brand/AnimatedLogo";
import { MoonIcon, SunIcon } from "../icons/icons";
import { useTheme } from "../theme/ThemeProvider";

export function Navbar() {
  const { theme, toggleTheme } = useTheme();
  // حالة (State) لحفظ بيانات المستخدم لو مسجل دخول
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();

  // مراقبة حالة تسجيل الدخول في الخلفية
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe(); // تنظيف المراقب لما نقفل الصفحة
  }, []);

  // دالة تسجيل الخروج
  const handleLogout = async () => {
    try {
      await signOut(firebaseAuth);
      navigate("/"); // توجيه المستخدم للصفحة الرئيسية بعد الخروج
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link to="/">
          <AnimatedLogo />
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <NavLink to="/" className="text-text-muted hover:text-text">
            Home
          </NavLink>

          {/* الجزء المسؤول عن تغيير الزراير بناءً على حالة المستخدم */}
          {user ? (
            <>
              <Link to="/dashboard" className="text-text-muted hover:text-text">
                Dashboard
              </Link>
              <button 
                onClick={handleLogout} 
                className="text-text-muted hover:text-red-500 transition-colors"
              >
                Logout
              </button>
            </>
          ) : (
            <Link to="/login" className="text-text-muted hover:text-text">
              Sign in
            </Link>
          )}

          <button
            aria-label="Toggle theme"
            onClick={toggleTheme}
            className="grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-panel hover:text-text"
          >
            {theme === "dark" ? (
              <SunIcon className="h-4 w-4" />
            ) : (
              <MoonIcon className="h-4 w-4" />
            )}
          </button>
        </nav>
      </div>
    </header>
  );
}
