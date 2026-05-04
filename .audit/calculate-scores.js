#!/usr/bin/env node

/**
 * Score Calculation Script for ClaudeFlow Comprehensive Audit
 * 
 * This script calculates health scores for each audit category and an overall score.
 * 
 * Scoring Methodology:
 * - Start with 100 points per category
 * - Deduct points based on issue priority and count
 * - Critical issues: -15 points each
 * - High issues: -8 points each
 * - Medium issues: -4 points each
 * - Low issues: -1 point each
 * - Minimum score: 0 (cannot go negative)
 * 
 * Overall Score:
 * - Weighted average of all category scores
 * - Security and Testing have higher weights (15% each)
 * - Other categories: 10% each
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load consolidated issues
const issuesPath = path.join(__dirname, 'consolidated-issues.json');
const issuesData = JSON.parse(fs.readFileSync(issuesPath, 'utf-8'));

// Category mapping
const CATEGORIES = {
  'Architecture & Design Patterns': 'architecture',
  'Code Quality': 'codeQuality',
  'ES Module Compliance': 'esModuleCompliance',
  'Error Handling': 'errorHandling',
  'Testing': 'testing',
  'Security': 'security',
  'Performance': 'performance',
  'Documentation': 'documentation',
  'Configuration & Environment': 'configuration',
  'Dependencies': 'dependencies'
};

// Point deductions by priority
const DEDUCTIONS = {
  critical: 15,
  high: 8,
  medium: 4,
  low: 1,
  backlog: 0
};

// Category weights for overall score
const WEIGHTS = {
  architecture: 0.10,
  codeQuality: 0.10,
  esModuleCompliance: 0.05,
  errorHandling: 0.10,
  testing: 0.15,        // Higher weight - critical for quality
  security: 0.15,       // Higher weight - critical for production
  performance: 0.10,
  documentation: 0.10,
  configuration: 0.05,
  dependencies: 0.10
};

/**
 * Calculate score for a category
 */
function calculateCategoryScore(categoryName) {
  const issues = issuesData.issues.filter(issue => issue.category === categoryName);
  
  let score = 100;
  let deductions = 0;
  const breakdown = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };
  
  for (const issue of issues) {
    const priority = issue.priority.toLowerCase();
    const deduction = DEDUCTIONS[priority] || 0;
    
    score -= deduction;
    deductions += deduction;
    breakdown[priority]++;
  }
  
  // Ensure score doesn't go below 0
  score = Math.max(0, score);
  
  return {
    category: categoryName,
    score: Math.round(score),
    issueCount: issues.length,
    breakdown,
    deductions,
    grade: getGrade(score)
  };
}

/**
 * Get letter grade from score
 */
function getGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Calculate overall weighted score
 */
function calculateOverallScore(categoryScores) {
  let weightedSum = 0;
  let totalWeight = 0;
  
  for (const [categoryName, categoryKey] of Object.entries(CATEGORIES)) {
    const categoryScore = categoryScores.find(s => s.category === categoryName);
    if (categoryScore) {
      const weight = WEIGHTS[categoryKey];
      weightedSum += categoryScore.score * weight;
      totalWeight += weight;
    }
  }
  
  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  
  return {
    score: Math.round(overallScore),
    grade: getGrade(overallScore),
    weights: WEIGHTS
  };
}

/**
 * Collect metrics from various sources
 */
function collectMetrics() {
  const metrics = {
    codeMetrics: {},
    testMetrics: {},
    dependencyMetrics: {},
    issueMetrics: {}
  };
  
  // Code metrics from baseline
  try {
    const baselinePath = path.join(__dirname, 'baseline-metrics.json');
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    metrics.codeMetrics = {
      totalFiles: baseline.fileCount || 0,
      totalLines: baseline.lineCount || 0,
      buildTime: baseline.buildTime || 0,
      testCount: baseline.testCount || 0
    };
  } catch (error) {
    console.warn('Could not load baseline metrics:', error.message);
  }
  
  // Test metrics from coverage
  try {
    const coveragePath = path.join(__dirname, 'coverage-analysis.json');
    const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
    metrics.testMetrics = {
      lineCoverage: coverage.summary?.lines?.pct || 0,
      branchCoverage: coverage.summary?.branches?.pct || 0,
      functionCoverage: coverage.summary?.functions?.pct || 0,
      statementCoverage: coverage.summary?.statements?.pct || 0,
      untestedFiles: coverage.untestedFiles?.length || 0,
      lowCoverageFiles: coverage.lowCoverageFiles?.length || 0
    };
  } catch (error) {
    console.warn('Could not load coverage metrics:', error.message);
  }
  
  // Dependency metrics
  try {
    const depPath = path.join(__dirname, 'dependency-analysis.json');
    const deps = JSON.parse(fs.readFileSync(depPath, 'utf-8'));
    metrics.dependencyMetrics = {
      totalDependencies: deps.summary?.totalDependencies || 0,
      vulnerabilities: deps.audit?.vulnerabilities || 0,
      outdatedPackages: deps.outdated?.length || 0,
      unusedDependencies: deps.unused?.length || 0
    };
  } catch (error) {
    console.warn('Could not load dependency metrics:', error.message);
  }
  
  // Issue metrics from consolidated issues
  metrics.issueMetrics = {
    totalIssues: issuesData.metadata.totalIssues,
    critical: issuesData.metadata.priorityCounts.critical,
    high: issuesData.metadata.priorityCounts.high,
    medium: issuesData.metadata.priorityCounts.medium,
    low: issuesData.metadata.priorityCounts.low,
    breakingChanges: issuesData.metadata.breakingChanges.length,
    quickWins: issuesData.metadata.quickWins.length,
    complexIssues: issuesData.metadata.complexIssues.length
  };
  
  return metrics;
}

/**
 * Main execution
 */
function main() {
  console.log('🔢 Calculating audit scores...\n');
  
  // Calculate category scores
  const categoryScores = [];
  for (const categoryName of Object.keys(CATEGORIES)) {
    const score = calculateCategoryScore(categoryName);
    categoryScores.push(score);
    console.log(`${categoryName}: ${score.score}/100 (${score.grade}) - ${score.issueCount} issues`);
  }
  
  console.log('\n');
  
  // Calculate overall score
  const overallScore = calculateOverallScore(categoryScores);
  console.log(`Overall Score: ${overallScore.score}/100 (${overallScore.grade})`);
  
  // Collect metrics
  console.log('\n📊 Collecting metrics...\n');
  const metrics = collectMetrics();
  
  // Generate output
  const output = {
    metadata: {
      project: issuesData.metadata.project,
      auditDate: issuesData.metadata.auditDate,
      version: issuesData.metadata.version,
      calculatedAt: new Date().toISOString()
    },
    overallScore: overallScore,
    categoryScores: categoryScores,
    metrics: metrics,
    methodology: {
      description: 'Score calculation based on issue priority and count',
      deductions: DEDUCTIONS,
      weights: WEIGHTS,
      formula: 'Start with 100 points, deduct based on priority, apply category weights for overall score'
    }
  };
  
  // Save to file
  const outputPath = path.join(__dirname, 'audit-scores.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`✅ Scores saved to ${outputPath}`);
  
  // Generate summary report
  generateSummaryReport(output);
}

/**
 * Generate human-readable summary report
 */
function generateSummaryReport(data) {
  const lines = [];
  
  lines.push('# Audit Score Summary');
  lines.push('');
  lines.push(`**Project:** ${data.metadata.project}`);
  lines.push(`**Audit Date:** ${data.metadata.auditDate}`);
  lines.push(`**Calculated:** ${data.metadata.calculatedAt}`);
  lines.push('');
  
  lines.push('## Overall Health Score');
  lines.push('');
  lines.push(`**Score:** ${data.overallScore.score}/100 (Grade: ${data.overallScore.grade})`);
  lines.push('');
  
  // Score interpretation
  const score = data.overallScore.score;
  let interpretation = '';
  if (score >= 90) {
    interpretation = '🟢 **Excellent** - Production ready with minor improvements needed';
  } else if (score >= 80) {
    interpretation = '🟡 **Good** - Production ready with some improvements recommended';
  } else if (score >= 70) {
    interpretation = '🟠 **Fair** - Needs improvements before production deployment';
  } else if (score >= 60) {
    interpretation = '🔴 **Poor** - Significant issues need to be addressed';
  } else {
    interpretation = '🔴 **Critical** - Major issues must be resolved before deployment';
  }
  
  lines.push(interpretation);
  lines.push('');
  
  lines.push('## Category Scores');
  lines.push('');
  lines.push('| Category | Score | Grade | Issues | Critical | High | Medium | Low |');
  lines.push('|----------|-------|-------|--------|----------|------|--------|-----|');
  
  for (const cat of data.categoryScores) {
    const emoji = cat.grade === 'A' ? '🟢' : cat.grade === 'B' ? '🟡' : cat.grade === 'C' ? '��' : '🔴';
    lines.push(`| ${emoji} ${cat.category} | ${cat.score}/100 | ${cat.grade} | ${cat.issueCount} | ${cat.breakdown.critical} | ${cat.breakdown.high} | ${cat.breakdown.medium} | ${cat.breakdown.low} |`);
  }
  
  lines.push('');
  lines.push('## Key Metrics');
  lines.push('');
  
  // Code metrics
  if (data.metrics.codeMetrics.totalFiles) {
    lines.push('### Code Metrics');
    lines.push('');
    lines.push(`- **Total Files:** ${data.metrics.codeMetrics.totalFiles}`);
    lines.push(`- **Total Lines:** ${data.metrics.codeMetrics.totalLines.toLocaleString()}`);
    lines.push(`- **Build Time:** ${data.metrics.codeMetrics.buildTime}ms`);
    lines.push(`- **Test Count:** ${data.metrics.codeMetrics.testCount}`);
    lines.push('');
  }
  
  // Test metrics
  if (data.metrics.testMetrics.lineCoverage) {
    lines.push('### Test Coverage');
    lines.push('');
    lines.push(`- **Line Coverage:** ${data.metrics.testMetrics.lineCoverage.toFixed(2)}%`);
    lines.push(`- **Branch Coverage:** ${data.metrics.testMetrics.branchCoverage.toFixed(2)}%`);
    lines.push(`- **Function Coverage:** ${data.metrics.testMetrics.functionCoverage.toFixed(2)}%`);
    lines.push(`- **Untested Files:** ${data.metrics.testMetrics.untestedFiles}`);
    lines.push(`- **Low Coverage Files:** ${data.metrics.testMetrics.lowCoverageFiles}`);
    lines.push('');
  }
  
  // Issue metrics
  lines.push('### Issue Summary');
  lines.push('');
  lines.push(`- **Total Issues:** ${data.metrics.issueMetrics.totalIssues}`);
  lines.push(`- **Critical:** ${data.metrics.issueMetrics.critical}`);
  lines.push(`- **High:** ${data.metrics.issueMetrics.high}`);
  lines.push(`- **Medium:** ${data.metrics.issueMetrics.medium}`);
  lines.push(`- **Low:** ${data.metrics.issueMetrics.low}`);
  lines.push(`- **Breaking Changes:** ${data.metrics.issueMetrics.breakingChanges}`);
  lines.push(`- **Quick Wins:** ${data.metrics.issueMetrics.quickWins}`);
  lines.push(`- **Complex Issues:** ${data.metrics.issueMetrics.complexIssues}`);
  lines.push('');
  
  lines.push('## Scoring Methodology');
  lines.push('');
  lines.push('**Point Deductions:**');
  lines.push('- Critical issues: -15 points each');
  lines.push('- High issues: -8 points each');
  lines.push('- Medium issues: -4 points each');
  lines.push('- Low issues: -1 point each');
  lines.push('');
  lines.push('**Category Weights:**');
  lines.push('- Security: 15% (highest priority)');
  lines.push('- Testing: 15% (highest priority)');
  lines.push('- Architecture: 10%');
  lines.push('- Code Quality: 10%');
  lines.push('- Error Handling: 10%');
  lines.push('- Performance: 10%');
  lines.push('- Documentation: 10%');
  lines.push('- Dependencies: 10%');
  lines.push('- Configuration: 5%');
  lines.push('- ES Module Compliance: 5%');
  lines.push('');
  
  const reportPath = path.join(__dirname, 'audit-score-summary.md');
  fs.writeFileSync(reportPath, lines.join('\n'));
  console.log(`✅ Summary report saved to ${reportPath}`);
}

// Run the script
main();
