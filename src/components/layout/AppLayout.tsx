import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next"; // 1. استدعاء أداة الترجمة
import { Footer } from "./Footer";
import { Navbar } from "./Navbar";

export function AppLayout() {
  const { i18n } = useTranslation(); // 2. الحصول على الحالة الحالية للغة

  return (
    // 3. إضافة خاصية dir ديناميكية تتغير مع اللغة (rtl للعربي، ltr للإنجليزي)
    <div 
      className="min-h-screen bg-navy text-slate-100" 
      dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}
    >
      <Navbar />
      <main>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}