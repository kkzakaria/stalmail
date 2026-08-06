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
    return () => {
      document.removeEventListener("pointerdown", down, true)
      document.removeEventListener("pointerup", up, true)
      document.removeEventListener("pointercancel", up, true)
    }
  }, [])

  return useCallback((collapse: () => void) => {
    if (!pointerDown.current) {
      collapse()
      return
    }
    const finish = () => {
      document.removeEventListener("pointerup", finish, true)
      document.removeEventListener("pointercancel", finish, true)
      // pointerup, mouseup et click appartiennent à la même tâche : une
      // macrotâche s'exécute donc après la délivrance du clic.
      setTimeout(collapse, 0)
    }
    document.addEventListener("pointerup", finish, true)
    document.addEventListener("pointercancel", finish, true)
  }, [])
}
