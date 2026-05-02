/**
 * ToolOrchestrator Unit Tests
 * 
 * Tests parallel and sequential tool execution based on dependencies.
 */

import { ToolOrchestrator } from '../tool-orchestrator';
import type { ToolUse, Tool } from '../../types/anthropic.types';

describe('ToolOrchestrator', () => {
  let orchestrator: ToolOrchestrator;

  beforeEach(() => {
    orchestrator = new ToolOrchestrator();
  });

  // ============================================================================
  // Parallel Execution Tests
  // ============================================================================

  describe('Parallel Execution of Independent Tools', () => {
    it('should execute independent tools in parallel', async () => {
      const toolUses: ToolUse[] = [
        {
          type: 'tool_use',
          id: 'tool1',
          name: 'get_weather',
          input: { location: 'New York' },
        },
        {
          type: 'tool_use',
          id: 'tool2',
          name: 'get_time',
          input: { timezone: 'EST' },
        },
        {
          type: 'tool_use',
          id: 'tool3',
          name: 'get_news',
          input: { category: 'tech' },
        },
      ];

      const tools: Tool[] = [
        {
          name: 'get_weather',
          description: 'Get weather information',
          input_schema: { type: 'object', properties: {} },
        },
        {
          name: 'get_time',
          description: 'Get current time',
          input_schema: { type: 'object', properties: {} },
        },
        {
          name: 'get_news',
          description: 'Get news',
          input_schema: { type: 'object', properties: {} },
        },
      ];

      const results = await orchestrator.executeTools(toolUses, tools);

      expect(results).toHaveLength(3);
      expect(results[0].tool_use_id).toBe('tool1');
      expect(results[1].tool_use_id).toBe('tool2');
      expect(results[2].tool_use_id).toBe('tool3');
      expect(results.every((r) => !r.is_error)).toBe(true);
    });

    it('should handle empty tool uses array', async () => {
      const results = await orchestrator.executeTools([], []);
      expect(results).toEqual([]);
    });
  });

  // ============================================================================
  // Sequential Execution Tests
  // ============================================================================

  describe('Sequential Execution of Dependent Tools', () => {
    it('should execute dependent tools in sequence', async () => {
      const toolUses: ToolUse[] = [
        {
          type: 'tool_use',
          id: 'tool1',
          name: 'search_database',
          input: { query: 'users' },
        },
        {
          type: 'tool_use',
          id: 'tool2',
          name: 'process_results',
          input: { data_from: 'tool1' }, // References tool1
        },
      ];

      const toolDefinitions: Tool[] = [
        {
          name: 'search_database',
          description: 'Search database',
          input_schema: { type: 'object', properties: {} },
        },
        {
          name: 'process_results',
          description: 'Process results',
          input_schema: { type: 'object', properties: {} },
        },
      ];

      const results = await orchestrator.executeTools(toolUses, toolDefinitions);

      expect(results).toHaveLength(2);
      expect(results[0].tool_use_id).toBe('tool1');
      expect(results[1].tool_use_id).toBe('tool2');
    });

    it('should detect dependencies by tool ID reference', async () => {
      const toolUses: ToolUse[] = [
        {
          type: 'tool_use',
          id: 'fetch_data',
          name: 'fetch',
          input: { url: 'https://api.example.com' },
        },
        {
          type: 'tool_use',
          id: 'parse_data',
          name: 'parse',
          input: { source: 'fetch_data' }, // References by ID
        },
      ];

      const toolDefinitions: Tool[] = [
        {
          name: 'fetch',
          description: 'Fetch data',
          input_schema: { type: 'object', properties: {} },
        },
        {
          name: 'parse',
          description: 'Parse data',
          input_schema: { type: 'object', properties: {} },
        },
      ];

      const graph = orchestrator.analyzeDependencies(toolUses);
      
      // Use toolDefinitions to avoid unused variable warning
      expect(toolDefinitions).toBeDefined();

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toEqual({ from: 'fetch_data', to: 'parse_data' });
      expect(graph.executionOrder).toHaveLength(2);
      expect(graph.executionOrder[0]).toHaveLength(1); // First batch: 1 tool
      expect(graph.executionOrder[1]).toHaveLength(1); // Second batch: 1 tool
    });

    it('should detect dependencies by tool name reference', async () => {
      const toolUses: ToolUse[] = [
        {
          type: 'tool_use',
          id: 'tool1',
          name: 'calculate',
          input: { expression: '2+2' },
        },
        {
          type: 'tool_use',
          id: 'tool2',
          name: 'format',
          input: { use_result_from: 'calculate' }, // References by name
        },
      ];

      const toolDefinitions: Tool[] = [
        {
          name: 'calculate',
          description: 'Calculate expression',
          input_schema: { type: 'object', properties: {} },
        },
        {
          name: 'format',
          description: 'Format result',
          input_schema: { type: 'object', properties: {} },
        },
      ];

      const graph = orchestrator.analyzeDependencies(toolUses);
      
      // Use toolDefinitions to avoid unused variable warning
      expect(toolDefinitions).toBeDefined();

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toEqual({ from: 'tool1', to: 'tool2' });
    });
  });

  // ============================================================================
  // Mixed Parallel and Sequential Execution
  // ============================================================================

  describe('Mixed Parallel and Sequential Execution', () => {
    it('should execute mixed dependencies correctly', async () => {
      const toolUses: ToolUse[] = [
        // Independent tools (can run in parallel)
        {
          type: 'tool_use',
          id: 'tool1',
          name: 'fetch_users',
          input: {},
        },
        {
          type: 'tool_use',
          id: 'tool2',
          name: 'fetch_products',
          input: {},
        },
        // Dependent tool (must wait for tool1)
        {
          type: 'tool_use',
          id: 'tool3',
          name: 'process_users',
          input: { data_from: 'tool1' },
        },
        // Dependent tool (must wait for tool2)
        {
          type: 'tool_use',
          id: 'tool4',
          name: 'process_products',
          input: { data_from: 'tool2' },
        },
      ];

      const tools: Tool[] = [
        { name: 'fetch_users', description: '', input_schema: { type: 'object', properties: {} } },
        { name: 'fetch_products', description: '', input_schema: { type: 'object', properties: {} } },
        { name: 'process_users', description: '', input_schema: { type: 'object', properties: {} } },
        { name: 'process_products', description: '', input_schema: { type: 'object', properties: {} } },
      ];

      const graph = orchestrator.analyzeDependencies(toolUses);

      // Should have 2 batches:
      // Batch 1: tool1, tool2 (parallel)
      // Batch 2: tool3, tool4 (parallel, but after batch 1)
      expect(graph.executionOrder).toHaveLength(2);
      expect(graph.executionOrder[0]).toHaveLength(2); // First batch: 2 tools
      expect(graph.executionOrder[1]).toHaveLength(2); // Second batch: 2 tools

      const results = await orchestrator.executeTools(toolUses, tools);
      expect(results).toHaveLength(4);
    });

    it('should handle chain of dependencies', async () => {
      const toolUses: ToolUse[] = [
        {
          type: 'tool_use',
          id: 'tool1',
          name: 'step1',
          input: {},
        },
        {
          type: 'tool_use',
          id: 'tool2',
          name: 'step2',
          input: { depends_on: 'tool1' },
        },
        {
          type: 'tool_use',
          id: 'tool3',
          name: 'step3',
          input: { depends_on: 'tool2' },
        },
      ];

      const tools: Tool[] = [
        { name: 'step1', description: '', input_schema: { type: 'object', properties: {} } },
        { name: 'step2', description: '', input_schema: { type: 'object', properties: {} } },
        { name: 'step3', description: '', input_schema: { type: 'object', properties: {} } },
      ];

      const graph = orchestrator.analyzeDependencies(toolUses);

      // Should have 3 batches (sequential chain)
      expect(graph.executionOrder).toHaveLength(3);
      expect(graph.executionOrder[0]).toHaveLength(1);
      expect(graph.executionOrder[1]).toHaveLength(1);
      expect(graph.executionOrder[2]).toHaveLength(1);

      const results = await orchestrator.executeTools(toolUses, tools);
      expect(results).toHaveLength(3);
    });
  });

  // ============================================================================
  // Dependency Graph Tests
  // ============================================================================

  describe('Dependency Graph Building', () => {
    it('should build correct dependency graph for independent tools', () => {
      const toolUses: ToolUse[] = [
        { type: 'tool_use', id: 'tool1', name: 'tool1', input: {} },
        { type: 'tool_use', id: 'tool2', name: 'tool2', input: {} },
        { type: 'tool_use', id: 'tool3', name: 'tool3', input: {} },
      ];

      const graph = orchestrator.analyzeDependencies(toolUses);

      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges).toHaveLength(0); // No dependencies
      expect(graph.executionOrder).toHaveLength(1); // All in one batch
      expect(graph.executionOrder[0]).toHaveLength(3);
    });

    it('should build correct dependency graph for dependent tools', () => {
      const toolUses: ToolUse[] = [
        { type: 'tool_use', id: 'tool1', name: 'tool1', input: {} },
        { type: 'tool_use', id: 'tool2', name: 'tool2', input: { ref: 'tool1' } },
      ];

      const graph = orchestrator.analyzeDependencies(toolUses);

      expect(graph.nodes).toHaveLength(2);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toEqual({ from: 'tool1', to: 'tool2' });
      expect(graph.executionOrder).toHaveLength(2);
    });

    it('should handle complex dependency graph', () => {
      const toolUses: ToolUse[] = [
        { type: 'tool_use', id: 'A', name: 'A', input: {} },
        { type: 'tool_use', id: 'B', name: 'B', input: {} },
        { type: 'tool_use', id: 'C', name: 'C', input: { ref: 'A' } },
        { type: 'tool_use', id: 'D', name: 'D', input: { ref: 'B' } },
        { type: 'tool_use', id: 'E', name: 'E', input: { ref1: 'C', ref2: 'D' } },
      ];

      const graph = orchestrator.analyzeDependencies(toolUses);

      expect(graph.nodes).toHaveLength(5);
      expect(graph.edges.length).toBeGreaterThan(0);
      
      // Should have 3 batches:
      // Batch 1: A, B (parallel)
      // Batch 2: C, D (parallel, depend on A and B)
      // Batch 3: E (depends on C and D)
      expect(graph.executionOrder).toHaveLength(3);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle tool not found error', async () => {
      const toolUses: ToolUse[] = [
        {
          type: 'tool_use',
          id: 'tool1',
          name: 'nonexistent_tool',
          input: {},
        },
      ];

      const tools: Tool[] = [];

      const results = await orchestrator.executeTools(toolUses, tools);

      expect(results).toHaveLength(1);
      expect(results[0].is_error).toBe(true);
      expect(results[0].content).toContain('Tool \'nonexistent_tool\' not found');
    });

    it('should continue execution if one tool fails', async () => {
      const toolUses: ToolUse[] = [
        {
          type: 'tool_use',
          id: 'tool1',
          name: 'valid_tool',
          input: {},
        },
        {
          type: 'tool_use',
          id: 'tool2',
          name: 'invalid_tool',
          input: {},
        },
      ];

      const tools: Tool[] = [
        {
          name: 'valid_tool',
          description: 'Valid tool',
          input_schema: { type: 'object', properties: {} },
        },
      ];

      const results = await orchestrator.executeTools(toolUses, tools);

      expect(results).toHaveLength(2);
      expect(results[0].is_error).toBe(false);
      expect(results[1].is_error).toBe(true);
    });

    it('should handle circular dependencies gracefully', async () => {
      // Note: In practice, circular dependencies shouldn't occur in tool execution
      // but we should handle them gracefully
      const toolUses: ToolUse[] = [
        { type: 'tool_use', id: 'tool1', name: 'tool1', input: { ref: 'tool2' } },
        { type: 'tool_use', id: 'tool2', name: 'tool2', input: { ref: 'tool1' } },
      ];

      const tools: Tool[] = [
        { name: 'tool1', description: '', input_schema: { type: 'object', properties: {} } },
        { name: 'tool2', description: '', input_schema: { type: 'object', properties: {} } },
      ];

      // Should not throw, should execute sequentially
      const results = await orchestrator.executeTools(toolUses, tools);
      expect(results).toHaveLength(2);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle single tool execution', async () => {
      const toolUses: ToolUse[] = [
        {
          type: 'tool_use',
          id: 'tool1',
          name: 'single_tool',
          input: { param: 'value' },
        },
      ];

      const tools: Tool[] = [
        {
          name: 'single_tool',
          description: 'Single tool',
          input_schema: { type: 'object', properties: {} },
        },
      ];

      const results = await orchestrator.executeTools(toolUses, tools);

      expect(results).toHaveLength(1);
      expect(results[0].tool_use_id).toBe('tool1');
      expect(results[0].is_error).toBe(false);
    });

    it('should handle tools with complex input', async () => {
      const toolUses: ToolUse[] = [
        {
          type: 'tool_use',
          id: 'tool1',
          name: 'complex_tool',
          input: {
            nested: {
              data: {
                array: [1, 2, 3],
                object: { key: 'value' },
              },
            },
          },
        },
      ];

      const tools: Tool[] = [
        {
          name: 'complex_tool',
          description: 'Complex tool',
          input_schema: { type: 'object', properties: {} },
        },
      ];

      const results = await orchestrator.executeTools(toolUses, tools);

      expect(results).toHaveLength(1);
      expect(results[0].is_error).toBe(false);
    });

    it('should handle tools with no input', async () => {
      const toolUses: ToolUse[] = [
        {
          type: 'tool_use',
          id: 'tool1',
          name: 'no_input_tool',
          input: {},
        },
      ];

      const tools: Tool[] = [
        {
          name: 'no_input_tool',
          description: 'Tool with no input',
          input_schema: { type: 'object', properties: {} },
        },
      ];

      const results = await orchestrator.executeTools(toolUses, tools);

      expect(results).toHaveLength(1);
      expect(results[0].is_error).toBe(false);
    });
  });
});
