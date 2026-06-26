// src/components/setup/steps/HostAddressSection.tsx
// Section "Adresse du serveur" du wizard DNS : guide la création des A/AAAA (hostname +
// apex → IP du serveur), que Stalwart ne publie jamais. Présentationnel, props injectées.
// Affichée dans les deux modes (manuel/auto). En échec de l'écho IP : champ de saisie.
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { isIpv4, isIpv6 } from "@/lib/ip"
import type { DnsGridRecord } from "@/server/setup-actions"
import { isExternalHost } from "../host-utils"
import { Alert, Field, Spinner, TextInput } from "../ui/primitives"
import { StatusBadge, CopyIconBtn } from "../ui/monitor-primitives"

interface HostAddressSectionProps {
  records: DnsGridRecord[]
  status: "loading" | "ready" | "failed"
  domain: string
  onManualIp: (ip: string) => void
}

export function HostAddressSection({
  records,
  status,
  domain,
  onManualIp,
}: HostAddressSectionProps) {
  const { t } = useTranslation()
  const [ip, setIp] = useState("")
  const [invalid, setInvalid] = useState(false)

  const statusLabels = {
    verified: t("wizard.recordStatus.verified"),
    pending: t("wizard.recordStatus.pending"),
    error: t("wizard.recordStatus.error"),
  }
  const copyLabel = t("wizard.common.copy")
  const copiedLabel = t("wizard.common.copied")

  const submit = () => {
    const v = ip.trim()
    if (isIpv4(v) || isIpv6(v)) {
      setInvalid(false)
      onManualIp(v)
    } else {
      setInvalid(true)
    }
  }

  return (
    <section className="host-address">
      <div className="dns-sect-line">
        <span className="dns-sect-title">
          {t("wizard.dns.hostAddress.title")}
        </span>
        <span className="dns-sect-desc">
          {t("wizard.dns.hostAddress.hint")}
        </span>
      </div>

      {status === "loading" ? (
        <p className="inline-status">
          <Spinner size={14} />
          {t("wizard.dns.hostAddress.discovering")}
        </p>
      ) : null}

      {status === "failed" ? (
        <>
          <Alert variant="warning">
            {t("wizard.dns.hostAddress.echoFailed")}
          </Alert>
          <Field
            label={t("wizard.dns.hostAddress.manualLabel")}
            htmlFor="host-ip"
            help={t("wizard.dns.hostAddress.manualHelp")}
            error={
              invalid ? t("wizard.dns.hostAddress.manualInvalid") : undefined
            }
          >
            <TextInput
              id="host-ip"
              mono
              value={ip}
              invalid={invalid}
              onChange={(v) => setIp(v)}
            />
          </Field>
          <button type="button" className="btn" onClick={submit}>
            {t("wizard.dns.hostAddress.manualSubmit")}
          </button>
        </>
      ) : null}

      {records.length > 0 ? (
        <div className="dns-table-wrap">
          <table className="dns-table">
            <tbody>
              {records.map((r, i) => {
                return (
                  <tr
                    key={r.type + "-" + i}
                    className={r.status === "error" ? "row-error" : ""}
                  >
                    <td>
                      <span className="rec-type mono">{r.type}</span>
                    </td>
                    <td className="rec-name-cell">
                      <span className="cell-copy">
                        <CopyIconBtn
                          text={r.name}
                          copyLabel={copyLabel}
                          copiedLabel={copiedLabel}
                        />
                        <span className="mono cell-text" title={r.name}>
                          {r.name}
                        </span>
                      </span>
                    </td>
                    <td className="rec-value-cell">
                      <span className="cell-copy">
                        <CopyIconBtn
                          text={r.value}
                          copyLabel={copyLabel}
                          copiedLabel={copiedLabel}
                        />
                        <span className="mono cell-text" title={r.value}>
                          {r.value}
                        </span>
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <StatusBadge status={r.status} labels={statusLabels} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {(() => {
            const externalRecord = records.find((r) =>
              isExternalHost(r.name.replace(/\.$/, ""), domain)
            )
            return externalRecord ? (
              <Alert variant="info">
                {t("wizard.dns.hostAddress.apexNote", {
                  name: externalRecord.name,
                  domain,
                })}
              </Alert>
            ) : null
          })()}
        </div>
      ) : null}
    </section>
  )
}
