import React, { useEffect, useState } from 'react';
import { Badge, Button, EmptyState, ErrorBox, Field, Tabs, formatEnum } from './components/ui';
import { apiUrl } from './api';
import KanbanBoard, { type BoardStatus, type BoardTicket } from './KanbanBoard';

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
  rating?: number | null;
  feedbackNote?: string | null;
  completedAt?: string | null;
  createdAt: string;
  slaDueAt?: string | null;
  slaSource?: string | null;
  department?: { id: string; code: string; name: string };
  requestType?: { code: string; name: string };
  owner?: { id: string; displayName: string };
  claimant?: { id: string; displayName: string };
  _count?: { documents?: number; staffNotes?: number };
}

interface Membership {
  departmentId: string;
  departmentCode: string;
  departmentRole: string;
}

interface DocMeta {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
}

interface ActivityItem {
  id: string;
  label: string;
  actor: string;
  timestamp: string;
  details?: string | null;
}

interface StaffNoteItem {
  id: string;
  content: string;
  authorId: string;
  author?: { id: string; displayName: string };
  authorName?: string;
  createdAt: string;
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

function getSlaInfo(ticket: TicketState): { label: string; bg: string; color: string; title: string } {
  // Prefer the stored per-ticket deadline (AI-set when Groq configured,
  // rule-based otherwise); fall back to legacy priority math for tickets
  // created before deadlines existed.
  const hasStored = !!ticket.slaDueAt;
  const targetHours = ticket.priority === 'URGENT' ? 4 : ticket.priority === 'STANDARD' ? 24 : 48;
  const deadlineMs = hasStored
    ? new Date(ticket.slaDueAt as string).getTime()
    : new Date(ticket.createdAt).getTime() + targetHours * 3600000;
  const sourceTitle = hasStored
    ? ticket.slaSource === 'AI'
      ? 'AI-estimated deadline from ticket content'
      : 'Standard deadline for this priority'
    : 'Standard deadline for this priority';
  const isTerminal = ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(ticket.status);

  if (ticket.status === 'COMPLETED' && ticket.completedAt) {
    const completedMs = new Date(ticket.completedAt).getTime();
    const met = completedMs <= deadlineMs;
    return {
      label: met ? `✓ SLA Met` : `SLA Breached`,
      bg: met ? '#dcfce7' : '#fee2e2',
      color: met ? '#15803d' : '#b91c1c',
      title: `${sourceTitle} · finished ${met ? 'on time' : 'late'}`,
    };
  }

  if (isTerminal) {
    return {
      label: `SLA: ${targetHours}h`,
      bg: '#f1f5f9',
      color: 'var(--muted)',
      title: sourceTitle,
    };
  }

  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) {
    const overdueHrs = Math.ceil(Math.abs(remainingMs) / 3600000);
    return {
      label: `SLA Overdue (+${overdueHrs}h)`,
      bg: '#fee2e2',
      color: '#b91c1c',
      title: `${sourceTitle} · overdue by about ${overdueHrs}h`,
    };
  }

  const remainingHrs = Math.floor(remainingMs / 3600000);
  const remainingMins = Math.floor((remainingMs % 3600000) / 60000);
  const text = remainingHrs > 0 ? `${remainingHrs}h ${remainingMins}m` : `${remainingMins}m`;
  const slaTargetMs = deadlineMs - new Date(ticket.createdAt).getTime();
  const isWarning = remainingMs < 3600000 || remainingMs < slaTargetMs * 0.25;

  return {
    label: `SLA: ${text} left`,
    bg: isWarning ? '#fef3c7' : '#eff6ff',
    color: isWarning ? '#b45309' : '#1d4ed8',
    title: `${sourceTitle} · ${text} remaining`,
  };
}

function highlightMatch(text: string, q: string): React.ReactNode {
  const query = q.trim();
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark
            key={i}
            style={{
              background: '#fef08a',
              color: '#854d0e',
              padding: '0 2px',
              borderRadius: '2px',
              fontWeight: 700,
            }}
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

interface TicketStatusManagerProps {
  token: string;
  userId: string;
  platformRole: string;
  focusTicketId?: string | null;
  onBack?: () => void;
  onOpenTicket?: (id: string) => void;
  initialView?: View;
  initialBoard?: boolean;
}

export default function TicketStatusManager({ token, userId, platformRole, focusTicketId, onBack, onOpenTicket, initialView, initialBoard }: TicketStatusManagerProps) {
  // Core lists & navigation state
  const [tickets, setTickets] = useState<TicketState[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [view, setView] = useState<View>(initialView ?? 'mine');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(false);
  const [cardErrors, setCardErrors] = useState<CardErrorState>({});

  // Filtering, search & sorting
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortOldest, setSortOldest] = useState(false);
  const [filterUrgentOnly, setFilterUrgentOnly] = useState(false);
  const [filterHasDocs, setFilterHasDocs] = useState(false);
  const [filterHasNotes, setFilterHasNotes] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [boardView, setBoardView] = useState(initialBoard ?? false);

  // Per-ticket form inputs
  const [resolutionInputs, setResolutionInputs] = useState<Record<string, string>>({});
  const [rejectionInputs, setRejectionInputs] = useState<Record<string, string>>({});
  const [showReject, setShowReject] = useState<Record<string, boolean>>({});

  // Attachments state
  const [docsOpen, setDocsOpen] = useState<Record<string, boolean>>({});
  const [docsCache, setDocsCache] = useState<Record<string, DocMeta[]>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);

  // Activity timeline state
  const [activityOpen, setActivityOpen] = useState<Record<string, boolean>>({});
  const [activityCache, setActivityCache] = useState<Record<string, ActivityItem[]>>({});

  // Staff notes state
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});
  const [notesCache, setNotesCache] = useState<Record<string, StaffNoteItem[]>>({});
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  // Re-routing state & catalog
  const [departments, setDepartments] = useState<{ id: string; code: string; name: string }[]>([]);
  const [allTypes, setAllTypes] = useState<{ id: string; code: string; name: string; departmentId: string }[]>([]);
  const [rerouteFor, setRerouteFor] = useState<string | null>(null);
  const [rerouteDept, setRerouteDept] = useState('');
  const [rerouteType, setRerouteType] = useState('');
  const [rerouteReason, setRerouteReason] = useState('');

  // Rating state
  const [ratingFor, setRatingFor] = useState<string | null>(null);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingNote, setRatingNote] = useState('');

  // Notifications & toast
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const isAdmin = platformRole === 'SYSTEM_ADMIN';
  const isStaff = isAdmin || memberships.length > 0;
  const memberDeptIds = new Set(memberships.map((m) => m.departmentId));

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const ageOf = (iso: string): string => {
    const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  const fetchTickets = async (v: View) => {
    setListLoading(true);
    try {
      // Focus mode shows one ticket (detail view); overdue mode pulls the
      // server-side breach list; otherwise the current tab.
      const url = focusTicketId
        ? apiUrl(`/requests/${focusTicketId}`)
        : overdueOnly
          ? apiUrl('/requests/breach')
          : apiUrl(`/requests?view=${v}`);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'Failed to load requests.');
      setTickets(focusTicketId ? [data as TicketState] : (data as TicketState[]));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load requests.';
      setCardErrors((current) => ({ ...current, global: message }));
    } finally {
      setListLoading(false);
    }
  };

  const TicketSkeletons = () => (
    <div style={{ display: 'grid', gap: '1rem' }} aria-label="Loading requests">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton-card">
          <div className="skeleton-line" style={{ width: '40%' }} />
          <div className="skeleton-line" style={{ width: '70%', height: '1.1rem' }} />
          <div className="skeleton-line" style={{ width: '55%' }} />
        </div>
      ))}
    </div>
  );

  useEffect(() => {
    fetch(apiUrl('/auth/memberships'), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setMemberships(data);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    fetchTickets(view);
  }, [token, view, overdueOnly, focusTicketId]);

  const mutate = async (
    ticket: TicketState,
    fn: () => Promise<Response>,
    successMsg?: string,
    optimistic?: Partial<TicketState>,
  ) => {
    setLoading(true);
    setCardErrors((current) => ({ ...current, [ticket.id]: null }));
    // Optimistic UI: paint the expected outcome instantly; any failure
    // below refetches server truth, rolling the card back automatically.
    if (optimistic) {
      setTickets((current) =>
        current.map((t) => (t.id === ticket.id ? { ...t, ...optimistic } : t)),
      );
    }
    try {
      const response = await fn();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setCardErrors((current) => ({ ...current, [ticket.id]: data?.message || 'Request failed.' }));
        if (optimistic) await fetchTickets(view);
        return;
      }
      await fetchTickets(view);
      if (successMsg) showToast(successMsg);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reach the server.';
      setCardErrors((current) => ({ ...current, [ticket.id]: message }));
      if (optimistic) await fetchTickets(view);
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = (ticket: TicketState) =>
    mutate(
      ticket,
      () => fetch(apiUrl(`/requests/${ticket.id}/claim`), { method: 'PATCH', headers: authHeaders }),
      'Claimed — you are now working on this request.',
      { status: 'IN_PROGRESS', claimedById: userId },
    );

  const handleCancel = (ticket: TicketState) =>
    mutate(
      ticket,
      () =>
        fetch(apiUrl(`/requests/${ticket.id}/status`), {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ status: 'CANCELLED' }),
        }),
      'Request cancelled.',
      { status: 'CANCELLED' },
    );

  const handleResolve = async (ticket: TicketState) => {
    const typedNote = (resolutionInputs[ticket.id] ?? '').trim();
    if (!typedNote) {
      // Backend allows completing with a document attached if resolutionNote is empty.
      // Verify whether documents exist before blocking.
      try {
        const res = await fetch(apiUrl(`/requests/${ticket.id}/documents`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const docs = res.ok ? await res.json() : [];
        setDocsCache((c) => ({ ...c, [ticket.id]: docs }));
        if (!Array.isArray(docs) || docs.length === 0) {
          setCardErrors((current) => ({
            ...current,
            [ticket.id]: 'A resolution note or an attached document is required to complete.',
          }));
          return;
        }
      } catch {
        setCardErrors((current) => ({ ...current, [ticket.id]: 'Could not verify attachments.' }));
        return;
      }
    }
    await mutate(
      ticket,
      () =>
        fetch(apiUrl(`/requests/${ticket.id}/status`), {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({
            status: 'COMPLETED',
            ...(typedNote ? { resolutionNote: typedNote } : {}),
          }),
        }),
      'Marked as completed.',
      { status: 'COMPLETED', resolutionNote: typedNote || ticket.resolutionNote },
    );
  };

  const handleReject = async (ticket: TicketState) => {    const reason = (rejectionInputs[ticket.id] ?? '').trim();
    if (!reason) {
      setCardErrors((current) => ({ ...current, [ticket.id]: 'A rejection reason is required.' }));
      return;
    }
    await mutate(
      ticket,
      () =>
        fetch(apiUrl(`/requests/${ticket.id}/status`), {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ status: 'REJECTED', rejectionReason: reason }),
        }),
      'Request rejected.',
      { status: 'REJECTED', rejectionReason: reason },
    );
    setShowReject((c) => ({ ...c, [ticket.id]: false }));
  };

  // Kanban board: legality mirrors the list-view buttons exactly. Null =
  // the drop may proceed; a string is the refusal reason shown as a toast.
  const fullTicket = (b: BoardTicket): TicketState =>
    tickets.find((t) => t.id === b.id) ?? (b as unknown as TicketState);

  const canDropOnBoard = (b: BoardTicket, target: BoardStatus): string | null => {
    const t = fullTicket(b);
    const isOwner = t.employeeId === userId;
    const inDept = memberDeptIds.has(t.departmentId);
    if (['COMPLETED', 'CANCELLED', 'REJECTED'].includes(t.status)) {
      return 'Finished tickets cannot move on the board.';
    }
    if (target === 'PENDING') return 'Tickets cannot move backwards — use the list view actions.';
    if (target === 'IN_PROGRESS') {
      if (isOwner) return 'You cannot claim your own request.';
      if (t.claimedById && t.claimedById !== userId) return 'Already claimed by another agent.';
      if (!(inDept || isAdmin)) return 'Only department staff can take this ticket.';
      return null;
    }
    // COMPLETED from IN_PROGRESS.
    if (t.status !== 'IN_PROGRESS') return 'Move the ticket through In Progress first.';
    if (isOwner) return 'You cannot resolve your own request.';
    if (!(inDept || isAdmin)) return 'Only department staff can complete this ticket.';
    return null;
  };

  const boardDropProgress = (b: BoardTicket) => {
    const t = fullTicket(b);
    if (!t.claimedById) {
      handleClaim(t);
      return;
    }
    mutate(
      t,
      () =>
        fetch(apiUrl(`/requests/${t.id}/status`), {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ status: 'IN_PROGRESS' }),
        }),
      'Moved to In Progress.',
      { status: 'IN_PROGRESS' },
    );
  };

  const boardDropComplete = (b: BoardTicket, note: string) => {
    const t = fullTicket(b);
    mutate(
      t,
      () =>
        fetch(apiUrl(`/requests/${t.id}/status`), {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ status: 'COMPLETED', resolutionNote: note }),
        }),
      'Marked as completed.',
      { status: 'COMPLETED', resolutionNote: note },
    );
  };

  // Attachments handlers
  const loadDocs = async (ticketId: string) => {
    try {
      const res = await fetch(apiUrl(`/requests/${ticketId}/documents`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const docs = await res.json();
      setDocsCache((c) => ({ ...c, [ticketId]: docs }));
    } catch {
      // Best-effort
    }
  };

  const toggleDocs = (ticketId: string) => {
    setDocsOpen((c) => {
      const next = !c[ticketId];
      if (next && !docsCache[ticketId]) void loadDocs(ticketId);
      return { ...c, [ticketId]: next };
    });
  };

  const handleUpload = async (ticket: TicketState, file: File) => {
    setUploadingDoc(ticket.id);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(apiUrl(`/requests/${ticket.id}/documents`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCardErrors((current) => ({ ...current, [ticket.id]: data?.message || 'Upload failed.' }));
        return;
      }
      await loadDocs(ticket.id);
      showToast('Attachment uploaded.');
    } catch {
      setCardErrors((current) => ({ ...current, [ticket.id]: 'Upload failed.' }));
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleDownload = async (ticket: TicketState, doc: DocMeta) => {
    try {
      const res = await fetch(apiUrl(`/requests/${ticket.id}/documents/${doc.id}/download`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setCardErrors((current) => ({ ...current, [ticket.id]: 'Download failed.' }));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.originalFilename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setCardErrors((current) => ({ ...current, [ticket.id]: 'Download failed.' }));
    }
  };

  const handleDeleteDoc = async (ticket: TicketState, doc: DocMeta) => {
    await mutate(ticket, () =>
      fetch(apiUrl(`/requests/${ticket.id}/documents/${doc.id}`), {
        method: 'DELETE',
        headers: authHeaders,
      }),
      'Attachment deleted.',
    );
    await loadDocs(ticket.id);
  };

  // Activity Timeline handlers
  const toggleActivity = async (ticketId: string) => {
    const next = !activityOpen[ticketId];
    setActivityOpen((c) => ({ ...c, [ticketId]: next }));
    if (next && !activityCache[ticketId]) {
      try {
        const res = await fetch(apiUrl(`/requests/${ticketId}/activity`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setActivityCache((c) => ({ ...c, [ticketId]: data }));
        }
      } catch {
        // Timeline is best-effort
      }
    }
  };

  // Catalog and Re-routing handlers
  const loadCatalog = async () => {
    try {
      const [dRes, tRes] = await Promise.all([
        fetch(apiUrl('/catalog/departments'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/catalog/request-types'), { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (dRes.ok) setDepartments(await dRes.json());
      if (tRes.ok) setAllTypes(await tRes.json());
    } catch {
      // Best-effort
    }
  };

  const openReroute = (ticket: TicketState) => {
    setRerouteFor(ticket.id);
    setRerouteDept('');
    setRerouteType('');
    setRerouteReason('');
    if (departments.length === 0) void loadCatalog();
  };

  const submitReroute = async (ticket: TicketState) => {
    if (!rerouteDept || !rerouteType || !rerouteReason.trim()) {
      setCardErrors((current) => ({
        ...current,
        [ticket.id]: 'Please select a department, request type, and enter a reason.',
      }));
      return;
    }
    await mutate(
      ticket,
      () =>
        fetch(apiUrl(`/requests/${ticket.id}/reroute`), {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({
            newDepartmentId: rerouteDept,
            newRequestTypeId: rerouteType,
            reason: rerouteReason.trim(),
          }),
        }),
      'Ticket re-routed and reopened as PENDING.',
    );
    setRerouteFor(null);
  };

  // Staff Notes handlers
  const loadNotes = async (ticketId: string) => {
    try {
      const res = await fetch(apiUrl(`/requests/${ticketId}/notes`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setNotesCache((c) => ({ ...c, [ticketId]: data }));
      }
    } catch {
      // Notes are best-effort
    }
  };

  const toggleNotes = async (ticketId: string) => {
    const next = !notesOpen[ticketId];
    setNotesOpen((c) => ({ ...c, [ticketId]: next }));
    if (next) await loadNotes(ticketId);
  };

  const submitNote = async (ticket: TicketState) => {
    const text = (noteInputs[ticket.id] ?? '').trim();
    if (!text) {
      setCardErrors((current) => ({ ...current, [ticket.id]: 'Note text is required.' }));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/requests/${ticket.id}/notes`), {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCardErrors((current) => ({ ...current, [ticket.id]: data?.message || 'Could not save note.' }));
        return;
      }
      setNoteInputs((c) => ({ ...c, [ticket.id]: '' }));
      await loadNotes(ticket.id);
      showToast('Staff note added.');
    } catch {
      setCardErrors((current) => ({ ...current, [ticket.id]: 'Could not save note.' }));
    } finally {
      setLoading(false);
    }
  };

  // Rating handlers
  const submitRating = async (ticket: TicketState) => {
    if (ratingStars < 1 || ratingStars > 5) {
      setCardErrors((current) => ({ ...current, [ticket.id]: 'Please pick 1 to 5 stars.' }));
      return;
    }
    await mutate(
      ticket,
      () =>
        fetch(apiUrl(`/requests/${ticket.id}/feedback`), {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ rating: ratingStars, feedbackNote: ratingNote.trim() || undefined }),
        }),
      'Thank you! Rating recorded.',
    );
    setRatingFor(null);
    setRatingStars(0);
    setRatingNote('');
  };

  // Filtered & sorted view
  const visibleTickets = tickets
    .filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (filterUrgentOnly && t.priority !== 'URGENT') return false;
      if (filterHasDocs && (t._count?.documents ?? (docsCache[t.id]?.length || 0)) === 0) return false;
      if (filterHasNotes && (t._count?.staffNotes ?? (notesCache[t.id]?.length || 0)) === 0) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.department?.name && t.department.name.toLowerCase().includes(q)) ||
        (t.requestType?.name && t.requestType.name.toLowerCase().includes(q))
      );
    })
    .sort((a, b) =>
      sortOldest
        ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

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
    <div className="ticket-manager">
      {focusTicketId ? (
        <div>
          <button
            onClick={onBack}
            style={{
              border: '1px solid var(--border)', background: '#fff', borderRadius: '10px',
              padding: '0.5rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700,
              color: 'var(--blue)',
            }}
          >
            ← Back to requests
          </button>
        </div>
      ) : (
        <>
          <Tabs options={tabOptions} value={view} onChange={setView} />

          <div className="toolbar">
            <input
              className="input toolbar-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search requests by title, description, or dept…"
            />
            <select
              className="select toolbar-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <button
              className={`toolbar-button${sortOldest ? ' active' : ''}`}
              onClick={() => setSortOldest((s) => !s)}
              title="Toggle oldest/newest first"
            >
              {sortOldest ? 'Oldest first ↑' : 'Newest first ↓'}
            </button>
            <button
              className={`toolbar-button${boardView ? ' active' : ''}`}
              onClick={() => setBoardView((v) => !v)}
              title={boardView ? 'Back to the list view' : 'Drag tickets across a board'}
            >
              {boardView ? 'List view' : 'Board view'}
            </button>
          </div>

          <div className="row quick-filters">
            <span className="muted">Quick filters:</span>
        <button
          className={`filter-button${filterUrgentOnly ? ' danger-active' : ''}`}
          onClick={() => setFilterUrgentOnly((u) => !u)}
        >
          Urgent Only
        </button>
        <button
          className={`filter-button${filterHasDocs ? ' active' : ''}`}
          onClick={() => setFilterHasDocs((d) => !d)}
        >
          Has Attachments
        </button>
        {isStaff && (
          <button
            className={`filter-button${filterHasNotes ? ' active' : ''}`}
            onClick={() => setFilterHasNotes((n) => !n)}
          >
            Has Staff Notes
          </button>
        )}
        <button
          className={`filter-button${overdueOnly ? ' danger-active' : ''}`}
          onClick={() => {
            setOverdueOnly((o) => {
              if (!o) setStatusFilter('ALL');
              return !o;
            });
          }}
          title="Show only open tickets past their SLA deadline"
        >
          Overdue
        </button>
        {(filterUrgentOnly || filterHasDocs || filterHasNotes || overdueOnly) && (
          <button
            className="filter-clear"
            onClick={() => {
              setFilterUrgentOnly(false);
              setFilterHasDocs(false);
              setFilterHasNotes(false);
              setOverdueOnly(false);
            }}
          >
            Clear filters
          </button>
        )}
      </div>
        </>
      )}

      {toast && (
        <div style={{ background: 'var(--navy)', color: '#fff', borderRadius: '10px', padding: '0.7rem 0.9rem', fontWeight: 600 }}>
          {toast}
        </div>
      )}

      {cardErrors.global && <ErrorBox message={cardErrors.global} />}

      {listLoading && tickets.length === 0 && <TicketSkeletons />}

      {visibleTickets.length === 0 && !(listLoading && tickets.length === 0) && (
        <EmptyState
          message={
            overdueOnly
              ? 'No overdue tickets — everything is on time.'
              : query || statusFilter !== 'ALL'
                ? 'No requests match this search.'
                : view === 'queue'
                  ? 'No open requests in your departments.'
                  : view === 'claimed'
                    ? 'No claimed requests yet.'
                    : 'No requests yet. Create one above.'
          }
        />
      )}

      {boardView && !focusTicketId ? (
        <KanbanBoard
          tickets={visibleTickets}
          canDrop={canDropOnBoard}
          onDropProgress={boardDropProgress}
          onDropComplete={boardDropComplete}
          onOpenTicket={(id) => onOpenTicket && onOpenTicket(id)}
        />
      ) : (
      visibleTickets.map((ticket) => {
        const isOwner = ticket.employeeId === userId;
        const inMyDept = memberDeptIds.has(ticket.departmentId);
        const isTerminalCard = ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(ticket.status);
        const canClaim = (inMyDept || isAdmin) && ticket.status === 'PENDING' && !ticket.claimedById && !isOwner;
        const canCancel = isOwner && ticket.status === 'PENDING';
        const canWork = (inMyDept || isAdmin) && !isOwner && ticket.status === 'IN_PROGRESS';
        const isManager = isAdmin || memberships.some((m) => m.departmentId === ticket.departmentId && m.departmentRole === 'MANAGER');
        const canReroute = (isManager || isAdmin) && !isTerminalCard;
        const canRate = isOwner && ticket.status === 'COMPLETED' && ticket.rating == null;
        const canRejectPending = (inMyDept || isAdmin) && !isOwner && ticket.status === 'PENDING';
        const canManageDocs = inMyDept || isAdmin;
        const canDownloadDocs = canManageDocs || (isOwner && isTerminalCard);
        const canReadNotes = (inMyDept || isAdmin) && (!isOwner || isAdmin);
        const ticketError = cardErrors[ticket.id];

        const sla = getSlaInfo(ticket);

        return (
          <div
            className="card"
            key={ticket.id}
            style={{
              ...(ticket.priority === 'URGENT' && !isTerminalCard ? { borderLeft: '4px solid var(--danger)' } : {}),
              ...(isTerminalCard ? { opacity: 0.85 } : {}),
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="muted" style={{ marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                  {ticket.department && `${ticket.department.name} (${ticket.department.code})`}
                  {ticket.requestType && ` · ${ticket.requestType.name}`}
                </div>
                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--navy)' }}>
                  {onOpenTicket && !focusTicketId ? (
                    <button
                      onClick={() => onOpenTicket(ticket.id)}
                      title="Open ticket detail"
                      style={{
                        border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                        fontWeight: 800, fontSize: '1.05rem', color: 'var(--navy)', textAlign: 'left',
                      }}
                    >
                      {highlightMatch(ticket.title, query)}
                    </button>
                  ) : (
                    highlightMatch(ticket.title, query)
                  )}
                </div>
                {ticket.owner && <div className="muted" style={{ fontSize: '0.85rem' }}>Requested by {ticket.owner.displayName}</div>}
              </div>
              <div className="pill-group">
                <span title={sla.title}>
                  <Badge bg={sla.bg} color={sla.color}>
                    {sla.label}
                  </Badge>
                </span>
                <Badge bg={PRIORITY_COLORS[ticket.priority].background} color={PRIORITY_COLORS[ticket.priority].color}>
                  {formatEnum(ticket.priority)}
                </Badge>
                <Badge bg={STATUS_COLORS[ticket.status].background} color={STATUS_COLORS[ticket.status].color}>
                  {formatEnum(ticket.status)}
                </Badge>
                {!isTerminalCard && (
                  <Badge bg="var(--blue-pale)" color="#1d4ed8">
                    Open {ageOf(ticket.createdAt)}
                  </Badge>
                )}
              </div>
            </div>

            <p style={{ margin: '0.75rem 0', lineHeight: 1.5, color: '#334155' }}>
              {highlightMatch(ticket.description, query)}
            </p>

            {ticket.claimant && (
              <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0' }}>
                Assigned Agent: <strong>{ticket.claimant.displayName}</strong>
              </p>
            )}

            {/* Activity Timeline Accordion */}
            <div style={{ marginTop: '0.6rem' }}>
              <button
                onClick={() => toggleActivity(ticket.id)}
                style={{
                  border: 'none',
                  background: 'none',
                  color: 'var(--blue)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  padding: 0,
                }}
              >
                {activityOpen[ticket.id] ? '▾ Activity Timeline' : '▸ Activity Timeline'}
              </button>
              {activityOpen[ticket.id] && (
                <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.4rem', background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: '8px' }}>
                  {(activityCache[ticket.id] || []).map((a, idx, arr) => {
                    const isStatus = a.label.startsWith('Status changed:');
                    const isReroute = a.label.startsWith('Re-routed');
                    const isNote = a.label === 'Internal note added';
                    const isCreated = a.label === 'Ticket created';
                    const isRated = a.label.startsWith('Rated');
                    const newStatus = isStatus ? a.label.replace('Status changed: ', '').split(' → ')[1] : '';
                    const nodeColor = isCreated
                      ? 'var(--navy)'
                      : newStatus === 'COMPLETED' || isRated
                        ? '#15803d'
                        : newStatus === 'REJECTED'
                          ? 'var(--danger)'
                          : isNote
                            ? '#7c3aed'
                            : isReroute
                              ? '#b45309'
                              : isStatus
                                ? 'var(--blue)'
                                : 'var(--muted)';
                    const isLast = idx === arr.length - 1;
                    return (
                      <div key={a.id} style={{ position: 'relative', paddingLeft: '1.35rem', paddingBottom: isLast ? 0 : '0.6rem', fontSize: '0.85rem' }}>
                        {!isLast && (
                          <span style={{ position: 'absolute', left: '5px', top: '16px', bottom: '-4px', width: '2px', background: 'var(--border)' }} />
                        )}
                        <span
                          style={{
                            position: 'absolute', left: 0, top: '3px', width: '12px', height: '12px',
                            borderRadius: '999px', background: nodeColor, border: '2px solid #fff',
                            boxShadow: '0 0 0 1px var(--border)',
                          }}
                        />
                        <div style={{ fontWeight: 700 }}>
                          {isStatus ? (
                            <span>
                              Status:{' '}
                              <span style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '4px', fontSize: '0.78rem' }}>
                                {a.label.replace('Status changed: ', '').split(' → ')[0]}
                              </span>
                              {' ➔ '}
                              <span style={{ background: 'var(--blue-pale)', color: '#1d4ed8', padding: '1px 5px', borderRadius: '4px', fontSize: '0.78rem' }}>
                                {a.label.replace('Status changed: ', '').split(' → ')[1]}
                              </span>
                            </span>
                          ) : (
                            a.label
                          )}
                        </div>
                        {isReroute && a.details && (
                          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.25rem 0.45rem', marginTop: '0.2rem', fontSize: '0.76rem' }}>
                            <strong>Audit Reason:</strong> {a.details}
                          </div>
                        )}
                        <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.15rem' }}>
                          {a.actor}
                          {!isReroute && a.details && !/^note [a-z0-9]+$/i.test(a.details) ? ` · ${a.details}` : ''} · {a.timestamp ? new Date(a.timestamp).toLocaleString() : ''}
                        </div>
                      </div>
                    );
                  })}
                  {(activityCache[ticket.id] || []).length === 0 && (
                    <span className="muted" style={{ fontSize: '0.85rem' }}>No recorded events yet.</span>
                  )}
                </div>
              )}
            </div>

            {/* Attachments Accordion */}
            {(canManageDocs || canDownloadDocs) && (
              <div style={{ marginTop: '0.5rem' }}>
                <button
                  onClick={() => toggleDocs(ticket.id)}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--blue)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    padding: 0,
                  }}
                >
                  {docsOpen[ticket.id] ? '▾ Attachments' : '▸ Attachments'}
                </button>
                {docsOpen[ticket.id] && (
                  <div style={{ marginTop: '0.4rem', display: 'grid', gap: '0.35rem', background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: '8px' }}>
                    {(docsCache[ticket.id] || []).map((d) => (
                      <div key={d.id} className="row" style={{ justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.85rem' }}>
                          {d.originalFilename} <span className="muted">({Math.round(d.byteSize / 1024)} KB)</span>
                        </span>
                        <span className="row" style={{ gap: '0.4rem' }}>
                          {canDownloadDocs && (
                            <button
                              onClick={() => handleDownload(ticket, d)}
                              style={{ border: 'none', background: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700 }}
                            >
                              Download
                            </button>
                          )}
                          {canManageDocs && (
                            <button
                              onClick={() => handleDeleteDoc(ticket, d)}
                              style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700 }}
                            >
                              Delete
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                    {(docsCache[ticket.id] || []).length === 0 && (
                      <span className="muted" style={{ fontSize: '0.85rem' }}>No attachments yet.</span>
                    )}
                    {canManageDocs && !isTerminalCard && (
                      <label style={{ fontSize: '0.85rem', color: 'var(--blue)', cursor: 'pointer', fontWeight: 700, marginTop: '0.3rem' }}>
                        {uploadingDoc === ticket.id ? 'Uploading…' : '+ Attach PDF / PNG / JPEG (max 5MB)'}
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg"
                          style={{ display: 'none' }}
                          disabled={uploadingDoc === ticket.id}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) void handleUpload(ticket, f);
                          }}
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Internal Staff Notes Accordion */}
            {canReadNotes && (
              <div style={{ marginTop: '0.5rem' }}>
                <button
                  onClick={() => toggleNotes(ticket.id)}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--blue)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    padding: 0,
                  }}
                >
                  {notesOpen[ticket.id] ? '▾ Internal Staff Notes (Private)' : '▸ Internal Staff Notes (Private)'}
                </button>
                {notesOpen[ticket.id] && (
                  <div style={{ marginTop: '0.4rem', display: 'grid', gap: '0.4rem', background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: '8px' }}>
                    {(notesCache[ticket.id] || []).map((n) => (
                      <div key={n.id} style={{ fontSize: '0.85rem', background: '#fff', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.45rem 0.6rem' }}>
                        <div>{n.content}</div>
                        <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
                          {n.author?.displayName || n.authorName || 'Staff'} · {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                        </div>
                      </div>
                    ))}
                    {(notesCache[ticket.id] || []).length === 0 && (
                      <span className="muted" style={{ fontSize: '0.85rem' }}>No internal notes yet.</span>
                    )}
                    {!isTerminalCard && (
                      <div className="row" style={{ marginTop: '0.4rem' }}>
                        <input
                          className="input"
                          style={{ flex: 1 }}
                          type="text"
                          value={noteInputs[ticket.id] ?? ''}
                          onChange={(e) => setNoteInputs((c) => ({ ...c, [ticket.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                              e.preventDefault();
                              void submitNote(ticket);
                            }
                          }}
                          placeholder="Add a private agent note (Ctrl+Enter to send)…"
                        />
                        <Button variant="ghost" small onClick={() => submitNote(ticket)} disabled={loading}>
                          Add
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Rejection input box when confirming rejection */}
            {(canWork || canRejectPending) && showReject[ticket.id] && (
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
                <Field label="Rejection reason *">
                  <input
                    className="input"
                    type="text"
                    value={rejectionInputs[ticket.id] ?? ''}
                    onChange={(e) => setRejectionInputs((c) => ({ ...c, [ticket.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        void handleReject(ticket);
                      }
                    }}
                    placeholder="Provide a reason for rejection (Ctrl+Enter to reject)"
                  />
                </Field>
              </div>
            )}

            {/* Resolution note input box when in progress */}
            {canWork && (
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
                <Field label="Resolution note (or complete with an attached document above)">
                  <input
                    className="input"
                    type="text"
                    value={resolutionInputs[ticket.id] ?? ''}
                    onChange={(e) => setResolutionInputs((c) => ({ ...c, [ticket.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        void handleComplete(ticket);
                      }
                    }}
                    placeholder="Enter resolution details (Ctrl+Enter to complete)"
                  />
                </Field>
              </div>
            )}

            {/* Resolution display */}
            {ticket.resolutionNote && (
              <div className="note-info" style={{ background: 'var(--success-bg)', border: 'none', marginTop: '0.75rem' }}>
                <strong>Resolution:</strong> {ticket.resolutionNote}
              </div>
            )}

            {/* Rejection display */}
            {ticket.rejectionReason && (
              <div className="alert-error" style={{ marginTop: '0.75rem' }}>
                <strong>Rejected:</strong> {ticket.rejectionReason}
              </div>
            )}

            {/* Rating / CSAT UI for ticket owner on completed tickets */}
            {canRate && (
              <div style={{ marginTop: '0.75rem' }}>
                {ratingFor === ticket.id ? (
                  <div style={{ display: 'grid', gap: '0.5rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#92400e' }}>How satisfied are you with this resolution?</div>
                    <div className="row" style={{ gap: '0.35rem' }}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setRatingStars(s)}
                          style={{
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            background: s <= ratingStars ? '#fef3c7' : '#fff',
                            fontSize: '1.25rem',
                            cursor: 'pointer',
                            padding: '0.2rem 0.5rem',
                            color: s <= ratingStars ? '#f59e0b' : '#cbd5e1',
                          }}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                    <input
                      className="input"
                      type="text"
                      value={ratingNote}
                      onChange={(e) => setRatingNote(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && ratingStars > 0) {
                          e.preventDefault();
                          void submitRating(ticket);
                        }
                      }}
                      placeholder="Optional feedback comment (Ctrl+Enter to submit)…"
                    />
                    <div className="row" style={{ gap: '0.5rem' }}>
                      <Button variant="success" small onClick={() => submitRating(ticket)} disabled={loading || ratingStars === 0}>
                        {loading ? 'Submitting…' : 'Submit Rating'}
                      </Button>
                      <Button
                        variant="ghost"
                        small
                        onClick={() => {
                          setRatingFor(null);
                          setRatingStars(0);
                          setRatingNote('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    small
                    onClick={() => {
                      setRatingFor(ticket.id);
                      setRatingStars(0);
                      setRatingNote('');
                    }}
                  >
                    ★ Rate this resolution
                  </Button>
                )}
              </div>
            )}

            {ticket.rating != null && (
              <div className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                Requester Rating: {'★'.repeat(ticket.rating)}{'☆'.repeat(5 - ticket.rating)}
                {ticket.feedbackNote && ` — “${ticket.feedbackNote}”`}
              </div>
            )}

            {ticketError && (
              <div style={{ marginTop: '0.75rem' }}>
                <ErrorBox message={ticketError} />
              </div>
            )}

            {/* Action buttons row */}
            <div className="row" style={{ marginTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
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
              {canRejectPending && !showReject[ticket.id] && (
                <Button variant="danger-outline" small onClick={() => setShowReject((c) => ({ ...c, [ticket.id]: true }))} disabled={loading}>
                  Reject
                </Button>
              )}
              {canRejectPending && showReject[ticket.id] && (
                <Button variant="danger" small onClick={() => handleReject(ticket)} disabled={loading}>
                  {loading ? '...' : 'Confirm Reject'}
                </Button>
              )}
              {canReroute && (
                <Button variant="ghost" small onClick={() => openReroute(ticket)} disabled={loading}>
                  Re-route
                </Button>
              )}
            </div>

            {/* Inline Re-route Modal/Box */}
            {rerouteFor === ticket.id && (
              <div style={{ marginTop: '0.75rem', border: '1px dashed var(--blue-border)', borderRadius: '10px', padding: '0.75rem', display: 'grid', gap: '0.5rem', background: 'var(--blue-pale)' }}>
                <strong style={{ fontSize: '0.9rem', color: 'var(--navy)' }}>Re-route to another department</strong>
                <div className="row" style={{ gap: '0.5rem' }}>
                  <select
                    className="select"
                    style={{ flex: 1 }}
                    value={rerouteDept}
                    onChange={(e) => {
                      setRerouteDept(e.target.value);
                      setRerouteType('');
                    }}
                  >
                    <option value="">Select target department…</option>
                    {departments
                      .filter((d) => d.id !== ticket.departmentId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                      ))}
                  </select>
                  <select
                    className="select"
                    style={{ flex: 1 }}
                    value={rerouteType}
                    onChange={(e) => setRerouteType(e.target.value)}
                    disabled={!rerouteDept}
                  >
                    <option value="">Select request type…</option>
                    {allTypes
                      .filter((t) => t.departmentId === rerouteDept)
                      .map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                  </select>
                </div>
                <input
                  className="input"
                  type="text"
                  value={rerouteReason}
                  onChange={(e) => setRerouteReason(e.target.value)}
                  placeholder="Reason for re-routing (required for audit log)"
                />
                <div className="row" style={{ gap: '0.5rem' }}>
                  <Button variant="primary" small onClick={() => submitReroute(ticket)} disabled={loading || !rerouteDept || !rerouteType || !rerouteReason.trim()}>
                    {loading ? '...' : 'Confirm Move'}
                  </Button>
                  <Button variant="ghost" small onClick={() => setRerouteFor(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      }))}
    </div>
  );
}
