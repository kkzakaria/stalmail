// Stalmail Wizard — Phase monitoring : étapes 6–9 (compte, DNS, SSL, terminé)
const { useState, useEffect, useRef } = React;

/* ---------- Données DNS simulées ---------- */
function buildDnsRecords(data) {
  const d = data.domain, h = data.hostname;
  const ext = window.isExternalHost(h, d);
  const dkim = '"v=DKIM1; k=ed25519; p=K6c1pT4yJmqWvR8sLnB2dQxE7uH0aFgZ3iOkXoZ9A=="';
  return [
    { id: "a", type: "A", name: h + ".", value: window.SERVER_IP, delay: ext ? 8.4 : 1, external: ext },
    { id: "mx", type: "MX", name: d + ".", value: "10 " + h + ".", delay: 2 },
    { id: "spf", type: "TXT", name: d + ".", value: '"v=spf1 mx -all"', delay: 3 },
    { id: "dkim", type: "TXT", name: "stalmail._domainkey." + d + ".", value: dkim, delay: 5 },
    { id: "dmarc", type: "TXT", name: "_dmarc." + d + ".", value: '"v=DMARC1; p=reject; rua=mailto:postmaster@' + d + '"', delay: 4 },
    { id: "srv1", type: "SRV", name: "_imaps._tcp." + d + ".", value: "0 1 993 " + h + ".", delay: 6 },
    { id: "srv2", type: "SRV", name: "_submissions._tcp." + d + ".", value: "0 1 465 " + h + ".", delay: 6.6 },
    { id: "cname", type: "CNAME", name: "autoconfig." + d + ".", value: h + ".", delay: 7.4 },
  ];
}
function zoneFileText(records) {
  const pad = (s, n) => (s.length >= n ? s + " " : s.padEnd(n));
  return records.map((r) => pad(r.name, 34) + "3600 IN " + pad(r.type, 6) + r.value).join("\n");
}

// Groupes par type pour la vue manuelle (titre + description i18n : n_g_<key>_t / _d)
const DNS_GROUP_DEFS = [
  { type: "A", key: "a" },
  { type: "MX", key: "mx" },
  { type: "TXT", key: "txt" },
  { type: "SRV", key: "srv" },
  { type: "CNAME", key: "cname" },
];

/* ---------- Étape 6 — Création du compte admin ---------- */
function StepAccount({ t, data, update, onNext, sim }) {
  // phase: creating | weak | retrying | done
  const [phase, setPhase] = useState("creating");
  const [newPass, setNewPass] = useState("");
  const [touched, setTouched] = useState(false);
  const timer = useRef(null);
  const email = data.adminName + "@" + data.domain;

  useEffect(() => {
    timer.current = setTimeout(() => {
      setPhase(sim.errors && !data.passwordRetried ? "weak" : "done");
    }, 1500 / sim.speed);
    return () => clearTimeout(timer.current);
  }, []);

  const retry = () => {
    setTouched(true);
    if (newPass.length < 8 || newPass === data.password) return;
    setPhase("retrying");
    timer.current = setTimeout(() => {
      update({ password: newPass, passwordRetried: true });
      setPhase("done");
    }, 1300 / sim.speed);
  };

  return (
    <div className="step-body">
      <StepHeader title={t("ac_title")} />

      {phase === "creating" || phase === "retrying" ? (
        <p className="inline-status"><Spinner size={14} />{t("ac_creating", { email })}</p>
      ) : null}

      {phase === "weak" ? (
        <React.Fragment>
          <Alert variant="destructive" title={t("ac_weak_title")}>{t("ac_weak")}</Alert>
          <Field label={t("ac_new_pass")} htmlFor="f-newpass"
            error={touched && newPass.length < 8 ? t("a_invalid_pass") : null}>
            <PasswordInput id="f-newpass" value={newPass} invalid={touched && newPass.length < 8}
              showLabel={t("a_show")} hideLabel={t("a_hide")}
              onChange={setNewPass} onEnter={retry} />
          </Field>
          <StrengthMeter password={newPass} t={t} />
          <StepNav t={t} onNext={retry} nextLabel={t("ac_retry")} />
        </React.Fragment>
      ) : null}

      {phase === "done" ? (
        <React.Fragment>
          <p className="inline-status inline-status-ok"><IconCheck size={15} />{t("ac_done", { email })}</p>
          <StepNav t={t} onNext={onNext} />
        </React.Fragment>
      ) : null}
    </div>
  );
}

/* ---------- Étape 7 — DNS (grille live / manuel) ---------- */
function StepDns({ t, data, onNext, sim }) {
  const isManual = data.provider === "__manual__";
  // phase: connecting | publishing | grid
  const [phase, setPhase] = useState(isManual ? "grid" : "connecting");
  const [tick, setTick] = useState(0);
  const startRef = useRef(null);
  const records = buildDnsRecords(data);

  useEffect(() => {
    let t1, t2;
    if (!isManual) {
      t1 = setTimeout(() => setPhase("publishing"), 1300 / sim.speed);
      t2 = setTimeout(() => { setPhase("grid"); }, 2500 / sim.speed);
    }
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    if (phase !== "grid") return;
    if (!startRef.current) startRef.current = Date.now();
    const iv = setInterval(() => setTick((x) => x + 1), 600);
    return () => clearInterval(iv);
  }, [phase]);

  const elapsed = phase === "grid" && startRef.current ? (Date.now() - startRef.current) : 0;
  const unit = (isManual ? 2100 : 1400) / sim.speed;
  const statusOf = (r) => {
    if (phase !== "grid") return "pending";
    if (sim.errors && r.id === "dkim") return elapsed > r.delay * unit ? "error" : "pending";
    return elapsed > r.delay * unit ? "verified" : "pending";
  };
  const statuses = records.map(statusOf);
  const allDone = statuses.every((s) => s === "verified");
  const hasError = statuses.includes("error");
  const settled = statuses.every((s) => s !== "pending");
  const task = phase !== "grid" ? "pending" : settled ? (hasError ? "partial" : "completed") : "inprogress";
  const taskBadge = {
    pending: ["pending", t("t_pending")],
    inprogress: ["pending", t("t_inprogress")],
    completed: ["success", t("t_completed")],
    partial: ["destructive", t("t_partial")],
  }[task];

  return (
    <div className="step-body step-body-wide">
      <StepHeader title={t("n_title")}
        sub={isManual ? t("n_sub_manual") : t("n_sub_auto", { provider: data.provider })} />

      {phase === "connecting" ? (
        <p className="inline-status"><Spinner size={14} />{t("n_connecting", { provider: data.provider })}</p>
      ) : null}
      {phase === "publishing" ? (
        <p className="inline-status"><Spinner size={14} />{t("n_publishing")}</p>
      ) : null}

      {phase === "grid" ? (
        <React.Fragment>
          {isManual ? (
            <div className="dns-manual">
              <div className="dns-table-wrap">
                <table className="dns-table dns-table-manual">
                  <tbody>
                    {DNS_GROUP_DEFS.map((g) => {
                      const recs = records
                        .map((r, i) => ({ ...r, status: statuses[i] }))
                        .filter((r) => r.type === g.type);
                      if (recs.length === 0) return null;
                      return (
                        <React.Fragment key={g.type}>
                          <tr className="dns-sect">
                            <td colSpan="3">
                              <span className="dns-sect-line">
                                <span className="rec-type-chip mono">{g.type}</span>
                                <span className="dns-sect-title">{t("n_g_" + g.key + "_t")}</span>
                                <span className="dns-sect-desc">{t("n_g_" + g.key + "_d", { host: data.hostname, domain: data.domain })}</span>
                              </span>
                            </td>
                          </tr>
                          {recs.map((r) => (
                            <tr key={r.id} className={r.status === "error" ? "row-error" : ""}>
                              <td className="rec-name-cell">
                                <span className="cell-copy">
                                  <CopyIconBtn text={r.name} t={t} />
                                  <span className="mono cell-text" title={r.name}>{r.name}</span>
                                  {r.external ? <span className="rec-tag">{t("n_ext_tag")}</span> : null}
                                </span>
                              </td>
                              <td className="rec-value-cell">
                                <span className="cell-copy">
                                  <CopyIconBtn text={r.value} t={t} />
                                  <span className="mono cell-text" title={r.value}>{r.value}</span>
                                </span>
                              </td>
                              <td className="rec-status-cell" style={{ textAlign: "right" }}>
                                <StatusBadge status={r.status} t={t} />
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="zonefile-head">
                <span className="help" style={{ margin: 0 }}>{t("n_zone_full")}</span>
                <div className="zonefile-actions">
                  <CopyButton text={zoneFileText(records)} t={t} small />
                  <DownloadButton content={zoneFileText(records) + "\n"}
                    filename={data.domain + ".zone.txt"} label={t("n_download_txt")} small />
                </div>
              </div>
            </div>
          ) : (
            <div className="dns-table-wrap">
              <table className="dns-table">
                <thead>
                  <tr>
                    <th>{t("n_type")}</th><th>{t("n_name")}</th><th>{t("n_value")}</th>
                    <th style={{ textAlign: "right" }}>{t("n_status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={r.id} className={statuses[i] === "error" ? "row-error" : ""}>
                      <td><span className="rec-type mono">{r.type}</span></td>
                      <td className="mono rec-name" title={r.name}>
                        {r.name}
                        {r.external ? <span className="rec-tag">{t("n_ext_tag")}</span> : null}
                      </td>
                      <td className="mono rec-value" title={r.value}>{r.value}</td>
                      <td style={{ textAlign: "right" }}><StatusBadge status={statuses[i]} t={t} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!isManual && records.some((r) => r.external) ? (
            <Alert variant="warning" title={"A · " + data.hostname}>
              {t("n_ext_note", { zone: window.hostZone(data.hostname), domain: data.domain, provider: data.provider })}
            </Alert>
          ) : null}

          {hasError ? (
            <Alert variant="destructive" title={"TXT · stalmail._domainkey." + data.domain}>
              {t("n_error_hint")}
            </Alert>
          ) : null}

          <div className="task-line">
            <span className="task-label">{t("n_task")}</span>
            <Badge variant={taskBadge[0]} pulse={task === "inprogress"}>{taskBadge[1]}</Badge>
          </div>

          <p className="help" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {allDone ? <IconCheck size={14} /> : <IconInfo size={14} />}
            {allDone ? t("n_all_ok") : t("n_bg")}
          </p>
          <StepNav t={t} onNext={onNext} />
        </React.Fragment>
      ) : null}
    </div>
  );
}

/* ---------- Étape 8 — SSL / ACME ---------- */
function StepSsl({ t, data, update, onNext, sim }) {
  // phase: configuring | monitor ; status: pending | failed | valid
  const [phase, setPhase] = useState("configuring");
  const [status, setStatus] = useState("pending");
  const email = data.adminName + "@" + data.domain;

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("monitor"), 1400 / sim.speed);
    const t2 = setTimeout(() => {
      setStatus(sim.errors ? "failed" : "valid");
    }, (sim.errors ? 4500 : 7000) / sim.speed);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => { update({ sslStatus: status }); }, [status]);

  const badge = {
    pending: ["pending", t("sa_pending")],
    failed: ["destructive", t("sa_failed")],
    valid: ["success", t("sa_valid")],
  }[status];

  return (
    <div className="step-body">
      <StepHeader title={t("sl_title")} sub={t("sl_sub")} />

      {phase === "configuring" ? (
        <p className="inline-status"><Spinner size={14} />{t("sl_configuring")}</p>
      ) : (
        <React.Fragment>
          <div className="recap">
            <div className="recap-row">
              <span className="recap-label">{t("sl_provider")}</span>
              <span className="recap-value">{t("sl_provider_val")}</span>
            </div>
            <div className="recap-row">
              <span className="recap-label">{t("sl_contact")}</span>
              <span className="recap-value mono">{email}</span>
            </div>
            <div className="recap-row">
              <span className="recap-label">{t("sl_san")}</span>
              <span className="recap-value mono">{data.hostname}</span>
            </div>
            <div className="recap-row">
              <span className="recap-label">{t("sl_task")}</span>
              <span className="recap-value">
                <Badge variant={badge[0]} pulse={status === "pending"}>{badge[1]}</Badge>
              </span>
            </div>
          </div>

          {status === "failed" ? (
            <Alert variant="warning" title={t("sa_failed")}>{t("sl_failed_hint")}</Alert>
          ) : null}
          {status !== "valid" ? (
            <p className="help" style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <IconInfo size={14} style={{ marginTop: 2 }} />{t("sl_nonblock")}
            </p>
          ) : null}
          <StepNav t={t} onNext={onNext} />
        </React.Fragment>
      )}
    </div>
  );
}

/* ---------- Étape 9 — Terminé ---------- */
function StepDone({ t, data, sim }) {
  const [finishing, setFinishing] = useState(true);
  useEffect(() => {
    const t1 = setTimeout(() => setFinishing(false), 900 / sim.speed);
    return () => clearTimeout(t1);
  }, []);

  if (finishing) {
    return (
      <div className="step-body">
        <p className="inline-status"><Spinner size={14} />{t("f_finishing")}</p>
      </div>
    );
  }

  const sslOk = data.sslStatus === "valid";
  return (
    <div className="step-body step-done">
      <span className="done-mark"><IconCheck size={26} strokeWidth={2.5} /></span>
      <StepHeader title={t("f_title")} sub={t("f_sub")} />
      <div className="recap" style={{ width: "100%" }}>
        <div className="recap-row">
          <span className="recap-label">{t("f_domain")}</span>
          <span className="recap-value mono">{data.domain}</span>
        </div>
        <div className="recap-row">
          <span className="recap-label">{t("f_host")}</span>
          <span className="recap-value mono">{data.hostname}</span>
        </div>
        <div className="recap-row">
          <span className="recap-label">{t("f_ssl")}</span>
          <span className="recap-value">
            <Badge variant={sslOk ? "success" : "pending"} pulse={!sslOk}>
              {sslOk ? t("f_ssl_ok") : t("f_ssl_pending")}
            </Badge>
          </span>
        </div>
        <div className="recap-row">
          <span className="recap-label">{t("f_admin")}</span>
          <span className="recap-value mono">{data.adminName + "@" + data.domain}</span>
        </div>
      </div>
      <Alert variant="info" title={t("f_backup_title")}>{t("f_backup")}</Alert>
      <a className="btn btn-primary btn-lg" href="Stalmail Login.html"
        style={{ alignSelf: "center", textDecoration: "none" }}>
        <IconMail size={16} />{t("f_open")}
      </a>
    </div>
  );
}

Object.assign(window, { StepAccount, StepDns, StepSsl, StepDone, buildDnsRecords, zoneFileText });
