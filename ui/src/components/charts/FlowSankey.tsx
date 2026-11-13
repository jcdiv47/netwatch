import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SankeyData } from "recharts";
import { Empty } from "@/components/data/Card";
import type { Device, Link, TargetStat } from "@/lib/api";
import { bytes } from "@/lib/format";
import { EvilSankeyChart } from "@/registry/charts/recharts-sankey-chart";
import type { ChartConfig } from "@/registry/ui/recharts-chart";

// Device nodes take the categorical slots in fixed order (validated as a set
// in both themes); destinations and the two "other" buckets stay neutral so
// the ribbons, colored by their source device, carry the identity.
const DEVICE_COLORS = [
  { light: ["#2a78d6"], dark: ["#3987e5"] },
  { light: ["#eb6834"], dark: ["#d95926"] },
  { light: ["#1baf7a"], dark: ["#199e70"] },
  { light: ["#eda100"], dark: ["#c98500"] },
  { light: ["#e87ba4"], dark: ["#d55181"] },
  { light: ["#008300"], dark: ["#008300"] },
];
const NEUTRAL = { light: ["#898781"], dark: ["#898781"] };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * Who talks to what: the heaviest devices on the left, the heaviest
 * destinations on the right, everything else folded into "Other" on each side
 * so the ribbons always add up to the range total.
 */
export function FlowSankey({
  links,
  devices,
  targets,
}: {
  links: Link[] | null;
  devices: Device[];
  targets: TargetStat[];
}) {
  // Labels sit in the side margins, so the margins (and how much of each name
  // fits) follow the card's width.
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const left = Math.round(Math.min(210, Math.max(120, width * 0.3)));
  const right = Math.round(Math.min(280, Math.max(130, width * 0.38)));
  // ~6.4px per character at 12px, less room for the value that follows.
  const leftChars = Math.max(6, Math.floor((left - 70) / 6.4));
  const rightChars = Math.max(6, Math.floor((right - 76) / 6.4));

  const model = useMemo(() => {
    const config: ChartConfig = {};
    const nodes: { name: string }[] = [];
    const index = new Map<string, number>();
    const add = (id: string, label: string, colors: ChartConfig[string]["colors"]) => {
      index.set(id, nodes.length);
      nodes.push({ name: id });
      config[id] = { label, colors };
    };
    const rows = (links ?? []).filter((l) => l.up + l.down > 0);
    const usedDevices = new Set(rows.map((l) => l.device_key));
    const usedTargets = new Set(rows.map((l) => l.target));

    // Node ids are synthetic (d0, t0, …): they become CSS custom property
    // names, which MAC addresses and domain names cannot be.
    let slot = 0;
    for (const d of devices) {
      if (!usedDevices.has(d.key) || slot >= DEVICE_COLORS.length) continue;
      add(`d:${d.key}`, clip(d.name, leftChars), DEVICE_COLORS[slot++]);
    }
    if (usedDevices.has("")) add("d:", clip("Other devices", leftChars), NEUTRAL);
    for (const t of targets) {
      if (usedTargets.has(t.target)) add(`t:${t.target}`, clip(t.target, rightChars), NEUTRAL);
    }
    if (usedTargets.has("")) add("t:", clip("Other destinations", rightChars), NEUTRAL);

    const renamed = new Map<string, string>();
    const rename = (id: string) => {
      let v = renamed.get(id);
      if (!v) {
        v = (id.startsWith("d:") ? "d" : "t") + renamed.size;
        renamed.set(id, v);
      }
      return v;
    };
    const finalConfig: ChartConfig = {};
    const finalNodes = nodes.map((n) => {
      const name = rename(n.name);
      finalConfig[name] = config[n.name];
      return { name };
    });
    const data: SankeyData = {
      nodes: finalNodes,
      links: rows.flatMap((l) => {
        const source = index.get(`d:${l.device_key}`);
        const target = index.get(`t:${l.target}`);
        return source === undefined || target === undefined ? [] : [{ source, target, value: l.up + l.down }];
      }),
    };
    return { data, config: finalConfig };
  }, [links, devices, targets, leftChars, rightChars]);

  return (
    <div ref={ref} className="h-full w-full">
      {model.data.links.length === 0 ? <Empty>No traffic in this range.</Empty> : (
    <EvilSankeyChart
      data={model.data}
      config={model.config}
      nodeWidth={8}
      nodePadding={15}
      sort={false}
      className="aspect-auto h-full w-full"
      sankeyProps={{ margin: { top: 8, bottom: 8, left, right } }}
    >
      <EvilSankeyChart.Node radius={2} isClickable>
        <EvilSankeyChart.NodeLabel position="outside" showValues inlineValues valueFormatter={bytes} />
      </EvilSankeyChart.Node>
      <EvilSankeyChart.Link variant="source" />
      <EvilSankeyChart.Tooltip valueFormatter={bytes} />
    </EvilSankeyChart>
      )}
    </div>
  );
}
