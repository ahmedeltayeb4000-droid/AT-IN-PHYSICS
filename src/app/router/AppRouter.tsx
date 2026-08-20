import { Navigate, Routes, Route } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { AppLayout } from "../AppLayout";
import { HomePage } from "../../pages/home/HomePage";
import { CourseDetailPage } from "../../pages/courses/CourseDetailPage";
import { LoginPage } from "../../pages/auth/LoginPage";
import { RegisterPage } from "../../pages/auth/RegisterPage";
import { ForgotPasswordPage } from "../../pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../../pages/auth/ResetPasswordPage";
import { DashboardPage } from "../../pages/dashboard/DashboardPage";
import { SplashScreen } from "../../pages/splash/SplashScreen";
import { NotFoundPage } from "../../pages/not-found/NotFoundPage";
import { AuthGuard, PublicOnlyRoute } from "../../features/auth/AuthGuards";

export function AppRouter() {
  return (
    <AnimatePresence mode="wait">
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="courses/:slug" element={<CourseDetailPage />} />
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
        </Route>
        <Route path="/splash" element={<SplashScreen />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AnimatePresence>
  );
}
