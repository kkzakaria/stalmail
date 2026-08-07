import { useCallback, useEffect, useRef } from "react"

/**
 * Renvoie une fonction qui exécute `collapse` tout de suite, ou — si un geste
 * pointeur est en cours — juste APRÈS la délivrance du clic.
 *
 * Pourquoi : le focus part au mousedown. Replier une rangée à cet instant fait
 * remonter tout ce qui est en dessous avant le mouseup, et le navigateur n'émet
 * un `click` que si mousedown et mouseup partagent une cible — le clic sur
 * « Envoyer » était avalé (issue #147, design 2026-08-06 décision 6).
 */
export function useGestureSafeCollapse(): (collapse: () => void) => void {
  const pointerDown = useRef(false)
  // Reports en attente (geste en cours, `collapse` pas encore exécuté) : un
  // retrait par report, pour tout annuler si le composant démonte avant le
  // pointerup/pointercancel attendu (sinon l'écouteur reste posé sur
  // `document` et déclenche un `collapse` périmé plus tard, ailleurs).
  const pending = useRef<Set<() => void>>(new Set())

  useEffect(() => {
    const down = () => {
      pointerDown.current = true
    }
    const up = () => {
      pointerDown.current = false
    }
    document.addEventListener("pointerdown", down, true)
    document.addEventListener("pointerup", up, true)
    document.addEventListener("pointercancel", up, true)
    // Capturé ICI (pas relu via pending.current dans le cleanup) : la ref
    // n'est jamais réassignée, donc la même instance de Set reste valable
    // jusqu'au démontage — et exhaustive-deps ne réclame pas `pending` en
    // dépendance de cet effet.
    const pendingReports = pending.current
    return () => {
      document.removeEventListener("pointerdown", down, true)
      document.removeEventListener("pointerup", up, true)
      document.removeEventListener("pointercancel", up, true)
      // Annule les gestes en cours : retire leurs écouteurs globaux et
      // empêche tout `collapse` différé de s'exécuter après démontage.
      for (const cancel of pendingReports) cancel()
      pendingReports.clear()
    }
  }, [])

  return useCallback((collapse: () => void) => {
    if (!pointerDown.current) {
      collapse()
      return
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const cancel = () => {
      document.removeEventListener("pointerup", finish, true)
      document.removeEventListener("pointercancel", finish, true)
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      pending.current.delete(cancel)
    }
    const finish = () => {
      document.removeEventListener("pointerup", finish, true)
      document.removeEventListener("pointercancel", finish, true)
      // pointerup, mouseup et click appartiennent à la même tâche : une
      // macrotâche s'exécute donc après la délivrance du clic.
      timeoutId = setTimeout(() => {
        pending.current.delete(cancel)
        collapse()
      }, 0)
    }
    pending.current.add(cancel)
    document.addEventListener("pointerup", finish, true)
    document.addEventListener("pointercancel", finish, true)
  }, [])
}
