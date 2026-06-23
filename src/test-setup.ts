// Registers jest-dom matchers (toBeInTheDocument, toHaveAttribute, …) for the
// jsdom client test project. Loaded via vitest.config.ts setupFiles.
import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Ensure DOM is cleaned up after every test even when auto-cleanup doesn't fire.
afterEach(cleanup)
