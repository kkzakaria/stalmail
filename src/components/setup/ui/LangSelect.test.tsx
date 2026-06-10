import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n, LANG_COOKIE } from '@/i18n/i18n'
import { LangSelect } from './LangSelect'

function wrap(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)
}

describe('LangSelect', () => {
  beforeEach(() => {
    // Clear the cookie so an earlier case can't make the assertion pass spuriously.
    document.cookie = `${LANG_COOKIE}=; path=/; max-age=0`
  })

  it('lists all supported language option labels', () => {
    wrap(<LangSelect />)
    const select = screen.getByRole('combobox')
    const options = Array.from(select.querySelectorAll('option'))
    const texts = options.map((o) => o.textContent)
    expect(texts).toContain('Français')
    expect(texts).toContain('English')
  })

  it('calls i18n.changeLanguage when selection changes', () => {
    const i18n = createI18n('fr')
    const spy = vi.spyOn(i18n, 'changeLanguage')
    render(
      <I18nextProvider i18n={i18n}>
        <LangSelect />
      </I18nextProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } })
    expect(spy).toHaveBeenCalledWith('en')
  })

  it('writes the lang cookie on change', () => {
    wrap(<LangSelect />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } })
    expect(document.cookie).toContain(`${LANG_COOKIE}=en`)
  })
})
