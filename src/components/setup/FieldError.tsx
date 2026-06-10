/** Renders a TanStack Form field's validation errors (zod issues), DRY across steps. */
export function FieldError({
  field,
}: {
  field: { state: { meta: { isValid: boolean; errors: unknown[] } } }
}) {
  if (field.state.meta.isValid) return null
  const message = field.state.meta.errors
    .map((e) => (e as { message?: string } | null)?.message ?? String(e))
    .join(', ')
  if (!message) return null
  return <p className="text-destructive text-sm">{message}</p>
}
