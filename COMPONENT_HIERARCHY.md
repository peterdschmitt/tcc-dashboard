# CRM Components - Hierarchy & Architecture

## Component Tree

```
Dashboard.jsx (Main)
├── LeadCRMTab.jsx
│   ├── KPICard (local)
│   ├── SortableTable (local)
│   ├── Section (local)
│   └── LeadDetailModal.jsx
│       ├── SortableTable (local)
│       └── (fetches /api/crm/lead/:leadId & calls)
│
├── RetentionDashboardTab.jsx
│   ├── KPICard (local)
│   ├── SortableTable (local)
│   ├── Section (local)
│   └── PolicyholderDetailModal.jsx
│       ├── SortableTable (local)
│       └── (fetches /api/crm/policyholder/:policyNumber & tasks)
│
└── BusinessHealthTab.jsx
    ├── GoalTile (local)
    ├── SortableTable (local)
    ├── Section (local)
    └── (fetches /api/crm/metrics/business-health)
```

## File Locations

### Tab Components
- `/src/components/tabs/LeadCRMTab.jsx` (224 lines)
- `/src/components/tabs/RetentionDashboardTab.jsx` (230 lines)
- `/src/components/tabs/BusinessHealthTab.jsx` (291 lines)

### Modal Components
- `/src/components/crm/LeadDetailModal.jsx` (267 lines)
- `/src/components/crm/PolicyholderDetailModal.jsx` (359 lines)

### Shared Theme
- `/src/components/shared/theme.js` (72 lines)
  - C (colors), fmt(), fmtDollar(), fmtPct(), goalColor(), goalBg()
  - STATUS_COLORS, LEAD_STATUSES, POLICYHOLDER_STATUSES
  - LAPSE_REASONS, OUTREACH_METHODS, OUTREACH_OUTCOMES, TASK_TYPES, TASK_STATUSES

## Import Structure

All components import from shared/theme.js:
```javascript
import { 
  C, fmt, fmtDollar, fmtPct, goalColor, goalBg,
  STATUS_COLORS, LEAD_STATUSES, POLICYHOLDER_STATUSES,
  LAPSE_REASONS, OUTREACH_METHODS, OUTREACH_OUTCOMES
} from '../shared/theme';
```

## Data Flow

### LeadCRMTab Flow
```
LeadCRMTab (fetch leads)
  ↓
  Display table with filters
  ↓
  User clicks row
  ↓
  LeadDetailModal (fetch lead + calls)
  ↓
  Display modal with details, status selector, notes
  ↓
  User saves status/notes
  ↓
  PUT /api/crm/lead/:leadId
  ↓
  Update local state
```

### RetentionDashboardTab Flow
```
RetentionDashboardTab (fetch policyholders)
  ↓
  Display table with filters
  ↓
  User clicks row
  ↓
  PolicyholderDetailModal (fetch policyholder + outreach history)
  ↓
  Display modal with policy info, status selector, outreach form
  ↓
  User logs outreach or changes status
  ↓
  POST /api/crm/tasks (outreach) OR PUT /api/crm/policyholder/:policyNumber (status)
  ↓
  Update local state
```

### BusinessHealthTab Flow
```
BusinessHealthTab (fetch metrics + carriers + timeseries)
  ↓
  Display KPI tiles, lapse breakdown, trends, carrier table
  ↓
  User clicks carrier row (optional)
  ↓
  Show drill-down view (placeholder for future expansion)
```

## Component Props

### LeadCRMTab
```javascript
{
  dateRange: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
}
```

### RetentionDashboardTab
```javascript
{
  dateRange: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
}
```

### BusinessHealthTab
```javascript
{
  dateRange: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
}
```

### LeadDetailModal
```javascript
{
  leadId: string,
  onClose: function
}
```

### PolicyholderDetailModal
```javascript
{
  policyNumber: string,
  onClose: function
}
```

## State Management Summary

### LeadCRMTab State
- `leads`: Lead[] | []
- `loading`: boolean
- `error`: string | null
- `subtab`: 'all' | 'my-leads' | 'new' | 'follow-up' | 'converted' | 'dead' | 'pooled'
- `selectedLead`: string | null (leadId)

### RetentionDashboardTab State
- `policyholders`: Policyholder[] | []
- `loading`: boolean
- `error`: string | null
- `subtab`: 'all' | 'active' | 'at-risk' | 'lapsed' | 'win-back' | 'reinstated'
- `selectedPolicyholder`: string | null (policyNumber)

### BusinessHealthTab State
- `healthData`: HealthData | null
- `loading`: boolean
- `error`: string | null
- `drillCarrier`: string | null (carrier name)

### LeadDetailModal State
- `lead`: Lead | null
- `loading`: boolean
- `error`: string | null
- `editStatus`: string
- `editNotes`: string
- `saveLoading`: boolean
- `callHistory`: Call[] | []
- `showPolicies`: boolean

### PolicyholderDetailModal State
- `policyholder`: Policyholder | null
- `loading`: boolean
- `error`: string | null
- `editStatus`: string
- `lapseReason`: string | null
- `outreachMethod`: string
- `outreachOutcome`: string
- `outreachNotes`: string
- `saveLoading`: boolean
- `outreachHistory`: Task[] | []
- `showOutreachForm`: boolean
- `showLapseForm`: boolean

## Key Utilities Used

### From shared/theme.js
- `C` - Color constants (bg, card, text, accent, green, yellow, red, etc.)
- `fmt(number)` - Format integers with commas
- `fmtDollar(number)` - Format as currency ($1,234.56)
- `fmtPct(number)` - Format as percentage (12.5%)
- `goalColor(actual, goal, lowerIsBetter)` - Returns color based on performance
- `goalBg(actual, goal, lowerIsBetter)` - Returns background color based on performance
- `STATUS_COLORS` - Maps status strings to colors

### Local Utility Functions
- `formatDate(dateStr)` - Returns MM/DD format
- `isOverdue(dateStr)` - Returns true if date < today
- `daysSincePayment(dateStr)` - Returns number of days since date

## Styling Patterns

### Tile Styling
```javascript
{
  background: goalBg(value, goal),
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: '8px 12px',
  minWidth: 100
}
```

### Status Badge
```javascript
{
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 700,
  background: (STATUS_COLORS[status] || C.muted) + '22',
  color: STATUS_COLORS[status] || C.muted
}
```

### Form Input
```javascript
{
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: '8px 12px',
  color: C.text,
  fontFamily: C.sans,
  fontSize: 12
}
```

### Button (Primary)
```javascript
{
  background: C.accent,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '8px 16px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer'
}
```

### Table Header
```javascript
{
  padding: '10px 12px',
  textAlign: 'right',
  fontSize: 9,
  fontWeight: 700,
  color: C.muted,
  textTransform: 'uppercase',
  letterSpacing: 1,
  borderBottom: `2px solid ${C.border}`,
  background: C.surface,
  whiteSpace: 'nowrap',
  cursor: 'pointer'
}
```

## Performance Considerations

- `useMemo` for filtered/sorted data (prevents unnecessary recalculations)
- `useEffect` dependencies properly scoped (dateRange, subtab)
- Inline component definitions avoided (KPICard, Section defined at module level)
- Table sorting uses mutable copy with sort() not original array mutation

## Browser Compatibility

- Uses modern React 18 features (hooks)
- CSS Grid and Flexbox for layout
- Modern date handling with Date API
- Inline styles (no CSS parsing issues)
- No external dependencies beyond React

## Known Limitations & Future Enhancements

1. Carrier drill-down is placeholder - expand with product/agent breakdown
2. "My Leads" filter requires agent identity implementation
3. Pagination not yet implemented (hardcoded limit=500)
4. Outreach history doesn't support edit/delete
5. No bulk actions (select multiple leads/policies)
6. Mobile-only responsive design not optimized
7. No keyboard shortcuts for common actions

