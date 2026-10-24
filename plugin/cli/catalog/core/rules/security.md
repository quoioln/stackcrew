---
id: core-security
title: Security
---
# Security

## Essentials

- Apply least privilege to tokens, database users and roles; deny by default.
- Use parameterized queries only; never build SQL by string concatenation.
- Encode output to prevent XSS.
- Load secrets only from env, Vault or SSM, and block secret leaks with a scanner (gitleaks) at pre-commit and CI.
- Check object-level authorization on every resource access to prevent IDOR/BOLA; "is logged in" is not enough.
- Use a CORS allowlist, CSRF protection for cookie auth, security headers, and an SSRF guard on outbound URLs.

## Detail

- Authorization is enforced server-side per resource and action, not by hiding UI.
- Outbound URL fetches validate scheme and host against an allowlist and block internal address ranges.
- Rotate any secret that was ever committed.
