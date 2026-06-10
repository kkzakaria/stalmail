// Stalmail Wizard — primitives UI (style shadcn). Classes CSS définies dans le HTML hôte.
const { useState, useEffect, useRef } = React;

/* ---------- Icônes (glyphes simples) ---------- */
function Icon({ d, size = 16, strokeWidth = 2, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }} aria-hidden="true">
      {d}
    </svg>
  );
}
const IconCheck = (p) => <Icon {...p} d={<polyline points="20 6 9 17 4 12"></polyline>} />;
const IconAlert = (p) => <Icon {...p} d={<g><path d="M12 9v4"></path><path d="M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle></g>} />;
const IconInfo = (p) => <Icon {...p} d={<g><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path></g>} />;
const IconCopy = (p) => <Icon {...p} d={<g><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a1 1 0 0 1 1-1h9"></path></g>} />;
const IconEye = (p) => <Icon {...p} d={<g><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path><circle cx="12" cy="12" r="3"></circle></g>} />;
const IconEyeOff = (p) => <Icon {...p} d={<g><path d="M4 4l16 16"></path><path d="M9.9 5.1A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.5M6.6 6.6A16.4 16.4 0 0 0 2 12s3.5 6 10 6c1.5 0 2.9-.3 4.1-.8"></path></g>} />;
const IconGlobe = (p) => <Icon {...p} d={<g><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"></path></g>} />;
const IconArrowR = (p) => <Icon {...p} d={<g><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></g>} />;
const IconArrowL = (p) => <Icon {...p} d={<g><path d="M19 12H5"></path><path d="m11 18-6-6 6-6"></path></g>} />;
const IconMail = (p) => <Icon {...p} d={<g><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path></g>} />;
const IconLock = (p) => <Icon {...p} d={<g><rect x="4" y="11" width="16" height="9" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></g>} />;
const IconServer = (p) => <Icon {...p} d={<g><rect x="3" y="4" width="18" height="7" rx="1.5"></rect><rect x="3" y="13" width="18" height="7" rx="1.5"></rect><path d="M7 7.5h.01M7 16.5h.01"></path></g>} />;
const IconSun = (p) => <Icon {...p} d={<g><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></g>} />;
const IconMoon = (p) => <Icon {...p} d={<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path>} />;
const IconSearch = (p) => <Icon {...p} d={<g><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.8-3.8"></path></g>} />;
const IconPen = (p) => <Icon {...p} d={<g><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></g>} />;
const IconDownload = (p) => <Icon {...p} d={<g><path d="M12 4v11"></path><path d="m7 11 5 5 5-5"></path><path d="M4 19h16"></path></g>} />;

function Spinner({ size = 16 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="loading"></span>;
}

/* ---------- Boutons / champs ---------- */
function Button({ variant = "primary", size = "md", disabled, onClick, children, style, type }) {
  return (
    <button type={type || "button"} className={"btn btn-" + variant + " btn-" + size}
      disabled={disabled} onClick={onClick} style={style}>
      {children}
    </button>
  );
}

function Field({ label, htmlFor, help, error, children, optional }) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>{label}{optional ? <span className="label-opt"> {optional}</span> : null}</label>
      {children}
      {error ? <p className="field-error">{error}</p> : (help ? <p className="help">{help}</p> : null)}
    </div>
  );
}

function Input({ id, value, onChange, placeholder, type = "text", invalid, mono, autoFocus, onEnter }) {
  return (
    <input id={id} className={"input" + (invalid ? " input-invalid" : "") + (mono ? " mono" : "")}
      type={type} value={value} placeholder={placeholder} autoFocus={autoFocus}
      autoComplete="off" spellCheck="false"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }} />
  );
}

function PasswordInput({ id, value, onChange, invalid, showLabel, hideLabel, onEnter }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <Input id={id} value={value} onChange={onChange} invalid={invalid}
        type={show ? "text" : "password"} mono onEnter={onEnter} />
      <button type="button" className="pw-toggle" onClick={() => setShow(!show)}
        aria-label={show ? hideLabel : showLabel} title={show ? hideLabel : showLabel}>
        {show ? <IconEyeOff size={15} /> : <IconEye size={15} />}
      </button>
    </div>
  );
}

function Select({ id, value, onChange, children, invalid }) {
  return (
    <div className={"select-wrap" + (invalid ? " input-invalid" : "")}>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <svg className="select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </div>
  );
}

/* ---------- Combobox (select avec recherche) ---------- */
function Combobox({ id, value, onChange, options, stickyOption, placeholder, searchPlaceholder, emptyText, invalid }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = norm(query.trim());
  const filtered = q ? options.filter((o) => norm(o).includes(q)) : options;
  const count = filtered.length + (stickyOption ? 1 : 0);

  const selectedLabel = value === "" ? null
    : (stickyOption && value === stickyOption.value) ? stickyOption.label : value;

  const openPop = () => { setOpen(true); setQuery(""); setActive(-1); };
  const pick = (v) => { onChange(v); setOpen(false); };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  // Garde l'élément actif visible dans la liste défilante (sans scrollIntoView)
  useEffect(() => {
    if (!open || active < 0 || !listRef.current) return;
    const el = listRef.current.querySelector('[data-idx="' + active + '"]');
    if (!el) return;
    const list = listRef.current;
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
    }
  }, [active, open]);

  const valueAt = (i) => (i < filtered.length ? filtered[i] : (stickyOption ? stickyOption.value : null));
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, count - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const v = active >= 0 ? valueAt(active) : (count === 1 ? valueAt(0) : null);
      if (v != null) pick(v);
    }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  const itemProps = (i, v) => ({
    "data-idx": i, role: "option", "aria-selected": value === v,
    className: "combobox-item" + (i === active ? " is-active" : "") + (value === v ? " is-selected" : ""),
    onMouseEnter: () => setActive(i),
    onMouseDown: (e) => e.preventDefault(),
    onClick: () => pick(v),
  });

  return (
    <div className="combobox" ref={rootRef}>
      <button type="button" id={id}
        className={"combobox-trigger" + (invalid ? " input-invalid" : "")}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPop())}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); openPop(); } }}>
        <span className={"combobox-value" + (selectedLabel ? "" : " is-placeholder")}>{selectedLabel || placeholder}</span>
        <svg className="combobox-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      {open ? (
        <div className="combobox-pop">
          <div className="combobox-search">
            <IconSearch size={14} />
            <input ref={inputRef} className="combobox-search-input" value={query}
              placeholder={searchPlaceholder} autoComplete="off" spellCheck="false"
              role="combobox" aria-expanded="true" aria-controls={id + "-list"}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKey} />
          </div>
          <div className="combobox-list" id={id + "-list"} ref={listRef} role="listbox">
            {filtered.length === 0 ? <p className="combobox-empty">{emptyText}</p> : null}
            {filtered.map((o, i) => (
              <div key={o} {...itemProps(i, o)}>
                <span className="combobox-item-label">{o}</span>
                {value === o ? <IconCheck size={14} /> : null}
              </div>
            ))}
          </div>
          {stickyOption ? (
            <div className="combobox-footer">
              <div {...itemProps(filtered.length, stickyOption.value)}
                className={itemProps(filtered.length, stickyOption.value).className + " combobox-item-sticky"}>
                <span className="combobox-sticky-icon"><IconPen size={13} /></span>
                <span className="combobox-sticky-text">
                  <span className="combobox-item-label">{stickyOption.label}</span>
                  {stickyOption.hint ? <span className="combobox-sticky-hint">{stickyOption.hint}</span> : null}
                </span>
                {value === stickyOption.value ? <IconCheck size={14} /> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Alertes, badges, divers ---------- */
function Alert({ variant = "info", title, children, action }) {
  const icons = { info: IconInfo, warning: IconAlert, destructive: IconAlert, success: IconCheck };
  const Ic = icons[variant] || IconInfo;
  return (
    <div className={"alert alert-" + variant} role="alert">
      <Ic size={16} style={{ marginTop: 1 }} />
      <div className="alert-body">
        {title ? <p className="alert-title">{title}</p> : null}
        {children ? <div className="alert-desc">{children}</div> : null}
        {action ? <div className="alert-action">{action}</div> : null}
      </div>
    </div>
  );
}

function Badge({ variant = "neutral", children, pulse }) {
  return (
    <span className={"badge badge-" + variant}>
      {pulse
        ? <span className="badge-spinner"></span>
        : <span className="badge-dot"></span>}
      {children}
    </span>
  );
}

function Separator() { return <div className="separator"></div>; }

function Progress({ value }) {
  return (
    <div className="progress"><div className="progress-bar" style={{ width: value + "%" }}></div></div>
  );
}

function CopyButton({ text, t, small }) {
  const [ok, setOk] = useState(false);
  const timer = useRef(null);
  const doCopy = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (e) { }
    setOk(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOk(false), 1600);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button type="button" className={"copy-btn" + (small ? " copy-btn-sm" : "")} onClick={doCopy}
      title={ok ? t("copied") : t("copy")}>
      {ok ? <IconCheck size={13} /> : <IconCopy size={13} />}
      <span>{ok ? t("copied") : t("copy")}</span>
    </button>
  );
}

function CopyIconBtn({ text, t }) {
  const [ok, setOk] = useState(false);
  const timer = useRef(null);
  const doCopy = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (e) { }
    setOk(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOk(false), 1600);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button type="button" className={"copy-icon-btn" + (ok ? " is-ok" : "")} onClick={doCopy}
      title={ok ? t("copied") : t("copy")} aria-label={t("copy")}>
      {ok ? <IconCheck size={12} /> : <IconCopy size={12} />}
    </button>
  );
}

function DownloadButton({ content, filename, label, small }) {
  const doDownload = () => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <button type="button" className={"copy-btn" + (small ? " copy-btn-sm" : "")} onClick={doDownload} title={label}>
      <IconDownload size={13} />
      <span>{label}</span>
    </button>
  );
}

/* ---------- Mètre de force ---------- */
function scorePassword(pw) {
  if (!pw) return 0;
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^a-zA-Z0-9]/.test(pw)) classes++;
  if (pw.length < 8) return 0;
  if (pw.length < 11 || classes < 2) return 1;
  if (pw.length < 14 || classes < 3) return 2;
  return 3;
}
function StrengthMeter({ password, t }) {
  const score = scorePassword(password);
  const labels = [t("a_str0"), t("a_str1"), t("a_str2"), t("a_str3")];
  const colors = ["var(--destructive)", "var(--warning)", "var(--warning)", "var(--success)"];
  return (
    <div className="strength" aria-hidden={!password}>
      <div className="strength-bars">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="strength-bar"
            style={{ background: password && i <= score ? colors[score] : "var(--border)" }}></div>
        ))}
      </div>
      <span className="strength-label" style={{ color: password ? colors[score] : "var(--muted-foreground)" }}>
        {password ? labels[score] : "\u00A0"}
      </span>
    </div>
  );
}

/* ---------- Statut DNS / tâche ---------- */
function StatusBadge({ status, t }) {
  if (status === "verified") return <Badge variant="success">{t("st_verified")}</Badge>;
  if (status === "error") return <Badge variant="destructive">{t("st_error")}</Badge>;
  return <Badge variant="pending" pulse>{t("st_pending")}</Badge>;
}

/* ---------- Steppers ---------- */
// steps: [{n, label, group}] · current: numéro d'étape courant
function StepperH({ steps, current, t }) {
  const groups = [
    { id: "config", label: t("groupConfig") },
    { id: "activation", label: t("groupActivation") },
  ];
  return (
    <div className="stepper-h">
      {groups.map((g, gi) => (
        <div key={g.id} className={"stepper-h-group" + (gi > 0 ? " stepper-h-group-sep" : "")}>
          <span className={"stepper-h-glabel" + (steps.some(s => s.group === g.id && s.n === current) ? " is-current" : "")}>{g.label}</span>
          <div className="stepper-h-dots">
            {steps.filter(s => s.group === g.id).map((s) => {
              const state = s.n < current ? "done" : s.n === current ? "current" : "todo";
              return (
                <div key={s.n} className={"step-dot step-dot-" + state} title={s.label}>
                  {state === "done" ? <IconCheck size={11} strokeWidth={2.5} /> : s.n}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function StepperV() { return null; } // (retiré — disposition Carte retenue)

/* ---------- En-tête + navigation d'étape ---------- */
function StepHeader({ title, sub }) {
  return (
    <header className="step-header">
      <h1 className="step-title">{title}</h1>
      {sub ? <p className="step-sub">{sub}</p> : null}
    </header>
  );
}

function StepNav({ t, onBack, onNext, nextLabel, nextDisabled, busy, nextVariant }) {
  return (
    <div className="step-nav">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}><IconArrowL size={15} />{t("back")}</Button>
      ) : <span></span>}
      {onNext ? (
        <Button variant={nextVariant || "primary"} onClick={onNext} disabled={nextDisabled || busy}>
          {busy ? <Spinner size={14} /> : null}
          {nextLabel || t("next")}
          {!busy ? <IconArrowR size={15} /> : null}
        </Button>
      ) : null}
    </div>
  );
}

/* ---------- Marque ---------- */
function BrandMark({ size = 26 }) {
  return (
    <span className="brandmark" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}>
      <IconMail size={Math.round(size * 0.58)} strokeWidth={2.2} />
    </span>
  );
}
function Brand({ size = 26, muted }) {
  return (
    <span className="brand">
      <BrandMark size={size} />
      <span className="brand-name" style={{ fontSize: Math.round(size * 0.62), opacity: muted ? 0.92 : 1 }}>Stalmail</span>
    </span>
  );
}

/* ---------- Sélecteur de langue (extensible) + switch de thème ---------- */
function LangSelect({ lang, onChange }) {
  const langs = window.WIZ_LANGS || [];
  return (
    <div className="lang-select">
      <IconGlobe size={13} style={{ opacity: 0.65 }} />
      <select className="lang-select-el" value={lang} aria-label="Language"
        onChange={(e) => onChange(e.target.value)}>
        {langs.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
      <svg className="lang-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </div>
  );
}

function ThemeToggle({ dark, onChange, title }) {
  return (
    <button type="button" className="theme-toggle" onClick={() => onChange(!dark)}
      title={title} aria-label={title} aria-pressed={dark}>
      {dark ? <IconMoon size={15} /> : <IconSun size={15} />}
    </button>
  );
}

Object.assign(window, {
  IconCheck, IconAlert, IconInfo, IconCopy, IconEye, IconEyeOff, IconGlobe,
  IconArrowR, IconArrowL, IconMail, IconLock, IconServer, IconSun, IconMoon,
  IconSearch, IconPen, IconDownload, Combobox,
  Spinner, Button, Field, Input, PasswordInput, Select, Alert, Badge, Separator,
  Progress, CopyButton, CopyIconBtn, DownloadButton, scorePassword, StrengthMeter, StatusBadge,
  StepperH, StepperV, StepHeader, StepNav, Brand, BrandMark, LangSelect, ThemeToggle,
});
