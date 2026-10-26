/**
 * Credit guards, env-configurable so they track the ZoomInfo admin cap.
 *   RADAR_MONTHLY_CREDIT_CAP       the hard per-user cap set in ZoomInfo (Seb: 1,500 from 2026-10-21)
 *   RADAR_OUTREACH_MAX_COMPANIES   companies per outreach run (Seb: 300)
 * Paid batches stop 50 credits short of the cap. A shared database check
 * enforces the limit before every paid batch. No data access in this module.
 */
export const MONTHLY_CREDIT_CAP = Number(process.env.RADAR_MONTHLY_CREDIT_CAP ?? 1500);
export const MONTHLY_SOFT_CAP = MONTHLY_CREDIT_CAP - 50;
export const OUTREACH_MAX_COMPANIES = Number(process.env.RADAR_OUTREACH_MAX_COMPANIES ?? 300);
