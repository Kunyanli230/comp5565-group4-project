import { Children, cloneElement, isValidElement, type ReactElement, type ButtonHTMLAttributes, type ReactNode, useId, useState } from 'react';
import { Check, Copy, Info, AlertCircle, CheckCircle2 } from 'lucide-react';

export function PageHeader({ eyebrow, title, description, children }: {
  eyebrow?: string; title: string; description?: string; children?: ReactNode;
}) {
  return <header className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}
    <h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{children}</header>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  let assigned = false;
  function annotate(nodes: ReactNode): ReactNode {
    return Children.map(nodes, child => {
      if (!isValidElement(child)) return child;
      const element = child as ReactElement<{ id?: string; children?: ReactNode; 'aria-describedby'?: string }>;
      if (!assigned && ['input', 'textarea', 'select'].includes(String(element.type))) {
        assigned = true;
        return cloneElement(element, { id, 'aria-describedby': hint ? `${id}-hint` : undefined });
      }
      return element.props.children ? cloneElement(element, {}, annotate(element.props.children)) : element;
    });
  }
  return <div className="field"><label className="field-label" htmlFor={id}>{label}</label>{annotate(children)}{hint && <span className="field-hint" id={`${id}-hint`}>{hint}</span>}</div>;
}

export function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props}>{children}</button>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'success' ? CheckCircle2 : Info;
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><Icon size={18} aria-hidden="true" /><div>{children}</div></div>;
}

export function Address({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <span className="address"><code title={value}>{value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value}</code>
    <button type="button" className="icon-button" aria-label={`Copy address ${value}`} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); }
      catch { setCopied(false); }
    }}>{copied ? <Check size={13} /> : <Copy size={13} />}</button></span>;
}
