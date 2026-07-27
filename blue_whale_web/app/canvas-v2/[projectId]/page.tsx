import { redirect } from "next/navigation";

import { canonicalCanvasHref } from "../../canvas/canonical-project";

export default async function LegacyCanvasV2ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(canonicalCanvasHref(projectId));
}
