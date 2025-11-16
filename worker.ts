// worker.ts - Cloudflare Email Worker for Multi-Domain Smart Forwarding

export interface Env {
  FORWARD_RULES: KVNamespace;
  RESEND_API_KEY: string;
  DEFAULT_FORWARD_EMAIL: string;
  FORWARD_FROM_NAME?: string;
}

interface EmailMessage {
  from: string;
  to: string;
  cc?: string | null;
  bcc?: string | null;
  raw: ReadableStream;
  headers: Headers;
  setReject(reason: string): void;
  forward(to: string): Promise<void>;
}

interface Rule {
  pattern: string;
  target: string;
  compiled: RegExp;
}

export default {
  async email(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const recipients = new Set<string>();
    [message.to, message.cc, message.bcc].forEach(addr => {
      if (addr) {
        addr.split(',').map(a => a.trim().toLowerCase()).forEach(a => {
          if (a) recipients.add(a);
        });
      }
    });

    const rulesJson = await env.FORWARD_RULES.get('rules');
    if (!rulesJson) {
      await forwardTo(message, env.DEFAULT_FORWARD_EMAIL, env, 'Default Forward');
      return;
    }

    let rules: Rule[];
    try {
      rules = JSON.parse(rulesJson).map((r: { pattern: string; target: string }) => ({
        pattern: r.pattern,
        target: r.target,
        compiled: wildcardToRegex(r.pattern.toLowerCase())
      }));
    } catch (e) {
      await forwardTo(message, env.DEFAULT_FORWARD_EMAIL, env, 'Invalid Rules JSON');
      return;
    }

    const forwardedTo = new Set<string>();

    for (const addr of recipients) {
      for (const rule of rules) {
        if (rule.compiled.test(addr) && !forwardedTo.has(rule.target)) {
          forwardedTo.add(rule.target);
          const rawCopy = message.raw.pipeThrough(new IdentityTransformStream());
          await forwardRaw(message, rule.target, env, rawCopy);
        }
      }
    }

    if (forwardedTo.size === 0) {
      await forwardTo(message, env.DEFAULT_FORWARD_EMAIL, env, 'No Matching Rule');
    }
  }
};

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/[*]/g, '.*')
    .replace(/[?]/g, '.');
  return new RegExp('^' + escaped + '$');
}

async function forwardRaw(message: EmailMessage, to: string, env: Env, rawStream: ReadableStream): Promise<void> {
  const rawBytes = new Uint8Array(await new Response(rawStream).arrayBuffer());
  const rawBase64 = btoa(String.fromCharCode(...rawBytes));

  const fromName = env.FORWARD_FROM_NAME || 'Forwarded Message';
  const subject = `FWD: ${message.headers.get('subject') || '(no subject)'}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <noreply@forward.yourdomain.com>`,
      to: [to],
      subject: subject,
      reply_to: message.from,
      headers: {
        'X-Original-From': message.from,
        'X-Original-To': message.to,
      },
      attachments: [
        {
          filename: 'original.eml',
          content: rawBase64,
          content_type: 'message/rfc822'
        }
      ],
      text: `Forwarded message attached as .eml\nOriginal sender: ${message.from}`
    })
  });

  if (!res.ok) console.error('Resend error:', await res.text());
}

async function forwardTo(message: EmailMessage, to: string, env: Env, reason: string): Promise<void> {
  const headers = new Headers(message.headers);
  headers.set('X-Forward-Reason', reason);
  const modified = new EmailMessage(message.from, to, headers, message.raw);
  await modified.forward(to);
}
