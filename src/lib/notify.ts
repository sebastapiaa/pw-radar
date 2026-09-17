/**
 * Telegram notifier.
 *
 * Hard rule: messages carry a count and a link. No company names, no contact
 * names, no emails, no phones. Telegram history is not a place prospect data
 * should live, and Seb's phone is not a managed device. See docs/SECURITY.md.
 *
 * Telegram over WhatsApp because it is a bot token and one HTTP call. WhatsApp
 * Business API needs Meta business verification, a provider, and template
 * approval for anything outside a 24h window, which a scheduled digest always
 * is. Revisit only if colleagues need to receive the same digest.
 */

const API = "https://api.telegram.org";

interface NotifyOptions {
  botToken: string;
  chatId: string;
  dashboardUrl: string;
}

/**
 * Silence is correct. Most weekdays have nothing new, and a bot that pings
 * daily with "0 new" gets muted inside two weeks. Callers should not invoke
 * this at all when count is 0; the guard here is a backstop.
 */
export async function notifyDaily(
  opts: NotifyOptions,
  count: number,
  topSignalKinds: string[]
): Promise<boolean> {
  if (count === 0) return false;

  const kinds = [...new Set(topSignalKinds)].join(", ");
  const text = [
    `${count} new ${count === 1 ? "finding" : "findings"} cleared threshold.`,
    kinds ? `Signal types: ${kinds}.` : "",
    `Open the console to review.`,
  ]
    .filter(Boolean)
    .join("\n");

  return send(opts, text, `${opts.dashboardUrl}/findings?since=yesterday`);
}

export async function notifyWeekly(
  opts: NotifyOptions,
  shortlistCount: number,
  weekTotal: number,
  creditsSpent: number
): Promise<boolean> {
  const text = [
    `Week in review: ${weekTotal} findings, ${shortlistCount} shortlisted and enriched.`,
    `Credits spent this run: ${creditsSpent}.`,
    `Contacts are ready for Monday.`,
  ].join("\n");

  return send(opts, text, `${opts.dashboardUrl}/weekly`);
}

async function send(opts: NotifyOptions, text: string, url: string): Promise<boolean> {
  const res = await fetch(`${API}/bot${opts.botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: opts.chatId,
      text,
      reply_markup: {
        inline_keyboard: [[{ text: "Open Radar", url }]],
      },
    }),
  });
  return res.ok;
}
