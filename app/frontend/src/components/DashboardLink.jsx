import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, isConfigured, promptSignIn } from '../lib/auth.js';

// A link to /dashboard that asks signed-out visitors to sign in with Google
// first (same flow as Landing's old "Open the dashboard" button -- now built
// on this shared component instead of its own copy of this logic), then
// takes them there once sign-in completes. Signed-in visitors just navigate
// normally.
export default function DashboardLink({ children, ...props }) {
  const { signedIn } = useAuth();
  const navigate = useNavigate();
  const [wantsDashboard, setWantsDashboard] = React.useState(false);

  React.useEffect(() => {
    if (wantsDashboard && signedIn) navigate('/dashboard');
  }, [wantsDashboard, signedIn, navigate]);

  const onClick = (e) => {
    if (signedIn) return;
    e.preventDefault();
    setWantsDashboard(true);
    promptSignIn();
  };

  return (
    <Link
      to="/dashboard"
      onClick={onClick}
      title={signedIn || isConfigured() ? undefined : 'Google sign-in needs VITE_GOOGLE_CLIENT_ID set -- see .env.example'}
      {...props}
    >
      {children}
    </Link>
  );
}
