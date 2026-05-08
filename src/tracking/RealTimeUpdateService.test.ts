/**
 * Unit tests for RealTimeUpdateService
 *
 * Tests WebSocket server functionality including:
 * - Construction, start, and stop
 * - Token-based authentication (Req 18.1, 18.2)
 * - Rate limiting (Req 18.3)
 * - Subscribe/Unsubscribe and ping/pong
 * - Event emission and batching (Req 5.2-5.5, 16.3)
 * - Connection management
 */

import { WebSocket } from 'ws';
import { RealTimeUpdateService } from './RealTimeUpdateService.js';

/**
 * Get the actual port the server is listening on.
 * Uses port 0 for ephemeral port allocation in tests.
 */
function getServerPort(service: RealTimeUpdateService): number {
  const server = (service as unknown as { wss: { address: () => { port: number } } }).wss;
  const addr = server.address();
  return addr.port;
}

/** Wait for a WebSocket connection to open */
function waitForConnection(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
}

/** Wait for the next message from a WebSocket */
function waitForMessage(ws: WebSocket, timeout = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Message timeout')), timeout);
    ws.on('message', (data: Buffer) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

/** Collect all messages received within a time window */
function collectMessages(ws: WebSocket, durationMs: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const messages: unknown[] = [];
    const handler = (data: Buffer) => {
      messages.push(JSON.parse(data.toString()));
    };
    ws.on('message', handler);
    setTimeout(() => {
      ws.off('message', handler);
      resolve(messages);
    }, durationMs);
  });
}

/** Wait for a WebSocket to close and return close code/reason */
function waitForClose(ws: WebSocket, timeout = 2000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve({ code: 0, reason: '' });
      return;
    }
    const timer = setTimeout(() => resolve({ code: 0, reason: 'timeout' }), timeout);
    ws.on('close', (code: number, reason: Buffer) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

/** Helper to create a connected client */
async function createClient(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${port}`);
  await waitForConnection(ws);
  return ws;
}

describe('RealTimeUpdateService', () => {
  let service: RealTimeUpdateService;

  afterEach(async () => {
    if (service && service.isRunning()) {
      await service.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // Construction & Start/Stop
  // ---------------------------------------------------------------------------
  describe('Construction & Start/Stop', () => {
    it('creates instance with default config', () => {
      service = new RealTimeUpdateService({ port: 0 });
      expect(service).toBeDefined();
      expect(service.isRunning()).toBe(false);
      expect(service.getConnectedClientCount()).toBe(0);
    });

    it('start() begins listening and emits "started" event', async () => {
      service = new RealTimeUpdateService({ port: 0 });
      const startedSpy = jest.fn();
      service.on('started', startedSpy);

      await service.start();

      expect(service.isRunning()).toBe(true);
      expect(startedSpy).toHaveBeenCalledTimes(1);
    });

    it('stop() closes server and emits "stopped" event', async () => {
      service = new RealTimeUpdateService({ port: 0 });
      await service.start();

      const stoppedSpy = jest.fn();
      service.on('stopped', stoppedSpy);

      await service.stop();

      expect(service.isRunning()).toBe(false);
      expect(stoppedSpy).toHaveBeenCalledTimes(1);
    });

    it('isRunning() returns correct state', async () => {
      service = new RealTimeUpdateService({ port: 0 });
      expect(service.isRunning()).toBe(false);

      await service.start();
      expect(service.isRunning()).toBe(true);

      await service.stop();
      expect(service.isRunning()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Authentication — Req 18.1, 18.2
  // ---------------------------------------------------------------------------
  describe('Authentication', () => {
    it('no auth required when authToken not configured', async () => {
      service = new RealTimeUpdateService({ port: 0 });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);

      // Subscribe without auth should work
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));

      expect(service.getConnectedClientCount()).toBe(1);
      ws.close();
    });

    it('client must send auth message when authToken is configured', async () => {
      service = new RealTimeUpdateService({ port: 0, authToken: 'secret-token' });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);

      // Sending a non-auth message should close connection
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));

      const { code, reason } = await waitForClose(ws);
      expect(code).toBe(1008);
      expect(reason).toBe('Invalid authentication');
    });

    it('wrong token closes with code 1008', async () => {
      service = new RealTimeUpdateService({ port: 0, authToken: 'secret-token' });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);
      ws.send(JSON.stringify({ type: 'auth', token: 'wrong-token' }));

      const { code, reason } = await waitForClose(ws);
      expect(code).toBe(1008);
      expect(reason).toBe('Invalid authentication');
    });

    it('correct token authenticates successfully', async () => {
      service = new RealTimeUpdateService({ port: 0, authToken: 'secret-token' });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);

      // Authenticate with correct token
      ws.send(JSON.stringify({ type: 'auth', token: 'secret-token' }));

      // Wait a bit for authentication to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now subscribe should work (connection should still be open)
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));

      // Connection should still be open
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('unauthenticated client sending non-auth message gets closed', async () => {
      service = new RealTimeUpdateService({ port: 0, authToken: 'secret-token' });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);

      // Send ping without auth
      ws.send(JSON.stringify({ type: 'ping' }));

      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });
  });

  // ---------------------------------------------------------------------------
  // Rate Limiting — Req 18.3
  // ---------------------------------------------------------------------------
  describe('Rate Limiting', () => {
    it('client sending many messages quickly gets disconnected', async () => {
      service = new RealTimeUpdateService({
        port: 0,
        rateLimitPerSecond: 5,
      });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);

      // Send more messages than the rate limit
      for (let i = 0; i < 10; i++) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }

      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it('client sending reasonable messages stays connected', async () => {
      service = new RealTimeUpdateService({
        port: 0,
        rateLimitPerSecond: 100,
      });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);

      // Send a few messages
      for (let i = 0; i < 3; i++) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }

      // Wait a short time — connection should still be open
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Subscribe / Unsubscribe / Ping-Pong
  // ---------------------------------------------------------------------------
  describe('Subscribe/Unsubscribe', () => {
    it('client receives pong for ping message', async () => {
      service = new RealTimeUpdateService({ port: 0 });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);

      const messagePromise = waitForMessage(ws);
      ws.send(JSON.stringify({ type: 'ping' }));

      const msg = (await messagePromise) as { type: string };
      expect(msg.type).toBe('pong');
      ws.close();
    });

    it('client can subscribe to channels', async () => {
      service = new RealTimeUpdateService({ port: 0 });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);

      // Subscribe and then emit an event
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Emit a usage event — client should receive it after batch flush
      const msgPromise = waitForMessage(ws, 300);
      service.emitUsageEvent({ accountId: 'test' });

      const msg = (await msgPromise) as { type: string; data: unknown };
      expect(msg.type).toBe('usage_event');
      ws.close();
    });

    it('client can unsubscribe from channels', async () => {
      service = new RealTimeUpdateService({
        port: 0,
        batchInterval: 50,
      });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);

      // Subscribe, then unsubscribe
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      ws.send(JSON.stringify({ type: 'unsubscribe', channels: ['usage'] }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Emit a usage event — client should NOT receive it
      await collectMessages(ws, 200);
      service.emitUsageEvent({ accountId: 'test' });

      const messages2 = await collectMessages(ws, 200);
      expect(messages2.length).toBe(0);
      ws.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Event Emission & Batching — Req 5.2-5.5, 16.3
  // ---------------------------------------------------------------------------
  describe('Event Emission & Batching', () => {
    it('emitUsageEvent sends to subscribed clients', async () => {
      service = new RealTimeUpdateService({ port: 0, batchInterval: 50 });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      const msgPromise = waitForMessage(ws, 300);
      service.emitUsageEvent({ accountId: 'acc-1', tokens: 100 });

      const msg = (await msgPromise) as { type: string; data: unknown };
      expect(msg.type).toBe('usage_event');
      expect(msg.data).toEqual({ accountId: 'acc-1', tokens: 100 });
      ws.close();
    });

    it('emitQuotaUpdate sends to subscribed clients', async () => {
      service = new RealTimeUpdateService({ port: 0, batchInterval: 50 });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['quota'] }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      const msgPromise = waitForMessage(ws, 300);
      service.emitQuotaUpdate({ accountId: 'acc-1', quotaUsed: 50 });

      const msg = (await msgPromise) as { type: string; data: unknown };
      expect(msg.type).toBe('quota_update');
      expect(msg.data).toEqual({ accountId: 'acc-1', quotaUsed: 50 });
      ws.close();
    });

    it('emitAccountStatusChange sends to subscribed clients', async () => {
      service = new RealTimeUpdateService({ port: 0, batchInterval: 50 });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['accounts'] }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      const msgPromise = waitForMessage(ws, 300);
      service.emitAccountStatusChange({ accountId: 'acc-1', status: 'active' });

      const msg = (await msgPromise) as { type: string; data: unknown };
      expect(msg.type).toBe('account_status');
      expect(msg.data).toEqual({ accountId: 'acc-1', status: 'active' });
      ws.close();
    });

    it('events are batched — multiple events sent together', async () => {
      service = new RealTimeUpdateService({ port: 0, batchInterval: 150 });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Emit multiple events before the batch flush
      service.emitUsageEvent({ id: 1 });
      service.emitUsageEvent({ id: 2 });
      service.emitUsageEvent({ id: 3 });

      // Collect messages after batch flush
      const messages = await collectMessages(ws, 250);

      expect(messages.length).toBe(3);
      const types = messages.map((m: unknown) => (m as { type: string }).type);
      expect(types).toEqual(['usage_event', 'usage_event', 'usage_event']);
      ws.close();
    });

    it('non-subscribed clients do not receive events', async () => {
      service = new RealTimeUpdateService({ port: 0, batchInterval: 50 });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);

      // Don't subscribe to any channel
      service.emitUsageEvent({ accountId: 'test' });

      const messages = await collectMessages(ws, 200);
      expect(messages.length).toBe(0);
      ws.close();
    });

    it('multiple clients receive same events', async () => {
      service = new RealTimeUpdateService({ port: 0, batchInterval: 50 });
      await service.start();
      const port = getServerPort(service);

      const ws1 = await createClient(port);
      const ws2 = await createClient(port);

      ws1.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));
      ws2.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      const msgPromise1 = waitForMessage(ws1, 300);
      const msgPromise2 = waitForMessage(ws2, 300);

      service.emitUsageEvent({ accountId: 'shared' });

      const msg1 = (await msgPromise1) as { type: string; data: unknown };
      const msg2 = (await msgPromise2) as { type: string; data: unknown };

      expect(msg1.type).toBe('usage_event');
      expect(msg2.type).toBe('usage_event');
      expect(msg1.data).toEqual(msg2.data);

      ws1.close();
      ws2.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Connection Management
  // ---------------------------------------------------------------------------
  describe('Connection Management', () => {
    it('multiple clients can connect', async () => {
      service = new RealTimeUpdateService({ port: 0 });
      await service.start();
      const port = getServerPort(service);

      const ws1 = await createClient(port);
      const ws2 = await createClient(port);
      const ws3 = await createClient(port);

      expect(service.getConnectedClientCount()).toBe(3);

      ws1.close();
      ws2.close();
      ws3.close();
    });

    it('disconnected clients are cleaned up', async () => {
      service = new RealTimeUpdateService({ port: 0 });
      await service.start();
      const port = getServerPort(service);

      const ws1 = await createClient(port);
      const ws2 = await createClient(port);

      expect(service.getConnectedClientCount()).toBe(2);

      ws1.close();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(service.getConnectedClientCount()).toBe(1);

      ws2.close();
    });

    it('getConnectedClientCount returns correct count', async () => {
      service = new RealTimeUpdateService({ port: 0 });
      await service.start();
      const port = getServerPort(service);

      expect(service.getConnectedClientCount()).toBe(0);

      const ws1 = await createClient(port);
      expect(service.getConnectedClientCount()).toBe(1);

      const ws2 = await createClient(port);
      expect(service.getConnectedClientCount()).toBe(2);

      ws1.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(service.getConnectedClientCount()).toBe(1);

      ws2.close();
    });

    it('emits client_connected and client_disconnected events', async () => {
      service = new RealTimeUpdateService({ port: 0 });
      await service.start();
      const port = getServerPort(service);

      const connectedSpy = jest.fn();
      const disconnectedSpy = jest.fn();
      service.on('client_connected', connectedSpy);
      service.on('client_disconnected', disconnectedSpy);

      const ws = await createClient(port);
      expect(connectedSpy).toHaveBeenCalledWith({ count: 1 });

      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(disconnectedSpy).toHaveBeenCalledWith({ count: 0 });
    });

    it('enforces max connections limit', async () => {
      service = new RealTimeUpdateService({ port: 0, maxConnections: 2 });
      await service.start();
      const port = getServerPort(service);

      const ws1 = await createClient(port);
      const ws2 = await createClient(port);

      // Third client should be rejected
      const ws3 = new WebSocket(`ws://localhost:${port}`);
      const { code } = await waitForClose(ws3);
      expect(code).toBe(1008);

      ws1.close();
      ws2.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Batch Size Limit
  // ---------------------------------------------------------------------------
  describe('Batch Size Limit', () => {
    it('respects maxBatchSize and drops excess events', async () => {
      service = new RealTimeUpdateService({
        port: 0,
        batchInterval: 200,
        maxBatchSize: 3,
      });
      await service.start();
      const port = getServerPort(service);

      const ws = await createClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Emit more events than maxBatchSize
      for (let i = 0; i < 5; i++) {
        service.emitUsageEvent({ id: i });
      }

      // Collect messages after batch flush
      const messages = await collectMessages(ws, 350);

      // Should only receive maxBatchSize events (3)
      expect(messages.length).toBe(3);
      ws.close();
    });
  });
});
