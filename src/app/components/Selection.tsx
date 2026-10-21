"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { startOutreach, enrichOutreachBatch, finishOutreach, outreachMembers } from "@/lib/actions";

/**
 * Outreach list: tick companies on the findings list, see the count and the
 * credit ceiling, press one button. The browser drives the enrichment in
 * batches of three companies so no single request runs long, then shows the
 * export link. Selection persists per browser in localStorage.
 */

interface Ctx {
  selected: Set<string>;
  toggle: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clear: () => void;
}

/** A run enriches at most this many companies (top by score). Mirrors actions.ts. */
export const OUTREACH_MAX_COMPANIES = 60;

const SelectionContext = createContext<Ctx | null>(null);
const KEY = "radar.outreach.selection";

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setSelected(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* storage unavailable: selection is per page load */
    }
  }, []);

  const persist = (next: Set<string>) => {
    setSelected(next);
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => persist(new Set()), []);
  const selectMany = useCallback((ids: string[]) => persist(new Set(ids)), []);
  const value = useMemo(() => ({ selected, toggle, selectMany, clear }), [selected, toggle, selectMany, clear]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): Ctx {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection outside SelectionProvider");
  return ctx;
}

export function SelectBox({ id, disabled }: { id: string; disabled?: boolean }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      className="select-box"
      checked={selected.has(id)}
      disabled={disabled}
      onChange={() => toggle(id)}
      onClick={(e) => e.stopPropagation()}
      aria-label="Add to outreach list"
      title={disabled ? "Manual accounts cannot be enriched" : "Add to outreach list"}
    />
  );
}

/**
 * Bulk selection controls above the list. `all` and `unflagged` are the
 * selectable company ids in list (score) order; manual accounts are excluded
 * by the page before they get here.
 */
export function SelectionControls({ all, unflagged }: { all: string[]; unflagged: string[] }) {
  const { selected, selectMany, clear } = useSelection();
  return (
    <div className="selection-controls">
      <button type="button" className="button small ghost" onClick={() => selectMany(all)}>
        Select all ({all.length})
      </button>
      <button type="button" className="button small ghost" onClick={() => selectMany(unflagged)}>
        Select all unflagged ({unflagged.length})
      </button>
      {selected.size > 0 && (
        <button type="button" className="link muted small" onClick={clear}>
          Clear {selected.size}
        </button>
      )}
      <span className="muted small">A run takes at most {OUTREACH_MAX_COMPANIES} companies, highest score first.</span>
    </div>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "running"; runId: string; total: number; done: number; credits: number; withEmail: number; errors: string[] }
  | { kind: "finished"; runId: string; withEmail: number; credits: number; errors: string[] }
  | { kind: "error"; message: string };

export function SelectionBar() {
  const { selected, clear } = useSelection();
  const [perCompany, setPerCompany] = useState(5);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const count = selected.size;
  if (count === 0 && phase.kind === "idle") return null;

  const run = async () => {
    const ids = [...selected];
    const start = await startOutreach(ids, perCompany);
    if (!start.ok || !start.runId) {
      setPhase({ kind: "error", message: start.message });
      return;
    }
    const runId = start.runId;
    const total = start.companies ?? ids.length;
    // The server may have capped the run to the top N by score; only those are members.
    const members = await outreachMembers(runId);
    const toRun = members.length ? members : ids;
    let done = 0;
    let credits = 0;
    let withEmail = 0;
    const errors: string[] = [];
    setPhase({ kind: "running", runId, total, done, credits, withEmail, errors });
    for (let i = 0; i < toRun.length; i += 3) {
      const step = await enrichOutreachBatch(runId, toRun.slice(i, i + 3), perCompany);
      if (!step.ok) {
        errors.push(step.message ?? "batch failed");
        break;
      }
      for (const d of step.done) {
        done++;
        withEmail += d.withEmail;
        if (d.error) errors.push(`${d.companyId}: ${d.error}`);
      }
      credits = step.creditsSoFar;
      setPhase({ kind: "running", runId, total, done, credits, withEmail, errors: [...errors] });
    }
    const fin = await finishOutreach(runId);
    setPhase({ kind: "finished", runId, withEmail: fin.withEmail, credits: fin.credits, errors });
    clear();
  };

  return (
    <div className="selection-bar" role="status">
      {phase.kind === "idle" && (
        <>
          <span>
            <b>{count}</b> {count === 1 ? "company" : "companies"} selected · up to{" "}
            <b>{Math.min(count, OUTREACH_MAX_COMPANIES) * perCompany}</b> credits
            {count > OUTREACH_MAX_COMPANIES && (
              <span className="error"> · capped: the top {OUTREACH_MAX_COMPANIES} by score will run</span>
            )}
          </span>
          <label className="inline">
            people per company
            <select value={perCompany} onChange={(e) => setPerCompany(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button small" onClick={run}>
            Get contacts & build export
          </button>
          <button type="button" className="link muted small" onClick={clear}>
            Clear
          </button>
        </>
      )}
      {phase.kind === "running" && (
        <span>
          Getting contacts… <b>{phase.done}</b> of {phase.total} companies · {phase.withEmail} emails · {phase.credits} credits
          {phase.errors.length > 0 && <span className="error"> · {phase.errors.length} errors</span>}
        </span>
      )}
      {phase.kind === "finished" && (
        <>
          <span>
            Done: <b>{phase.withEmail}</b> contacts with email · {phase.credits} credits
            {phase.errors.length > 0 && <span className="error"> · {phase.errors.length} companies failed</span>}
          </span>
          <a className="button small" href={`/api/export?run=${phase.runId}`}>
            Export to Salesloft
          </a>
          <a className="link small" href={`/weekly?run=${phase.runId}`}>
            Review the list
          </a>
          <button type="button" className="link muted small" onClick={() => setPhase({ kind: "idle" })}>
            Dismiss
          </button>
        </>
      )}
      {phase.kind === "error" && (
        <>
          <span className="error">{phase.message}</span>
          <button type="button" className="link muted small" onClick={() => setPhase({ kind: "idle" })}>
            Back
          </button>
        </>
      )}
    </div>
  );
}
