"use server";

import { requireSession } from "./session";
import { companyById, contactsForCompany, notesFor, signalsForCompany } from "./queries";
import type { ContactRow, NoteRow, SignalRow } from "./queries";

export interface CardData {
  signals: SignalRow[];
  contacts: ContactRow[];
  notes: NoteRow[];
  tags: string[];
}

/** One round trip for an expanded list row: four queries in parallel. */
export async function loadCard(companyId: string): Promise<CardData> {
  await requireSession();
  const [signals, contacts, notes, company] = await Promise.all([
    signalsForCompany(companyId, 12),
    contactsForCompany(companyId),
    notesFor("company", companyId),
    companyById(companyId),
  ]);
  return { signals, contacts, notes, tags: company?.tags ?? [] };
}
