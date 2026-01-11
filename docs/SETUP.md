# Setup (Local Dev + Deploy)

## Local dev (frontend)
This is a static site — easiest path:

### Option 1: VS Code + Live Server
1. Install VS Code extension: “Live Server”
2. Open the repo folder in VS Code
3. Right-click `frontend/landing.html` -> “Open with Live Server”

### Option 2: Python
From repo root:
```bash
cd frontend
python3 -m http.server 8787
```
Then open:
- http://localhost:8787/landing.html

## Deploy GitHub Pages
1. Push repo to GitHub (`Cali_Votes`)
2. In GitHub repo settings:
   - Pages -> Deploy from branch: `main`
   - Folder: `/frontend`
3. Note your Pages URL:
   - https://YOURUSER.github.io/Cali_Votes

## Configure frontend
Edit `frontend/config.js`:
- `EXEC_URL` = your Apps Script deployment URL ending with `/exec`
- `ASSET_BASE` = `https://YOURUSER.github.io/Cali_Votes/assets`

## Google Sheet
Create a spreadsheet with tabs:
- `Votes` (columns A–P as in the original schema)
- Optional: `Leads` is auto-created on first verification

Votes tab headers A–P:
A submission_id
B created_at
C name_optional
D discord_handle_optional
E email
F city
G votes_claimed
H amount_due_usd
I status
J payment_method_selected
K screenshot_drive_url
L approved_at
M admin_notes_optional
N ip_address
O upload_token
P upload_expires_at

## Google Drive folder
Create folder for screenshots; copy folder ID.

## Apps Script
1. Create new Apps Script project
2. Paste `apps_script/Code.gs` into Code.gs
3. Create HTML file named `admin` and paste `apps_script/admin.html`
4. Set CFG values in Code.gs:
   - SHEET_ID
   - DRIVE_FOLDER_ID
   - RESEND_API_KEY
   - ADMIN_PASSWORD
   - FRONTEND_BASE_URL (your GitHub Pages base)
5. Deploy as Web App:
   - Execute as: Me
   - Who has access: Anyone

Verify:
- `EXEC_URL?page=selftest` -> ok:true
- `EXEC_URL?page=leaderboard` -> JSON
- `EXEC_URL?page=admin` -> admin UI

## Strikingly embed
```html
<iframe src="https://YOURUSER.github.io/Cali_Votes/landing.html" width="100%" height="950" frameborder="0" style="border:none;"></iframe>
```
