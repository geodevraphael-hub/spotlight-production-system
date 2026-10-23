"use client";

import { Children, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";

type Option = { value: string; label: string; disabled: boolean };

function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return "";
}

// Collect the <option> children (including those produced by .map()/fragments) so
// the searchable popup can mirror exactly what a native <select> would show.
function collectOptions(children: ReactNode, out: Option[]) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "option") {
      const props = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean };
      const label = nodeText(props.children);
      const value = props.value !== undefined ? String(props.value) : label;
      out.push({ value, label: label || value, disabled: Boolean(props.disabled) });
    } else {
      const props = child.props as { children?: ReactNode };
      if (props && props.children) collectOptions(props.children, out);
    }
  });
}

type SearchSelectProps = {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: { target: { value: string }; currentTarget: { value: string }; value: string }) => void;
  onFocus?: () => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
  "aria-label"?: string;
};

export default function SearchSelect({ value, defaultValue, onChange, onFocus, name, required, disabled, className, children, "aria-label": ariaLabel }: SearchSelectProps) {
  const options = useMemo(() => { const out: Option[] = []; collectOptions(children, out); return out; }, [children]);
  const controlled = value !== undefined;
  const [internal, setInternal] = useState<string>(() => (defaultValue !== undefined ? String(defaultValue) : options[0]?.value ?? ""));
  const current = controlled ? String(value) : internal;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    searchRef.current?.focus();
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const selected = options.find((option) => option.value === current);
  const filtered = query ? options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase())) : options;

  function choose(next: string) {
    if (!controlled) setInternal(next);
    setOpen(false);
    setQuery("");
    onChange?.({ target: { value: next }, currentTarget: { value: next }, value: next });
    // Keep the hidden native select in sync so its constraint validation reflects the pick.
    if (mirror.current) mirror.current.value = next;
  }

  return (
    <div className={`search-select${disabled ? " search-select--disabled" : ""}${className ? ` ${className}` : ""}`} ref={container}>
      {/* A real, focusable-but-hidden native select preserves FormData submission and required validation. */}
      <select
        ref={mirror}
        className="search-select-native"
        name={name}
        required={required}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
        value={current}
        onChange={() => { /* driven by the popup */ }}
      >
        {children}
      </select>
      <button
        type="button"
        className="search-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onFocus={onFocus}
        onClick={() => { onFocus?.(); setOpen((value) => !value); }}
      >
        <span className={selected && selected.value !== "" ? "" : "search-select-placeholder"}>{selected ? selected.label : (options[0]?.label ?? "Select")}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="search-select-panel" role="listbox" aria-label={ariaLabel}>
          <div className="search-select-search">
            <Search size={14} aria-hidden="true" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search…" aria-label="Filter options" />
          </div>
          <ul>
            {filtered.map((option) => (
              <li key={option.value}>
                <button type="button" role="option" aria-selected={option.value === current} disabled={option.disabled} className={option.value === current ? "is-selected" : undefined} onClick={() => choose(option.value)}>
                  {option.label || "—"}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="search-select-empty">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
