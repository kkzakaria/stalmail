// Stalmail Wizard — Phase collecte : étapes 1–5 + écran de redémarrage
const { useState, useEffect, useRef } = React;

const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const NAME_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/i;
const SERVER_IP = "203.0.113.42";

// Le nom d'hôte est-il hors de la zone du domaine par défaut ? (ex. mail.autre.fr vs dupont.fr)
function isExternalHost(hostname, domain) {
  if (!hostname || !domain) return false;
  return hostname !== domain && !hostname.endsWith("." + domain);
}
function hostZone(hostname) {
  const parts = (hostname || "").split(".");
  return parts.length > 2 ? parts.slice(1).join(".") : hostname;
}

/* ---------- Étape 1 — Bienvenue ---------- */
function StepWelcome({ t, data, update, onNext }) {
  return (
    <div className="step-body step-welcome">
      <BrandMark size={52} />
      <StepHeader title={t("w_title")} sub={t("w_sub")} />
      <div className="need-box">
        <p className="need-title">{t("w_need")}</p>
        <p className="need-item"><IconGlobe size={14} />{t("w_need1")}</p>
        <p className="need-item"><IconServer size={14} />{t("w_need2")}</p>
      </div>
      <Button variant="primary" size="lg" onClick={onNext}>
        {t("w_start")}<IconArrowR size={16} />
      </Button>
    </div>
  );
}

/* ---------- Étape 2 — Domaine ---------- */
function StepDomain({ t, data, update, onNext, onBack, sim }) {
  const [touched, setTouched] = useState(false);
  const [check, setCheck] = useState("idle"); // idle | checking | ok | warn
  const timer = useRef(null);

  const hostOk = HOST_RE.test(data.hostname);
  const domainOk = HOST_RE.test(data.domain);
  const valid = hostOk && domainOk;

  const edit = (patch) => { update(patch); setCheck("idle"); };

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    if (check === "ok" || check === "warn") { onNext(); return; }
    setCheck("checking");
    timer.current = setTimeout(() => {
      if (sim.errors) setCheck("warn");
      else { setCheck("ok"); timer.current = setTimeout(onNext, 650); }
    }, 900 / sim.speed);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="step-body">
      <StepHeader title={t("d_title")} sub={t("d_sub")} />
      <Field label={t("d_host")} htmlFor="f-host" help={t("d_host_help")}
        error={touched && !hostOk ? t("d_invalid_host") : null}>
        <Input id="f-host" value={data.hostname} mono autoFocus placeholder="mail.exemple.fr"
          invalid={touched && !hostOk} onChange={(v) => edit({ hostname: v.trim() })} onEnter={submit} />
      </Field>
      <Field label={t("d_domain")} htmlFor="f-domain"
        help={t("d_domain_help", { domain: domainOk ? data.domain : "exemple.fr" })}
        error={touched && !domainOk ? t("d_invalid_domain") : null}>
        <Input id="f-domain" value={data.domain} mono placeholder="exemple.fr"
          invalid={touched && !domainOk} onChange={(v) => edit({ domain: v.trim() })} onEnter={submit} />
      </Field>

      {valid && isExternalHost(data.hostname, data.domain) ? (
        <Alert variant="warning" title={t("d_ext_title")}>
          {t("d_ext", { host: data.hostname, zone: hostZone(data.hostname), domain: data.domain })}
        </Alert>
      ) : null}

      {check === "checking" ? (
        <p className="inline-status"><Spinner size={13} />{t("d_checking")}</p>
      ) : null}
      {check === "ok" ? (
        <p className="inline-status inline-status-ok"><IconCheck size={14} />{t("d_check_ok", { host: data.hostname, ip: SERVER_IP })}</p>
      ) : null}
      {check === "warn" ? (
        <Alert variant="warning" title={t("d_check_warn_title")}>
          {t("d_check_warn", { host: data.hostname, ip: SERVER_IP })}
        </Alert>
      ) : null}

      <StepNav t={t} onBack={onBack} onNext={submit}
        busy={check === "checking"}
        nextLabel={check === "warn" ? t("d_continue_anyway") : t("next")} />
    </div>
  );
}

/* ---------- Étape 3 — Fournisseur DNS ---------- */
function StepProvider({ t, data, update, onNext, onBack }) {
  const [touched, setTouched] = useState(false);
  const isManual = data.provider === "__manual__";
  const hasProvider = data.provider !== "";
  const secretOk = isManual || data.secret.trim().length > 0;
  const valid = hasProvider && secretOk;

  const submit = () => { setTouched(true); if (valid) onNext(); };

  return (
    <div className="step-body">
      <StepHeader title={t("p_title")} sub={t("p_sub")} />
      <Field label={t("p_label")} htmlFor="f-provider"
        error={touched && !hasProvider ? t("p_required") : null}>
        <Combobox id="f-provider" value={data.provider} invalid={touched && !hasProvider}
          options={window.DNS_PROVIDERS}
          stickyOption={{ value: "__manual__", label: t("p_manual"), hint: t("p_manual_hint") }}
          placeholder={t("p_placeholder")}
          searchPlaceholder={t("p_search")}
          emptyText={t("p_empty")}
          onChange={(v) => update({ provider: v, secret: "" })} />
      </Field>

      {hasProvider && !isManual ? (
        <Field label={t("p_secret")} htmlFor="f-secret" help={t("p_secret_help", { domain: data.domain })}
          error={touched && !secretOk ? t("p_secret_required") : null}>
          <Input id="f-secret" type="password" mono value={data.secret}
            invalid={touched && !secretOk} onChange={(v) => update({ secret: v })} onEnter={submit} />
        </Field>
      ) : null}

      {isManual ? (
        <Alert variant="info">{t("p_manual_note")}</Alert>
      ) : null}

      <StepNav t={t} onBack={onBack} onNext={submit} />
    </div>
  );
}

/* ---------- Étape 4 — Compte admin ---------- */
function StepAdmin({ t, data, update, onNext, onBack }) {
  const [touched, setTouched] = useState(false);
  const nameOk = NAME_RE.test(data.adminName);
  const passOk = data.password.length >= 8;
  const valid = nameOk && passOk;
  const email = (nameOk ? data.adminName : "admin") + "@" + data.domain;

  const submit = () => { setTouched(true); if (valid) onNext(); };

  return (
    <div className="step-body">
      <StepHeader title={t("a_title")} sub={t("a_sub")} />
      <Field label={t("a_name")} htmlFor="f-name"
        help={t("a_email", { email })}
        error={touched && !nameOk ? t("a_invalid_name") : null}>
        <Input id="f-name" value={data.adminName} mono autoFocus placeholder="admin"
          invalid={touched && !nameOk} onChange={(v) => update({ adminName: v.trim() })} onEnter={submit} />
      </Field>
      <Field label={t("a_pass")} htmlFor="f-pass" help={t("a_pass_help")}
        error={touched && !passOk ? t("a_invalid_pass") : null}>
        <PasswordInput id="f-pass" value={data.password} invalid={touched && !passOk}
          showLabel={t("a_show")} hideLabel={t("a_hide")}
          onChange={(v) => update({ password: v })} onEnter={submit} />
      </Field>
      <StrengthMeter password={data.password} t={t} />
      <StepNav t={t} onBack={onBack} onNext={submit} />
    </div>
  );
}

/* ---------- Étape 5 — Récapitulatif ---------- */
function StepRecap({ t, data, onNext, onBack, goTo }) {
  const isManual = data.provider === "__manual__";
  const rows = [
    { label: t("r_host"), value: data.hostname, mono: true, step: 2 },
    { label: t("r_domain"), value: data.domain, mono: true, step: 2 },
    { label: t("r_dns"), value: isManual ? t("r_dns_manual") : t("r_dns_auto", { provider: data.provider }), step: 3 },
    { label: t("r_admin"), value: data.adminName + "@" + data.domain, mono: true, step: 4 },
  ];
  return (
    <div className="step-body">
      <StepHeader title={t("r_title")} sub={t("r_sub")} />
      <div className="recap">
        {rows.map((r, i) => (
          <div key={i} className="recap-row">
            <span className="recap-label">{r.label}</span>
            <span className={"recap-value" + (r.mono ? " mono" : "")}>{r.value}</span>
            <button type="button" className="recap-edit" onClick={() => goTo(r.step)}>{t("r_edit")}</button>
          </div>
        ))}
      </div>
      <p className="help" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <IconInfo size={14} />{t("r_note")}
      </p>
      <StepNav t={t} onBack={onBack} onNext={onNext} nextLabel={t("r_submit")} />
    </div>
  );
}

/* ---------- Écran de redémarrage (entre 5 et 6) ---------- */
function RestartScreen({ t, sim, onDone }) {
  const [polls, setPolls] = useState([]);
  const doneRef = useRef(false);

  useEffect(() => {
    const start = Date.now();
    const total = 7500 / sim.speed;
    const iv = setInterval(() => {
      const elapsed = Date.now() - start;
      const ready = elapsed >= total;
      setPolls((p) => {
        const n = p.length + 1;
        return [...p, { n, ready }];
      });
      if (ready && !doneRef.current) {
        doneRef.current = true;
        clearInterval(iv);
        setTimeout(onDone, 900);
      }
    }, 1900 / sim.speed);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="step-body step-restart" aria-busy="true">
      <div className="restart-spinner"><Spinner size={28} /></div>
      <StepHeader title={t("rs_title")} sub={t("rs_sub")} />
      <div className="progress progress-indeterminate" style={{ maxWidth: 320, width: "100%" }}>
        <div className="progress-bar"></div>
      </div>
      <div className="poll-log mono" aria-live="polite">
        {polls.slice(-4).map((p) => (
          <p key={p.n} className={"poll-line" + (p.ready ? " poll-line-ok" : "")}>
            {t("rs_poll", { n: p.n })} → {p.ready ? t("rs_ready") : t("rs_restarting")}
          </p>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, {
  StepWelcome, StepDomain, StepProvider, StepAdmin, StepRecap, RestartScreen,
  SERVER_IP, isExternalHost, hostZone,
});
