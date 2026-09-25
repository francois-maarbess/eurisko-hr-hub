import React, { useState } from 'react';
import { Alert, Button, ErrorBox, Field } from './components/ui';
import { apiUrl } from './api';

/**
 * Self-service password change for any signed-in account.
 * Uses PATCH /auth/password ({ currentPassword, newPassword }).
 * Backend enforces: correct current password, min 8 chars, must differ.
 */
export default function PasswordSettings({ token }: { token: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const trimmedNext = next;
  const tooShort = trimmedNext.length > 0 && trimmedNext.length < 8;
  const sameAsCurrent = trimmedNext.length > 0 && current.length > 0 && trimmedNext === current;
  const mismatch = confirm.length > 0 && confirm !== next;
  const valid =
    current.length > 0 &&
    next.length >= 8 &&
    !sameAsCurrent &&
    confirm === next &&
    confirm.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    if (!valid) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl('/auth/password'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Could not change password.');
      setCurrent('');
      setNext('');
      setConfirm('');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title">Change password</h3>
      <p className="card-sub">Any account can change its own password. You stay signed in on this device.</p>
      {error && (
        <div style={{ marginBottom: '0.75rem' }}>
          <ErrorBox message={error} />
        </div>
      )}
      {success && (
        <div style={{ marginBottom: '0.75rem' }}>
          <Alert tone="success">Password changed — use it next time you sign in.</Alert>
        </div>
      )}
      <form onSubmit={submit}>
        <Field label="Current password">
          <div className="row" style={{ gap: '0.5rem' }}>
            <input
              className="input"
              style={{ flex: 1 }}
              type={showCurrent ? 'text' : 'password'}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
            <Button type="button" variant="ghost" small onClick={() => setShowCurrent((s) => !s)} aria-pressed={showCurrent}>
              {showCurrent ? 'Hide' : 'Show'}
            </Button>
          </div>
        </Field>
        <Field label="New password (min 8 characters)">
          <div className="row" style={{ gap: '0.5rem' }}>
            <input
              className="input"
              style={{ flex: 1 }}
              type={showNext ? 'text' : 'password'}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
            <Button type="button" variant="ghost" small onClick={() => setShowNext((s) => !s)} aria-pressed={showNext}>
              {showNext ? 'Hide' : 'Show'}
            </Button>
          </div>
          {tooShort && <p className="field-warning">New password must be at least 8 characters.</p>}
          {sameAsCurrent && <p className="field-warning">New password must differ from the current one.</p>}
        </Field>
        <Field label="Confirm new password">
          <input
            className="input"
            type={showNext ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
          {mismatch && <p className="field-warning">Passwords do not match.</p>}
        </Field>
        <Button type="submit" variant="primary" small disabled={busy || !valid}>
          {busy ? 'Changing…' : 'Change password'}
        </Button>
      </form>
    </div>
  );
}
