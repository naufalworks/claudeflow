# ClaudeFlow Authentication

This document describes the authentication system used in ClaudeFlow, including how API keys are created, validated, and used to access the Web UI and API endpoints.

---

## Overview

ClaudeFlow uses a simple API key-based authentication system. API keys are stored in environment variables and validated on every request to protected endpoints.

**Key Points:**
- API keys are stored in the `.env` file
- Keys are validated via Bearer token authentication
- Web UI stores keys in localStorage after login
- All API endpoints (except `/health` and `/ready`) require authentication

---

## Current Authentication Flow

### 1. API Key Storage

API keys are stored in the `.env` file in the project root:

```bash
CLAUDEFLOW_API_KEYS=claudeflow-dev-key,claudeflow-prod-key,another-key
```

**Format:**
- Comma-separated list of valid API keys
- No spaces between keys
- Keys can be any string (recommend using a prefix like `claudeflow-`)

### 2. Server Startup

When the ClaudeFlow server starts:

1. Reads `CLAUDEFLOW_API_KEYS` from environment variables
2. Splits the string by commas to create an array of valid keys
3. Stores the keys in memory for validation

**Code:** `/src/server/index.ts:94`
```typescript
const validApiKeys = process.env.CLAUDEFLOW_API_KEYS?.split(',') || [];
```

### 3. Web UI Login

**Location:** `http://localhost:3001/login`

**Steps:**
1. User enters API key in the password field
2. Frontend stores key in `localStorage` as `apiKey`
3. Frontend redirects to dashboard
4. All subsequent API requests include the key in the Authorization header

**Code:** `/web/app/login/page.tsx`

### 4. API Request Authentication

Every API request (except health checks) goes through authentication middleware:

**Location:** `/src/server/index.ts:73-120`

**Process:**
1. Extract `Authorization` header from request
2. Check if header starts with `Bearer `
3. Extract API key (remove `Bearer ` prefix)
4. Validate key against `CLAUDEFLOW_API_KEYS` list
5. If valid: attach user info to request and continue
6. If invalid: return 401 Unauthorized

**Example Request:**
```bash
curl -H "Authorization: Bearer claudeflow-dev-key" \
  http://localhost:20129/api/dashboard/accounts
```

### 5. Development Mode

If no API keys are configured (`CLAUDEFLOW_API_KEYS` is empty or not set):
- Server runs in "open mode"
- All requests are allowed
- Warning logged: "No API keys configured - running in open mode"

**⚠️ Warning:** Never run in production without API keys configured.

---

## How to Create a New API Key

### Current Manual Process

1. **Edit the `.env` file:**
   ```bash
   nano .env
   ```

2. **Add or update `CLAUDEFLOW_API_KEYS`:**
   ```bash
   CLAUDEFLOW_API_KEYS=existing-key,new-key-here
   ```

3. **Restart the server:**
   ```bash
   npm run dev
   ```

4. **Use the new key to login:**
   - Go to `http://localhost:3001/login`
   - Enter the new key in the password field
   - Click "Sign In"

### Key Naming Recommendations

- Use a consistent prefix: `claudeflow-`
- Include environment: `claudeflow-dev-`, `claudeflow-prod-`
- Add purpose: `claudeflow-dev-testing`, `claudeflow-prod-api`
- Use random suffixes for security: `claudeflow-prod-a8f3k2m9`

**Example:**
```bash
CLAUDEFLOW_API_KEYS=claudeflow-dev-local,claudeflow-prod-api-x7k2,claudeflow-test-ci-m3n8
```

---

## Security Considerations

### Current Limitations

1. **No Key Expiration:** Keys never expire automatically
2. **No Key Rotation:** Must manually update `.env` and restart server
3. **No Permissions:** All keys have full access to all endpoints
4. **No Audit Log:** No tracking of which key made which request
5. **Plain Text Storage:** Keys stored in plain text in `.env` file

### Best Practices

1. **Use Strong Keys:**
   - Minimum 20 characters
   - Include random alphanumeric characters
   - Use a key generator: `openssl rand -base64 32`

2. **Limit Key Distribution:**
   - Only share keys with authorized users
   - Use different keys for different environments
   - Revoke keys when team members leave

3. **Protect the `.env` File:**
   - Never commit `.env` to version control
   - Ensure `.env` is in `.gitignore`
   - Set proper file permissions: `chmod 600 .env`

4. **Monitor Usage:**
   - Check server logs for authentication failures
   - Look for suspicious API key usage patterns

---

## API Endpoints

### Protected Endpoints

All endpoints require `Authorization: Bearer <api-key>` header:

- `POST /v1/messages` - Main request processing
- `GET /v1/models` - List available models
- `GET /admin/analytics` - Analytics and insights
- `GET /metrics` - Prometheus metrics
- `GET /api/dashboard/accounts` - List accounts
- `GET /api/dashboard/accounts/:id` - Account details
- `DELETE /api/dashboard/accounts/:id` - Delete account
- `GET /api/dashboard/activity` - Activity stream
- `GET /api/dashboard/stats` - Dashboard statistics
- `POST /api/dashboard/accounts/:id/refresh` - Refresh account token

### Public Endpoints

No authentication required:

- `GET /health` - Health check
- `GET /ready` - Readiness check

---

## Troubleshooting

### "Missing or invalid Authorization header"

**Cause:** Request missing `Authorization` header or not in correct format

**Solution:**
```bash
# Wrong
curl http://localhost:20129/api/dashboard/accounts

# Correct
curl -H "Authorization: Bearer your-api-key" \
  http://localhost:20129/api/dashboard/accounts
```

### "Invalid API key"

**Cause:** API key not in `CLAUDEFLOW_API_KEYS` list

**Solution:**
1. Check `.env` file for correct key
2. Ensure no extra spaces in comma-separated list
3. Restart server after updating `.env`

### "No API keys configured - running in open mode"

**Cause:** `CLAUDEFLOW_API_KEYS` environment variable not set

**Solution:**
1. Add `CLAUDEFLOW_API_KEYS` to `.env` file
2. Restart server

### Web UI Login Fails

**Cause:** API key not valid or server not running

**Solution:**
1. Check server is running: `curl http://localhost:20129/health`
2. Verify API key in `.env` file
3. Check browser console for error messages
4. Clear localStorage: `localStorage.clear()` in browser console

---

## Future Improvements

### Recommended Enhancements

1. **Database-Backed Keys:**
   - Store keys in Redis or database
   - Enable key creation without server restart
   - Add key metadata (name, created date, last used)

2. **Key Management API:**
   - `POST /api/keys` - Create new key
   - `GET /api/keys` - List all keys
   - `DELETE /api/keys/:id` - Revoke key
   - `PUT /api/keys/:id` - Update key metadata

3. **Key Permissions:**
   - Read-only keys (analytics, dashboard)
   - Write keys (create requests)
   - Admin keys (full access)

4. **Key Expiration:**
   - Set expiration date on key creation
   - Automatic cleanup of expired keys
   - Email notifications before expiration

5. **Key Rotation:**
   - Automatic key rotation schedule
   - Grace period for old keys
   - Notification system for key updates

6. **Audit Logging:**
   - Track which key made which request
   - Log authentication failures
   - Generate usage reports per key

7. **Rate Limiting per Key:**
   - Different rate limits for different keys
   - Prevent abuse from compromised keys

---

## Related Files

- `/src/server/index.ts:73-120` - Authentication middleware
- `/web/app/login/page.tsx` - Web UI login page
- `/.env` - API key storage
- `/web/src/hooks/useAccounts.ts` - Frontend API calls with auth

---

## Questions?

For issues or questions about authentication:
1. Check server logs for authentication errors
2. Verify `.env` configuration
3. Test with curl to isolate frontend vs backend issues
4. Review this documentation for common troubleshooting steps
