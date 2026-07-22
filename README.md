# SC Caseload Tracker

Desktop application for Support Coordinators managing ODP caseloads.

---

## What It Does

A Windows desktop app that centralizes all SC tracking requirements in one place. Data is stored locally and backed up automatically to a designated folder every 7 minutes and on close, with an additional synced copy in Azure for the Supervisor View (Coach) app to read from.

---

## Pages & Features

**Items Needing Attention**  
At-a-glance alerts for anything overdue, due this month, or due next month, organized by category. ISP splits into ISP Invitation, ISP Submit to Coach, and ISP Not Logged Yet. PUNS includes a No PUNS Logged Yet flag for consumers 14+. Emergency Preparedness, FFA, and Voter Preference are tracked as three independent items. Alerts can be filtered, dismissed, and restored.

**Caseload**  
Full consumer list with Active/Inactive/All status, search, column filters, and sorting. Add, edit, and manage consumers — Date of Birth and Waiver Type are required, names auto-format to Title Case, and each consumer has a Date of Opening field used for new-opening monitoring timelines. Export consumers for backup or case transfers, with an optional prompt to mark exported consumers Inactive.

**Import Caseload**  
Bulk-import a caseload roster file instead of adding consumers one by one. Every row is reviewed before anything saves — matched against your existing caseload by MCI# so nothing already there ever gets overwritten. An optional Log panel per row lets you add Monitoring, ISP, PUNS, or Emergency/FFA/Voter details during import; Monitoring specifically requires Contact Type, Contact Date, and Tool Completed to all be filled in together, or all left blank.

**Caseload Tracker**  
Combined tracking hub with four sub-tabs:
- *Monitoring* — Monthly and quarterly contacts per waiver frequency. Logs contact type, date, and tool completion date. For Base / SC Services Only consumers, a new-opening rule anchors the first monitoring requirement to Date of Opening + 6 months when nothing has been logged yet, rather than showing nothing at all.
- *ISP* — Full deadline pipeline calculated from the Annual Review date: Start, Schedule Target (90 days out), Last ISP, Invite Due, Submit By, and Future ARUD. Advancing to the next ARUD requires ISP Scheduled, Invite Done, and Submitted to all be present first.
- *PUNS* — Tracks finalized date and category, auto-calculates due date, and logs submission to coach.
- *Emergency / FFA / Voter* — Annual renewal tracking for Emergency Preparedness, FFA (Free from Abuse), and Voter Preference. Each renews independently and logs its own history. Voter registration is age-gated for consumers under 18. Save commits a Completed Date directly — no separate logging step required.

**A/B Tracker**  
Monthly A and B code logging with counters. Tracks Met, In Progress, Not Started, and Missed statuses.

**Export / Load Records**  
Export selected consumers for backup or case transfers, with a same-moment prompt to mark them Inactive if the export was a transfer. Load records from other SCs with full conflict detection, preview diffs, and merge/skip options — Date of Opening and other fields are preserved correctly through a merge.

**Instructions**  
In-app reference covering setup, every tracker, and current behavior for each feature above.

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| v1.4.2 | Jul 2026 | Import Caseload, ISP/PUNS/Emergency restructure, monitoring new-opening rule, validation fixes |
| v1.4.1 | Jul 2026 | Items Needing Attention rework, ISP/PUNS fixes, transfer safeguard |
| v1.4.0 | Jun 2026 | Azure backup tier, UID naming, inactive purge, remove delete |
| v1.2.9 | Jun 2026 | Details modal cleanup |
| v1.2.8 | Jun 2026 | Test release |
| v1.2.7 | Jun 2026 | Data safety notice on update banner |
| v1.2.6 | Jun 2026 | Auto update check on launch |
| v1.2.5 | Jun 2026 | Banner test |
| v1.2.4 | Jun 2026 | Auto version sync & update banner |
| v1.2.3 | Jun 2026 | Update diagnostics |
| v1.2.2 | Jun 2026 | Version display fix |
| v1.2.1 | Jun 2026 | Auto-update listener fix |
| v1.2.0 | Jun 2026 | Initial release |
