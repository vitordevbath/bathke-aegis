import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { FAKE_TOKEN, ME, mockApi, renderApp } from './render-app';

describe('public site', () => {
  it('invites a visitor to create an account and explains the product without the panel', async () => {
    mockApi({});
    renderApp('/');

    expect(await screen.findByRole('heading', { level: 1, name: /Segurança que você consegue auditar/ })).toBeTruthy();
    const sections = screen.getByRole('navigation', { name: 'Seções' });
    expect(
      within(sections)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['#como-funciona', '#privacidade', '#estado']);
    for (const id of ['como-funciona', 'privacidade', 'estado']) expect(document.getElementById(id)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Criar conta' })[0]?.getAttribute('href')).toBe('/cadastro');
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByRole('link', { name: 'Abrir o painel' })).toBeNull();
  });

  it('offers the panel to a signed-in visitor instead of sign-up', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);
    mockApi({ 'GET /api/users/me': () => ({ status: 200, body: ME }) });
    renderApp('/');

    expect((await screen.findAllByRole('link', { name: 'Abrir o painel' }))[0]?.getAttribute('href')).toBe('/dashboard');
    expect(screen.queryByRole('link', { name: 'Criar conta' })).toBeNull();
  });

  it('lists what is never collected and separates what works from what is planned', async () => {
    mockApi({});
    renderApp('/');

    const privacy = (await screen.findByRole('heading', { name: 'O que o Aegis não coleta.' })).closest('section') as HTMLElement;
    for (const item of ['Linhas de comando', 'Variáveis de ambiente', 'Conteúdo de arquivos', 'Mensagens', 'Senhas e tokens']) {
      expect(within(privacy).getByText(item)).toBeTruthy();
    }
    expect(within(privacy).getAllByText('Não coleta:').length).toBeGreaterThan(0);

    const status = screen.getByRole('heading', { name: /O que funciona hoje/ }).closest('section') as HTMLElement;
    const planned = within(status).getByRole('heading', { name: 'Em construção' }).parentElement as HTMLElement;
    expect(within(planned).getByText(/eBPF/)).toBeTruthy();
    expect(within(planned).getByText(/Motor que executa as regras/)).toBeTruthy();
    // The WebGL backdrop is decorative and absent without WebGL (jsdom): the page still reads in full.
    expect(document.querySelector('canvas.signal-field')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('walks the pairing-to-investigation flow as an ordered sequence', async () => {
    mockApi({});
    renderApp('/');

    const how = (await screen.findByRole('heading', { name: /Da máquina ao painel/ })).closest('section') as HTMLElement;
    expect(
      within(how)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Parear', 'Observar', 'Entregar', 'Investigar']);
    expect(within(how).getByText(/vale por 10 minutos/)).toBeTruthy();
    expect(within(how).getByText(/a cada 30 segundos/)).toBeTruthy();
    expect(within(how).getByText(/lotes de até 100/)).toBeTruthy();
  });
});
