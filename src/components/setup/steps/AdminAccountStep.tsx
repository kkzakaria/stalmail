import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AdminAccountValues } from '../schemas'
import { adminAccountSchema } from '../schemas'
import { scorePassword } from '../password-strength'
import { FieldError } from '../FieldError'

interface Props {
  defaults: Partial<AdminAccountValues>
  domain: string
  onNext: (v: AdminAccountValues) => void
  onBack: () => void
}

export function AdminAccountStep({ defaults, domain, onNext, onBack }: Props) {
  const { t } = useTranslation()
  const form = useForm({
    defaultValues: { name: defaults.name ?? '', password: defaults.password ?? '' },
    validators: { onSubmit: adminAccountSchema },
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
      <h2 className="text-xl font-semibold">{t('wizard.account.title')}</h2>
      <form.Field
        name="name"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor={field.name}>{t('wizard.account.name')}</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            <p className="text-muted-foreground text-sm">
              {t('wizard.account.email')}:{' '}
              <span>{`${field.state.value.trim() || 'admin'}@${domain}`}</span>
            </p>
            <FieldError field={field} />
          </div>
        )}
      />
      <form.Field
        name="password"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor={field.name}>{t('wizard.account.password')}</Label>
            <Input
              id={field.name}
              type="password"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.value && (
              <p className="text-sm">{t(`wizard.account.strength.${scorePassword(field.state.value)}`)}</p>
            )}
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
