import {
  parseTodoContainerId,
  resolveTodoDockDrop,
  type TodoDragOperation,
} from "./todoDnd.js";

/**
 * `applyTodoDockDrop` 的副作用依赖。注入而不是直接 import:
 * 这段调度是坞独有路径(手头投递、子任务投项目的拒绝 toast),页面级 drop 在 jsdom 里
 * 无法可靠仿真(键盘拖拽在全零 rect 下不可导航),依赖注入让这层逻辑可以被单测钉住——
 * 终审 mutation 实测过:不提炼的话,整段接线删掉全部测试照样绿。
 */
export interface TodoDockDropDeps {
  grabToHand: (taskId: string) => Promise<unknown>;
  showToast: (message: string) => void;
  /** 子任务投项目的拒绝文案(页面注入 projectAssignBlockMessage("subtask", title))。 */
  subtaskBlockMessage: (goalTitle: string) => string;
  findGoalTitle: (goalId: string) => string | null;
  /**
   * 吸附落位的触感(页面注入 hapticDrop)。只在**手头投递成功**那一支调:
   * 折算成 op 的那支由页面在 op switch 前统一震,invalid 拒绝与投递失败都不是落位。
   * design-language §4 第 13 条把「hapticDrop = 拖拽吸附落位」写死了,坞不能例外。
   */
  hapticDrop: () => void;
}

export interface TodoDockDropInput {
  dockId: string;
  activeContainerId: string;
  activeParentId: string | null;
  activeId: string;
}

/**
 * 坞落点的副作用调度。返回三态:
 * - `null`:不是坞落点,调用方走页内容器判定;
 * - `"handled"`:坞已消化(手头投递或 invalid),调用方直接 return;
 * - `TodoDragOperation`:坞折算出的既有操作,调用方喂给页面的 op switch(与拖到池容器/项目卡同一条路)。
 */
export async function applyTodoDockDrop(
  deps: TodoDockDropDeps,
  input: TodoDockDropInput,
): Promise<TodoDragOperation | "handled" | null> {
  const resolution = resolveTodoDockDrop({
    dockId: input.dockId,
    activeContainerId: input.activeContainerId,
    activeParentId: input.activeParentId,
  });
  if (resolution.kind === "not-dock") return null;
  if (resolution.kind === "grab-to-hand") {
    try {
      await deps.grabToHand(input.activeId);
      // 抓到手头是**落位成功**,只是被坞消化掉、不再走页面的 op switch,于是曾经绕过了那边的
      // hapticDrop——同一个动作在药丸上震、在池子里不震,口径劈叉。放在 await 之后:
      // 与其余落位不同,这一支的成败要等写入回来才知道,失败(下面 catch)不该震。
      deps.hapticDrop();
    } catch (error) {
      // grabTaskToHand 的抛错消息本就是用户文案(如「子任务不能单独抓到手头」),直接说给用户;
      // 静默吞掉的话体感是「拖上去没反应」——投项目有拒绝 toast、投手头没有,口径会劈叉。
      console.error("[todo] 投递到手头失败:", error);
      deps.showToast(error instanceof Error ? error.message : "抓到手头失败");
    }
    return "handled";
  }
  if (resolution.kind === "op") return resolution.op;
  // invalid:用户可达的只有子任务投项目药丸(拒绝口径与项目卡逐字相同);
  // 其余组合(手头源投任意坞、同池重排)药丸本就不渲染,是防御层命中,静默即可。
  // 注意:"hand+子任务"(子任务投手头坞)不在此列——resolveTodoDockDrop 已把它截成
  // promote-to-hand 的 op,走上面 "op" 分支,不会落到这里。
  if (resolution.target.kind === "project" && parseTodoContainerId(input.activeContainerId)?.kind === "parent") {
    const title = deps.findGoalTitle(resolution.target.goalId);
    if (title !== null) deps.showToast(deps.subtaskBlockMessage(title));
  }
  return "handled";
}
