import React, { useEffect, useState } from 'react';

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

const statusColors: Record<TicketStatus, { background: string; color: string }> = {
  PENDING: { background: '#fff3cd', color: '#856404' },
  IN_PROGRESS: { background: '#d1ecf1', color: '#0c5460' },
  COMPLETED: { background: '#d4edda', color: '#155724' },
  CANCELLED: { background: '#f8d7da', color: '#721c24' },
  REJECTED: { background: '#f8d7da', color: '#721c24' },
};

const priorityColors: Record<TicketPriority, { background: string; color: string }> = {
  LOW: { background: '#e2e3e5', color: '#383d41' },
  STANDARD: { background: '#cce5ff', color: '#004085' },
  URGENT: { background: '#f8d7da', color: '#721c24' },
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

  const tabBtn = (v: View, label: string) => (
    <button
      key={v}
      onClick={() => setView(v)}
      style={{
        padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer',
        border: '1px solid #ccc', background: view === v ? '#007bff' : '#fff',
        color: view === v ? '#fff' : '#333', fontWeight: 600,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {tabBtn('mine', 'My Requests')}
        {tabBtn('queue', 'Department Queue')}
        {tabBtn('claimed', 'Claimed by Me')}
      </div>

      {cardErrors.global && (
        <div style={{ background: '#f8d7da', color: '#721c24', padding: '0.75rem', borderRadius: '8px' }}>
          {cardErrors.global}
        </div>
      )}

      {tickets.map((ticket) => {
        const statusStyle = statusColors[ticket.status];
        const priorityStyle = priorityColors[ticket.priority];
        const ticketError = cardErrors[ticket.id];
        const isOwner = ticket.employeeId === userId;
        const inMyDept = memberDeptIds.has(ticket.departmentId);
        const canClaim = (inMyDept || isAdmin) && ticket.status === 'PENDING' && !ticket.claimedById && !isOwner;
        const canCancel = isOwner && ticket.status === 'PENDING';
        const canWork = (inMyDept || isAdmin) && !isOwner && ticket.status === 'IN_PROGRESS';

        return (
          <div key={ticket.id} style={{ border: '1px solid #d9d9d9', borderRadius: '12px', padding: '1rem', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.25rem' }}>
                  {ticket.id} {ticket.department && `· ${ticket.department.code}`}
                </div>
                <h3 style={{ margin: 0 }}>{ticket.title}</h3>
                {ticket.owner && <div style={{ fontSize: '0.8rem', color: '#888' }}>by {ticket.owner.displayName}</div>}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ padding: '0.3rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, background: priorityStyle.background, color: priorityStyle.color }}>{ticket.priority}</span>
                <span style={{ padding: '0.3rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, background: statusStyle.background, color: statusStyle.color }}>{ticket.status}</span>
              </div>
            </div>

            <p style={{ margin: '0.75rem 0', color: '#333', lineHeight: 1.5 }}>{ticket.description}</p>

            {ticket.claimant && <div style={{ fontSize: '0.8rem', color: '#0c5460' }}>Claimed by: {ticket.claimant.displayName}</div>}

            {canWork && (
              <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                <label style={{ fontWeight: 600 }}>Resolution note</label>
                <input type="text" value={resolutionInputs[ticket.id] ?? ''} onChange={(e) => setResolutionInputs((c) => ({ ...c, [ticket.id]: e.target.value }))} placeholder="Enter resolution note" style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #cfcfcf', boxSizing: 'border-box' }} />
                {showReject[ticket.id] && (
                  <input type="text" value={rejectionInputs[ticket.id] ?? ''} onChange={(e) => setRejectionInputs((c) => ({ ...c, [ticket.id]: e.target.value }))} placeholder="Enter rejection reason" style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #cfcfcf', boxSizing: 'border-box' }} />
                )}
              </div>
            )}

            {ticket.resolutionNote && (
              <div style={{ marginTop: '0.75rem', background: '#d4edda', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
                <strong>Resolution:</strong> {ticket.resolutionNote}
              </div>
            )}
            {ticket.rejectionReason && (
              <div style={{ marginTop: '0.75rem', background: '#f8d7da', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
                <strong>Rejected:</strong> {ticket.rejectionReason}
              </div>
            )}

            {ticketError && (
              <div style={{ marginTop: '0.75rem', background: '#f8d7da', color: '#721c24', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>{ticketError}</div>
            )}

            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {canClaim && (
                <button onClick={() => handleClaim(ticket)} disabled={loading} style={{ padding: '0.6rem 1rem', borderRadius: '8px', border: 'none', background: '#007bff', color: '#fff', cursor: 'pointer' }}>{loading ? '...' : 'Claim'}</button>
              )}
              {canCancel && (
                <button onClick={() => handleCancel(ticket)} disabled={loading} style={{ padding: '0.6rem 1rem', borderRadius: '8px', border: 'none', background: '#6c757d', color: '#fff', cursor: 'pointer' }}>{loading ? '...' : 'Cancel'}</button>
              )}
              {canWork && (
                <>
                  <button onClick={() => handleResolve(ticket)} disabled={loading} style={{ padding: '0.6rem 1rem', borderRadius: '8px', border: 'none', background: '#28a745', color: '#fff', cursor: 'pointer' }}>{loading ? '...' : 'Resolve'}</button>
                  {!showReject[ticket.id] ? (
                    <button onClick={() => setShowReject((c) => ({ ...c, [ticket.id]: true }))} disabled={loading} style={{ padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid #dc3545', background: '#fff', color: '#dc3545', cursor: 'pointer' }}>Reject</button>
                  ) : (
                    <button onClick={() => handleReject(ticket)} disabled={loading} style={{ padding: '0.6rem 1rem', borderRadius: '8px', border: 'none', background: '#dc3545', color: '#fff', cursor: 'pointer' }}>{loading ? '...' : 'Confirm Reject'}</button>
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
