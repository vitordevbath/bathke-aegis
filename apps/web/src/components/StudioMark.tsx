const STUDIO_URL = 'https://bathkestudio.com.br/';

/**
 * Authorship mark of Bathke Studio. `floating`: a faint watermark pinned to the corner (public site,
 * sign-in); otherwise an in-flow credit at the end of the panel, so it never covers content.
 */
export function StudioMark({ floating = false }: { readonly floating?: boolean }) {
  return (
    <a className={`studio-mark${floating ? ' studio-mark--floating' : ''}`} href={STUDIO_URL} target="_blank" rel="noopener noreferrer">
      <span className="studio-mark__by">feito por</span> <span className="studio-mark__name">Bathke Studio</span>
    </a>
  );
}
