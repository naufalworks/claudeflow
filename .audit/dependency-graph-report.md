# Dependency Graph Analysis Report

**Generated**: 2026-05-02T16:31:58.743Z  
**Project**: ClaudeFlow  
**Total Modules**: 84

---

## Executive Summary

The dependency graph analysis reveals a well-structured codebase with moderate coupling. However, there are several areas requiring attention:

- **1 circular dependency** detected (HIGH severity)
- **8 highly coupled modules** (>10 total coupling)
- **Average instability**: 0.594 (moderate)
- **Average total coupling**: 4.86 (acceptable)

### Health Score: **72/100** (Good)

**Breakdown**:
- Circular Dependencies: -20 points (1 found)
- High Coupling: -8 points (8 modules)
- Overall coupling: +0 points (within acceptable range)

---

## 1. Circular Dependencies

### 🔴 CRITICAL: Server Circular Dependency

**Cycle**: `server/index.ts` ↔ `server/routes.ts`

**Severity**: HIGH

**Description**: The server index and routes modules have a circular dependency, which can lead to:
- Initialization order issues
- Difficult-to-debug runtime errors
- Module loading problems
- Tight coupling between modules

**Impact**:
- Makes testing more difficult
- Reduces modularity
- Can cause subtle bugs during initialization
- Prevents clean separation of concerns

**Recommendation**:
1. Extract shared types/interfaces to a separate `server/types.ts` file
2. Move route registration logic to `server/index.ts`
3. Keep route handlers in `server/routes.ts` but import only types from index
4. Consider using dependency injection pattern

**Priority**: CRITICAL - Fix immediately

---

## 2. Highly Coupled Modules

### Top 8 Modules by Total Coupling (>10)

#### 1. `cli/services/config-service.ts` (Total: 20)
- **Afferent Coupling**: 19 (19 modules depend on this)
- **Efferent Coupling**: 1 (depends on 1 module)
- **Instability**: 0.05 (very stable)
- **Status**: ✅ ACCEPTABLE - This is a foundational service that should be widely used

**Analysis**: Config service is correctly positioned as a stable, widely-used dependency. Low instability (0.05) indicates it's a stable foundation.

---

#### 2. `cli/utils/logger.ts` (Total: 19)
- **Afferent Coupling**: 19 (19 modules depend on this)
- **Efferent Coupling**: 0 (depends on nothing)
- **Instability**: 0.0 (maximally stable)
- **Status**: ✅ ACCEPTABLE - Logging utility should be widely used

**Analysis**: Perfect stability (0.0) for a utility module. This is the ideal pattern for cross-cutting concerns.

---

#### 3. `server/routes.ts` (Total: 18)
- **Afferent Coupling**: 2 (2 modules depend on this)
- **Efferent Coupling**: 16 (depends on 16 modules)
- **Instability**: 0.889 (very unstable)
- **Status**: ⚠️ NEEDS REVIEW - High efferent coupling indicates God Object pattern

**Analysis**: This module depends on too many other modules (16), suggesting it's doing too much. High instability (0.889) combined with high coupling is a code smell.

**Recommendations**:
1. Split into smaller, focused route modules (auth routes, analytics routes, etc.)
2. Extract business logic to service layer
3. Use dependency injection to reduce direct dependencies
4. Consider implementing a router pattern with sub-routers

**Priority**: HIGH

---

#### 4. `cli/commands/index.ts` (Total: 15)
- **Afferent Coupling**: 1
- **Efferent Coupling**: 14
- **Instability**: 0.933 (very unstable)
- **Status**: ✅ ACCEPTABLE - Barrel export file, expected to have high efferent coupling

**Analysis**: This is a barrel export file that aggregates all CLI commands. High efferent coupling is expected and acceptable for this pattern.

---

#### 5. `types/index.ts` (Total: 15)
- **Afferent Coupling**: 14
- **Efferent Coupling**: 1
- **Instability**: 0.067 (very stable)
- **Status**: ✅ ACCEPTABLE - Type definitions should be stable and widely used

**Analysis**: Excellent stability for a types module. This is the correct pattern.

---

#### 6. `server/__tests__/routes.test.ts` (Total: 14)
- **Afferent Coupling**: 0
- **Efferent Coupling**: 14
- **Instability**: 1.0 (maximally unstable)
- **Status**: ✅ ACCEPTABLE - Test files should depend on many modules

**Analysis**: Test files naturally have high efferent coupling. This is expected and acceptable.

---

#### 7. `types/anthropic.types.ts` (Total: 12)
- **Afferent Coupling**: 12
- **Efferent Coupling**: 0
- **Instability**: 0.0 (maximally stable)
- **Status**: ✅ ACCEPTABLE - Core type definitions should be stable

**Analysis**: Perfect stability for core type definitions. This is ideal.

---

#### 8. `cli/services/auth-service.ts` (Total: 11)
- **Afferent Coupling**: 6
- **Efferent Coupling**: 5
- **Instability**: 0.455 (moderate)
- **Status**: ✅ ACCEPTABLE - Balanced coupling for a service module

**Analysis**: Good balance between stability and flexibility. Moderate instability (0.455) is appropriate for a service layer.

---

## 3. Coupling Metrics Summary

### Overall Statistics

| Metric | Value | Assessment |
|--------|-------|------------|
| Average Instability | 0.594 | Moderate - Good balance |
| Average Total Coupling | 4.86 | Acceptable - Within normal range |
| Max Total Coupling | 20 | Acceptable - Config service |
| Min Total Coupling | 0 | Good - Isolated modules exist |
| Highly Coupled Modules | 8 | Acceptable - 9.5% of modules |

### Instability Distribution

- **Stable (0.0 - 0.3)**: 35 modules (41.7%) ✅
- **Moderate (0.3 - 0.7)**: 15 modules (17.9%) ✅
- **Unstable (0.7 - 1.0)**: 34 modules (40.5%) ⚠️

**Analysis**: Good distribution with a healthy mix of stable foundation modules and flexible application modules.

---

## 4. Most Depended-Upon Modules (Top 10)

These modules are critical to the system - changes here have wide impact:

| Rank | Module | Dependents | Instability | Status |
|------|--------|------------|-------------|--------|
| 1 | `cli/services/config-service.ts` | 19 | 0.05 | ✅ Stable |
| 2 | `cli/utils/logger.ts` | 19 | 0.00 | ✅ Stable |
| 3 | `types/index.ts` | 14 | 0.067 | ✅ Stable |
| 4 | `types/anthropic.types.ts` | 12 | 0.00 | ✅ Stable |
| 5 | `cli/types/cli.types.ts` | 10 | 0.00 | ✅ Stable |
| 6 | `infrastructure/redis.ts` | 10 | 0.00 | ✅ Stable |
| 7 | `accounts/kiro-auth-manager.ts` | 6 | 0.143 | ✅ Stable |
| 8 | `cli/services/auth-service.ts` | 6 | 0.455 | ⚠️ Moderate |
| 9 | `optimizers/request-classifier.ts` | 6 | 0.143 | ✅ Stable |
| 10 | `cli/services/daemon-service.ts` | 5 | 0.286 | ✅ Stable |

**Key Observations**:
- ✅ Most critical modules (top 6) are highly stable (instability < 0.1)
- ✅ Type definitions and utilities are correctly positioned as stable foundations
- ⚠️ `cli/services/auth-service.ts` has moderate instability despite being widely used - consider stabilizing

---

## 5. Modules with Most Dependencies (Top 10)

These modules depend on many others - they are complex and may need refactoring:

| Rank | Module | Dependencies | Instability | Status |
|------|--------|--------------|-------------|--------|
| 1 | `server/routes.ts` | 16 | 0.889 | 🔴 Needs refactoring |
| 2 | `cli/commands/index.ts` | 14 | 0.933 | ✅ Barrel export |
| 3 | `server/__tests__/routes.test.ts` | 14 | 1.00 | ✅ Test file |
| 4 | `cli/commands/setup.ts` | 6 | 0.857 | ⚠️ Review |
| 5 | `cli/commands/account.ts` | 5 | 0.833 | ✅ Acceptable |
| 6 | `cli/commands/login.ts` | 5 | 0.833 | ✅ Acceptable |
| 7 | `cli/services/auth-service.ts` | 5 | 0.455 | ✅ Acceptable |
| 8 | `cli/services/index.ts` | 5 | 1.00 | ✅ Barrel export |
| 9 | `cli/utils/index.ts` | 5 | 1.00 | ✅ Barrel export |
| 10 | `index.ts` | 5 | 1.00 | ✅ Entry point |

**Key Observations**:
- 🔴 `server/routes.ts` is a clear outlier with 16 dependencies - requires refactoring
- ⚠️ `cli/commands/setup.ts` has 6 dependencies - consider splitting
- ✅ Most other high-dependency modules are barrel exports or test files (acceptable)

---

## 6. Architectural Insights

### Stable Dependencies Principle (SDP)

**Definition**: Dependencies should flow toward stability. Unstable modules should depend on stable modules, not vice versa.

**Assessment**: ✅ **GOOD** - The codebase generally follows SDP:
- Type definitions (instability 0.0) are at the bottom
- Utilities and infrastructure (instability 0.0-0.2) form stable foundation
- Services (instability 0.2-0.5) depend on stable modules
- Commands and routes (instability 0.7-1.0) are at the top

**Violations**: None detected

---

### Acyclic Dependencies Principle (ADP)

**Definition**: The dependency graph should be a directed acyclic graph (DAG).

**Assessment**: ❌ **VIOLATED** - 1 circular dependency found:
- `server/index.ts` ↔ `server/routes.ts`

**Impact**: HIGH - This is a critical violation that should be fixed immediately.

---

### Common Closure Principle (CCP)

**Definition**: Classes that change together should be packaged together.

**Assessment**: ✅ **GOOD** - Modules are well-organized by feature:
- `accounts/` - Account management (3 modules, low coupling)
- `analytics/` - Analytics engine (1 module, isolated)
- `cli/` - CLI functionality (well-organized into commands/services/utils)
- `optimizers/` - Request optimization (5 modules, moderate coupling)
- `parsers/` - Request/response parsing (4 modules, moderate coupling)
- `server/` - Server and routes (2 modules, circular dependency issue)

---

## 7. Recommendations

### Immediate Actions (Critical Priority)

1. **Fix Circular Dependency** (server/index.ts ↔ server/routes.ts)
   - Extract shared types to `server/types.ts`
   - Move route registration to `server/index.ts`
   - Estimated effort: 2-4 hours
   - Impact: HIGH - Improves maintainability and testability

### Short-term Actions (High Priority)

2. **Refactor server/routes.ts** (16 dependencies)
   - Split into feature-based route modules
   - Extract business logic to service layer
   - Reduce efferent coupling to <10
   - Estimated effort: 1-2 days
   - Impact: HIGH - Improves maintainability and testability

3. **Review cli/commands/setup.ts** (6 dependencies)
   - Consider splitting into smaller setup steps
   - Extract complex logic to service layer
   - Estimated effort: 4-6 hours
   - Impact: MEDIUM - Improves maintainability

### Medium-term Actions (Medium Priority)

4. **Stabilize cli/services/auth-service.ts**
   - Currently has 6 dependents but instability of 0.455
   - Reduce efferent coupling from 5 to 3-4
   - Extract volatile logic to separate modules
   - Estimated effort: 4-6 hours
   - Impact: MEDIUM - Improves stability of critical service

5. **Monitor Coupling Trends**
   - Set up automated coupling metrics tracking
   - Alert on modules exceeding coupling thresholds
   - Regular reviews of dependency graph
   - Estimated effort: 2-3 hours setup
   - Impact: LOW - Prevents future coupling issues

---

## 8. Coupling Thresholds

### Recommended Thresholds

| Metric | Threshold | Current | Status |
|--------|-----------|---------|--------|
| Max Total Coupling | 15 | 20 | ⚠️ Slightly exceeded |
| Max Efferent Coupling | 10 | 16 | 🔴 Exceeded |
| Circular Dependencies | 0 | 1 | 🔴 Exceeded |
| Highly Coupled Modules | <10% | 9.5% | ✅ Within threshold |
| Average Instability | 0.4-0.6 | 0.594 | ✅ Within threshold |

---

## 9. Conclusion

The ClaudeFlow codebase demonstrates **good overall architectural health** with a few notable issues:

**Strengths**:
- ✅ Well-organized module structure
- ✅ Stable foundation modules (types, utilities, infrastructure)
- ✅ Good adherence to Stable Dependencies Principle
- ✅ Reasonable average coupling (4.86)
- ✅ Most highly-coupled modules are appropriately stable

**Weaknesses**:
- 🔴 1 circular dependency (server modules) - CRITICAL
- 🔴 server/routes.ts has excessive dependencies (16) - HIGH
- ⚠️ 8 modules with high coupling (>10) - MEDIUM

**Overall Grade**: **B+ (Good)**

With the recommended fixes, particularly resolving the circular dependency and refactoring server/routes.ts, the codebase would achieve an **A (Excellent)** grade.

---

## Appendix: Dependency Graph Data

Full dependency analysis data is available in:
- `.audit/dependency-graph.json` - Complete dependency graph
- `.audit/dependency-analysis.json` - Coupling metrics and analysis
- `.audit/circular-dependencies.txt` - Circular dependency details

---

**End of Report**
