import React, { useEffect, useState } from 'react';
import { Button, ErrorBox, Field, SectionHeader, formatEnum } from './components/ui';
import { apiUrl } from './api';

interface AdminPanelProps {
  token: string;
  onCatalogChange?: () => void;
}

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  platformRole: string;
  active: boolean;
  memberships: { departmentId: string; departmentCode?: string; departmentRole: string; active: boolean }[];
}

interface Department {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface CatalogType {
  id: string;
  code: string;
  name: string;
  departmentId: string;
  active: boolean;
}

export default function AdminPanel({ token, onCatalogChange }: AdminPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('EMPLOYEE');
  const [deptId, setDeptId] = useState('');
  const [deptRole, setDeptRole] = useState('AGENT');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [memberDrafts, setMemberDrafts] = useState<Record<string, { deptId: string; role: string }>>({});
  const [report, setReport] = useState<{
    byStatus: Record<string, number>;
    departments: { code: string; name: string; open: number; total: number; breached: number }[];
    csatAverage: number | null;
    csatCount: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showCountsInfo, setShowCountsInfo] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(apiUrl('/requests/export'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setMessage('Export failed.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'requests-export.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage('Export failed.');
    } finally {
      setExporting(false);
    }
  };
  const [newDeptCode, setNewDeptCode] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [newTypeDept, setNewTypeDept] = useState('');
  const [newTypeCode, setNewTypeCode] = useState('');
  const [newTypeName, setNewTypeName] = useState('');
  const [allTypes, setAllTypes] = useState<CatalogType[]>([]);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const load = async () => {
    try {
      const [uRes, dRes, tRes] = await Promise.all([
        fetch(apiUrl('/auth/users'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/catalog/departments?includeInactive=1'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/catalog/request-types?includeInactive=1'), { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (uRes.ok) setUsers(await uRes.json());
      if (dRes.ok) setDepartments(await dRes.json());
      if (tRes.ok) setAllTypes(await tRes.json());
      void loadReport();
    } catch {
      setMessage('Cannot reach the server');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(apiUrl('/auth/users'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          displayName: displayName || undefined,
          platformRole: role,
          departmentId: deptId || undefined,
          departmentRole: deptRole,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.message || 'Could not create user');
        return;
      }
      setEmail('');
      setDisplayName('');
      setPassword('');
      setMessage(`Created ${data.email}. Share their password with them directly.`);
      await load();
    } catch {
      setMessage('Cannot reach the server');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u: AdminUser) => {
    try {
      const res = await fetch(apiUrl(`/auth/users/${u.id}`), {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ active: !u.active }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data.message || 'Could not update user');
        return;
      }
      await load();
    } catch {
      setMessage('Cannot reach the server');
    }
  };

  const changeRole = async (u: AdminUser, platformRole: string) => {
    try {
      const res = await fetch(apiUrl(`/auth/users/${u.id}/role`), {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ platformRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data.message || 'Could not change role');
        return;
      }
      await load();
    } catch {
      setMessage('Cannot reach the server');
    }
  };

  const addMembership = async (u: AdminUser) => {
    const draft = memberDrafts[u.id] || { deptId: '', role: 'AGENT' };
    if (!draft.deptId) {
      setMessage('Pick a department first.');
      return;
    }
    try {
      const res = await fetch(apiUrl(`/auth/users/${u.id}/memberships`), {
        method: 'POST',
        headers,
        body: JSON.stringify({ departmentId: draft.deptId, departmentRole: draft.role }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data.message || 'Could not add membership');
        return;
      }
      await load();
    } catch {
      setMessage('Cannot reach the server');
    }
  };

  const loadReport = async () => {
    try {
      const res = await fetch(apiUrl('/requests/report'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setReport(await res.json());
    } catch {
      // Reporting is informational; the panel stays usable without it.
    }
  };

  const createDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(apiUrl('/departments'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: newDeptCode, name: newDeptName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.message || 'Could not create department');
        return;
      }
      setNewDeptCode('');
      setNewDeptName('');
      setNewTypeDept(data.id);
      setMessage(`Department "${data.name}" (${data.code}) created! Now add at least one request type below so employees can select it.`);
      await load();
      onCatalogChange?.();
    } catch {
      setMessage('Cannot reach the server');
    }
  };

  const createRequestType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTypeDept) {
      setMessage('Pick a department for the new type.');
      return;
    }
    try {
      const res = await fetch(apiUrl(`/departments/${newTypeDept}/request-types`), {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: newTypeCode, name: newTypeName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.message || 'Could not create request type');
        return;
      }
      setNewTypeCode('');
      setNewTypeName('');
      setMessage(`Request type "${data.name}" (${data.code}) created.`);
      await load();
      onCatalogChange?.();
    } catch {
      setMessage('Cannot reach the server');
    }
  };

  const toggleDeptActive = async (id: string, active: boolean) => {
    try {
      const res = await fetch(apiUrl(`/departments/${id}`), {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data.message || 'Could not update department');
        return;
      }
      await load();
      onCatalogChange?.();
    } catch {
      setMessage('Cannot reach the server');
    }
  };

  const toggleTypeActive = async (deptId: string, typeId: string, active: boolean) => {
    try {
      const res = await fetch(apiUrl(`/departments/${deptId}/request-types/${typeId}`), {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data.message || 'Could not update request type');
        return;
      }
      await load();
      onCatalogChange?.();
    } catch {
      setMessage('Cannot reach the server');
    }
  };

  const removeMembership = async (u: AdminUser, departmentId: string) => {
    try {
      const res = await fetch(apiUrl(`/auth/users/${u.id}/memberships/${departmentId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data.message || 'Could not remove membership');
        return;
      }
      await load();
    } catch {
      setMessage('Cannot reach the server');
    }
  };

  return (
    <div className="admin-zone">
      <span className="admin-tag">ADMIN ONLY</span>
      <h3 className="card-title">Administration</h3>
      <p className="card-sub">Create accounts, assign roles and departments, manage the catalog, activate or deactivate users.</p>

      {report && (
        <>
          <SectionHeader
            n="1"
            title="Platform overview"
            sub="Live ticket counts across every department."
          />
          <div className="row" style={{ marginBottom: '0.75rem', alignItems: 'center' }}>
            <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>
              ★ CSAT {report.csatAverage != null ? report.csatAverage.toFixed(2) : '—'} ({report.csatCount} ratings)
            </span>
            <Button variant="ghost" small onClick={exportCsv} disabled={exporting}>
              {exporting ? 'Exporting…' : '📥 Export to CSV'}
            </Button>
            <button
              onClick={() => setShowCountsInfo((s) => !s)}
              title="What do “active” and “total” mean?"
              aria-label="Explain active and total ticket counts"
              style={{
                width: '24px', height: '24px', borderRadius: '999px',
                border: '1px solid var(--border)', background: '#fff',
                color: 'var(--blue)', fontSize: '0.8rem', fontWeight: 800,
                fontStyle: 'italic', fontFamily: 'Georgia, serif',
                cursor: 'pointer', lineHeight: 1,
              }}
            >
              i
            </button>
          </div>
          {showCountsInfo && (
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
              <strong>Active</strong> = requests currently pending or in-progress and requiring staff attention. <strong>Total</strong> = all requests ever created in that department, including completed, rejected, and cancelled ones.
            </p>
          )}
          <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {Object.entries(report.byStatus).map(([status, count]) => (
              <span key={status} className="badge" style={{ background: 'var(--navy)', color: '#fff' }}>
                {formatEnum(status)}: {count}
              </span>
            ))}
          </div>
          {report.departments.reduce((n, d) => n + d.breached, 0) > 0 && (
            <div className="badge" style={{ background: '#fee2e2', color: 'var(--danger)', marginBottom: '0.75rem' }}>
              ⚠️ {report.departments.reduce((n, d) => n + d.breached, 0)} ticket(s) past their SLA deadline
              in {report.departments.filter((d) => d.breached > 0).length} department(s) — needs attention
            </div>
          )}
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {report.departments.map((d) => {
              const pct = d.total > 0 ? Math.round((d.open / d.total) * 100) : 0;
              const breachPct = d.total > 0 ? Math.round((d.breached / d.total) * 100) : 0;
              return (
                <div key={d.code}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: '0.82rem' }}>
                    <strong>{d.code} · {d.name}</strong>
                    <span className="muted">
                      <strong style={{ color: d.open > 0 ? 'var(--blue)' : 'inherit' }}>{d.open} active</strong> · {d.total} total
                      {d.breached > 0 && (
                        <span style={{ color: 'var(--danger)', fontWeight: 700 }}> · {d.breached} overdue</span>
                      )}
                    </span>
                  </div>
                  <div style={{ height: '8px', borderRadius: '999px', background: 'var(--border)', marginTop: '0.25rem', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, borderRadius: '999px', background: 'var(--blue)' }} />
                    {breachPct > 0 && (
                      <div
                        title={`${d.breached} ticket(s) past their SLA deadline`}
                        style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${breachPct}%`, borderRadius: '999px', background: 'var(--danger)' }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1.25rem 0' }} />
      <SectionHeader
        n="2"
        title="Catalog — departments & request types"
        sub="Departments group work; request types are the pickable categories inside one department. Deactivating retires entries while history stays intact."
      />
      <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem' }}>
        {departments.map((d) => {
          const typesForDept = allTypes.filter((t) => t.departmentId === d.id);
          return (
            <div key={d.id} className="admin-row" style={{ opacity: d.active ? 1 : 0.55 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{d.name}</strong>{' '}
                  <span className="muted" style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{d.code}</span>
                  {!d.active && <span className="badge" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', marginLeft: '0.4rem' }}>Inactive</span>}
                </div>
                <Button variant="ghost" small onClick={() => toggleDeptActive(d.id, !d.active)}>
                  {d.active ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.45rem' }}>
                {typesForDept.length === 0 && (
                  <span className="badge" style={{ background: '#fef3c7', color: '#b45309', textTransform: 'none' }}>
                    ⚠️ No request types yet — add one below so employees can select this department
                  </span>
                )}
                {typesForDept.map((t) => (
                  <span
                    key={t.id}
                    className="badge"
                    title={t.name}
                    style={{
                      background: t.active ? 'var(--blue-pale)' : '#f1f5f9',
                      color: t.active ? '#1d4ed8' : 'var(--muted)',
                      textTransform: 'none',
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleTypeActive(d.id, t.id, !t.active)}
                  >
                    {t.name} {!t.active && '(off)'}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={createDepartment}>
        <div className="row">
          <input className="input" style={{ flex: 1 }} value={newDeptCode} onChange={(e) => setNewDeptCode(e.target.value)} placeholder="CODE (e.g. LEGAL)" required />
          <input className="input" style={{ flex: 2 }} value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="Department name" required />
          <Button type="submit" variant="ghost" small>Add Dept</Button>
        </div>
      </form>
      <form onSubmit={createRequestType} style={{ marginTop: '0.5rem' }}>
        <div className="row">
          <select className="select" style={{ flex: 1 }} value={newTypeDept} onChange={(e) => setNewTypeDept(e.target.value)} required>
            <option value="">Select Dept…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
            ))}
          </select>
          <input className="input" style={{ flex: 1 }} value={newTypeCode} onChange={(e) => setNewTypeCode(e.target.value)} placeholder="Type Code (e.g. LETTER)" required />
          <input className="input" style={{ flex: 2 }} value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} placeholder="Type name (e.g. Verification Letter)" required />
          <Button type="submit" variant="ghost" small>Add Type</Button>
        </div>
      </form>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1.25rem 0' }} />
      <SectionHeader
        n="3"
        title="Create user account"
        sub="One account per employee. Pick their platform role and first department — you can change both below after creation."
      />
      <form onSubmit={handleCreate}>
        <Field label="Email *">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@acme.com" required />
        </Field>
        <Field label="Display name">
          <input className="input" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Full Name" />
        </Field>
        <div className="row">
          <div style={{ flex: 1 }}>
            <Field label="Platform role">
              <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="EMPLOYEE">Employee</option>
                <option value="SYSTEM_ADMIN">System Admin</option>
              </select>
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Department role">
              <select className="select" value={deptRole} onChange={(e) => setDeptRole(e.target.value)}>
                <option value="AGENT">Agent</option>
                <option value="MANAGER">Manager</option>
              </select>
            </Field>
          </div>
        </div>
        <Field label="Department">
          <select className="select" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
            <option value="">No department membership</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Initial password *">
          <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" required minLength={8} />
        </Field>
        <Button type="submit" disabled={busy} block>
          {busy ? 'Creating...' : 'Create User'}
        </Button>
      </form>

      {message && <p className="muted" style={{ marginTop: '0.75rem' }}>{message}</p>}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1.25rem 0' }} />
      <SectionHeader
        n="4"
        title={`Users & memberships (${users.length})`}
        sub="Change platform roles, add or remove department memberships, deactivate accounts."
      />
      <div style={{ display: 'grid', gap: '0.6rem' }}>
        {users.map((u) => {
          const draft = memberDrafts[u.id] || { deptId: '', role: 'AGENT' };
          return (
            <div className="admin-row" key={u.id} style={{ opacity: u.active ? 1 : 0.6 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {u.displayName} {!u.active && <span style={{ color: 'var(--danger)' }}>(deactivated)</span>}
                  </div>
                  <div className="muted">{u.email}</div>
                </div>
                <div className="row">
                  <select
                    className="select"
                    style={{ width: 'auto', padding: '0.4rem 0.6rem', fontSize: '0.82rem' }}
                    value={u.platformRole}
                    onChange={(e) => changeRole(u, e.target.value)}
                  >
                    <option value="EMPLOYEE">Employee</option>
                    <option value="SYSTEM_ADMIN">System Admin</option>
                  </select>
                  <Button variant="ghost" small onClick={() => toggleActive(u)}>
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </div>
              <div className="row" style={{ marginTop: '0.5rem' }}>
                {u.memberships.filter((m) => m.active).map((m) => (
                  <span className="badge" key={m.departmentId} style={{ background: 'var(--blue-pale)', color: '#1d4ed8', textTransform: 'none' }}>
                    {m.departmentCode || '?'} · {m.departmentRole}{' '}
                    <button
                      onClick={() => removeMembership(u, m.departmentId)}
                      style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 800 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <select
                  className="select"
                  style={{ width: 'auto', padding: '0.3rem 0.5rem', fontSize: '0.78rem' }}
                  value={draft.deptId}
                  onChange={(e) => setMemberDrafts((c) => ({ ...c, [u.id]: { ...draft, deptId: e.target.value } }))}
                >
                  <option value="">+ Dept…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.code}</option>
                  ))}
                </select>
                <select
                  className="select"
                  style={{ width: 'auto', padding: '0.3rem 0.5rem', fontSize: '0.78rem' }}
                  value={draft.role}
                  onChange={(e) => setMemberDrafts((c) => ({ ...c, [u.id]: { ...draft, role: e.target.value } }))}
                >
                  <option value="AGENT">Agent</option>
                  <option value="MANAGER">Manager</option>
                </select>
                <Button variant="success" small onClick={() => addMembership(u)}>
                  Add
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
