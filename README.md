# True Choice Coverage — Sales Dashboard

Final expense insurance sales dashboard that connects to Google Sheets for real-time policy tracking, call log analysis, P&L reporting, and goal tracking.

## Quick Start

### 1. Install Dependencies
```bash
cd tcc-dashboard
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env.local
```

Edit `.env.local` and paste your **entire** Google service account JSON key as a single line:
```
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"tcc-dashboard",...}
```

All Sheet IDs and tab names are pre-filled. Only the service account key needs to be added.

### 3. Verify Sheet Sharing
Make sure all 4 sheets are shared (Viewer access) with your service account email:
- `tcc-sheets-reader@tcc-dashboard.iam.gserviceaccount.com` (or whatever your service account email is)

### 4. Run Locally
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

### 5. Deploy to Vercel
```bash
npx vercel
```
Add `GOOGLE_SERVICE_ACCOUNT_KEY` in Vercel dashboard → Settings → Environment Variables.

## Data Sources

| Sheet | ID | Purpose |
|-------|----|---------|
| Policy Tracker | `1kaPGnNNm...MhmU` | Sales/policy data |
| Commission Rates | `1Neq0H4_v...d-OH` | Carrier commission rates |
| Goals/Pricing | `140pdtbVL...IyIbyU` | Goal targets + publisher pricing |
| Call Logs | `1ghPei6gk...DPPX` | ChaseDateCorp dialer call logs |

## API Endpoints

- `GET /api/dashboard?start=YYYY-MM-DD&end=YYYY-MM-DD` — Unified data (policies + calls + P&L)
- `GET /api/sales?start=&end=` — Policy tracker only
- `GET /api/calllogs?start=&end=` — Call logs only
- `GET /api/commissions` — Commission rate table
- `GET /api/goals` — Goals hierarchy + publisher pricing

## Architecture

```
Google Sheets → API Routes (15-min cache) → React Dashboard
                    ↓
              Data Joining:
              - Campaign codes link policies ↔ calls ↔ pricing
              - Fuzzy agent name matching (call logs ↔ policy tracker)
              - Commission calculation (carrier + product + age → rate)
              - P&L aggregation by publisher with agent breakdown
```
