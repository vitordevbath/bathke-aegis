import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS, loadWithReload } from '../src/lib/chunk-recovery';
import { RouteErrorPage } from '../src/components/RouteErrorPage';

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const missingChunk = () => Promise.reject(new TypeError('error loading dynamically imported module'));

describe('loadWithReload', () => {
  it('returns the module when it loads', async () => {
    const reload = vi.fn();
    await expect(loadWithReload(() => Promise.resolve({ Page: 'ok' }), reload)).resolves.toEqual({ Page: 'ok' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the page once when a file from an older build is missing', async () => {
    const reload = vi.fn();
    const pending = loadWithReload(missingChunk, reload);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY))).toBeGreaterThan(0);
    // The router keeps waiting while the page goes away: no error screen flashes.
    const settled = await Promise.race([pending.then(() => 'settled'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 20))]);
    expect(settled).toBe('waiting');
  });

  it('does not loop: a second failure right after a reload reaches the error screen', async () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    const reload = vi.fn();
    await expect(loadWithReload(missingChunk, reload)).rejects.toThrow('dynamically imported module');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads again once the window has passed (a later deploy)', async () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now() - CHUNK_RELOAD_WINDOW_MS - 1));
    const reload = vi.fn();
    void loadWithReload(missingChunk, reload);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});

describe('RouteErrorPage', () => {
  it('offers a way forward instead of the router developer message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = createMemoryRouter(
      [
        {
          path: '/',
          errorElement: <RouteErrorPage />,
          loader: () => {
            throw new Error('detalhe interno que não pode aparecer');
          },
          element: <p>nunca</p>,
        },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'Esta tela não carregou' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir para o início' }).getAttribute('href')).toBe('/');
    expect(screen.queryByText(/detalhe interno/)).toBeNull();
    expect(screen.queryByText(/Hey developer/)).toBeNull();
  });
});
