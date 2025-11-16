# Cloudflare 多域名邮件智能转发系统

基于 **Email Workers + KV + Resend API** 实现 **通配符规则转发**，完整保留原始邮件与附件。

## 特性
- 支持 `*@domain.com`, `user+*`, `admin@*.org` 通配符
- 原始发件人、附件、头信息完整保留（`.eml` 附件）
- 去重转发 + 默认邮箱兜底
- 纯浏览器部署，无需 CLI
- 规则热更新（修改 KV 即可）

## 部署步骤
详见 [部署教程](https://github.com/yourname/cloudflare-email-forwarder#0%E5%9F%BA%E7%A1%80%E9%83%A8%E7%BD%B2%E6%95%99%E7%A8%8B)

---

## GitHub Actions 自动部署（可选）

```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloudflare

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
