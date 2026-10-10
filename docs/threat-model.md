# Threat model

## Assets
## Attackers
- Stolen / compromised phone
- Compromised email / SIM swap
- Phishing / malicious dApp
- Malicious or compromised Swissquote insider / server
## Attack paths and mitigations
| Threat | Impact | Mitigation |
|--------|--------|------------|
| Stolen phone (locked) | None | Passkey needs biometrics |
| Phone + email + SIM compromised | Fake recovery attempt | 2-of-3 guardians, KYC via banking 2FA, alerts + owner cancel. See `recovery.md` |
| Malicious Swissquote insider | Fake recovery attempt | 1 guardian only, HSM dual control, time-locks, owner veto |
| Stolen card / compromised card processor (optional card) | Loss up to the daily limit | Limit enforced on-chain, instant freeze, limit increases time-locked |
## Out of scope / accepted risks
