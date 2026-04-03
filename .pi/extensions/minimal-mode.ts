/**
 * Minimal Mode — Three-state tool output display
 *
 * Overrides built-in tool rendering with a tri-state cycle on ctrl+o:
 *
 *   Full → Standard → Minimal → Full → ...
 *
 * - Full:     Complete untruncated output
 * - Standard: First 8 lines + count of remaining
 * - Minimal:  Tool call only, no output (or just a summary count)
 *
 * Uses context.state to track an internal mode counter. Each ctrl+o toggle
 * (detected as a flip in the `expanded` boolean) advances to the next mode.
 *
 * Usage: Place in .pi/extensions/ for auto-discovery.
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

/**
 * Advance the display mode on each ctrl+o toggle.
 * Detects toggles by comparing current `expanded` to the last seen value
 * stored in context.state, then cycles: Full → Standard → Minimal → Full.
 */
function getDisplayMode(expanded: boolean, state: Record<string, unknown>): number {
	const prev = state._lastExpanded as boolean | undefined;
	if (prev !== undefined && prev !== expanded) {
		state._mode = (((state._mode as number) ?? 0) + 1) % MODE_COUNT;
	}
	state._lastExpanded = expanded;
	return (state._mode as number) ?? FULL;
}

/** Label for current mode (shown in muted text on the call line). */
function modeLabel(mode: number): string {
	switch (mode) {
		case FULL: return "full";
		case STANDARD: return "standard";
		case MINIMAL: return "minimal";
		default: return "";
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────

function shortenPath(path: string): string {
	const home = homedir();
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

/** Render text output respecting the three display modes. */
function renderOutput(
	text: string,
	mode: number,
	theme: any,
	opts?: { countLabel?: string },
): Text {
	if (mode === MINIMAL) {
		return new Text("", 0, 0);
	}

	const trimmed = text.trim();
	if (!trimmed) return new Text("", 0, 0);

	const lines = trimmed.split("\n");

	if (mode === STANDARD && lines.length > STANDARD_MAX_LINES) {
		const shown = lines.slice(0, STANDARD_MAX_LINES);
		const remaining = lines.length - STANDARD_MAX_LINES;
		const label = opts?.countLabel ?? "lines";
		const output = shown.map((l) => theme.fg("toolOutput", l)).join("\n");
		return new Text(
			`\n${output}\n${theme.fg("muted", `  … ${remaining} more ${label}`)}`,
			0, 0,
		);
	}

	// FULL
	const output = lines.map((l) => theme.fg("toolOutput", l)).join("\n");
	return new Text(`\n${output}`, 0, 0);
}

/** Render a minimal-mode summary count. */
function renderCount(count: number, label: string, theme: any): Text {
	if (count > 0) {
		return new Text(theme.fg("muted", ` → ${count} ${label}`), 0, 0);
	}
	return new Text("", 0, 0);
}

// ── Tool cache ───────────────────────────────────────────────────────────

const toolCache = new Map<string, ReturnType<typeof createBuiltInTools>>();

function createBuiltInTools(cwd: string) {
	return {
		read: createReadTool(cwd),
		bash: createBashTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		find: createFindTool(cwd),
		grep: createGrepTool(cwd),
		ls: createLsTool(cwd),
	};
}

function getBuiltInTools(cwd: string) {
	let tools = toolCache.get(cwd);
	if (!tools) {
		tools = createBuiltInTools(cwd);
		toolCache.set(cwd, tools);
	}
	return tools;
}

// ── Extension ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

	// =====================================================================
	// Read
	// =====================================================================
	pi.registerTool({
		name: "read",
		label: "read",
		description:
			"Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files.",
		parameters: getBuiltInTools(process.cwd()).read.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const tools = getBuiltInTools(ctx.cwd);
			return tools.read.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const mode = getDisplayMode(context.expanded, context.state);
			const path = shortenPath(args.path || "");
			let pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");

			if (args.offset !== undefined || args.limit !== undefined) {
				const startLine = args.offset ?? 1;
				const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
				pathDisplay += theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}

			const label = mode !== FULL ? theme.fg("muted", ` [${modeLabel(mode)}]`) : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}${label}`, 0, 0);
		},

		renderResult(result, { expanded }, theme, context) {
			const mode = getDisplayMode(expanded, context.state);
			const textContent = result.content.find((c: any) => c.type === "text");
			if (!textContent || textContent.type !== "text") return new Text("", 0, 0);
			return renderOutput(textContent.text, mode, theme);
		},
	});

	// =====================================================================
	// Bash
	// =====================================================================
	pi.registerTool({
		name: "bash",
		label: "bash",
		description:
			"Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first).",
		parameters: getBuiltInTools(process.cwd()).bash.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const tools = getBuiltInTools(ctx.cwd);
			return tools.bash.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const mode = getDisplayMode(context.expanded, context.state);
			const command = args.command || "...";
			const timeout = args.timeout as number | undefined;
			const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
			const label = mode !== FULL ? theme.fg("muted", ` [${modeLabel(mode)}]`) : "";

			return new Text(theme.fg("toolTitle", theme.bold(`$ ${command}`)) + timeoutSuffix + label, 0, 0);
		},

		renderResult(result, { expanded }, theme, context) {
			const mode = getDisplayMode(expanded, context.state);
			const textContent = result.content.find((c: any) => c.type === "text");
			if (!textContent || textContent.type !== "text") return new Text("", 0, 0);
			return renderOutput(textContent.text, mode, theme);
		},
	});

	// =====================================================================
	// Write
	// =====================================================================
	pi.registerTool({
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: getBuiltInTools(process.cwd()).write.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const tools = getBuiltInTools(ctx.cwd);
			return tools.write.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const mode = getDisplayMode(context.expanded, context.state);
			const path = shortenPath(args.path || "");
			const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			const lineCount = args.content ? args.content.split("\n").length : 0;
			const lineInfo = lineCount > 0 ? theme.fg("muted", ` (${lineCount} lines)`) : "";
			const label = mode !== FULL ? theme.fg("muted", ` [${modeLabel(mode)}]`) : "";

			return new Text(`${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay}${lineInfo}${label}`, 0, 0);
		},

		renderResult(result, { expanded }, theme, context) {
			const mode = getDisplayMode(expanded, context.state);
			if (mode === MINIMAL || mode === STANDARD) return new Text("", 0, 0);
			// Full: show error if any
			if (result.content.some((c: any) => c.type === "text" && c.text)) {
				const textContent = result.content.find((c: any) => c.type === "text");
				if (textContent?.type === "text" && textContent.text) {
					return new Text(`\n${theme.fg("error", textContent.text)}`, 0, 0);
				}
			}
			return new Text("", 0, 0);
		},
	});

	// =====================================================================
	// Edit
	// =====================================================================
	pi.registerTool({
		name: "edit",
		label: "edit",
		description:
			"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
		parameters: getBuiltInTools(process.cwd()).edit.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const tools = getBuiltInTools(ctx.cwd);
			return tools.edit.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const mode = getDisplayMode(context.expanded, context.state);
			const path = shortenPath(args.path || "");
			const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			const label = mode !== FULL ? theme.fg("muted", ` [${modeLabel(mode)}]`) : "";

			return new Text(`${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}${label}`, 0, 0);
		},

		renderResult(result, { expanded }, theme, context) {
			const mode = getDisplayMode(expanded, context.state);
			const textContent = result.content.find((c: any) => c.type === "text");
			if (!textContent || textContent.type !== "text") return new Text("", 0, 0);
			return renderOutput(textContent.text, mode, theme);
		},
	});

	// =====================================================================
	// Find
	// =====================================================================
	pi.registerTool({
		name: "find",
		label: "find",
		description:
			"Find files by name pattern (glob). Searches recursively from the specified path. Output limited to 200 results.",
		parameters: getBuiltInTools(process.cwd()).find.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const tools = getBuiltInTools(ctx.cwd);
			return tools.find.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const mode = getDisplayMode(context.expanded, context.state);
			const pattern = args.pattern || "";
			const path = shortenPath(args.path || ".");
			const limit = args.limit;

			let text = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", pattern)}`;
			text += theme.fg("toolOutput", ` in ${path}`);
			if (limit !== undefined) text += theme.fg("toolOutput", ` (limit ${limit})`);
			if (mode !== FULL) text += theme.fg("muted", ` [${modeLabel(mode)}]`);

			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, context) {
			const mode = getDisplayMode(expanded, context.state);
			const textContent = result.content.find((c: any) => c.type === "text");
			if (!textContent || textContent.type !== "text") return new Text("", 0, 0);

			const lines = textContent.text.trim().split("\n").filter(Boolean);
			if (mode === MINIMAL) return renderCount(lines.length, "files", theme);
			return renderOutput(textContent.text, mode, theme, { countLabel: "files" });
		},
	});

	// =====================================================================
	// Grep
	// =====================================================================
	pi.registerTool({
		name: "grep",
		label: "grep",
		description:
			"Search file contents by regex pattern. Uses ripgrep for fast searching. Output limited to 200 matches.",
		parameters: getBuiltInTools(process.cwd()).grep.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const tools = getBuiltInTools(ctx.cwd);
			return tools.grep.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const mode = getDisplayMode(context.expanded, context.state);
			const pattern = args.pattern || "";
			const path = shortenPath(args.path || ".");
			const glob = args.glob;
			const limit = args.limit;

			let text = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${pattern}/`)}`;
			text += theme.fg("toolOutput", ` in ${path}`);
			if (glob) text += theme.fg("toolOutput", ` (${glob})`);
			if (limit !== undefined) text += theme.fg("toolOutput", ` limit ${limit}`);
			if (mode !== FULL) text += theme.fg("muted", ` [${modeLabel(mode)}]`);

			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, context) {
			const mode = getDisplayMode(expanded, context.state);
			const textContent = result.content.find((c: any) => c.type === "text");
			if (!textContent || textContent.type !== "text") return new Text("", 0, 0);

			const lines = textContent.text.trim().split("\n").filter(Boolean);
			if (mode === MINIMAL) return renderCount(lines.length, "matches", theme);
			return renderOutput(textContent.text, mode, theme, { countLabel: "matches" });
		},
	});

	// =====================================================================
	// Ls
	// =====================================================================
	pi.registerTool({
		name: "ls",
		label: "ls",
		description:
			"List directory contents with file sizes. Shows files and directories with their sizes. Output limited to 500 entries.",
		parameters: getBuiltInTools(process.cwd()).ls.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const tools = getBuiltInTools(ctx.cwd);
			return tools.ls.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const mode = getDisplayMode(context.expanded, context.state);
			const path = shortenPath(args.path || ".");
			const limit = args.limit;

			let text = `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", path)}`;
			if (limit !== undefined) text += theme.fg("toolOutput", ` (limit ${limit})`);
			if (mode !== FULL) text += theme.fg("muted", ` [${modeLabel(mode)}]`);

			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, context) {
			const mode = getDisplayMode(expanded, context.state);
			const textContent = result.content.find((c: any) => c.type === "text");
			if (!textContent || textContent.type !== "text") return new Text("", 0, 0);

			const lines = textContent.text.trim().split("\n").filter(Boolean);
			if (mode === MINIMAL) return renderCount(lines.length, "entries", theme);
			return renderOutput(textContent.text, mode, theme, { countLabel: "entries" });
		},
	});
}
