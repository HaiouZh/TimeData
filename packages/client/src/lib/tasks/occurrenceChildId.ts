/** occurrence 子任务确定性 id = `{occurrenceId}:child:{templateChildId}`。多设备物化幂等，勿改。 */
export function occurrenceChildId(occurrenceId: string, templateChildId: string): string {
  return `${occurrenceId}:child:${templateChildId}`;
}
