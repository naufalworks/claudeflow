#!/usr/bin/env node

/**
 * Complexity Analysis Script
 * Analyzes TypeScript files for cyclomatic complexity, function length, and nesting depth
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const SRC_DIR = path.join(__dirname, '..', 'src');
const OUTPUT_FILE = path.join(__dirname, 'complexity-analysis.json');

// Complexity thresholds
const COMPLEXITY_THRESHOLDS = {
  low: 10,
  moderate: 20,
  high: 30,
  veryHigh: 50
};

const LENGTH_THRESHOLDS = {
  short: 20,
  medium: 50,
  long: 100,
  veryLong: 200
};

const NESTING_THRESHOLDS = {
  shallow: 2,
  moderate: 4,
  deep: 6
};

/**
 * Calculate cyclomatic complexity for a function
 * Complexity = 1 + number of decision points
 */
function calculateComplexity(code) {
  let complexity = 1;
  
  // Decision points
  const patterns = [
    /\bif\s*\(/g,           // if statements
    /\belse\s+if\b/g,       // else if
    /\bfor\s*\(/g,          // for loops
    /\bwhile\s*\(/g,        // while loops
    /\bcase\s+/g,           // switch cases
    /\bcatch\s*\(/g,        // catch blocks
    /\?\s*.*\s*:/g,         // ternary operators
    /&&/g,                  // logical AND
    /\|\|/g,                // logical OR
    /\?\?/g                 // nullish coalescing
  ];
  
  patterns.forEach(pattern => {
    const matches = code.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  });
  
  return complexity;
}

/**
 * Calculate nesting depth
 */
function calculateNestingDepth(code) {
  let maxDepth = 0;
  let currentDepth = 0;
  
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (code[i] === '}') {
      currentDepth--;
    }
  }
  
  return maxDepth;
}

/**
 * Extract functions from TypeScript code
 */
function extractFunctions(content, filePath) {
  const functions = [];
  
  // Patterns to match different function types
  const patterns = [
    // Regular functions: function name() {}
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g,
    // Arrow functions: const name = () => {}
    /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>\s*\{/g,
    // Class methods: methodName() {}
    /(?:public|private|protected|static|async)?\s*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g
  ];
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const functionName = match[1];
      const startIndex = match.index;
      
      // Find the end of the function by matching braces
      let braceCount = 1;
      let endIndex = startIndex + match[0].length;
      
      while (braceCount > 0 && endIndex < content.length) {
        if (content[endIndex] === '{') braceCount++;
        if (content[endIndex] === '}') braceCount--;
        endIndex++;
      }
      
      const functionCode = content.substring(startIndex, endIndex);
      const lines = functionCode.split('\n').length;
      const complexity = calculateComplexity(functionCode);
      const nestingDepth = calculateNestingDepth(functionCode);
      
      functions.push({
        name: functionName,
        file: filePath,
        lines,
        complexity,
        nestingDepth,
        startLine: content.substring(0, startIndex).split('\n').length
      });
    }
  });
  
  return functions;
}

/**
 * Recursively find all TypeScript files
 */
function findTypeScriptFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip node_modules, dist, coverage, etc.
      if (!['node_modules', 'dist', 'coverage', '.git', '__tests__'].includes(file)) {
        findTypeScriptFiles(filePath, fileList);
      }
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

/**
 * Analyze all TypeScript files
 */
function analyzeComplexity() {
  console.log('🔍 Analyzing code complexity...\n');
  
  const files = findTypeScriptFiles(SRC_DIR);
  const allFunctions = [];
  const fileStats = [];
  
  files.forEach(filePath => {
    const content = fs.readFileSync(filePath, 'utf-8');
    const relativePath = path.relative(path.join(__dirname, '..'), filePath);
    const functions = extractFunctions(content, relativePath);
    
    allFunctions.push(...functions);
    
    const lines = content.split('\n').length;
    const avgComplexity = functions.length > 0
      ? functions.reduce((sum, f) => sum + f.complexity, 0) / functions.length
      : 0;
    
    fileStats.push({
      file: relativePath,
      lines,
      functions: functions.length,
      avgComplexity: Math.round(avgComplexity * 100) / 100,
      maxComplexity: functions.length > 0 ? Math.max(...functions.map(f => f.complexity)) : 0
    });
  });
  
  // Sort functions by complexity
  const highComplexity = allFunctions
    .filter(f => f.complexity > COMPLEXITY_THRESHOLDS.low)
    .sort((a, b) => b.complexity - a.complexity);
  
  // Sort functions by length
  const longFunctions = allFunctions
    .filter(f => f.lines > LENGTH_THRESHOLDS.medium)
    .sort((a, b) => b.lines - a.lines);
  
  // Sort functions by nesting depth
  const deeplyNested = allFunctions
    .filter(f => f.nestingDepth > NESTING_THRESHOLDS.moderate)
    .sort((a, b) => b.nestingDepth - a.nestingDepth);
  
  // Calculate statistics
  const stats = {
    totalFiles: files.length,
    totalFunctions: allFunctions.length,
    totalLines: fileStats.reduce((sum, f) => sum + f.lines, 0),
    avgComplexity: allFunctions.length > 0
      ? Math.round((allFunctions.reduce((sum, f) => sum + f.complexity, 0) / allFunctions.length) * 100) / 100
      : 0,
    avgFunctionLength: allFunctions.length > 0
      ? Math.round((allFunctions.reduce((sum, f) => sum + f.lines, 0) / allFunctions.length) * 100) / 100
      : 0,
    complexityDistribution: {
      low: allFunctions.filter(f => f.complexity <= COMPLEXITY_THRESHOLDS.low).length,
      moderate: allFunctions.filter(f => f.complexity > COMPLEXITY_THRESHOLDS.low && f.complexity <= COMPLEXITY_THRESHOLDS.moderate).length,
      high: allFunctions.filter(f => f.complexity > COMPLEXITY_THRESHOLDS.moderate && f.complexity <= COMPLEXITY_THRESHOLDS.high).length,
      veryHigh: allFunctions.filter(f => f.complexity > COMPLEXITY_THRESHOLDS.high).length
    }
  };
  
  const result = {
    timestamp: new Date().toISOString(),
    summary: stats,
    highComplexityFunctions: highComplexity.slice(0, 50),
    longFunctions: longFunctions.slice(0, 50),
    deeplyNestedFunctions: deeplyNested.slice(0, 30),
    fileStats: fileStats.sort((a, b) => b.maxComplexity - a.maxComplexity)
  };
  
  // Write results
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  
  console.log('✅ Complexity analysis complete!\n');
  console.log(`📊 Summary:`);
  console.log(`   Total files: ${stats.totalFiles}`);
  console.log(`   Total functions: ${stats.totalFunctions}`);
  console.log(`   Average complexity: ${stats.avgComplexity}`);
  console.log(`   Average function length: ${stats.avgFunctionLength} lines`);
  console.log(`\n📈 Complexity distribution:`);
  console.log(`   Low (≤10): ${stats.complexityDistribution.low} functions`);
  console.log(`   Moderate (11-20): ${stats.complexityDistribution.moderate} functions`);
  console.log(`   High (21-30): ${stats.complexityDistribution.high} functions`);
  console.log(`   Very High (>30): ${stats.complexityDistribution.veryHigh} functions`);
  console.log(`\n⚠️  High complexity functions: ${highComplexity.length}`);
  console.log(`⚠️  Long functions (>50 lines): ${longFunctions.length}`);
  console.log(`⚠️  Deeply nested functions (>4 levels): ${deeplyNested.length}`);
  console.log(`\n📄 Results saved to: ${OUTPUT_FILE}`);
  
  return result;
}

// Run analysis
try {
  analyzeComplexity();
} catch (error) {
  console.error('❌ Error analyzing complexity:', error);
  process.exit(1);
}
