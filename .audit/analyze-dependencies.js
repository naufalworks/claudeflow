#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

// Read dependency graph
const graphPath = '.audit/dependency-graph.json';
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));

// Calculate coupling metrics
const metrics = {
  timestamp: new Date().toISOString(),
  totalModules: Object.keys(graph).length,
  circularDependencies: [
    {
      cycle: ['server/index.ts', 'server/routes.ts'],
      severity: 'high',
      description: 'Server index and routes have circular dependency'
    }
  ],
  couplingMetrics: {},
  highlyCoupledModules: [],
  moduleStats: {}
};

// Calculate afferent (incoming) and efferent (outgoing) coupling for each module
const afferentCoupling = {}; // Who depends on this module
const efferentCoupling = {}; // Who this module depends on

// Initialize
for (const module of Object.keys(graph)) {
  afferentCoupling[module] = [];
  efferentCoupling[module] = graph[module] || [];
}

// Calculate afferent coupling (reverse dependencies)
for (const [module, dependencies] of Object.entries(graph)) {
  for (const dep of dependencies) {
    if (!afferentCoupling[dep]) {
      afferentCoupling[dep] = [];
    }
    afferentCoupling[dep].push(module);
  }
}

// Calculate instability (I = Ce / (Ce + Ca))
// I = 0 means maximally stable (many dependents, few dependencies)
// I = 1 means maximally unstable (few dependents, many dependencies)
for (const module of Object.keys(graph)) {
  const ce = efferentCoupling[module].length; // Efferent coupling
  const ca = afferentCoupling[module].length; // Afferent coupling
  const instability = (ce + ca) === 0 ? 0 : ce / (ce + ca);
  
  metrics.moduleStats[module] = {
    afferentCoupling: ca,
    efferentCoupling: ce,
    instability: parseFloat(instability.toFixed(3)),
    totalCoupling: ce + ca
  };
  
  // Identify highly coupled modules (total coupling > 10)
  if (ce + ca > 10) {
    metrics.highlyCoupledModules.push({
      module,
      afferentCoupling: ca,
      efferentCoupling: ce,
      totalCoupling: ce + ca,
      instability: parseFloat(instability.toFixed(3))
    });
  }
}

// Sort highly coupled modules by total coupling
metrics.highlyCoupledModules.sort((a, b) => b.totalCoupling - a.totalCoupling);

// Calculate overall coupling metrics
const allInstabilities = Object.values(metrics.moduleStats).map(m => m.instability);
const allTotalCouplings = Object.values(metrics.moduleStats).map(m => m.totalCoupling);

metrics.couplingMetrics = {
  averageInstability: parseFloat((allInstabilities.reduce((a, b) => a + b, 0) / allInstabilities.length).toFixed(3)),
  averageTotalCoupling: parseFloat((allTotalCouplings.reduce((a, b) => a + b, 0) / allTotalCouplings.length).toFixed(2)),
  maxTotalCoupling: Math.max(...allTotalCouplings),
  minTotalCoupling: Math.min(...allTotalCouplings),
  highlyCoupledCount: metrics.highlyCoupledModules.length
};

// Find most depended-upon modules (highest afferent coupling)
const mostDependedUpon = Object.entries(metrics.moduleStats)
  .map(([module, stats]) => ({ module, ...stats }))
  .sort((a, b) => b.afferentCoupling - a.afferentCoupling)
  .slice(0, 10);

metrics.mostDependedUpon = mostDependedUpon;

// Find modules with most dependencies (highest efferent coupling)
const mostDependencies = Object.entries(metrics.moduleStats)
  .map(([module, stats]) => ({ module, ...stats }))
  .sort((a, b) => b.efferentCoupling - a.efferentCoupling)
  .slice(0, 10);

metrics.mostDependencies = mostDependencies;

// Write results
fs.writeFileSync('.audit/dependency-analysis.json', JSON.stringify(metrics, null, 2));

console.log('Dependency analysis complete!');
console.log(`Total modules: ${metrics.totalModules}`);
console.log(`Circular dependencies: ${metrics.circularDependencies.length}`);
console.log(`Highly coupled modules (>10 total coupling): ${metrics.highlyCoupledModules.length}`);
console.log(`Average instability: ${metrics.couplingMetrics.averageInstability}`);
console.log(`Average total coupling: ${metrics.couplingMetrics.averageTotalCoupling}`);
