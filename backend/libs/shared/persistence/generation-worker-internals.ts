export const CLAIMABLE_JOB_SOURCES = [
  "bottom_dock",
  "plan_apply",
  "storyboard_preview",
];

export function imageJobLeaseSeconds(): number {
  const raw = Number.parseInt(process.env.IMAGE_JOB_LEASE_SECONDS ?? "", 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 120;
}
