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

function last7Days(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({
      key: dayKey(d),
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
    });
  }
  return out;
}

/**
 * Personal command center: greeting, KPI cards, 7-day volume chart,
 * SLA donut, and the active-ticket feed. Org-wide numbers appear
 * automatically for admins (report endpoint); everyone else sees
 * their own tickets only.
 */
export default function Dashboard({ token, userName }: { token: string; userName: string }) {
  const [mine, setMine] = useState<MiniTicket[]>([]);
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mineRes, reportRes] = await Promise.all([
          fetch(apiUrl('/requests?view=mine'), { headers: { Authorization: `Bearer ${token}` } }),
          fetch(apiUrl('/requests/report'), { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (cancelled) return;
        if (mineRes.ok) setMine(await mineRes.json());
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
  const openMine = mine.filter((t) => !TERMINAL.includes(t.status));
  const overdueMine = openMine.filter((t) => t.slaDueAt && new Date(t.slaDueAt).getTime() < now);
  const onTrack = openMine.length - overdueMine.length;
  const compliance = openMine.length === 0 ? 100 : Math.round((onTrack / openMine.length) * 100);

  const days = last7Days();
  const volume = days.map((d) => ({
    name: d.label,
    tickets: mine.filter((t) => dayKey(new Date(t.createdAt)) === d.key).length,
  }));

  const donut = [
    { name: 'On track', value: onTrack },
    { name: 'Overdue', value: overdueMine.length },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 className="card-title">
        {greeting}, {userName.split(' ')[0]} 👋
      </h3>
      <p className="card-sub">
        {openMine.length === 0
          ? 'All clear — nothing open on your plate.'
          : `${openMine.length} open ticket${openMine.length === 1 ? '' : 's'}${overdueMine.length > 0 ? `, ${overdueMine.length} past deadline` : ''}.`}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.6rem', margin: '0.9rem 0' }}>
        <div style={{ background: '#eff6ff', borderRadius: '10px', padding: '0.7rem 0.9rem' }}>
          <div className="muted" style={{ fontSize: '0.75rem', fontWeight: 700 }}>MY OPEN</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: NAVY }}>{openMine.length}</div>
        </div>
        <div style={{ background: overdueMine.length > 0 ? '#fee2e2' : '#f8fafc', borderRadius: '10px', padding: '0.7rem 0.9rem' }}>
          <div className="muted" style={{ fontSize: '0.75rem', fontWeight: 700 }}>OVERDUE</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: overdueMine.length > 0 ? RED : NAVY }}>
            {overdueMine.length}
          </div>
        </div>
        <div style={{ background: '#f0fdf4', borderRadius: '10px', padding: '0.7rem 0.9rem' }}>
          <div className="muted" style={{ fontSize: '0.75rem', fontWeight: 700 }}>SLA HEALTH</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: compliance === 100 ? GREEN : AMBER }}>
            {compliance}%
          </div>
        </div>
        {report && (
          <div style={{ background: '#fefce8', borderRadius: '10px', padding: '0.7rem 0.9rem' }}>
            <div className="muted" style={{ fontSize: '0.75rem', fontWeight: 700 }}>ORG CSAT</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: NAVY }}>
              {report.csatAverage != null ? `★ ${report.csatAverage.toFixed(1)}` : '—'}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        <div>
          <div className="muted" style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem' }}>
            MY TICKETS · LAST 7 DAYS
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
          <div className="muted" style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem' }}>
            MY OPEN · ON TRACK VS OVERDUE
          </div>
          {openMine.length === 0 ? (
            <p className="muted" style={{ fontSize: '0.85rem' }}>Nothing open — enjoy the calm.</p>
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

      {openMine.length > 0 && (
        <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.35rem' }}>
          {openMine.slice(0, 5).map((t) => {
            const overdue = t.slaDueAt && new Date(t.slaDueAt).getTime() < now;
            return (
              <div key={t.id} className="row" style={{ justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
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
