import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { FAKE_TOKEN, ME, mockApi, renderApp, requestBody } from './render-app';

const signedIn = () => window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);

describe('protected routes', () => {
  it('sends anonymous visitors from /dashboard to /login', async () => {
    const fetchMock = mockApi({});
    const { router } = renderApp('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/users/me', expect.anything());
  });

  it('restores the session from localStorage via GET /users/me after a reload', async () => {
    signedIn();
    const fetchMock = mockApi({ 'GET /api/users/me': () => ({ status: 200, body: ME }) });
    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Olá, Ana' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Workspace de Ana Teste' })).toBeTruthy();
    expect(screen.getByText('Proprietário')).toBeTruthy();
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/users/me') ?? [];
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it('drops a rejected token and returns to /login without looping', async () => {
    signedIn();
    const fetchMock = mockApi({
      'GET /api/users/me': () => ({ status: 401, body: { error: { code: 'AUTHENTICATION_ERROR', message: 'Não autenticado.' } } }),
    });
    const { router } = renderApp('/perfil');

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/users/me')).toHaveLength(1);
  });
});

describe('login', () => {
  it('validates required fields and email format before calling the API', async () => {
    const fetchMock = mockApi({});
    const { user } = renderApp('/login');

    await user.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Informe seu email.')).toBeTruthy();
    expect(screen.getByText('Informe sua senha.')).toBeTruthy();

    await user.type(screen.getByLabelText('Email'), 'nao-e-email');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Informe um email válido.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/login', expect.anything());
  });

  it('stores the token under the central key and opens the dashboard', async () => {
    mockApi({ 'POST /api/auth/login': () => ({ status: 200, body: { ...ME, token: FAKE_TOKEN, tokenType: 'Bearer', expiresIn: 3600 } }) });
    const { user, router } = renderApp('/login');

    await user.type(await screen.findByLabelText('Email'), 'ANA.TESTE@EXAMPLE.TEST');
    await user.type(screen.getByLabelText('Senha'), 'Aegis-Test-Pass1');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('heading', { name: 'Olá, Ana' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/dashboard');
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe(FAKE_TOKEN);
  });

  it('shows the generic message on 401 and a friendly one on server failure, never internals', async () => {
    let status = 401;
    mockApi({
      'POST /api/auth/login': () =>
        status === 401
          ? { status, body: { error: { code: 'AUTHENTICATION_ERROR', message: 'Email ou senha inválidos.' } } }
          : { status, body: { error: { code: 'INTERNAL_ERROR', message: 'Erro interno.' } } },
    });
    const { user } = renderApp('/login');

    await user.type(await screen.findByLabelText('Email'), 'ana.teste@example.test');
    await user.type(screen.getByLabelText('Senha'), 'Wrong-Pass-123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Email ou senha inválidos.')).toBeTruthy();

    status = 500;
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Não foi possível entrar agora. Tente novamente.')).toBeTruthy();
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });
});

describe('registration', () => {
  const fill = async (user: ReturnType<typeof renderApp>['user'], values: Record<string, string>) => {
    for (const [label, value] of Object.entries(values)) await user.type(screen.getByLabelText(label), value);
  };

  it('rejects a weak password and an invalid CPF before calling the API', async () => {
    const fetchMock = mockApi({});
    const { user } = renderApp('/cadastro');
    await screen.findByRole('heading', { name: 'Criar conta' });

    await fill(user, { Nome: 'Ana Teste', Email: 'ana@example.test', CPF: '11111111111', Senha: 'fraca', 'Confirmar senha': 'outra' });
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText('Informe um CPF válido.')).toBeTruthy();
    expect(screen.getAllByText(/A senha deve ter entre 10 e 128 caracteres/).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/register', expect.anything());
  });

  it('flags a mismatched confirmation on the confirmation field', async () => {
    mockApi({});
    const { user } = renderApp('/cadastro');
    await screen.findByRole('heading', { name: 'Criar conta' });

    await fill(user, { Nome: 'Ana Teste', Email: 'ana@example.test', CPF: '12345678909', Senha: 'Aegis-Test-Pass1', 'Confirmar senha': 'Aegis-Test-Pass2' });
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText('As senhas não coincidem.')).toBeTruthy();
  });

  it('masks the CPF, submits normalized data and redirects to login without signing in', async () => {
    const fetchMock = mockApi({ 'POST /api/auth/register': () => ({ status: 201, body: ME }) });
    const { user, router } = renderApp('/cadastro');
    await screen.findByRole('heading', { name: 'Criar conta' });

    await fill(user, { Nome: 'Ana Teste', Email: 'Ana.Teste@Example.test', CPF: '12345678909', Senha: 'Aegis-Test-Pass1', 'Confirmar senha': 'Aegis-Test-Pass1' });
    expect((screen.getByLabelText('CPF') as HTMLInputElement).value).toBe('123.456.789-09');
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText('Conta criada com sucesso. Entre com seu email e senha.')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ana.teste@example.test');
    expect(requestBody(fetchMock, 'POST', '/api/auth/register')).toMatchObject({ email: 'ana.teste@example.test', cpf: '12345678909' });
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });

  it('shows a server conflict on the email field', async () => {
    mockApi({
      'POST /api/auth/register': () => ({
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'Este email já está cadastrado.', issues: [{ field: 'email', message: 'Este email já está cadastrado.' }] } },
      }),
    });
    const { user } = renderApp('/cadastro');
    await screen.findByRole('heading', { name: 'Criar conta' });

    await fill(user, { Nome: 'Ana Teste', Email: 'ana@example.test', CPF: '12345678909', Senha: 'Aegis-Test-Pass1', 'Confirmar senha': 'Aegis-Test-Pass1' });
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText('Este email já está cadastrado.')).toBeTruthy();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('profile', () => {
  it('shows the email as read-only and never sends it in the update', async () => {
    signedIn();
    const updated = { ...ME, user: { ...ME.user, name: 'Ana Atualizada' } };
    const fetchMock = mockApi({
      'GET /api/users/me': () => ({ status: 200, body: ME }),
      'PUT /api/users/me': () => ({ status: 200, body: updated }),
    });
    const { user } = renderApp('/perfil');

    const email = (await screen.findByLabelText('Email')) as HTMLInputElement;
    expect(email.value).toBe(ME.user.email);
    expect(email.readOnly).toBe(true);
    expect(email.disabled).toBe(true);
    expect((screen.getByLabelText('CPF') as HTMLInputElement).value).toBe('123.456.789-09');

    const name = screen.getByLabelText('Nome');
    await user.clear(name);
    await user.type(name, 'Ana Atualizada');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByText('Perfil atualizado.')).toBeTruthy();
    const body = requestBody(fetchMock, 'PUT', '/api/users/me') as Record<string, unknown>;
    expect(body).not.toHaveProperty('email');
    expect(body).toMatchObject({ name: 'Ana Atualizada', cpf: '123.456.789-09' });
    await waitFor(() => expect(screen.getAllByText('Ana Atualizada').length).toBeGreaterThan(0));
  });

  it('requires the current password and a matching confirmation to change the password', async () => {
    signedIn();
    const fetchMock = mockApi({ 'GET /api/users/me': () => ({ status: 200, body: ME }) });
    const { user } = renderApp('/perfil');

    await user.type(await screen.findByLabelText('Nova senha'), 'Aegis-New-Pass1');
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'Aegis-New-Pass2');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByText('Informe a senha atual.')).toBeTruthy();
    expect(screen.getByText('As senhas não coincidem.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/users/me', expect.objectContaining({ method: 'PUT' }));
  });
});

describe('logout', () => {
  it('removes the token, clears the session and returns to /login', async () => {
    signedIn();
    mockApi({ 'GET /api/users/me': () => ({ status: 200, body: ME }) });
    const { user, router } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });
});
