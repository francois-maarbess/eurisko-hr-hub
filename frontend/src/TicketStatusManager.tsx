import React, { useEffect, useState } from 'react';
import { Badge, Button, EmptyState, ErrorBox, Field, Tabs } from './components/ui';

type TicketStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';
type TicketPriority = 'LOW' | 'STANDARD' | 'URGENT';

interface TicketState {
  id: string;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  employeeId: string;
  departmentId: string;
  claimedById?: string | null;
  resolutionNote?: string;
  rejectionReason?: string;
  department?: { id: string; code: string; name: string };
  requestType?: { code: string; name: string };
  owner?: { id: string; displayName: string };
  claimant?: { id: string; displayName: string };
}

interface Membership {
  departmentId: string;
  departmentCode: string;
  departmentRole: string;
}

interface CardErrorState {
  [ticketId: string]: string | null;
}

const STATUS_COLORS: Record<TicketStatus, { background: string; color: string }> = {
  PENDING: { background: 'var(--warning-bg)', color: 'var(--warning)' },
  IN_PROGRESS: { background: 'var(--info-bg)', color: '#1d4ed8' },
  COMPLETED: { background: 'var(--success-bg)', color: 'var(--success)' },
  CANCELLED: { background: '#f1f5f9', color: 'var(--muted)' },
  REJECTED: { background: 'var(--danger-bg)', color: 'var(--danger)' },
};

const PRIORITY_COLORS: Record<TicketPriority, { background: string; color: string }> = {
  LOW: { background: '#f1f5f9', color: 'var(--muted)' },
  STANDARD: { background: 'var(--info-bg)', color: '#1d4ed8' },
  URGENT: { background: 'var(--danger-bg)', color: 'var(--danger)' },
};

type View = 'mine' | 'queue' | 'claimed';

interface TicketStatusManagerProps {
  token: string;
  userId: string;
  platformRole: string;
}

export default function TicketStatusManager({ token, userId, platformRole }: TicketStatusManagerProps) {
  const [tickets, setTickets] = useState<TicketState[]>([]);
  const [view, setView] = useState<View>('mine');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(false);
  const [cardErrors, setCardErrors] = useState<CardErrorState>({});
  const [resolutionInputs, setResolutionInputs] = useState<Record<string, string>>({});
  const [rejectionInputs, setRejectionInputs] = useState<Record<string, string>>({});
  const [showReject, setShowReject] = useState<Record<string, boolean>>({});

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const isAdmin = platformRole === 'SYSTEM_ADMIN';
  // Staff-only tabs: plain employees see just their own requests. The backend
  // enforces the same boundary (empty lists); hiding the tabs keeps the UI
  // from promising what the user may not open.
  const isStaff = isAdmin || memberships.length > 0;
  const memberDeptIds = new Set(memberships.map((m) => m.departmentId));

  const fetchTickets = async (v: View) => {
    try {
      const response = await fetch(`http://localhost:3000/requests?view=${v}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'Failed to load requests.');
      setTickets(data as TicketState[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load requests.';
      setCardErrors((current) => ({ ...current, global: message }));
    }
  };

  useEffect(() => {
    fetch('http://localhost:3000/auth/memberships', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setMemberships(data);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => { fetchTickets(view); }, [token, view]);

  const mutate = async (ticket: TicketState, fn: () => Promise<Response>) => {
    setLoading(true);
    setCardErrors((current) => ({ ...current, [ticket.id]: null }));
    try {
      const response = await fn();
      const data = await response.json();
      if (!response.ok) {
        setCardErrors((current) => ({ ...current, [ticket.id]: data?.message || 'Request failed.' }));
        return;
      }
      await fetchTickets(view);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reach the NestJS endpoint.';
      setCardErrors((current) => ({ ...current, [ticket.id]: message }));
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = (ticket: TicketState) =>
    mutate(ticket, () =>
      fetch(`http://localhost:3000/requests/${ticket.id}/claim`, { method: 'PATCH', headers: authHeaders }),
    );

  const handleCancel = (ticket: TicketState) =>
    mutate(ticket, () =>
      fetch(`http://localhost:3000/requests/${ticket.id}/status`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'CANCELLED' }),
      }),
    );

  const handleResolve = async (ticket: TicketState) => {
    const typedNote = (resolutionInputs[ticket.id] ?? '').trim();
    if (!typedNote) {
      setCardErrors((current) => ({ ...current, [ticket.id]: 'A resolution note is required when transitioning to COMPLETED.' }));
      return;
    }
    await mutate(ticket, () =>
      fetch(`http://localhost:3000/requests/${ticket.id}/status`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'COMPLETED', resolutionNote: typedNote }),
      }),
    );
  };

  const handleReject = async (ticket: TicketState) => {
    const reason = (rejectionInputs[ticket.id] ?? '').trim();
    if (!reason) {
      setCardErrors((current) => ({ ...current, [ticket.id]: 'A rejection reason is required.' }));
      return;
    }
    await mutate(ticket, () =>
      fetch(`http://localhost:3000/requests/${ticket.id}/status`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'REJECTED', rejectionReason: reason }),
      }),
    );
    setShowReject((c) => ({ ...c, [ticket.id]: false }));
  };

  const tabOptions = [
    { value: 'mine' as View, label: 'My Requests' },
    ...(isStaff
      ? [
          { value: 'queue' as View, label: 'Department Queue' },
          { value: 'claimed' as View, label: 'Claimed by Me' },
        ]
      : []),
  ];

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <Tabs options={tabOptions} value={view} onChange={setView} />

      {cardErrors.global && <ErrorBox message={cardErrors.global} />}

      {tickets.length === 0 && (
        <EmptyState
          message={
            view === 'queue'
              ? 'No open requests in your departments.'
              : view === 'claimed'
                ? 'No claimed requests yet.'
                : 'No requests yet. Create one above.'
          }
        />
      )}

      {tickets.map((ticket) => {
        const isOwner = ticket.employeeId === userId;
        const inMyDept = memberDeptIds.has(ticket.departmentId);
        const canClaim = (inMyDept || isAdmin) && ticket.status === 'PENDING' && !ticket.claimedById && !isOwner;
        const canCancel = isOwner && ticket.status === 'PENDING';
        const canWork = (inMyDept || isAdmin) && !isOwner && ticket.status === 'IN_PROGRESS';
        const ticketError = cardErrors[ticket.id];

        return (
          <div className="card" key={ticket.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="muted" style={{ marginBottom: '0.25rem' }}>
                  {ticket.id} {ticket.department && `· ${ticket.department.code}`}
                </div>
                <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{ticket.title}</div>
                {ticket.owner && <div className="muted">by {ticket.owner.displayName}</div>}
              </div>
              <div className="pill-group">
                <Badge bg={PRIORITY_COLORS[ticket.priority].background} color={PRIORITY_COLORS[ticket.priority].color}>
                  {ticket.priority}
                </Badge>
                <Badge bg={STATUS_COLORS[ticket.status].background} color={STATUS_COLORS[ticket.status].color}>
                  {ticket.status}
                </Badge>
              </div>
            </div>

            <p style={{ margin: '0.75rem 0', lineHeight: 1.5 }}>{ticket.description}</p>

            {ticket.claimant && (
              <p className="muted">Claimed by: {ticket.claimant.displayName}</p>
            )}

            {canWork && (
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
                <Field label="Resolution note">
                  <input
                    className="input"
                    type="text"
                    value={resolutionInputs[ticket.id] ?? ''}
                    onChange={(e) => setResolutionInputs((c) => ({ ...c, [ticket.id]: e.target.value }))}
                    placeholder="Enter resolution note"
                  />
                </Field>
                {showReject[ticket.id] && (
                  <Field label="Rejection reason">
                    <input
                      className="input"
                      type="text"
                      value={rejectionInputs[ticket.id] ?? ''}
                      onChange={(e) => setRejectionInputs((c) => ({ ...c, [ticket.id]: e.target.value }))}
                      placeholder="Enter rejection reason"
                    />
                  </Field>
                )}
              </div>
            )}

            {ticket.resolutionNote && (
              <div className="note-info" style={{ background: 'var(--success-bg)', border: 'none', marginTop: '0.75rem' }}>
                <strong>Resolution:</strong> {ticket.resolutionNote}
              </div>
            )}
            {ticket.rejectionReason && (
              <div className="alert-error" style={{ marginTop: '0.75rem' }}>
                <strong>Rejected:</strong> {ticket.rejectionReason}
              </div>
            )}

            {ticketError && (
              <div style={{ marginTop: '0.75rem' }}>
                <ErrorBox message={ticketError} />
              </div>
            )}

            <div className="row" style={{ marginTop: '1rem' }}>
              {canClaim && (
                <Button variant="primary" small onClick={() => handleClaim(ticket)} disabled={loading}>
                  {loading ? '...' : 'Claim'}
                </Button>
              )}
              {canCancel && (
                <Button variant="ghost" small onClick={() => handleCancel(ticket)} disabled={loading}>
                  {loading ? '...' : 'Cancel'}
                </Button>
              )}
              {canWork && (
                <>
                  <Button variant="success" small onClick={() => handleResolve(ticket)} disabled={loading}>
                    {loading ? '...' : 'Resolve'}
                  </Button>
                  {!showReject[ticket.id] ? (
                    <Button variant="danger-outline" small onClick={() => setShowReject((c) => ({ ...c, [ticket.id]: true }))} disabled={loading}>
                      Reject
                    </Button>
                  ) : (
                    <Button variant="danger" small onClick={() => handleReject(ticket)} disabled={loading}>
                      {loading ? '...' : 'Confirm Reject'}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
