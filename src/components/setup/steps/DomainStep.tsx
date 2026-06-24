import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import type { DomainValues } from "../schemas"
import { domainSchema } from "../schemas"
import { Alert, Field, StepHeader, StepNav, TextInput } from "../ui/primitives"
import { SetupErrorBox } from "../ui/SetupErrorBox"
import { codeFromError, messageKeyForCode } from "../error-code"
import { isExternalHost, hostZone } from "../host-utils"

interface Props {
  defaults?: Partial<DomainValues>
  submitBootstrap: (v: DomainValues) => Promise<void>
  onRestart: () => void
}

export function DomainStep({ defaults, submitBootstrap, onRestart }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const form = useForm({
    defaultValues: {
      serverHostname: defaults?.serverHostname ?? "",
      defaultDomain: defaults?.defaultDomain ?? "",
    },
    validators: { onSubmit: domainSchema },
    onSubmit: async ({ value }) => {
      setBusy(true)
      setErrorCode(null)
      try {
        await submitBootstrap(value)
        onRestart()
      } catch (e) {
        setErrorCode(codeFromError(e))
        setBusy(false)
      }
    },
  })

  if (errorCode) {
    return (
      <div className="step-body">
        <StepHeader
          title={t("wizard.domain.title")}
          sub={t("wizard.domain.subtitle")}
        />
        <SetupErrorBox
          code={errorCode}
          messageKey={messageKeyForCode(errorCode)}
          onRetry={() => setErrorCode(null)}
        />
      </div>
    )
  }

  return (
    <form
      className="step-body"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <StepHeader
        title={t("wizard.domain.title")}
        sub={t("wizard.domain.subtitle")}
      />

      <form.Field
        name="serverHostname"
        children={(field) => {
          const showError = field.state.meta.errors.length > 0
          return (
            <Field
              label={t("wizard.domain.hostname")}
              htmlFor={field.name}
              help={t("wizard.domain.hostnameHelp")}
              error={showError ? t("wizard.domain.invalidHostname") : undefined}
            >
              <TextInput
                id={field.name}
                value={field.state.value}
                mono
                autoFocus
                placeholder={t("wizard.domain.hostnamePlaceholder")}
                invalid={showError}
                onChange={(v) => field.handleChange(v.trim())}
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
              label={t("wizard.domain.domain")}
              htmlFor={field.name}
              help={t("wizard.domain.domainHelp", {
                domain: field.state.value || "exemple.fr",
              })}
              error={showError ? t("wizard.domain.invalidDomain") : undefined}
            >
              <TextInput
                id={field.name}
                value={field.state.value}
                mono
                placeholder={t("wizard.domain.domainPlaceholder")}
                invalid={showError}
                onChange={(v) => field.handleChange(v.trim())}
              />
            </Field>
          )
        }}
      />

      <form.Subscribe
        selector={(s) => s.values}
        children={(v) =>
          isExternalHost(v.serverHostname, v.defaultDomain) ? (
            <Alert variant="warning" title={t("wizard.domain.extTitle")}>
              {t("wizard.domain.ext", {
                host: v.serverHostname,
                zone: hostZone(v.serverHostname),
                domain: v.defaultDomain,
              })}
            </Alert>
          ) : null
        }
      />

      <StepNav
        onNext={() => void form.handleSubmit()}
        nextLabel={t("wizard.common.next")}
        backLabel={t("wizard.common.back")}
        busy={busy}
      />
    </form>
  )
}
