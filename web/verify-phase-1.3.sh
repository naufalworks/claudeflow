#!/bin/bash
# Phase 1.3 Verification Script
# Verifies all deliverables are correctly implemented

echo "=========================================="
echo "Phase 1.3: State Management & WebSocket"
echo "Verification Script"
echo "=========================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0

# Function to check file exists
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $2"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $2 (missing: $1)"
        ((FAILED++))
    fi
}

# Function to check directory exists
check_dir() {
    if [ -d "$1" ]; then
        echo -e "${GREEN}✓${NC} $2"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $2 (missing: $1)"
        ((FAILED++))
    fi
}

echo "1. Checking Directory Structure..."
echo "-----------------------------------"
check_dir "src/store" "Store directory"
check_dir "src/lib" "Lib directory"
check_dir "src/hooks" "Hooks directory"
check_dir "src/examples" "Examples directory"
echo ""

echo "2. Checking Zustand Stores..."
echo "-----------------------------------"
check_file "src/store/auth-store.ts" "Authentication Store"
check_file "src/store/accounts-store.ts" "Accounts Store"
check_file "src/store/ui-store.ts" "UI Store"
check_file "src/store/index.ts" "Store exports"
echo ""

echo "3. Checking WebSocket Client..."
echo "-----------------------------------"
check_file "src/lib/websocket-client.ts" "WebSocket Client"
check_file "src/lib/index.ts" "Lib exports"
echo ""

echo "4. Checking Custom Hooks..."
echo "-----------------------------------"
check_file "src/hooks/useWebSocket.ts" "useWebSocket Hook"
check_file "src/hooks/useAccounts.ts" "useAccounts Hook"
check_file "src/hooks/useAnalytics.ts" "useAnalytics Hook"
check_file "src/hooks/index.ts" "Hooks exports"
echo ""

echo "5. Checking Documentation..."
echo "-----------------------------------"
check_file "PHASE_1.3_IMPLEMENTATION.md" "Implementation Guide"
check_file "PHASE_1.3_SUMMARY.md" "Summary Document"
check_file "src/examples/state-management-examples.tsx" "Usage Examples"
echo ""

echo "6. Checking Dependencies..."
echo "-----------------------------------"
if npm list zustand &>/dev/null; then
    echo -e "${GREEN}✓${NC} zustand installed"
    ((PASSED++))
else
    echo -e "${RED}✗${NC} zustand not installed"
    ((FAILED++))
fi

if npm list ws &>/dev/null; then
    echo -e "${GREEN}✓${NC} ws installed"
    ((PASSED++))
else
    echo -e "${RED}✗${NC} ws not installed"
    ((FAILED++))
fi
echo ""

echo "7. Running TypeScript Build..."
echo "-----------------------------------"
if npm run build &>/dev/null; then
    echo -e "${GREEN}✓${NC} TypeScript compilation successful"
    ((PASSED++))
else
    echo -e "${RED}✗${NC} TypeScript compilation failed"
    ((FAILED++))
fi
echo ""

echo "8. Code Statistics..."
echo "-----------------------------------"
STORE_LINES=$(wc -l src/store/*.ts 2>/dev/null | tail -1 | awk '{print $1}')
HOOKS_LINES=$(wc -l src/hooks/*.ts 2>/dev/null | tail -1 | awk '{print $1}')
LIB_LINES=$(wc -l src/lib/websocket-client.ts 2>/dev/null | awk '{print $1}')
TOTAL_LINES=$((STORE_LINES + HOOKS_LINES + LIB_LINES))

echo "Store files: ${STORE_LINES} lines"
echo "Hook files: ${HOOKS_LINES} lines"
echo "WebSocket client: ${LIB_LINES} lines"
echo "Total: ${TOTAL_LINES} lines"
echo ""

echo "=========================================="
echo "Verification Results"
echo "=========================================="
echo -e "${GREEN}Passed: ${PASSED}${NC}"
if [ $FAILED -gt 0 ]; then
    echo -e "${RED}Failed: ${FAILED}${NC}"
else
    echo -e "${GREEN}Failed: ${FAILED}${NC}"
fi
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! Phase 1.3 is complete.${NC}"
    exit 0
else
    echo -e "${RED}✗ Some checks failed. Please review the output above.${NC}"
    exit 1
fi
