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
 * are accountable for every request. Everyone else sees their own
 * tickets only, with explicitly personal labels.
 */
export default function Dashboard({ token, userName }: { token: string; userName: string }) {
  const [mine, setMine] = useState<MiniTicket[]>([]);
  const [breached, setBreached] = useState<MiniTicket[]>([]);
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [mineRes, breachRes, reportRes] = await Promise.all([
          fetch(apiUrl('/requests?view=mine'), { headers }),
          fetch(apiUrl('/requests/breach'), { headers }),
          fetch(apiUrl('/requests/report'), { headers }),
        ]);
        if (cancelled) return;
        if (mineRes.ok) setMine(await mineRes.json());
        if (breachRes.ok) setBreached(await breachRes.json());
        if (reportRes.ok) setReport(await reportRes.json());
      } catch {
        // Dashboard is decorative; the queue below is the source of truth.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const now = Date.now();
  const isOrg = report !== null;

  // Personal numbers (employees) vs org numbers (admins).
  const openMine = mine.filter((t) => !TERMINAL.includes(t.status));
  const overdueMine = openMine.filter((t) => t.slaDueAt && new Date(t.slaDueAt).getTime() < now);
  const orgOpen = (report?.departments || []).reduce((n, d) => n + d.open, 0);
  const orgBreached = (report?.departments || []).reduce((n, d) => n + d.breached, 0);

  const openCount = isOrg ? orgOpen : openMine.length;
  const overdueCount = isOrg ? orgBreached : overdueMine.length;
  const onTrack = openCount - overdueCount;
  const compliance = openCount === 0 ? 100 : Math.round((onTrack / openCount) * 100);
  const scope = isOrg ? 'ORG' : 'MY';

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
          tickets: mine.filter((t) => dayKey(new Date(t.createdAt)) === d.key).length,
        }));
      })();

  const donut = [
    { name: 'On track', value: onTrack },
    { name: 'Overdue', value: overdueCount },
  ];

  // Overdue first (backend returns breach most-overdue-first), then open.
  const attention = breached.slice(0, 5);
  const feed = attention.length > 0 ? attention : openMine.slice(0, 5);
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
            : 'All clear — nothing open on your plate.'
          : `${openCount} open ticket${openCount === 1 ? '' : 's'}${overdueCount > 0 ? `, ${overdueCount} past deadline` : ''}${isOrg ? ' org-wide' : ''}.`}
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
          <div className="muted dashboard-chart-title">
            {isOrg ? 'ORG TICKETS · LAST 7 DAYS' : 'MY TICKETS · LAST 7 DAYS'}
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={volume} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="tickets" fill={BLUE} radius={[5, 5, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="muted dashboard-chart-title">
            {isOrg ? 'ORG OPEN · ON TRACK VS OVERDUE' : 'MY OPEN · ON TRACK VS OVERDUE'}
          </div>
          {openCount === 0 ? (
            <p className="muted">Nothing open — enjoy the calm.</p>
          ) : (
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie data={donut} dataKey="value" nameKey="name" innerRadius={42} outerRadius={65} paddingAngle={3}>
                  <Cell fill={GREEN} />
                  <Cell fill={RED} />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
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
