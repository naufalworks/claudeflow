#!/usr/bin/env node

/**
 * ES Module Import Scanner
 * Scans all TypeScript files for import statements and validates ES module compliance
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const issues = [];

function scanDirectory(dir, baseDir = dir) {
  const entries = readdirSync(dir);
  
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist' && entry !== '.git') {
        scanDirectory(fullPath, baseDir);
      }
    } else if (entry.endsWith('.ts')) {
      scanFile(fullPath, baseDir);
    }
  }
}

function scanFile(filePath, baseDir) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = relative(baseDir, filePath);
  
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    
    // Match import statements
    const importMatch = line.match(/import\s+.*\s+from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const importPath = importMatch[1];
      
      // Check for relative imports without .js extension
      if (importPath.startsWith('.') && !importPath.endsWith('.js')) {
        issues.push({
          type: 'missing-js-extension',
          file: relativePath,
          line: lineNumber,
          importPath: importPath,
          suggestion: importPath + '.js'
        });
      }
      
      // Check for directory imports (e.g., '../types' instead of '../types/index.js')
      if (importPath.startsWith('.') && !importPath.includes('/index.js') && !importPath.match(/\.[a-z]+$/)) {
        // This might be a directory import
        const lastSegment = importPath.split('/').pop();
        if (lastSegment && !lastSegment.includes('.')) {
          issues.push({
            type: 'possible-directory-import',
            file: relativePath,
            line: lineNumber,
            importPath: importPath,
            suggestion: importPath + '/index.js'
          });
        }
      }
    }
    
    // Match export statements
    const exportMatch = line.match(/export\s+.*\s+from\s+['"]([^'"]+)['"]/);
    if (exportMatch) {
      const exportPath = exportMatch[1];
      
      // Check for relative exports without .js extension
      if (exportPath.startsWith('.') && !exportPath.endsWith('.js')) {
        issues.push({
          type: 'missing-js-extension-export',
          file: relativePath,
          line: lineNumber,
          importPath: exportPath,
          suggestion: exportPath + '.js'
        });
      }
    }
  });
}

// Scan src directory
console.log('Scanning TypeScript files for ES module compliance...\n');
scanDirectory('src');

// Report results
console.log(`Total issues found: ${issues.length}\n`);

if (issues.length > 0) {
  const byType = {};
  issues.forEach(issue => {
    if (!byType[issue.type]) byType[issue.type] = [];
    byType[issue.type].push(issue);
  });
  
  for (const [type, typeIssues] of Object.entries(byType)) {
    console.log(`\n${type}: ${typeIssues.length} issues`);
    console.log('='.repeat(60));
    
    typeIssues.slice(0, 10).forEach(issue => {
      console.log(`  ${issue.file}:${issue.line}`);
      console.log(`    Import: ${issue.importPath}`);
      console.log(`    Suggest: ${issue.suggestion}`);
    });
    
    if (typeIssues.length > 10) {
      console.log(`  ... and ${typeIssues.length - 10} more`);
    }
  }
}

// Write results to JSON
import { writeFileSync } from 'fs';
writeFileSync('.audit/es-module-scan.json', JSON.stringify({
  timestamp: new Date().toISOString(),
  totalIssues: issues.length,
  issuesByType: Object.fromEntries(
    Object.entries(
      issues.reduce((acc, issue) => {
        acc[issue.type] = (acc[issue.type] || 0) + 1;
        return acc;
      }, {})
    )
  ),
  issues: issues
}, null, 2));

console.log('\n\nResults saved to .audit/es-module-scan.json');
process.exit(issues.length > 0 ? 1 : 0);
