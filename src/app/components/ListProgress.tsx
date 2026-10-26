"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { enrichOutreachBatch, finishOutreach, resumeOutreach } from "@/lib/actions";

export async function processContactList(runId: string, progress: (done: number, total: number, credits: number) => void) {
  const members = await resumeOutreach(runId);
  let done = 0;
  const errors: string[] = [];
  for (let i = 0; i < members.length; i += 3) {
    const step = await enrichOutreachBatch(runId, members.slice(i, i + 3));
    done += step.done.length;
    for (const d of step.done) if (d.error) errors.push(d.error);
    progress(done, members.length, step.creditsSoFar);
    if (!step.ok || step.done.some((d) => d.error && d.credits > 0)) {
      if (step.message) errors.push(step.message);
      break;
    }
  }
  return { ...await finishOutreach(runId), errors };
}

export default function ListProgress({ runId, remaining }: { runId: string; remaining: number }) {
  const router = useRouter();
  const busy = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const resume = async () => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    try {
      const result = await processContactList(runId, (done, total, credits) =>
        setMessage(`Prepared ${done} of ${total} accounts · up to ${credits} credits used.`));
      setMessage(result.errors.length ? 'Some accounts need attention. Saved contacts are ready to review.' : 'Your contact list is ready to review.');
    } catch {
      setMessage('Processing stopped. Your list is saved; refresh to review progress before continuing.');
    } finally {
      busy.current = false;
      setRunning(false);
      router.refresh();
    }
  };
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <button type="button" className="button small" onClick={resume} disabled={running}>
        {running ? 'Preparing contacts…' : `Continue list · ${remaining} accounts`}
      </button>
      <p className="muted small" role="status">{message ?? 'Completed accounts are kept. Only pending accounts and failures before enrichment will run.'}</p>
    </div>
  );
}
