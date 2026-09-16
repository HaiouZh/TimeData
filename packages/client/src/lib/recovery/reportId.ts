/** 上报记录去重用的 10 位 base36 随机串。只防同一条记录被重投两次，不需要密码学强度。 */
export function newReportId(random: () => number = Math.random): string {
  let id = "";
  while (id.length < 10) id += Math.min(35, Math.floor(random() * 36)).toString(36);
  return id;
}
