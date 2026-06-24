// Stalmail wizard — admin account step: collect name+password (merged from the
// former AdminAccountStep) then execute createAccount. The weak-password retry
// loop ({status:'weak'}) is kept distinct from SetupErrorBox (server rejections).
import { useEffect, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import type { CreateAccountResult } from "@/server/setup-actions"
import type { AdminAccountValues } from "../schemas"
import { adminAccountSchema } from "../schemas"
import { scorePassword } from "../password-strength"
import {
  Alert,
  Field,
  PasswordInput,
  Spinner,
  StepHeader,
  StepNav,
  TextInput,
} from "../ui/primitives"
import { StrengthMeter } from "../ui/StrengthMeter"
import { SetupErrorBox } from "../ui/SetupErrorBox"
import { IconCheck } from "../ui/icons"
import { codeFromError, messageKeyForCode } from "../error-code"

type Phase = "form" | "creating" | "weak" | "done" | "error"

interface Props {
  domain: string
  createAccount: (input: {
    name: string
    password: string
  }) => Promise<CreateAccountResult>
  onNext: () => void
}

export function AccountStep({ domain, createAccount, onNext }: Props) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>("form")
  const [name, setName] = useState("")
  const [errorCode, setErrorCode] = useState("")

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const email = `${name || "marie"}@${domain}`

  const form = useForm({
    defaultValues: { name: "", password: "" },
    validators: { onSubmit: adminAccountSchema },
    onSubmit: async ({ value }: { value: AdminAccountValues }) => {
      setName(value.name)
      await run(value.name, value.password)
    },
  })

  // Execute createAccount. weak → weak retry loop ; server rejection → SetupErrorBox.
  // Returns a Promise so onSubmit can be async and form.state.isSubmitting stays true
  // while the call is in flight (prevents double-submit via the busy StepNav prop).
  const run = (n: string, password: string): Promise<void> => {
    setPhase("creating")
    setErrorCode("")
    return createAccount({ name: n, password })
      .then((result) => {
        if (!mountedRef.current) return
        setPhase(result.status === "ok" ? "done" : "weak")
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return
        setErrorCode(codeFromError(e))
        setPhase("error")
      })
  }

  // -------- weak-password retry (distinct from SetupErrorBox) --------
  const [newPass, setNewPass] = useState("")
  const [touched, setTouched] = useState(false)
  const doRetry = () => {
    setTouched(true)
    if (newPass.length < 8) return
    run(name, newPass)
  }

  if (phase === "form") {
    return (
      <form
        className="step-body"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <StepHeader
          title={t("wizard.account.title")}
          sub={t("wizard.account.subtitle")}
        />
        <form.Field
          name="name"
          children={(field) => {
            const firstError = (
              field.state.meta.errors[0] as { message?: string } | undefined
            )?.message
            const nameError = field.state.meta.isValid
              ? undefined
              : firstError === "reserved-admin"
                ? t("wizard.account.reservedName")
                : t("wizard.account.invalidName")
            return (
              <Field
                label={t("wizard.account.name")}
                htmlFor={field.name}
                help={t("wizard.account.email", {
                  email: `${field.state.value.trim() || "marie"}@${domain}`,
                })}
                error={nameError}
              >
                <TextInput
                  id={field.name}
                  value={field.state.value}
                  mono
                  autoFocus
                  placeholder={t("wizard.account.namePlaceholder")}
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
                label={t("wizard.account.password")}
                htmlFor={field.name}
                help={t("wizard.account.passwordHelp")}
                error={
                  !field.state.meta.isValid
                    ? t("wizard.account.invalidPassword")
                    : undefined
                }
              >
                <PasswordInput
                  id={field.name}
                  value={field.state.value}
                  invalid={!field.state.meta.isValid}
                  showLabel={t("wizard.account.show")}
                  hideLabel={t("wizard.account.hide")}
                  onChange={(v) => field.handleChange(v)}
                  onEnter={() => void form.handleSubmit()}
                />
              </Field>
              <StrengthMeter
                password={field.state.value}
                label={t(
                  `wizard.account.strength.${scorePassword(field.state.value)}`
                )}
              />
            </>
          )}
        />
        <StepNav
          onNext={() => void form.handleSubmit()}
          nextLabel={t("wizard.common.next")}
          backLabel={t("wizard.common.back")}
          busy={form.state.isSubmitting}
        />
      </form>
    )
  }

  return (
    <div className="step-body">
      <StepHeader title={t("wizard.account.title")} />

      {phase === "creating" ? (
        <p className="inline-status">
          <Spinner size={14} />
          {t("wizard.account.monitor.creating", { email })}
        </p>
      ) : null}

      {phase === "weak" ? (
        <>
          <Alert
            variant="destructive"
            title={t("wizard.account.monitor.weakTitle")}
          >
            {t("wizard.account.monitor.weak")}
          </Alert>
          <Field
            label={t("wizard.account.monitor.newPassword")}
            htmlFor="f-newpass"
            error={
              touched && newPass.length < 8
                ? t("wizard.account.invalidPassword")
                : undefined
            }
          >
            <PasswordInput
              id="f-newpass"
              value={newPass}
              invalid={touched && newPass.length < 8}
              showLabel={t("wizard.account.show")}
              hideLabel={t("wizard.account.hide")}
              onChange={setNewPass}
              onEnter={doRetry}
            />
          </Field>
          <StrengthMeter
            password={newPass}
            label={t(`wizard.account.strength.${scorePassword(newPass)}`)}
          />
          <StepNav
            onNext={doRetry}
            nextLabel={t("wizard.account.monitor.retry")}
            backLabel={t("wizard.common.back")}
          />
        </>
      ) : null}

      {phase === "error" ? (
        <SetupErrorBox
          code={errorCode}
          messageKey={messageKeyForCode(errorCode)}
          onRetry={() => setPhase("form")}
        />
      ) : null}

      {phase === "done" ? (
        <>
          <p className="inline-status inline-status-ok">
            <IconCheck size={15} />
            {t("wizard.account.monitor.done", { email })}
          </p>
          <StepNav
            onNext={onNext}
            nextLabel={t("wizard.common.next")}
            backLabel={t("wizard.common.back")}
          />
        </>
      ) : null}
    </div>
  )
}
