# Phase 1.3 Quick Reference Guide

## File Locations

### Zustand Stores
```
/web/src/store/
├── auth-store.ts          # Authentication state
├── accounts-store.ts      # Accounts data management
├── ui-store.ts            # UI preferences (theme, sidebar)
└── index.ts               # Store exports
```

### WebSocket Client
```
/web/src/lib/
├── websocket-client.ts    # Browser WebSocket wrapper
└── index.ts               # Lib exports
```

### Custom Hooks
```
/web/src/hooks/
├── useWebSocket.ts        # WebSocket connection management
├── useAccounts.ts         # Accounts with real-time updates
├── useAnalytics.ts        # Analytics data fetching
└── index.ts               # Hooks exports
```

### Documentation & Examples
```
/web/
├── PHASE_1.3_IMPLEMENTATION.md    # Detailed implementation guide
├── PHASE_1.3_SUMMARY.md           # Executive summary
├── verify-phase-1.3.sh            # Verification script
└── src/examples/
    └── state-management-examples.tsx  # Usage examples
```

## Import Paths

```typescript
// Stores
import { useAuthStore, useAccountsStore, useUIStore } from '@/store';

// Hooks
import { useWebSocket, useAccounts, useAnalytics } from '@/hooks';

// WebSocket Client (direct usage)
import { getWebSocketClient, WebSocketClient } from '@/lib';

// Types
import type { Account, Theme } from '@/store';
import type { Channel, ConnectionStatus, ServerMessage } from '@/lib';
```

## Common Usage Patterns

### 1. Authentication
```typescript
const { apiKey, isAuthenticated, login, logout } = useAuthStore();

// Login
login('sk-ant-api03-...');

// Check auth
if (isAuthenticated) {
  // User is authenticated
}

// Logout
logout();
```

### 2. Real-time Accounts
```typescript
const {
  accounts,
  loading,
  error,
  refetch,
  isConnected
} = useAccounts({
  autoFetch: true,
  enableWebSocket: true,
  websocketUrl: 'ws://localhost:8080',
});

// Manually refresh
await refetch();

// Refresh single account
await refreshAccount('account-id');
```

### 3. Analytics
```typescript
const {
  metrics,
  insights,
  loading,
  error,
  refetch
} = useAnalytics({
  autoFetch: true,
  refreshInterval: 30000, // 30 seconds
});

// Access metrics
console.log(metrics?.totalRequests);
console.log(metrics?.totalCost);

// Access insights
insights.forEach(insight => {
  console.log(insight.type, insight.title);
});
```

### 4. UI State
```typescript
const {
  theme,
  sidebarOpen,
  toggleTheme,
  toggleSidebar
} = useUIStore();

// Toggle theme (light → dark → system → light)
toggleTheme();

// Set specific theme
setTheme('dark');

// Toggle sidebar
toggleSidebar();
```

### 5. Direct WebSocket Usage
```typescript
const {
  status,
  isConnected,
  connect,
  disconnect,
  subscribe
} = useWebSocket({
  url: 'ws://localhost:8080',
  channels: ['usage', 'quota', 'accounts'],
  autoConnect: true,
  onUsageEvent: (message) => {
    console.log('Usage:', message.data);
  },
  onQuotaUpdate: (message) => {
    console.log('Quota:', message.data);
  },
  onAccountStatus: (message) => {
    console.log('Account:', message.data);
  },
});

// Manual connection control
await connect();
disconnect();

// Subscribe to additional channels
subscribe(['usage']);
```

## API Endpoints

### REST API
- `GET /api/accounts` - List all accounts
- `GET /api/accounts/:id` - Get single account
- `GET /admin/analytics` - Get analytics metrics

### WebSocket
- **URL:** `ws://localhost:8080`
- **Channels:** `usage`, `quota`, `accounts`
- **Auth:** Optional token via `authToken` config

## Type Definitions

### Account
```typescript
interface Account {
  id: string;
  email: string;
  status: 'active' | 'inactive' | 'suspended';
  usage?: {
    requests: number;
    tokens: number;
    cost: number;
  };
  quota?: {
    limit: number;
    used: number;
    remaining: number;
  };
  lastUsed?: string;
  createdAt?: string;
}
```

### Analytics Metrics
```typescript
interface AnalyticsMetrics {
  totalRequests?: number;
  totalTokens?: number;
  totalCost?: number;
  averageLatency?: number;
  errorRate?: number;
  activeAccounts?: number;
}
```

### Connection Status
```typescript
type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'polling';
```

### Channels
```typescript
type Channel = 'usage' | 'quota' | 'accounts';
```

## Configuration

### WebSocket Config
```typescript
{
  url: 'ws://localhost:8080',
  authToken?: string,
  heartbeatInterval: 30000,        // 30 seconds
  maxReconnectAttempts: 5,
  initialReconnectDelay: 1000,     // 1 second
  maxReconnectDelay: 30000,        // 30 seconds
  pollingInterval: 5000,           // 5 seconds
  maxSubscriptions: 50,
}
```

### Store Persistence
- **Auth Store:** `localStorage.claudeflow-auth`
- **UI Store:** `localStorage.claudeflow-ui`
- **Accounts Store:** Not persisted (real-time data)

## Verification

Run the verification script:
```bash
cd /Users/azfar.naufal/Documents/router/claudeflow/web
./verify-phase-1.3.sh
```

Build the project:
```bash
npm run build
```

## Troubleshooting

### WebSocket Connection Issues
1. Check if server is running on port 8080
2. Verify WebSocket URL is correct
3. Check browser console for connection errors
4. Verify firewall/proxy settings

### Store Not Persisting
1. Check localStorage is enabled in browser
2. Verify localStorage quota not exceeded
3. Check browser privacy settings

### TypeScript Errors
1. Run `npm run build` to see detailed errors
2. Check `tsconfig.json` path mappings
3. Verify all dependencies are installed

### Hook Not Updating
1. Check dependency arrays in useEffect
2. Verify store subscriptions are active
3. Check for console errors

## Performance Tips

1. **Memoization:** Use `useMemo` for expensive computations
2. **Debouncing:** Debounce frequent updates
3. **Virtual Scrolling:** For large account lists
4. **Code Splitting:** Lazy load components
5. **WebSocket Batching:** Messages are batched by default

## Security Best Practices

1. **API Keys:** Don't commit API keys to version control
2. **HTTPS/WSS:** Use secure protocols in production
3. **Input Validation:** Validate all user inputs
4. **CORS:** Configure proper CORS policies
5. **Authentication:** Implement proper auth flow

## Next Steps

See `PHASE_1.3_IMPLEMENTATION.md` for:
- Detailed API documentation
- Advanced usage patterns
- Testing recommendations
- Integration guidelines

See `PHASE_1.3_SUMMARY.md` for:
- Complete feature list
- Technical specifications
- Quality assurance details
- Future roadmap
