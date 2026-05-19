# Performance Optimization Verification Guide

## Build Verification

### 1. Build the Project
```bash
cd /Users/azfar.naufal/Documents/router/claudeflow/web
npm run build
```

**Expected Results:**
- ✅ Build completes successfully
- ✅ TypeScript compilation passes
- ✅ All pages generated without errors
- ✅ No critical warnings

### 2. Check Bundle Sizes
```bash
ls -lh .next/static/chunks/
```

**Target Sizes:**
- Main app chunks: <200KB each
- Vendor chunks: <300KB
- Dynamic imports working (separate chunks for charts)

### 3. Run Bundle Analyzer
```bash
npm run analyze
```

**What to Check:**
- Recharts is in separate chunk
- Framer Motion is in separate chunk
- No duplicate dependencies
- Tree shaking working (unused code removed)

## Runtime Verification

### 4. Test Initial Page Load
```bash
npm run build
npm start
# Open http://localhost:3000/dashboard
```

**Performance Targets:**
- Initial load: <2s on fast connection
- Time to Interactive (TTI): <3s
- First Contentful Paint (FCP): <1s

**How to Test:**
1. Open Chrome DevTools
2. Go to Network tab
3. Throttle to "Fast 3G"
4. Hard reload (Cmd+Shift+R)
5. Check load times

### 5. Test Dynamic Imports
**Analytics Page:**
1. Navigate to `/dashboard/analytics`
2. Open Network tab
3. Look for separate chunk loads for:
   - `TokenUsageChart`
   - `LatencyChart`
   - `CostSavingsChart`
4. Verify skeleton loaders appear first

**Dashboard Page:**
1. Navigate to `/dashboard`
2. Check ActivityStream loads separately
3. Verify AccountDetailsModal loads on-demand

### 6. Test Error Boundaries
**Chart Error:**
1. Open browser console
2. Temporarily break a chart component
3. Verify error boundary catches it
4. Check "Try Again" button works

**Component Error:**
1. Break ActivityStream component
2. Verify graceful fallback
3. Check rest of page still works

### 7. Test API Retry Logic
**Simulate Network Failure:**
1. Open DevTools > Network
2. Set to "Offline"
3. Try to load dashboard
4. Set back to "Online"
5. Verify automatic retry works

**Check Circuit Breaker:**
1. Stop the backend server
2. Refresh dashboard multiple times (>5)
3. Verify circuit breaker opens
4. Check error message shows
5. Start backend server
6. Wait 30 seconds
7. Verify circuit breaker closes

### 8. Test WebSocket Reconnection
**Disconnect Test:**
1. Open dashboard
2. Check WebSocket connected (green badge)
3. Disable network
4. Wait 5 seconds
5. Enable network
6. Verify automatic reconnection

**Health Check Test:**
1. Monitor WebSocket in Network tab
2. Check ping/pong messages every 30s
3. Verify connection stays alive

### 9. Test Request Deduplication
**Check Network Tab:**
1. Open DevTools > Network
2. Navigate to dashboard
3. Look for duplicate GET requests
4. Should see only one request per endpoint

### 10. Test Loading States
**Skeleton Loaders:**
1. Throttle network to "Slow 3G"
2. Navigate to dashboard
3. Verify skeleton loaders appear:
   - AccountCardSkeleton for accounts
   - SkeletonChart for analytics
4. Check smooth transition to real content

## Performance Metrics

### Lighthouse Audit
```bash
# Install Lighthouse CLI
npm install -g lighthouse

# Run audit
lighthouse http://localhost:3000/dashboard --view
```

**Target Scores:**
- Performance: >90
- Accessibility: >95
- Best Practices: >90
- SEO: >90

### Core Web Vitals
**Targets:**
- LCP (Largest Contentful Paint): <2.5s
- FID (First Input Delay): <100ms
- CLS (Cumulative Layout Shift): <0.1

## Optimization Checklist

### Code Splitting ✅
- [x] Charts dynamically imported
- [x] ActivityStream lazy loaded
- [x] AccountDetailsModal on-demand
- [x] Skeleton loaders for all heavy components

### Bundle Optimization ✅
- [x] Bundle analyzer installed
- [x] Turbopack configuration added
- [x] Dynamic imports configured
- [x] Tree shaking enabled

### Loading States ✅
- [x] Skeleton component created
- [x] SkeletonChart implemented
- [x] SkeletonCard implemented
- [x] AccountCardSkeleton created
- [x] Smooth transitions added

### Error Boundaries ✅
- [x] ErrorBoundary component created
- [x] ChartErrorBoundary wrapper
- [x] ComponentErrorBoundary wrapper
- [x] Dashboard layout wrapped
- [x] Retry functionality added

### API Optimization ✅
- [x] Circuit breaker pattern implemented
- [x] Request deduplication added
- [x] Exponential backoff (1s, 2s, 4s)
- [x] Max 3 retries per request
- [x] Proper error handling

### WebSocket Optimization ✅
- [x] Connection health checks added
- [x] Heartbeat with pong tracking
- [x] Max 3 missed pongs before reconnect
- [x] Polling interval increased to 10s
- [x] Exponential backoff for reconnection

## Known Issues & Limitations

### Next.js 16 Turbopack
- Webpack config not used (Turbopack default)
- Bundle analyzer works with Turbopack
- Custom webpack optimizations not needed

### Browser Compatibility
- Modern browsers only (ES2020+)
- WebSocket required for real-time updates
- Fallback to polling if WebSocket fails

### Performance Notes
- Initial bundle size depends on dependencies
- Chart libraries (Recharts) are heavy (~150KB)
- Framer Motion adds ~80KB
- Consider removing if not needed

## Troubleshooting

### Build Fails
```bash
# Clear cache and rebuild
rm -rf .next
npm run build
```

### Slow Initial Load
1. Check bundle sizes with analyzer
2. Verify dynamic imports working
3. Check network throttling
4. Verify CDN/compression in production

### WebSocket Not Connecting
1. Check backend server running
2. Verify WebSocket URL correct
3. Check browser console for errors
4. Test with polling fallback

### Charts Not Loading
1. Check Network tab for chunk loads
2. Verify dynamic import syntax
3. Check for JavaScript errors
4. Test with skeleton loader

## Production Deployment

### Before Deploy
1. Run full build: `npm run build`
2. Test production build: `npm start`
3. Run Lighthouse audit
4. Check all pages load correctly
5. Test error boundaries
6. Verify WebSocket reconnection

### Environment Variables
```bash
NEXT_PUBLIC_API_URL=https://api.production.com
NODE_ENV=production
```

### Optimization Recommendations
1. Enable gzip/brotli compression
2. Use CDN for static assets
3. Enable HTTP/2
4. Add service worker for offline support
5. Implement caching strategy
6. Monitor with Real User Monitoring (RUM)

## Success Criteria

All optimizations implemented and verified:
- ✅ Build completes successfully
- ✅ Bundle sizes optimized
- ✅ Dynamic imports working
- ✅ Skeleton loaders showing
- ✅ Error boundaries catching errors
- ✅ API retry logic working
- ✅ WebSocket reconnection working
- ✅ Circuit breaker functioning
- ✅ Request deduplication active
- ✅ Performance targets met
