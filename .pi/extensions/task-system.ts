/**
 * Task System — Claude Code-style task management for pi
 *
 * Provides TaskCreate, TaskList, TaskGet, TaskUpdate tools that persist to disk.
 * Designed for swarm-style coordination: sub-agents at any nesting depth can
 * read/write tasks via these tools (they're NOT in pi-subagents' EXCLUDED_TOOL_NAMES).
 *
 * Storage: .pi/tasks/{taskId}.json (project-local, gitignored)
 * Locking: Simple atomic write with read-before-write pattern
 *
 * Usage: pi -e .pi/extensions/task-system.ts
 * Or place in .pi/extensions/ for auto-discovery.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
  owner?: string;
  /** When set, only an agent of this type should execute this task.
   *  Generic workers MUST skip tasks with agentType set.
   *  The orchestrator spawns the specific agent type for gate tasks. */
  agentType?: string;
  blocks: string[];
  blockedBy: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

// ── Storage Layer ────────────────────────────────────────────────────────

class TaskStore {
  private dir: string;
  private highWaterMark: number = 0;

  constructor(cwd: string) {
    this.dir = path.join(cwd, ".pi", "tasks");
    this.ensureDir();
    this.highWaterMark = this.readHighWaterMark();
  }

  private ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    // Ensure tasks dir is gitignored
    const gitignorePath = path.join(this.dir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, "*\n!.gitignore\n");
    }
  }

  private taskPath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private hwmPath(): string {
    return path.join(this.dir, ".highwatermark");
  }

  private readHighWaterMark(): number {
    try {
      const content = fs.readFileSync(this.hwmPath(), "utf-8").trim();
      const val = parseInt(content, 10);
      return isNaN(val) ? 0 : val;
    } catch {
      return 0;
    }
  }

  private writeHighWaterMark(val: number): void {
    fs.writeFileSync(this.hwmPath(), String(val));
  }

  private nextId(): string {
    // Scan existing files + high water mark
    let highest = this.highWaterMark;
    try {
      const files = fs.readdirSync(this.dir);
      for (const f of files) {
        if (f.endsWith(".json")) {
          const num = parseInt(f.replace(".json", ""), 10);
          if (!isNaN(num) && num > highest) highest = num;
        }
      }
    } catch { /* empty dir */ }
    const next = highest + 1;
    this.highWaterMark = next;
    this.writeHighWaterMark(next);
    return String(next);
  }

  create(data: Omit<Task, "id" | "createdAt" | "updatedAt">): Task {
    const id = this.nextId();
    const now = Date.now();
    const task: Task = { id, ...data, createdAt: now, updatedAt: now };
    fs.writeFileSync(this.taskPath(id), JSON.stringify(task, null, 2));
    return task;
  }

  get(id: string): Task | null {
    try {
      const content = fs.readFileSync(this.taskPath(id), "utf-8");
      return JSON.parse(content) as Task;
    } catch {
      return null;
    }
  }

  update(id: string, updates: Partial<Omit<Task, "id" | "createdAt">>): Task | null {
    const existing = this.get(id);
    if (!existing) return null;

    const updated: Task = {
      ...existing,
      ...updates,
      id, // preserve
      createdAt: existing.createdAt, // preserve
      updatedAt: Date.now(),
    };

    // Handle addBlocks / addBlockedBy merge (handled by caller, we just save)
    fs.writeFileSync(this.taskPath(id), JSON.stringify(updated, null, 2));
    return updated;
  }

  delete(id: string): boolean {
    try {
      // Update high water mark before deletion
      const num = parseInt(id, 10);
      if (!isNaN(num) && num > this.highWaterMark) {
        this.highWaterMark = num;
        this.writeHighWaterMark(num);
      }
      fs.unlinkSync(this.taskPath(id));
      // Clean up references in other tasks
      for (const task of this.list()) {
        let changed = false;
        const newBlocks = task.blocks.filter(b => b !== id);
        const newBlockedBy = task.blockedBy.filter(b => b !== id);
        if (newBlocks.length !== task.blocks.length) changed = true;
        if (newBlockedBy.length !== task.blockedBy.length) changed = true;
        if (changed) {
          this.update(task.id, { blocks: newBlocks, blockedBy: newBlockedBy });
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  list(): Task[] {
    try {
      const files = fs.readdirSync(this.dir);
      const tasks: Task[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const id = f.replace(".json", "");
        const task = this.get(id);
        if (task) tasks.push(task);
      }
      // Sort by numeric ID
      tasks.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
      return tasks;
    } catch {
      return [];
    }
  }

  /**
   * Atomic claim: check not owned, not blocked, then set owner + in_progress.
   * Returns the claimed task or a reason for failure.
   */
  claim(id: string, owner: string): { success: boolean; reason?: string; task?: Task } {
    const task = this.get(id);
    if (!task) return { success: false, reason: "task_not_found" };
    if (task.status === "completed") return { success: false, reason: "already_completed", task };
    if (task.owner && task.owner !== owner) return { success: false, reason: `already_claimed_by_${task.owner}`, task };

    // Check blockers — only unresolved ones count
    const allTasks = this.list();
    const completedIds = new Set(allTasks.filter(t => t.status === "completed").map(t => t.id));
    const unresolvedBlockers = task.blockedBy.filter(bid => !completedIds.has(bid));
    if (unresolvedBlockers.length > 0) {
      return { success: false, reason: `blocked_by_${unresolvedBlockers.join(",")}`, task };
    }

    const updated = this.update(id, { owner, status: "in_progress" });
    return { success: true, task: updated! };
  }

  /** Reset all tasks (for new orchestration runs) */
  reset(): number {
    const tasks = this.list();
    let count = 0;
    for (const task of tasks) {
      this.delete(task.id);
      count++;
    }
    return count;
  }
}

// ── Extension ────────────────────────────────────────────────────────────

// ── Widget Helpers ───────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "●",
  completed: "✓",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "muted",
  in_progress: "accent",
  completed: "success",
};

function formatTaskLine(
  task: Task,
  allTasks: Task[],
  theme: { fg(c: string, t: string): string; bold(t: string): string },
  width: number,
): string {
  const completedIds = new Set(allTasks.filter(t => t.status === "completed").map(t => t.id));
  const icon = theme.fg(STATUS_COLORS[task.status] ?? "muted", STATUS_ICONS[task.status] ?? "?");
  const id = theme.fg("dim", `#${task.id}`);
  const subject = task.status === "completed"
    ? theme.fg("dim", task.subject)
    : theme.fg(task.agentType ? "warning" : "toolOutput", task.subject);
  const owner = task.owner ? theme.fg("dim", ` (${task.owner})`) : "";
  const agent = task.agentType ? theme.fg("warning", ` ⚡${task.agentType}`) : "";

  const unresolvedBlockers = task.blockedBy.filter(bid => !completedIds.has(bid));
  const blocked = unresolvedBlockers.length > 0
    ? theme.fg("error", ` ⛔${unresolvedBlockers.map(b => `#${b}`).join(",")}`)
    : "";

  return truncateToWidth(`  ${icon} ${id} ${subject}${owner}${agent}${blocked}`, width);
}

export default function (pi: ExtensionAPI) {
  let store: TaskStore;
  let widgetCtx: any;

  function updateWidget() {
    if (!widgetCtx) return;
    widgetCtx.ui.setWidget("tasks", (_tui: any, theme: any) => {
      return {
        render(width: number): string[] {
          const tasks = store.list();
          if (tasks.length === 0) return [];

          const pending = tasks.filter(t => t.status === "pending").length;
          const inProgress = tasks.filter(t => t.status === "in_progress").length;
          const completed = tasks.filter(t => t.status === "completed").length;

          const lines: string[] = [];
          lines.push(
            theme.fg("accent", "● Tasks") +
            theme.fg("dim", ` (${completed}/${tasks.length} done`) +
            (inProgress > 0 ? theme.fg("accent", `, ${inProgress} active`) : "") +
            (pending > 0 ? theme.fg("muted", `, ${pending} pending`) : "") +
            theme.fg("dim", ")")
          );

          // Show non-completed tasks first, then last few completed
          const active = tasks.filter(t => t.status !== "completed");
          const done = tasks.filter(t => t.status === "completed");

          for (const task of active) {
            if (lines.length >= 14) {
              lines.push(theme.fg("dim", `  ... +${active.length - 12} more`));
              break;
            }
            lines.push(formatTaskLine(task, tasks, theme, width));
          }

          // Show last 2 completed tasks for context
          const recentDone = done.slice(-2);
          if (recentDone.length > 0 && done.length < tasks.length) {
            for (const task of recentDone) {
              lines.push(formatTaskLine(task, tasks, theme, width));
            }
            if (done.length > 2) {
              lines.push(theme.fg("dim", `  ... +${done.length - 2} completed`));
            }
          }

          lines.push(""); // spacer
          return lines;
        },
        invalidate() {},
      };
    });
  }

  let refreshInterval: ReturnType<typeof setInterval> | undefined;

  pi.on("session_start", async (_event, ctx) => {
    store = new TaskStore(ctx.cwd);
    widgetCtx = ctx;

    // Check for stale tasks from a previous session
    const tasks = store.list();
    if (tasks.length > 0 && ctx.hasUI) {
      const pending = tasks.filter(t => t.status === "pending").length;
      const inProgress = tasks.filter(t => t.status === "in_progress").length;
      const completed = tasks.filter(t => t.status === "completed").length;

      const summary = [
        `Found ${tasks.length} task(s) from a previous session`,
        `(${pending} pending, ${inProgress} in-progress, ${completed} completed).`,
      ].join(" ");

      const choice = await ctx.ui.select(summary, [
        "Keep tasks (resume where you left off)",
        "Clear all tasks (fresh start)",
      ]);

      if (choice === "Clear all tasks (fresh start)") {
        store.reset();
        ctx.ui.notify("Tasks cleared.", "info");
      } else {
        updateWidget();
      }
    }

    // Periodic refresh to pick up changes from sub-agents writing to disk
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
      const tasks = store.list();
      if (tasks.length > 0) {
        updateWidget();
      }
    }, 3000);
  });

  pi.on("session_shutdown", async () => {
    if (refreshInterval) clearInterval(refreshInterval);
  });

  // ── TaskCreate ──────────────────────────────────────────────────────

  pi.registerTool({
    name: "TaskCreate",
    label: "TaskCreate",
    description: "Create a new task in the task list. Tasks can have dependencies (blockedBy) for coordination across agents.",
    promptSnippet: "Create a structured task with subject, description, and optional dependencies",
    promptGuidelines: [
      "Use TaskCreate for multi-step work that benefits from tracking. Skip for trivial single-step tasks.",
      "Include enough detail in description for another agent to understand and complete the task.",
      "Set up blockedBy dependencies when tasks must execute in order.",
      "Tasks are created with status 'pending' and no owner.",
    ],
    parameters: Type.Object({
      subject: Type.String({ description: "Brief title for the task (imperative form, e.g. 'Fix auth bug')" }),
      description: Type.String({ description: "What needs to be done — enough detail for another agent" }),
      activeForm: Type.Optional(Type.String({ description: "Present continuous form for spinner (e.g. 'Fixing auth bug')" })),
      blockedBy: Type.Optional(Type.Array(Type.String(), { description: "Task IDs that must complete before this one can start" })),
      blocks: Type.Optional(Type.Array(Type.String(), { description: "Task IDs that cannot start until this one completes" })),
      agentType: Type.Optional(Type.String({ description: "Required agent type for this task (e.g. 'spec-coherence-checker'). When set, only the orchestrator should dispatch this task using the named agent — generic workers must skip it." })),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Arbitrary metadata to attach" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const task = store.create({
        subject: params.subject,
        description: params.description,
        activeForm: params.activeForm,
        status: "pending",
        agentType: params.agentType,
        blocks: params.blocks ?? [],
        blockedBy: params.blockedBy ?? [],
        metadata: params.metadata,
      });

      // Wire up reverse dependencies
      if (params.blockedBy) {
        for (const blockerId of params.blockedBy) {
          const blocker = store.get(blockerId);
          if (blocker && !blocker.blocks.includes(task.id)) {
            store.update(blockerId, { blocks: [...blocker.blocks, task.id] });
          }
        }
      }
      if (params.blocks) {
        for (const blockedId of params.blocks) {
          const blocked = store.get(blockedId);
          if (blocked && !blocked.blockedBy.includes(task.id)) {
            store.update(blockedId, { blockedBy: [...blocked.blockedBy, task.id] });
          }
        }
      }

      updateWidget();

      return {
        content: [{ type: "text", text: `Task #${task.id} created: ${task.subject}` }],
        details: { task },
      };
    },

    renderCall(args, theme, _context) {
      const parts = [theme.fg("toolTitle", theme.bold("TaskCreate "))];
      parts.push(theme.fg("accent", args.subject || "..."));
      if (args.agentType) parts.push(theme.fg("warning", ` ⚡${args.agentType}`));
      if (args.blockedBy?.length) parts.push(theme.fg("dim", ` ← blocked by ${args.blockedBy.map((id: string) => `#${id}`).join(", ")}`));
      return new Text(parts.join(""), 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const task = (result.details as any)?.task as Task | undefined;
      if (!task) return new Text(result.content[0]?.type === "text" ? result.content[0].text : "", 0, 0);

      const icon = theme.fg("success", "✓");
      const id = theme.fg("dim", `#${task.id}`);
      const subject = theme.fg("toolOutput", task.subject);
      const agent = task.agentType ? theme.fg("warning", ` ⚡${task.agentType}`) : "";
      const deps = task.blockedBy.length > 0
        ? theme.fg("dim", ` ← ${task.blockedBy.map(b => `#${b}`).join(", ")}`)
        : theme.fg("dim", " (no blockers)");
      return new Text(`${icon} ${id} ${subject}${agent}${deps}`, 0, 0);
    },
  });

  // ── TaskList ────────────────────────────────────────────────────────

  pi.registerTool({
    name: "TaskList",
    label: "TaskList",
    description: "List all tasks showing ID, status, subject, owner, and unresolved blockers. Use to find available work or check progress.",
    promptSnippet: "List all tasks with status and dependency info",
    promptGuidelines: [
      "Call TaskList to find unblocked pending tasks before starting work.",
      "After completing a task, call TaskList to find newly unblocked work.",
      "Prefer working on tasks in ID order (lowest first) when multiple are available.",
    ],
    parameters: Type.Object({
      status: Type.Optional(StringEnum(["pending", "in_progress", "completed"] as const, {
        description: "Filter by status",
      })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      let tasks = store.list();
      if (params.status) {
        tasks = tasks.filter(t => t.status === params.status);
      }

      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "No tasks found." }], details: { tasks: [] } };
      }

      // Resolve blockers — filter out completed ones
      const completedIds = new Set(tasks.filter(t => t.status === "completed").map(t => t.id));
      // Need ALL tasks to resolve cross-status blockers
      const allTasks = store.list();
      const allCompletedIds = new Set(allTasks.filter(t => t.status === "completed").map(t => t.id));

      const lines = tasks.map(task => {
        const owner = task.owner ? ` (${task.owner})` : "";
        const agent = task.agentType ? ` {${task.agentType}}` : "";
        const unresolvedBlockers = task.blockedBy.filter(id => !allCompletedIds.has(id));
        const blocked = unresolvedBlockers.length > 0
          ? ` [blocked by ${unresolvedBlockers.map(id => `#${id}`).join(", ")}]`
          : "";
        return `#${task.id} [${task.status}] ${task.subject}${owner}${agent}${blocked}`;
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { tasks },
      };
    },

    renderCall(_args, theme, _context) {
      return new Text(theme.fg("toolTitle", theme.bold("TaskList")), 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const tasks = ((result.details as any)?.tasks ?? []) as Task[];
      if (tasks.length === 0) return new Text(theme.fg("muted", "No tasks."), 0, 0);

      const pending = tasks.filter(t => t.status === "pending").length;
      const inProgress = tasks.filter(t => t.status === "in_progress").length;
      const completed = tasks.filter(t => t.status === "completed").length;

      let text = theme.fg("accent", `${completed}/${tasks.length} done`);
      if (inProgress > 0) text += theme.fg("warning", `, ${inProgress} active`);
      if (pending > 0) text += theme.fg("muted", `, ${pending} pending`);

      if (expanded) {
        text += "\n";
        for (const task of tasks) {
          text += "\n" + formatTaskLine(task, tasks, theme, 120);
        }
      }
      return new Text(text, 0, 0);
    },
  });

  // ── TaskGet ─────────────────────────────────────────────────────────

  pi.registerTool({
    name: "TaskGet",
    label: "TaskGet",
    description: "Get full details of a task by ID including description, dependencies, and metadata.",
    promptSnippet: "Get full task details by ID",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to retrieve" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const task = store.get(params.taskId);
      if (!task) {
        return {
          content: [{ type: "text", text: `Task #${params.taskId} not found.` }],
          details: {},
        };
      }

      // Resolve blockers
      const allTasks = store.list();
      const completedIds = new Set(allTasks.filter(t => t.status === "completed").map(t => t.id));
      const unresolvedBlockers = task.blockedBy.filter(id => !completedIds.has(id));

      const lines = [
        `# Task #${task.id}: ${task.subject}`,
        `**Status:** ${task.status}`,
        task.owner ? `**Owner:** ${task.owner}` : "**Owner:** unassigned",
        task.agentType ? `**Agent Type:** ${task.agentType} (gate task — requires specific agent)` : "**Agent Type:** any (worker task)",
        task.activeForm ? `**Active Form:** ${task.activeForm}` : "",
        "",
        `## Description`,
        task.description,
        "",
        task.blocks.length > 0 ? `**Blocks:** ${task.blocks.map(id => `#${id}`).join(", ")}` : "",
        task.blockedBy.length > 0 ? `**Blocked By:** ${task.blockedBy.map(id => `#${id}`).join(", ")}` : "",
        unresolvedBlockers.length > 0 ? `**⚠️ Unresolved Blockers:** ${unresolvedBlockers.map(id => `#${id}`).join(", ")}` : "**✅ No unresolved blockers**",
        task.metadata ? `\n**Metadata:** ${JSON.stringify(task.metadata)}` : "",
      ].filter(Boolean);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { task },
      };
    },
  });

  // ── TaskUpdate ──────────────────────────────────────────────────────

  pi.registerTool({
    name: "TaskUpdate",
    label: "TaskUpdate",
    description: "Update a task's status, owner, description, or dependencies. Use to claim tasks, mark progress, or set up dependencies.",
    promptSnippet: "Update task status, owner, or dependencies",
    promptGuidelines: [
      "Set status to 'in_progress' BEFORE starting work on a task.",
      "Set status to 'completed' only when work is FULLY done.",
      "Set owner to claim a task for yourself. Use your agent name.",
      "Use addBlockedBy/addBlocks to set up dependencies after creation.",
      "Set status to 'deleted' to permanently remove a task.",
    ],
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to update" }),
      status: Type.Optional(StringEnum(["pending", "in_progress", "completed", "deleted"] as const, {
        description: "New status. 'deleted' removes the task permanently.",
      })),
      subject: Type.Optional(Type.String({ description: "New subject" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      activeForm: Type.Optional(Type.String({ description: "New active form for spinner" })),
      owner: Type.Optional(Type.String({ description: "Agent name to assign (or empty string to unassign)" })),
      addBlocks: Type.Optional(Type.Array(Type.String(), { description: "Task IDs to add to blocks list" })),
      addBlockedBy: Type.Optional(Type.Array(Type.String(), { description: "Task IDs to add to blockedBy list" })),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Metadata keys to merge (null values delete keys)" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      // Handle deletion
      if (params.status === "deleted") {
        const deleted = store.delete(params.taskId);
        updateWidget();
        return {
          content: [{ type: "text", text: deleted ? `Task #${params.taskId} deleted.` : `Task #${params.taskId} not found.` }],
          details: { deleted },
        };
      }

      const existing = store.get(params.taskId);
      if (!existing) {
        return {
          content: [{ type: "text", text: `Task #${params.taskId} not found.` }],
          details: {},
        };
      }

      const updates: Partial<Task> = {};
      if (params.status) updates.status = params.status;
      if (params.subject) updates.subject = params.subject;
      if (params.description) updates.description = params.description;
      if (params.activeForm) updates.activeForm = params.activeForm;
      if (params.owner !== undefined) updates.owner = params.owner || undefined;

      // Merge metadata
      if (params.metadata) {
        const merged = { ...(existing.metadata ?? {}) };
        for (const [k, v] of Object.entries(params.metadata)) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        updates.metadata = merged;
      }

      // Handle addBlocks
      if (params.addBlocks) {
        const newBlocks = [...new Set([...existing.blocks, ...params.addBlocks])];
        updates.blocks = newBlocks;
        // Wire reverse
        for (const blockedId of params.addBlocks) {
          const blocked = store.get(blockedId);
          if (blocked && !blocked.blockedBy.includes(params.taskId)) {
            store.update(blockedId, { blockedBy: [...blocked.blockedBy, params.taskId] });
          }
        }
      }

      // Handle addBlockedBy
      if (params.addBlockedBy) {
        const newBlockedBy = [...new Set([...existing.blockedBy, ...params.addBlockedBy])];
        updates.blockedBy = newBlockedBy;
        // Wire reverse
        for (const blockerId of params.addBlockedBy) {
          const blocker = store.get(blockerId);
          if (blocker && !blocker.blocks.includes(params.taskId)) {
            store.update(blockerId, { blocks: [...blocker.blocks, params.taskId] });
          }
        }
      }

      const updated = store.update(params.taskId, updates);
      if (!updated) {
        return { content: [{ type: "text", text: `Failed to update task #${params.taskId}.` }], details: {} };
      }

      updateWidget();

      return {
        content: [{ type: "text", text: `Task #${params.taskId} updated: [${updated.status}] ${updated.subject}` }],
        details: { task: updated },
      };
    },

    renderCall(args, theme, _context) {
      const parts = [theme.fg("toolTitle", theme.bold("TaskUpdate "))];
      parts.push(theme.fg("dim", `#${args.taskId}`));
      if (args.status) parts.push(" " + theme.fg(STATUS_COLORS[args.status] ?? "muted", args.status));
      if (args.owner) parts.push(theme.fg("dim", ` → ${args.owner}`));
      return new Text(parts.join(""), 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const task = (result.details as any)?.task as Task | undefined;
      if (!task) return new Text(result.content[0]?.type === "text" ? result.content[0].text : "", 0, 0);
      const icon = theme.fg(STATUS_COLORS[task.status] ?? "muted", STATUS_ICONS[task.status] ?? "?");
      return new Text(`${icon} #${task.id} [${task.status}] ${task.subject}`, 0, 0);
    },
  });

  // ── TaskClaim ───────────────────────────────────────────────────────

  pi.registerTool({
    name: "TaskClaim",
    label: "TaskClaim",
    description: "Atomically claim an unblocked, unowned task. Checks dependencies, sets owner and status to in_progress. Use this instead of manual TaskUpdate for safe concurrent claiming.",
    promptSnippet: "Atomically claim an available task (checks blockers and ownership)",
    promptGuidelines: [
      "Use TaskClaim instead of TaskUpdate when multiple agents might compete for the same task.",
      "TaskClaim fails safely if the task is blocked, already owned, or completed.",
      "After claiming, read the task description for full requirements.",
    ],
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to claim" }),
      owner: Type.String({ description: "Your agent name/identifier" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const result = store.claim(params.taskId, params.owner);

      if (result.success) {
        updateWidget();
        return {
          content: [{ type: "text", text: `✅ Task #${params.taskId} claimed by ${params.owner}: ${result.task!.subject}` }],
          details: { ...result },
        };
      }

      return {
        content: [{ type: "text", text: `❌ Cannot claim task #${params.taskId}: ${result.reason}` }],
        details: { ...result },
      };
    },
  });

  // ── TaskReset ───────────────────────────────────────────────────────

  pi.registerTool({
    name: "TaskReset",
    label: "TaskReset",
    description: "Delete all tasks. Use when starting a fresh orchestration run.",
    promptSnippet: "Clear all tasks for a fresh start",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const count = store.reset();
      // Clear widget
      if (widgetCtx) widgetCtx.ui.setWidget("tasks", undefined);
      return {
        content: [{ type: "text", text: `Deleted ${count} task(s). Task list is now empty.` }],
        details: { deleted: count },
      };
    },
  });

  // ── AskUserQuestion ─────────────────────────────────────────────────

  pi.registerTool({
    name: "AskUserQuestion",
    label: "AskUserQuestion",
    description: "Ask the user a structured question with options. Use when you need to gather preferences, clarify ambiguity, or offer choices during execution. Returns the user's selected option or freeform input.",
    promptSnippet: "Ask user a structured multiple-choice or freeform question",
    promptGuidelines: [
      "Present findings first, then ask — show your work before requesting input.",
      "Provide 2-4 concrete options, not open-ended questions.",
      "Include context for why the decision matters.",
      "Don't over-ask — save for real decision points.",
      "Use this instead of just printing a question in your response when you need a definitive answer before proceeding.",
    ],
    parameters: Type.Object({
      question: Type.String({ description: "The question to ask the user" }),
      options: Type.Optional(Type.Array(Type.String(), { description: "Multiple-choice options. If omitted, user provides freeform text input." })),
      context: Type.Optional(Type.String({ description: "Additional context shown below the question to help the user decide" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return {
          content: [{ type: "text", text: "Cannot ask user questions in non-interactive mode. Make a reasonable default choice and proceed." }],
          details: { answered: false },
        };
      }

      let answer: string | undefined;

      if (params.options && params.options.length > 0) {
        // Multiple choice
        const prompt = params.context
          ? `${params.question}\n\n${params.context}`
          : params.question;
        answer = await ctx.ui.select(prompt, params.options);
      } else {
        // Freeform input
        answer = await ctx.ui.input(
          params.question,
          params.context ?? "Type your answer"
        );
      }

      if (!answer) {
        return {
          content: [{ type: "text", text: "User dismissed the question without answering. Proceed with your best judgment." }],
          details: { answered: false },
        };
      }

      return {
        content: [{ type: "text", text: `User answered: ${answer}` }],
        details: { answered: true, answer },
      };
    },
  });

  // ── /tasks Command ──────────────────────────────────────────────────

  pi.registerCommand("tasks", {
    description: "Show task list summary",
    handler: async (_args, ctx) => {
      const tasks = store.list();
      if (tasks.length === 0) {
        ctx.ui.notify("No tasks.", "info");
        return;
      }

      const allCompleted = new Set(tasks.filter(t => t.status === "completed").map(t => t.id));

      const lines = tasks.map(t => {
        const icon = t.status === "completed" ? "✅" : t.status === "in_progress" ? "🔄" : "⏳";
        const owner = t.owner ? ` (${t.owner})` : "";
        const blockers = t.blockedBy.filter(id => !allCompleted.has(id));
        const blocked = blockers.length > 0 ? ` ⛔ blocked by ${blockers.map(id => `#${id}`).join(",")}` : "";
        return `${icon} #${t.id} ${t.subject}${owner}${blocked}`;
      });

      const pending = tasks.filter(t => t.status === "pending").length;
      const inProgress = tasks.filter(t => t.status === "in_progress").length;
      const completed = tasks.filter(t => t.status === "completed").length;

      ctx.ui.notify(
        `📋 Tasks (${pending}P / ${inProgress}IP / ${completed}C):\n${lines.join("\n")}`,
        "info"
      );
    },
  });
}
