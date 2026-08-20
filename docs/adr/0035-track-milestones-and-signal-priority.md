# 0035. 阶段骨架独立成表，调度信号显式宣告优先

- 日期：2026-08-20
- 状态：已接受
- 关系：track-workbench metaspec 阶段1 的两项核心决策；信号部分改写 tracks.md §8 状态卡与调度台的判定优先级

## 背景

轨道（Track）上线后长期用不起来，根因不是缺历史记录——步骤时间线一直在——而是**没有推进感**：
一条线离目标还有多远、下一步是什么，页面上没有任何承载。和 agent 讨论出「阶段 1..N」的路线图后，
这些阶段没有地方放，只能散落在步骤正文里。

同时调度台把「7 天没动静」判成一个独立的「停滞」组，排在 agent 在跑之前。实际使用里这是误判：
一条线安排给 agent 长跑、或在等外部条件时，7 天没写步骤是常态，不是停滞。

## 决策

### 阶段骨架独立成表 `track_milestones`

一行一段：`(id, track_id, title, status: pending|done|dropped, note, task_id, position)`。要点：

- **刻度出生**：阶段建出来只是骨架上的一格刻度，不是任务。需要落实执行时可单向挂一条任务
  （`task_id` 弱引用），任务勾选镜像该段完成态（best-effort 单向，失败不回滚勾选；
  dropped 的段不镜像——砍掉的段不因任务而复活）。
- **七种修改操作是第一类公民**：改内容不动槽位、加塞、搬移、砍掉留痕（dropped，不物理删）、
  拆尾、状态回改、整线作废带指针。48 个主题的仓库考古显示中途改骨架是常态（53% 的多阶段
  主题中途变过形），**不支持修改的骨架必死**。
- **刻意不做 reorder 与 rename-only 语义**：考古零实例；加塞 + 砍掉留痕已覆盖真实需要。
  `position` 由客户端写入层重编号维护，排序口径 `(position, createdAt, id)`。
- **进度 = 手动勾分段条 done/total**，dropped 剔除分母。不用任务计数百分比——任务清单会
  中途长大，百分比会倒退，推进感反而被破坏。

同步：LWW 域，`upsertPriority 76 / deletePriority 70`（宿主 track 先建后删的相对序）；
无 op、无 guardedColumns——两端并发改同一段时后写胜，个人单用户场景接受此风险。
服务端写前闸 `guardTrackMilestoneHost`：非 delete 写入找不到宿主 track 时拒收
（`orphan_milestone_rejected`），镜像 `guardTrackStepHost`。

### 调度信号：显式宣告优先，停滞降为提醒

判定优先级从「等我接 > 停滞 > agent 在跑 > 推进中」改为
**「等我接 > agent 在跑 > 等外部 > 推进中」**：

- 新增第三个信号组「等外部」（步骤标签，默认 `等外部`，settings 可配
  `track.waitExternalTags.v1`），承接「在等一个不是自己也不是 agent 的条件」。
- **停滞退出分组判定**，降级为行上提醒字段 `stalledDays`（各组都标）。信号是用户显式
  宣告的，系统不得用「N 天没动静」的启发式改判分组——只提醒，不改判。
  `dispatchStats.stalled` 因此变为跨组提醒计数。

## 后果

- 阶段骨架有了家：workbench（metaspec 阶段2）与 todo 轨道桶（阶段3）都消费这张表。
- `stalled` 作为 `DispatchGroupKey` 消失；消费点（徽章 tone、统计带）全部跟随。
- agent ingest 不写里程碑（阶段1 刻意只读透出 context）；创建修改全走人的手。
