/**
 * dsh-active-sessions — 浏览器端。
 *
 * 一个左侧栏入口（排在 插件 / 更多 之上）加一个 main 面板，用来一眼看清
 * 现在哪些会话在跑、哪些在等你处理、哪些已经结束但还没看过。
 *
 * 数据全部来自已经装配好的根级 standard share，不新增任何 Host 侧接口：
 *   - useSessions      → ctx.sessions.list（会话列表快照）
 *   - useSessionStatus → ui-session 的 unified status（running / pendingInteraction / completionUnread）
 *   - useWorkspaces    → ctx.workspaces.list（工作区、归档集、置顶集）
 *
 * 打开会话复用 uiWorkspace.openSession()：它内部 retain 会话并把 main 面板
 * 切回对话（selectPanel(null)），所以这里不需要再动 layout。
 *
 * 视角两种：
 *   - 按天：最近 N 个自然日（N 默认 1 = 今天，可手输），窗口内按状态分组
 *   - 按活跃：不看时间，只要 运行中 / 待确认 / 已结束未查看
 */

window.__ModuleLoader__.load({
  id: "dsh-active-sessions",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");

    /** 侧栏入口与 main 面板共用的唯一 id。 */
    const PANEL_ID = "active-sessions";
    const NS = "activeSessions";
    const STORAGE_KEY = "dsh-active-sessions:settings";
    const DAY_MS = 86400000;
    const TICK_MS = 30000;

    // #region 文案
    const zh = {
      "panel": "活跃会话",
      "title": "活跃会话",
      "subtitle": "哪些在跑、哪些在等你、哪些看过了",
      "mode.day": "按天",
      "mode.activity": "按活跃",
      "mode.day.hint": "最近几天内有动作的会话，按状态分组",
      "mode.activity.hint": "只看正在跑、待你确认、已结束未查看",
      "days.label": "天数",
      "days.unit": "天",
      "days.today": "今天",
      "preset.3": "近 3 天",
      "preset.7": "近 7 天",
      "preset.30": "近 30 天",
      "sum.running": "运行中",
      "sum.waiting": "待你处理",
      "sum.unread": "未查看",
      "sum.idle": "空转",
      "group.running": "正在执行",
      "group.waiting": "等你处理",
      "group.unread": "已结束 · 未查看",
      "group.idle": "最近有动作",
      "state.running": "执行中",
      "state.approval": "等批准",
      "state.plan": "等确认计划",
      "state.question": "等你回答",
      "state.unread": "已完成未看",
      "state.idle": "空转",
      "meta.subagents": "{n} 个子代理在跑",
      "meta.current": "当前",
      "empty.activity": "现在没有在跑、待确认或未查看的会话",
      "empty.day": "最近 {n} 天内没有会话动作",
      "empty.dayOne": "今天还没有会话动作",
      "loading": "正在读取会话列表…",
      "time.now": "刚刚",
      "time.min": "{n} 分钟前",
      "time.hour": "{n} 小时前",
      "time.day": "{n} 天前"
    };
    const en = {
      "panel": "Active sessions",
      "title": "Active sessions",
      "subtitle": "What is running, what waits for you, what you have not read",
      "mode.day": "By day",
      "mode.activity": "By activity",
      "mode.day.hint": "Sessions with activity in the last few days, grouped by state",
      "mode.activity.hint": "Only running, awaiting you, and finished-unread",
      "days.label": "Days",
      "days.unit": "d",
      "days.today": "Today",
      "preset.3": "3 days",
      "preset.7": "7 days",
      "preset.30": "30 days",
      "sum.running": "Running",
      "sum.waiting": "Waiting",
      "sum.unread": "Unread",
      "sum.idle": "Idle",
      "group.running": "Running now",
      "group.waiting": "Waiting for you",
      "group.unread": "Finished · unread",
      "group.idle": "Recent activity",
      "state.running": "Running",
      "state.approval": "Needs approval",
      "state.plan": "Plan review",
      "state.question": "Answer needed",
      "state.unread": "Unread result",
      "state.idle": "Idle",
      "meta.subagents": "{n} subagents running",
      "meta.current": "Current",
      "empty.activity": "Nothing running, waiting, or unread right now",
      "empty.day": "No session activity in the last {n} days",
      "empty.dayOne": "No session activity today",
      "loading": "Reading the session list…",
      "time.now": "now",
      "time.min": "{n} min ago",
      "time.hour": "{n} h ago",
      "time.day": "{n} d ago"
    };
    // #endregion

    // #region 样式
    const css = `
.as-root{box-sizing:border-box;height:100%;overflow:auto;padding:26px 22px 56px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5}
.as-wrap{max-width:940px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.as-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.as-title{margin:0;font-size:19px;font-weight:600;letter-spacing:.01em}
.as-sub{margin:4px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.as-modes{display:flex;gap:2px;padding:2px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3)}
.as-mode{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:5px 12px;border-radius:calc(var(--dsw-radius-md) - 2px);cursor:pointer}
.as-mode:hover{background:var(--dsw-alias-interactive-bg-hover)}
.as-mode[aria-pressed="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgb(0 0 0 / .12)}
.as-mode:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.as-daybar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.as-chip{appearance:none;border:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;cursor:pointer}
.as-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.as-chip[aria-pressed="true"]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.as-days{display:inline-flex;align-items:center;gap:6px;margin-left:2px}
.as-days input{width:58px;box-sizing:border-box;font:inherit;font-size:12px;padding:3px 6px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.as-days input:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:0}
.as-sums{display:flex;gap:8px;flex-wrap:wrap}
.as-sum{display:flex;align-items:baseline;gap:6px;padding:6px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3)}
.as-sum b{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}
.as-sum span{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.as-sum[data-tone="running"] b{color:var(--dsw-alias-state-success-primary)}
.as-sum[data-tone="waiting"] b{color:var(--dsw-alias-state-warn-primary)}
.as-sum[data-tone="unread"] b{color:var(--dsw-alias-state-business-primary)}
.as-group{display:flex;flex-direction:column;gap:2px}
.as-grouphead{display:flex;align-items:center;gap:8px;margin:0;padding:4px 2px;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.as-grouphead em{font-style:normal;font-weight:400;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.as-row{display:grid;grid-template-columns:14px minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:9px 10px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
@media (hover:hover){.as-row:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.as-row:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.as-dot{width:8px;height:8px;border-radius:50%;justify-self:center;background:var(--dsw-alias-border-l3)}
.as-dot[data-state="running"]{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 22%,transparent);animation:as-pulse 1.6s ease-in-out infinite}
.as-dot[data-state="waiting"]{background:var(--dsw-alias-state-warn-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 22%,transparent)}
.as-dot[data-state="unread"]{background:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,transparent)}
@keyframes as-pulse{0%,100%{opacity:1}50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.as-dot[data-state="running"]{animation:none}}
.as-main{min-width:0;display:flex;flex-direction:column;gap:2px}
.as-rowtitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px}
.as-rowmeta{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);min-width:0}
.as-rowmeta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.as-rowmeta i{font-style:normal;opacity:.45}
.as-tail{display:flex;align-items:center;gap:8px;flex:none}
.as-badge{font-size:11px;padding:1px 7px;border-radius:999px;white-space:nowrap;border:.5px solid transparent}
.as-badge[data-tone="running"]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,transparent)}
.as-badge[data-tone="waiting"]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 34%,transparent)}
.as-badge[data-tone="unread"]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent)}
.as-badge[data-tone="muted"]{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l3)}
.as-time{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;min-width:56px;text-align:right}
.as-empty{padding:34px 8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.as-glyph{position:relative;display:inline-flex;align-items:center;justify-content:center}
.as-glyphBadge{position:absolute;top:-4px;right:-6px;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-static-neutral-00);font-size:9.5px;font-weight:600;line-height:14px;text-align:center;font-variant-numeric:tabular-nums}
.as-glyphBadge[data-tone="waiting"]{background:var(--dsw-alias-state-warn-primary)}
.as-glyphBadge[data-tone="running"]{background:var(--dsw-alias-state-success-primary)}

/* 工作区行角标：ui-workspace 的工作区行没有可用于挂载内容的 slot，
   所以角标由一个伪元素画出来，内容取自本插件写在行上的 data-as-count。
   伪元素不进 tab 序、不可点、不参与无障碍树，纯粹是视觉补充。 */
[data-row-key^="workspace:"][data-as-count]::after{content:attr(data-as-count);display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:16px;height:16px;padding:0 4px;margin-left:6px;border-radius:999px;font-size:10px;font-weight:600;line-height:16px;font-variant-numeric:tabular-nums;letter-spacing:0;flex:none;color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-state-success-primary)}
[data-row-key^="workspace:"][data-as-count][data-as-tone="waiting"]::after{background:var(--dsw-alias-state-warn-primary)}
[data-row-key^="workspace:"][data-as-count][data-as-tone="running"]::after{animation:as-count-breathe 2.4s ease-in-out infinite}
@keyframes as-count-breathe{0%,100%{opacity:1}50%{opacity:.72}}
@media (prefers-reduced-motion:reduce){[data-row-key^="workspace:"][data-as-count][data-as-tone="running"]::after{animation:none}}
/* 收成 56px 竖条时行内已没有标题文字，角标只会挤在一起，所以隐藏。 */
[data-sidebar-collapsed] [data-row-key^="workspace:"][data-as-count]::after{display:none}
`;
    const cssAnchor = "dsh-active-sessions/app.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(cssAnchor) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-active-sessions";
      tag.dataset.pluginCss = cssAnchor;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    // #endregion

    // #region 设置持久化
    const DEFAULT_SETTINGS = { mode: "day", days: 1 };

    function clampDays(value) {
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n)) return DEFAULT_SETTINGS.days;
      return Math.min(365, Math.max(1, n));
    }

    function readSettings() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return {
          mode: parsed?.mode === "activity" ? "activity" : "day",
          days: clampDays(parsed?.days)
        };
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    }

    function writeSettings(settings) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* 隐私模式 / 配额满：设置退回本次页面生效，不值得打断用户 */
      }
    }
    // #endregion

    // #region 纯函数：分类 / 时间
    /** 本地时间当天 0 点。 */
    function startOfToday(now) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }

    /** 窗口起点：最近 N 个自然日的第一天 0 点。 */
    function windowStart(days, now) {
      return startOfToday(now) - (clampDays(days) - 1) * DAY_MS;
    }

    function pendingKindOf(status) {
      const kind = status?.pendingInteraction?.kind;
      return kind === "approval" || kind === "plan-review" || kind === "question" ? kind : undefined;
    }

    /**
     * 一个会话的展示状态：running > 待确认 > 已完成未查看 > 空转。
     * @param status ui-session 的 unified status（可能缺失）
     * @param summary 会话列表行（可能缺失）
     */
    function stateOf(status, summary) {
      if (status?.running === true || summary?.running === true) return "running";
      if (pendingKindOf(status) !== undefined) return "waiting";
      if (status?.completionUnread === true) return "unread";
      return "idle";
    }

    function relTime(updatedAt, now, t) {
      if (!Number.isFinite(updatedAt)) return "";
      const diff = Math.max(0, now - updatedAt);
      if (diff < 60000) return t("time.now");
      const min = Math.floor(diff / 60000);
      if (min < 60) return t("time.min", { n: min });
      const hour = Math.floor(min / 60);
      if (hour < 24) return t("time.hour", { n: hour });
      return t("time.day", { n: Math.floor(hour / 24) });
    }

    /** 目录名：会话还没生成标题时，至少能看出是哪个项目。 */
    function baseName(path) {
      if (typeof path !== "string" || path === "") return "";
      const trimmed = path.replace(/[/\\]+$/, "");
      const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
      return trimmed.slice(index + 1);
    }

    function workspaceLabels(workspaces) {
      const bySession = new Map();
      for (const workspace of workspaces ?? []) {
        for (const id of workspace.sessionIds ?? []) bySession.set(id, workspace.title);
      }
      return bySession;
    }

    /** 已加载的父会话目录里还有几个子代理在跑（与左侧栏的 loader 同源）。 */
    function runningChildren(list, parentId, statuses) {
      const catalog = list.projectionsBySession?.[parentId]?.values?.subagentCatalog;
      if (!Array.isArray(catalog)) return 0;
      let count = 0;
      for (const child of catalog) {
        const status = statuses instanceof Map ? statuses.get(child.id) : undefined;
        const summary = list.byId?.[child.id];
        if (status?.running === true || (status === undefined && summary?.running === true)) count += 1;
      }
      return count;
    }

    /**
     * 把会话列表折叠成可渲染的行。
     * 与左侧栏保持一致：隐藏子代理会话、隐藏未开始的空白会话、跳过已归档会话
     * （归档是明确动作，归档件不该再占"现在在干什么"的位置）。
     *
     * 时间窗（按天模式）只筛"空转"的行。运行中 / 待确认 / 已结束未查看是
     * **此刻正在发生的状态**，不是历史记录，所以不受窗口约束——否则一个
     * 23:50 启动、跨过零点仍在跑的会话，updatedAt 还停在昨天，就会从"今天"
     * 里整个消失，而这恰恰是最该被看见的那一个。
     */
    function buildRows({ list, statuses, workspaces, now, mode, days, t }) {
      const rows = [];
      if (list === undefined || list.phase !== "ready") return { rows, ready: false };
      const archived = new Set(workspaces?.archivedSessionIds ?? []);
      const labels = workspaceLabels(workspaces?.items);
      const start = mode === "day" ? windowStart(days, now) : Number.NEGATIVE_INFINITY;
      const currentId = Object.values(list.byId).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id;

      for (const id of list.ids ?? []) {
        const summary = list.byId[id];
        if (summary === undefined) continue;
        if (summary.origin === "subagent") continue;
        if (summary.blank === true) continue;
        if (archived.has(id)) continue;
        const updatedAt = Number(summary.updatedAt);
        const status = statuses instanceof Map ? statuses.get(id) : undefined;
        const state = stateOf(status, summary);
        if (mode === "activity" && state === "idle") continue;
        // 只有空转的行才受时间窗约束；活跃状态一律保留。
        if (state === "idle" && !(updatedAt >= start)) continue;
        const title = (summary.title ?? "").trim() || baseName(summary.cwd) || t("panel");
        rows.push({
          id,
          title,
          workspace: labels.get(id) ?? baseName(summary.cwd),
          updatedAt,
          state,
          pendingKind: pendingKindOf(status),
          children: runningChildren(list, id, statuses),
          current: id === currentId
        });
      }

      rows.sort((left, right) => right.updatedAt - left.updatedAt);
      return { rows, ready: true };
    }
    // #endregion

    // #region 图标
    /** 侧栏图标：一个脉冲点 + 两条扩散弧，暗示"正在活动"。 */
    function ActiveSessionsGlyph(props) {
      const size = typeof props?.size === "number" ? props.size : 16;
      return React.createElement(
        "svg",
        { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
        React.createElement("circle", { cx: 6.6, cy: 8, r: 2.4, fill: "currentColor" }),
        React.createElement("path", {
          d: "M10.6 4.7a4.9 4.9 0 0 1 0 6.6",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinecap: "round",
          opacity: 0.85
        }),
        React.createElement("path", {
          d: "M12.7 2.7a7.6 7.6 0 0 1 0 10.6",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinecap: "round",
          opacity: 0.42
        })
      );
    }

    /** 宿主没装某个 standard source 时的稳定空 hook，保证 hook 调用顺序不变。 */
    function useNothing() {
      return undefined;
    }

    /**
     * 侧栏入口的图标：带活跃数量气泡。
     * 侧栏只把 glyph 渲染进 panelRow，标签由 sidebar 自己渲染，
     * 所以计数只能挂在图标上。
     */
    function ActiveSessionsIcon(props) {
      const useSessionStatus = props.useSessionStatus ?? useNothing;
      const statuses = useSessionStatus((value) => value);
      let running = 0;
      let waiting = 0;
      if (statuses instanceof Map) {
        for (const status of statuses.values()) {
          if (status?.running === true) running += 1;
          else if (pendingKindOf(status) !== undefined) waiting += 1;
        }
      }
      const total = running + waiting;
      const tone = waiting > 0 ? "waiting" : running > 0 ? "running" : undefined;
      const glyph = React.createElement(ActiveSessionsGlyph, { size: props.size });
      if (total === 0) return React.createElement("span", { className: "as-glyph" }, glyph);
      return React.createElement(
        "span",
        { className: "as-glyph" },
        glyph,
        React.createElement(
          "span",
          { className: "as-glyphBadge", "data-tone": tone },
          total > 99 ? "99+" : String(total)
        )
      );
    }
    // #endregion

    // #region main 面板
    function SegmentedMode({ mode, onChange, t }) {
      const items = [
        ["day", t("mode.day")],
        ["activity", t("mode.activity")]
      ];
      return React.createElement(
        "div",
        { className: "as-modes", role: "group" },
        items.map(([value, label]) =>
          React.createElement(
            "button",
            {
              key: value,
              type: "button",
              className: "as-mode",
              "aria-pressed": mode === value ? "true" : "false",
              onClick: () => onChange(value)
            },
            label
          )
        )
      );
    }

    function DayBar({ days, onDays, t }) {
      const presets = [
        [1, t("days.today")],
        [3, t("preset.3")],
        [7, t("preset.7")],
        [30, t("preset.30")]
      ];
      return React.createElement(
        "div",
        { className: "as-daybar" },
        presets.map(([value, label]) =>
          React.createElement(
            "button",
            {
              key: value,
              type: "button",
              className: "as-chip",
              "aria-pressed": days === value ? "true" : "false",
              onClick: () => onDays(value)
            },
            label
          )
        ),
        React.createElement(
          "label",
          { className: "as-days" },
          t("days.label"),
          React.createElement("input", {
            type: "number",
            min: 1,
            max: 365,
            step: 1,
            value: String(days),
            "aria-label": t("days.label"),
            onChange: (event) => onDays(event.target.value)
          }),
          t("days.unit")
        )
      );
    }

    function Summary({ counts, t }) {
      const cells = [
        ["running", t("sum.running"), counts.running],
        ["waiting", t("sum.waiting"), counts.waiting],
        ["unread", t("sum.unread"), counts.unread],
        ["idle", t("sum.idle"), counts.idle]
      ];
      return React.createElement(
        "div",
        { className: "as-sums" },
        cells.map(([tone, label, value]) =>
          React.createElement(
            "div",
            { key: tone, className: "as-sum", "data-tone": tone },
            React.createElement("b", null, String(value)),
            React.createElement("span", null, label)
          )
        )
      );
    }

    function stateName(row, t) {
      if (row.state === "waiting") {
        if (row.pendingKind === "approval") return t("state.approval");
        if (row.pendingKind === "plan-review") return t("state.plan");
        return t("state.question");
      }
      if (row.state === "running") return t("state.running");
      if (row.state === "unread") return t("state.unread");
      return t("state.idle");
    }

    function SessionRow({ row, now, onOpen, t }) {
      const label = stateName(row, t);
      const meta = [];
      if (row.workspace !== "") meta.push(row.workspace);
      if (row.children > 0) meta.push(t("meta.subagents", { n: row.children }));

      return React.createElement(
        "button",
        {
          type: "button",
          className: "as-row",
          title: row.title + " — " + label,
          onClick: () => onOpen(row),
          "aria-label": row.title + " · " + label
        },
        React.createElement("span", { className: "as-dot", "data-state": row.state, "aria-hidden": "true" }),
        React.createElement(
          "span",
          { className: "as-main" },
          React.createElement("span", { className: "as-rowtitle" }, row.title),
          meta.length === 0
            ? null
            : React.createElement(
                "span",
                { className: "as-rowmeta" },
                meta.map((part, index) =>
                  React.createElement(
                    React.Fragment,
                    { key: index },
                    index > 0 ? React.createElement("i", null, "·") : null,
                    React.createElement("span", null, part)
                  )
                )
              )
        ),
        React.createElement(
          "span",
          { className: "as-tail" },
          row.state === "idle"
            ? null
            : React.createElement(
                "span",
                {
                  className: "as-badge",
                  "data-tone": row.state === "waiting" ? "waiting" : row.state === "unread" ? "unread" : "running"
                },
                label
              ),
          row.current
            ? React.createElement("span", { className: "as-badge", "data-tone": "muted" }, t("meta.current"))
            : null,
          React.createElement("span", { className: "as-time" }, relTime(row.updatedAt, now, t))
        )
      );
    }

    function Group({ label, rows, now, onOpen, t }) {
      if (rows.length === 0) return null;
      return React.createElement(
        "section",
        { className: "as-group" },
        React.createElement(
          "h2",
          { className: "as-grouphead" },
          label,
          React.createElement("em", null, String(rows.length))
        ),
        rows.map((row) => React.createElement(SessionRow, { key: row.id, row, now, onOpen, t }))
      );
    }

    /** main 槽位里的面板本体。 */
    function ActiveSessionsPanel(props) {
      const t = props.t;
      const useSessions = props.useSessions ?? useNothing;
      const useSessionStatus = props.useSessionStatus ?? useNothing;
      const useWorkspaces = props.useWorkspaces ?? useNothing;
      const openSession = props.openSession;

      const [settings, setSettings] = React.useState(readSettings);
      const [now, setNow] = React.useState(() => Date.now());

      // 相对时间会自然过期，"今天"的边界也会跨过去；30 秒重算一次足够。
      React.useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
        return () => window.clearInterval(timer);
      }, []);

      const update = React.useCallback((patch) => {
        setSettings((previous) => {
          const next = { ...previous, ...patch };
          next.days = clampDays(next.days);
          writeSettings(next);
          return next;
        });
      }, []);

      const list = useSessions((value) => value);
      const statuses = useSessionStatus((value) => value);
      const workspaces = useWorkspaces((value) => value);

      const built = React.useMemo(
        () =>
          buildRows({
            list,
            statuses,
            workspaces,
            now,
            mode: settings.mode,
            days: settings.days,
            t
          }),
        [list, statuses, workspaces, now, settings.mode, settings.days, t]
      );

      const counts = { running: 0, waiting: 0, unread: 0, idle: 0 };
      for (const row of built.rows) counts[row.state] += 1;

      const of = (state) => built.rows.filter((row) => row.state === state);
      const groups = [
        ["running", t("group.running"), of("running")],
        ["waiting", t("group.waiting"), of("waiting")],
        ["unread", t("group.unread"), of("unread")]
      ];
      if (settings.mode === "day") groups.push(["idle", t("group.idle"), of("idle")]);

      const onOpen = React.useCallback(
        (row) => {
          if (typeof openSession === "function") openSession(row.id);
        },
        [openSession]
      );

      const emptyText =
        settings.mode === "activity"
          ? t("empty.activity")
          : settings.days === 1
            ? t("empty.dayOne")
            : t("empty.day", { n: settings.days });

      let body;
      if (!built.ready) body = React.createElement("div", { className: "as-empty" }, t("loading"));
      else if (built.rows.length === 0) body = React.createElement("div", { className: "as-empty" }, emptyText);
      else
        body = groups.map(([key, label, rows]) =>
          React.createElement(Group, { key, label, rows, now, onOpen, t })
        );

      return React.createElement(
        "div",
        { className: "as-root" },
        React.createElement(
          "div",
          { className: "as-wrap" },
          React.createElement(
            "div",
            { className: "as-head" },
            React.createElement(
              "div",
              null,
              React.createElement("h1", { className: "as-title" }, t("title")),
              React.createElement(
                "p",
                { className: "as-sub" },
                settings.mode === "day" ? t("mode.day.hint") : t("mode.activity.hint")
              )
            ),
            React.createElement(SegmentedMode, {
              mode: settings.mode,
              onChange: (mode) => update({ mode }),
              t
            })
          ),
          settings.mode === "day"
            ? React.createElement(DayBar, { days: settings.days, onDays: (days) => update({ days }), t })
            : null,
          built.ready ? React.createElement(Summary, { counts, t }) : null,
          body
        )
      );
    }
    /**
     * 造一个"把工作区活跃数写到侧栏行上"的写入器。
     *
     * ui-workspace 的工作区行没有任何可用于挂载内容的 slot（只有会话行有
     * leading / trailing / hover 三个），所以这里不去改它的 React 树，而是
     * 在渲染之后给行元素打 data-as-count / data-as-tone，由本插件的 CSS
     * 用 ::after 把角标画出来。
     *
     * 在 DOM 上做代理总是有点脆：行元素靠 `data-row-key="workspace:<key>"`
     * 定位，这个属性是 ui-workspace 自己为拖拽和菜单加的稳定标识。找不到
     * 目标行时静默跳过——角标消失好过抛错。
     *
     * @param ctx cordis client context（用来把清理挂到 fiber 上）
     * @returns 接收 counts 的写入器
     */
    function createWorkspaceBadgeWriter(ctx) {
      let latest = new Map();

      const paint = () => {
        const rows = document.querySelectorAll('[data-row-key^="workspace:"]');
        for (const row of rows) {
          const key = (row.getAttribute("data-row-key") ?? "").slice("workspace:".length);
          const entry = latest.get(key);
          const total = entry === undefined ? 0 : entry.running + entry.waiting;
          if (total === 0) {
            row.removeAttribute("data-as-count");
            row.removeAttribute("data-as-tone");
            continue;
          }
          row.setAttribute("data-as-count", total > 99 ? "99+" : String(total));
          row.setAttribute("data-as-tone", entry.waiting > 0 ? "waiting" : "running");
        }
      };

      // ui-workspace 展开工作区、切换视图时都会插入新行，所以除了数据变化时
      // 主动重画，再挂一个窄范围的观察器兜住"行是新的、数据是旧的"这种时刻。
      let scheduled = false;
      const observer =
        typeof MutationObserver === "undefined"
          ? undefined
          : new MutationObserver(() => {
              if (scheduled) return;
              scheduled = true;
              requestAnimationFrame(() => {
                scheduled = false;
                paint();
              });
            });

      const attach = () => {
        const tree = document.querySelector('[role="tree"]');
        if (tree === null || observer === undefined) return;
        observer.observe(tree, { childList: true, subtree: true });
      };
      attach();

      ctx.effect(
        () => () => {
          observer?.disconnect();
        },
        "active-sessions: workspace badge observer"
      );

      return (counts) => {
        latest = counts;
        paint();
      };
    }

    /** 把一个会话已经算好的状态归到它所属的工作区上。 */
    function workspaceCounts(rows, workspaces) {
      const owner = new Map();
      for (const workspace of workspaces ?? []) {
        for (const id of workspace.sessionIds ?? []) owner.set(id, workspace.workspaceId);
      }
      const counts = new Map();
      for (const row of rows) {
        const key = owner.get(row.id);
        if (key === undefined) continue;
        const entry = counts.get(key) ?? { running: 0, waiting: 0 };
        if (row.state === "running") entry.running += 1;
        else if (row.state === "waiting") entry.waiting += 1;
        counts.set(key, entry);
      }
      return counts;
    }

    /**
     * 一个不渲染任何界面的旁观者，挂在 `shell.overlay` 里：
     * 每次会话状态变化时重算各工作区的活跃数，写回侧栏的工作区行。
     */
    function WorkspaceBadgeBridge(props) {
      const useSessions = props.useSessions ?? useNothing;
      const useSessionStatus = props.useSessionStatus ?? useNothing;
      const useWorkspaces = props.useWorkspaces ?? useNothing;
      const write = props.writeBadges;

      const list = useSessions((value) => value);
      const statuses = useSessionStatus((value) => value);
      const workspaces = useWorkspaces((value) => value);

      const counts = React.useMemo(() => {
        // 角标只回答"这个工作区里有几个在等我/在跑"，与面板的时间窗无关，
        // 所以固定用按活跃口径，并同样跳过子代理、空白和已归档会话。
        const built = buildRows({
          list,
          statuses,
          workspaces,
          now: Date.now(),
          mode: "activity",
          days: 1,
          t: (key) => key
        });
        return workspaceCounts(built.rows, workspaces?.items);
      }, [list, statuses, workspaces]);

      React.useEffect(() => {
        if (typeof write === "function") write(counts);
      }, [counts, write]);

      return null;
    }

    // #endregion

    /** 依赖的 Client 服务：slot 系统、词典、会话对象层、工作区投影。 */
    const inject = ["slots", "locale", "sessions", "workspaces", "uiWorkspace"];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "active-sessions: dictionaries");
      const t = ctx.locale.bind(NS);

      // 侧栏入口：order 取负值，排在 插件(0) / 自动化(10) / 上下文(20) 之前，
      // 也就是整个面板列表最上面、紧挨"新会话"。
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: -10,
            label: () => t("panel"),
            locale: NS
          },
          ActiveSessionsIcon
        )
      );

      // main 面板：点击侧栏入口时由 layout.selectPanel(PANEL_ID) 选中。
      // openSession 内部会把 main 切回对话，所以点一行就到位。
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: PANEL_ID,
            locale: NS,
            inject: () => ({
              openSession: (sessionId) => {
                const uiWorkspace = ctx.get("uiWorkspace");
                uiWorkspace?.openSession(sessionId);
              }
            })
          },
          ActiveSessionsPanel
        )
      );

      // 工作区行角标：一个零渲染组件挂在 shell.overlay 里，只负责把各工作区的
      // 活跃数写到侧栏对应行上（CSS 再用 ::after 画出来）。
      const writeBadges = createWorkspaceBadgeWriter(ctx);
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          {
            name: "shell.overlay",
            id: "active-sessions-workspace-badges",
            inject: () => ({ writeBadges })
          },
          WorkspaceBadgeBridge
        )
      );
    }
    // #endregion

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
