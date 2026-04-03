/**
 * Minimal Mode — Three-state tool output display
 *
 * ctrl+o cycles: Full → Standard → Minimal → Full
 *
 * Detects each ctrl+o toggle (a flip in the `expanded` boolean from Pi)
 * and advances an internal mode counter via context.state.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { homedir } from "os";

// ── Display modes ────────────────────────────────────────────────────────

const FULL = 0;
const STANDARD = 1;
const MINIMAL = 2;
const MODE_COUNT = 3;
const STANDARD_MAX_LINES = 8;
const HOME_DIR = homedir();

/**
 * Advance the display mode on each ctrl+o toggle.
 * context.state is shared across renderCall and renderResult, so
 * the first call detects the flip and subsequent calls just read.
 */
function getDisplayMode(expanded: boolean, state: Record<string, unknown>): number {
	const prev = state._lastExpanded as boolean | undefined;
	if (prev !== undefined && prev !== expanded) {
		state._mode = (((state._mode as number) ?? 0) + 1) % MODE_COUNT;
	}
	state._lastExpanded = expanded;
	return (state._mode as number) ?? FULL;
}

function modeSuffix(mode: number, theme: any): string {
	if (mode === FULL) return "";
	const label = mode === STANDARD ? "standard" : "minimal";
	return theme.fg("muted", ` [${label}]`);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function shortenPath(path: string): string {
	return path.startsWith(HOME_DIR) ? `~${path.slice(HOME_DIR.length)}` : path;
}

function renderOutput(
	text: string,
	mode: number,
	theme: any,
	countLabel?: string,
): Text {
	if (mode === MINIMAL) return new Text("", 0, 0);

	const trimmed = text.trim();
	if (!trimmed) return new Text("", 0, 0);

	const lines = trimmed.split("\n");

	if (mode === STANDARD && lines.length > STANDARD_MAX_LINES) {
		const shown = lines.slice(0, STANDARD_MAX_LINES);
		const remaining = lines.length - STANDARD_MAX_LINES;
		const output = shown.map((l) => theme.fg("toolOutput", l)).join("\n");
		return new Text(
			`\n${output}\n${theme.fg("muted", `  … ${remaining} more ${countLabel ?? "lines"}`)}`,
			0, 0,
		);
	}

	const output = lines.map((l) => theme.fg("toolOutput", l)).join("\n");
	return new Text(`\n${output}`, 0, 0);
}

function renderCount(count: number, label: string, theme: any): Text {
	return count > 0 ? new Text(theme.fg("muted", ` → ${count} ${label}`), 0, 0) : new Text("", 0, 0);
}

function getTextContent(result: any): string | null {
	const c = result.content.find((c: any) => c.type === "text");
	return c?.type === "text" ? c.text : null;
}

// ── Tool cache ───────────────────────────────────────────────────────────

const toolCache = new Map<string, Record<string, any>>();

function createBuiltInTools(cwd: string) {
	return {
		read: createReadTool(cwd),
		bash: createBashTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		find: createFindTool(cwd),
		grep: createGrepTool(cwd),
		ls: createLsTool(cwd),
	} as Record<string, any>;
}

function getBuiltInTools(cwd: string) {
	let tools = toolCache.get(cwd);
	if (!tools) {
		tools = createBuiltInTools(cwd);
		toolCache.set(cwd, tools);
	}
	return tools;
}

// ── Tool specs ───────────────────────────────────────────────────────────

interface ToolSpec {
	name: string;
	renderCall: (args: any, theme: any, mode: number) => string;
	renderResult: (text: string, mode: number, theme: any) => Text;
}

const TOOL_SPECS: ToolSpec[] = [
	{
		name: "read",
		renderCall(args, theme, mode) {
			const path = shortenPath(args.path || "");
			let display = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			if (args.offset !== undefined || args.limit !== undefined) {
				const start = args.offset ?? 1;
				const end = args.limit !== undefined ? start + args.limit - 1 : "";
				display += theme.fg("warning", `:${start}${end ? `-${end}` : ""}`);
			}
			return `${theme.fg("toolTitle", theme.bold("read"))} ${display}${modeSuffix(mode, theme)}`;
		},
		renderResult: (text, mode, theme) => renderOutput(text, mode, theme),
	},
	{
		name: "bash",
		renderCall(args, theme, mode) {
			const cmd = args.command || "...";
			const timeout = args.timeout ? theme.fg("muted", ` (timeout ${args.timeout}s)`) : "";
			return theme.fg("toolTitle", theme.bold(`$ ${cmd}`)) + timeout + modeSuffix(mode, theme);
		},
		renderResult: (text, mode, theme) => renderOutput(text, mode, theme),
	},
	{
		name: "write",
		renderCall(args, theme, mode) {
			const path = shortenPath(args.path || "");
			const display = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			const lines = args.content ? args.content.split("\n").length : 0;
			const info = lines > 0 ? theme.fg("muted", ` (${lines} lines)`) : "";
			return `${theme.fg("toolTitle", theme.bold("write"))} ${display}${info}${modeSuffix(mode, theme)}`;
		},
		renderResult(text, mode, theme) {
			if (mode !== FULL) return new Text("", 0, 0);
			return text ? new Text(`\n${theme.fg("error", text)}`, 0, 0) : new Text("", 0, 0);
		},
	},
	{
		name: "edit",
		renderCall(args, theme, mode) {
			const path = shortenPath(args.path || "");
			const display = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			return `${theme.fg("toolTitle", theme.bold("edit"))} ${display}${modeSuffix(mode, theme)}`;
		},
		renderResult: (text, mode, theme) => renderOutput(text, mode, theme),
	},
	{
		name: "find",
		renderCall(args, theme, mode) {
			let text = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", args.pattern || "")}`;
			text += theme.fg("toolOutput", ` in ${shortenPath(args.path || ".")}`);
			if (args.limit !== undefined) text += theme.fg("toolOutput", ` (limit ${args.limit})`);
			return text + modeSuffix(mode, theme);
		},
		renderResult(text, mode, theme) {
			const lines = (text || "").trim().split("\n").filter(Boolean);
			if (mode === MINIMAL) return renderCount(lines.length, "files", theme);
			return renderOutput(text, mode, theme, "files");
		},
	},
	{
		name: "grep",
		renderCall(args, theme, mode) {
			let text = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${args.pattern || ""}/`)}`;
			text += theme.fg("toolOutput", ` in ${shortenPath(args.path || ".")}`);
			if (args.glob) text += theme.fg("toolOutput", ` (${args.glob})`);
			if (args.limit !== undefined) text += theme.fg("toolOutput", ` limit ${args.limit}`);
			return text + modeSuffix(mode, theme);
		},
		renderResult(text, mode, theme) {
			const lines = (text || "").trim().split("\n").filter(Boolean);
			if (mode === MINIMAL) return renderCount(lines.length, "matches", theme);
			return renderOutput(text, mode, theme, "matches");
		},
	},
	{
		name: "ls",
		renderCall(args, theme, mode) {
			let text = `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", shortenPath(args.path || "."))}`;
			if (args.limit !== undefined) text += theme.fg("toolOutput", ` (limit ${args.limit})`);
			return text + modeSuffix(mode, theme);
		},
		renderResult(text, mode, theme) {
			const lines = (text || "").trim().split("\n").filter(Boolean);
			if (mode === MINIMAL) return renderCount(lines.length, "entries", theme);
			return renderOutput(text, mode, theme, "entries");
		},
	},
];

// ── Extension ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	for (const spec of TOOL_SPECS) {
		const builtIn = getBuiltInTools(process.cwd())[spec.name];

		pi.registerTool({
			name: spec.name,
			label: spec.name,
			description: builtIn.description,
			parameters: builtIn.parameters,

			async execute(toolCallId, params, signal, onUpdate, ctx) {
				return getBuiltInTools(ctx.cwd)[spec.name].execute(toolCallId, params, signal, onUpdate);
			},

			renderCall(args, theme, context) {
				const mode = getDisplayMode(context.expanded, context.state);
				return new Text(spec.renderCall(args, theme, mode), 0, 0);
			},

			renderResult(result, { expanded }, theme, context) {
				const mode = getDisplayMode(expanded, context.state);
				const text = getTextContent(result);
				if (text === null) return new Text("", 0, 0);
				return spec.renderResult(text, mode, theme);
			},
		});
	}
}
