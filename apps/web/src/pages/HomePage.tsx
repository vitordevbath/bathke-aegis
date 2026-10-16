import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';

export function HomePage() {
  return (
    <main className="center-page">
      <Brand />
      <h1 className="title">Experimental XDR / SIEM Platform</h1>
      <p className="muted">Security telemetry, detection and investigation platform.</p>
      <div className="actions">
        <Link className="button button--primary" to="/login">
          Sign in
        </Link>
        <Link className="button" to="/dashboard">
          Dashboard
        </Link>
      </div>
    </main>
  );
}
