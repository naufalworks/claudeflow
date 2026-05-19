# Phase 2.2 Components - Quick Reference Guide

## Import Statements

```typescript
// Dashboard Components
import {
  ActivityStream,
  MetricsBar,
  PredictiveStatus
} from '@/components/dashboard';

// Chart Components
import {
  TokenUsageChart,
  LatencyChart,
  CostSavingsChart
} from '@/components/charts';

// Types
import type {
  ActivityEvent,
  MetricsData,
  Prediction,
  TokenUsageDataPoint,
  LatencyDataPoint,
  CostSavingsDataPoint
} from '@/components/dashboard';
```

## Usage Examples

### ActivityStream

```typescript
<ActivityStream
  maxHeight={600}
  autoScroll={true}
  wsUrl="ws://localhost:8080"
  className="my-custom-class"
/>
```

**Features:**
- Real-time event feed via WebSocket
- Filter by account, event type, or search query
- Auto-scroll with pause on hover
- Displays last 1000 events

### MetricsBar

```typescript
<MetricsBar
  metrics={{
    activeRequests: 12,
    avgLatency: 650,
    successRate: 98.5,
    nextQuotaReset: new Date(Date.now() + 7200000).toISOString(),
  }}
  wsUrl="ws://localhost:8080"
/>
```

**Metrics Thresholds:**
- Active Requests: >50 critical, >20 warning
- Latency: >2000ms critical, >1000ms warning
- Success Rate: <90% critical, <95% warning
- Quota Reset: <1h critical, <6h warning

### PredictiveStatus

```typescript
const [predictions, setPredictions] = useState<Prediction[]>([
  {
    id: "pred-1",
    type: "quota_exhaustion",
    severity: "high",
    title: "Quota Exhaustion Warning",
    message: "Account will exhaust quota in 2 hours",
    actionLabel: "View Account",
    onAction: () => console.log("Action clicked"),
    timestamp: new Date().toISOString(),
  }
]);

<PredictiveStatus
  predictions={predictions}
  onDismiss={(id) => setPredictions(prev => prev.filter(p => p.id !== id))}
  autoDismissDelay={10000}
/>
```

**Prediction Types:**
- `quota_exhaustion` - Quota running low
- `token_expiry` - API token expiring soon
- `performance_degradation` - Performance issues detected

**Severity Levels:**
- `low` - Blue (informational)
- `medium` - Yellow (warning)
- `high` - Red (critical)

### TokenUsageChart

```typescript
const tokenData: TokenUsageDataPoint[] = [
  {
    timestamp: "2026-05-11T06:00:00Z",
    inputTokens: 45000,
    outputTokens: 23000,
    cacheTokens: 12000,
  },
  // ... more data points
];

<TokenUsageChart data={tokenData} />
```

### LatencyChart

```typescript
const latencyData: LatencyDataPoint[] = [
  {
    timestamp: "2026-05-11T06:00:00Z",
    p50: 450,
    p95: 850,
    p99: 1200,
  },
  // ... more data points
];

<LatencyChart data={latencyData} />
```

### CostSavingsChart

```typescript
const costData: CostSavingsDataPoint[] = [
  {
    accountId: "acc-001",
    costSaved: 45.32,
    cacheHitRate: 78.5,
    totalRequests: 1250,
  },
  // ... more accounts
];

<CostSavingsChart data={costData} />
```

## WebSocket Integration

All real-time components use the `useWebSocket` hook:

```typescript
import { useWebSocket } from '@/hooks/useWebSocket';

const { isConnected, status } = useWebSocket({
  url: 'ws://localhost:8080',
  channels: ['usage', 'quota', 'accounts'],
  autoConnect: true,
  onUsageEvent: (message) => {
    // Handle usage events
  },
  onQuotaUpdate: (message) => {
    // Handle quota updates
  },
  onAccountStatus: (message) => {
    // Handle account status changes
  },
});
```

## Styling Customization

All components accept a `className` prop for custom styling:

```typescript
<ActivityStream
  className="shadow-lg rounded-xl border-2 border-brand-500"
/>
```

Components use Tailwind CSS with design tokens:
- `--text-main`, `--text-muted` - Text colors
- `--surface`, `--surface-2` - Background colors
- `--border-subtle` - Border colors
- `--brand-500` - Brand color
- `--shadow-soft`, `--shadow-warm` - Shadows

## Responsive Behavior

- **MetricsBar**: Stacks vertically on mobile, horizontal on desktop
- **ActivityStream**: Filters stack on mobile, inline on tablet+
- **Charts**: Responsive containers adapt to parent width
- All components support mobile touch interactions

## Performance Notes

- ActivityStream limits to 1000 events in memory
- Charts use Recharts' built-in optimization
- Animations are GPU-accelerated via Framer Motion
- WebSocket connections are shared via singleton pattern
- Memoized computations prevent unnecessary re-renders

## Accessibility

- Semantic HTML structure
- ARIA labels on interactive elements
- Keyboard navigation support
- Sufficient color contrast ratios
- Screen reader friendly

## Complete Example

See `/web/src/examples/AnalyticsDashboardExample.tsx` for a full working example integrating all components.
