import { describe, expect, it } from "vitest";
import { resolveDiaryDate } from "./diaryDate.js";

const TODAY = "2026-07-25";

describe("resolveDiaryDate", () => {
  describe("跟随模式（URL 无 ?date=）", () => {
    it("锚点就是今天时展示今天、不提示", () => {
      expect(resolveDiaryDate({ param: null, liveToday: TODAY, followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: false,
        clearParam: false,
      });
    });

    it("实时今天已越过锚点时展示锚点日期并提示（不自动切）", () => {
      // 这是核心需求：用户 23:58 打开，坐过零点，正文还停在昨天那篇，只给提示
      expect(resolveDiaryDate({ param: null, liveToday: "2026-07-26", followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: true,
        clearParam: false,
      });
    });

    it("连续跨两天仍然只提示，日期仍停在锚点", () => {
      expect(resolveDiaryDate({ param: null, liveToday: "2026-07-27", followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: true,
        clearParam: false,
      });
    });

    it("设备时钟回拨导致锚点晚于今天时钳到今天且不提示", () => {
      // 提示条的语义是"往前走到今天"，锚点比今天还晚时提示它毫无意义
      expect(resolveDiaryDate({ param: null, liveToday: TODAY, followAnchor: "2026-07-26" })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: false,
        clearParam: false,
      });
    });
  });

  describe("显式日期模式（URL 有合法过去日期）", () => {
    it("展示该日期、不跟随、不提示、不动 URL", () => {
      expect(resolveDiaryDate({ param: "2026-07-20", liveToday: TODAY, followAnchor: TODAY })).toEqual({
        date: "2026-07-20",
        following: false,
        rolledOver: false,
        clearParam: false,
      });
    });

    it("锚点已过期也绝不提示——用户自己选的补写目标不是被冻住", () => {
      // 最要害的一条：显式模式下 rolledOver 必须恒为 false，
      // 否则用户翻到 7/20 补写时头上会一直挂着"切到今天"，等于劝他别补写
      expect(resolveDiaryDate({ param: "2026-07-20", liveToday: "2026-07-30", followAnchor: TODAY })).toEqual({
        date: "2026-07-20",
        following: false,
        rolledOver: false,
        clearParam: false,
      });
    });
  });

  describe("URL 归一（clearParam）", () => {
    it("?date= 恰是今天 → 等价于跟随模式，要求清掉参数", () => {
      expect(resolveDiaryDate({ param: TODAY, liveToday: TODAY, followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: false,
        clearParam: true,
      });
    });

    it("?date= 是未来日期 → 钳到今天并清参数", () => {
      expect(resolveDiaryDate({ param: "2099-01-01", liveToday: TODAY, followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: false,
        clearParam: true,
      });
    });

    it("?date= 格式非法 → 落回跟随模式并清参数", () => {
      expect(resolveDiaryDate({ param: "abc", liveToday: TODAY, followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: false,
        clearParam: true,
      });
    });

    it("?date= 日历非法（2026-02-31）→ 落回跟随模式并清参数", () => {
      // 正则挡不住这个：V8 会把它静默滚动到 3 月 3 日。必须走 isValidDateString 的回构造比对
      expect(resolveDiaryDate({ param: "2026-02-31", liveToday: TODAY, followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: false,
        clearParam: true,
      });
    });

    it("?date= 月份越界（2026-13-05）→ 落回跟随模式并清参数", () => {
      expect(resolveDiaryDate({ param: "2026-13-05", liveToday: TODAY, followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: false,
        clearParam: true,
      });
    });

    it("?date= 格式非法且字符串序在今天之前（2020-1-1）仍要校验，不能靠未来钳制侥幸兜住", () => {
      // 变异实验发现的真实缺口：param="abc" 字符串序 >= TODAY，删掉 isValidDateString 校验
      // 后仍会被 `param >= liveToday` 的未来钳制分支误捞回 follow，让那条用例测不出校验缺失。
      // 这里选一个格式非法、且字符串序排在 TODAY 之前的值，绕开钳制分支，真正压中校验这一步。
      expect(resolveDiaryDate({ param: "2020-1-1", liveToday: TODAY, followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: false,
        clearParam: true,
      });
    });

    it("?date= 月份越界且字符串序在今天之前（2020-13-05）仍要校验，不能靠未来钳制侥幸兜住", () => {
      // 同上一条同一个缺口，换成日历越界（月份 13）而非格式非法。
      expect(resolveDiaryDate({ param: "2020-13-05", liveToday: TODAY, followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: false,
        clearParam: true,
      });
    });

    it('?date= 带空白（" 2026-07-20 "）不做 trim 挽救，按非法处理', () => {
      // 不 trim 是有意的：searchParams 已经 decode 过，带空白的只可能是手改 URL 或坏链接，
      // 静默"猜"用户意图会让一个坏链接看起来能用，下次换个格式又不行
      expect(resolveDiaryDate({ param: " 2026-07-20 ", liveToday: TODAY, followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: false,
        clearParam: true,
      });
    });

    it("归一掉参数后跟随锚仍然生效：清参数的同时该提示还是要提示", () => {
      // ?date=今天 但锚点是昨天（用户开着页面过了零点、URL 上又恰好挂着今天）
      expect(resolveDiaryDate({ param: "2026-07-26", liveToday: "2026-07-26", followAnchor: TODAY })).toEqual({
        date: TODAY,
        following: true,
        rolledOver: true,
        clearParam: true,
      });
    });
  });
});
