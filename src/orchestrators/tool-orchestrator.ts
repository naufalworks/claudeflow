/**
 * ToolOrchestrator
 * 
 * Orchestrates parallel and sequential tool execution based on dependencies.
 * Analyzes tool dependencies and executes independent tools in parallel
 * while respecting dependency order for dependent tools.
 */

import type { ToolUse, ToolResult, Tool } from '../types/anthropic.types';

/**
 * Tool dependency graph structure
 */
export interface ToolDependencyGraph {
  nodes: ToolUse[];
  edges: Array<{ from: string; to: string }>;
  executionOrder: ToolUse[][];
}

/**
 * ToolOrchestrator class
 */
export class ToolOrchestrator {
  /**
   * Execute tools with optimal parallelization based on dependencies
   * 
   * @param toolUses - Array of tool use requests from Claude
   * @param tools - Available tool definitions
   * @returns Array of tool results
   */
  async executeTools(toolUses: ToolUse[], tools: Tool[]): Promise<ToolResult[]> {
    if (toolUses.length === 0) {
      return [];
    }

    // 1. Analyze dependencies
    const graph = this.analyzeDependencies(toolUses);

    // 2. Execute in parallel batches based on dependency order
    const results: ToolResult[] = [];

    for (const batch of graph.executionOrder) {
      // Execute all tools in this batch in parallel
      const batchResults = await Promise.all(
        batch.map((toolUse) => this.executeSingleTool(toolUse, tools, results))
      );

      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Analyze dependencies between tool uses
   * 
   * @param toolUses - Array of tool use requests
   * @returns Dependency graph with execution order
   */
  analyzeDependencies(toolUses: ToolUse[]): ToolDependencyGraph {
    const nodes = toolUses;
    const edges: Array<{ from: string; to: string }> = [];

    // Build dependency edges
    // A tool depends on another if it references the other tool's output
    for (let i = 0; i < toolUses.length; i++) {
      for (let j = i + 1; j < toolUses.length; j++) {
        if (this.referencesTool(toolUses[j], toolUses[i])) {
          edges.push({ from: toolUses[i].id, to: toolUses[j].id });
        }
      }
    }

    // Perform topological sort to determine execution order
    const executionOrder = this.topologicalSort(nodes, edges);

    return { nodes, edges, executionOrder };
  }

  /**
   * Check if a tool use references another tool's output
   * 
   * @param toolUse - Tool use to check
   * @param previousTool - Previous tool that might be referenced
   * @returns True if toolUse references previousTool
   */
  private referencesTool(toolUse: ToolUse, previousTool: ToolUse): boolean {
    // Convert input to string for searching
    const inputStr = JSON.stringify(toolUse.input);

    // Check if the input contains references to the previous tool's ID
    // This is a heuristic - tools might reference previous results by ID
    return inputStr.includes(previousTool.id) || inputStr.includes(previousTool.name);
  }

  /**
   * Perform topological sort to determine execution order
   * Returns batches of tools that can be executed in parallel
   * 
   * @param nodes - Tool use nodes
   * @param edges - Dependency edges
   * @returns Array of batches (each batch can be executed in parallel)
   */
  private topologicalSort(
    nodes: ToolUse[],
    edges: Array<{ from: string; to: string }>
  ): ToolUse[][] {
    // Build adjacency list and in-degree map
    const adjacencyList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // Initialize
    for (const node of nodes) {
      adjacencyList.set(node.id, []);
      inDegree.set(node.id, 0);
    }

    // Build graph
    for (const edge of edges) {
      adjacencyList.get(edge.from)?.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }

    // Find all nodes with no dependencies (in-degree = 0)
    const batches: ToolUse[][] = [];
    const processed = new Set<string>();

    while (processed.size < nodes.length) {
      // Find all nodes that can be executed now (no unprocessed dependencies)
      const currentBatch = nodes.filter((node) => {
        if (processed.has(node.id)) {
          return false;
        }
        return (inDegree.get(node.id) || 0) === 0;
      });

      if (currentBatch.length === 0) {
        // Circular dependency detected - execute remaining sequentially
        const remaining = nodes.filter((node) => !processed.has(node.id));
        batches.push(...remaining.map((node) => [node]));
        break;
      }

      batches.push(currentBatch);

      // Mark as processed and update in-degrees
      for (const node of currentBatch) {
        processed.add(node.id);

        // Decrease in-degree for dependent nodes
        const dependents = adjacencyList.get(node.id) || [];
        for (const dependentId of dependents) {
          inDegree.set(dependentId, (inDegree.get(dependentId) || 0) - 1);
        }
      }
    }

    return batches;
  }

  /**
   * Execute a single tool
   * 
   * @param toolUse - Tool use request
   * @param tools - Available tool definitions
   * @param previousResults - Results from previously executed tools
   * @returns Tool result
   */
  private async executeSingleTool(
    toolUse: ToolUse,
    tools: Tool[],
    previousResults: ToolResult[]
  ): Promise<ToolResult> {
    try {
      // Find the tool definition
      const toolDef = tools.find((t) => t.name === toolUse.name);

      if (!toolDef) {
        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Error: Tool '${toolUse.name}' not found`,
          is_error: true,
        };
      }

      // In a real implementation, this would call the actual tool
      // For now, we simulate tool execution
      const result = await this.simulateToolExecution(toolUse, toolDef, previousResults);

      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
        is_error: false,
      };
    } catch (error) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Error executing tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
        is_error: true,
      };
    }
  }

  /**
   * Simulate tool execution (placeholder for actual tool execution)
   * 
   * @param toolUse - Tool use request
   * @param _toolDef - Tool definition (unused in simulation)
   * @param _previousResults - Results from previously executed tools (unused in simulation)
   * @returns Tool execution result
   */
  private async simulateToolExecution(
    toolUse: ToolUse,
    _toolDef: Tool,
    _previousResults: ToolResult[]
  ): Promise<string> {
    // This is a placeholder - in a real implementation, this would:
    // 1. Validate input against tool schema
    // 2. Execute the actual tool function
    // 3. Return the result

    // For now, return a simulated result
    return JSON.stringify({
      tool: toolUse.name,
      input: toolUse.input,
      result: 'Tool execution successful',
      timestamp: new Date().toISOString(),
    });
  }
}
