export type ProjectSubmissionState = Readonly<Record<string, true>>;

export function setProjectSubmitting(
  current: ProjectSubmissionState,
  projectId: string,
  submitting: boolean,
): ProjectSubmissionState {
  if (submitting) {
    return { ...current, [projectId]: true };
  }
  const next = { ...current };
  delete next[projectId];
  return next;
}
