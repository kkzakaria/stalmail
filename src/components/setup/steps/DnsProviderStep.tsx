import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DNS_PROVIDERS } from '@/server/stalwart-dns'
import type { DnsProvider } from '@/server/stalwart-dns'
import type { DnsProviderValues } from '../schemas'
import { dnsProviderSchema } from '../schemas'

interface Props {
  defaults: Partial<DnsProviderValues>
  onNext: (v: DnsProviderValues) => void
  onBack: () => void
}

export function DnsProviderStep({ defaults, onNext, onBack }: Props) {
  const { t } = useTranslation()
  const form = useForm({
    defaultValues: {
      provider: defaults.provider ?? 'Manual',
      secret: defaults.secret ?? '',
    },
    validators: { onSubmit: dnsProviderSchema },
    onSubmit: ({ value }) => onNext(value),
  })

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <h2 className="text-xl font-semibold">{t('wizard.dns.title')}</h2>
      <form.Field
        name="provider"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor={field.name}>{t('wizard.dns.provider')}</Label>
            <select
              id={field.name}
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value as DnsProvider)}
            >
              <option value="Manual">{t('wizard.dns.manual')}</option>
              {DNS_PROVIDERS.filter((p) => p !== 'Manual').map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        )}
      />
      <form.Subscribe
        selector={(s) => s.values.provider}
        children={(provider) =>
          provider !== 'Manual' ? (
            <form.Field
              name="secret"
              children={(field) => (
                <div className="space-y-1">
                  <Label htmlFor={field.name}>{t('wizard.dns.secret')}</Label>
                  <Input
                    id={field.name}
                    type="password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">{t('wizard.dns.secretHint')}</p>
                  {!field.state.meta.isValid && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors
                        .map((e) => (e as { message?: string }).message ?? String(e))
                        .join(', ')}
                    </p>
                  )}
                </div>
              )}
            />
          ) : null
        }
      />
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('wizard.nav.back')}
        </Button>
        <Button type="submit">{t('wizard.nav.next')}</Button>
      </div>
    </form>
  )
}
