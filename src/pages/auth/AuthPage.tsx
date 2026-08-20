import { useState } from "react";
import { PageContainer, Section } from "../../components/layout/Primitives";
import { GlassCard } from "../../components/ui/Card";

export function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);

  return (
    <Section className="flex items-center justify-center min-h-[80vh]">
      <PageContainer className="max-w-md">
        <GlassCard className="p-8">
          <h2 className="text-3xl font-bold text-center mb-6 text-text">
            {isLogin ? "تسجيل الدخول" : "إنشاء حساب جديد"}
          </h2>
          <div className="space-y-4">
            <input type="email" placeholder="البريد الإلكتروني" className="w-full p-3 rounded-lg bg-panel border border-border" />
            <input type="password" placeholder="البريد الإلكتروني" className="w-full p-3 rounded-lg bg-panel border border-border" />
            <button className="w-full py-3 bg-accent text-white rounded-lg font-bold">
              {isLogin ? "دخول" : "تسجيل"}
            </button>
          </div>
          <p className="mt-6 text-center text-sm text-text-muted cursor-pointer" onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? "ليس لديك حساب؟ سجل الآن" : "لديك حساب بالفعل؟ سجل دخولك"}
          </p>
        </GlassCard>
      </PageContainer>
    </Section>
  );
}