import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="center-page">
      <h1 className="title">404</h1>
      <p className="muted">Esta página não existe.</p>
      <Link className="button" to="/">
        Voltar
      </Link>
    </main>
  );
}
