# Security policy

## Reporting a vulnerability

Please **don't** open a public issue, discussion or pull request for a security problem. Report it privately through [GitHub's private vulnerability reporting](https://github.com/Karthik-beta/Blinkql/security/advisories/new) on the repository's Security tab.

Include what you found, how to reproduce it and what an attacker could do with it. If a sample file helps, use synthetic data only.

Reports are acknowledged as quickly as possible. We'll keep you updated while the fix is made, and credit you in the fix's release notes unless you'd rather not be named.

## Supported versions

Blinkql is in early development and hasn't had a release yet. Only the latest version, deployed from `main` to https://blinkql.karthik.nz, receives security fixes.

## Scope

Blinkql has no backend, no database and no accounts: it's a set of static files, and all analysis happens in your browser tab. Issues we especially want to hear about include:

- Anything that sends your files, queries or results off your computer
- Weaknesses in the Content Security Policy or the cross-origin isolation headers
- Ways for a file or query to run script in the page
- Problems in a dependency that affect Blinkql in practice

[Privacy & Security](https://github.com/Karthik-beta/Blinkql/wiki/Privacy-and-Security) on the wiki describes where your data goes and the measures in place.
