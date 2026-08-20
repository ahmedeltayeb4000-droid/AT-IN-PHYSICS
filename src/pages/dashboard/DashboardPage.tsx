import { PageContainer, Section } from "../../components/layout/Primitives";
import { GlassCard } from "../../components/ui/Card";

export function DashboardPage() {
  return (
    <Section className="py-10">
      <PageContainer>
        <h1 className="text-3xl font-bold text-text mb-8">لوحة التحكم</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <GlassCard className="p-6">
            <h3 className="font-bold text-text mb-2">دوراتي الحالية</h3>
            <p className="text-text-muted text-sm">لا توجد دورات مسجلة حالياً.</p>
          </GlassCard>
          
          <GlassCard className="p-6">
            <h3 className="font-bold text-text mb-2">إحصائيات التقدم</h3>
            <p className="text-text-muted text-sm">أكملت 0% من مسارك التعليمي.</p>
          </GlassCard>
          
          <GlassCard className="p-6">
            <h3 className="font-bold text-text mb-2">الشهادات</h3>
            <p className="text-text-muted text-sm">لا توجد شهادات متاحة بعد.</p>
          </GlassCard>
        </div>
      </PageContainer>
    </Section>
  );
}