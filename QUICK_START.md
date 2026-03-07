# CRM Components - Quick Start Guide

## Integration Steps

### Step 1: Add Imports to Dashboard.jsx

```javascript
import LeadCRMTab from './tabs/LeadCRMTab';
import RetentionDashboardTab from './tabs/RetentionDashboardTab';
import BusinessHealthTab from './tabs/BusinessHealthTab';
```

### Step 2: Update TABS Array

```javascript
const TABS = [
  { id: 'daily', label: 'Daily Activity' },
  { id: 'publishers', label: 'Publishers' },
  { id: 'agents', label: 'Agents' },
  { id: 'carriers', label: 'Carriers' },
  { id: 'pnl', label: 'P&L Report' },
  { id: 'agent-perf', label: 'Agent Performance' },
  { id: 'policies-detail', label: 'Policies' },
  { id: 'commissions', label: 'Commissions' },
  // ADD THESE:
  { id: 'leads', label: 'Leads CRM' },
  { id: 'retention', label: 'Retention Dashboard' },
  { id: 'business-health', label: 'Business Health' },
];
```

### Step 3: Update Tab Switch Statement

In the main render/return of Dashboard component:

```javascript
case 'leads':
  return <LeadCRMTab dateRange={dateRange} />;
case 'retention':
  return <RetentionDashboardTab dateRange={dateRange} />;
case 'business-health':
  return <BusinessHealthTab dateRange={dateRange} />;
```

### Step 4: Verify API Endpoints Exist

Required endpoints in `/src/app/api/crm/`:

- GET `/api/crm/leads` - Returns list of leads
- GET `/api/crm/lead/:leadId` - Returns single lead details
- GET `/api/crm/lead/:leadId/calls` - Returns call history
- PUT `/api/crm/lead/:leadId` - Update lead status/notes

- GET `/api/crm/policyholders` - Returns list of policyholders
- GET `/api/crm/policyholder/:policyNumber` - Returns policy details
- PUT `/api/crm/policyholder/:policyNumber` - Update policy status/lapse reason

- POST `/api/crm/tasks` - Log outreach activity
- GET `/api/crm/tasks` - Get task history

- GET `/api/crm/metrics/business-health` - Returns aggregate health metrics

## Component Usage Examples

### Using LeadCRMTab
```javascript
<LeadCRMTab dateRange={{ start: '2026-02-01', end: '2026-02-28' }} />
```

### Using RetentionDashboardTab
```javascript
<RetentionDashboardTab dateRange={{ start: '2026-02-01', end: '2026-02-28' }} />
```

### Using BusinessHealthTab
```javascript
<BusinessHealthTab dateRange={{ start: '2026-02-01', end: '2026-02-28' }} />
```

## Component Features Summary

### LeadCRMTab
- Lead filtering by status (All, My Leads, New, Follow-Up, Converted, Dead, Pooled)
- Real-time KPI metrics (Total Leads, New Today, Follow-Up Due, Conversion Rate, Avg Attempts)
- Sortable table with lead details
- Click to open detail modal
- Status changes and notes saving
- Call history view
- Converted policies list

### RetentionDashboardTab
- Policyholder filtering by status (All, Active, At-Risk, Lapsed, Win-Back, Reinstated)
- Real-time KPI metrics (Total Members, Premium in Force, At-Risk, Lapse Rate, Win-Back Rate)
- Sortable table with policy details
- Days since payment highlighting
- Click to open detail modal
- Log outreach activities
- Change policy status with lapse reason
- Outreach history tracking

### BusinessHealthTab
- 15 KPI tiles across 3 rows (Member Base, Retention Rates, Performance)
- Lapse reason breakdown with visual bars
- Month-over-month trend indicators
- Carrier performance table
- Drill-down capability for carriers

## Customization Examples

### Change Theme Color for a Component

In any component, modify the C import:
```javascript
import { C, fmt, fmtPct, STATUS_COLORS, LEAD_STATUSES } from '../shared/theme';

// Then use C.accent, C.green, C.red, etc.
```

To globally change colors, edit `/src/components/shared/theme.js`:
```javascript
export const C = {
  bg: '#080b10',      // Dark background
  surface: '#0f1520', // Header/nav background
  card: '#131b28',    // Card backgrounds
  // ... customize colors here
};
```

### Add New Status Filtering

In LeadCRMTab, add to subtab options:
```javascript
{['all', 'my-leads', 'new', 'follow-up', 'converted', 'dead', 'pooled', 'YOUR_NEW_STATUS'].map(tab => (
```

Then update the filter logic in useMemo:
```javascript
const filtered = useMemo(() => {
  if (subtab === 'your_new_status') return leads.filter(l => l.status === 'YOUR_NEW_STATUS');
  // ...
}, [leads, subtab]);
```

### Modify Table Columns

In any tab component, update the columns array:
```javascript
const columns = [
  { key: 'name', label: 'Name', align: 'left' },
  { key: 'phone', label: 'Phone', align: 'left', mono: true },
  // Add new column:
  { key: 'email', label: 'Email', align: 'left', render: (val) => <a href={`mailto:${val}`}>{val}</a> },
  // ...
];
```

### Change Date Formatting

Replace `formatDate()` function in any tab:
```javascript
const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  // Change format here (currently MM/DD):
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
```

### Add Loading Spinner

Replace loading state render:
```javascript
if (loading) return (
  <div style={{ color: C.muted, textAlign: 'center', padding: 40 }}>
    <div style={{ fontSize: 20 }}>⏳ Loading...</div>
  </div>
);
```

## Testing Checklist

- [ ] All 5 files created in correct locations
- [ ] Dashboard.jsx updated with imports and case statements
- [ ] Date range filtering works (tests with different date presets)
- [ ] Subtab switching filters data correctly
- [ ] Row click opens modal without errors
- [ ] Modal form submission calls correct APIs
- [ ] Status changes persist after save
- [ ] Table sorting works on all columns
- [ ] Color-coded badges display correctly
- [ ] Overdue dates highlighted in red
- [ ] Future dates highlighted in green
- [ ] Metrics calculate correctly
- [ ] No console errors in browser DevTools

## Common Issues & Fixes

### Modal not opening
- Check if `leadId` or `policyNumber` is passed correctly
- Verify modal component is imported
- Check browser console for errors

### Data not loading
- Verify API endpoints are implemented
- Check network tab in DevTools for API response
- Ensure date range is in correct format (YYYY-MM-DD)

### Styling looks wrong
- Check theme.js colors are imported
- Verify inline styles are correct JavaScript objects
- Check for typos in color property names

### Sorting not working
- Verify `sortable: true` not set to false on column
- Check column key matches data object key
- Ensure data values are correct type for sorting

## Performance Tips

1. Use date range filters to reduce data loaded
2. Consider pagination for large datasets (currently limit=500)
3. Use useMemo for expensive calculations
4. Lazy load modals only when needed (currently implemented)
5. Consider virtualizing large tables with react-window

## Next Steps

1. Implement remaining API endpoints in `/src/app/api/crm/`
2. Test with real data from your backend
3. Add pagination controls if datasets exceed 500 records
4. Implement "My Leads" agent filtering
5. Expand carrier drill-down with product/agent breakdown
6. Add export to CSV functionality
7. Add bulk actions (multi-select leads/policies)
8. Add task assignment and delegation

