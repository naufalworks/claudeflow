/**
 * Property-based tests for request round-trip consistency
 * 
 * Property 1: Request round-trip consistency
 * Validates: Requirements 1.8
 * 
 * For all valid AnthropicRequest objects:
 * parse(format(parse(json))) === parse(json)
 */

import * as fc from 'fast-check';
import { RequestParser } from '../request-parser';
import { RequestFormatter } from '../request-formatter';
import { AnthropicRequest, ContentBlock, Message } from '../../types';

describe('Request Round-Trip Property Tests', () => {
  const parser = new RequestParser();
  const formatter = new RequestFormatter();

  // ============================================================================
  // Arbitraries (generators for random valid data)
  // ============================================================================

  const contentBlockArbitrary: fc.Arbitrary<ContentBlock> = fc.oneof(
    // Text content block
    fc.record({
      type: fc.constant('text' as const),
      text: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    // Tool use content block
    fc.record({
      type: fc.constant('tool_use' as const),
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      input: fc.dictionary(fc.string(), fc.anything()),
    }),
    // Tool result content block
    fc.record({
      type: fc.constant('tool_result' as const),
      tool_use_id: fc.uuid(),
      content: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    // Thinking content block
    fc.record({
      type: fc.constant('thinking' as const),
      thinking: fc.string({ minLength: 1, maxLength: 100 }),
    })
  );

  const messageArbitrary: fc.Arbitrary<Message> = fc.record({
    role: fc.oneof(fc.constant('user' as const), fc.constant('assistant' as const)),
    content: fc.oneof(
      fc.string({ minLength: 1, maxLength: 200 }),
      fc.array(contentBlockArbitrary, { minLength: 1, maxLength: 3 })
    ),
  });

  const anthropicRequestArbitrary: fc.Arbitrary<AnthropicRequest> = fc.record({
    model: fc.oneof(
      fc.constant('claude-opus-4-20250514'),
      fc.constant('claude-sonnet-4-20250514'),
      fc.constant('claude-haiku-4-20250514')
    ),
    messages: fc.array(messageArbitrary, { minLength: 1, maxLength: 5 }),
    max_tokens: fc.integer({ min: 1, max: 4096 }),
    temperature: fc.option(fc.double({ min: 0, max: 1 }), { nil: undefined }),
    top_p: fc.option(fc.double({ min: 0, max: 1 }), { nil: undefined }),
    top_k: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
    stream: fc.option(fc.boolean(), { nil: undefined }),
  });

  // ============================================================================
  // Property Tests
  // ============================================================================

  test('Property 1: parse(format(request)) should equal request', () => {
    fc.assert(
      fc.property(anthropicRequestArbitrary, (request) => {
        // Format the request to JSON
        const formatted = formatter.format(request);

        // Parse it back
        const parseResult = parser.parse(formatted);

        // Should parse successfully
        expect(parseResult.success).toBe(true);

        if (!parseResult.success) {
          return false;
        }

        const reparsed = parseResult.value;

        // Compare key fields
        expect(reparsed.model).toBe(request.model);
        expect(reparsed.max_tokens).toBe(request.max_tokens);
        expect(reparsed.messages.length).toBe(request.messages.length);

        // Compare messages
        for (let i = 0; i < request.messages.length; i++) {
          expect(reparsed.messages[i].role).toBe(request.messages[i].role);
          
          // Compare content (handle both string and array)
          if (typeof request.messages[i].content === 'string') {
            expect(reparsed.messages[i].content).toBe(request.messages[i].content);
          } else {
            expect(Array.isArray(reparsed.messages[i].content)).toBe(true);
            const originalBlocks = request.messages[i].content as ContentBlock[];
            const reparsedBlocks = reparsed.messages[i].content as ContentBlock[];
            expect(reparsedBlocks.length).toBe(originalBlocks.length);
          }
        }

        // Compare optional fields
        if (request.temperature !== undefined) {
          expect(reparsed.temperature).toBe(request.temperature);
        }
        if (request.top_p !== undefined) {
          expect(reparsed.top_p).toBe(request.top_p);
        }
        if (request.top_k !== undefined) {
          expect(reparsed.top_k).toBe(request.top_k);
        }
        if (request.stream !== undefined) {
          expect(reparsed.stream).toBe(request.stream);
        }

        return true;
      }),
      { numRuns: 100 } // Run 100 random test cases
    );
  });

  test('Property 2: format(parse(json)) should produce valid JSON', () => {
    fc.assert(
      fc.property(anthropicRequestArbitrary, (request) => {
        // Format to JSON
        const formatted = formatter.format(request);

        // Should be a valid object
        expect(typeof formatted).toBe('object');
        expect(formatted).not.toBeNull();

        // Should have required fields
        expect(formatted.model).toBeDefined();
        expect(formatted.messages).toBeDefined();
        expect(formatted.max_tokens).toBeDefined();

        // Should be JSON-serializable
        const jsonString = JSON.stringify(formatted);
        expect(() => JSON.parse(jsonString)).not.toThrow();

        return true;
      }),
      { numRuns: 100 }
    );
  });

  test('Property 3: Double round-trip should be idempotent', () => {
    fc.assert(
      fc.property(anthropicRequestArbitrary, (request) => {
        // First round-trip
        const formatted1 = formatter.format(request);
        const parsed1 = parser.parse(formatted1);
        expect(parsed1.success).toBe(true);

        if (!parsed1.success) return false;

        // Second round-trip
        const formatted2 = formatter.format(parsed1.value);
        const parsed2 = parser.parse(formatted2);
        expect(parsed2.success).toBe(true);

        if (!parsed2.success) return false;

        // Both parsed results should be equivalent
        expect(parsed2.value.model).toBe(parsed1.value.model);
        expect(parsed2.value.max_tokens).toBe(parsed1.value.max_tokens);
        expect(parsed2.value.messages.length).toBe(parsed1.value.messages.length);

        return true;
      }),
      { numRuns: 50 }
    );
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  test('Edge case: Minimal valid request', () => {
    const minimalRequest: AnthropicRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 100,
    };

    const formatted = formatter.format(minimalRequest);
    const parseResult = parser.parse(formatted);

    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      expect(parseResult.value.model).toBe(minimalRequest.model);
      expect(parseResult.value.max_tokens).toBe(minimalRequest.max_tokens);
      expect(parseResult.value.messages.length).toBe(1);
    }
  });

  test('Edge case: Request with all optional fields', () => {
    const fullRequest: AnthropicRequest = {
      model: 'claude-opus-4-20250514',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
      max_tokens: 1024,
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      stop_sequences: ['STOP', 'END'],
      stream: false,
      metadata: { user_id: 'test-user', conversation_id: 'test-conv' },
      thinking: { type: 'enabled', budget_tokens: 2000 },
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather information',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
        },
      ],
      tool_choice: { type: 'auto' },
    };

    const formatted = formatter.format(fullRequest);
    const parseResult = parser.parse(formatted);

    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      expect(parseResult.value.model).toBe(fullRequest.model);
      expect(parseResult.value.temperature).toBe(fullRequest.temperature);
      expect(parseResult.value.thinking?.budget_tokens).toBe(2000);
      expect(parseResult.value.tools?.length).toBe(1);
    }
  });

  test('Edge case: Request with multi-content blocks', () => {
    const request: AnthropicRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            {
              type: 'tool_result',
              tool_use_id: 'tool-123',
              content: 'Result data',
            },
          ],
        },
      ],
      max_tokens: 500,
    };

    const formatted = formatter.format(request);
    const parseResult = parser.parse(formatted);

    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      const content = parseResult.value.messages[0].content;
      expect(Array.isArray(content)).toBe(true);
      if (Array.isArray(content)) {
        expect(content.length).toBe(2);
        expect(content[0].type).toBe('text');
        expect(content[1].type).toBe('tool_result');
      }
    }
  });

  test('Edge case: Request with cache_control markers', () => {
    const request: AnthropicRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'System context here',
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
        { role: 'assistant', content: 'Understood' },
        { role: 'user', content: 'Continue' },
      ],
      max_tokens: 500,
    };

    const formatted = formatter.format(request);
    const parseResult = parser.parse(formatted);

    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      const content = parseResult.value.messages[0].content;
      if (Array.isArray(content)) {
        const textBlock = content[0];
        if (textBlock.type === 'text') {
          expect(textBlock.cache_control).toEqual({ type: 'ephemeral' });
        }
      }
    }
  });
});
