// Owlclock: sleep, nap and light plans for rotating shifts, rebuilt whenever the rota changes.
import { useState } from "react";
import { useStored } from "./lib/store";
import { addDays, hhmm, mod24, prettyDate, toHours, todayISO } from "./lib/time";
import { DayBar, DayBarLegend, type Seg } from "./ui/DayBar";

type Kind = "D" | "E" | "L" | "N" | "O";
type ShiftDef = { name: string; start: string; end: string; color: string };
const T = "owlclock";
const DEFAULT_DEFS: Record<Kind, ShiftDef> = {
  D: { name: "Day", start: "07:00", end: "19:00", color: "#F2B400" },
  E: { name: "Early", start: "06:00", end: "14:00", color: "#00A95C" },
  L: { name: "Late", start: "14:00", end: "22:00", color: "#FF6C2F" },
  N: { name: "Night", start: "19:00", end: "07:00", color: "#3255A4" },
  O: { name: "Off", start: "", end: "", color: "#CDD2DE" },
};
const KINDS: Kind[] = ["D", "E", "L", "N", "O"];

type Plan = { date: string; kind: Kind; segs: Seg[]; notes: string[]; warn?: string };

function buildPlan(dates: string[], rota: Record<string, Kind>, defs: Record<Kind, ShiftDef>, bed: number, wake: number, commute: number): Plan[] {
  const k = (d: string): Kind => rota[d] ?? "O";
  const sleepLen = mod24(wake - bed) || 8;
  const c = commute / 60;
  return dates.map(date => {
    const kind = k(date), prev = k(addDays(date, -1)), next = k(addDays(date, 1));
    const def = defs[kind];
    const segs: Seg[] = [], notes: string[] = [];
    let warn: string | undefined;
    const s = toHours(def.start || "00:00"), e = toHours(def.end || "00:00");

    // Morning after a night shift: recover first.
    if (prev === "N") {
      const pe = toHours(defs.N.end);
      segs.push({ start: pe, end: pe + c, kind: "dark" });
      if (kind === "N") {
        segs.push({ start: pe + c + 0.5, end: pe + c + 7.5, kind: "sleep" });
        notes.push(`Wear sunglasses on the way home, then sleep ${hhmm(pe + c + 0.5)} to ${hhmm(pe + c + 7.5)} in a dark, cool room.`);
      } else {
        segs.push({ start: pe + c + 0.5, end: pe + c + 4, kind: "nap" }, { start: pe + c + 4.5, end: pe + c + 7.5, kind: "light" });
        notes.push(`Last night done. Sleep only until ${hhmm(pe + c + 4)}, then get outside in daylight.`, `Go to bed at your usual ${hhmm(bed)} tonight to reset.`);
      }
    }

    if (kind === "N") {
      if (prev !== "N") {
        segs.push({ start: s - 4.5, end: s - 3, kind: "nap" });
        notes.push(`First night: lie in this morning and nap ${hhmm(s - 4.5)} to ${hhmm(s - 3)}.`);
      }
      segs.push({ start: s, end: e, kind: "work" });
      segs.push({ start: s + 1, end: s + 5, kind: "light" });
      segs.push({ start: e - 6, end: e - 6, kind: "caffeine" });
      notes.push(`Keep lights bright during the first half of the shift. No caffeine after ${hhmm(e - 6)}.`);
    } else if (kind === "O") {
      if (prev !== "N") {
        if (next === "N") { segs.push({ start: bed + 1.5, end: bed + 1.5 + sleepLen, kind: "sleep" }); notes.push(`Night shift tomorrow: stay up until about ${hhmm(bed + 1.5)} and sleep in.`); }
        else { segs.push({ start: bed, end: bed + sleepLen, kind: "sleep" }, { start: wake, end: wake + 2, kind: "light" }); notes.push(`Rest day. Keep your usual ${hhmm(bed)} to ${hhmm(wake)} sleep and get morning daylight.`); }
      }
    } else {
      // Day, early or late shift: wake early enough to get ready and commute.
      segs.push({ start: s, end: e, kind: "work" });
      const needWake = s - c - 1;
      const w = kind === "L" ? Math.min(wake + 1, needWake) : Math.min(wake, needWake);
      const b = w - sleepLen;
      if (prev !== "N") segs.push({ start: b, end: w, kind: "sleep" });
      segs.push({ start: w, end: w + 1.5, kind: "light" }, { start: (next === "N" ? bed + 1.5 : b + 24) - 6, end: (next === "N" ? bed + 1.5 : b + 24) - 6, kind: "caffeine" });
      if (prev !== "N") notes.push(`Sleep ${hhmm(b)} to ${hhmm(w)} so you have an hour before leaving.`);
      if (kind === "E") notes.push("Early start: dim the lights and put screens away an hour before bed.");
      if (kind === "L") notes.push(`After the shift, allow an hour to wind down before sleeping.`);
    }

    // Quick return: less than 11 hours between the end of one shift and the start of the next.
    if (kind !== "O" && next !== "O") {
      const endAbs = e <= s ? e + 24 : e;
      const nextStart = toHours(defs[next].start) + 24;
      const gap = nextStart - endAbs;
      if (gap < 11) warn = `Only ${Math.round(gap * 10) / 10} hours between this shift and the next. Ask whether the rota can change.`;
    }
    return { date, kind, segs, notes, warn };
  });
}

export default function Owlclock() {
  const start = todayISO();
  const [defs, setDefs] = useStored(T, "defs", DEFAULT_DEFS);
  const [rota, setRota] = useStored<Record<string, Kind>>(T, "rota", Object.fromEntries("DDNNOOOODDNNOOOO".split("").map((c, i) => [addDays(start, i), c as Kind])));
  const [bed, setBed] = useStored(T, "bed", "23:00");
  const [wake, setWake] = useStored(T, "wake", "07:00");
  const [commute, setCommute] = useStored(T, "commute", 30);
  const [days, setDays] = useStored(T, "days", 14);
  const [pattern, setPattern] = useState("DDNNOOOO");
  const [from, setFrom] = useState(start);
  const [openDefs, setOpenDefs] = useState(false);

  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const plan = buildPlan(dates, rota, defs, toHours(bed), toHours(wake), commute);
  const cycle = (d: string) => setRota({ ...rota, [d]: KINDS[(KINDS.indexOf(rota[d] ?? "O") + 1) % KINDS.length] });
  const applyPattern = () => {
    const p = pattern.toUpperCase().replace(/[^DELNO]/g, "");
    if (!p) return;
    const next = { ...rota };
    for (let i = 0; i < 56; i++) next[addDays(from, i)] = p[i % p.length] as Kind;
    setRota(next);
  };
  const nights = dates.filter(d => rota[d] === "N").length;
  const warnings = plan.filter(p => p.warn).length;

  return (
    <div className="stack">
      <div className="grid2">
        <section className="panel">
          <h2>Your rota</h2>
          <p className="note" style={{ marginBottom: 12 }}>Tap a day to switch between Day, Early, Late, Night and Off.</p>
          <div className="ow-cal">
            {dates.map(d => {
              const kd = rota[d] ?? "O";
              return (
                <button key={d} className="ow-day" onClick={() => cycle(d)} style={{ background: defs[kd].color, color: kd === "N" ? "#fff" : "#151933" }} aria-label={`${prettyDate(d)}: ${defs[kd].name}. Tap to change.`}>
                  <span>{new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}</span>
                  <strong>{Number(d.slice(8))}</strong>
                  <em>{defs[kd].name}</em>
                </button>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <label className="field" style={{ flexBasis: 160 }}><span>Repeat pattern (D E L N O)</span><input id="ow-pat" className="input" value={pattern} onChange={e => setPattern(e.target.value)} /></label>
            <label className="field" style={{ flexBasis: 140 }}><span>Starting</span><input id="ow-from" type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></label>
            <button className="btn small" onClick={applyPattern}>Fill 8 weeks</button>
          </div>
        </section>

        <section className="panel">
          <h2>About you</h2>
          <div className="stack" style={{ gap: 12 }}>
            <div className="row">
              <label className="field"><span>Usual bedtime on days off</span><input id="ow-bed" type="time" className="input" value={bed} onChange={e => setBed(e.target.value)} /></label>
              <label className="field"><span>Usual wake time</span><input id="ow-wake" type="time" className="input" value={wake} onChange={e => setWake(e.target.value)} /></label>
            </div>
            <div className="row">
              <label className="field"><span>Commute (minutes)</span><input id="ow-com" type="number" min={0} max={180} className="input num" value={commute} onChange={e => setCommute(Math.max(0, Math.min(180, +e.target.value || 0)))} /></label>
              <label className="field"><span>Show</span><select id="ow-days" className="input" value={days} onChange={e => setDays(+e.target.value)}>{[7, 14, 21, 28].map(n => <option key={n} value={n}>{n} days</option>)}</select></label>
            </div>
            <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setOpenDefs(!openDefs)}>{openDefs ? "Hide shift times" : "Edit shift times"}</button>
            {openDefs && KINDS.filter(x => x !== "O").map(x => (
              <div key={x} className="row">
                <span className="pill" style={{ alignSelf: "center", minWidth: 60 }}>{defs[x].name}</span>
                <label className="field"><span>Starts</span><input id={`ow-s-${x}`} type="time" className="input" value={defs[x].start} onChange={e => setDefs({ ...defs, [x]: { ...defs[x], start: e.target.value } })} /></label>
                <label className="field"><span>Ends</span><input id={`ow-e-${x}`} type="time" className="input" value={defs[x].end} onChange={e => setDefs({ ...defs, [x]: { ...defs[x], end: e.target.value } })} /></label>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="row" style={{ gap: 32, marginBottom: 16 }}>
          <div className="stat"><b>{nights}</b><span>Night shifts</span></div>
          <div className="stat"><b style={{ color: warnings ? "var(--bad)" : undefined }}>{warnings}</b><span>Quick returns</span></div>
          <div className="stat"><b>{days}</b><span>Days planned</span></div>
        </div>
        <DayBarLegend kinds={["sleep", "nap", "work", "light", "dark", "caffeine"]} />
        <div className="stack" style={{ gap: 20, marginTop: 18 }}>
          {plan.map(p => (
            <div key={p.date} className="ow-plan">
              <div className="ow-head">
                <strong>{prettyDate(p.date)}</strong>
                <span className="pill" style={{ background: defs[p.kind].color, color: p.kind === "N" ? "#fff" : "#151933" }}>{defs[p.kind].name}{p.kind !== "O" ? ` ${defs[p.kind].start} to ${defs[p.kind].end}` : ""}</span>
                {p.warn && <span className="pill bad">{p.warn}</span>}
              </div>
              <DayBar segs={p.segs} />
              {p.notes.length > 0 && <ul>{p.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            </div>
          ))}
        </div>
        <p className="note" style={{ marginTop: 18 }}>Based on common shift-work sleep guidance. It is general advice, not medical advice.</p>
      </section>
      <style>{`
        .ow-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
        .ow-day{border:0;border-radius:8px;padding:6px 4px;display:flex;flex-direction:column;align-items:center;gap:0;cursor:pointer;min-width:0}
        .ow-day span{font-family:var(--mono);font-size:10px;text-transform:uppercase;opacity:.8}
        .ow-day strong{font-family:var(--serif);font-weight:400;font-size:22px;line-height:1.1}
        .ow-day em{font-style:normal;font-size:11px;font-weight:600}
        .ow-plan{padding-top:14px;border-top:1px solid var(--line)}
        .ow-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px}
        .ow-head strong{font-family:var(--serif);font-weight:400;font-size:21px}
        .ow-plan ul{margin:8px 0 0;padding-left:18px;display:grid;gap:3px}
      `}</style>
    </div>
  );
}
