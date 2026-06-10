import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { DomainValues } from '../schemas'
import { domainSchema } from '../schemas'
import { FieldError } from '../FieldError'

interface Props {
  defaults: Partial<DomainValues>
  onNext: (v: DomainValues) => void
  onBack: () => void
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
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <h2 className="text-xl font-semibold">{t('wizard.domain.title')}</h2>
      <form.Field
        name="serverHostname"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor={field.name}>{t('wizard.domain.hostname')}</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={t('wizard.domain.hostnameHint')}
            />
            <FieldError field={field} />
          </div>
        )}
      />
      <form.Field
        name="defaultDomain"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor={field.name}>{t('wizard.domain.domain')}</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={t('wizard.domain.domainHint')}
            />
            <FieldError field={field} />
          </div>
        )}
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
