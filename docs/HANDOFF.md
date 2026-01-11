# Cali Votes — Canonical Repo (Multi-step A)

## What this repo contains
- `/frontend` — GitHub Pages static app (embed via iframe)
- `/assets` — QR code images used in checkout + emails
- `/apps_script` — Google Apps Script backend files to paste into Apps Script editor
- `/docs` — setup + handoff docs
- `/codex` — rules for Codex so it can't sprawl your repo

## User flow
1. Landing (`landing.html`)
2. Registration (`register.html`) -> `requestEmailCode`
3. Verify code -> `verifyEmailCode` -> session token in localStorage
4. Vote (`vote.html`) choose city, votes, payment method
5. Checkout (`pay.html`) shows QR; user clicks “I paid” -> `submitVote` -> redirects to tokenized `upload.html`
6. Upload proof (`upload.html`) -> `uploadScreenshot`
7. Admin approves/rejects in Apps Script admin panel (`EXEC_URL?page=admin`)
8. Leaderboard shows approved only (`EXEC_URL?page=leaderboard`)

## Key endpoints
- `POST action: requestEmailCode`
- `POST action: verifyEmailCode`
- `POST action: submitVote`
- `POST action: uploadScreenshot`
- `GET ?page=admin | leaderboard | selftest`
