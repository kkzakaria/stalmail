// Stalmail — page de connexion (/login). Réutilise i18n + ui + styles du wizard.
const { useState, useEffect, useMemo } = React;

const LOGIN_TWEAKS = /*EDITMODE-BEGIN*/{
  "dark": false,
  "accent": "oklch(0.55 0.15 250)",
  "simErrors": false
}/*EDITMODE-END*/;

// Pré-remplissage depuis l'état du wizard (comme un vrai redirect post-setup)
function wizardData() {
  try {
    const s = JSON.parse(localStorage.getItem("stalmail_wizard_v1"));
    if (s && s.data) return s.data;
  } catch (e) { }
  return {};
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function LoginPage() {
  const [tw, setTweak] = useTweaks(LOGIN_TWEAKS);
  const wiz = useMemo(wizardData, []);
  const [lang, setLang] = useState(wiz.lang || "fr");
  const t = (key, vars) => window.wizT(lang, key, vars);

  const domain = wiz.domain || "dupont.fr";
  const [email, setEmail] = useState(wiz.adminName ? wiz.adminName + "@" + domain : "");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  // phase: form | checking | error | success | webmail
  const [phase, setPhase] = useState("form");
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", tw.dark ? "dark" : "light");
    root.style.setProperty("--accent-base", tw.accent);
  }, [tw.dark, tw.accent]);

  const emailOk = EMAIL_RE.test(email);
  const passOk = password.length > 0;

  const submit = () => {
    setTouched(true);
    if (!emailOk || !passOk) return;
    setPhase("checking");
    setTimeout(() => {
      const fail = tw.simErrors && attempts === 0;
      setAttempts((a) => a + 1);
      if (fail) { setPhase("error"); setPassword(""); return; }
      setPhase("success");
      setTimeout(() => setPhase("webmail"), 1100);
    }, 1200);
  };

  const busy = phase === "checking" || phase === "success";

  return (
    <div className="shell login-shell">
      <header className="login-topbar">
        <Brand size={24} />
        <div className="shell-top-actions">
          <LangSelect lang={lang} onChange={setLang} />
          <ThemeToggle dark={!!tw.dark} onChange={(v) => setTweak("dark", v)}
            title={tw.dark ? t("th_dark") : t("th_light")} />
        </div>
      </header>

      <main className="login-main">
        {phase === "webmail" ? (
          <div className="card login-card step-welcome" data-screen-label="Webmail (hors périmètre)" style={{ gap: 18 }}>
            <BrandMark size={44} />
            <StepHeader title={t("l_webmail_title")} sub={t("l_webmail_note")} />
            <Button variant="outline" onClick={() => { setPhase("form"); setPassword(""); setAttempts(0); }}>
              {t("l_logout")}
            </Button>
          </div>
        ) : (
          <div className="card login-card" data-screen-label="Connexion">
            <div className="login-head">
              <BrandMark size={40} />
              <StepHeader title={t("l_title")} sub={t("l_sub")} />
            </div>

            {phase === "error" ? (
              <Alert variant="destructive" title={t("l_error_title")}>{t("l_error")}</Alert>
            ) : null}

            <Field label={t("l_email")} htmlFor="f-email"
              error={touched && !emailOk ? t("l_invalid_email") : null}>
              <Input id="f-email" value={email} mono autoFocus={!email}
                placeholder={"marie@" + domain}
                invalid={touched && !emailOk}
                onChange={(v) => setEmail(v.trim())} onEnter={submit} />
            </Field>

            <Field label={t("l_pass")} htmlFor="f-lpass"
              error={touched && !passOk ? t("l_required_pass") : null}>
              <PasswordInput id="f-lpass" value={password}
                invalid={touched && !passOk}
                showLabel={t("a_show")} hideLabel={t("a_hide")}
                onChange={setPassword} onEnter={submit} />
            </Field>

            <Button variant="primary" size="lg" onClick={submit} disabled={busy}
              style={{ width: "100%", marginTop: 4 }}>
              {busy ? <Spinner size={14} /> : <IconLock size={15} />}
              {phase === "checking" ? t("l_checking") : phase === "success" ? t("l_success") : t("l_submit")}
            </Button>
          </div>
        )}
        <a className="login-back" href="Stalmail Setup Wizard.html">{t("l_back_wizard")}</a>
      </main>

      <TweaksPanel>
        <TweakSection label={lang === "fr" ? "Apparence" : "Appearance"} />
        <TweakColor label="Accent" value={tw.accent}
          options={["oklch(0.55 0.15 250)", "oklch(0.55 0.15 300)", "oklch(0.55 0.15 160)", "#18181b"]}
          onChange={(v) => setTweak("accent", v)} />
        <TweakSection label="Simulation" />
        <TweakToggle label={lang === "fr" ? "Simuler des erreurs" : "Simulate errors"} value={!!tw.simErrors}
          onChange={(v) => setTweak("simErrors", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<LoginPage />);
