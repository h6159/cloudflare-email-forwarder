// worker.js - Cloudflare Email Worker (Pure JavaScript)

export default {
  async email(message, env, ctx) {
    // Parse all recipient addresses (to, cc, bcc)
    const recipients = new Set();
    [message.to, message.cc, message.bcc].forEach(addr => {
      if (addr) {
        addr.split(',').map(a => a.trim().toLowerCase()).forEach(a => {
          if (a) recipients.add(a);
        });
      }
    });

    // Load rules from KV
    const rulesJson = await env.FORWARD_RULES.get('rules');
    if (!rulesJson) {
      await forwardToDefault(message, env);
      return;
    }

    let rules;
    try {
      rules = JSON.parse(rulesJson).map(r => ({
        pattern: r.pattern,
        target: r.target,
        regex: wildcardToRegex(r.pattern.toLowerCase())
      }));
    } catch (e) {
      await forwardToDefault(message, env);
      return;
    }

    const forwardedTo = new Set();

    // Match rules
    for (const addr of recipients) {
      for (const rule of rules) {
        if (rule.regex.test(addr) && !forwardedTo.has(rule.target)) {
          forwardedTo.add(rule.target);
          const rawCopy = message.raw.pipeThrough(new IdentityTransformStream());
          await forwardWithResend(message, rule.target, env, rawCopy);
        }
      }
    }

    // Default fallback
    if (forwardedTo.size === 0) {
      await forwardToDefault(message, env);
    }
  }
};

// Convert wildcard to regex
function wildcardToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$');
}

// Forward using Resend API (preserves original email as .eml)
async function forwardWithResend(message, to, env, rawStream) {
  try {
    const rawBytes = new Uint8Array(await new Response(rawStream).arrayBuffer());
    const rawBase64 = btoa(String.fromCharCode(...rawBytes));

    const fromName = env.FORWARD_FROM_NAME || 'Forwarded Message';
    const subject = message.headers.get('subject') || '(no subject)';
    const fwdSubject = `FWD: ${subject}`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <noreply@forward.yourdomain.com>`,
        to: [to],
        subject: fwdSubject,
        reply_to: message.from,
        headers: {
          'X-Original-From': message.from,
          'X-Original-To': message.to,
        },
        text: `Forwarded message from ${message.from}\n\nFull email attached as original.eml`,
        attachments: [{
          filename: 'original.eml',
          content: rawBase64,
          content_type: 'message/rfc822'
        }]
      })
    });

    if (!res.ok) {
      console.error('Resend API error:', await res.text());
    }
  } catch (err) {
    console.error('Forward failed:', err);
  }
}

// Fallback: use built
