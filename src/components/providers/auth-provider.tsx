'use client';

import { createContext, useContext, useEffect, useRef } from 'react';
import { useRouter, usePathname } from '@/i18n/routing';
import { createClient } from '@/utils/supabase/client';
import { ROUTES } from '@/constants';
import { toast } from 'sonner';

const AuthContext = createContext({});

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const hasShownVerificationToast = useRef(false);
  const previousEmailConfirmedAt = useRef<string | null>(null);

  useEffect(() => {
    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          // Reset state on sign out
          hasShownVerificationToast.current = false;
          previousEmailConfirmedAt.current = null;
          
          // Only redirect to login if we're not already on a public auth page
          // This prevents infinite redirects or interrupting password reset flow
          // The usePathname hook removes the locale prefix, so we check against pure paths
          const isPublicAuthPage = Object.values(ROUTES.AUTH).some(route => 
            pathname.startsWith(route)
          );
          
          if (!isPublicAuthPage) {
            router.replace(ROUTES.AUTH.LOGIN);
          }
        } 
        
        // Handle email verification - this fires when user clicks verification link
        // The event will be 'SIGNED_IN' with a fresh session after email confirmation
        if (event === 'SIGNED_IN' && session?.user) {
          const user = session.user;
          const emailConfirmedAt = user.email_confirmed_at;
          
          // Check if this is a fresh email verification
          // 1. User has confirmed email (email_confirmed_at exists)
          // 2. We haven't shown the toast yet
          // 3. The confirmation happened recently (within last 30 seconds)
          if (emailConfirmedAt && !hasShownVerificationToast.current) {
            const confirmedTime = new Date(emailConfirmedAt).getTime();
            const now = Date.now();
            const thirtySecondsAgo = now - 30000;
            
            // If email was confirmed in the last 30 seconds, show toast
            if (confirmedTime > thirtySecondsAgo) {
              hasShownVerificationToast.current = true;
              toast.success('Email verified successfully!', {
                duration: 5000,
                id: 'email-verified', // Prevent duplicate toasts
              });
            }
          }
          
          previousEmailConfirmedAt.current = emailConfirmedAt || null;
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, router, pathname]);

  return <AuthContext.Provider value={{}}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
