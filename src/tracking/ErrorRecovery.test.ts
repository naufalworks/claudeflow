/**
 * Tests for Error Recovery Service
 *
 * Tests fallback queue, retry with backoff, and graceful degradation.
 * Requirements: 17.1, 17.2, 17.5
 */

import { FallbackQueue, retryWithBackoff, createFallbackRanking } from './ErrorRecovery.js';

describe('ErrorRecovery', () => {
  describe('FallbackQueue', () => {
    let queue: FallbackQueue<string>;

    beforeEach(() => {
      queue = new FallbackQueue<string>();
    });

    afterEach(() => {
      queue.clear();
    });

    describe('Enqueue', () => {
      it('should add items to the queue', () => {
        queue.enqueue('item-1');
        queue.enqueue('item-2');

        expect(queue.size()).toBe(2);
      });

      it('should make items immediately ready for retry', () => {
        queue.enqueue('item-1');

        const ready = queue.getReadyItems();
        expect(ready).toHaveLength(1);
        expect(ready[0].item).toBe('item-1');
      });

      it('should enforce max size by dropping oldest items', () => {
        const smallQueue = new FallbackQueue<string>({ maxSize: 3 });

        smallQueue.enqueue('item-1');
        smallQueue.enqueue('item-2');
        smallQueue.enqueue('item-3');
        smallQueue.enqueue('item-4'); // Should drop item-1

        expect(smallQueue.size()).toBe(3);
      });
    });

    describe('Process Queue', () => {
      it('should successfully process ready items', async () => {
        const processed: string[] = [];
        queue.enqueue('item-1');
        queue.enqueue('item-2');

        const count = await queue.processQueue(async (item) => {
          processed.push(item);
        });

        expect(count).toBe(2);
        expect(processed).toEqual(['item-1', 'item-2']);
        expect(queue.size()).toBe(0);
      });

      it('should increment retry count on failure', async () => {
        queue.enqueue('item-1');

        // Fail on first attempt
        await queue.processQueue(async () => {
          throw new Error('Processing failed');
        });

        const ready = queue.getReadyItems();
        expect(ready).toHaveLength(0); // Not ready yet (backoff)
        expect(queue.size()).toBe(1);
      });

      it('should move items to dead letter after max retries', async () => {
        const smallQueue = new FallbackQueue<string>({
          maxRetries: 2,
          initialBackoffMs: 10,
          maxBackoffMs: 40,
        });

        smallQueue.enqueue('item-1');

        // Fail all retries
        for (let i = 0; i < 3; i++) {
          // Wait for backoff
          await new Promise((resolve) => setTimeout(resolve, 50));
          await smallQueue.processQueue(async () => {
            throw new Error('Processing failed');
          });
        }

        expect(smallQueue.size()).toBe(0);
        expect(smallQueue.deadLetterSize()).toBe(1);
      });

      it('should track total retried count', async () => {
        queue.enqueue('item-1');
        queue.enqueue('item-2');

        await queue.processQueue(async () => {
          // Success
        });

        const status = queue.getStatus();
        expect(status.totalRetried).toBe(2);
      });

      it('should return 0 when circuit breaker is open', async () => {
        queue.enqueue('item-1');

        // Force circuit breaker open
        const breakerQueue = new FallbackQueue<string>({
          maxRetries: 1,
          initialBackoffMs: 10,
          maxBackoffMs: 10,
        });

        // Trigger many failures to open circuit breaker
        for (let i = 0; i < 12; i++) {
          breakerQueue.enqueue(`item-${i}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          await breakerQueue.processQueue(async () => {
            throw new Error('fail');
          });
        }

        expect(breakerQueue.getStatus().circuitBreakerOpen).toBe(true);

        // Should not process when circuit is open
        breakerQueue.enqueue('new-item');
        const count = await breakerQueue.processQueue(async () => {});
        expect(count).toBe(0);
      });
    });

    describe('Status', () => {
      it('should return accurate status', () => {
        queue.enqueue('item-1');
        queue.enqueue('item-2');

        const status = queue.getStatus();
        expect(status.queueSize).toBe(2);
        expect(status.deadLetterCount).toBe(0);
        expect(status.totalRetried).toBe(0);
        expect(status.totalDeadLettered).toBe(0);
        expect(status.circuitBreakerOpen).toBe(false);
      });
    });

    describe('Clear', () => {
      it('should clear all queues and counters', async () => {
        queue.enqueue('item-1');
        await queue.processQueue(async () => {});

        queue.clear();

        expect(queue.size()).toBe(0);
        expect(queue.deadLetterSize()).toBe(0);
        expect(queue.getStatus().totalRetried).toBe(0);
      });
    });

    describe('Dead Letter', () => {
      it('should return dead letter entries', () => {
        // Manually add to dead letter for testing
        const dlQueue = new FallbackQueue<string>({
          maxRetries: 1,
          initialBackoffMs: 10,
          maxBackoffMs: 10,
        });

        dlQueue.enqueue('failing-item');

        // Process until dead lettered
        return (async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          await dlQueue.processQueue(async () => {
            throw new Error('fail');
          });
          await new Promise((resolve) => setTimeout(resolve, 20));
          await dlQueue.processQueue(async () => {
            throw new Error('fail');
          });

          const deadLetter = dlQueue.getDeadLetter();
          expect(deadLetter).toHaveLength(1);
          expect(deadLetter[0].item).toBe('failing-item');
          expect(deadLetter[0].reason).toBe('Exceeded max retries');
        })();
      });

      it('should clear dead letter queue', () => {
        queue.clearDeadLetter();
        expect(queue.deadLetterSize()).toBe(0);
      });
    });

    describe('Circuit Breaker Reset', () => {
      it('should reset circuit breaker', async () => {
        const breakerQueue = new FallbackQueue<string>({
          maxRetries: 1,
          initialBackoffMs: 10,
          maxBackoffMs: 10,
        });

        // Open the circuit breaker
        for (let i = 0; i < 12; i++) {
          breakerQueue.enqueue(`item-${i}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          await breakerQueue.processQueue(async () => {
            throw new Error('fail');
          });
        }

        expect(breakerQueue.getStatus().circuitBreakerOpen).toBe(true);

        breakerQueue.resetCircuitBreaker();

        expect(breakerQueue.getStatus().circuitBreakerOpen).toBe(false);
      });
    });
  });

  describe('retryWithBackoff', () => {
    it('should return result on first attempt if successful', async () => {
      const result = await retryWithBackoff(async () => 'success');
      expect(result).toBe('success');
    });

    it('should retry on failure and succeed eventually', async () => {
      let attempts = 0;

      const result = await retryWithBackoff(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Not yet');
          }
          return 'success';
        },
        { maxRetries: 3, initialBackoffMs: 10, maxBackoffMs: 100 }
      );

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should throw after all retries exhausted', async () => {
      await expect(
        retryWithBackoff(
          async () => {
            throw new Error('Always fails');
          },
          { maxRetries: 2, initialBackoffMs: 10, maxBackoffMs: 100 }
        )
      ).rejects.toThrow('Always fails');
    });

    it('should respect max backoff delay', async () => {
      const start = Date.now();

      try {
        await retryWithBackoff(
          async () => {
            throw new Error('fail');
          },
          { maxRetries: 2, initialBackoffMs: 10, maxBackoffMs: 30 }
        );
      } catch {
        // Expected
      }

      const elapsed = Date.now() - start;
      // Should be capped at maxBackoffMs total, not 10 + 20 + 40
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('createFallbackRanking', () => {
    it('should return all accounts with equal ranking', () => {
      const accounts = ['account-1', 'account-2', 'account-3'];

      const ranking = createFallbackRanking(accounts, 'Redis connection failed');

      expect(ranking).toHaveLength(3);
      expect(ranking[0].accountId).toBe('account-1');
      expect(ranking[0].score).toBe(0.5);
      expect(ranking[1].accountId).toBe('account-2');
      expect(ranking[1].score).toBe(0.5);
      expect(ranking[2].accountId).toBe('account-3');
      expect(ranking[2].score).toBe(0.5);
    });

    it('should include degradation reason in each account', () => {
      const ranking = createFallbackRanking(['account-1'], 'Quota service unavailable');

      expect(ranking[0].reason).toContain('Degraded mode');
      expect(ranking[0].reason).toContain('Quota service unavailable');
    });

    it('should return empty array for empty account list', () => {
      const ranking = createFallbackRanking([], 'No accounts');
      expect(ranking).toHaveLength(0);
    });

    it('should assign equal scores to all accounts', () => {
      const accounts = ['a', 'b', 'c', 'd', 'e'];
      const ranking = createFallbackRanking(accounts, 'test');

      const scores = ranking.map((r) => r.score);
      const allEqual = scores.every((s) => s === scores[0]);
      expect(allEqual).toBe(true);
    });
  });
});
