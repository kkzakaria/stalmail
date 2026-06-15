import {
  afterEach,
  beforeEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "../../i18n/i18n"
import type { AppMailbox, AppThreadDetail } from "../../server/mail-types"
import type * as RouterModule from "@tanstack/react-router"
import type * as MailActionsModule from "../../server/mail-actions"

// DETAIL doit être hoisté pour être accessible dans le factory vi.mock (qui est hoisté par Vitest).
const { DETAIL } = vi.hoisted<{ DETAIL: AppThreadDetail }>(() => ({
  DETAIL: {
    threadId: "t1",
    subject: "Sujet ouvert",
    emailIds: ["e1"],
    starred: false,
    unread: false,
    messages: [
      {
        id: "e1",
        from: [{ name: "Bob", email: "bob@x.io" }],
        to: [],
        cc: [],
        subject: "Sujet ouvert",
        receivedAt: "2026-06-10T10:00:00Z",
        unread: false,
        hasAttachment: false,
        textBody: "hello",
        htmlBody: null,
        attachments: [],
      },
    ],
  },
}))

// Link needs a RouterProvider; mock it as a plain anchor (active class is computed by AppSidebar).
vi.mock("@tanstack/react-router", async (importActual) => ({
  ...(await importActual<typeof RouterModule>()),
  Link: ({
    className,
    children,
  }: {
    to?: string
    params?: Record<string, string>
    className?: string
    children?: React.ReactNode
  }) => <a className={className}>{children}</a>,
  useNavigate: () => vi.fn(),
}))

// Avoid the real server fn hitting the network in jsdom.
vi.mock("../../server/mail-actions", async (importActual) => ({
  ...(await importActual<typeof MailActionsModule>()),
  emailListFn: vi
    .fn()
    .mockResolvedValue({ threads: [], total: 0, position: 0 }),
  readThreadFn: vi.fn().mockResolvedValue(DETAIL),
  setFlagsFn: vi.fn().mockResolvedValue({ ok: true }),
  moveThreadFn: vi.fn().mockResolvedValue({ ok: true }),
}))

// eslint-disable-next-line import/first
import { MailPage } from "./$folder"
// eslint-disable-next-line import/first
import { emailListFn } from "../../server/mail-actions"

beforeAll(() => {
  // @tanstack/react-virtual needs ResizeObserver + measurable elements in jsdom.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as Record<string, unknown>).ResizeObserver = RO
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 400,
      height: 600,
      top: 0,
      left: 0,
      right: 400,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>
    </QueryClientProvider>
  )
}

const MBX: AppMailbox[] = [
  {
    id: "mi",
    name: "In",
    role: "inbox",
    unreadEmails: 2,
    totalEmails: 5,
    sortOrder: 1,
  },
]

describe("MailPage", () => {
  it("monte la sidebar (dossiers) et la liste pour le folder courant", () => {
    wrap(<MailPage folder="inbox" mailboxes={MBX} accountName="me@x.fr" />)
    expect(screen.getByText("Boîte de réception")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /nouveau message/i })
    ).toBeInTheDocument()
  })

  it("court-circuite snoozed : affiche le placeholder, ne monte pas la liste", () => {
    wrap(<MailPage folder="snoozed" mailboxes={MBX} accountName="me@x.fr" />)
    expect(screen.getByText("Disponible prochainement")).toBeInTheDocument()
    expect(emailListFn).not.toHaveBeenCalled()
  })
})

describe("MailPage — reader", () => {
  it("sans ?thread : placeholder, pas de reader-bar", () => {
    wrap(
      <MailPage
        folder="inbox"
        mailboxes={MBX}
        accountName="Moi"
        threadId={undefined}
      />
    )
    expect(document.querySelector(".reader-placeholder")).not.toBeNull()
  })

  it("avec threadId : monte le Reader et charge le fil", async () => {
    wrap(
      <MailPage
        folder="inbox"
        mailboxes={MBX}
        accountName="Moi"
        threadId="t1"
      />
    )
    await waitFor(() =>
      expect(screen.getByText("Sujet ouvert")).toBeInTheDocument()
    )
  })
})
