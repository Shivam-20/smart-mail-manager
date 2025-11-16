### SmartMail AI — Copilot onboarding notes

This file gives a concise, actionable map for AI contributors to be immediately productive in this repository.

- Architecture (big picture)
  - Backend: Node.js + Express servers in `server-mongo.js` (main) and `server-simple.js` (demo / fallback). OAuth+Gmail logic lives in the server layer and is session-backed with `express-session` + `passport-google-oauth20`.
  - Database: two variants: SQLite (`database.js`) for a quick demo and MongoDB (`database-mongo.js`) for production features. `server-mongo.js` uses `database-mongo.js` and adds batch processing and analytics.
  - AI: `gemini-enhanced.js` (calls the Generative Language API) encapsulates prompt/response logic. Use rate limiting (DB-based) before calling Gemini to avoid API throttling.
  - Batch: `batch-processor.js` orchestrates multi-step operations (fetch → analyze → create labels → apply labels). Batches are saved in MongoDB (`batchLogs`) and have strict max sizes defined in `server-mongo.js`.
  - Frontend: React + Vite in `frontend/` (see `frontend/src/components/Dashboard.jsx`). Frontend expects backend on `http://localhost:3000` and uses `axios` with credentials.

- Why these choices (short)
  - Sessions + Passport keep OAuth tokens server-side and make token refresh routines (in `server-mongo.js`) predictable.
  - MongoDB provides a flexible schema for emails/labels/batches and supports TTL indexes and analytics pipelines (in `database-mongo.js`). SQLite is used for smaller/local demos.
  - Gemini calls are wrapped and validated (`gemini-enhanced.js`) to keep LLM logic centralized and easier to test.

- Developer workflows & commands (verify before editing):
  - Backend: npm run dev (nodemon) uses `server-mongo.js` by default; `npm start` will run production. Example:
    - cd smartMailOrg && npm install && npm run dev
  - Lightweight demo: `npm run start-simple` runs `server-simple.js` (no Mongo). Good for quick iterations.
  - Start script: `./start.sh` checks for `.env`, installs deps, and optionally starts Mongo; it also runs the server in production mode.
  - Frontend: cd frontend && npm install && npm run dev -> served on `http://localhost:5173`.

- Key environment and setup items to know:
  - `.env` must contain: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `GEMINI_API_KEY`, and optionally `MONGODB_URI`, `PORT`, `NODE_ENV`.
  - OAuth redirect URI must include `http://localhost:3000/auth/google/callback` (see README).
  - Geminis: `USE_GEMINI=true` toggles AI; `GEMINI_API_KEY` is required for production AI features.
  - MongoDB: tests and batch processing expect a running Mongo instance and indexes are created by `database-mongo.js` during connect.

- Patterns and conventions you must follow here:
  - Database access is centralized: use `database-mongo.js` (Mongo) or `database.js` (SQLite). Avoid ad-hoc DB calls outside these modules.
  - Token refresh flow uses `withTokenRefresh` in `server-mongo.js` — follow the same shape when adding other Gmail calls. It sets `oauth2Client` credentials, retries on token errors and updates DB and session.
  - Gemini calls wrap the prompt, validate JSON, and fall back to rule-based logic (`fallbackAnalysis`) on errors. Add any new LLM prompts through `gemini-enhanced.js` and validate with the same pipeline.
  - Batch operations are long-running and update `batchLogs`. Keep them idempotent and update progress by calling `mongoDb.updateBatchLog(batchId, {...})` often.

- Integration points & what to check when editing:
  - Gmail API interactions: `googleapis` is used throughout. Look at `server-mongo.js` and `server-simple.js` for GET/POST calls to Gmail endpoints. Use `oauth2Client.setCredentials()` before calling Gmail APIs.
  - Rate limiting: `database-mongo.js` implements rate limit checks using a TTL collection. When adding more Gemini usage, call `mongoDb.checkRateLimit(userId, 'gemini')`.
  - Labels: Label IDs are required when calling `users.messages.modify`; code paths use `mongoDb.saveLabel()` to track the mapping from label name to Gmail label ID.

- Good examples to copy from:
  - Batch lifecycle: `batch-processor.js` — see createBatch() and executeBatch() for progress updates and stepwise flow.
  - Token refresh and re-try: `server-mongo.js` — see withTokenRefresh() for the token update + retry pattern (wrap Gmail API calls).
  - Rate-limited LLM calls: `gemini-enhanced.js` — see analyzeEmail() for db-based rate checks, prompt structure, JSON validation and fallbackAnalysis().
  - Frontend integration: `frontend/src/components/Dashboard.jsx` uses `axios` with `withCredentials: true` and expects backend endpoints like `/api/emails`, `/api/labels`, `/api/batch/*`.

- Minimal tests and checks to run locally:
  - Start without Mongo: `npm run start-simple` and `frontend` dev server; confirm login and test rule-based categorization (set `USE_GEMINI=false`).
  - Start with Mongo: run `mongod`, `./start.sh` and open `/dashboard`. Look at the `batchLogs` collection to confirm `createBatch`/status updates.
  - Verify Gemini rate limiting by toggling `USE_GEMINI` and running `batchAnalyzeEmails` via `batchProcessor`.

- What to avoid / watch-for
  - Do NOT commit `.env` or credentials. Many secrets are expected in `.env` and not in repo.
  - Avoid direct modifications to `oauth2Client` in unrelated modules — use the centralized approach in `server-mongo.js` or `server-simple.js`.
  - When adding new API endpoints, maintain the `isAuthenticated` middleware in servers and respect token refresh patterns.

If anything is unclear, point to a file here and I’ll expand examples or add a short unit/integration test to clarify the contract.