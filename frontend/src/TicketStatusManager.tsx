import React, { useEffect, useState } from 'react';

type TicketStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
type TicketPriority = 'LOW' | 'STANDARD' | 'URGENT';

interface TicketState {
  id: string;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  resolution_note?: string;
  department?: { code: string; name: string };
  requestType?: { code: string; name: string };
  owner?: { displayName: string };
  claimant?: { displayName: string };
}

interface CardErrorState {
  [ticketId: string]: string | null;
}

const statusColors: Record<TicketStatus, { background: string; color: string }> = {
  PENDING: { background: '#fff3cd', color: '#856404' },
  IN_PROGRESS: { background: '#d1ecf1', color: '#0c5460' },
  COMPLETED: { background: '#d4edda', color: '#155724' },
  CANCELLED: { background: '#f8d7da', color: '#721c24' },
};

const priorityColors: Record<TicketPriority, { background: string; color: string }> = {
  LOW: { background: '#e2e3e5', color: '#383d41' },
  STANDARD: { background: '#cce5ff', color: '#004085' },
  URGENT: { background: '#f8d7da', color: '#721c24' },
};

interface TicketStatusManagerProps {
  token: string;
}

export default function TicketStatusManager({ token }: TicketStatusManagerProps) {
  const [tickets, setTickets] = useState<TicketState[]>([]);
  const [loading, setLoading] = useState(false);
  const [cardErrors, setCardErrors] = useState<CardErrorState>({});
  const [resolutionInputs, setResolutionInputs] = useState<Record<string, string>>({});

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const fetchTickets = async () => {
    try {
      const response = await fetch('http://localhost:3000/requests', { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'Failed to load requests.');
      setTickets(data as TicketState[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load requests.';
      setCardErrors((current) => ({ ...current, global: message }));
    }
  };

  useEffect(() => { fetchTickets(); }, [token]);

  const updateTicketStatus = async (ticket: TicketState, status: TicketStatus, resolution_note?: string) => {
    setLoading(true);
    setCardErrors((current) => ({ ...current, [ticket.id]: null }));

    try {
      let url = `http://localhost:3000/requests/${ticket.id}/status`;
      let body: any = { status };

      if (ticket.status === 'PENDING' && status === 'IN_PROGRESS') {
        url = `http://localhost:3000/requests/${ticket.id}/claim`;
        body = undefined;
      }

      const response = await fetch(url, {
        method: 'PATCH',
        headers: authHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();
      if (!response.ok) {
        setCardErrors((current) => ({ ...current, [ticket.id]: data?.message || 'Request failed.' }));
        return;
      }
      await fetchTickets();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reach the NestJS endpoint.';
      setCardErrors((current) => ({ ...current, [ticket.id]: message }));
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = (ticket: TicketState) => updateTicketStatus(ticket, 'IN_PROGRESS');
  const handleCancel = (ticket: TicketState) => updateTicketStatus(ticket, 'CANCELLED');

  const handleResolve = async (ticket: TicketState) => {
    const typedNote = (resolutionInputs[ticket.id] ?? '').trim();
    if (!typedNote) {
      setCardErrors((current) => ({ ...current, [ticket.id]: 'A resolution note is required when transitioning to COMPLETED.' }));
      return;
    }
    setLoading(true);
    setCardErrors((current) => ({ ...current, [ticket.id]: null }));
    try {
      const response = await fetch(`http://localhost:3000/requests/${ticket.id}/status`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'COMPLETED', resolutionNote: typedNote }),
      });
      const data = await response.json();
      if (!response.ok) {
        setCardErrors((current) => ({ ...current, [ticket.id]: data?.message || 'Request failed.' }));
        return;
      }
      await fetchTickets();
    } catch (err) {
      setCardErrors((current) => ({ ...current, [ticket.id]: 'Unable to reach the server.' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {cardErrors.global && (
        <div style={{ background: '#f8d7da', color: '#721c24', padding: '0.75rem', borderRadius: '8px' }}>
          {cardErrors.global}
        </div>
      )}

      {tickets.map((ticket) => {
        const statusStyle = statusColors[ticket.status];
        const priorityStyle = priorityColors[ticket.priority];
        const ticketError = cardErrors[ticket.id];

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

            {ticket.status === 'IN_PROGRESS' && (
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>Resolution note</label>
                <input type="text" value={resolutionInputs[ticket.id] ?? ''} onChange={(e) => setResolutionInputs((c) => ({ ...c, [ticket.id]: e.target.value }))} placeholder="Enter resolution note" style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #cfcfcf', boxSizing: 'border-box' }} />
              </div>
            )}

            {ticketError && (
              <div style={{ marginTop: '0.75rem', background: '#f8d7da', color: '#721c24', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>{ticketError}</div>
            )}

            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {ticket.status === 'PENDING' && (
                <>
                  <button onClick={() => handleClaim(ticket)} disabled={loading} style={{ padding: '0.6rem 1rem', borderRadius: '8px', border: 'none', background: '#007bff', color: '#fff', cursor: 'pointer' }}>{loading ? '...' : 'Claim'}</button>
                  <button onClick={() => handleCancel(ticket)} disabled={loading} style={{ padding: '0.6rem 1rem', borderRadius: '8px', border: 'none', background: '#6c757d', color: '#fff', cursor: 'pointer' }}>{loading ? '...' : 'Cancel'}</button>
                </>
              )}
              {ticket.status === 'IN_PROGRESS' && (
                <button onClick={() => handleResolve(ticket)} disabled={loading} style={{ padding: '0.6rem 1rem', borderRadius: '8px', border: 'none', background: '#28a745', color: '#fff', cursor: 'pointer' }}>{loading ? '...' : 'Resolve'}</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
