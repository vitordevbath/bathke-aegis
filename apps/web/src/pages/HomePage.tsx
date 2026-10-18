import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { useAuth } from '../features/auth/AuthContext';

export function HomePage() {
  const { status } = useAuth();

  return (
    <main className="center-page">
      <Brand />
      <h1 className="title">Plataforma experimental de XDR / SIEM</h1>
      <p className="muted">Telemetria de segurança, detecção e investigação.</p>
      <div className="actions">
        {status === 'authenticated' ? (
          <Link className="button button--primary" to="/dashboard">
            Ir para o painel
          </Link>
        ) : (
          <>
            <Link className="button button--primary" to="/login">
              Entrar
            </Link>
            <Link className="button" to="/cadastro">
              Criar conta
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
