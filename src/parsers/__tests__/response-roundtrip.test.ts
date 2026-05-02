/**
 * Response Round-Trip Property Tests
 * 
 * Property-based tests to validate that response parsing and formatting
 * are inverse operations (round-trip consistency).
 * 
 * Properties tested:
 * 1. parse(format(response)) === response
 * 2. format(parse(json)) produces valid JSON
 * 3. Double round-trip is idempotent
 */

import * as fc from 'fast-check';
import { ResponseParser } from '../response-parser';
import { ResponseFormatter } from '../response-formatter';
import {
  AnthropicResponse,
  ContentBlock,
  Usage,
  StopReason,
} from '../../types';

describe('Response Round-Trip Properties', () => {
  const parser = new ResponseParser();
  const formatter = new ResponseFormatter();

  // ============================================================================
  // Arbitraries (Generators for valid responses)
  // ============================================================================

  const stopReasonArb = fc.constantFrom<StopReason>(
    'end_turn',
    'max_tokens',
    'stop_sequence',
    'tool_use'
  );

  const textContentBlockArb = fc.record({
    type: fc.constant('text' as const),
    text: fc.string({ minLength: 1, maxLength: 1000 }).filter(s => s.trim().length > 0),
  });

  const thinkingContentBlockArb = fc.record({
    type: fc.constant('thinking' as const),
    thinking: fc.string({ minLength: 1, maxLength: 1000 }).filter(s => s.trim().length > 0),
  });

  const toolUseContentBlockArb = fc.record({
    type: fc.constant('tool_use' as const),
    id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    input: fc.dictionary(fc.string(), fc.anything()),
  });

  const contentBlockArb: fc.Arbitrary<ContentBlock> = fc.oneof(
    textContentBlockArb,
    thinkingContentBlockArb,
    toolUseContentBlockArb
  );

  const usageArb: fc.Arbitrary<Usage> = fc
    .record({
      input_tokens: fc.integer({ min: 0, max: 100000 }),
      output_tokens: fc.integer({ min: 0, max: 100000 }),
      cache_creation_input_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      cache_read_input_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
      thinking_tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
    })
    .map((usage) => {
      // Remove undefined fields
      const result: any = {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      };
      if (usage.cache_creation_input_tokens !== undefined) {
        result.cache_creation_input_tokens = usage.cache_creation_input_tokens;
      }
      if (usage.cache_read_input_tokens !== undefined) {
        result.cache_read_input_tokens = usage.cache_read_input_tokens;
      }
      if (usage.thinking_tokens !== undefined) {
        result.thinking_tokens = usage.thinking_tokens;
      }
      return result;
    });

  const anthropicResponseArb: fc.Arbitrary<AnthropicResponse> = fc
    .record({
      id: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
      type: fc.constant('message' as const),
      role: fc.constant('assistant' as const),
      content: fc.array(contentBlockArb, { minLength: 1, maxLength: 10 }),
      model: fc.constantFrom(
        'claude-opus-4-20250514',
        'claude-sonnet-4-20250514',
        'claude-haiku-4-20250514'
      ),
      stop_reason: stopReasonArb,
      stop_sequence: fc.option(fc.string().filter(s => s.length > 0), { nil: undefined }),
      usage: usageArb,
    })
    .map((response) => {
      // Remove undefined fields
      const result: any = {
        id: response.id,
        type: response.type,
        role: response.role,
        content: response.content,
        model: response.model,
        stop_reason: response.stop_reason,
        usage: response.usage,
      };
      if (response.stop_sequence !== undefined) {
        result.stop_sequence = response.stop_sequence;
      }
      return result;
    });

  // ============================================================================
  // Property 1: parse(format(response)) === response
  // ============================================================================

  it('Property 1: parse(format(response)) should equal response', () => {
    fc.assert(
      fc.property(anthropicResponseArb, (response) => {
        // Format the response to JSON
        const json = formatter.format(response);

        // Parse it back
        const parseResult = parser.parse(json);

        // Should succeed
        expect(parseResult.success).toBe(true);

        if (parseResult.success) {
          // Should equal original response
          expect(parseResult.value).toEqual(response);
        }
      }),
      { numRuns: 100 }
    );
  });

  // ============================================================================
  // Property 2: format(parse(json)) produces valid JSON
  // ============================================================================

  it('Property 2: format(parse(json)) should produce valid JSON', () => {
    fc.assert(
      fc.property(anthropicResponseArb, (response) => {
        // Format to JSON
        const json1 = formatter.format(response);

        // Parse it
        const parseResult = parser.parse(json1);
        expect(parseResult.success).toBe(true);

        if (parseResult.success) {
          // Format again
          const json2 = formatter.format(parseResult.value);

          // Should be valid JSON (can stringify)
          expect(() => JSON.stringify(json2)).not.toThrow();

          // Should equal original JSON
          expect(json2).toEqual(json1);
        }
      }),
      { numRuns: 100 }
    );
  });

  // ============================================================================
  // Property 3: Double round-trip is idempotent
  // ============================================================================

  it('Property 3: Double round-trip should be idempotent', () => {
    fc.assert(
      fc.property(anthropicResponseArb, (response) => {
        // First round-trip: response -> json -> response
        const json1 = formatter.format(response);
        const parseResult1 = parser.parse(json1);
        expect(parseResult1.success).toBe(true);

        if (parseResult1.success) {
          const response1 = parseResult1.value;

          // Second round-trip: response1 -> json2 -> response2
          const json2 = formatter.format(response1);
          const parseResult2 = parser.parse(json2);
          expect(parseResult2.success).toBe(true);

          if (parseResult2.success) {
            const response2 = parseResult2.value;

            // response1 should equal response2 (idempotent)
            expect(response2).toEqual(response1);
            expect(response2).toEqual(response);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle minimal response', () => {
      const minimalResponse: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      const json = formatter.format(minimalResponse);
      const parseResult = parser.parse(json);

      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        expect(parseResult.value).toEqual(minimalResponse);
      }
    });

    it('should handle response with all optional fields', () => {
      const fullResponse: AnthropicResponse = {
        id: 'msg_456',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'thinking', thinking: 'Let me think...' },
        ],
        model: 'claude-opus-4-20250514',
        stop_reason: 'stop_sequence',
        stop_sequence: 'STOP',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
          thinking_tokens: 15,
        },
      };

      const json = formatter.format(fullResponse);
      const parseResult = parser.parse(json);

      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        expect(parseResult.value).toEqual(fullResponse);
      }
    });

    it('should handle response with tool_use content', () => {
      const toolResponse: AnthropicResponse = {
        id: 'msg_789',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me search for that.' },
          {
            type: 'tool_use',
            id: 'tool_123',
            name: 'search',
            input: { query: 'test query', limit: 10 },
          },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 50,
          output_tokens: 25,
        },
      };

      const json = formatter.format(toolResponse);
      const parseResult = parser.parse(json);

      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        expect(parseResult.value).toEqual(toolResponse);
      }
    });

    it('should handle response with multiple content blocks', () => {
      const multiContentResponse: AnthropicResponse = {
        id: 'msg_multi',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Analyzing the request...' },
          { type: 'text', text: 'Here is my response:' },
          { type: 'text', text: 'Additional information.' },
          {
            type: 'tool_use',
            id: 'tool_456',
            name: 'calculate',
            input: { expression: '2 + 2' },
          },
        ],
        model: 'claude-opus-4-20250514',
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 200,
          output_tokens: 100,
          thinking_tokens: 50,
        },
      };

      const json = formatter.format(multiContentResponse);
      const parseResult = parser.parse(json);

      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        expect(parseResult.value).toEqual(multiContentResponse);
      }
    });

    it('should handle response with cache usage', () => {
      const cacheResponse: AnthropicResponse = {
        id: 'msg_cache',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Cached response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 1000,
          output_tokens: 50,
          cache_creation_input_tokens: 500,
          cache_read_input_tokens: 500,
        },
      };

      const json = formatter.format(cacheResponse);
      const parseResult = parser.parse(json);

      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        expect(parseResult.value).toEqual(cacheResponse);
      }
    });
  });
});
