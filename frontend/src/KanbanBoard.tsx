import React, { useState } from 'react';
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { Badge, Button, Modal } from './components/ui';
import { formatEnum } from './format';

export type BoardStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export interface BoardTicket {
  id: string;
  title: string;
  priority: 'LOW' | 'STANDARD' | 'URGENT';
  status: string;
  claimedById?: string | null;
  claimant?: { displayName: string };
  department?: { code: string };
  slaDueAt?: string | null;
}

interface KanbanBoardProps {
  tickets: BoardTicket[];
  hidePending?: boolean;
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

function DraggableCard({ ticket, onOpen, quiet, canDrop, onProgress, onComplete }: {
  ticket: BoardTicket;
  onOpen: (id: string) => void;
  quiet?: boolean;
  canDrop: (ticket: BoardTicket, target: BoardStatus) => string | null;
  onProgress: (ticket: BoardTicket) => void;
  onComplete: (ticket: BoardTicket) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: ticket.id });
  const pc = PRIORITY_COLORS[ticket.priority] || PRIORITY_COLORS.STANDARD;
  // Wall-clock read for the overdue badge; purely presentational.
  // eslint-disable-next-line react-hooks/purity
  const overdue = ticket.status !== 'COMPLETED' && ticket.slaDueAt != null && new Date(ticket.slaDueAt).getTime() < Date.now();
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`board-card${isDragging ? ' dragging' : ''}`}
      onKeyDownCapture={(e) => {
        if (e.target instanceof HTMLButtonElement) e.stopPropagation();
      }}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        opacity: isDragging ? 0.45 : quiet ? 0.72 : 1,
      }}
    >
      <button
        onClick={() => onOpen(ticket.id)}
        onPointerDown={(e) => e.stopPropagation()}
        title="Open ticket detail"
        className="board-card-title"
      >
        {ticket.title}
      </button>
      <div className="pill-group mt-sm">
        <Badge bg={pc.background} color={pc.color}>
          {formatEnum(ticket.priority)}
        </Badge>
        {overdue && (
          <Badge bg="var(--danger-bg)" color="var(--danger)">
            Overdue
          </Badge>
        )}
        {ticket.department && (
          <span className="muted board-column-count">{ticket.department.code}</span>
        )}
      </div>
      {ticket.claimant && (
        <div className="muted board-column-count mt-sm">
          Claimed by {ticket.claimant.displayName}
        </div>
      )}
      <div className="board-card-actions">
        {ticket.status === 'PENDING' && !canDrop(ticket, 'IN_PROGRESS') && (
          <Button small variant="ghost" onPointerDown={(e) => e.stopPropagation()} onClick={() => onProgress(ticket)}>
            Move to In Progress
          </Button>
        )}
        {ticket.status === 'IN_PROGRESS' && !canDrop(ticket, 'COMPLETED') && (
          <Button small variant="ghost" onPointerDown={(e) => e.stopPropagation()} onClick={() => onComplete(ticket)}>
            Move to Completed
          </Button>
        )}
      </div>
    </div>
  );
}

function Column({ status, title, hint, tickets, onOpen, canDrop, onProgress, onComplete }: {
  status: BoardStatus;
  title: string;
  hint: string;
  tickets: BoardTicket[];
  onOpen: (id: string) => void;
  canDrop: (ticket: BoardTicket, target: BoardStatus) => string | null;
  onProgress: (ticket: BoardTicket) => void;
  onComplete: (ticket: BoardTicket) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`board-column${isOver ? ' over' : ''}`}
    >
      <div>
        <strong className="board-column-title">{title}</strong>{' '}
        <span className="muted board-column-count">({tickets.length})</span>
        <div className="muted board-column-hint">{hint}</div>
      </div>
      {tickets.map((t) => (
        <DraggableCard key={t.id} ticket={t} onOpen={onOpen} quiet={status === 'COMPLETED'} canDrop={canDrop} onProgress={onProgress} onComplete={onComplete} />
      ))}
      {tickets.length === 0 && (
        <span className="muted board-empty">Drop tickets here</span>
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
export default function KanbanBoard({ tickets, hidePending = false, canDrop, onDropProgress, onDropComplete, onOpenTicket }: KanbanBoardProps) {
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

  const requestComplete = (ticket: BoardTicket) => {
    const blocked = canDrop(ticket, 'COMPLETED');
    if (blocked) {
      refuse(blocked);
      return;
    }
    setCompleting(ticket);
    setNote('');
  };

  const boardTickets = tickets.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS' || t.status === 'COMPLETED');
  const columns = COLUMNS.filter((column) => !hidePending || column.status !== 'PENDING');

  return (
    <div>
      {refusal && (
        <div className="board-refusal">
          {refusal}
        </div>
      )}
      <DndContext onDragEnd={handleDragEnd}>
        <div className="board-grid">
          {columns.map((c) => (
            <Column
              key={c.status}
              status={c.status}
              title={c.title}
              hint={c.hint}
              tickets={boardTickets.filter((t) => t.status === c.status)}
              onOpen={onOpenTicket}
              canDrop={canDrop}
              onProgress={onDropProgress}
              onComplete={requestComplete}
            />
          ))}
        </div>
      </DndContext>
      <p className="muted board-help mt-sm">
        Drag cards between columns. Cancelled and rejected tickets stay in the list view.
      </p>

      {completing && (
        <Modal
          title={`Complete “${completing.title}”`}
          sub="A resolution note is required to complete a ticket."
          onClose={() => setCompleting(null)}
        >
          <input
            className="input"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was done to resolve this?"
          />
          <div className="row mt-md">
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
        </Modal>
      )}
    </div>
  );
}
