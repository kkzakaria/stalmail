import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/setup/')({
  component: SetupPage,
})

function SetupPage() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <p className="text-muted-foreground text-sm">Setup wizard — Plan 2</p>
    </div>
  )
}
