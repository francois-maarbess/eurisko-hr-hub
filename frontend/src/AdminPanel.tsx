import React, { useEffect, useState } from 'react';
import { Badge, Button, Field, Modal, Section, Tabs } from './components/ui';
import { formatDateTime, formatEnum } from './format';
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
  const [initialDataLoading, setInitialDataLoading] = useState(true);
  const [userToDeactivate, setUserToDeactivate] = useState<AdminUser | null>(null);
  const [catalogAction, setCatalogAction] = useState<{ title: string; sub: string; confirmLabel: string; run: () => Promise<void> } | null>(null);
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
  const [adminTab, setAdminTab] = useState<'overview' | 'catalog' | 'users'>('overview');
  const [report, setReport] = useState<{
    byStatus: Record<string, number>;
    departments: { code: string; name: string; open: number; total: number; breached: number }[];
    csatAverage: number | null;
    csatCount: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [exportDept, setExportDept] = useState('');
  const [exportPriority, setExportPriority] = useState('');
  const [showCountsInfo, setShowCountsInfo] = useState(false);
  const [analytics, setAnalytics] = useState<{
    total: number;
    timeToClaimAvgHours: number | null;
    timeToCompleteAvgHours: number | null;
    rejectionRate: number;
    rerouteRate: number;
    rerouteCount: number;
    aging: { under1d: number; d1to3: number; d3to7: number; over7d: number };
    workloadByAgent: { userId: string; name: string; count: number }[];
  } | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [auditActor, setAuditActor] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditRows, setAuditRows] = useState<{
    id: string; requestId: string | null; action: string; actorName: string; createdAt: string;
  }[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearched, setAuditSearched] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [sysHealth, setSysHealth] = useState<{
    status: string;
    database: string;
    uptimeSeconds: number;
    migrations: { applied: number; pending: number };
    outbox: { pending: number; failed: number };
    ai: { provider: string; model: string };
  } | null>(null);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (exportStatus) params.set('status', exportStatus);
      if (exportDept) params.set('departmentId', exportDept);
      if (exportPriority) params.set('priority', exportPriority);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(apiUrl(`/requests/export${qs}`), {
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

  const loadAnalytics = async () => {
    try {
      const res = await fetch(apiUrl('/requests/analytics'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setAnalytics(await res.json());
    } catch {
      // Overview still renders from /requests/report.
    }
  };

  const searchAudit = async () => {
    setAuditLoading(true);
    setAuditSearched(false);
    setAuditError('');
    try {
      const params = new URLSearchParams();
      if (auditActor.trim()) params.set('actor', auditActor.trim());
      if (auditAction) params.set('action', auditAction);
      params.set('limit', '100');
      const res = await fetch(apiUrl(`/audit?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Audit search failed.');
      }
      setAuditRows(await res.json());
      setAuditSearched(true);
    } catch (err) {
      // Never blank the panel silently: keep prior rows and say what happened.
      setAuditError(err instanceof Error ? err.message : 'Cannot reach the server.');
    } finally {
      setAuditLoading(false);
    }
  };
  const [newDeptCode, setNewDeptCode] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [newTypeDept, setNewTypeDept] = useState('');
  const [newTypeCode, setNewTypeCode] = useState('');
  const [newTypeName, setNewTypeName] = useState('');
  const [allTypes, setAllTypes] = useState<CatalogType[]>([]);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

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
      if (!uRes.ok || !dRes.ok || !tRes.ok) setMessage('Could not load all users and catalog data.');
      void loadReport();
    } catch {
      setMessage('Cannot reach the server');
    } finally {
      setInitialDataLoading(false);
    }
  };

  useEffect(() => {
    // Data loads run in a promise callback (external-system sync), never
    // directly in the effect body.
    void Promise.resolve().then(() => {
      load();
      void loadAnalytics();
    });
    fetch(apiUrl('/health'))
      .then((r) => r.json())
      .then((h) => {
        if (h && typeof h.status === 'string') setSysHealth(h);
      })
      .catch(() => {});
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

      <Tabs
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'catalog', label: 'Catalog' },
          { value: 'users', label: 'Users' },
        ]}
        value={adminTab}
        onChange={(v) => setAdminTab(v as 'overview' | 'catalog' | 'users')}
      />

      {adminTab === 'overview' && !report && (
        <div className="admin-loading-skeleton" aria-label="Loading platform overview"><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line" /></div>
      )}
      {adminTab === 'overview' && report && (
        <Section
          title="Platform overview"
          sub="Live ticket counts across every department."
        >
          <div className="row mb-md">
            <Badge bg="var(--warning-bg)" color="var(--warning)">
              ★ CSAT {report.csatAverage != null ? report.csatAverage.toFixed(2) : '—'} ({report.csatCount} ratings)
            </Badge>
            <select
              className="select admin-mini-select"
              aria-label="Export filter: status"
              value={exportStatus}
              onChange={(e) => setExportStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <select
              className="select admin-mini-select"
              aria-label="Export filter: department"
              value={exportDept}
              onChange={(e) => setExportDept(e.target.value)}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.code}</option>
              ))}
            </select>
            <select
              className="select admin-mini-select"
              aria-label="Export filter: priority"
              value={exportPriority}
              onChange={(e) => setExportPriority(e.target.value)}
            >
              <option value="">All priorities</option>
              <option value="URGENT">Urgent</option>
              <option value="STANDARD">Standard</option>
              <option value="LOW">Low</option>
            </select>
            <Button variant="ghost" small onClick={exportCsv} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export to CSV'}
            </Button>
            <button
              onClick={() => setShowCountsInfo((s) => !s)}
              title="What do “active” and “total” mean?"
              aria-label="Explain active and total ticket counts"
              style={{
                width: '24px', height: '24px', borderRadius: '999px',
                border: '1px solid var(--border)', background: 'var(--card)',
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
          {sysHealth && (
            <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <span title={`Uptime ${Math.floor(sysHealth.uptimeSeconds / 60)}m · migrations applied ${sysHealth.migrations.applied}, pending ${sysHealth.migrations.pending}`}>
              <Badge bg={sysHealth.status === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)'} color={sysHealth.status === 'ok' ? 'var(--success)' : 'var(--danger)'}>
                System {sysHealth.status === 'ok' ? 'healthy' : sysHealth.status} · DB {sysHealth.database}
              </Badge>
              </span>
              <span title="Notification outbox backlog"><Badge bg="var(--surface-2)" color="var(--muted)">
                Outbox {sysHealth.outbox.pending} pending{sysHealth.outbox.failed > 0 ? ` · ${sysHealth.outbox.failed} failed` : ''}
              </Badge></span>
              <span title={`AI model: ${sysHealth.ai.model}`}><Badge bg="var(--surface-2)" color="var(--muted)">
                AI: {sysHealth.ai.provider}
              </Badge></span>
            </div>
          )}
          <div className="admin-overview">
          <div className="pill-group mb-md">
            {Object.entries(report.byStatus).map(([status, count]) => (
              <Badge key={status} bg="#0f172a" color="#fff">
                {formatEnum(status)}: {count}
              </Badge>
            ))}
          </div>
          {report.departments.reduce((n, d) => n + d.breached, 0) > 0 && (
            <div style={{ marginBottom: '0.75rem' }}><Badge bg="var(--danger-bg)" color="var(--danger)">
              {report.departments.reduce((n, d) => n + d.breached, 0)} ticket(s) past their SLA deadline
              in {report.departments.filter((d) => d.breached > 0).length} department(s) — needs attention
            </Badge></div>
          )}
          <div className="admin-overview-list">
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
        </Section>
      )}

      {adminTab === 'overview' && analytics && (
        <Section
          title="Performance analytics"
          sub="Computed from audit timestamps — no extra data entry. Averages in hours."
        >
          <div className="row mb-md" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <Badge bg="var(--blue-pale)" color="var(--blue-dark)">
              Avg claim {analytics.timeToClaimAvgHours != null ? `${analytics.timeToClaimAvgHours}h` : '—'}
            </Badge>
            <Badge bg="var(--blue-pale)" color="var(--blue-dark)">
              Avg resolve {analytics.timeToCompleteAvgHours != null ? `${analytics.timeToCompleteAvgHours}h` : '—'}
            </Badge>
            <Badge bg="var(--surface-2)" color="var(--muted)">
              Rejected {analytics.rejectionRate}% · Rerouted {analytics.rerouteRate}% ({analytics.rerouteCount})
            </Badge>
            <Badge bg="var(--surface-2)" color="var(--muted)">
              Aging &lt;1d {analytics.aging.under1d} · 1–3d {analytics.aging.d1to3} · 3–7d {analytics.aging.d3to7} · &gt;7d {analytics.aging.over7d}
            </Badge>
          </div>
          {analytics.workloadByAgent.length > 0 && (
            <div className="admin-overview-list">
              {analytics.workloadByAgent.map((w) => (
                <div key={w.userId} className="row" style={{ justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <strong>{w.name}</strong>
                  <span className="muted">{w.count} ticket{w.count === 1 ? '' : 's'} handled</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {adminTab === 'overview' && (
        <Section
          title="Audit search"
          sub="Cross-ticket compliance view. Per-ticket history stays on each ticket's Activity Timeline."
        >
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '2 1 180px' }}
              aria-label="Search audit by actor name or email"
              placeholder="Actor name or email"
              value={auditActor}
              onChange={(e) => setAuditActor(e.target.value)}
            />
            <select
              className="select"
              style={{ flex: '1 1 160px' }}
              aria-label="Filter audit by action"
              value={auditAction}
              onChange={(e) => setAuditAction(e.target.value)}
            >
              <option value="">All actions</option>
              <option value="REQUEST_CREATED">Created</option>
              <option value="REQUEST_CLAIMED">Claimed</option>
              <option value="STATUS_CHANGED">Status changed</option>
              <option value="REQUEST_REROUTED">Rerouted</option>
              <option value="AI_CORRECTION">AI correction</option>
              <option value="FEEDBACK_SUBMITTED">Rated</option>
            </select>
            <Button variant="ghost" small onClick={searchAudit} disabled={auditLoading}>
              {auditLoading ? 'Searching…' : 'Search audit'}
            </Button>
          </div>
          {auditLoading && <div className="admin-loading-skeleton" aria-label="Searching audit"><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line" /></div>}
          {!auditLoading && auditError && <div className="alert-error" role="alert">{auditError}</div>}
          {!auditLoading && !auditError && auditSearched && auditRows.length === 0 && <p className="muted admin-empty-result">No results found.</p>}
          {auditRows.length > 0 && (
            <div className="admin-overview-list" style={{ marginTop: '0.6rem' }}>
              {auditRows.slice(0, 20).map((r) => (
                <div key={r.id} className="row" style={{ justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span><strong>{r.action}</strong> by {r.actorName}</span>
                  <span className="muted">{formatDateTime(r.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {adminTab === 'catalog' && initialDataLoading && <div className="admin-loading-skeleton" aria-label="Loading users and catalog"><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line" /></div>}
      {adminTab === 'catalog' && !initialDataLoading && (
        <Section
          title="Catalog — departments & request types"
          sub="Departments group work; request types are the pickable categories inside one department. Deactivating retires entries while history stays intact."
        >
      <div className="admin-grid">
        {departments.map((d) => {
          const typesForDept = allTypes.filter((t) => t.departmentId === d.id);
          return (
            <div key={d.id} className="admin-row" style={{ opacity: d.active ? 1 : 0.55 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{d.name}</strong>{' '}
                  <span className="muted" style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{d.code}</span>
                  {!d.active && <span style={{ marginLeft: '0.4rem' }}><Badge bg="var(--danger-bg)" color="var(--danger)">Inactive</Badge></span>}
                </div>
                <Button variant="ghost" small onClick={() => d.active
                  ? setCatalogAction({ title: `Deactivate ${d.name}?`, sub: 'New requests will no longer route to this department. Existing history remains available.', confirmLabel: 'Deactivate department', run: async () => toggleDeptActive(d.id, false) })
                  : toggleDeptActive(d.id, true)}>
                  {d.active ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
              <div className="admin-type-list">
                {typesForDept.length === 0 && (
                  <Badge bg="var(--warning-bg)" color="var(--warning)">
                    No request types yet — add one below so employees can select this department
                  </Badge>
                )}
                {typesForDept.map((t) => (
                  <span key={t.id} title={t.name} style={{ cursor: 'pointer' }} onClick={() => t.active
                    ? setCatalogAction({ title: `Deactivate ${t.name}?`, sub: 'Employees will no longer be able to select this request type. Existing requests remain unchanged.', confirmLabel: 'Deactivate request type', run: async () => toggleTypeActive(d.id, t.id, false) })
                    : toggleTypeActive(d.id, t.id, true)}>
                    <Badge bg={t.active ? 'var(--blue-pale)' : 'var(--surface-2)'} color={t.active ? 'var(--blue-dark)' : 'var(--muted)'}>
                    {t.name} {!t.active && '(off)'}
                    </Badge>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={createDepartment}>
        <div className="form-row">
          <input className="input grow-1" value={newDeptCode} onChange={(e) => setNewDeptCode(e.target.value)} placeholder="CODE (e.g. LEGAL)" required />
          <input className="input grow-2" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="Department name" required />
          <Button type="submit" variant="ghost" small>Add Dept</Button>
        </div>
      </form>
      <form onSubmit={createRequestType} className="admin-form">
        <div className="form-row">
          <select className="select grow-1" value={newTypeDept} onChange={(e) => setNewTypeDept(e.target.value)} required>
            <option value="">Select Dept…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
            ))}
          </select>
          <input className="input grow-1" value={newTypeCode} onChange={(e) => setNewTypeCode(e.target.value)} placeholder="Type Code (e.g. LETTER)" required />
          <input className="input grow-2" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} placeholder="Type name (e.g. Verification Letter)" required />
          <Button type="submit" variant="ghost" small>Add Type</Button>
        </div>
      </form>
        </Section>
      )}

      {adminTab === 'users' && initialDataLoading && <div className="admin-loading-skeleton" aria-label="Loading users and catalog"><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line" /></div>}
      {adminTab === 'users' && !initialDataLoading && (
        <>
        <Section
          title="Create user account"
          sub="One account per employee. Pick their platform role and first department — you can change both below after creation."
        >
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
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" required minLength={8} autoComplete="new-password" />
        </Field>
        <Button type="submit" disabled={busy} block>
          {busy ? 'Creating...' : 'Create User'}
        </Button>
      </form>

      {message && <p className="muted admin-message">{message}</p>}
        </Section>
        <Section
          title={`Manage users & memberships (${users.length})`}
          sub="Change platform roles, add or remove department memberships, deactivate accounts."
        >
      <div className="row mb-md">
        <input
          className="input"
          style={{ flex: '1 1 220px' }}
          aria-label="Search users by name or email"
          placeholder="Search users by name or email…"
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
        />
      </div>
      <div className="admin-grid">
        {(() => {
          const filteredUsers = users.filter((u) => {
            const q = userQuery.trim().toLowerCase();
            if (!q) return true;
            return u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
          });
          return <>{filteredUsers.length === 0 ? <p className="muted admin-empty-result">No results found.</p> : filteredUsers.map((u) => {
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
                    className="select admin-inline-select"
                    value={u.platformRole}
                    onChange={(e) => changeRole(u, e.target.value)}
                  >
                    <option value="EMPLOYEE">Employee</option>
                    <option value="SYSTEM_ADMIN">System Admin</option>
                  </select>
                  <Button variant="ghost" small onClick={() => u.active ? setUserToDeactivate(u) : toggleActive(u)}>
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </div>
              <div className="row" style={{ marginTop: '0.5rem' }}>
                {u.memberships.filter((m) => m.active).map((m) => (
                  <Badge bg="var(--blue-pale)" color="var(--blue-dark)" key={m.departmentId}>
                    {m.departmentCode || '?'} · {m.departmentRole}{' '}
                    <button
                      onClick={() => setCatalogAction({ title: `Remove ${m.departmentCode || 'this'} membership?`, sub: `${u.displayName} will no longer have access to this department.`, confirmLabel: 'Remove membership', run: async () => removeMembership(u, m.departmentId) })}
                      className="admin-removable"
                    >
                      ×
                    </button>
                  </Badge>
                ))}
                <select
                  className="select admin-mini-select"
                  value={draft.deptId}
                  onChange={(e) => setMemberDrafts((c) => ({ ...c, [u.id]: { ...draft, deptId: e.target.value } }))}
                >
                  <option value="">+ Dept…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.code}</option>
                  ))}
                </select>
                <select
                  className="select admin-mini-select"
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
        })}</>;
        })()}
      </div>
        </Section>
        </>
      )}
      {userToDeactivate && (
        <Modal title={`Deactivate ${userToDeactivate.displayName}?`} sub="They will no longer be able to sign in. Their request history will remain available." onClose={() => setUserToDeactivate(null)}>
          <div className="row">
            <Button variant="danger" small onClick={async () => { await toggleActive(userToDeactivate); setUserToDeactivate(null); }}>Deactivate user</Button>
            <Button variant="ghost" small onClick={() => setUserToDeactivate(null)}>Cancel</Button>
          </div>
        </Modal>
      )}
      {catalogAction && (
        <Modal title={catalogAction.title} sub={catalogAction.sub} onClose={() => setCatalogAction(null)}>
          <div className="row">
            <Button variant="danger" small onClick={async () => { const action = catalogAction; setCatalogAction(null); await action.run(); }}>
              {catalogAction.confirmLabel}
            </Button>
            <Button variant="ghost" small onClick={() => setCatalogAction(null)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
