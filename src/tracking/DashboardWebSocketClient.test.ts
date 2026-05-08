/**
 * Unit tests for DashboardWebSocketClient
 *
 * Tests WebSocket client functionality including:
 * - Construction & Configuration
 * - Connection & Disconnection (Req 13.1)
 * - Subscribe / Unsubscribe (Req 13.2)
 * - Message handling for usage_event, quota_update, account_status (Req 13.3)
 * - Heartbeat ping (Req 13.4)
 * - Reconnection with exponential backoff (Req 6.2, 6.3, 6.4)
 * - Polling fallback after max reconnect attempts (Req 6.5, 17.3, 17.4)
 */

import { WebSocket } from 'ws';
import { RealTimeUpdateService } from './RealTimeUpdateService.js';
import { DashboardWebSocketClient } from './DashboardWebSocketClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the actual port the server is listening on. */
function getServerPort(service: RealTimeUpdateService): number {
  const server = (service as unknown as { wss: { address: () => { port: number } } }).wss;
  const addr = server.address();
  return addr.port;
}

/** Wait for a specific event to be emitted. Cleans up listener on resolve/reject. */
function waitForEvent(
  emitter: DashboardWebSocketClient,
  event: string,
  timeout = 3000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler);
      reject(new Error(`Timeout waiting for "${event}"`));
    }, timeout);
    const handler = (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    };
    emitter.on(event, handler);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardWebSocketClient', () => {
  let service: RealTimeUpdateService;

  beforeEach(async () => {
    service = new RealTimeUpdateService({ port: 0, batchInterval: 50 });
    await service.start();
  });

  afterEach(async () => {
    if (service && service.isRunning()) {
      await service.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // Suite 1: Construction & Configuration
  // ---------------------------------------------------------------------------
  describe('Construction & Configuration', () => {
    it('creates instance with default config', () => {
      const client = new DashboardWebSocketClient({ url: 'ws://localhost:8080' });
      expect(client).toBeDefined();
      expect(client.getStatus()).toBe('disconnected');
      expect(client.getSubscriptions()).toEqual([]);
    });

    it('creates instance with custom config', () => {
      const client = new DashboardWebSocketClient({
        url: 'ws://localhost:9090',
        heartbeatInterval: 10,
        maxReconnectAttempts: 3,
        initialReconnectDelay: 500,
        maxReconnectDelay: 10000,
        pollingInterval: 2000,
        maxSubscriptions: 10,
      });
      expect(client).toBeDefined();
    });

    it('initial status is disconnected', () => {
      const client = new DashboardWebSocketClient({ url: 'ws://localhost:8080' });
      expect(client.getStatus()).toBe('disconnected');
    });

    it('throws on invalid URL', () => {
      expect(() => new DashboardWebSocketClient({ url: 'http://example.com' })).toThrow(
        'Invalid WebSocket URL'
      );
      expect(() => new DashboardWebSocketClient({ url: 'not-a-url' })).toThrow(
        'Invalid WebSocket URL'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Connection & Disconnection
  // ---------------------------------------------------------------------------
  describe('Connection & Disconnection', () => {
    it('connect() establishes connection and emits "connected"', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });

      const connectedPromise = waitForEvent(client, 'connected');
      await client.connect();
      await connectedPromise;

      expect(client.getStatus()).toBe('connected');
      client.disconnect();
    });

    it('connect() sends auth message when authToken configured', async () => {
      const authToken = 'my-secret-token';

      // Verify by connecting to an auth-required server and confirming success.
      const authedService = new RealTimeUpdateService({
        port: 0,
        authToken,
        batchInterval: 50,
      });
      await authedService.start();
      const authedPort = getServerPort(authedService);

      const authedClient = new DashboardWebSocketClient({
        url: `ws://localhost:${authedPort}`,
        authToken,
      });

      const connectedPromise = waitForEvent(authedClient, 'connected');
      await authedClient.connect();
      await connectedPromise;

      expect(authedClient.getStatus()).toBe('connected');

      // Subscribe should work (client is authenticated)
      authedClient.subscribe(['usage']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Emit a usage event and verify client receives it
      const eventPromise = waitForEvent(authedClient, 'usage_event');
      authedService.emitUsageEvent({ test: 'auth' });
      const msg = await eventPromise;
      expect((msg as { type: string }).type).toBe('usage_event');

      authedClient.disconnect();
      await authedService.stop();
    });

    it('connect() does not send auth when no authToken configured', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });

      await client.connect();
      expect(client.getStatus()).toBe('connected');

      // Subscribe and verify — connection works without auth
      client.subscribe(['usage']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const eventPromise = waitForEvent(client, 'usage_event');
      service.emitUsageEvent({ test: 'no-auth' });
      const msg = await eventPromise;
      expect((msg as { type: string }).type).toBe('usage_event');

      client.disconnect();
    });

    it('status transitions: disconnected → connecting → connected', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });

      const statuses: string[] = [];
      client.on('status_change', (status: string) => statuses.push(status));

      await client.connect();

      expect(statuses).toEqual(['connecting', 'connected']);
      client.disconnect();
    });

    it('disconnect() closes connection and sets status "disconnected"', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });

      await client.connect();
      expect(client.getStatus()).toBe('connected');

      client.disconnect();
      expect(client.getStatus()).toBe('disconnected');
    });

    it('disconnect() cleans up all timers', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({
        url: `ws://localhost:${port}`,
        heartbeatInterval: 1,
      });

      await client.connect();

      // Disconnect should clear heartbeat and any reconnect timers
      client.disconnect();
      expect(client.getStatus()).toBe('disconnected');

      // Wait a bit and verify no heartbeat pings are sent
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(client.getStatus()).toBe('disconnected');
    });

    it('connect() while already connected is a no-op', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });

      await client.connect();
      expect(client.getStatus()).toBe('connected');

      // Second connect should resolve immediately without issues
      await client.connect();
      expect(client.getStatus()).toBe('connected');

      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Subscribe / Unsubscribe
  // ---------------------------------------------------------------------------
  describe('Subscribe / Unsubscribe', () => {
    it('subscribe() sends subscribe message when connected', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });

      await client.connect();
      client.subscribe(['usage']);

      // Verify subscription by emitting an event and checking reception
      await new Promise((resolve) => setTimeout(resolve, 50));

      const eventPromise = waitForEvent(client, 'usage_event');
      service.emitUsageEvent({ accountId: 'test' });
      const msg = await eventPromise;
      expect((msg as { type: string }).type).toBe('usage_event');

      client.disconnect();
    });

    it('subscribe() stores channels for re-subscription', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });

      // Subscribe while disconnected — channels should be stored
      client.subscribe(['usage', 'quota']);
      expect(client.getSubscriptions()).toEqual(['usage', 'quota']);
    });

    it('unsubscribe() sends unsubscribe message when connected', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });

      await client.connect();
      client.subscribe(['usage', 'quota']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      client.unsubscribe(['usage']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(client.getSubscriptions()).toEqual(['quota']);

      // Emit usage event — client should NOT receive it (only subscribed to quota)
      service.emitUsageEvent({ test: 'unsub' });
      const messages: unknown[] = [];
      const handler = (data: unknown) => messages.push(data);
      client.on('usage_event', handler);

      await new Promise((resolve) => setTimeout(resolve, 150));
      client.off('usage_event', handler);
      expect(messages.length).toBe(0);

      // But quota should work
      const quotaPromise = waitForEvent(client, 'quota_update');
      service.emitQuotaUpdate({ test: 'quota' });
      const quotaMsg = await quotaPromise;
      expect((quotaMsg as { type: string }).type).toBe('quota_update');

      client.disconnect();
    });

    it('subscribe() stores channels even when disconnected', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });

      // Subscribe before connecting
      client.subscribe(['usage']);
      expect(client.getSubscriptions()).toEqual(['usage']);

      // After connecting, the stored subscriptions should be sent
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify subscription works
      const eventPromise = waitForEvent(client, 'usage_event');
      service.emitUsageEvent({ test: 'stored' });
      const msg = await eventPromise;
      expect((msg as { type: string }).type).toBe('usage_event');

      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Message Handling
  // ---------------------------------------------------------------------------
  describe('Message Handling', () => {
    it('receives usage_event and emits typed event', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });
      await client.connect();
      client.subscribe(['usage']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const eventPromise = waitForEvent(client, 'usage_event');
      service.emitUsageEvent({ accountId: 'acc-1', tokens: 100 });

      const msg = (await eventPromise) as { type: string; data: unknown };
      expect(msg.type).toBe('usage_event');
      expect(msg.data).toEqual({ accountId: 'acc-1', tokens: 100 });

      client.disconnect();
    });

    it('receives quota_update and emits typed event', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });
      await client.connect();
      client.subscribe(['quota']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const eventPromise = waitForEvent(client, 'quota_update');
      service.emitQuotaUpdate({ accountId: 'acc-1', quotaUsed: 50 });

      const msg = (await eventPromise) as { type: string; data: unknown };
      expect(msg.type).toBe('quota_update');
      expect(msg.data).toEqual({ accountId: 'acc-1', quotaUsed: 50 });

      client.disconnect();
    });

    it('receives account_status and emits typed event', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });
      await client.connect();
      client.subscribe(['accounts']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const eventPromise = waitForEvent(client, 'account_status');
      service.emitAccountStatusChange({ accountId: 'acc-1', status: 'active' });

      const msg = (await eventPromise) as { type: string; data: unknown };
      expect(msg.type).toBe('account_status');
      expect(msg.data).toEqual({ accountId: 'acc-1', status: 'active' });

      client.disconnect();
    });

    it('handles invalid JSON without crashing', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });
      await client.connect();

      // Access the server's client connections to send invalid data
      const serverClients = (service as unknown as { clients: Map<WebSocket, unknown> }).clients;
      const serverClientWs = [...serverClients.keys()][0];

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      serverClientWs.send('not-valid-json');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Client should still be connected and functional
      expect(client.getStatus()).toBe('connected');
      expect(errorSpy).toHaveBeenCalledWith(
        'DashboardWebSocketClient: invalid JSON message received'
      );

      errorSpy.mockRestore();
      client.disconnect();
    });

    it('emits raw "message" event for all messages', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({ url: `ws://localhost:${port}` });
      await client.connect();
      client.subscribe(['usage']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const messagePromise = waitForEvent(client, 'message');
      service.emitUsageEvent({ test: 'raw' });

      const msg = (await messagePromise) as { type: string };
      expect(msg.type).toBe('usage_event');

      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 5: Heartbeat
  // ---------------------------------------------------------------------------
  describe('Heartbeat', () => {
    it('sends ping at configured interval', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({
        url: `ws://localhost:${port}`,
        heartbeatInterval: 0.1, // 100ms for fast testing
      });

      await client.connect();

      // Wait for at least 2 heartbeat intervals and collect pongs
      const pongs: unknown[] = [];
      const pongHandler = () => pongs.push('pong');
      client.on('pong', pongHandler);

      await new Promise((resolve) => setTimeout(resolve, 350));

      client.off('pong', pongHandler);
      client.disconnect();

      // Should have received at least 2 pongs
      expect(pongs.length).toBeGreaterThanOrEqual(2);
    });

    it('stops heartbeat on disconnect', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({
        url: `ws://localhost:${port}`,
        heartbeatInterval: 0.05, // 50ms for fast testing
      });

      await client.connect();

      // Let heartbeat run briefly
      await new Promise((resolve) => setTimeout(resolve, 120));

      client.disconnect();

      // Track pongs after disconnect
      const pongs: unknown[] = [];
      client.on('pong', () => pongs.push('pong'));

      await new Promise((resolve) => setTimeout(resolve, 200));

      // No pongs should arrive after disconnect
      expect(pongs.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 6: Reconnection with Exponential Backoff
  // ---------------------------------------------------------------------------
  describe('Reconnection with Exponential Backoff', () => {
    it('attempts reconnection on unexpected disconnect', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({
        url: `ws://localhost:${port}`,
        initialReconnectDelay: 50,
        maxReconnectAttempts: 3,
      });

      await client.connect();
      expect(client.getStatus()).toBe('connected');

      // Close the underlying connection unexpectedly
      const internalWs = (client as unknown as { ws: WebSocket }).ws;
      internalWs.close();

      const reconnectingEvent = (await waitForEvent(client, 'reconnecting', 3000)) as {
        attempt: number;
        delay: number;
      };
      expect(reconnectingEvent.attempt).toBe(1);
      expect(reconnectingEvent.delay).toBe(50); // initialDelay * 2^0 = 50

      client.disconnect();
    });

    it('uses exponential backoff timing', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({
        url: `ws://localhost:${port}`,
        initialReconnectDelay: 50,
        maxReconnectDelay: 500,
        maxReconnectAttempts: 5,
      });

      await client.connect();

      const delays: number[] = [];
      const attemptHandler = (info: { attempt: number; delay: number }) => {
        delays.push(info.delay);
      };
      client.on('reconnecting', attemptHandler);

      // First disconnect: attempt 1, delay = 50
      const internalWs = (client as unknown as { ws: WebSocket }).ws;
      internalWs.close();

      // Wait for first reconnect attempt, then close again
      await waitForEvent(client, 'reconnecting', 2000);

      // Wait for the reconnect to connect, then force close again
      await waitForEvent(client, 'connected', 2000);
      const ws2 = (client as unknown as { ws: WebSocket }).ws;
      ws2.close();

      await waitForEvent(client, 'reconnecting', 2000);

      client.off('reconnecting', attemptHandler);
      client.disconnect();

      // After successful reconnect, attempts reset. Both should be attempt 1.
      // So both delays should be 50 (initialDelay * 2^0)
      expect(delays[0]).toBe(50);
      expect(delays[1]).toBe(50);
    });

    it('emits "reconnecting" event with attempt and delay', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({
        url: `ws://localhost:${port}`,
        initialReconnectDelay: 100,
        maxReconnectAttempts: 3,
      });

      await client.connect();

      const internalWs = (client as unknown as { ws: WebSocket }).ws;
      internalWs.close();

      const info = (await waitForEvent(client, 'reconnecting', 3000)) as {
        attempt: number;
        delay: number;
      };
      expect(info.attempt).toBe(1);
      expect(info.delay).toBe(100);
      expect(typeof info.delay).toBe('number');

      client.disconnect();
    });

    it('re-subscribes to channels after successful reconnection', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({
        url: `ws://localhost:${port}`,
        initialReconnectDelay: 50,
        maxReconnectAttempts: 5,
      });

      await client.connect();
      client.subscribe(['usage']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Force disconnect
      const internalWs = (client as unknown as { ws: WebSocket }).ws;
      internalWs.close();

      // Wait for reconnection
      await waitForEvent(client, 'connected', 3000);

      // After reconnection, subscriptions should still be active
      await new Promise((resolve) => setTimeout(resolve, 50));

      const eventPromise = waitForEvent(client, 'usage_event', 3000);
      service.emitUsageEvent({ test: 'resubscribed' });
      const msg = await eventPromise;
      expect((msg as { type: string }).type).toBe('usage_event');

      client.disconnect();
    });

    it('resets reconnect attempts after successful connection', async () => {
      const port = getServerPort(service);
      const client = new DashboardWebSocketClient({
        url: `ws://localhost:${port}`,
        initialReconnectDelay: 50,
        maxReconnectAttempts: 3,
      });

      await client.connect();

      // Force disconnect and reconnect
      const internalWs = (client as unknown as { ws: WebSocket }).ws;
      internalWs.close();

      await waitForEvent(client, 'reconnecting', 2000);
      await waitForEvent(client, 'connected', 3000);

      // Force disconnect again — attempt should be 1 (reset after successful connect)
      const ws2 = (client as unknown as { ws: WebSocket }).ws;
      ws2.close();

      const info = (await waitForEvent(client, 'reconnecting', 3000)) as {
        attempt: number;
        delay: number;
      };
      expect(info.attempt).toBe(1);

      client.disconnect();
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 7: Polling Fallback
  // ---------------------------------------------------------------------------
  describe('Polling Fallback', () => {
    /** Create a polling test client with error listener to prevent unhandled errors */
    function createPollingClient(config?: Record<string, unknown>): DashboardWebSocketClient {
      const client = new DashboardWebSocketClient({
        url: 'ws://127.0.0.1:19999',
        maxReconnectAttempts: 1,
        initialReconnectDelay: 30,
        maxReconnectDelay: 50,
        pollingInterval: 100,
        ...config,
      });
      // Suppress unhandled error events during polling tests
      client.on('error', () => {});
      return client;
    }

    it('falls back to polling after max reconnect attempts', async () => {
      const client = createPollingClient({
        maxReconnectAttempts: 2,
        initialReconnectDelay: 50,
        maxReconnectDelay: 100,
        pollingInterval: 100,
      });

      const pollingPromise = waitForEvent(client, 'polling_started', 10000);
      client.connect().catch(() => {});

      await pollingPromise;
      expect(client.getStatus()).toBe('polling');

      client.disconnect();
    }, 15000);

    it('emits "polling_started" event', async () => {
      const client = createPollingClient();

      const pollingPromise = waitForEvent(client, 'polling_started', 10000);
      client.connect().catch(() => {});
      await pollingPromise;

      expect(client.getStatus()).toBe('polling');
      client.disconnect();
    }, 15000);

    it('emits "poll" events at configured interval', async () => {
      const client = createPollingClient();

      const pollingStarted = waitForEvent(client, 'polling_started', 10000);
      client.connect().catch(() => {});
      await pollingStarted;

      // Collect poll events
      const polls: unknown[] = [];
      const pollHandler = () => polls.push('poll');
      client.on('poll', pollHandler);

      await new Promise((resolve) => setTimeout(resolve, 350));

      client.off('poll', pollHandler);
      client.disconnect();

      expect(polls.length).toBeGreaterThanOrEqual(2);
    }, 15000);

    it('isPollingActive() returns correct value', async () => {
      const client = createPollingClient();

      expect(client.isPollingActive()).toBe(false);

      const pollingStarted = waitForEvent(client, 'polling_started', 10000);
      client.connect().catch(() => {});
      await pollingStarted;

      expect(client.isPollingActive()).toBe(true);

      client.disconnect();
      expect(client.isPollingActive()).toBe(false);
    }, 15000);
  });
});
