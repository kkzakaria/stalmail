import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useLoaderData: () => ({ theme: 'light' }) }),
  useRouter: () => ({ navigate }),
}))
vi.mock('@/server/auth-actions', () => ({ loginFn: vi.fn() }))

// eslint-disable-next-line import/first
import { loginFn } from '@/server/auth-actions'
// eslint-disable-next-line import/first
import { LoginPage } from './login'

const wrap = () =>
  render(
    <I18nextProvider i18n={createI18n('fr')}>
      <LoginPage />
    </I18nextProvider>,
  )

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

describe('LoginPage', () => {
  it('navigates to the inbox after a successful login', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(loginFn).mockResolvedValue({ status: 'ok' })
    wrap()
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@x.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    // wait for the async submit to settle (loginFn resolves, setSuccess fires)
    await waitFor(() => expect(screen.getByRole('button', { name: /Connecté/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Connecté — ouverture du webmail/i })).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(navigate).toHaveBeenCalledWith({ to: '/mail/$folder', params: { folder: 'inbox' } })
    expect(loginFn).toHaveBeenCalledWith({ data: { email: 'a@x.fr', password: 'pw' } })
  })

  it('shows the invalid-credentials error', async () => {
    vi.mocked(loginFn).mockResolvedValue({ status: 'invalid' })
    wrap()
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@x.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('invalide')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('shows the 2FA-not-supported message on mfa', async () => {
    vi.mocked(loginFn).mockResolvedValue({ status: 'mfa' })
    wrap()
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@x.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('deux facteurs')
  })

  it('shows the rate-limited message', async () => {
    vi.mocked(loginFn).mockResolvedValue({ status: 'rateLimited' })
    wrap()
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@x.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives')
  })

  it('shows the generic error on network failure', async () => {
    vi.mocked(loginFn).mockRejectedValue(new Error('network'))
    wrap()
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@x.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('blocks submission and shows field error when email format is invalid', async () => {
    wrap()
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'not-an-email' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByText(/invalide/i)).toBeInTheDocument()
    expect(loginFn).not.toHaveBeenCalled()
  })

  it('blocks submission and shows field error when password is empty', async () => {
    wrap()
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@x.fr' } })
    // leave password empty
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByText(/requis/i)).toBeInTheDocument()
    expect(loginFn).not.toHaveBeenCalled()
  })

  it('renders email input with autocomplete="username" and password input with autocomplete="current-password"', () => {
    wrap()
    const emailInput = screen.getByLabelText('Adresse e-mail')
    const passwordInput = screen.getByLabelText('Mot de passe')
    expect(emailInput).toHaveAttribute('autocomplete', 'username')
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password')
  })
})
