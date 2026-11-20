import { Link, useRouteError } from 'react-router-dom';

/**
 * Shown when a screen fails to load or render: a way forward instead of the router's developer
 * message. The error itself goes to the console only; the page never shows internals.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  console.error(error);
  return (
    <main className="center-page">
      <h1 className="title">Esta tela não carregou</h1>
      <p className="muted">Pode ser uma versão nova do Aegis publicada enquanto a página estava aberta. Recarregar costuma resolver.</p>
      <div className="actions">
        <button type="button" className="button" onClick={() => window.location.reload()}>
          Recarregar
        </button>
        <Link className="button button--ghost" to="/">
          Ir para o início
        </Link>
      </div>
    </main>
  );
}
