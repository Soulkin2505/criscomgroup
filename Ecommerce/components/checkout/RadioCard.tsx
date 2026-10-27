"use client"

// Tarjeta-radio accesible: toda la tarjeta es el objetivo (>=64px).
import type { LucideIcon } from "lucide-react"

interface RadioCardProps {
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  icon: LucideIcon
  title: string
  sub: string
  disabled?: boolean
}

const RadioCard = ({ name, value, checked, onChange, icon: Icon, title, sub, disabled }: RadioCardProps) => (
  <label className={`rc${disabled ? " rc-disabled" : ""}`} aria-disabled={disabled || undefined}>
    <input
      type="radio"
      name={name}
      value={value}
      checked={checked}
      disabled={disabled}
      onChange={() => onChange(value)}
    />
    <span className="rcic"><Icon className="ck-ic" aria-hidden /></span>
    <span className="rct"><b>{title}</b><span>{sub}</span></span>
    <span className="dot" aria-hidden />
  </label>
)

export default RadioCard
