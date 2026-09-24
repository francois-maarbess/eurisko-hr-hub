import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiUrl } from './api';

interface MiniTicket {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  slaDueAt?: string | null;
}

interface Report {
  byStatus: Record<string, number>;
  departments: { code: string; name: string; open: number; total: number; breached: number }[];
  volume: { day: string; count: number }[];
  csatAverage: number | null;
  csatCount: number;
}

const TERMINAL = ['COMPLETED', 'CANCELLED', 'REJECTED'];
const NAVY = '#0f172a';
const BLUE = '#1d4ed8';
const GREEN = '#15803d';
const RED = '#b91c1c';
const AMBER = '#b45309';

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekdayLabel(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
}

/**
 * Command center. Admins (report available) see org-wide numbers — they
 * are accountable for every request. Department staff see their
 * departments' queue numbers — they are accountable for that work.
 * Everyone else sees their own tickets only, with explicit labels.
 */
export default function Dashboard({ token, userName, isStaff }: { token: string; userName: string; isStaff: boolean }) {
  const [mine, setMine] = useState<MiniTicket[]>([]);
  const [queue, setQueue] = useState<MiniTicket[]>([]);
  const [breached, setBreached] = useState<MiniTicket[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [mineRes, queueRes, breachRes, reportRes] = await Promise.all([
          fetch(apiUrl('/requests?view=mine'), { headers }),
          fetch(apiUrl('/requests?view=queue'), { headers }),
          fetch(apiUrl('/requests/breach'), { headers }),
          fetch(apiUrl('/requests/report'), { headers }),
        ]);
        if (cancelled) return;
        if (mineRes.ok) setMine(await mineRes.json());
        if (queueRes.ok) setQueue(await queueRes.json());
        if (breachRes.ok) setBreached(await breachRes.json());
        if (reportRes.ok) setReport(await reportRes.json());
      } catch {
        // Dashboard is decorative; the queue below is the source of truth.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="card dashboard-card dashboard-loading" aria-label="Loading dashboard">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-subtitle" />
        <div className="dashboard-stats">
          {[0, 1, 2, 3].map((i) => <div key={i} className="dashboard-stat dashboard-stat-skeleton"><div className="skeleton-line" /><div className="skeleton-line skeleton-number" /></div>)}
        </div>
        <div className="dashboard-chart-skeleton"><div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line" /></div>
      </div>
    );
  }

  // Wall-clock read for SLA display. Recomputed on each render so the
  // countdowns stay correct as data changes; not memoizable state.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const isOrg = report !== null;
  const isTeam = !isOrg && isStaff;

  // Admins: org sums. Staff: department queue + dept-scoped breach list.
  // Plain employees: their own tickets only.
  const openMine = mine.filter((t) => !TERMINAL.includes(t.status));
  const overdueMine = openMine.filter((t) => t.slaDueAt && new Date(t.slaDueAt).getTime() < now);
  const orgOpen = (report?.departments || []).reduce((n, d) => n + d.open, 0);
  const orgBreached = (report?.departments || []).reduce((n, d) => n + d.breached, 0);

  const openCount = isOrg ? orgOpen : isTeam ? queue.length : openMine.length;
  const overdueCount = isOrg ? orgBreached : isTeam ? breached.length : overdueMine.length;
  const onTrack = openCount - overdueCount;
  const compliance = openCount === 0 ? 100 : Math.round((onTrack / openCount) * 100);
  const scope = isOrg ? 'ORG' : isTeam ? 'TEAM' : 'MY';
  const scopeSuffix = isOrg ? ' org-wide' : isTeam ? ' in your departments' : '';

  const volumeSource = isOrg || !isTeam ? mine : queue;
  const volume = isOrg && report
    ? report.volume.map((v) => ({ name: weekdayLabel(v.day), tickets: v.count }))
    : (() => {
        const days: { key: string; label: string }[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          days.push({ key: dayKey(d), label: d.toLocaleDateString(undefined, { weekday: 'short' }) });
        }
        return days.map((d) => ({
          name: d.label,
          tickets: volumeSource.filter((t) => dayKey(new Date(t.createdAt)) === d.key).length,
        }));
      })();

  const donut = [
    { name: 'On track', value: onTrack },
    { name: 'Overdue', value: overdueCount },
  ];

  // Overdue first (backend returns breach most-overdue-first), then the
  // scope's open tickets (team queue for staff, own tickets otherwise).
  const attention = breached.slice(0, 5);
  const openFallback = (isTeam ? queue : openMine).slice(0, 5);
  const feed = attention.length > 0 ? attention : openFallback;
  const feedTitle = attention.length > 0 ? 'Needs attention' : 'Active tickets';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="card dashboard-card">
      <h3 className="card-title">
        {greeting}, {userName.split(' ')[0]}
      </h3>
      <p className="card-sub">
        {openCount === 0
          ? isOrg
            ? 'All clear across every department.'
            : isTeam
              ? 'All clear in your departments.'
              : 'All clear — nothing open on your plate.'
          : `${openCount} open ticket${openCount === 1 ? '' : 's'}${overdueCount > 0 ? `, ${overdueCount} past deadline` : ''}${scopeSuffix}.`}
      </p>

      <div className="dashboard-stats">
        <div className="dashboard-stat dashboard-stat-blue">
          <div className="muted dashboard-stat-label">{scope} OPEN</div>
          <div className="dashboard-stat-value" style={{ color: NAVY }}>{openCount}</div>
        </div>
        <div className={`dashboard-stat ${overdueCount > 0 ? 'dashboard-stat-red' : 'dashboard-stat-neutral'}`}>
          <div className="muted dashboard-stat-label">OVERDUE</div>
          <div className="dashboard-stat-value" style={{ color: overdueCount > 0 ? RED : NAVY }}>
            {overdueCount}
          </div>
        </div>
        <div className="dashboard-stat dashboard-stat-green">
          <div className="muted dashboard-stat-label">SLA HEALTH</div>
          <div className="dashboard-stat-value" style={{ color: compliance === 100 ? GREEN : AMBER }}>
            {compliance}%
          </div>
        </div>
        {report && (
          <div className="dashboard-stat dashboard-stat-yellow">
            <div className="muted dashboard-stat-label">ORG CSAT</div>
            <div className="dashboard-stat-value" style={{ color: NAVY }}>
              {report.csatAverage != null ? `★ ${report.csatAverage.toFixed(1)}` : '—'}
            </div>
          </div>
        )}
      </div>

      <div className="dashboard-charts">
        <div>
          <div className="muted dashboard-chart-title" id="chart-volume-title">
            {isOrg ? 'ORG TICKETS · LAST 7 DAYS' : isTeam ? 'TEAM TICKETS · LAST 7 DAYS' : 'MY TICKETS · LAST 7 DAYS'}
          </div>
          <div role="img" aria-labelledby="chart-volume-title chart-volume-desc">
            <span id="chart-volume-desc" className="muted" style={{ fontSize: '0.8rem' }}>
              {volume.reduce((n, v) => n + v.tickets, 0)} tickets in the last 7 days
              {volume.some((v) => v.tickets > 0) ? `, peaking at ${Math.max(...volume.map((v) => v.tickets))} in a day` : ''}.
            </span>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={volume} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="tickets" fill={BLUE} radius={[5, 5, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>
            <summary style={{ cursor: 'pointer' }}>View as table</summary>
            <table>
              <caption>Tickets per day, last 7 days</caption>
              <tbody>
                {volume.map((v) => (
                  <tr key={v.name}><th scope="row">{v.name}</th><td>{v.tickets}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
        <div>
          <div className="muted dashboard-chart-title" id="chart-sla-title">
            {isOrg ? 'ORG OPEN · ON TRACK VS OVERDUE' : isTeam ? 'TEAM OPEN · ON TRACK VS OVERDUE' : 'MY OPEN · ON TRACK VS OVERDUE'}
          </div>
          {openCount === 0 ? (
            <div className="dashboard-empty">
              <span className="dashboard-empty-illustration" aria-hidden="true">
                <svg viewBox="0 0 72 64" focusable="false"><path d="M9 18h19l5 7h30v29H9z" /><path d="M9 18v-6h20l4 6M25 38h22M25 46h13" /></svg>
              </span>
              <strong>Nothing needs attention</strong>
              <span className="muted">There are no open requests in this view.</span>
            </div>
          ) : (
            <div role="img" aria-labelledby="chart-sla-title chart-sla-desc">
              <span id="chart-sla-desc" className="muted" style={{ fontSize: '0.8rem' }}>
                {onTrack} on track, {overdueCount} overdue out of {openCount} open.
              </span>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="name" innerRadius={42} outerRadius={65} paddingAngle={3}>
                    <Cell fill={GREEN} />
                    <Cell fill={RED} />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {feed.length > 0 && (
        <div className="dashboard-feed">
          <div className="muted dashboard-chart-title">{feedTitle}</div>
          {feed.map((t) => {
            const overdue = t.slaDueAt && new Date(t.slaDueAt).getTime() < now;
            return (
              <div key={t.id} className="dashboard-feed-row">
                <span className="dashboard-feed-title">
                  {t.title}
                </span>
                <span
                  className="badge"
                  style={{
                    background: overdue ? '#fee2e2' : t.status === 'IN_PROGRESS' ? '#eff6ff' : '#fef9c3',
                    color: overdue ? RED : t.status === 'IN_PROGRESS' ? BLUE : '#854d0e',
                  }}
                >
                  {overdue ? '● Overdue' : t.status === 'IN_PROGRESS' ? '● In progress' : '● Pending'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
