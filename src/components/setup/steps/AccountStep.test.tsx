import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import type { CreateAccountResult } from '@/server/setup-actions'
import { AccountStep } from './AccountStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

describe('AccountStep', () => {
  it('shows the done status on ok and calls onNext on Continue', async () => {
    const createAccount = vi
      .fn((_input: { name: string; password: string }): Promise<CreateAccountResult> =>
        Promise.resolve({ status: 'ok' }),
      )
    const onNext = vi.fn()
    wrap(
      <AccountStep
        name="koffi"
        password="originalPass1"
        domain="exemple.fr"
        createAccount={createAccount}
        onPasswordChange={vi.fn()}
        onNext={onNext}
      />,
    )

    expect(
      await screen.findByText('Compte koffi@exemple.fr créé.'),
    ).toBeInTheDocument()
    expect(createAccount).toHaveBeenCalledWith({
      name: 'koffi',
      password: 'originalPass1',
    })

    fireEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('handles the weak path: retry with a valid new password reaches done', async () => {
    const createAccount = vi
      .fn((_input: { name: string; password: string }): Promise<CreateAccountResult> =>
        Promise.resolve({ status: 'ok' }),
      )
      .mockResolvedValueOnce({ status: 'weak' })
      .mockResolvedValueOnce({ status: 'ok' })
    const onPasswordChange = vi.fn()
    wrap(
      <AccountStep
        name="koffi"
        password="weakpass"
        domain="exemple.fr"
        createAccount={createAccount}
        onPasswordChange={onPasswordChange}
        onNext={vi.fn()}
      />,
    )

    // Weak alert + new-password field appear.
    expect(
      await screen.findByText('Mot de passe refusé'),
    ).toBeInTheDocument()
    const input = screen.getByLabelText('Nouveau mot de passe')

    // Type a valid (>=8, different) new password and submit.
    fireEvent.change(input, { target: { value: 'BrandNewPass99' } })
    fireEvent.click(screen.getByRole('button', { name: /Créer le compte/ }))

    expect(
      await screen.findByText('Compte koffi@exemple.fr créé.'),
    ).toBeInTheDocument()
    expect(createAccount).toHaveBeenNthCalledWith(2, {
      name: 'koffi',
      password: 'BrandNewPass99',
    })
    expect(onPasswordChange).toHaveBeenCalledWith('BrandNewPass99')
  })

  it('shows the error alert when createAccount throws', async () => {
    const createAccount = vi
      .fn((_input: { name: string; password: string }): Promise<CreateAccountResult> =>
        Promise.reject(new Error('boom')),
      )
    wrap(
      <AccountStep
        name="koffi"
        password="originalPass1"
        domain="exemple.fr"
        createAccount={createAccount}
        onPasswordChange={vi.fn()}
        onNext={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument()
    })
    expect(screen.getByText('Une erreur est survenue')).toBeInTheDocument()
  })
})
