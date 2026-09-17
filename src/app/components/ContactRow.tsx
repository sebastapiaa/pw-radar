"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ContactRow } from "@/lib/queries";
import { revealContact, enrichOne } from "@/lib/actions";

const TIER_LABEL: Record<string, string> = {
  security: "Security",
  it: "IT leadership",
  csuite: "C-suite",
  other: "",
};

/**
 * One person. Three states:
 *   recommended only  → name, title, tier, and a "Get email & phone" button (1 credit)
 *   enriched, masked  → masked email, "reveal" (logged)
 *   revealed          → plaintext for this page's lifetime only
 */
export default function ContactRowView({ contact: c }: { contact: ContactRow; back: string }) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<{ email: string | null; phone: string | null } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const tier = c.tier ? TIER_LABEL[c.tier] ?? "" : "";

  return (
    <li className={c.tier === "other" ? "other" : ""}>
      <span className="who">
        <b>{c.fullName}</b>
        {c.title && <span className="muted"> · {c.title}</span>}
        {!c.title && c.seniority && <span className="muted"> · {c.seniority}</span>}
        {tier && <span className="pill">{tier}</span>}
        {c.tags.length > 0 && <span className="muted"> · {c.tags.join(", ")}</span>}
      </span>
      <span className="reach">
        {revealed ? (
          <>
            {revealed.email ? <a href={`mailto:${revealed.email}`}>{revealed.email}</a> : <span className="muted">no email</span>}
            {" · "}
            {revealed.phone ?? <span className="muted">no phone</span>}
          </>
        ) : c.enrichedAt ? (
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
        ) : (
          <>
            {msg && <span className="muted small">{msg} </span>}
            <button
              type="button"
              className="button small ghost"
              disabled={pending}
              title="Spends at most 1 ZoomInfo credit. Free if this person is already under management."
              onClick={() =>
                start(async () => {
                  const r = await enrichOne(c.id);
                  setMsg(r.message);
                  if (r.ok) router.refresh();
                })
              }
            >
              {pending ? "getting…" : "Get email & phone · 1 credit"}
            </button>
          </>
        )}
      </span>
    </li>
  );
}
