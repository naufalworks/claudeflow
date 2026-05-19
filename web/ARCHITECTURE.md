# ClaudeFlow Web UI Architecture

## Overview

ClaudeFlow Web UI is a modern, real-time dashboard for monitoring and managing Claude API accounts. Built with Next.js 16 (App Router), React 19, and TypeScript, it provides a terminal-inspired interface with WebSocket-powered live updates.

## Technology Stack

### Core Framework
- **Next.js 16.2.6** - React framework with App Router
- **React 19.2.4** - UI library with concurrent features
- **TypeScript 5.7.3** - Type-safe development

### Styling & UI
- **Tailwind CSS v4** - Utility-first CSS framework
- **Framer Motion 12.0.0** - Animation library
- **Material Symbols** - Icon system

### State Management
- **Zustand 5.0.2** - Lightweight state management
- **React hooks** - Local component state

### Data & API
- **WebSocket** - Real-time updates
- **Fetch API** - HTTP requests with retry logic
- **Recharts 2.15.0** - Data visualization

### Developer Tools
- **Jest 29.7.0** - Unit testing
- **React Testing Library 16.1.0** - Component testing
- **Playwright 1.49.1** - E2E testing
- **ESLint** - Code linting

---

## Directory Structure

```
web/
├── app/                          # Next.js App Router pages
│   ├── dashboard/                # Protected dashboard routes
│   │   ├── accounts/             # Account management page
│   │   ├── activity/             # Activity stream page
│   │   ├── analytics/            # Analytics & charts page
│   │   ├── settings/             # Settings page
│   │   ├── layout.tsx            # Dashboard layout with sidebar
│   │   └── page.tsx              # Main dashboard page
│   ├── login/                    # Authentication page
│   │   └── page.tsx              # Login form
│   ├── layout.tsx                # Root layout
│   └── globals.css               # Global styles
│
├── src/
│   ├── components/               # React components
│   │   ├── auth/                 # Authentication components
│   │   │   ├── AuthGuard.tsx     # Route protection
│   │   │   └── index.ts          # Exports
│   │   ├── charts/               # Chart components
│   │   │   ├── CostSavingsChart.tsx
│   │   │   ├── LatencyChart.tsx
│   │   │   └── TokenUsageChart.tsx
│   │   ├── dashboard/            # Dashboard-specific components
│   │   │   ├── AccountCard.tsx   # Account status card
│   │   │   ├── AccountCardSkeleton.tsx
│   │   │   ├── AccountDetailsModal.tsx
│   │   │   ├── AccountGrid.tsx   # Bento grid layout
│   │   │   ├── ActivityStream.tsx
│   │   │   ├── CommandPalette.tsx
│   │   │   ├── KeyboardShortcutsModal.tsx
│   │   │   ├── MetricsBar.tsx
│   │   │   ├── PredictiveStatus.tsx
│   │   │   ├── QuotaGauge.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── index.ts
│   │   ├── onboarding/           # Onboarding tour
│   │   │   └── OnboardingTour.tsx
│   │   ├── providers/            # Context providers
│   │   │   ├── ThemeProvider.tsx
│   │   │   └── ToastProvider.tsx
│   │   ├── ui/                   # Base UI components
│   │   │   ├── Badge.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Skeleton.tsx
│   │   │   └── Toast.tsx
│   │   └── ErrorBoundary.tsx     # Error handling
│   │
│   ├── hooks/                    # Custom React hooks
│   │   ├── useAccounts.ts        # Account data fetching
│   │   ├── useAnalytics.ts       # Analytics data
│   │   ├── useKeyboardShortcuts.ts
│   │   ├── useToast.ts           # Toast notifications
│   │   └── useWebSocket.ts       # WebSocket connection
│   │
│   ├── lib/                      # Utility libraries
│   │   ├── api-client.ts         # API client with retry logic
│   │   ├── utils.ts              # Utility functions
│   │   └── websocket-client.ts   # WebSocket client
│   │
│   ├── store/                    # Zustand stores
│   │   ├── accounts-store.ts     # Account state
│   │   ├── auth-store.ts         # Authentication state
│   │   └── ui-store.ts           # UI state (theme, modals)
│   │
│   └── __tests__/                # Test files
│       ├── components/           # Component tests
│       ├── hooks/                # Hook tests
│       └── store/                # Store tests
│
├── e2e/                          # End-to-end tests
│   ├── auth.spec.ts
│   ├── accounts.spec.ts
│   └── dashboard.spec.ts
│
├── public/                       # Static assets
├── middleware.ts                 # Next.js middleware (auth)
├── next.config.ts                # Next.js configuration
├── tailwind.config.js            # Tailwind configuration
├── jest.config.js                # Jest configuration
├── playwright.config.ts          # Playwright configuration
└── package.json                  # Dependencies
```

---

## State Management

### Zustand Stores

#### 1. Auth Store (`auth-store.ts`)
Manages authentication state with localStorage persistence.

```typescript
interface AuthState {
  apiKey: string | null;
  isAuthenticated: boolean;
  login: (apiKey: string) => void;
  logout: () => void;
  setAuthCookie: (apiKey: string) => void;
}
```

**Features:**
- API key storage in localStorage
- Cookie sync for middleware
- Auto-rehydration on page load
- Logout with cleanup

#### 2. Accounts Store (`accounts-store.ts`)
Manages account data with WebSocket updates.

```typescript
interface AccountsState {
  accounts: Account[];
  loading: boolean;
  error: string | null;
  setAccounts: (accounts: Account[]) => void;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  removeAccount: (id: string) => void;
}
```

**Features:**
- Real-time account updates via WebSocket
- Optimistic updates
- Error handling
- Account CRUD operations

#### 3. UI Store (`ui-store.ts`)
Manages UI state (theme, modals, sidebar).

```typescript
interface UIState {
  theme: 'dark' | 'light';
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  keyboardShortcutsModalOpen: boolean;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}
```

**Features:**
- Theme persistence
- Modal state management
- Sidebar collapse state
- Global UI controls

---

## API Integration

### API Client (`api-client.ts`)

Centralized API client with authentication, retry logic, and error handling.

**Features:**
- Automatic Authorization header injection
- Exponential backoff retry (1s, 2s, 4s)
- Circuit breaker pattern (opens after 5 failures)
- Request deduplication for GET requests
- Auto-logout on 401/403 responses

**Endpoints:**
```typescript
GET  /api/dashboard/accounts       // List all accounts
GET  /api/dashboard/accounts/:id   // Get account details
GET  /api/dashboard/activity       // Recent activity
GET  /api/dashboard/stats          // Summary stats
POST /api/dashboard/accounts/:id/refresh  // Refresh token
GET  /health                       // Health check
```

**Usage:**
```typescript
import { apiClient } from '@/lib/api-client';

const accounts = await apiClient.get('/api/dashboard/accounts');
```

---

## WebSocket Integration

### WebSocket Client (`websocket-client.ts`)

Real-time updates with automatic reconnection and polling fallback.

**Features:**
- Exponential backoff reconnection (1s, 2s, 4s, 8s, 16s)
- Health checks (ping/pong every 30s)
- Polling fallback (10s interval)
- Channel subscriptions
- Event handlers

**Channels:**
- `usage` - Token usage updates
- `quota` - Quota changes
- `accounts` - Account status changes
- `activity` - Activity events

**Usage:**
```typescript
import { useWebSocket } from '@/hooks/useWebSocket';

const { connected, subscribe } = useWebSocket();

useEffect(() => {
  const unsubscribe = subscribe('accounts', (data) => {
    console.log('Account update:', data);
  });
  return unsubscribe;
}, [subscribe]);
```

---

## Authentication Flow

### 1. Login Process
```
User enters API key
  ↓
Validate format
  ↓
Test with /health endpoint
  ↓
Store in localStorage + cookie
  ↓
Redirect to /dashboard
```

### 2. Route Protection
```
Request to /dashboard/*
  ↓
Middleware checks cookie
  ↓
AuthGuard checks localStorage
  ↓
If authenticated: render page
If not: redirect to /login
```

### 3. API Request Flow
```
Component calls apiClient.get()
  ↓
Add Authorization header from localStorage
  ↓
Send request
  ↓
If 401/403: auto-logout + redirect
If success: return data
If error: retry with backoff
```

### 4. Logout Process
```
User clicks logout
  ↓
Clear localStorage
  ↓
Clear cookie
  ↓
Clear Zustand stores
  ↓
Redirect to /login
```

---

## Component Hierarchy

```
RootLayout (app/layout.tsx)
├── ThemeProvider
└── ToastProvider
    └── Page Content
        └── DashboardLayout (app/dashboard/layout.tsx)
            ├── AuthGuard
            │   └── ErrorBoundary
            │       ├── Sidebar
            │       ├── Main Content (with page transitions)
            │       ├── CommandPalette
            │       ├── KeyboardShortcutsModal
            │       └── OnboardingTour
            └── Dashboard Pages
                ├── /dashboard (Main)
                │   ├── MetricsBar
                │   ├── AccountGrid
                │   │   └── AccountCard[]
                │   └── ActivityStream
                ├── /dashboard/accounts
                │   └── Account Table
                ├── /dashboard/analytics
                │   ├── TokenUsageChart
                │   ├── LatencyChart
                │   └── CostSavingsChart
                ├── /dashboard/activity
                │   └── ActivityStream (full page)
                └── /dashboard/settings
                    └── Settings Form
```

---

## Performance Optimizations

### 1. Code Splitting
- Dynamic imports for heavy components (charts, modals)
- Route-based code splitting via Next.js App Router
- Lazy loading for below-the-fold content

### 2. Bundle Optimization
- Tree-shaking for unused exports
- Optimal chunking strategy
- Bundle analysis with `@next/bundle-analyzer`

### 3. Loading States
- Skeleton loaders for async content
- Suspense boundaries for lazy components
- Progressive loading for charts

### 4. Error Handling
- Error boundaries at layout and component level
- Graceful degradation for failed requests
- Retry logic with exponential backoff

### 5. Network Optimization
- Request deduplication
- Circuit breaker pattern
- WebSocket with polling fallback
- Optimistic updates

---

## Design System

### Color Palette (Terminal-Inspired)
```css
--bg: #0a0a0a           /* Background */
--surface: #141414      /* Cards, modals */
--surface-2: #1a1a1a    /* Hover states */
--surface-3: #242424    /* Active states */
--border: #2a2a2a       /* Borders */
--text-main: #e5e5e5    /* Primary text */
--text-muted: #888888   /* Secondary text */
--brand-500: #3b82f6    /* Primary brand */
--brand-600: #2563eb    /* Brand hover */
```

### Typography
- **Sans:** Geist Sans (body text)
- **Mono:** Geist Mono (code, metrics)
- **Icons:** Material Symbols Outlined

### Spacing Scale
- Base unit: 4px
- Scale: 4, 8, 12, 16, 24, 32, 48, 64

### Border Radius
- Small: 6px (badges, kbd)
- Medium: 10px (buttons, inputs, cards)
- Large: 16px (modals)

---

## Testing Strategy

### Unit Tests (Jest + RTL)
- Component rendering
- User interactions
- Hook behavior
- Store mutations

### Integration Tests
- API client with mocked fetch
- WebSocket connection
- Authentication flow
- Error handling

### E2E Tests (Playwright)
- Critical user flows
- Cross-browser testing
- Visual regression testing
- Performance benchmarks

**Coverage Target:** >70% for critical paths

---

## Accessibility

### WCAG AA Compliance
- Color contrast ratios meet standards
- Keyboard navigation support
- ARIA labels on interactive elements
- Focus indicators visible
- Screen reader announcements

### Keyboard Shortcuts
- `Cmd/Ctrl + K` - Command palette
- `?` - Keyboard shortcuts help
- `Escape` - Close modals
- `Tab` - Navigate elements
- Arrow keys - Navigate lists

---

## Security Considerations

### Authentication
- API key stored in localStorage (client-side only)
- Cookie for middleware (httpOnly not possible in client-side Next.js)
- No sensitive data in URL params
- Auto-logout on token expiry

### API Security
- Authorization header on all requests
- Rate limiting (100 req/min)
- CORS configuration
- Input validation

### XSS Prevention
- React's built-in XSS protection
- No `dangerouslySetInnerHTML`
- Sanitized user inputs
- CSP headers (production)

---

## Future Enhancements

### Planned Features
1. Service Worker for offline support
2. Virtual scrolling for large lists (>100 items)
3. Image optimization (WebP format)
4. Prefetching for next page data
5. CDN for static assets
6. Real User Monitoring (RUM)
7. Automated performance budgets

### Potential Improvements
- Multi-user support with roles
- Account sharing/collaboration
- Advanced analytics (ML-powered insights)
- Custom dashboards
- Export/import configurations
- Webhook integrations

---

## Contributing

### Development Workflow
1. Create feature branch from `main`
2. Write code with tests
3. Run linter: `npm run lint`
4. Run tests: `npm test`
5. Build: `npm run build`
6. Create PR with description

### Code Style
- TypeScript strict mode
- ESLint + Prettier
- Functional components with hooks
- Named exports (no default exports for components)
- JSDoc comments for public APIs

### Commit Convention
```
feat: Add new feature
fix: Fix bug
docs: Update documentation
style: Format code
refactor: Refactor code
test: Add tests
chore: Update dependencies
```

---

## Resources

- [Next.js 16 Documentation](https://nextjs.org/docs)
- [React 19 Documentation](https://react.dev)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Zustand Documentation](https://zustand-demo.pmnd.rs)
- [Framer Motion](https://www.framer.com/motion)
- [Playwright](https://playwright.dev)

---

**Last Updated:** 2026-05-11
