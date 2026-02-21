import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";

// Eager: páginas de entrada (carga inicial rápida)
import Index from "./pages/Index";
import Login from "./pages/Login";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";

// Lazy: páginas protegidas (se cargan bajo demanda)
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Verification = lazy(() => import("./pages/Verification"));
const MapView = lazy(() => import("./pages/MapView"));
const Chat = lazy(() => import("./pages/Chat"));
const EmergencyChat = lazy(() => import("./pages/EmergencyChat"));
const Profile = lazy(() => import("./pages/Profile"));
const Friends = lazy(() => import("./pages/Friends"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));

const queryClient = new QueryClient();

// Fallback mínimo mientras se descarga el chunk
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-map-bg">
    <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-center" />
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Splash / Entry */}
                <Route path="/" element={<Index />} />

                {/* Onboarding & Auth */}
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/register" element={<Register />} />
                <Route path="/login" element={<Login />} />
                <Route path="/verification" element={<Verification />} />

                {/* Main App - Protected */}
                <Route
                  path="/map"
                  element={
                    <ProtectedRoute requireVerification>
                      <MapView />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/chat"
                  element={
                    <ProtectedRoute requireVerification>
                      <Chat />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/emergency/chat"
                  element={
                    <ProtectedRoute requireVerification>
                      <EmergencyChat />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/profile"
                  element={
                    <ProtectedRoute>
                      <Profile />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/friends"
                  element={
                    <ProtectedRoute requireVerification>
                      <Friends />
                    </ProtectedRoute>
                  }
                />

                {/* Admin - Protected */}
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute requireAdmin>
                      <AdminPanel />
                    </ProtectedRoute>
                  }
                />

                {/* Catch-all */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
