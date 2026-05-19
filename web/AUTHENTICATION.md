# ClaudeFlow Authentication System

## Overview

Complete authentication and routing system for the ClaudeFlow web dashboard. All dashboard pages are now protected and require API key authentication.

## Features Implemented

### 1. Login Page (`/login`)
- **Location**: `/web/app/login/page.tsx`
- **Features**:
  - Terminal-inspired design matching the dashboard aesthetic
  - API key input with password masking
  - Real-time validation and error handling
  - Tests API key validity with health check before storing
  - Auto-redirects to dashboard if already authenticated
  - Smooth animations with Framer Motion
  - Security info box explaining local storage

### 2. Protected Routes
- **Middleware**: `/web/middleware.ts`
  - Server-side route protection using Next.js middleware
  - Checks authentication cookie before rendering pages
  - Redirects unauthenticated users to `/login`
  - Redirects authenticated users away from `/login` to `/dashboard`
  - Preserves intended destination in redirect URL

- **AuthGuard**: `/web/src/components/auth/AuthGuard.tsx`
  - Client-side authentication verification
  - Double-checks localStorage auth state
  - Shows loading spinner during verification
  - Prevents flash of protected content

### 3. API Authentication
- **Location**: `/web/src/lib/api-client.ts`
- **Changes**:
  - Dynamically reads API key from localStorage (auth store)
  - Automatically adds `Authorization: Bearer <key>` header to all requests
  - Handles 401/403 responses with automatic logout and redirect
  - Maintains existing retry logic for network errors

### 4. Auth State Management
- **Location**: `/web/src/store/auth-store.ts`
- **Features**:
  - Zustand store with localStorage persistence
  - Cookie synchronization for middleware compatibility
  - `login(apiKey)` - Validates and stores API key
  - `logout()` - Clears auth state and redirects
  - `checkAuth()` - Verifies current auth status

### 5. Logout Functionality
- **Location**: `/web/src/components/dashboard/Sidebar.tsx`
- **Features**:
  - Logout button at bottom of sidebar
  - Red hover effect for clear visual feedback
  - Respects sidebar collapsed/expanded state
  - Clears all auth data and redirects to login

## Authentication Flow

### First-Time Login
```
1. User visits /dashboard (not authenticated)
2. Middleware detects no auth cookie → redirect to /login
3. User enters API key
4. Login page validates format
5. Health check API call tests the key
6. On success:
   - Store API key in localStorage
   - Set auth cookie
   - Redirect to /dashboard
7. On failure:
   - Clear any stored auth
   - Show error message
```

### Subsequent Visits
```
1. User visits /dashboard
2. Middleware checks auth cookie → allow access
3. AuthGuard checks localStorage → verified
4. Dashboard renders
5. All API calls include Authorization header from localStorage
```

### Session Expiry / Invalid Key
```
1. API request returns 401/403
2. API client detects auth error
3. Clear localStorage and cookie
4. Redirect to /login
5. User must re-authenticate
```

### Logout
```
1. User clicks logout button
2. authStore.logout() called
3. Clear localStorage
4. Clear auth cookie
5. Redirect to /login
6. Middleware prevents access to protected routes
```

## Security Considerations

- **API Key Storage**: Stored in browser localStorage (client-side only)
- **Cookie**: Used only for middleware routing, not for API authentication
- **No Server Storage**: API key never sent to external servers
- **Automatic Cleanup**: Auth cleared on 401/403 responses
- **Password Masking**: API key input uses type="password"
- **Cookie Security**: SameSite=Lax, 1-year expiry

## File Structure

```
web/
├── app/
│   ├── login/
│   │   └── page.tsx              # Login page component
│   └── dashboard/
│       └── layout.tsx            # Protected with AuthGuard
├── middleware.ts                 # Server-side route protection
└── src/
    ├── components/
    │   ├── auth/
    │   │   ├── AuthGuard.tsx     # Client-side auth verification
    │   │   └── index.ts          # Auth component exports
    │   └── dashboard/
    │       └── Sidebar.tsx       # Includes logout button
    ├── lib/
    │   └── api-client.ts         # API authentication logic
    └── store/
        └── auth-store.ts         # Auth state management
```

## Testing the Authentication Flow

### Test 1: Unauthenticated Access
```bash
# Clear browser storage
localStorage.clear()
document.cookie = 'claudeflow-auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT'

# Navigate to dashboard
window.location.href = '/dashboard'

# Expected: Redirect to /login
```

### Test 2: Valid Login
```bash
# On /login page, enter valid API key
# Expected: Redirect to /dashboard
# Verify: localStorage has 'claudeflow-auth' item
# Verify: Cookie 'claudeflow-auth=true' is set
```

### Test 3: Invalid Login
```bash
# On /login page, enter invalid API key
# Expected: Error message displayed
# Verify: No localStorage or cookie set
```

### Test 4: Authenticated Access
```bash
# After successful login, refresh page
# Expected: Stay on /dashboard
# Verify: No redirect to /login
```

### Test 5: Logout
```bash
# Click logout button in sidebar
# Expected: Redirect to /login
# Verify: localStorage cleared
# Verify: Cookie cleared
```

### Test 6: API Error Handling
```bash
# Simulate 401 response from API
# Expected: Automatic logout and redirect to /login
# Verify: Auth state cleared
```

## Development

### Start Dev Server
```bash
cd web
npm run dev
```

### Build for Production
```bash
cd web
npm run build
```

### Environment Variables
```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:20129
```

## Troubleshooting

### Issue: Redirect loop between /login and /dashboard
**Solution**: Clear browser storage and cookies, then try again.

### Issue: API calls return 401 but no redirect
**Solution**: Check that api-client.ts is properly handling auth errors.

### Issue: Middleware not protecting routes
**Solution**: Verify cookie is being set in auth-store.ts setAuthCookie() function.

### Issue: Flash of protected content before redirect
**Solution**: AuthGuard component should show loading state while checking auth.

## Next Steps

- Add "Remember me" functionality (already supported by localStorage persistence)
- Add API key validation format checking
- Add rate limiting for login attempts
- Add session timeout warnings
- Add multi-factor authentication support
- Add API key rotation functionality

## Notes

- Next.js 16 shows a deprecation warning for middleware - this is expected and will be addressed in future Next.js updates
- The authentication system uses both cookies (for middleware) and localStorage (for API calls) to provide comprehensive protection
- All dashboard routes (`/dashboard/*`) are automatically protected by the layout's AuthGuard component
