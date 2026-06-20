# Security

## Reporting

Please report security issues privately to the maintainer instead of opening a public issue.

## Sensitive Data

Do not include API keys, cookies, private notes, or exported plugin data in GitHub issues.

The plugin stores configuration through SiYuan plugin `saveData`. Diagnostics and bundle checks are designed to report whether an API key is set without serializing the key itself.

