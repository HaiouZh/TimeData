/** occurrence 子任务确定性 id = `{occurrenceId}:child:{templateChildId}`。多设备物化幂等，勿改。 */
export function occurrenceChildId(occurrenceId: string, templateChildId: string): string {
  return `${occurrenceId}:child:${templateChildId}`;
}

/** 判定一个任务 id 是否为 occurrence 子任务克隆行（形如 `{occurrenceId}:child:{templateChildId}`）。 */
export function isOccurrenceChildId(id: string): boolean {
  return id.includes(":child:");
}
