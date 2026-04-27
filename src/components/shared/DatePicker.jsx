'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * White calendar date picker with dark input field.
 * Props:
 *   value    – 'YYYY-MM-DD' string
 *   onChange – fn(dateString)
 *   style    – extra styles on wrapper
 */
export default function DatePicker({ value, onChange, style, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Parse value into date parts
  const parsed = value ? new Date(value + 'T00:00:00') : new Date();
  const [viewYear, setViewYear] = useState(parsed.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed.getMonth());

  // Sync view when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value + 'T00:00:00');
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const selectDay = (day) => {
    const mm = String(viewMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onChange(`${viewYear}-${mm}-${dd}`);
    setOpen(false);
  };

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevDays = new Date(viewYear, viewMonth, 0).getDate();

  const cells = [];
  // Previous month trailing days
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: prevDays - i, current: false });
  }
  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, current: true });
  }
  // Next month leading days
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, current: false });
  }

  // Selected day check
  const selectedYear = parsed.getFullYear();
  const selectedMonth = parsed.getMonth();
  const selectedDay = parsed.getDate();

  // Today check
  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth();
  const todayD = today.getDate();

  // Format display value
  const displayValue = value
    ? `${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}/${parsed.getFullYear()}`
    : 'Select date';

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', ...style }}>
      {/* Input trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          background: '#131b28', color: '#f0f3f9', border: '1px solid #1a2538', borderRadius: 6,
          padding: '7px 12px', fontSize: 13, fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
          cursor: 'pointer', minWidth: 140, textAlign: 'left', outline: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}
      >
        <span>{displayValue}</span>
        <span style={{ fontSize: 10, opacity: 0.5 }}>▼</span>
      </button>

      {/* Calendar dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%',
          ...(align === 'right' ? { right: 0 } : { left: 0 }),
          marginTop: 4, zIndex: 1100,
          background: '#fff', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          padding: 12, width: 280, userSelect: 'none',
        }}>
          {/* Month/Year header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <button type="button" onClick={prevMonth} style={navBtn}>‹</button>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth} style={navBtn}>›</button>
          </div>

          {/* Day-of-week headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, marginBottom: 4 }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#888', padding: '4px 0' }}>{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0 }}>
            {cells.map((cell, i) => {
              const isSelected = cell.current && viewYear === selectedYear && viewMonth === selectedMonth && cell.day === selectedDay;
              const isToday = cell.current && viewYear === todayY && viewMonth === todayM && cell.day === todayD;
              return (
                <button
                  type="button"
                  key={i}
                  onClick={cell.current ? () => selectDay(cell.day) : undefined}
                  style={{
                    width: '100%', aspectRatio: '1', border: 'none', borderRadius: '50%',
                    fontSize: 13, fontWeight: isSelected ? 700 : 400, cursor: cell.current ? 'pointer' : 'default',
                    background: isSelected ? '#3b82f6' : 'transparent',
                    color: isSelected ? '#fff' : !cell.current ? '#ccc' : isToday ? '#3b82f6' : '#333',
                    outline: isToday && !isSelected ? '2px solid #3b82f633' : 'none',
                    transition: 'background 0.15s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  onMouseEnter={cell.current ? (e) => { if (!isSelected) e.target.style.background = '#f0f4ff'; } : undefined}
                  onMouseLeave={cell.current ? (e) => { if (!isSelected) e.target.style.background = 'transparent'; } : undefined}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div style={{ borderTop: '1px solid #eee', marginTop: 8, paddingTop: 8, textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => {
                const t = new Date();
                const mm = String(t.getMonth() + 1).padStart(2, '0');
                const dd = String(t.getDate()).padStart(2, '0');
                onChange(`${t.getFullYear()}-${mm}-${dd}`);
                setOpen(false);
              }}
              style={{ border: 'none', background: 'none', color: '#3b82f6', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }}
              onMouseEnter={e => e.target.style.background = '#f0f4ff'}
              onMouseLeave={e => e.target.style.background = 'transparent'}
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtn = {
  border: 'none', background: 'none', fontSize: 20, fontWeight: 700,
  cursor: 'pointer', color: '#555', padding: '4px 10px', borderRadius: 6,
  lineHeight: 1,
};
