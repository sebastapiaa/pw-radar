-- Seed scopes from docs/SERVICES.md. Topic strings are the exact intent topic names
-- returned by ZoomInfo `lookup` (fieldName: intent-topics) on 2026-09-17: the account
-- has 22 configured topics, all mapped below. Re-check with `npm run zi:lookup` before
-- editing; a misspelled topic silently matches nothing in search_intent.
--
-- Mapping approved by Seb 2026-09-17 (docs/ARCHITECTURE.md §Intent topics).

insert into scopes (name, slug, description, intent_topics) values
  ('Managed SOC',
   'managed-soc',
   'Co-managed detection and response from PerimeterWatch''s own SOC: EDR/MDR, IPS, sandbox detonation, 24/7 human analysts.',
   array['Managed Detection & Response (MDR)',
         'Security Operations Center (SOC)',
         'Advanced Threat Protection (ATP)',
         'Network Security',
         'Network Security Appliance']),

  ('SIEM Co-Management',
   'siem-monitoring',
   'Log collection, correlation and ML with analyst-written remediation recommendations. Actionable data, not raw alerts — the answer to alert fatigue.',
   array['Security Information & Event Management (SIEM)']),

  ('Cloud Services',
   'cloud-services',
   'CloudWatch: every managed security service extended to cloud environments (Azure, O365, AWS), CloudWatch Private Cloud on PerimeterWatch''s own servers, and Zero Trust / ZTNA / SASE transformation.',
   array['Cloud Security',
         'Zero Trust',
         'Data Center Migration']),

  ('Threat Hunting',
   'threat-hunting',
   'UEBA, TTP and Crown Jewels hunting models for the ~20% of attacks that evade SOC/SIEM detection.',
   array['Cyber Threat Hunting',
         'Cyber Threats',
         'Zero-Day Threat']),

  ('Cybersecurity (Pentest & Compliance)',
   'cybersecurity',
   'Penetration testing, secure cloud migrations, and data security compliance.',
   array['Penetration Testing',
         'Vulnerability Management',
         'Security Patches']),

  ('GRC & Compliance',
   'grc-compliance',
   'NIST, SOC 2 and ISO alignment, SOP development, and compliance-driven security programs, backed by PerimeterWatch''s certified data center.',
   array['Compliance',
         'Continuous Controls Monitoring']),

  ('Email & User Security',
   'email-user-security',
   'Anti-phishing, O365/M365 security, user awareness training, DLP and data classification against ransomware and BEC.',
   array['Email Security',
         'Data Breach',
         'Fraud Protection']),

  ('Identity & Access',
   'identity-access',
   'IAM, PAM and PIM programs, 2FA enforcement, mobile device security.',
   array['Multifactor Authentication',
         'Two-Factor Authentication']);
