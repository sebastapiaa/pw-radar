import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Sql } from 'postgres';
import * as lists from '../src/lib/contact-lists';
import * as exporter from '../src/lib/contact-export';
import * as crypto from '../src/lib/crypto';
import * as enrichment from '../src/lib/enrich';
import * as limits from '../src/lib/limits';
import * as scoring from '../src/lib/scoring';
import * as format from '../src/lib/format';
import { ZoomInfoClient } from '../src/lib/zoominfo';

// Every SQL statement executes in an ephemeral PostgreSQL engine. Application
// dependencies are injected; neither DATABASE_URL nor a real ZoomInfo token is used.
function adapter(pg: PGlite | Transaction): Sql {
  const sql = Object.assign(async (strings: TemplateStringsArray, ...params: unknown[]) => {
    const query = strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '');
    const result = await pg.query(query, params);
    return result.rows;
  }, {
    begin: (fn: (tx: Sql) => Promise<unknown>) => {
      if (!('transaction' in pg)) throw new Error('Nested transaction not supported by test adapter');
      return pg.transaction((tx) => fn(adapter(tx)));
    },
    json: (value: unknown) => JSON.stringify(value),
  });
  return sql as unknown as Sql;
}

const schema = readFileSync(join(process.cwd(), 'db/schema.sql'), 'utf8')
  .replace('create extension if not exists "pgcrypto";', ''); // gen_random_uuid is built into PostgreSQL.
let pg: PGlite;
let sql: Sql;
let recommendations: enrichment.Recommendation[];
let paidCalls: number;
let failPaid: boolean;
let actions: typeof import('../src/lib/actions');
let queries: typeof import('../src/lib/queries');
let exportRoute: typeof import('../src/app/api/export/route');
const actor = 'test-user';
const fakeClient = {
  discoverTools: async () => [],
  assertRoles: () => {},
  callJson: async (_role: string, args: { contacts: { personId: string }[] }) => {
    paidCalls++;
    if (failPaid) throw new Error('Synthetic provider failure');
    return args.contacts.map(({ personId }) => ({ personId, firstName: 'Test', lastName: personId,
      email: `${personId}@example.test`, phone: '+16195550100', zoominfoCompanyId: '100' }));
  },
} as unknown as ZoomInfoClient;

before(async () => {
  process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  pg = await PGlite.create();
  sql = adapter(pg);
  await pg.exec(schema);
  const nativeRequire = createRequire(join(process.cwd(), 'package.json'));
  const dependencies: Record<string, unknown> = {
    'next/cache': { revalidatePath() {}, revalidateTag() {}, unstable_cache: (fn: unknown) => fn },
    'next/navigation': { redirect() { throw new Error('Unexpected redirect'); } },
    './db': { db: () => sql },
    './session': { requireSession: async () => ({ actor }) },
    './crypto': crypto,
    './limits': limits,
    './taxonomy': { DEAD_REASONS: ['other'] },
    './scoring': scoring,
    './format': format,
    './exports': { nextExportName: async () => 'pwradartest', exportNamesForContacts: async () => new Map() },
    './contact-export': { exportContacts: (id: string) => exporter.exportContacts(id, sql) },
    './contact-lists': { ...lists,
      eligibleCompanies: (ids: string[]) => lists.eligibleCompanies(ids, sql),
      chargeCredits: (id: string, count: number) => lists.chargeCredits(id, count, sql),
      contactsNeedingEnrichment: (id: string, ids: string[]) => lists.contactsNeedingEnrichment(id, ids, sql),
      committeeEmailCount: (id: string, company: string) => lists.committeeEmailCount(id, company, sql),
    },
    './enrich': { ...enrichment,
      zoomInfoFromEnv: () => fakeClient,
      storeRecommendations: async () => ({ stored: recommendations.length, recs: recommendations }),
      storeEnrichment: (client: ZoomInfoClient, company: string, ids: string[]) => enrichment.storeEnrichment(client, company, ids, sql),
    },
  };
  const loadModule = (file: string, deps = dependencies) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(
      (name: string) => name in deps ? deps[name] : nativeRequire(name), module, module.exports);
    return module.exports;
  };
  actions = loadModule('src/lib/actions.ts') as typeof actions;
  queries = loadModule('src/lib/queries.ts') as typeof queries;
  exportRoute = loadModule('src/app/api/export/route.ts', {
    '@/lib/db': dependencies['./db'],
    '@/lib/session': { getSession: async () => ({ actor }) },
    '@/lib/exports': { nextExportName: async () => 'pwradartest', EXPORT_NAME_RE: /^[a-z0-9][a-z0-9_-]{1,39}$/i },
    '@/lib/contact-export': { ...exporter, exportContacts: (id: string) => exporter.exportContacts(id, sql) },
    '@/lib/contact-lists': lists,
  }) as typeof exportRoute;
});

beforeEach(async () => {
  paidCalls = 0;
  failPaid = false;
  await pg.exec('truncate companies, runs, scopes, exports, export_log restart identity cascade');
  await sql`insert into companies (zi_company_id, name, employee_count, gate_status) values ('100','Test Company',500,'passed')`;
  await sql`insert into findings (zi_company_id, run_id, score, icp_fit, signal_strength, recency_decay, stack_bonus, signal_count, why_now)
    values ('100', gen_random_uuid(), 90, 1, 1, 1, 1, 2, 'Saved context')`;
  await sql`insert into gate_decisions (run_id, zi_company_id, check_name, verdict)
    values (gen_random_uuid(), '100', 'corroboration', 'pass')`;
  recommendations = [
    { contactId: '1', rank: 1, score: 1, reRankingScore: 1, name: 'Test Security', title: 'Security Director',
      tier: 'security', managementLevel: 'Director', department: 'IT', jobFunction: '', brief: '' },
    { contactId: '2', rank: 2, score: 1, reRankingScore: 1, name: 'Test IT', title: 'IT Director',
      tier: 'it', managementLevel: 'Director', department: 'IT', jobFunction: '', brief: '' },
  ];
  for (const r of recommendations) {
    await sql`insert into contacts (zi_contact_id, zi_company_id, full_name, title, tier)
      values (${r.contactId}, '100', ${r.name}, ${r.title}, ${r.tier})`;
  }
});
after(async () => { await pg?.close(); });

test('saved list exports only its picked person, uses saved context after 30 days, and reuses existing emails', async () => {
  await sql`update contacts set email_enc = ${crypto.encryptPII('cached@example.test')}, enriched_at = now(), purge_after = now() + interval '100 days'`;
  const start = await actions.startOutreach(['100'], 1);
  assert.equal(start.ok, true);
  const step = await actions.enrichOutreachBatch(start.runId!, ['100']);
  assert.equal(step.done[0].picked, 1);
  assert.equal(paidCalls, 0);
  await sql`update findings set created_at = now() - interval '60 days', score = 5, why_now = 'Changed later'`;
  const exported = await exporter.exportContacts(start.runId!, sql);
  assert.deepEqual(exported.map((r) => r.zi_contact_id), ['1']);
  assert.equal(Number(exported[0].score), 90);
  assert.equal(exported[0].why_now, 'Saved context');
  const finish = await actions.finishOutreach(start.runId!);
  assert.equal(finish.withEmail, 1);
  assert.equal(finish.status, 'ok');
});

test('concurrent/repeated batches claim a company once and cannot change the saved per-company limit', async () => {
  const start = await actions.startOutreach(['100'], 1);
  await Promise.all([
    actions.enrichOutreachBatch(start.runId!, ['100','100']),
    actions.enrichOutreachBatch(start.runId!, ['100']),
  ]);
  assert.equal(paidCalls, 1);
  assert.equal((await exporter.exportContacts(start.runId!, sql)).length, 1);
  await actions.enrichOutreachBatch(start.runId!, ['100']);
  assert.equal(paidCalls, 1);
  const [r] = await sql<{ credits_spent: number }[]>`select credits_spent from runs where run_id = ${start.runId!}`;
  assert.equal(r.credits_spent, 1);
});

test('flags, missing corroboration, dead accounts and suppressing tags cannot start a paid list', async () => {
  for (const tag of ['client','do-not-contact','partner:test','excluded:test']) {
    await sql`update companies set tags = ${[tag]} where zi_company_id = '100'`;
    assert.equal((await actions.startOutreach(['100'], 1)).ok, false, tag);
  }
  await sql`update companies set tags = '{}', gate_status = 'flagged' where zi_company_id = '100'`;
  assert.equal((await actions.startOutreach(['100'], 1)).ok, false);
  await sql`update companies set gate_status = 'passed' where zi_company_id = '100'`;
  await sql`update gate_decisions set verdict = 'flag'`;
  assert.equal((await actions.startOutreach(['100'], 1)).ok, false);
  await sql`update gate_decisions set verdict = 'pass'`;
  await sql`insert into outcomes (zi_company_id, actor, status) values ('100', 'test', 'dead')`;
  assert.equal((await actions.startOutreach(['100'], 1)).ok, false);
  assert.equal(paidCalls, 0);
});

test('a failed paid call retains its credit upper bound and will not replay on continuation', async () => {
  const start = await actions.startOutreach(['100'], 2);
  failPaid = true;
  const step = await actions.enrichOutreachBatch(start.runId!, ['100']);
  assert.equal(step.creditsSoFar, 2);
  assert.equal(paidCalls, 1);
  const finish = await actions.finishOutreach(start.runId!);
  assert.equal(finish.status, 'partial');
  assert.deepEqual(await actions.resumeOutreach(start.runId!), []);
  await actions.enrichOutreachBatch(start.runId!, ['100']);
  assert.equal(paidCalls, 1);
});

test('monthly cap is rechecked immediately before the paid call', async () => {
  const start = await actions.startOutreach(['100'], 2);
  await sql`insert into runs (job, credits_spent) values ('other', ${limits.MONTHLY_SOFT_CAP})`;
  const step = await actions.enrichOutreachBatch(start.runId!, ['100']);
  assert.equal(step.creditsSoFar, 0);
  assert.equal(paidCalls, 0);
  assert.ok(step.done[0].error);
});

test('a saved list can reuse cached contacts even when the monthly credit cap is reached', async () => {
  await sql`insert into runs (job, credits_spent) values ('other', ${limits.MONTHLY_SOFT_CAP})`;
  await sql`update contacts set email_enc = ${crypto.encryptPII('cached@example.test')}, enriched_at = now(), purge_after = now() + interval '30 days'`;
  const start = await actions.startOutreach(['100'], 1);
  assert.equal(start.ok, true);
  await actions.enrichOutreachBatch(start.runId!, ['100']);
  assert.equal(paidCalls, 0);
  assert.equal((await exporter.exportContacts(start.runId!, sql)).length, 1);
});

test('completed, foreign-owned, malformed and unknown lists cannot trigger paid work', async () => {
  assert.equal((await actions.enrichOutreachBatch('invalid', ['100'])).ok, false);
  assert.equal((await actions.enrichOutreachBatch('00000000-0000-0000-0000-000000000001', ['100'])).ok, false);
  const start = await actions.startOutreach(['100'], 1);
  await sql`update runs set actor = 'another-user' where run_id = ${start.runId!}`;
  assert.equal((await actions.enrichOutreachBatch(start.runId!, ['100'])).ok, false);
  await sql`update runs set actor = ${actor}, status = 'ok' where run_id = ${start.runId!}`;
  assert.equal((await actions.enrichOutreachBatch(start.runId!, ['100'])).ok, false);
  assert.equal(paidCalls, 0);
});

test('export counts and rows exclude expired, suppressed and newly killed contacts', async () => {
  const start = await actions.startOutreach(['100'], 2);
  await actions.enrichOutreachBatch(start.runId!, ['100']);
  await sql`update contacts set purge_after = now() - interval '1 day' where zi_contact_id = '1'`;
  assert.equal((await exporter.exportContacts(start.runId!, sql)).length, 1);
  await sql`update contacts set tags = array['do-not-contact'] where zi_contact_id = '2'`;
  assert.equal((await exporter.exportContacts(start.runId!, sql)).length, 0);
  assert.equal((await actions.finishOutreach(start.runId!)).withEmail, 0);
  await sql`update contacts set tags = '{}', purge_after = now() + interval '1 day'`;
  await sql`update companies set gate_status = 'killed' where zi_company_id = '100'`;
  assert.equal((await exporter.exportContacts(start.runId!, sql)).length, 0);
});

test('a new do-not-call response removes previously stored phone data', async () => {
  await sql`update contacts set phone_enc = ${crypto.encryptPII('+16195550100')} where zi_contact_id = '1'`;
  const client = { callJson: async () => [{ personId: '1', firstName: 'Test', email: 'one@example.test',
    phone: '+16195550100', directPhoneDoNotCall: true, mobilePhoneDoNotCall: true }] } as unknown as ZoomInfoClient;
  await enrichment.storeEnrichment(client, '100', ['1'], sql);
  const [r] = await sql<{ phone_enc: Buffer | null }[]>`select phone_enc from contacts where zi_contact_id = '1'`;
  assert.equal(r.phone_enc, null);
});

test('CSV preserves international numbers, escapes formulas/quotes and fails explicitly on corrupt encryption', async () => {
  const start = await actions.startOutreach(['100'], 1);
  await actions.enrichOutreachBatch(start.runId!, ['100']);
  const rows = await exporter.exportContacts(start.runId!, sql);
  const csv = exporter.salesloftCSV(rows, 'pwradartest');
  assert.ok(csv.includes('"+16195550100"'));
  assert.ok(!csv.includes("'+16195550100"));
  assert.equal(exporter.csvField('=1+1'), '"\'=1+1"');
  assert.equal(exporter.csvField('A, "B"'), '"A, ""B"""');
  assert.throws(() => exporter.salesloftCSV([{ ...rows[0], email_enc: Buffer.from('broken') }], 'test'));
});

test('incremental migration and the fresh schema expose the same contact-list objects', async () => {
  const upgraded = await PGlite.create();
  try {
    await upgraded.exec(schema.slice(0, schema.indexOf('alter table runs\n')));
    await upgraded.exec(readFileSync(join(process.cwd(), 'db/migrations/007_contact_lists.sql'), 'utf8'));
    const query = `select table_name, column_name from information_schema.columns
      where table_name in ('runs','weekly_shortlist','shortlist_contacts') and table_schema = 'public'
      order by table_name, ordinal_position`;
    assert.deepEqual((await upgraded.query(query)).rows, (await pg.query(query)).rows);
  } finally { await upgraded.close(); }
});

test('platform review and authenticated CSV download use exactly the same saved people', async () => {
  const start = await actions.startOutreach(['100'], 1);
  await actions.enrichOutreachBatch(start.runId!, ['100']);
  const review = await queries.weeklyShortlist(start.runId!);
  assert.deepEqual(review[0].contacts.map((c) => c.id), ['1']);
  assert.ok(review[0].contacts[0].emailMasked?.includes('•'));
  const { NextRequest } = await import('next/server');
  const response = await exportRoute.GET(new NextRequest(`https://example.test/api/export?run=${start.runId}&name=pwradartest`));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body.trim().split('\r\n').length, 2);
  const [audit] = await sql<{ record_count: number }[]>`select record_count from exports`;
  assert.equal(audit.record_count, 1);
  const items = await sql<{ zi_contact_id: string }[]>`select zi_contact_id from export_items`;
  assert.deepEqual(items.map((r) => r.zi_contact_id), ['1']);
});

test('an unreadable contact makes the route fail without a download or false export history', async () => {
  const start = await actions.startOutreach(['100'], 1);
  await actions.enrichOutreachBatch(start.runId!, ['100']);
  await sql`update contacts set phone_enc = ${Buffer.from('corrupt')} where zi_contact_id = '1'`;
  const { NextRequest } = await import('next/server');
  const response = await exportRoute.GET(new NextRequest(`https://example.test/api/export?run=${start.runId}&name=pwradartest`));
  assert.equal(response.status, 503);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from exports`;
  assert.equal(n, 0);
});

test('saved-list links older than the recent list limit still open the requested run', async () => {
  const start = await actions.startOutreach(['100'], 1);
  await sql`update runs set started_at = now() - interval '3 days' where run_id = ${start.runId!}`;
  for (let i = 0; i < 14; i++) await sql`insert into runs (job) values ('outreach')`;
  assert.ok((await queries.weeklyRuns(8, start.runId!)).some((r) => r.runId === start.runId));
});

test('simultaneous credit checks cannot spend beyond the shared remaining budget', async () => {
  const [{ run_id: id }] = await sql<{ run_id: string }[]>`insert into runs (job) values ('test') returning run_id`;
  await sql`insert into runs (job, credits_spent) values ('other', ${limits.MONTHLY_SOFT_CAP - 3})`;
  const outcomes = await Promise.allSettled([lists.chargeCredits(id, 2, sql), lists.chargeCredits(id, 2, sql)]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  const [run] = await sql<{ credits_spent: number }[]>`select credits_spent from runs where run_id = ${id}`;
  assert.equal(run.credits_spent, 2);
});
