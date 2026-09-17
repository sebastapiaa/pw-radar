"use client";

import { useState, useTransition } from "react";
import type { ContactRow } from "@/lib/queries";
import { revealContact } from "@/lib/actions";

/**
 * Contact line, masked until revealed. Reveal is a server action that
 * decrypts and writes an audit row; the plaintext lives only in this
 * component's state for the page's lifetime.
 */
export default function ContactRowView({ contact: c }: { contact: ContactRow; back: string }) {
  const [revealed, setRevealed] = useState<{ email: string | null; phone: string | null } | null>(null);
  const [pending, start] = useTransition();

  return (
    <li>
      <span className="who">
        <b>{c.fullName}</b>
        {c.title && <span className="muted"> · {c.title}</span>}
        {c.tags.length > 0 && <span className="muted"> · {c.tags.join(", ")}</span>}
      </span>
      <span className="reach">
        {revealed ? (
          <>
            {revealed.email ? <a href={`mailto:${revealed.email}`}>{revealed.email}</a> : <span className="muted">no email</span>}
            {" · "}
            {revealed.phone ?? <span className="muted">no phone</span>}
          </>
        ) : (
          <>
            <span className="muted">{c.emailMasked ?? "no email"}</span>
            {c.hasPhone && <span className="muted"> · phone on file</span>}{" "}
            <button
              type="button"
              className="link"
              disabled={pending}
              onClick={() => start(async () => setRevealed(await revealContact(c.id)))}
            >
              {pending ? "revealing…" : "reveal"}
            </button>
          </>
        )}
      </span>
    </li>
  );
}
