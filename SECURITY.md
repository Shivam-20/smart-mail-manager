## Security and secrets

If you discover a vulnerability or accidental credential leak, follow this emergency plan.

1) Rotate compromised secrets immediately
   - For Google OAuth: open Google Cloud Console → APIs & Services → Credentials. Delete or regenerate the OAuth Client Secret and create a new client if needed.
   - For Gemini API: delete/rotate the API key in Google AI Studio.
   - Update local `.env` with the new values and never commit `.env` to source control.

2) Revoke/suspend tokens
   - If refresh tokens are compromised, remove them from your database. For Mongo, see `database-mongo.js` for token storage (`users` collection). Remove the user's `accessToken`/`refreshToken` fields or set `tokenExpiry` in the past.
   - Inform users and ask them to re-authenticate if tokens are suspected compromised.

3) Remove secrets from git history
   - Use `git filter-repo --invert-paths --path <secretfilename>` (preferred) or `git filter-branch` if `filter-repo` is not available (both rewrite history).
   - Force push rewritten branches: `git push --force --all` and `git push --force --tags`.

4) Check GitHub push protection and secret scanning
   - If GitHub blocks a push because a secret was detected, follow the link included in the push output or go to your repository Settings → Security → Secret scanning to clear or review flagged secrets.

5) Post-remediation
   - Add the pattern to `.gitignore` (the repo already has `client_secret_*.json`), and add secrets to a cloud secret manager (e.g., GitHub Actions secrets or GCP Secret Manager) for CI/production.
   - Open a ticket/issue if the leak needs more investigation. Use the `security` label on issues that are sensitive.

Contacts
   - Create a public issue marked `security` or email the repository owner via GitHub profile contact. If you need an out-of-band channel, add one to this file.

Helpful tools & links
   - GitHub secret scanning & push protection: https://docs.github.com/en/code-security/secret-scanning/working-with-secret-scanning-and-push-protection
   - Git filter-repo: https://github.com/newren/git-filter-repo
   - Revoke OAuth tokens (G Suite / Google): https://developers.google.com/identity/sign-in/web/revoke

Small checklist for contributors
   - Never commit `client_secret_*.json`, `.env`, `*.pem`, `*.key`, or other private keys.
   - Use `.gitignore` to keep local secrets out of the repo.
   - Use a secret store for production keys and avoid embedding them in code.
