import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SankeyData } from "recharts";
import { SplitBar } from "@/components/data/Bars";
import { Fig, isIp, isMac } from "@/components/data/Bits";
import { Empty } from "@/components/data/Card";
import type { Device, Link, TargetStat } from "@/lib/api";
import { bytes } from "@/lib/format";
import { useNarrow } from "@/lib/media";
import { CATEGORICAL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { go, href } from "@/lib/router";
import { EvilSankeyChart } from "@/registry/charts/recharts-sankey-chart";
import type { ChartConfig } from "@/registry/ui/recharts-chart";

// Device nodes take the categorical slots (blue and orange are left to mean
// download and upload); destinations and the two "other" buckets stay neutral
// so the ribbons, colored by their source device, carry the identity.
const DEVICE_COLORS = CATEGORICAL.map((c) => ({ light: [c.light], dark: [c.dark] }));
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
  // ~6.4px per character at 12px, plus room for the value that follows. The
  // margins are no wider than the longest label needs, so the ribbons get the
  // rest of the card.
  const need = (names: string[], extra: number) => Math.max(0, ...names.map((n) => n.length)) * 6.4 + extra;
  const left = Math.round(
    Math.min(210, Math.max(108, width * 0.3), need(["Other devices", ...devices.slice(0, DEVICE_COLORS.length).map((d) => d.name)], width < 480 ? 16 : 70)),
  );
  const right = Math.round(
    Math.min(250, Math.max(130, width * 0.38), need(["Other destinations", ...targets.map((t) => clip(t.target, 26))], width < 480 ? 18 : 74)),
  );
  // On a phone there is no room for a value beside each name: the names get
  // the margin, and the amounts are in the two lists below the chart.
  const tight = width < 480;
  const leftChars = Math.max(6, Math.floor((left - (tight ? 12 : 62)) / 6.4));
  const rightChars = Math.max(6, Math.floor((right - (tight ? 14 : 66)) / 6.4));

  const model = useMemo(() => {
    const config: ChartConfig = {};
    const nodes: { name: string }[] = [];
    const index = new Map<string, number>();
    const add = (id: string, label: string, colors: ChartConfig[string]["colors"]) => {
      index.set(id, nodes.length);
      nodes.push({ name: id });
      config[id] = { label, colors };
    };
    // Links under 0.3% of the total would draw as sub-pixel scratches; they are
    // left out, so a node's ribbons can fall a hair short of its figure.
    const all = (links ?? []).filter((l) => l.up + l.down > 0);
    const floor = all.reduce((a, l) => a + l.up + l.down, 0) * 0.003;
    const rows = all.filter((l) => l.up + l.down >= floor);
    const usedDevices = new Set(rows.map((l) => l.device_key));
    const usedTargets = new Set(rows.map((l) => l.target));

    // Node ids are synthetic (d0, t0, …): they become CSS custom property
    // names, which MAC addresses and domain names cannot be.
    // Color follows the device, not its rank: slots go to the shown devices in
    // key order, so a device keeps its color while the same set is on screen
    // even when traffic reorders the list.
    const shown = devices.filter((d) => usedDevices.has(d.key)).slice(0, DEVICE_COLORS.length);
    const slotOf = new Map([...shown].sort((a, b) => (a.key < b.key ? -1 : 1)).map((d, i) => [d.key, i]));
    for (const d of shown) add(`d:${d.key}`, clip(d.name, leftChars), DEVICE_COLORS[slotOf.get(d.key)!]);
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
    // Where a click on a node leads: the device or destination page. The two
    // "Other" buckets lead to the full lists.
    const links2: Record<string, string> = {};
    const finalNodes = nodes.map((n) => {
      const name = rename(n.name);
      finalConfig[name] = config[n.name];
      const key = n.name.slice(2);
      links2[name] = n.name.startsWith("d:") ? (key ? href.device(key) : href.devices) : key ? href.domain(key) : href.domains;
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
    return { data, config: finalConfig, hrefs: links2 };
  }, [links, devices, targets, leftChars, rightChars]);

  const narrow = useNarrow();
  if (narrow) return <TopPairs links={links} devices={devices} />;

  return (
    <div ref={ref} className="h-full w-full">
      {model.data.links.length === 0 ? <Empty>No traffic in this range.</Empty> : (
    <EvilSankeyChart
      data={model.data}
      config={model.config}
      nodeWidth={6}
      nodePadding={16}
      sort={false}
      className="aspect-auto h-full w-full"
      sankeyProps={{ margin: { top: 8, bottom: 8, left, right } }}
    >
      <EvilSankeyChart.Node radius={3} selectOnHover onNodeClick={(name) => go(model.hrefs[name])}>
        <EvilSankeyChart.NodeLabel position="outside" showValues={!tight} inlineValues valueFormatter={bytes} />
      </EvilSankeyChart.Node>
      <EvilSankeyChart.Link variant="source" verticalPadding={1} />
      <EvilSankeyChart.Tooltip valueFormatter={bytes} />
    </EvilSankeyChart>
      )}
    </div>
  );
}

/**
 * The same question on a phone, where ribbons and two columns of labels do
 * not fit: the heaviest device and destination pairs, ranked.
 */
function TopPairs({ links, devices }: { links: Link[] | null; devices: Device[] }) {
  const rows = (links ?? [])
    .filter((l) => l.device_key && l.target && l.up + l.down > 0)
    .sort((a, b) => b.up + b.down - (a.up + a.down))
    .slice(0, 6);
  if (rows.length === 0) return <Empty>No traffic in this range.</Empty>;
  const max = rows[0].up + rows[0].down;
  const names = new Map(devices.map((d) => [d.key, d.name]));
  return (
    <ul className="-mb-1.5">
      {rows.map((l) => {
        const name = names.get(l.device_key) || l.device_key;
        return (
          <li key={l.device_key + "\n" + l.target} className="border-b border-line-soft last:border-b-0">
            <a href={href.device(l.device_key)} className="flex flex-col gap-1.5 py-2.5 active:opacity-70">
              <span className="flex items-center gap-1.5 text-[13px]">
                <span className={cn("max-w-[42%] shrink-0 truncate font-medium text-ink", isMac(name) && "num text-[12px] font-normal")}>{name}</span>
                <span aria-hidden className="shrink-0 text-ink-3">
                  →
                </span>
                <span className={cn("min-w-0 flex-1 truncate text-ink-2", isIp(l.target) && "num text-[12px]")}>{l.target}</span>
                <Fig className="shrink-0 pl-1.5 text-[12.5px]">{bytes(l.up + l.down)}</Fig>
              </span>
              <SplitBar down={l.down} up={l.up} max={max} className="h-1" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
