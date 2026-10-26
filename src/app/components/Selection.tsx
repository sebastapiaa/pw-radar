"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { startOutreach } from "@/lib/actions";
import { processContactList } from "./ListProgress";

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

/** Per-run company cap, passed from the server (env RADAR_OUTREACH_MAX_COMPANIES). */
const LimitContext = createContext<number>(300);

const SelectionContext = createContext<Ctx | null>(null);
const KEY = "radar.outreach.selection";

export function SelectionProvider({ children, maxCompanies = 300 }: { children: ReactNode; maxCompanies?: number }) {
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
  return (
    <LimitContext.Provider value={maxCompanies}>
      <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
    </LimitContext.Provider>
  );
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
      title={disabled ? "Requires a ZoomInfo account, gate clearance and corroborating signals" : "Add to contact list"}
    />
  );
}

/**
 * Eligible company IDs in score order. The page removes accounts that cannot
 * be enriched; the server repeats the eligibility check during processing.
 */
export function SelectionControls({ all }: { all: string[] }) {
  const { selected, selectMany, clear } = useSelection();
  const OUTREACH_MAX_COMPANIES = useContext(LimitContext);
  return (
    <div className="selection-controls">
      <button type="button" className="button small ghost" onClick={() => selectMany(all)}>
        Select all eligible ({all.length})
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
  | { kind: "starting" }
  | { kind: "running"; runId: string; total: number; done: number; credits: number; withEmail: number; errors: string[] }
  | { kind: "finished"; runId: string; withEmail: number; credits: number; errors: string[]; exportName: string }
  | { kind: "error"; message: string; runId?: string };

export function SelectionBar() {
  const { selected, clear } = useSelection();
  const OUTREACH_MAX_COMPANIES = useContext(LimitContext);
  const [perCompany, setPerCompany] = useState(5);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = useRef(false);
  const count = selected.size;
  if (count === 0 && phase.kind === "idle") return null;

  const run = async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ kind: 'starting' });
    let runId: string | undefined;
    try {
      const start = await startOutreach([...selected], perCompany);
      if (!start.ok || !start.runId) {
        setPhase({ kind: 'error', message: start.message });
        return;
      }
      runId = start.runId;
      const id = runId;
      const fin = await processContactList(id, (done, total, credits) =>
        setPhase({ kind: 'running', runId: id, total, done, credits, withEmail: 0, errors: [] }));
      setPhase({ kind: 'finished', runId: id, withEmail: fin.withEmail, credits: fin.credits, errors: fin.errors, exportName: fin.exportName });
      clear();
    } catch {
      setPhase({ kind: 'error', runId, message: runId
        ? 'Processing stopped. Your contact list is saved; open it to review and continue.'
        : 'The contact list could not be created. Check the service configuration and try again.' });
    } finally {
      busy.current = false;
    }
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
            Build contact list
          </button>
          <button type="button" className="link muted small" onClick={clear}>
            Clear
          </button>
        </>
      )}
      {phase.kind === 'starting' && <span>Saving your contact list…</span>}
      {phase.kind === "running" && (
        <span>
          Getting contacts… <b>{phase.done}</b> of {phase.total} companies · up to {phase.credits} credits
          {' '}<a href={`/weekly?run=${phase.runId}`} className="link small">Open saved list</a>
          {phase.errors.length > 0 && <span className="error"> · {phase.errors.length} errors</span>}
        </span>
      )}
      {phase.kind === "finished" && (
        <>
          <span>
            Saved: <b>{phase.withEmail}</b> contacts with email · up to {phase.credits} credits
            {phase.errors.length > 0 && <span className="error"> · {phase.errors.length} companies failed</span>}
          </span>
          <form method="get" action="/api/export" className="export-form compact">
            <input type="hidden" name="run" value={phase.runId} />
            <label className="inline">
              <span className="muted small">name</span>
              <input type="text" name="name" defaultValue={phase.exportName} pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" size={12} />
            </label>
            <button type="submit" className="button small" disabled={phase.withEmail === 0}>
              Export to Salesloft
            </button>
          </form>
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
          {phase.runId && <a href={`/weekly?run=${phase.runId}`} className="button small">Open saved list</a>}
          <button type="button" className="link muted small" onClick={() => setPhase({ kind: "idle" })}>
            Back
          </button>
        </>
      )}
    </div>
  );
}
