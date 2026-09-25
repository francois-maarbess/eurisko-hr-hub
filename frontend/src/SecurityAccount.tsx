import { useState } from 'react';
import { Alert, Button } from './components/ui';

interface SecurityAccountProps {
  name: string;
  email: string;
  platformRole: string;
  onSignOutEverywhere: () => void;
}

/**
 * Account summary + session safety. Sign-out everywhere revokes every
 * refresh token (POST /auth/logout) and returns to the login screen.
 */
export default function SecurityAccount({ name, email, platformRole, onSignOutEverywhere }: SecurityAccountProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="card">
      <h3 className="card-title">Account</h3>
      <p className="card-sub">Signed in as <strong>{name}</strong> ({email}) · {platformRole}</p>
      <div className="ticket-subsurface">
        <div style={{ fontSize: '0.85rem' }}>
          <strong>Session safety:</strong> use a unique password, keep two-factor on, and sign out everywhere
          if you used a shared machine.
        </div>
      </div>
      {!confirming ? (
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <Button variant="ghost" small onClick={() => setConfirming(true)}>
            Sign out everywhere…
          </Button>
        </div>
      ) : (
        <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
          <Alert tone="warn">This revokes all refresh tokens — every device signs out, including this one.</Alert>
          <div className="row">
            <Button variant="danger" small onClick={onSignOutEverywhere}>
              Sign out everywhere
            </Button>
            <Button variant="ghost" small onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
