import { test, expect } from '@playwright/test';

test.describe('ClaudeFlow Web UI - All Pages Verification', () => {
  test.beforeEach(async ({ page }) => {
    // Login with API key
    await page.goto('/login');
    // The input has type="password" and placeholder="Enter your ClaudeFlow API key"
    await page.fill('input[type="password"]', 'claudeflow-dev-key');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });
  });

  test('Dashboard page loads and fetches data', async ({ page }) => {
    await page.goto('/dashboard');

    // Wait for page to load
    await expect(page.locator('h1')).toContainText('Dashboard');

    // Check for metrics bar by looking for metric labels
    await page.waitForSelector('text=/Active Requests/i', { timeout: 10000 });

    // Wait for either account cards or empty state to appear
    // Account cards have aria-label="Account {id}"
    const accountCards = page.locator('[role="article"][aria-label^="Account "]');
    const emptyState = page.getByText(/no accounts configured/i);

    // Wait for either articles to appear OR empty state to be visible
    try {
      await Promise.race([
        accountCards.first().waitFor({ state: 'visible', timeout: 10000 }),
        emptyState.waitFor({ state: 'visible', timeout: 10000 })
      ]);
    } catch {
      // If neither appears within timeout, the test will fail below
    }

    // Check what we have
    const cardCount = await accountCards.count();
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    // Should have either cards or empty state
    expect(cardCount > 0 || hasEmptyState).toBe(true);

    console.log('✅ Dashboard page loaded successfully');
  });

  test('Accounts page loads', async ({ page }) => {
    await page.goto('/dashboard/accounts');

    // Wait for page to load
    await expect(page.locator('h1')).toContainText(/accounts/i);

    console.log('✅ Accounts page loaded successfully');
  });

  test('Analytics page loads and fetches analytics data', async ({ page }) => {
    await page.goto('/dashboard/analytics');

    // Wait for page to load
    await expect(page.locator('h1')).toContainText(/analytics/i);

    // Wait for analytics content to load (charts, metrics, etc.)
    await page.waitForTimeout(2000);

    console.log('✅ Analytics page loaded successfully');
  });

  test('Activity page loads', async ({ page }) => {
    await page.goto('/dashboard/activity');

    // Wait for page to load
    await expect(page.locator('h1')).toContainText(/activity/i);

    console.log('✅ Activity page loaded successfully');
  });

  test('Settings page loads', async ({ page }) => {
    await page.goto('/dashboard/settings');

    // Wait for page to load
    await expect(page.locator('h1')).toContainText(/settings/i);

    console.log('✅ Settings page loaded successfully');
  });

  test('Check for analytics API errors in console', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/dashboard');
    await page.waitForTimeout(3000);

    // Check if there are any analytics-related errors
    const analyticsErrors = consoleErrors.filter(err =>
      err.includes('analytics') || err.includes('404') || err.includes('Failed to fetch')
    );

    if (analyticsErrors.length > 0) {
      console.log('❌ Console errors found:', analyticsErrors);
    } else {
      console.log('✅ No analytics errors in console');
    }

    expect(analyticsErrors.length).toBe(0);
  });
});
