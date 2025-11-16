export default {
  async email(message, env, ctx) {
    // 解析所有收件人（to, cc, bcc）
    const recipients = new Set();
    [message.to, message.cc, message.bcc].forEach(addr => {
      if (addr) {
        addr.split(',').map(a => a.trim().toLowerCase()).forEach(a => {
          if (a) recipients.add(a);
        });
      }
    });

    // 从环境变量读取规则
    let rules = [];
    try {
      if (env.FORWARD_RULES_JSON) {
        rules = JSON.parse(env.FORWARD_RULES_JSON).map(r => ({
          pattern: r.pattern.toLowerCase(),
          target: r.target,
          regex: wildcardToRegex(r.pattern.toLowerCase())
        }));
      }
    } catch (e) {
      console.error('Invalid FORWARD_RULES_JSON');
    }

    const forwardedTo = new Set();

    // 匹配规则并转发
    for (const addr of recipients) {
      for (const rule of rules) {
        if (rule.regex.test(addr) && !forwardedTo.has(rule.target)) {
          forwardedTo.add(rule.target);
          // 直接转发原始邮件流（保留发件人、附件、头信息）
          await message.forward(rule.target);
        }
      }
    }

    // 默认转发
    if (forwardedTo.size === 0 && env.DEFAULT_FORWARD_EMAIL) {
      await message.forward(env.DEFAULT_FORWARD_EMAIL);
    }
  }
};

// 通配符转正则
function wildcardToRegex(p) {
  return new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
}
