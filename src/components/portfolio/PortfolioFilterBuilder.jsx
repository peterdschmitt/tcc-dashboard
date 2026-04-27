// src/components/portfolio/PortfolioFilterBuilder.jsx
'use client';
import { COLUMN_REGISTRY, columnsByCategory } from '@/lib/portfolio/column-registry';

const C = { card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', red: '#f87171' };

const OPS_BY_TYPE = {
  string: ['eq', 'neq', 'in', 'not_in', 'contains', 'not_contains', 'is_null', 'is_not_null'],
  numeric: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
  date: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
  array: ['contains', 'is_null', 'is_not_null'],
};

const OP_LABELS = {
  eq: 'is', neq: 'is not', in: 'in', not_in: 'not in',
  contains: 'contains', not_contains: 'does not contain',
  gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'between',
  is_null: 'is empty', is_not_null: 'is not empty',
};

function isGroup(node) {
  return node && Array.isArray(node.rules);
}

function emptyLeaf() {
  return { field: 'state', op: 'eq', value: '' };
}

function emptyGroup(op = 'AND') {
  return { op, rules: [emptyLeaf()] };
}

const inputStyle = {
  background: C.card, color: C.text, border: `1px solid ${C.border}`,
  borderRadius: 4, padding: '4px 8px', fontSize: 13, fontFamily: 'monospace',
};

const btnStyle = {
  background: 'transparent', color: C.accent, border: `1px solid ${C.border}`,
  padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
};

function ValueInput({ leaf, dataType, onChange }) {
  if (leaf.op === 'is_null' || leaf.op === 'is_not_null') return null;
  if (leaf.op === 'in' || leaf.op === 'not_in') {
    const val = Array.isArray(leaf.value) ? leaf.value.join(', ') : '';
    return (
      <input
        type="text"
        placeholder="comma, separated, list"
        value={val}
        onChange={e => onChange({ ...leaf, value: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
        style={inputStyle}
      />
    );
  }
  if (leaf.op === 'between') {
    const [lo, hi] = Array.isArray(leaf.value) ? leaf.value : ['', ''];
    return (
      <span style={{ display: 'flex', gap: 4 }}>
        <input type={dataType === 'numeric' ? 'number' : 'text'} value={lo} placeholder="from"
          onChange={e => onChange({ ...leaf, value: [e.target.value, hi] })} style={{ ...inputStyle, width: 80 }} />
        <input type={dataType === 'numeric' ? 'number' : 'text'} value={hi} placeholder="to"
          onChange={e => onChange({ ...leaf, value: [lo, e.target.value] })} style={{ ...inputStyle, width: 80 }} />
      </span>
    );
  }
  const inputType = dataType === 'numeric' ? 'number' : dataType === 'date' ? 'date' : 'text';
  return (
    <input
      type={inputType}
      value={leaf.value ?? ''}
      onChange={e => onChange({ ...leaf, value: e.target.value })}
      style={inputStyle}
    />
  );
}

function Leaf({ leaf, onChange, onRemove }) {
  const col = COLUMN_REGISTRY[leaf.field];
  const ops = OPS_BY_TYPE[col?.dataType] ?? OPS_BY_TYPE.string;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', flexWrap: 'wrap' }}>
      <select value={leaf.field} onChange={e => onChange({ ...leaf, field: e.target.value, op: 'eq', value: '' })} style={inputStyle}>
        {columnsByCategory().map(g => (
          <optgroup key={g.category} label={g.category}>
            {g.columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </optgroup>
        ))}
      </select>
      <select value={leaf.op} onChange={e => onChange({ ...leaf, op: e.target.value })} style={inputStyle}>
        {ops.map(o => <option key={o} value={o}>{OP_LABELS[o] ?? o}</option>)}
      </select>
      <ValueInput leaf={leaf} dataType={col?.dataType} onChange={onChange} />
      <button onClick={onRemove} style={{ background: 'transparent', color: C.red, border: 'none', cursor: 'pointer', fontSize: 14 }} title="Remove rule">×</button>
    </div>
  );
}

function Group({ group, onChange, onRemove, depth = 0 }) {
  const update = (i, child) => {
    const rules = [...group.rules];
    rules[i] = child;
    onChange({ ...group, rules });
  };
  const remove = (i) => {
    const rules = group.rules.filter((_, idx) => idx !== i);
    onChange({ ...group, rules });
  };
  const addRule = () => onChange({ ...group, rules: [...group.rules, emptyLeaf()] });
  const addGroup = () => onChange({ ...group, rules: [...group.rules, emptyGroup()] });

  return (
    <div style={{ borderLeft: `2px solid ${depth === 0 ? 'transparent' : C.border}`, paddingLeft: depth === 0 ? 0 : 12, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <select value={group.op} onChange={e => onChange({ ...group, op: e.target.value })} style={{ ...inputStyle, fontWeight: 600 }}>
          <option value="AND">AND (all)</option>
          <option value="OR">OR (any)</option>
        </select>
        {depth > 0 && onRemove && (
          <button onClick={onRemove} style={{ background: 'transparent', color: C.red, border: 'none', cursor: 'pointer', fontSize: 12 }}>remove group</button>
        )}
      </div>
      {group.rules.map((r, i) => (
        isGroup(r)
          ? <Group key={i} group={r} onChange={c => update(i, c)} onRemove={() => remove(i)} depth={depth + 1} />
          : <Leaf key={i} leaf={r} onChange={c => update(i, c)} onRemove={() => remove(i)} />
      ))}
      <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
        <button onClick={addRule} style={btnStyle}>+ Add rule</button>
        <button onClick={addGroup} style={btnStyle}>+ Add group</button>
      </div>
    </div>
  );
}

export default function PortfolioFilterBuilder({ tree, onChange }) {
  const root = tree && isGroup(tree) ? tree : emptyGroup();
  return <Group group={root} onChange={onChange} depth={0} />;
}
