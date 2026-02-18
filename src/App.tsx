import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Pages
import Index from "./pages/Index";
import Onboarding from "./pages/Onboarding";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Verification from "./pages/Verification";
import MapView from "./pages/MapView";
import Chat from "./pages/Chat";
import EmergencyChat from "./pages/EmergencyChat";
import Profile from "./pages/Profile";
import Friends from "./pages/Friends";
import AdminPanel from "./pages/AdminPanel";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-center" />
      <BrowserRouter>
        <AuthProvider>
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
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
