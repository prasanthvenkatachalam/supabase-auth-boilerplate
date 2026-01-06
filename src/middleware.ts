import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { type NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/middleware';

const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  const intlResponse = intlMiddleware(request);
  
  const { supabase, response } = createClient(request, intlResponse);
  
  // Refresh session if needed
  await supabase.auth.getUser();
  
  return response;
}

export const config = {
  matcher: [
    // Next-intl matchers
    '/', 
    '/(de|en)/:path*', 
    
    // Supabase generic matchers (exclude static assets)
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
