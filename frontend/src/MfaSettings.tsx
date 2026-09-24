import React, { useEffect, useState } from 'react';
import { Button, ErrorBox } from './components/ui';
import { apiUrl } from './api';

/**
 * Self-contained two-factor settings card: enrol via QR, verify with a
 * 6-digit code, backup codes shown once, disable with password confirm.
 */
export default function MfaSettings({ token }: { token: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/auth/mfa/status'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setEnabled((await res.json()).enabled);
    } catch {
      // Settings card is best-effort; the queue below is unaffected.
    }
  }, [token]);

  useEffect(() => {
    // Status fetch runs in a promise callback, never the effect body.
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const startSetup = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl('/auth/mfa/setup'), { method: 'POST', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Setup failed.');
      setQr(data.qrDataUrl);
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup failed.');
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl('/auth/mfa/verify'), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Invalid code.');
      setBackupCodes(data.backupCodes);
      setQr(null);
      setEnabled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl('/auth/mfa/disable'), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Could not disable.');
      setEnabled(false);
      setConfirmingDisable(false);
      setPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disable.');
    } finally {
      setBusy(false);
    }
  };

  if (enabled === null) return null;

  return (
    <div className="card mfa-card">
      <h3 className="card-title">Two-factor authentication</h3>
      {error && (
        <div className="mfa-error">
          <ErrorBox message={error} />
        </div>
      )}

      {!enabled && !qr && !backupCodes && (
        <div className="row mfa-status">
          <span className="muted mfa-copy">
            Status: <strong>off</strong> — add an authenticator app for stronger sign-in.
          </span>
          <Button variant="ghost" small onClick={startSetup} disabled={busy}>
            Enable
          </Button>
        </div>
      )}

      {!enabled && qr && (
        <div className="mfa-setup">
          <p className="muted mfa-copy">
            1. Scan this QR code with your authenticator app (Google/Microsoft Authenticator, 1Password…),
            then 2. enter the 6-digit code below.
          </p>
          <img className="mfa-qr" src={qr} alt="Authenticator QR code" />
          <div className="row mfa-code-row">
            <input
              className="input mfa-code-input"
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
            />
            <Button variant="primary" small onClick={confirmSetup} disabled={busy}>
              Verify &amp; enable
            </Button>
          </div>
        </div>
      )}

      {backupCodes && (
        <div className="note-info mt-sm">
          <strong>Save these backup codes now</strong> — each works once if you lose your phone:
          <div className="backup-codes">
            {backupCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="mt-sm">
            <Button variant="ghost" small onClick={() => setBackupCodes(null)}>
              Saved, hide them
            </Button>
          </div>
        </div>
      )}

      {enabled && !backupCodes && (
        <div className="row mfa-status">
          <span className="muted mfa-copy">
            Status: <strong>on</strong> — sign-in asks for your authenticator code.
          </span>
          {!confirmingDisable ? (
            <Button variant="ghost" small onClick={() => setConfirmingDisable(true)}>
              Disable
            </Button>
          ) : (
            <>
              <input
                className="input mfa-code-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Confirm with your password"
              />
              <Button variant="danger" small onClick={disable} disabled={busy}>
                Confirm disable
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
