import {
  AirVent,
  Bot,
  Cctv,
  Check,
  Cloud,
  Copy,
  Cpu,
  Gauge,
  HardDrive,
  House,
  Laptop,
  Magnet,
  Monitor,
  Network,
  Printer,
  Router,
  Search,
  Server,
  Smartphone,
  Speaker,
  Tablet,
  Tv,
  Watch,
  X,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { ValuePill } from "@/components/atoms/ValuePill";
import { Dot } from "@/components/data/Motion";
import type { Flow, Kind } from "@/lib/api";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

const linkCls =
  "rounded-[3px] text-ink decoration-ink-3 underline-offset-2 transition-colors duration-100 hover:text-accent-ink hover:underline";

const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
/** A device that has no hostname or friendly name is listed by its MAC. */
export const isMac = (s: string | undefined) => !!s && MAC.test(s);

// Best guess at what a device is from its name. Purely decorative: it makes a
// long list scannable, and falls back to a neutral chip.
const ICONS: [RegExp, LucideIcon][] = [
  [/iphone|phone|pixel|galaxy|android/i, Smartphone],
  [/ipad|tablet/i, Tablet],
  [/macbook|laptop|thinkpad|notebook/i, Laptop],
  [/imac|desktop|workstation|\bpc\b/i, Monitor],
  [/\btv\b|tv$|roku|chromecast|shield/i, Tv],
  [/nas|synology|qnap|truenas|storage/i, HardDrive],
  [/homeassistant|hass|home/i, House],
  [/torrent|qbit|transmission/i, Magnet],
  [/cloudflare|tunnel|proxy|vpn|remote/i, Cloud],
  [/speed/i, Gauge],
  [/midea|thermo|\bac[_-]|aircon/i, AirVent],
  [/romo|vacuum|robot|roborock/i, Bot],
  [/cam|doorbell/i, Cctv],
  [/print/i, Printer],
  [/watch/i, Watch],
  [/speaker|homepod|echo|sonos/i, Speaker],
  [/switch|unifi|ubnt|\bap\b/i, Network],
  [/server|proxmox|pve|docker|claw|\bpi\b|raspberry/i, Server],
];

export function deviceIcon(name: string | undefined, kind?: Kind): LucideIcon {
  if (kind === "router") return Router;
  if (kind === "remote") return Cloud;
  if (!name || isMac(name)) return Cpu;
  return ICONS.find(([re]) => re.test(name))?.[1] ?? Monitor;
}

/** Small square identity mark for a device. */
export function DeviceGlyph({
  name,
  kind,
  size = "sm",
  className,
}: {
  name?: string;
  kind?: Kind;
  size?: "sm" | "lg";
  className?: string;
}) {
  const Icon = deviceIcon(name, kind);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-field text-ink-2 shadow-hairline",
        size === "lg" ? "size-10 rounded-[11px]" : "size-5.5 rounded-[6px]",
        className,
      )}
    >
      <Icon size={size === "lg" ? 19 : 12.5} strokeWidth={size === "lg" ? 1.6 : 1.8} />
    </span>
  );
}

export function DeviceLink({
  k,
  name,
  className,
  kind,
  glyph = false,
}: {
  k: string;
  name?: string;
  className?: string;
  kind?: Kind;
  /** lead with the device's identity mark */
  glyph?: boolean;
}) {
  const label = name || k;
  const link = (
    <a href={href.device(k)} className={cn(linkCls, "font-medium", isMac(label) && "num text-[12px] font-normal", className)}>
      {label}
    </a>
  );
  if (!glyph) return link;
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-2 align-middle">
      <DeviceGlyph name={label} kind={kind} />
      <span className="min-w-0 truncate">{link}</span>
    </span>
  );
}

/** A destination with no sniffed domain is listed by its address. */
export const isIp = (s: string | undefined) => !!s && (/^\d{1,3}(\.\d{1,3}){3}$/.test(s) || (s.includes(":") && /^[0-9a-f:.]+$/i.test(s)));

/** Where the registrable part of a host name starts ("…googlevideo.com"). */
function suffixAt(host: string): number {
  const parts = host.split(".");
  if (parts.length < 3) return 0;
  // co.uk, com.cn and the like take one more label
  const n = parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3 ? 3 : 2;
  return host.length - parts.slice(-n).join(".").length;
}

export function TargetLink({
  target,
  className,
  keepSuffix = false,
}: {
  target: string;
  className?: string;
  /** when cut short, cut the subdomain and keep the site ("rr3---sn-…googlevideo.com"); needs a flex parent */
  keepSuffix?: boolean;
}) {
  const cut = keepSuffix && !isIp(target) ? suffixAt(target) : 0;
  if (cut > 0) {
    return (
      <a href={href.domain(target)} title={target} className={cn(linkCls, "flex", className)}>
        <span className="truncate">{target.slice(0, cut)}</span>
        <span className="shrink-0">{target.slice(cut)}</span>
      </a>
    );
  }
  return (
    <a href={href.domain(target)} title={target} className={cn(linkCls, keepSuffix && "truncate", isIp(target) && "num text-[12px]", className)}>
      {target}
    </a>
  );
}

// Neutral on purpose: blue and orange are spoken for (download, upload).
const KIND_TONE: Record<Kind, "neutral"> = { lan: "neutral", router: "neutral", remote: "neutral", unknown: "neutral" };

export function KindPill({ kind }: { kind: Kind }) {
  if (kind === "lan") return null;
  return (
    <ValuePill tone={KIND_TONE[kind]} className="ml-1.5 text-[10.5px]!">
      {kind}
    </ValuePill>
  );
}

/** Flows recorded from router conntrack never passed through sing-box. */
export function SourcePill({ flow }: { flow: Flow }) {
  if (flow.source !== "conntrack") return null;
  return (
    <span title="from router conntrack (not seen by sing-box)">
      <ValuePill className="ml-1.5 font-mono text-[10.5px]!">{flow.inbound}</ValuePill>
    </span>
  );
}

/** "Open connections" indicator: a status dot that always ships with its count. */
export function OpenDot({ n }: { n: number | undefined }) {
  if (!n) return <span className="text-ink-3">–</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <Dot />
      {n.toLocaleString()}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[11.5px] tracking-[-0.02em] text-ink-2", className)}>{children}</span>;
}

/** Filter field in the Beautiful UI search style. */
export function FilterInput({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
  title,
  onFocusChange,
}: {
  title?: string;
  onFocusChange?: (focused: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <label
      title={title}
      className={cn(
        "flex h-7.5 w-56 cursor-text! items-center gap-1.5 rounded-control bg-field px-2.5 shadow-hairline transition-shadow duration-150 max-md:h-9 max-md:w-full! max-md:flex-1 max-md:basis-full focus-within:shadow-[0_0_0_1.5px_var(--accent),0_0_0_4px_var(--accent-tint)]",
        className,
      )}
    >
      <Search size={13} className="shrink-0 text-ink-3" aria-hidden />
      <input
        value={value}
        autoFocus={autoFocus}
        onFocus={onFocusChange && (() => onFocusChange(true))}
        onBlur={onFocusChange && (() => onFocusChange(false))}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3 max-md:text-[16px]"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear filter"
          onClick={() => onChange("")}
          className="flex size-4 items-center justify-center rounded-full text-ink-3 hover:bg-hover-2 hover:text-ink"
        >
          <X size={11} aria-hidden />
        </button>
      )}
    </label>
  );
}

const thumbSpring = { type: "spring", stiffness: 520, damping: 40, mass: 0.8 } as const;

export type Chip<K extends string> = { key: K; label: string; count?: number };

/** Filter chips: one row, counts inline, the selection glides between chips. */
export function Chips<K extends string>({
  chips,
  value,
  onChange,
  label,
}: {
  chips: Chip<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div role="group" aria-label={label} className="flex w-max items-center gap-0.5">
      {chips.map((c) => {
        const active = c.key === value;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(c.key)}
            className={cn(
              "relative flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors duration-150 max-md:h-10 max-md:px-3.5 max-md:text-[13px]",
              active ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={id}
                transition={thumbSpring}
                className="absolute inset-0 rounded-full bg-surface shadow-btn dark:bg-hover-2 dark:shadow-[inset_0_1px_0_oklch(1_0_0/0.07)]"
              />
            )}
            <span className="relative">{c.label}</span>
            {c.count !== undefined && (
              <span className={cn("num relative text-[10.5px]", active ? "text-ink-2" : "text-ink-3")}>{c.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control (range picker, chart/table switch) with a sliding thumb. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly { id: K; label: ReactNode; title?: string }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex items-center rounded-control bg-hover-2/70 p-0.5 shadow-[inset_0_0_0_1px_var(--line-soft)] dark:bg-black/25", className)}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            title={o.title}
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={cn(
              "relative flex h-6.5 min-w-8 items-center justify-center rounded-[6px] px-2 text-[12px] font-medium transition-colors duration-150 max-md:h-10 max-md:min-w-10 max-md:px-3 max-md:text-[13px]",
              active ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={id}
                transition={thumbSpring}
                className="absolute inset-0 rounded-[6px] bg-surface shadow-btn dark:bg-hover-2 dark:shadow-[inset_0_1px_0_oklch(1_0_0/0.08),0_1px_2px_oklch(0_0_0/0.3)]"
              />
            )}
            <span className="relative flex items-center">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A formatted size or rate ("22.3 GB", "3.12 KB/s") set as a figure: the unit
 * is quieter than the number and sits in a fixed box, so a right-aligned
 * column lines its numbers up whatever the unit. Zero recedes.
 */
export function Fig({ children, className }: { children: string; className?: string }) {
  const cut = children.lastIndexOf(" ");
  if (cut < 0) return <span className={className}>{children}</span>;
  const value = children.slice(0, cut);
  const unit = children.slice(cut + 1);
  const zero = Number(value) === 0;
  // Magnitude at a glance: gigabytes stand out, kilobytes recede.
  const tier = /^[GT]B/.test(unit) ? "font-medium text-ink" : /^(K?B)/.test(unit) ? "text-ink-2" : "";
  return (
    <span className={cn("num whitespace-nowrap", zero ? "text-ink-3" : tier, className)}>
      {value}
      <span
        className={cn(
          "ml-[2px] inline-block text-left text-[0.9em] font-normal",
          /^[GT]B/.test(unit) ? "text-ink-2" : "text-ink-3",
          unit.endsWith("/s") ? "w-[4ch]" : "w-[2ch]",
        )}
      >
        {unit}
      </span>
    </span>
  );
}

/** On/off switch for a table option. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group/toggle flex h-7 items-center gap-2 rounded-full px-1.5 text-[12px] whitespace-nowrap text-ink-2 transition-colors hover:text-ink max-md:h-10"
    >
      <span
        aria-hidden
        className={cn(
          "relative h-4 w-7 rounded-full transition-colors duration-200",
          checked ? "bg-accent" : "bg-hover-2 shadow-[inset_0_0_0_1px_var(--line-strong)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-[0_1px_2px_oklch(0_0_0/0.3)] transition-transform duration-200 ease-out-strong",
            checked && "translate-x-3",
          )}
        />
      </span>
      {label}
    </button>
  );
}

function copyText(text: string) {
  if (navigator.clipboard && isSecureContext) return navigator.clipboard.writeText(text);
  // http://lan-address is not a secure context: fall back to a selection copy.
  const t = document.createElement("textarea");
  t.value = text;
  t.setAttribute("readonly", "");
  t.className = "fixed -top-96 opacity-0";
  document.body.appendChild(t);
  t.select();
  document.execCommand("copy");
  t.remove();
  return Promise.resolve();
}

/** A labelled value (MAC, IP) that copies itself when clicked. */
export function CopyChip({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${label.toLowerCase()}`}
      onClick={() => {
        void copyText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
      className="group/copy flex h-6.5 max-md:h-9 items-center gap-1.5 rounded-full bg-field pr-2 pl-2.5 text-[11.5px] shadow-hairline transition-colors duration-100 hover:bg-hover-2"
    >
      <span className="text-ink-3">{label}</span>
      <span className={cn("text-ink", mono && "num text-[11.5px]")}>{value}</span>
      <span aria-hidden className={cn("flex text-ink-3 transition-colors group-hover/copy:text-ink-2", done && "text-green group-hover/copy:text-green")}>
        {done ? <Check size={11} /> : <Copy size={11} />}
      </span>
      <span className="sr-only" role="status">
        {done ? "Copied" : ""}
      </span>
    </button>
  );
}

/** A labelled value that is not worth copying (dates, counts). */
export function MetaChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex h-6.5 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] shadow-hairline max-md:h-9">
      <span className="text-ink-3">{label}</span>
      <span className="text-ink-2 tabular-nums">{children}</span>
    </span>
  );
}
