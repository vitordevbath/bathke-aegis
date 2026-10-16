import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="center-page">
      <h1 className="title">404</h1>
      <p className="muted">This page does not exist.</p>
      <Link className="button" to="/">
        Back
      </Link>
    </main>
  );
}
