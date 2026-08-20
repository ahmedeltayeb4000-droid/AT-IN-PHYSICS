import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { firebaseAuth } from "../../lib/firebase";
import { AnimatedLogo } from "../brand/AnimatedLogo";
import { MoonIcon, SunIcon } from "../icons/icons";
import { useTheme } from "../theme/ThemeProvider";
import { useTranslation } from "react-i18next";

export function Navbar() {
  const { theme, toggleTheme } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();
  
  // تشغيل أداة الترجمة
  const { t, i18n } = useTranslation();

  // دالة لتغيير اللغة فقط (الاتجاه بيتم التحكم فيه من AppLayout)
  const toggleLanguage = () => {
    const newLang = i18n.language === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(newLang);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(firebaseAuth);
      navigate("/");
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
          <NavLink to="/" className="text-text-muted hover:text-text transition-colors">
            {t('navbar.home')}
          </NavLink>

          {user ? (
            <>
              <Link to="/dashboard" className="text-text-muted hover:text-text transition-colors">
                {t('navbar.dashboard')}
              </Link>
              <button 
                onClick={handleLogout} 
                className="text-text-muted hover:text-red-500 transition-colors"
              >
                {t('navbar.logout')}
              </button>
            </>
          ) : (
            <Link to="/login" className="text-text-muted hover:text-text transition-colors">
              {t('navbar.signIn')}
            </Link>
          )}

          <div className="flex items-center gap-2 border-l border-border pl-4 rtl:border-l-0 rtl:border-r rtl:pl-0 rtl:pr-4">
            <button
              onClick={toggleLanguage}
              className="px-2 py-1 text-xs font-bold rounded bg-panel text-text hover:bg-border transition-colors uppercase"
            >
              {i18n.language === 'ar' ? 'EN' : 'عربي'}
            </button>

            <button
              aria-label="Toggle theme"
              onClick={toggleTheme}
              className="grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-panel hover:text-text transition-colors"
            >
              {theme === "dark" ? (
                <SunIcon className="h-4 w-4" />
              ) : (
                <MoonIcon className="h-4 w-4" />
              )}
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}