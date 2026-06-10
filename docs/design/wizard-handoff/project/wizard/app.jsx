// Stalmail Wizard — shell : machine d'étapes, 3 dispositions, tweaks
const { useState, useEffect, useMemo } = React;

const STORE_KEY = "stalmail_wizard_v1";

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": false,
  "accent": "oklch(0.55 0.15 250)",
  "simErrors": false,
  "speed": 1
}/*EDITMODE-END*/;

const DEFAULT_DATA = {
  lang: "fr",
  hostname: "mail.dupont.fr",
  domain: "dupont.fr",
  provider: "",
  secret: "",
  adminName: "marie",
  password: "",
  passwordRetried: false,
  sslStatus: "pending",
};

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.data && s.step) return s;
  } catch (e) { }
  return null;
}

/* ---------- Shell (disposition Carte) ---------- */
function ShellCard({ steps, current, t, lang, onLang, dark, onDark, caption, children }) {
  return (
    <div className="shell shell-card">
      <div className="shell-card-col">
        <div className="shell-card-top">
          <Brand size={24} />
          <div className="shell-top-actions">
            <LangSelect lang={lang} onChange={onLang} />
            <ThemeToggle dark={dark} onChange={onDark} title={dark ? t("th_dark") : t("th_light")} />
          </div>
        </div>
        <StepperH steps={steps} current={current} t={t} />
        <div className="card shell-card-main">{children}</div>
        <p className="shell-caption">{caption}</p>
      </div>
    </div>
  );
}

/* ---------- Application ---------- */
function SetupWizard() {
  const [tw, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const saved = useMemo(loadState, []);
  const [step, setStep] = useState(saved ? saved.step : 1);
  const [phase, setPhase] = useState(saved && saved.phase !== "login" ? saved.phase : saved ? "steps" : "steps"); // steps | restart
  const [data, setData] = useState(saved ? { ...DEFAULT_DATA, ...saved.data } : DEFAULT_DATA);

  const lang = data.lang;
  const t = (key, vars) => window.wizT(lang, key, vars);
  const sim = { errors: !!tw.simErrors, speed: tw.speed || 1 };

  // Persistance (mot de passe exclu, comme un vrai wizard)
  useEffect(() => {
    const { password, ...safe } = data;
    localStorage.setItem(STORE_KEY, JSON.stringify({ step, phase, data: safe }));
  }, [step, phase, data]);

  // Thème + accent
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", tw.dark ? "dark" : "light");
    root.style.setProperty("--accent-base", tw.accent);
  }, [tw.dark, tw.accent]);

  const update = (patch) => setData((d) => ({ ...d, ...patch }));
  const reset = () => {
    localStorage.removeItem(STORE_KEY);
    setData((d) => ({ ...DEFAULT_DATA, lang: d.lang }));
    setPhase("steps");
    setStep(1);
  };

  const steps = [
    { n: 1, label: t("s1"), group: "config" },
    { n: 2, label: t("s2"), group: "config" },
    { n: 3, label: t("s3"), group: "config" },
    { n: 4, label: t("s4"), group: "config" },
    { n: 5, label: t("s5"), group: "config" },
    { n: 6, label: t("s6"), group: "activation" },
    { n: 7, label: t("s7"), group: "activation" },
    { n: 8, label: t("s8"), group: "activation" },
    { n: 9, label: t("s9"), group: "activation" },
  ];

  const next = () => {
    if (step === 5) { setPhase("restart"); }
    else if (step < 9) { setStep(step + 1); }
  };
  const back = () => { if (step > 1) setStep(step - 1); };
  const goTo = (n) => setStep(n);

  const props = { t, data, update, sim, onNext: next, onBack: step > 1 ? back : null, goTo };

  let content, screenLabel;
  if (phase === "restart") {
    screenLabel = "Redémarrage";
    content = <RestartScreen t={t} sim={sim} onDone={() => { setPhase("steps"); setStep(6); }} />;
  } else {
    screenLabel = "Étape " + step + " — " + steps[step - 1].label;
    switch (step) {
      case 1: content = <StepWelcome {...props} onBack={null} />; break;
      case 2: content = <StepDomain {...props} />; break;
      case 3: content = <StepProvider {...props} />; break;
      case 4: content = <StepAdmin {...props} />; break;
      case 5: content = <StepRecap {...props} />; break;
      case 6: content = <StepAccount {...props} />; break;
      case 7: content = <StepDns {...props} />; break;
      case 8: content = <StepSsl {...props} />; break;
      case 9: content = <StepDone {...props} />; break;
      default: content = null;
    }
  }

  const current = phase === "restart" ? 6 : step;
  const caption = phase === "restart" ? t("groupActivation") : t("stepOf", { n: step });
  const shellProps = {
    steps, current, t, lang, caption,
    onLang: (l) => update({ lang: l }),
    dark: !!tw.dark,
    onDark: (v) => setTweak("dark", v),
  };
  const animated = (
    <div key={screenLabel} className="step-anim" data-screen-label={screenLabel}>
      {content}
    </div>
  );

  return (
    <React.Fragment>
      <ShellCard {...shellProps}>{animated}</ShellCard>

      <TweaksPanel>
        <TweakSection label={lang === "fr" ? "Apparence" : "Appearance"} />
        <TweakColor label="Accent" value={tw.accent}
          options={["oklch(0.55 0.15 250)", "oklch(0.55 0.15 300)", "oklch(0.55 0.15 160)", "#18181b"]}
          onChange={(v) => setTweak("accent", v)} />
        <TweakSection label="Simulation" />
        <TweakToggle label={lang === "fr" ? "Simuler des erreurs" : "Simulate errors"} value={!!tw.simErrors}
          onChange={(v) => setTweak("simErrors", v)} />
        <TweakSlider label={lang === "fr" ? "Vitesse" : "Speed"} value={tw.speed || 1}
          min={0.5} max={4} step={0.5} unit="×"
          onChange={(v) => setTweak("speed", v)} />
        <TweakButton label={lang === "fr" ? "Recommencer le wizard" : "Restart the wizard"} onClick={reset} />
      </TweaksPanel>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<SetupWizard />);
