import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import type { AdminAccountValues } from '../schemas'
import { adminAccountSchema } from '../schemas'
import { scorePassword } from '../password-strength'
import { Field, PasswordInput, StepHeader, StepNav, TextInput } from '../ui/primitives'
import { StrengthMeter } from '../ui/StrengthMeter'

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
    <div className="step-body">
      <StepHeader
        title={t('wizard.account.title')}
        sub={t('wizard.account.subtitle')}
      />
      <form.Field
        name="name"
        children={(field) => {
          const firstError = (
            field.state.meta.errors[0] as { message?: string } | undefined
          )?.message
          const nameError = field.state.meta.isValid
            ? undefined
            : firstError === 'reserved-admin'
              ? t('wizard.account.reservedName')
              : t('wizard.account.invalidName')
          return (
            <Field
              label={t('wizard.account.name')}
              htmlFor={field.name}
              help={t('wizard.account.email', {
                email: `${field.state.value.trim() || 'marie'}@${domain}`,
              })}
              error={nameError}
            >
              <TextInput
                id={field.name}
                value={field.state.value}
                mono
                autoFocus
                placeholder={t('wizard.account.namePlaceholder')}
                invalid={!field.state.meta.isValid}
                onChange={(v) => field.handleChange(v)}
                onEnter={() => void form.handleSubmit()}
              />
            </Field>
          )
        }}
      />
      <form.Field
        name="password"
        children={(field) => (
          <>
            <Field
              label={t('wizard.account.password')}
              htmlFor={field.name}
              help={t('wizard.account.passwordHelp')}
              error={
                !field.state.meta.isValid
                  ? t('wizard.account.invalidPassword')
                  : undefined
              }
            >
              <PasswordInput
                id={field.name}
                value={field.state.value}
                invalid={!field.state.meta.isValid}
                showLabel={t('wizard.account.show')}
                hideLabel={t('wizard.account.hide')}
                onChange={(v) => field.handleChange(v)}
                onEnter={() => void form.handleSubmit()}
              />
            </Field>
            <StrengthMeter
              password={field.state.value}
              label={t(`wizard.account.strength.${scorePassword(field.state.value)}`)}
            />
          </>
        )}
      />
      <StepNav
        onBack={onBack}
        onNext={() => void form.handleSubmit()}
        backLabel={t('wizard.common.back')}
        nextLabel={t('wizard.common.next')}
      />
    </div>
  )
}
