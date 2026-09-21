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
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; small?: boolean; block?: boolean }) {
  const cls = [
    'btn',
    `btn-${variant}`,
    small ? 'btn-sm' : '',
    block ? 'btn-block' : '',
  ].join(' ');
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
    <div className="tabs">
      {options.map((o) => (
        <button
          key={o.value}
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
  return <p className="muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>{message}</p>;
}

/** IN_PROGRESS -> In Progress, EMP_LETTER -> Emp Letter. Never show raw enum/code text to users. */
export function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function SectionHeader({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start', margin: '1.4rem 0 0.8rem' }}>
      <span
        style={{
          flexShrink: 0,
          width: '26px',
          height: '26px',
          borderRadius: '999px',
          background: 'var(--navy)',
          color: '#fff',
          fontSize: '0.8rem',
          fontWeight: 800,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {n}
      </span>
      <div>
        <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1rem' }}>{title}</div>
        <div className="muted" style={{ fontSize: '0.85rem' }}>{sub}</div>
      </div>
    </div>
  );
}
