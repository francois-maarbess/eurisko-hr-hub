import React, { useEffect, useState } from 'react';
import { Button, ErrorBox, Field } from './components/ui';

interface AdminPanelProps {
  token: string;
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
}

export default function AdminPanel({ token }: AdminPanelProps) {
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
  const [report, setReport] = useState<{ byStatus: Record<string, number>; departments: { code: string; name: string; open: number; total: number }[] } | null>(null);
  const [newDeptCode, setNewDeptCode] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [newTypeDept, setNewTypeDept] = useState('');
  const [newTypeCode, setNewTypeCode] = useState('');
  const [newTypeName, setNewTypeName] = useState('');

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const load = async () => {
    try {
      const [uRes, dRes] = await Promise.all([
        fetch('http://localhost:3000/auth/users', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('http://localhost:3000/catalog/departments', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (uRes.ok) setUsers(await uRes.json());
      if (dRes.ok) setDepartments(await dRes.json());
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
      const res = await fetch('http://localhost:3000/auth/users', {
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
      const res = await fetch(`http://localhost:3000/auth/users/${u.id}`, {
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
      const res = await fetch(`http://localhost:3000/auth/users/${u.id}/role`, {
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
      const res = await fetch(`http://localhost:3000/auth/users/${u.id}/memberships`, {
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
      const res = await fetch('http://localhost:3000/requests/report', {
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
      const res = await fetch('http://localhost:3000/departments', {
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
      setMessage(`Department ${data.code} created.`);
      await load();
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
      const res = await fetch(`http://localhost:3000/departments/${newTypeDept}/request-types`, {
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
      setMessage(`Request type ${data.code} created.`);
      await load();
    } catch {
      setMessage('Cannot reach the server');
    }
  };

  const removeMembership = async (u: AdminUser, departmentId: string) => {
    try {
      const res = await fetch(`http://localhost:3000/auth/users/${u.id}/memberships/${departmentId}`, {
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
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {Object.entries(report.byStatus).map(([status, count]) => (
            <span key={status} className="badge" style={{ background: 'var(--navy)', color: '#fff' }}>
              {status}: {count}
            </span>
          ))}
          {report.departments.map((d) => (
            <span key={d.code} className="badge" style={{ background: 'var(--blue-pale)', color: '#1d4ed8' }}>
              {d.code}: {d.open} open / {d.total}
            </span>
          ))}
        </div>
      )}

      <h4 style={{ margin: '0 0 0.5rem', color: 'var(--navy)' }}>Catalog</h4>
      <form onSubmit={createDepartment}>
        <div className="row">
          <input className="input" style={{ flex: 1 }} value={newDeptCode} onChange={(e) => setNewDeptCode(e.target.value)} placeholder="CODE (e.g. LEGAL)" />
          <input className="input" style={{ flex: 2 }} value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="Department name" />
          <Button type="submit" variant="ghost" small>Add Dept</Button>
        </div>
      </form>
      <form onSubmit={createRequestType} style={{ marginTop: '0.5rem' }}>
        <div className="row">
          <select className="select" style={{ flex: 1 }} value={newTypeDept} onChange={(e) => setNewTypeDept(e.target.value)}>
            <option value="">Dept…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.code}</option>
            ))}
          </select>
          <input className="input" style={{ flex: 1 }} value={newTypeCode} onChange={(e) => setNewTypeCode(e.target.value)} placeholder="TYPE_CODE" />
          <input className="input" style={{ flex: 2 }} value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} placeholder="Type name" />
          <Button type="submit" variant="ghost" small>Add Type</Button>
        </div>
      </form>

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

      <h4 style={{ margin: '1.25rem 0 0.5rem', color: 'var(--navy)' }}>Users ({users.length})</h4>
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
