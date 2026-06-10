import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { DNS_PROVIDERS } from '@/server/stalwart-dns'
import type { DnsProvider } from '@/server/stalwart-dns'
import type { DnsProviderValues } from '../schemas'
import { dnsProviderSchema } from '../schemas'
import { Alert, Field, StepHeader, StepNav, TextInput } from '../ui/primitives'
import { Combobox } from '../ui/Combobox'

interface Props {
  defaults: Partial<DnsProviderValues> & { defaultDomain?: string }
  onNext: (v: DnsProviderValues) => void
  onBack: () => void
}

const PROVIDER_OPTIONS = DNS_PROVIDERS.filter((p) => p !== 'Manual')

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
      className="step-body"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <StepHeader
        title={t('wizard.dns.title')}
        sub={t('wizard.dns.subtitle')}
      />

      <form.Field
        name="provider"
        children={(field) => (
          <Field
            label={t('wizard.dns.provider')}
            htmlFor={field.name}
            error={
              !field.state.meta.isValid ? t('wizard.dns.required') : undefined
            }
          >
            <Combobox
              id={field.name}
              value={field.state.value}
              invalid={!field.state.meta.isValid}
              options={PROVIDER_OPTIONS}
              stickyOption={{
                value: 'Manual',
                label: t('wizard.dns.manual'),
                hint: t('wizard.dns.manualHint'),
              }}
              placeholder={t('wizard.dns.placeholder')}
              searchPlaceholder={t('wizard.dns.search')}
              emptyText={t('wizard.dns.empty')}
              onChange={(v) => {
                field.handleChange(v as DnsProvider)
                form.setFieldValue('secret', '')
              }}
            />
          </Field>
        )}
      />

      <form.Subscribe
        selector={(s) => s.values.provider}
        children={(provider) =>
          provider !== 'Manual' ? (
            <form.Field
              name="secret"
              children={(field) => (
                <Field
                  label={t('wizard.dns.secret')}
                  htmlFor={field.name}
                  help={t('wizard.dns.secretHelp', {
                    domain: defaults.defaultDomain ?? '',
                  })}
                  error={
                    !field.state.meta.isValid
                      ? t('wizard.dns.secretRequired')
                      : undefined
                  }
                >
                  <TextInput
                    id={field.name}
                    type="password"
                    mono
                    value={field.state.value}
                    invalid={!field.state.meta.isValid}
                    onChange={(v) => field.handleChange(v)}
                  />
                </Field>
              )}
            />
          ) : (
            <Alert variant="info">{t('wizard.dns.manualNote')}</Alert>
          )
        }
      />

      <StepNav
        onBack={onBack}
        onNext={() => void form.handleSubmit()}
        backLabel={t('wizard.common.back')}
        nextLabel={t('wizard.common.next')}
      />
    </form>
  )
}
