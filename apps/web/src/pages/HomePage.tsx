import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { useAuth } from '../features/auth/AuthContext';
import { LandingNav } from '../features/landing/LandingNav';
import { NotCollected } from '../features/landing/NotCollected';
import { Pipeline } from '../features/landing/Pipeline';
import { ProductPreview } from '../features/landing/ProductPreview';
import { SignalField } from '../features/landing/SignalField';
import '../styles/landing.css';

const REPOSITORY = 'https://github.com/vitordevbath/bathke-aegis';

const WORKS_TODAY = [
  'Contas, workspaces e papéis, com isolamento entre workspaces',
  'Hosts, regras de detecção, incidentes e investigações',
  'Pareamento de máquinas com credenciais rotacionáveis e revogáveis',
  'Collector em Rust com heartbeat, eventos de sistema e fila persistente',
  'Linha do tempo de eventos imutável, com ingestão idempotente',
] as const;

const IN_PROGRESS = [
  'Eventos de processo e de rede via eBPF',
  'Motor que executa as regras sobre os eventos',
  'Alertas e correlação automática de incidentes',
  'Workspace de demonstração para avaliação sem instalar nada',
] as const;

/** Fraction of the hero scrolled away, shared with the WebGL field without re-rendering React. */
function useHeroScroll() {
  const scroll = useRef(0);
  useEffect(() => {
    const update = () => {
      scroll.current = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight || 1)));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return scroll;
}

/** Public site: what Aegis is, how data reaches it, what it never collects and what is still being built. */
export function HomePage() {
  const { status } = useAuth();
  const authenticated = status === 'authenticated';
  const heroScroll = useHeroScroll();

  return (
    <div className="lp">
      <a className="lp-skip" href="#conteudo">
        Pular para o conteúdo
      </a>
      <LandingNav authenticated={authenticated} />

      <section className="lp-hero" aria-labelledby="lp-title">
        <SignalField scroll={heroScroll} />
        <div className="lp-hero__inner">
          <h1 id="lp-title" className="lp-display">
            <span className="lp-line">
              <span>Segurança que você consegue auditar.</span>
            </span>
            <span className="lp-line lp-line--quiet">
              <span>Do primeiro evento à investigação.</span>
            </span>
          </h1>
          <p className="lp-lede">
            O Aegis recebe eventos de sistema dos hosts Linux que você autorizou, monta a linha do tempo e acompanha cada incidente até a investigação. Sem ler
            arquivos, mensagens ou linhas de comando.
          </p>
          <div className="lp-cta">
            {authenticated ? (
              <Link to="/dashboard" className="lp-button lp-button--solid lp-button--lg">
                Abrir o painel
              </Link>
            ) : (
              <>
                <Link to="/cadastro" className="lp-button lp-button--solid lp-button--lg">
                  Criar conta
                </Link>
                <a href="#como-funciona" className="lp-button lp-button--ghost lp-button--lg">
                  Ver como funciona
                </a>
              </>
            )}
          </div>
        </div>
      </section>

      <main id="conteudo" className="lp-main">
        <section className="lp-section lp-section--preview" aria-label="Prévia do painel">
          <ProductPreview />
        </section>

        <section id="como-funciona" className="lp-section" aria-labelledby="lp-how">
          <header className="lp-section__head">
            <h2 id="lp-how" className="lp-heading">
              Da máquina ao painel, em quatro passos.
            </h2>
            <p className="lp-copy">Cada parte é pequena, verificável e documentada. Nenhuma depende de acesso de administrador no host.</p>
          </header>
          <Pipeline />
        </section>

        <section id="privacidade" className="lp-section lp-section--privacy" aria-labelledby="lp-privacy">
          <header className="lp-section__head">
            <h2 id="lp-privacy" className="lp-heading">
              O que o Aegis não coleta.
            </h2>
            <p className="lp-copy">
              Não é uma opção desligada nas configurações. O contrato de eventos não tem campo para nada disso, e a API recusa qualquer lote que tente enviar.
            </p>
          </header>
          <NotCollected />
        </section>

        <section id="estado" className="lp-section" aria-labelledby="lp-status">
          <header className="lp-section__head">
            <h2 id="lp-status" className="lp-heading">
              O que funciona hoje, e o que ainda não.
            </h2>
            <p className="lp-copy">
              O Aegis é um projeto acadêmico de Engenharia de Software, com código aberto. Esta página só descreve como pronto o que está implementado e
              testado.
            </p>
          </header>
          <div className="lp-status">
            <div className="lp-status__col">
              <h3 className="lp-status__title">Funciona hoje</h3>
              <ul className="lp-status__list lp-status__list--done">
                {WORKS_TODAY.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="lp-status__col">
              <h3 className="lp-status__title">Em construção</h3>
              <ul className="lp-status__list lp-status__list--next">
                {IN_PROGRESS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="lp-section lp-closing" aria-labelledby="lp-closing">
          <h2 id="lp-closing" className="lp-heading">
            Comece por uma máquina de laboratório.
          </h2>
          <p className="lp-copy">Crie uma conta, cadastre um host e pareie o Collector em poucos minutos. Você pode revogar o acesso quando quiser.</p>
          <div className="lp-cta">
            <Link to={authenticated ? '/dashboard' : '/cadastro'} className="lp-button lp-button--solid lp-button--lg">
              {authenticated ? 'Abrir o painel' : 'Criar conta'}
            </Link>
            <a href={REPOSITORY} className="lp-button lp-button--ghost lp-button--lg" rel="noreferrer" target="_blank">
              Código no GitHub
            </a>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <Brand />
        <p>Plataforma experimental de segurança defensiva. Use apenas em máquinas próprias ou explicitamente autorizadas.</p>
      </footer>
    </div>
  );
}
