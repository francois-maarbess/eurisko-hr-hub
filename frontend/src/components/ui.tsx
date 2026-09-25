import React from 'react';

/** Shared visual primitives. Screens compose these; no per-screen styling. */

export function Card({ title, sub, children }: { title?: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="card">
      {title && <h3 className="card-title">{title}</h3>}
      {sub && <p className="card-sub">{sub}</p>}
      {children}
    </div>
  );
}

type BtnVariant = 'primary' | 'success' | 'danger' | 'danger-outline' | 'ghost';

export function Button({
  variant = 'primary',
  small,
  block,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; small?: boolean; block?: boolean }) {
  const cls = [
    'btn',
    `btn-${variant}`,
    small ? 'btn-sm' : '',
    block ? 'btn-block' : '',
    className || '',
  ].filter(Boolean).join(' ');
  return <button className={cls} {...props} />;
}

export function Badge({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span className="badge" style={{ background: bg, color }}>
      {children}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Views">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'tab tab-active' : 'tab'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="alert-error">{message}</div>;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-state-illustration" aria-hidden="true">
        <svg viewBox="0 0 64 64" focusable="false">
          <path d="M10 24h16l5 6h23v22H10z" />
          <path d="M10 24v-6h17l4 6M20 41h24M20 47h15" />
        </svg>
      </span>
      <p>{message}</p>
    </div>
  );
}

/** Section header with numbered badge. */
export function SectionHeader({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <div className="section-header">
      <span className="section-number">{n}</span>
      <div>
        <div className="section-title">{title}</div>
        <div className="muted section-subtitle">{sub}</div>
      </div>
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h2 className="page-title">{title}</h2>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Section({ title, sub, children }: { title?: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="section">
      {(title || sub) && (
        <div className="section-head">
          {title && <h3 className="section-title">{title}</h3>}
          {sub && <p className="section-sub">{sub}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Alert({ tone, children }: { tone: 'info' | 'warn' | 'danger' | 'success'; children: React.ReactNode }) {
  return <div className={`alert alert-${tone}`} role="alert">{children}</div>;
}

export function Modal({ title, sub, onClose, className, children }: { title: string; sub?: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const prevFocus = React.useRef<Element | null>(null);
  // Latest onClose without re-running the effect: parents pass a fresh
  // arrow function every render (e.g. on each keystroke), and re-running
  // would yank focus out of the dialog's inputs mid-typing.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });
  React.useEffect(() => {
    prevFocus.current = document.activeElement;
    // Focus once on mount: prefer the first field so typing starts
    // immediately; fall back to the panel for button-only dialogs.
    const panel = panelRef.current;
    const firstField = panel?.querySelector<HTMLElement>('input, textarea, select');
    (firstField ?? panel)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // Focus trap: keep Tab cycling inside the dialog.
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const items = [...focusables].filter((el) => !el.hasAttribute('disabled'));
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Restore focus to whatever opened the dialog.
      (prevFocus.current as HTMLElement | null)?.focus?.();
    };
  }, []);
  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`card glass-panel modal-panel${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="card-title">{title}</h3>
        {sub && <p className="card-sub">{sub}</p>}
        {children}
      </div>
    </>
  );
}
