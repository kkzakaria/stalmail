// Stalmail wizard — core UI primitives.
// Ports the design prototype (docs/design/wizard-handoff/project/wizard/ui.jsx)
// to typed TSX backed by the scoped classes in wizard.css. All visible text is
// passed in via props; i18n is resolved by callers.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  IconArrowL,
  IconArrowR,
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconInfo,
  IconAlert,
  IconMail,
} from './icons'

/* ---------- Spinner ---------- */
export interface SpinnerProps {
  size?: number
}

export function Spinner({ size = 16 }: SpinnerProps) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      aria-label="loading"
    />
  )
}

/* ---------- Button ---------- */
export type ButtonVariant = 'primary' | 'outline' | 'ghost'
export type ButtonSize = 'md' | 'lg' | 'sm'

export interface ButtonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
  style?: CSSProperties
}

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled,
  onClick,
  children,
  style,
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size}`}
      disabled={disabled}
      onClick={onClick}
      style={style}
    >
      {children}
    </button>
  )
}

/* ---------- Field ---------- */
export interface FieldProps {
  label: string
  htmlFor?: string
  help?: string
  error?: string
  optional?: string
  children: ReactNode
}

export function Field({
  label,
  htmlFor,
  help,
  error,
  optional,
  children,
}: FieldProps) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="label-opt"> {optional}</span> : null}
      </label>
      {children}
      {error ? (
        <p className="field-error">{error}</p>
      ) : help ? (
        <p className="help">{help}</p>
      ) : null}
    </div>
  )
}

/* ---------- TextInput ---------- */
export interface TextInputProps {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password' | 'email'
  invalid?: boolean
  mono?: boolean
  autoFocus?: boolean
  onEnter?: () => void
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
  invalid,
  mono,
  autoFocus,
  onEnter,
}: TextInputProps) {
  return (
    <input
      id={id}
      className={`input${invalid ? ' input-invalid' : ''}${mono ? ' mono' : ''}`}
      type={type}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) onEnter()
      }}
    />
  )
}

/* ---------- PasswordInput ---------- */
export interface PasswordInputProps {
  id?: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  showLabel: string
  hideLabel: string
  onEnter?: () => void
}

export function PasswordInput({
  id,
  value,
  onChange,
  invalid,
  showLabel,
  hideLabel,
  onEnter,
}: PasswordInputProps) {
  const [show, setShow] = useState(false)
  const label = show ? hideLabel : showLabel
  return (
    <div className="pw-wrap">
      <TextInput
        id={id}
        value={value}
        onChange={onChange}
        invalid={invalid}
        type={show ? 'text' : 'password'}
        mono
        onEnter={onEnter}
      />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShow((s) => !s)}
        aria-label={label}
        title={label}
      >
        {show ? <IconEyeOff size={15} /> : <IconEye size={15} />}
      </button>
    </div>
  )
}

/* ---------- NativeSelect ---------- */
export interface NativeSelectProps {
  id?: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  children: ReactNode
}

export function NativeSelect({
  id,
  value,
  onChange,
  invalid,
  children,
}: NativeSelectProps) {
  return (
    <div className={`select-wrap${invalid ? ' input-invalid' : ''}`}>
      <select
        id={id}
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      <svg
        className="select-chevron"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  )
}

/* ---------- Alert ---------- */
export type AlertVariant = 'info' | 'warning' | 'destructive' | 'success'

export interface AlertProps {
  variant?: AlertVariant
  title?: string
  children?: ReactNode
  action?: ReactNode
}

const ALERT_ICONS: Record<
  AlertVariant,
  (props: { size?: number; style?: CSSProperties }) => ReactNode
> = {
  info: IconInfo,
  warning: IconAlert,
  destructive: IconAlert,
  success: IconCheck,
}

export function Alert({ variant = 'info', title, children, action }: AlertProps) {
  const Ic = ALERT_ICONS[variant]
  return (
    <div className={`alert alert-${variant}`} role="alert">
      <Ic size={16} style={{ marginTop: 1 }} />
      <div className="alert-body">
        {title ? <p className="alert-title">{title}</p> : null}
        {children ? <div className="alert-desc">{children}</div> : null}
        {action ? <div className="alert-action">{action}</div> : null}
      </div>
    </div>
  )
}

/* ---------- Badge ---------- */
export type BadgeVariant =
  | 'neutral'
  | 'success'
  | 'destructive'
  | 'pending'

export interface BadgeProps {
  variant?: BadgeVariant
  pulse?: boolean
  children: ReactNode
}

export function Badge({ variant = 'neutral', pulse, children }: BadgeProps) {
  return (
    <span className={`badge badge-${variant}`}>
      {pulse ? (
        <span className="badge-spinner" />
      ) : (
        <span className="badge-dot" />
      )}
      {children}
    </span>
  )
}

/* ---------- Separator ---------- */
export function Separator() {
  return <div className="separator" />
}

/* ---------- Progress ---------- */
export interface ProgressProps {
  value?: number
  indeterminate?: boolean
}

export function Progress({ value = 0, indeterminate }: ProgressProps) {
  return (
    <div className={`progress${indeterminate ? ' progress-indeterminate' : ''}`}>
      <div
        className="progress-bar"
        style={indeterminate ? undefined : { width: `${value}%` }}
      />
    </div>
  )
}

/* ---------- CopyButton ---------- */
export interface CopyButtonProps {
  text: string
  label: string
  copiedLabel: string
  small?: boolean
}

export function CopyButton({ text, label, copiedLabel, small }: CopyButtonProps) {
  const [ok, setOk] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const doCopy = () => {
    // writeText is called synchronously; Promise.resolve normalizes its result so the
    // async rejection (denied permission / unavailable clipboard) is caught and never
    // becomes an unhandled rejection.
    void Promise.resolve(navigator.clipboard.writeText(text)).catch(() => {
      // ignore.
    })
    setOk(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOk(false), 1600)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const current = ok ? copiedLabel : label
  return (
    <button
      type="button"
      className={`copy-btn${small ? ' copy-btn-sm' : ''}`}
      onClick={doCopy}
      title={current}
    >
      {ok ? <IconCheck size={13} /> : <IconCopy size={13} />}
      <span>{current}</span>
    </button>
  )
}

/* ---------- StepHeader ---------- */
export interface StepHeaderProps {
  title: string
  sub?: string
}

export function StepHeader({ title, sub }: StepHeaderProps) {
  return (
    <header className="step-header">
      <h1 className="step-title">{title}</h1>
      {sub ? <p className="step-sub">{sub}</p> : null}
    </header>
  )
}

/* ---------- StepNav ---------- */
export interface StepNavProps {
  onBack?: () => void
  onNext?: () => void
  backLabel: string
  nextLabel: string
  nextDisabled?: boolean
  busy?: boolean
  nextVariant?: ButtonVariant
}

export function StepNav({
  onBack,
  onNext,
  backLabel,
  nextLabel,
  nextDisabled,
  busy,
  nextVariant = 'primary',
}: StepNavProps) {
  return (
    <div className="step-nav">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          <IconArrowL size={15} />
          {backLabel}
        </Button>
      ) : (
        <span />
      )}
      {onNext ? (
        <Button
          variant={nextVariant}
          onClick={onNext}
          disabled={nextDisabled || busy}
        >
          {busy ? <Spinner size={14} /> : null}
          {nextLabel}
          {!busy ? <IconArrowR size={15} /> : null}
        </Button>
      ) : null}
    </div>
  )
}

/* ---------- Brand ---------- */
export interface BrandMarkProps {
  size?: number
}

export function BrandMark({ size = 26 }: BrandMarkProps) {
  return (
    <span
      className="brandmark"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
      }}
    >
      <IconMail size={Math.round(size * 0.58)} strokeWidth={2.2} />
    </span>
  )
}

export interface BrandProps {
  size?: number
  muted?: boolean
}

export function Brand({ size = 26, muted }: BrandProps) {
  return (
    <span className="brand">
      <BrandMark size={size} />
      <span
        className="brand-name"
        style={{ fontSize: Math.round(size * 0.62), opacity: muted ? 0.92 : 1 }}
      >
        Stalmail
      </span>
    </span>
  )
}
