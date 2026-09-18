/**
 * Page latency probe. Logs in with the password mode, then times each page
 * N times and prints min / median / p95 of server time to first byte and full
 * response. Works against a local build or the live site.
 *
 *   npx tsx --env-file-if-exists=.env scripts/perf.ts http://localhost:3100 [runs]
 *   RADAR_PASSWORD=... npx tsx scripts/perf.ts https://pw-radar.vercel.app 5
 */

const base = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "");
const runs = Number(process.argv[3] ?? 5);
const password = process.env.RADAR_PASSWORD ?? process.env.AUTH_PASSWORD ?? "";

async function main() {
  if (!password) throw new Error("set RADAR_PASSWORD (or AUTH_PASSWORD in .env)");
  const login = await fetch(`${base}/api/auth/password`, {
    method: "POST",
    body: new URLSearchParams({ password, next: "/" }),
    redirect: "manual",
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie?.startsWith("radar_session=")) throw new Error(`login failed: ${login.status}`);

  // Find one account id from the findings page.
  const html = await (await fetch(`${base}/findings`, { headers: { cookie } })).text();
  const acct = html.match(/\/accounts\/(\d+)/)?.[1];

  const pages = ["/", "/findings", acct ? `/accounts/${acct}` : null, "/scopes"].filter(Boolean) as string[];
  console.log(`target ${base}, ${runs} runs each\n`);
  console.log("page                 min    p50    p95   (ms, full response)  bytes");
  for (const p of pages) {
    const times: number[] = [];
    let bytes = 0;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const r = await fetch(`${base}${p}`, { headers: { cookie } });
      const body = await r.text();
      times.push(performance.now() - t0);
      bytes = body.length;
      if (r.status !== 200) console.log(`  ${p} -> ${r.status}`);
    }
    times.sort((a, b) => a - b);
    const q = (f: number) => times[Math.min(times.length - 1, Math.floor(f * (times.length - 1)))];
    console.log(
      `${p.padEnd(20)} ${Math.round(q(0)).toString().padStart(5)}  ${Math.round(q(0.5)).toString().padStart(5)}  ${Math.round(q(0.95)).toString().padStart(5)}                        ${bytes}`
    );
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
