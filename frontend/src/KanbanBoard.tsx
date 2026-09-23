import React, { useState } from 'react';
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { Badge, Button, formatEnum } from './components/ui';

export type BoardStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export interface BoardTicket {
  id: string;
  title: string;
  priority: 'LOW' | 'STANDARD' | 'URGENT';
  status: string;
  claimedById?: string | null;
  claimant?: { displayName: string };
  department?: { code: string };
}

interface KanbanBoardProps {
  tickets: BoardTicket[];
  /** Null = drop allowed; string = refusal reason shown as a toast. */
  canDrop: (ticket: BoardTicket, target: BoardStatus) => string | null;
  onDropProgress: (ticket: BoardTicket) => void;
  onDropComplete: (ticket: BoardTicket, note: string) => void;
  onOpenTicket: (id: string) => void;
}

const COLUMNS: { status: BoardStatus; title: string; hint: string }[] = [
  { status: 'PENDING', title: 'Pending', hint: 'Unclaimed work' },
  { status: 'IN_PROGRESS', title: 'In Progress', hint: 'Being handled' },
  { status: 'COMPLETED', title: 'Completed', hint: 'Resolved' },
];

const PRIORITY_COLORS: Record<string, { background: string; color: string }> = {
  LOW: { background: '#f1f5f9', color: 'var(--muted)' },
  STANDARD: { background: 'var(--info-bg)', color: '#1d4ed8' },
  URGENT: { background: 'var(--danger-bg)', color: 'var(--danger)' },
};

function DraggableCard({ ticket, onOpen }: { ticket: BoardTicket; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: ticket.id });
  const pc = PRIORITY_COLORS[ticket.priority] || PRIORITY_COLORS.STANDARD;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        background: '#fff',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '0.6rem 0.7rem',
        cursor: 'grab',
        opacity: isDragging ? 0.45 : 1,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        boxShadow: isDragging ? 'var(--shadow-md)' : 'none',
        touchAction: 'none',
      }}
    >
      <button
        onClick={() => onOpen(ticket.id)}
        onPointerDown={(e) => e.stopPropagation()}
        title="Open ticket detail"
        style={{
          border: 'none', background: 'none', padding: 0, cursor: 'pointer',
          fontWeight: 700, fontSize: '0.85rem', color: 'var(--navy)', textAlign: 'left',
          display: 'block', width: '100%',
        }}
      >
        {ticket.title}
      </button>
      <div className="pill-group" style={{ marginTop: '0.4rem' }}>
        <Badge bg={pc.background} color={pc.color}>
          {formatEnum(ticket.priority)}
        </Badge>
        {ticket.department && (
          <span className="muted" style={{ fontSize: '0.75rem' }}>{ticket.department.code}</span>
        )}
      </div>
      {ticket.claimant && (
        <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
          {ticket.claimant.displayName}
        </div>
      )}
    </div>
  );
}

function Column({ status, title, hint, tickets, onOpen }: {
  status: BoardStatus;
  title: string;
  hint: string;
  tickets: BoardTicket[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver ? 'var(--blue-pale)' : '#f8fafc',
        border: `1px dashed ${isOver ? 'var(--blue)' : 'var(--border)'}`,
        borderRadius: '12px',
        padding: '0.6rem',
        minHeight: '220px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <div>
        <strong style={{ fontSize: '0.85rem' }}>{title}</strong>{' '}
        <span className="muted" style={{ fontSize: '0.75rem' }}>({tickets.length})</span>
        <div className="muted" style={{ fontSize: '0.72rem' }}>{hint}</div>
      </div>
      {tickets.map((t) => (
        <DraggableCard key={t.id} ticket={t} onOpen={onOpen} />
      ))}
      {tickets.length === 0 && (
        <span className="muted" style={{ fontSize: '0.78rem' }}>Drop tickets here</span>
      )}
    </div>
  );
}

/**
 * Drag-and-drop board over the existing status endpoints. Only legal
 * moves execute (Pending→In Progress claims/starts; In Progress→
 * Completed asks for the mandatory resolution note); anything else
 * snaps back with an explanatory toast.
 */
export default function KanbanBoard({ tickets, canDrop, onDropProgress, onDropComplete, onOpenTicket }: KanbanBoardProps) {
  const [completing, setCompleting] = useState<BoardTicket | null>(null);
  const [note, setNote] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  const refuse = (reason: string) => {
    setRefusal(reason);
    window.setTimeout(() => setRefusal(null), 3500);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const ticket = tickets.find((t) => t.id === e.active.id);
    const target = e.over?.id as BoardStatus | undefined;
    if (!ticket || !target || ticket.status === target) return;
    if (target !== 'PENDING' && target !== 'IN_PROGRESS' && target !== 'COMPLETED') return;
    const blocked = canDrop(ticket, target);
    if (blocked) {
      refuse(blocked);
      return;
    }
    if (target === 'COMPLETED') {
      setCompleting(ticket);
      setNote('');
      return;
    }
    if (target === 'IN_PROGRESS') {
      onDropProgress(ticket);
      return;
    }
    refuse('Tickets cannot move backwards — use the list view actions.');
  };

  const boardTickets = tickets.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS' || t.status === 'COMPLETED');

  return (
    <div>
      {refusal && (
        <div style={{ background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: '10px', padding: '0.6rem 0.9rem', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.6rem' }}>
          {refusal}
        </div>
      )}
      <DndContext onDragEnd={handleDragEnd}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
          {COLUMNS.map((c) => (
            <Column
              key={c.status}
              status={c.status}
              title={c.title}
              hint={c.hint}
              tickets={boardTickets.filter((t) => t.status === c.status)}
              onOpen={onOpenTicket}
            />
          ))}
        </div>
      </DndContext>
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
        Drag cards between columns. Cancelled and rejected tickets stay in the list view.
      </p>

      {completing && (
        <>
          <div
            onClick={() => setCompleting(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', zIndex: 50 }}
          />
          <div
            className="card glass-panel"
            style={{ position: 'fixed', zIndex: 51, left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 'min(440px, calc(100vw - 2.5rem))' }}
          >
            <h3 className="card-title">Complete “{completing.title}”</h3>
            <p className="card-sub">A resolution note is required to complete a ticket.</p>
            <input
              className="input"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was done to resolve this?"
              autoFocus
            />
            <div className="row" style={{ marginTop: '0.75rem' }}>
              <Button
                variant="success"
                small
                disabled={!note.trim()}
                onClick={() => {
                  onDropComplete(completing, note.trim());
                  setCompleting(null);
                }}
              >
                Complete ticket
              </Button>
              <Button variant="ghost" small onClick={() => setCompleting(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
