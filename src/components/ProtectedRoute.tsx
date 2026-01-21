import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  requireVerification?: boolean;
  requireAdmin?: boolean;
}

export const ProtectedRoute = ({
  children,
  requireVerification = false,
  requireAdmin = false,
}: ProtectedRouteProps) => {
  const { user, isLoading, isVerified, isAdmin, profile } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gold animate-spin" />
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Need admin but user is not admin
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/map" replace />;
  }

  // Need verification but user is not verified
  if (requireVerification && !isVerified) {
    // Check if user is blocked
    if (profile?.verification_status === 'blocked' || profile?.verification_status === 'manual_review') {
      return <Navigate to="/verification" replace />;
    }
    return <Navigate to="/verification" replace />;
  }

  return <>{children}</>;
};
