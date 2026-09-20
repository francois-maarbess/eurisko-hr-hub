import React, { useEffect, useState } from 'react';

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

const inputStyle = {
  padding: '0.6rem',
  borderRadius: '8px',
  border: '1px solid #ccc',
  width: '100%',
  boxSizing: 'border-box' as const,
};

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

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const load = async () => {
    try {
      const [uRes, dRes] = await Promise.all([
        fetch('http://localhost:3000/auth/users', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('http://localhost:3000/catalog/departments', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (uRes.ok) setUsers(await uRes.json());
      if (dRes.ok) setDepartments(await dRes.json());
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

  return (
    <div style={{ background: '#fff8e6', border: '1px solid #f0d48a', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem' }}>
      <h3 style={{ margin: '0 0 0.25rem' }}>Administration</h3>
      <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#666' }}>
        System admins only. Create accounts and activate or deactivate them.
      </p>

      <form onSubmit={handleCreate}>
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="New user email" required style={inputStyle} />
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (optional)" style={inputStyle} />
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              <option value="EMPLOYEE">Employee</option>
              <option value="SYSTEM_ADMIN">System Admin</option>
            </select>
            <select value={deptRole} onChange={(e) => setDeptRole(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              <option value="AGENT">Agent</option>
              <option value="MANAGER">Manager</option>
            </select>
          </div>
          <select value={deptId} onChange={(e) => setDeptId(e.target.value)} style={inputStyle}>
            <option value="">No department membership</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Initial password (min 8 chars)" required minLength={8} style={inputStyle} />
          <button type="submit" disabled={busy} style={{ padding: '0.7rem', borderRadius: '8px', border: 'none', background: '#6f42c1', color: '#fff', cursor: 'pointer' }}>
            {busy ? 'Creating...' : 'Create User'}
          </button>
        </div>
      </form>

      {message && <div style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: '#333' }}>{message}</div>}

      <h4 style={{ margin: '1.25rem 0 0.5rem' }}>Users ({users.length})</h4>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {users.map((u) => {
          const draft = memberDrafts[u.id] || { deptId: '', role: 'AGENT' };
          return (
            <div key={u.id} style={{ background: '#fff', borderRadius: '8px', padding: '0.6rem 0.75rem', border: '1px solid #eee' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ flex: 1, opacity: u.active ? 1 : 0.5 }}>
                  <div style={{ fontWeight: 600 }}>{u.displayName} {!u.active && <span style={{ color: '#dc3545' }}>(deactivated)</span>}</div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>{u.email}</div>
                </div>
                <select
                  value={u.platformRole}
                  onChange={(e) => changeRole(u, e.target.value)}
                  style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.8rem' }}
                >
                  <option value="EMPLOYEE">Employee</option>
                  <option value="SYSTEM_ADMIN">System Admin</option>
                </select>
                <button
                  onClick={() => toggleActive(u)}
                  style={{ padding: '0.4rem 0.7rem', borderRadius: '6px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  {u.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {u.memberships.filter((m) => m.active).map((m) => (
                  <span key={m.departmentId} style={{ fontSize: '0.75rem', background: '#eef4ff', borderRadius: '999px', padding: '0.25rem 0.5rem' }}>
                    {m.departmentCode || '?'} · {m.departmentRole}{' '}
                    <button
                      onClick={() => removeMembership(u, m.departmentId)}
                      style={{ border: 'none', background: 'none', color: '#dc3545', cursor: 'pointer', fontWeight: 700 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <select
                  value={draft.deptId}
                  onChange={(e) => setMemberDrafts((c) => ({ ...c, [u.id]: { ...draft, deptId: e.target.value } }))}
                  style={{ padding: '0.3rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.75rem' }}
                >
                  <option value="">+ Department…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.code}</option>
                  ))}
                </select>
                <select
                  value={draft.role}
                  onChange={(e) => setMemberDrafts((c) => ({ ...c, [u.id]: { ...draft, role: e.target.value } }))}
                  style={{ padding: '0.3rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.75rem' }}
                >
                  <option value="AGENT">Agent</option>
                  <option value="MANAGER">Manager</option>
                </select>
                <button
                  onClick={() => addMembership(u)}
                  style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: 'none', background: '#28a745', color: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}
                >
                  Add
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
