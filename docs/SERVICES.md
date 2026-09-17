# PerimeterWatch Services

Distilled from two internal documents (Defense-as-a-Service one-pager, company
presentation) provided 2026-09. This file is the grounding corpus for profile
generation and the source for `db/seed_scopes.sql`. Collateral note: the one-pager
lists the corporate entity as Perimeterwatch Technologies, Inc with an Astoria, NY
address; Seb's sales territory is Southern California. Do not let the NY address
confuse geography decisions.

## Positioning

"Defense-as-a-Service." Co-managed security delivered from PerimeterWatch's **own data
center** (SOC1 Type II, SOC2 Type II, ISO 27001, NIST 800-53, HIPAA, PCI DSS compliant)
combining on-premise and cloud systems, run by certified security engineers following
NIST and FBI practice. The stated value core: lower total cost than in-house, **reduced
demands on internal IT resources**, and letting the client focus on core competencies —
the co-managed thesis in the company's own words.

## Public service triad (site, 2026-09)

The current website presents three numbered lines; product names from the collateral
map onto them. Use the public names in UI copy and the includes lists as scope content:

| No. | Line | Includes |
|---|---|---|
| NO.001 | Managed SOC | Defense-in-Depth, Managed SIEM, Managed Detection and Response. "End-to-end managed SOC... you don't have to know the first thing about cybersecurity. We handle everything remotely." |
| NO.002 | Cloud Services | CloudWatch Private Cloud on PerimeterWatch's own servers; CloudWatch, Microsoft Azure, Office 365, AWS |
| NO.003 | Cybersecurity | Penetration Testing, Secure Cloud Migrations, Data Security Compliance |

ThreatWatch (from the collateral) is the engine behind Managed SOC; CloudWatch behind
Cloud Services. Note NO.002 is not only security: CloudWatch Private Cloud is a hosting
offering on PerimeterWatch's own protected servers, which widens the co-managed pitch
to infrastructure, not just detection.

## Service lines

### ThreatWatch — Defense-as-a-Service core
Managed security for the client environment. Core technologies: EDR/MDR, IPS, URL
filtering and app control, anti-spam/anti-phishing, 2FA enforcement, DLP. Specialized:
sandbox detonation for zero-days, web application security, DDoS protection, anti-bot.

### CloudWatch
Extends every ThreatWatch service to the client's cloud environments.

### SIEM / Security Monitoring
PerimeterWatch collects all security logs from the environment; correlation and machine
learning plus human analysts turn them into remediation recommendations. Sold as
"actionable data," not raw alerts — this is the direct answer to alert fatigue.

### Threat Hunting
For what SIEM misses (their own framing: ~20% of attacks evade SOC/SIEM detection).
Models adapted per client architecture: UEBA, TTP-based, Crown Jewels.

### Zero Trust transformation
Migration from legacy perimeter architecture to ZTNA/SASE (access proxy + NGFW,
authentication stack, interrogation stack). Relevant when a prospect signals cloud
migration or remote-work security intent.

### Security gap services (consulting and add-ons)
The "Common Security Gaps" set: user awareness training, O365/M365 security, GRC
(NIST/SOC2/ISO alignment and SOP development), data classification and ransomware
prevention, mobile device security, IAM/PAM/PIM.

### Penetration testing and audit
From prior context (site service lines); not detailed in these two documents but
confirmed as a sold service.

### Methodology
Continuous monitoring → breach detection → incident response → remote log forensics →
remediation → threat prevention, as a loop. Useful language for profile prose.

## Vendor ecosystem (from Seb, 2026-09)

Stacks PerimeterWatch manages, co-manages or complements:

| Category | Vendors |
|---|---|
| Network / ZTNA | Fortinet, Palo Alto, Cisco, Zscaler |
| SIEM | Splunk, LogRhythm, IBM QRadar, AlienVault |
| EDR / endpoint | CrowdStrike, SentinelOne, Sophos |
| Email security | Proofpoint, Mimecast |

Use: **technographic fit signal.** ZoomInfo Advanced includes tech insights. A prospect
already running these vendors is a co-managed fit (PerimeterWatch operates their
existing stack) — a positive fit multiplier, not a timing signal. A prospect running a
SIEM from this list with security-analyst job postings is the ideal profile: tooling
owned, headcount missing. If the free search path exposes installed-technology facets,
include them in Phase 1 queries; otherwise treat as Phase 4+ enhancement.

## Proof points safe for generated profiles

Only these company-level claims may appear in AI-generated prose, since they come from
PerimeterWatch's own collateral: own data center with the certifications listed above,
NIST/FBI-aligned practice, 24/7 monitoring with human analysts, co-managed delivery
that reduces load on internal IT. Nothing else about PerimeterWatch may be claimed.
