import { Navigate, Routes, Route } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { AppLayout } from "../AppLayout";
import { HomePage } from "../../pages/home/HomePage";
import { CourseDetailPage } from "../../pages/courses/CourseDetailPage";
import { SessionDetailPage } from "../../pages/courses/SessionDetailPage";
import { LoginPage } from "../../pages/auth/LoginPage";
import { RegisterPage } from "../../pages/auth/RegisterPage";
import { ForgotPasswordPage } from "../../pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../../pages/auth/ResetPasswordPage";
import { DashboardPage } from "../../pages/dashboard/DashboardPage";
import { SplashScreen } from "../../pages/splash/SplashScreen";
import { NotFoundPage } from "../../pages/not-found/NotFoundPage";
import {
  AuthGuard,
  OwnerGuard,
  PublicOnlyRoute,
} from "../../features/auth/AuthGuards";
import { AdminLayout } from "../../pages/admin/AdminLayout";
import { AdminOverviewPage } from "../../pages/admin/AdminOverviewPage";
import { AdminCoursesPage } from "../../pages/admin/AdminCoursesPage";

export function AppRouter() {
  return (
    <AnimatePresence mode="wait">
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="courses/:slug" element={<CourseDetailPage />} />
          <Route
            path="courses/:slug/modules/:moduleId/sessions/:sessionId"
            element={<SessionDetailPage />}
          />
          <Route path="auth" element={<Navigate to="/login" replace />} />
          <Route
            path="login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="register"
            element={
              <PublicOnlyRoute>
                <RegisterPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="forgot-password"
            element={
              <PublicOnlyRoute>
                <ForgotPasswordPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="reset-password"
            element={
              <PublicOnlyRoute>
                <ResetPasswordPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="dashboard"
            element={
              <AuthGuard>
                <DashboardPage />
              </AuthGuard>
            }
          />
          <Route
            path="admin"
            element={
              <OwnerGuard>
                <AdminLayout />
              </OwnerGuard>
            }
          >
            <Route index element={<AdminOverviewPage />} />
            <Route path="courses" element={<AdminCoursesPage />} />
          </Route>
        </Route>
        <Route path="/splash" element={<SplashScreen />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AnimatePresence>
  );
}
