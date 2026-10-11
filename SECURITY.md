# Security Policy

## Critical - Current Status

- **.project-config.json contains exposed secrets** (JWT_SECRET, Forge API keys, OAuth endpoints, analytics IDs, Cloudflare artifact token/URL).
- **Status:** NOT committed to git (git repo not initialized). Still present in filesystem. Must be revoked/rotated and removed.

## Remediation Required

1. Revoke/rotate all exposed credentials immediately:
   - JWT_SECRET
   - BUILT_IN_FORGE_API_KEY / VITE_FRONTEND_FORGE_API_KEY
   - BUILT_IN_FORGE_API_URL / VITE_FRONTEND_FORGE_API_URL / OAUTH_SERVER_URL / VITE_OAUTH_PORTAL_URL
   - VITE_ANALYTICS_ENDPOINT / VITE_ANALYTICS_WEBSITE_ID
   - Cloudflare artifact git remote token and URL (art*v2*...)
   - Any other provider keys present

2. Remove sensitive files from working tree (never commit):
   - Delete .project-config.json after extracting non-secret config if needed
   - Ensure .env\* files are gitignored

3. Git hygiene:
   - Initialize git with git init
   - Add .gitignore (already excludes .project-config.json, .env\*)
   - Never commit secrets

## Reporting

If you discover additional secrets, revoke immediately and document here.

## Environment Variables

Use .env.local for development (gitignored). See .env.example for placeholders only.
