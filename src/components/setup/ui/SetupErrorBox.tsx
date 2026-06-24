import { useTranslation } from "react-i18next"

interface SetupErrorBoxProps {
  code: string
  messageKey: string
  onRetry: () => void
}

export function SetupErrorBox({
  code,
  messageKey,
  onRetry,
}: SetupErrorBoxProps) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-4"
    >
      <p className="font-medium text-destructive">{t(messageKey)}</p>
      <code className="block text-xs opacity-70 select-all">{code}</code>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded border border-destructive/40 px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
      >
        {t("wizard.common.retry")}
      </button>
    </div>
  )
}
