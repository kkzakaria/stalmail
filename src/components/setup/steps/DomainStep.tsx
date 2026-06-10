import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import type { DomainValues } from '../schemas'
import { domainSchema } from '../schemas'
import { Alert, Field, StepHeader, StepNav, TextInput } from '../ui/primitives'

interface Props {
  defaults: Partial<DomainValues>
  onNext: (v: DomainValues) => void
  onBack: () => void
}

// Le nom d'hôte est-il hors de la zone du domaine par défaut ? (ex. mail.autre.fr vs dupont.fr)
function isExternalHost(hostname: string, domain: string): boolean {
  if (!hostname || !domain) return false
  return hostname !== domain && !hostname.endsWith('.' + domain)
}

function hostZone(hostname: string): string {
  const parts = (hostname || '').split('.')
  return parts.length > 2 ? parts.slice(1).join('.') : hostname
}

export function DomainStep({ defaults, onNext, onBack }: Props) {
  const { t } = useTranslation()
  const form = useForm({
    defaultValues: {
      serverHostname: defaults.serverHostname ?? '',
      defaultDomain: defaults.defaultDomain ?? '',
    },
    validators: { onSubmit: domainSchema },
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
        title={t('wizard.domain.title')}
        sub={t('wizard.domain.subtitle')}
      />

      <form.Field
        name="serverHostname"
        children={(field) => {
          const showError = field.state.meta.errors.length > 0
          return (
            <Field
              label={t('wizard.domain.hostname')}
              htmlFor={field.name}
              help={t('wizard.domain.hostnameHelp')}
              error={showError ? t('wizard.domain.invalidHostname') : undefined}
            >
              <TextInput
                id={field.name}
                value={field.state.value}
                mono
                autoFocus
                placeholder={t('wizard.domain.hostnamePlaceholder')}
                invalid={showError}
                onChange={(v) => field.handleChange(v.trim())}
                onEnter={() => void form.handleSubmit()}
              />
            </Field>
          )
        }}
      />

      <form.Field
        name="defaultDomain"
        children={(field) => {
          const showError = field.state.meta.errors.length > 0
          return (
            <Field
              label={t('wizard.domain.domain')}
              htmlFor={field.name}
              help={t('wizard.domain.domainHelp', {
                domain: field.state.value || 'exemple.fr',
              })}
              error={showError ? t('wizard.domain.invalidDomain') : undefined}
            >
              <TextInput
                id={field.name}
                value={field.state.value}
                mono
                placeholder={t('wizard.domain.domainPlaceholder')}
                invalid={showError}
                onChange={(v) => field.handleChange(v.trim())}
                onEnter={() => void form.handleSubmit()}
              />
            </Field>
          )
        }}
      />

      <form.Subscribe
        selector={(s) => s.values}
        children={(v) =>
          isExternalHost(v.serverHostname, v.defaultDomain) ? (
            <Alert variant="warning" title={t('wizard.domain.extTitle')}>
              {t('wizard.domain.ext', {
                host: v.serverHostname,
                zone: hostZone(v.serverHostname),
                domain: v.defaultDomain,
              })}
            </Alert>
          ) : null
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
