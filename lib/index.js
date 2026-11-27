/**
 * Host half of dsh-active-sessions.
 *
 * 界面全部在 `lib/client.js`；这里只做一件事：把"每一轮是怎么结束的"折成一个
 * 投影，让侧栏能区分**执行成功**和**执行失败**。
 *
 * 为什么必须放在 Host：`turn/end` 事件带 `reason`（completed / error /
 * aborted / blocked / max-tokens / interrupted / forked），但这个原因没有进
 * 任何现成投影，也没有进会话摘要。客户端能看到 `running`、`pendingInteraction`、
 * `completionUnread`，却看不到"上一轮是不是报错了"。而事件日志只有 Host 侧
 * 的投影注册表能系统性读取，所以在这里折。
 *
 * 没有声明 `summary: false`，投影值会随会话列表行一起下发（含冷会话的缓存块），
 * 因此不必先打开会话就能知道它上次失败了。
 *
 * @module dsh-active-sessions
 */

/** 依赖的 Host 服务。`sessionProjections` 是投影注册表。 */
export const inject = ["sessionProjections"];

/** 投影 key。带前缀，避免和其它插件装好的 key 撞名。 */
const PROJECTION_KEY = "activeSessionsTurn";

/** 一轮正常/异常结束的状态取值。`idle` 表示这个会话还没有任何一轮。 */
const IDLE = Object.freeze({
  status: "idle",
  failed: false,
  turn: 0,
  seq: null,
  time: null,
  message: "",
  code: ""
});

/**
 * 把 `turn/end` 的 reason 归一成 {status, failed, message, code}。
 *
 * `failed` 的口径对齐 DSH 自己渲染 `turn-error` 行的规则：只有 error、进程
 * 中途退出、以及"退出登录导致中止"算失败；用户主动停止、blocked、
 * max-tokens 都不算失败（它们是正常但不完整的结果）。
 *
 * @param reason - `turn/end.data.reason`
 * @returns 归一后的事实
 */
function outcomeOf(reason) {
  const kind = typeof reason?.kind === "string" ? reason.kind : "completed";

  switch (kind) {
    case "error": {
      const failure = reason.error ?? {};
      const message =
        typeof failure.message === "string" && failure.message !== ""
          ? failure.message
          : "执行失败";
      const code = typeof failure.code === "string" && failure.code !== "" ? failure.code : "UNKNOWN";
      return { status: "error", failed: true, message, code };
    }
    case "aborted": {
      // 只有"退出登录把这一轮打断"算失败；用户按停止键不算。
      const cause = reason.reason ?? {};
      const signedOut =
        cause.kind === "hook" && typeof cause.reason === "string" && cause.reason.includes("signed-out");
      return signedOut
        ? { status: "aborted", failed: true, message: "因为你退出登录而中止", code: "ACCOUNT_SIGNED_OUT" }
        : { status: "aborted", failed: false, message: "", code: "" };
    }
    case "interrupted":
      return {
        status: "interrupted",
        failed: true,
        message: "DSH 进程在这一轮结束前退出了",
        code: "INTERRUPTED"
      };
    case "max-tokens":
      return { status: "max-tokens", failed: false, message: "", code: "" };
    case "blocked":
      return { status: "blocked", failed: false, message: "", code: "" };
    case "forked":
      return { status: "forked", failed: false, message: "", code: "" };
    default:
      return { status: "completed", failed: false, message: "", code: "" };
  }
}

/**
 * 装一个投影：会话最近一轮的结局。
 *
 * `apply` 必须对不关心的事件返回**同一个引用**——注册表用 `Object.is` 判断
 * 有没有变化，返回新对象会制造无谓的重新下发。
 *
 * @param ctx - plugin context
 * @returns 注册完成的 promise
 */
export function apply(ctx) {
  const registry = ctx.sessionProjections;
  if (registry === undefined || typeof registry.register !== "function") return;

  // 运行时只调用 `.parse`（见 dsh-session-projection 的注册表实现），所以这里
  // 不需要引入 zod：给一个只做返回的校验器即可，省掉一个依赖。
  const passthrough = { parse: (value) => value };

  return registry.register({
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: passthrough,
    init: () => IDLE,
    apply: (state, event) => {
      switch (event.type) {
        case "turn/start":
          return {
            status: "running",
            failed: false,
            turn: typeof event.data?.turn === "number" ? event.data.turn : state.turn + 1,
            seq: event.seq,
            time: event.time ?? null,
            message: "",
            code: ""
          };
        case "turn/end": {
          const outcome = outcomeOf(event.data?.reason);
          const turn =
            typeof event.data?.turn === "number" ? event.data.turn : state.turn;
          return {
            status: outcome.status,
            failed: outcome.failed,
            turn,
            seq: event.seq,
            time: event.time ?? null,
            message: outcome.message,
            code: outcome.code
          };
        }
        default:
          return state;
      }
    },
    wire: {
      viewSchema: passthrough,
      // 状态本身就是 wire 值，直接返回可保证引用稳定、避免重复下发。
      view: (state) => state
    }
  });
}
