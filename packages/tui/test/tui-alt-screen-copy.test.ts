// Recording-terminal regressions for the bounded fullscreen transcript copy path.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import xterm from "@xterm/headless";
import { Markdown } from "../src/components/markdown.ts";
import { HStack } from "../src/components/h-stack.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { Container, type Component } from "../src/tui.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { stripTerminalSequences } from "../src/utils.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class RecordingTerminal extends VirtualTerminal {
	readonly writes: string[] = [];

	override write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}
}

// Match AssistantMessageComponent: decorate the Container array after it received child sidecars.
class AssistantZone extends Container {
	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length > 0) {
			lines[0] = "\x1b]133;A\x07" + lines[0];
			lines[lines.length - 1] = "\x1b]133;B\x07\x1b]133;C\x07" + lines[lines.length - 1];
		}
		return lines;
	}
}

function fixture(children: Component[], width: number, height = 16) {
	const terminal = new RecordingTerminal(width, height);
	const copied: string[] = [];
	const tui = new TuiAltScreen(terminal, false, undefined, {
		copySelection: async (text) => { copied.push(text); return true; },
	});
	const scroll = new ScrollView(new VStack(children), { primary: true });
	tui.setLayoutRoot(scroll);
	tui.start();
	tui.renderNow();
	return { terminal, tui, copied, scroll };
}

function drag(terminal: RecordingTerminal, from: [number, number], to: [number, number]): void {
	terminal.sendInput(`\x1b[<0;${from[0] + 1};${from[1] + 1}M`);
	terminal.sendInput(`\x1b[<32;${to[0] + 1};${to[1] + 1}M`);
}

function release(terminal: RecordingTerminal, to: [number, number]): void {
	terminal.sendInput(`\x1b[<0;${to[0] + 1};${to[1] + 1}m`);
}

async function cells(lines: string[], width: number, height = lines.length) {
	const terminal = new xterm.Terminal({ cols: width, rows: height, allowProposedApi: true });
	await new Promise<void>((resolve) => terminal.write(lines.join("\r\n"), resolve));
	const result = Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) => {
		const cell = terminal.buffer.active.getLine(row)!.getCell(col)!;
		return {
			chars: cell.getChars(), inverse: Boolean(cell.isInverse()),
			fg: cell.getFgColor(), fgMode: cell.getFgColorMode(), bg: cell.getBgColor(), bgMode: cell.getBgColorMode(),
			bold: Boolean(cell.isBold()), dim: Boolean(cell.isDim()), italic: Boolean(cell.isItalic()),
			underline: Boolean(cell.isUnderline()), blink: Boolean(cell.isBlink()),
			hidden: Boolean(cell.isInvisible()), strikethrough: Boolean(cell.isStrikethrough()),
		};
	}));
	terminal.dispose();
	return result;
}

async function recordedCells(terminal: RecordingTerminal) {
	return cells([terminal.writes.join("")], terminal.columns, terminal.rows);
}

const paragraph = () => new Markdown("gamma delta", 2, 0, defaultMarkdownTheme);

describe("TuiAltScreen compact transcript selection", () => {
	it("copies a later wrapped assistant paragraph through the final OSC133 row, and real paragraph separators", async () => {
		for (const laterOnly of [true, false]) {
			const source = "first paragraph wraps over rows\n\nsecond paragraph wraps over rows";
			const assistant = new AssistantZone();
			assistant.addChild(new Markdown(source, 1, 0, defaultMarkdownTheme));
			const producer = assistant.render(16);
			assert.ok(producer[0].startsWith("\x1b]133;A\x07"));
			assert.ok(producer[8].startsWith("\x1b]133;B\x07\x1b]133;C\x07"));
			const { tui, terminal, copied } = fixture([assistant], 16);
			try {
				const initial = tui.getScreenLines();
				const reset = "\x1b[0m\x1b]8;;\x07";
				// Fullscreen consumes the producer's zone markers before composing screen rows.
				assert.deepEqual(initial.slice(0, 9), [
					" first          ", " paragraph      ", " wraps over     ", " rows           ",
					"                ", " second         ", " paragraph      ", " wraps over     ", " rows           ",
				].map((line) => line + reset));
				const firstRow = laterOnly ? 5 : 0;
				drag(terminal, [0, firstRow], [15, 8]);
				tui.renderNow();
				const frame = tui.getScreenLines();
				const original = await cells(initial, 16);
				const painted = await recordedCells(terminal);
				const ends = [6, 10, 11, 5, 0, 7, 10, 11, 5];
				for (let row = 0; row < 16; row++) {
					assert.equal(stripTerminalSequences(frame[row]), stripTerminalSequences(initial[row]));
					for (let col = 0; col < 16; col++) {
						const selected = row >= firstRow && row <= 8 && col >= 1 && col < ends[row];
						assert.deepEqual(painted[row][col], { ...original[row][col], inverse: selected });
					}
				}
				release(terminal, [15, 8]);
				assert.equal(copied[0], laterOnly ? "second paragraph wraps over rows" : source);
			} finally { tui.stop({ preserveScreen: true }); }
		}
	});

	it("keeps headings and flat loose lists on the mapped margin-free selection path", async () => {
		const source = "# Header wraps across rows\n\n9. first loose item wraps across rows\n\n10. second loose item";
		const assistant = new AssistantZone();
		assistant.addChild(new Markdown(source, 1, 0, defaultMarkdownTheme));
		const lastRow = assistant.render(16).length - 1;
		const { tui, terminal, copied } = fixture([assistant], 16, 20);
		try {
			const initial = tui.getScreenLines();
			drag(terminal, [1, 0], [15, lastRow]);
			tui.renderNow();
			const painted = await recordedCells(terminal);
			const original = await cells(initial, 16, 20);
			for (let row = 0; row < 20; row++) {
				const visible = stripTerminalSequences(initial[row]);
				const start = visible.indexOf(visible.trimStart());
				const end = visible.trimEnd().length;
				for (let col = 0; col < 16; col++) {
					const selected = row <= lastRow && col >= start && col < end;
					assert.deepEqual(painted[row][col], { ...original[row][col], inverse: selected });
				}
			}
			release(terminal, [15, lastRow]);
			assert.equal(copied[0], "Header wraps across rows\n\n9. first loose item wraps across rows\n\n10. second loose item");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("copies assistant flat bullet and ordered lists, including a later item continuation, with exact masks", async () => {
		for (const ordered of [false, true]) {
			const list = ordered ? "9. alpha beta gamma delta\n10. later epsilon zeta eta theta" : "- alpha beta gamma delta\n- later epsilon zeta eta theta";
			const prefix = "intro alpha beta\n\nlater paragraph wraps over rows\n\n";
			const source = prefix + list;
			for (const selection of ["document", "later-item", "continuation", "partial-continuation"] as const) {
				const assistant = new AssistantZone();
				assistant.addChild(new Markdown(source, 1, 0, defaultMarkdownTheme));
				const { tui, terminal, copied } = fixture([assistant], 16, 20);
				try {
					const initial = tui.getScreenLines();
					const listEnds = ordered ? [14, 15, 10, 12, 13, 10] : [13, 14, 8, 15, 12];
					const listStarts = ordered ? [1, 4, 1, 5, 5, 5] : [1, 3, 1, 3, 3];
					const ends = [12, 5, 0, 6, 10, 11, 5, 0, ...listEnds];
					const starts = [1, 1, 0, 1, 1, 1, 1, 0, ...listStarts];
					const lastRow = ends.length - 1;
					assert.equal(stripTerminalSequences(initial[10]).trim(), ordered ? "10. later" : "- later");
					const firstRow = selection === "document" ? 0 : selection === "later-item" ? 10 : 11;
					const from: [number, number] = [selection === "partial-continuation" ? starts[firstRow] + 2
						: selection === "continuation" ? starts[firstRow] : 0, firstRow];
					const to: [number, number] = [ends[lastRow] - (selection === "partial-continuation" ? 4 : 1), lastRow];
					if (selection === "partial-continuation") {
						starts[firstRow] = from[0];
						ends[lastRow] = to[0] + 1;
					}
					drag(terminal, from, to);
					tui.renderNow();
					const frame = tui.getScreenLines();
					const original = await cells(initial, 16);
					const painted = await recordedCells(terminal);
					for (let row = 0; row < 20; row++) {
						assert.equal(stripTerminalSequences(frame[row]), stripTerminalSequences(initial[row]));
						for (let col = 0; col < 16; col++) {
							const selected = row >= firstRow && row <= lastRow && col >= starts[row] && col < ends[row];
							assert.deepEqual(painted[row][col], { ...original[row][col], inverse: selected });
						}
					}
					release(terminal, to);
					assert.equal(copied[0], selection === "document" ? source : selection === "later-item"
						? `${ordered ? "10." : "-"} later epsilon zeta eta theta` : selection === "continuation"
							? "epsilon zeta eta theta" : "silon zeta eta th");
				} finally { tui.stop({ preserveScreen: true }); }
			}
		}
	});

	it("rejects an actual displayed mutation under the assistant OSC133 wrapper", () => {
		const text = new Text("alpha beta", 2, 0);
		text.render(9)[1] = "  zeta   ";
		const assistant = new AssistantZone();
		assistant.addChild(text);
		const { tui, terminal, copied } = fixture([assistant], 9);
		try {
			drag(terminal, [0, 0], [8, 1]);
			tui.renderNow();
			assert.ok(tui.getScreenLines()[0].includes("\x1b[7m"));
			release(terminal, [8, 1]);
			assert.equal(copied[0], "  alpha\n  zeta");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("copies wrapped Text and Markdown as canonical prose and inverts content, not margins", async () => {
		const { tui, terminal, copied } = fixture([new Text("alpha beta", 2, 1), paragraph()], 9);
		try {
			const initial = tui.getScreenLines();
			const reset = "\x1b[0m\x1b]8;;\x07";
			assert.deepEqual(initial.slice(0, 4), ["         ", "  alpha  ", "  beta   ", "         "].map((line) => line + reset));
			drag(terminal, [0, 0], [8, 2]);
			tui.renderNow();
			const frame = tui.getScreenLines();
			const painted = await cells(frame, 9);
			for (let row = 0; row < 4; row++) {
				for (let col = 0; col < 9; col++) {
					assert.equal(painted[row][col].inverse, row === 1 ? col >= 2 && col < 7 : row === 2 && col >= 2 && col < 6);
				}
				assert.equal(stripTerminalSequences(frame[row]), stripTerminalSequences(initial[row]));
			}
			release(terminal, [8, 2]);
			assert.equal(copied[0], "alpha beta");
			tui.resetTextSelection();
			drag(terminal, [0, 4], [8, 5]);
			release(terminal, [8, 5]);
			assert.equal(copied[1], "gamma delta");
			tui.resetTextSelection();
			tui.renderNow();
			// Clipboard notification is a separate overlay; compare the remaining untouched transcript rows.
			assert.deepEqual(tui.getScreenLines().slice(4), initial.slice(4));
			assert.ok(terminal.writes.some((write) => write.includes("\x1b[7m")));
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("preserves hard newlines, newline-only boundaries, and a collapsed empty-row selection", () => {
		const { tui, terminal, copied } = fixture([new Text("a\n\nb", 2, 0), paragraph()], 9);
		try {
			drag(terminal, [2, 0], [0, 2]);
			release(terminal, [0, 2]);
			assert.equal(copied[0], "a\n\n");
			tui.resetTextSelection();
			drag(terminal, [3, 0], [0, 1]);
			release(terminal, [0, 1]);
			assert.equal(copied[1], "\n");
			tui.resetTextSelection();
			drag(terminal, [0, 1], [4, 1]);
			release(terminal, [4, 1]);
			assert.equal(copied.length, 2);
			assert.equal(tui.hasActiveSelection(), false);
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("copies fenced code indentation and real empty lines through the transcript", () => {
		const code = "```ts\n    alpha beta gamma\n\n  z\n```";
		const markdown = new Markdown(code, 1, 0, defaultMarkdownTheme);
		const codeRows = markdown.render(14).length;
		const { tui, terminal, copied } = fixture([new Text("header", 1, 0), markdown], 14);
		try {
			drag(terminal, [0, 1], [13, codeRows]);
			release(terminal, [13, codeRows]);
			assert.equal(copied[0], code);
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("snaps partial and reverse endpoints to graphemes, including ANSI within a grapheme", async () => {
		const directions: Array<{ from: [number, number]; to: [number, number] }> = [
			{ from: [3, 0], to: [5, 0] }, { from: [5, 0], to: [3, 0] },
		];
		for (const source of ["e\u0301界👩‍👩‍👧‍👦tail", "e\u0301界👩\x1b[31m‍👩tail"]) {
			for (const { from, to } of directions) {
				const { tui, terminal, copied } = fixture([new Text(source, 1, 0), paragraph()], 24);
				try {
					const initial = tui.getScreenLines();
					drag(terminal, from, to);
					tui.renderNow();
					const frame = tui.getScreenLines();
					assert.equal(stripTerminalSequences(frame[0]), stripTerminalSequences(initial[0]));
					const expected = "界" + (source.includes("\x1b") ? "👩‍👩" : "👩‍👩‍👧‍👦");
					const painted = await cells(frame, 24);
					assert.equal(painted[0][0].inverse, false);
					assert.equal(painted[0][2].inverse, true);
					// Headless xterm's default Unicode provider does not collapse ZWJ emoji to Pi's two cells.
					// Check its actual tail cells and the emitted grapheme span, not invented xterm coordinates.
					for (const cell of painted[0].filter((cell) => /^[tail]$/.test(cell.chars))) assert.equal(cell.inverse, false);
					assert.equal(stripTerminalSequences(frame[0].slice(frame[0].indexOf("\x1b[7m") + 4, frame[0].lastIndexOf("\x1b[27m"))), expected);
					release(terminal, to);
					assert.equal(copied.at(-1), expected);
				} finally { tui.stop({ preserveScreen: true }); }
			}
		}
	});

	it("does not recolor or invert text after an ANSI selection span", async () => {
		const { tui, terminal } = fixture([new Text("a\x1b[31mbc\x1b[0md", 0, 0), paragraph()], 20);
		try {
			const initial = await cells(tui.getScreenLines(), 20);
			drag(terminal, [1, 0], [2, 0]);
			tui.renderNow();
			const selected = await cells(tui.getScreenLines(), 20);
			assert.equal(selected[0][1].inverse, true);
			assert.equal(selected[0][2].inverse, true);
			assert.deepEqual(selected[0][3], initial[0][3]);
			assert.deepEqual(selected[0][0], initial[0][0]);
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("does not treat any indexed, RGB or colon color payload as inverse on a mapped suffix", async () => {
		for (const color of [38, 48, 58]) {
			for (const payload of [";5;7", ";2;7;7;7", ":5:7", ":2::7:7:7"]) {
				const sgr = `\x1b[${color}${payload}m`;
				const { tui, terminal, copied } = fixture([new Text(`${sgr}abcd`, 0, 0), paragraph()], 20);
				try {
					const reset = "\x1b[0m\x1b]8;;\x07";
					const initialFrame = tui.getScreenLines();
					assert.equal(initialFrame[0], `${sgr}abcd${" ".repeat(16)}${reset}`);
					const initial = await cells(initialFrame, 20);
					drag(terminal, [1, 0], [2, 0]);
					tui.renderNow();
					const frame = tui.getScreenLines();
					assert.equal(frame[0], `${sgr}a\x1b[7mbc\x1b[27md${" ".repeat(16)}${reset}`);
					const selected = await cells(frame, 20);
					assert.equal(selected[0][1].inverse, true);
					assert.equal(selected[0][2].inverse, true);
					assert.equal(selected[0][3].chars, "d");
					assert.equal(selected[0][3].inverse, false);
					for (let col = 0; col < 20; col++) {
						assert.deepEqual(selected[0][col], { ...initial[0][col], inverse: col === 1 || col === 2 });
					}
					release(terminal, [2, 0]);
					assert.equal(copied[0], "bc");
				} finally { tui.stop({ preserveScreen: true }); }
			}
		}
	});

	it("preserves original inverse on a mapped suffix without interpreting color payload resets", async () => {
		for (const [sgr, inverse] of [
			["\x1b[7;38:2::7:8:9m", true],
			["\x1b[7;48:2::0:27:0m", true],
			["\x1b[7;58:2::0:27:0m", true],
			["\x1b[7;38;5;27m", true],
			["\x1b[7;48;5;0m", true],
			["\x1b[7;58;5;27m", true],
			["\x1b[7;38;2;0;27;0m", true],
			["\x1b[7;48;2;0;27;0m", true],
			["\x1b[7;58;2;0;27;0m", true],
			["\x1b[38:5:7m", false],
		] as const) {
			const { tui, terminal, copied } = fixture([new Text(`${sgr}abcd`, 0, 0), paragraph()], 20);
			try {
				const initial = await cells(tui.getScreenLines(), 20);
				assert.equal(initial[0][3].inverse, inverse);
				drag(terminal, [1, 0], [2, 0]);
				tui.renderNow();
				const frame = tui.getScreenLines();
				assert.ok(frame[0].includes(`\x1b[27m${inverse ? "\x1b[7m" : ""}d`));
				const selected = await cells(frame, 20);
				for (let col = 0; col < 20; col++) {
					assert.deepEqual(selected[0][col], { ...initial[0][col], inverse: col === 1 || col === 2 || initial[0][col].inverse });
				}
				assert.equal(selected[0][3].chars, "d");
				release(terminal, [2, 0]);
				assert.equal(copied[0], "bc");
			} finally { tui.stop({ preserveScreen: true }); }
		}
	});

	it("leaves a mapped suffix non-inverse after an empty top-level SGR reset", async () => {
		const { tui, terminal, copied } = fixture([new Text("\x1b[7;38:2::7:8:9;mabcd", 0, 0), paragraph()], 20);
		try {
			const initial = await recordedCells(terminal);
			assert.equal(initial[0][3].inverse, false);
			drag(terminal, [1, 0], [2, 0]);
			tui.renderNow();
			const selected = await recordedCells(terminal);
			for (let col = 0; col < 20; col++) {
				assert.deepEqual(selected[0][col], { ...initial[0][col], inverse: col === 1 || col === 2 });
			}
			release(terminal, [2, 0]);
			assert.equal(copied[0], "bc");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("preserves pinned wrapped rows and all their suffix attributes during selection", async () => {
		// Continuations are pinned renderer bytes, not the attributes of the unwrapped input.
		for (const [sgr, continuation] of [
			["\x1b[7;38:2::7:8:9;m", "cd"],
			["\x1b[7;;1;44m", "\x1b[1;7;44mcd"],
			["\x1b[7;31;m", "\x1b[7;31mcd"],
			["\x1b[58;5;7m", "\x1b[5;7mcd"],
			["\x1b[1;3;4;38:2::1:2:3;48:2::4:5:6;4:0m", "cd"],
			["\x1b[4m\x1b[4:0;4:1m", "\x1b[4mcd"],
		]) {
			const { tui, terminal, copied } = fixture([new Text(`${sgr}abcd`, 0, 0), paragraph()], 2);
			try {
				const initialFrame = tui.getScreenLines();
				assert.equal(initialFrame[1], continuation + "\x1b[0m\x1b]8;;\x07");
				const initial = await recordedCells(terminal);
				drag(terminal, [1, 0], [0, 1]);
				tui.renderNow();
				const frame = tui.getScreenLines();
				const selected = await recordedCells(terminal);
				for (let row = 0; row < initial.length; row++) {
					assert.equal(stripTerminalSequences(frame[row]), stripTerminalSequences(initialFrame[row]));
					for (let col = 0; col < 2; col++) {
						const selectedCell = (row === 0 && col === 1) || (row === 1 && col === 0);
						assert.deepEqual(selected[row][col], { ...initial[row][col], inverse: selectedCell || initial[row][col].inverse });
					}
				}
				release(terminal, [0, 1]);
				assert.equal(copied[0], "bc");
			} finally { tui.stop({ preserveScreen: true }); }
		}
	});

	it("preserves original inverse on the untouched suffix of a mapped selection", async () => {
		const { tui, terminal, copied } = fixture([new Text("\x1b[7mabcd\x1b[27m", 0, 0), paragraph()], 20);
		try {
			const initial = await cells(tui.getScreenLines(), 20);
			drag(terminal, [1, 0], [2, 0]);
			tui.renderNow();
			const selected = await cells(tui.getScreenLines(), 20);
			assert.equal(selected[0][1].inverse, true);
			assert.equal(selected[0][2].inverse, true);
			assert.equal(selected[0][3].inverse, true);
			assert.deepEqual(selected[0][3], initial[0][3]);
			assert.deepEqual(selected[0][0], initial[0][0]);
			assert.deepEqual(selected[0][4], initial[0][4]);
			release(terminal, [2, 0]);
			assert.equal(copied[0], "bc");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("preserves current search-match inverse beyond an existing mapped selection", async () => {
		const { tui, terminal, copied } = fixture([new Text("abcd tail", 0, 0), paragraph()], 60);
		try {
			// Establish transcript coordinates before search opens its separate input overlay.
			drag(terminal, [1, 0], [2, 0]);
			terminal.sendInput("\x1b[102;6u");
			terminal.sendInput("abcd");
			tui.renderNow();
			const selected = await cells(tui.getScreenLines(), 60);
			for (let col = 0; col < 4; col++) assert.equal(selected[0][col].inverse, true);
			assert.equal(selected[0][3].chars, "d");
			assert.equal(selected[0][4].inverse, false);
			release(terminal, [2, 0]);
			assert.equal(copied[0], "bc");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("retains styled, wrap-elided indentation without highlighting synthetic cells", async () => {
		const { tui, terminal, copied } = fixture([new Text("\x1b[31m    a", 0, 0), new Markdown("x", 0, 0, defaultMarkdownTheme)], 2);
		try {
			drag(terminal, [0, 0], [1, 0]);
			tui.renderNow();
			const painted = await cells(tui.getScreenLines(), 2);
			assert.equal(painted[0][0].inverse, true);
			assert.equal(painted[0][1].inverse, false);
			release(terminal, [1, 0]);
			assert.equal(copied[0], "    a");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("keeps Pi's exact row-copy/highlight fallback for an unsupported sibling", async () => {
		const unsupported = { render: () => ["  old   ", "  rows  "], invalidate: () => {} };
		const { tui, terminal, copied } = fixture([new Text("mapped", 0, 0), unsupported, paragraph()], 9);
		try {
			drag(terminal, [0, 1], [8, 2]);
			tui.renderNow();
			const frame = tui.getScreenLines();
			const reset = "\x1b[0m\x1b]8;;\x07";
			// These are the original fullscreen painter's exact bytes, including padding inversion.
			assert.equal(frame[1], "\x1b[7m  old   \x1b[27m" + reset);
			assert.equal(frame[2], "\x1b[7m  rows  \x1b[27m" + reset);
			release(terminal, [8, 2]);
			assert.equal(copied[0], "  old\n  rows");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("keeps the exact rectangle highlight for a short unsupported auto-scrollbar row", async () => {
		const unsupported = { render: () => ["x"], invalidate: () => {} };
		const { tui, terminal, copied, scroll } = fixture([
			new Text("alpha beta", 2, 0), unsupported, new Text("tail\n".repeat(12), 0, 0),
		], 9, 5);
		try {
			scroll.setScrollbar("auto");
			scroll.setScrollbarActive(true);
			tui.renderNow();
			assert.equal(stripTerminalSequences(tui.getScreenLines()[2]), "x       │");
			drag(terminal, [0, 2], [8, 2]);
			tui.renderNow();
			const frame = tui.getScreenLines();
			const reset = "\x1b[0m\x1b]8;;\x07";
			assert.equal(frame[2], "\x1b[7mx       \x1b[0m\x1b[7m\x1b]8;;\x07\x1b[90m\x1b[7m│\x1b[27m" + reset);
			const painted = await cells(frame, 9);
			assert.ok(painted[2].every((cell) => cell.inverse));
			release(terminal, [8, 2]);
			assert.equal(copied[0], "x");
			tui.resetTextSelection();
			drag(terminal, [0, 0], [8, 2]);
			tui.renderNow();
			const mixed = await cells(tui.getScreenLines(), 9);
			for (let row = 0; row <= 2; row++) assert.ok(mixed[row].every((cell) => cell.inverse));
			release(terminal, [8, 2]);
			assert.equal(copied[1], "  alpha\n  beta\nx");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("keeps mapped scrollbar selections canonical only while their selected cells match", async () => {
		for (const [source, expected] of [
			["alpha longword", "alpha longword"],
			["alpha abcdefghi", "alpha\nabcdefghi"],
		]) {
			const { tui, terminal, copied, scroll } = fixture([
				new Text(source, 0, 0), new Text("tail\n".repeat(12), 0, 0),
			], 9, 5);
			try {
				scroll.setScrollbar("auto");
				scroll.setScrollbarActive(true);
				tui.renderNow();
				drag(terminal, [0, 0], [8, 1]);
				tui.renderNow();
				const painted = await cells(tui.getScreenLines(), 9);
				if (source === "alpha longword") {
					assert.equal(painted[0][5].inverse, false);
					assert.equal(painted[1][8].inverse, false);
				} else {
					assert.ok(painted[0].every((cell) => cell.inverse));
					assert.ok(painted[1].every((cell) => cell.inverse));
				}
				release(terminal, [8, 1]);
				assert.equal(copied[0], expected);
			} finally { tui.stop({ preserveScreen: true }); }
		}
	});

	it("falls back for the whole selection when mapped wraps include an unsupported row", async () => {
		const unsupported = { render: () => ["x"], invalidate: () => {} };
		const { tui, terminal, copied } = fixture([new Text("alpha beta", 2, 0), unsupported, paragraph()], 9);
		try {
			drag(terminal, [0, 0], [8, 2]);
			tui.renderNow();
			const frame = tui.getScreenLines();
			const reset = "\x1b[0m\x1b]8;;\x07";
			assert.equal(frame[0], "\x1b[7m  alpha  \x1b[27m" + reset);
			assert.equal(frame[1], "\x1b[7m  beta   \x1b[27m" + reset);
			assert.equal(frame[2], "\x1b[7mx\x1b[27m" + reset);
			const painted = await cells(frame, 9);
			assert.ok(painted[0].every((cell) => cell.inverse));
			assert.ok(painted[1].every((cell) => cell.inverse));
			release(terminal, [8, 2]);
			assert.equal(copied[0], "  alpha\n  beta\nx");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("uses whole-selection baseline fallback when an overlay replaces selected mapped cells", async () => {
		const { tui, terminal, copied } = fixture([new Text("alpha beta", 2, 0), paragraph()], 9);
		try {
			drag(terminal, [0, 0], [8, 1]);
			tui.renderNow();
			const canonical = await cells(tui.getScreenLines(), 9);
			assert.equal(canonical[0][0].inverse, false);
			assert.equal(canonical[1][8].inverse, false);
			const overlay = tui.showOverlay(new Text("012345678", 0, 0), { anchor: "top-left", width: 9, nonCapturing: true });
			tui.renderNow();
			const frame = tui.getScreenLines();
			assert.equal(stripTerminalSequences(frame[0]), "012345678");
			const painted = await cells(frame, 9);
			assert.ok(painted[0].every((cell) => cell.inverse));
			assert.ok(painted[1].every((cell) => cell.inverse));
			release(terminal, [8, 1]);
			// Baseline scroll selections copy producer rows even when an overlay paints over them.
			assert.equal(copied[0], "  alpha\n  beta");
			overlay.hide();
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("uses baseline copy and rectangle highlight when an overlay replaces only selected mapped margins", async () => {
		const { tui, terminal, copied } = fixture([new Text("alpha beta", 2, 0), paragraph()], 9);
		try {
			drag(terminal, [0, 0], [8, 0]);
			tui.renderNow();
			const canonical = await cells(tui.getScreenLines(), 9);
			for (let col = 0; col < 9; col++) {
				assert.equal(canonical[0][col].inverse, col >= 2 && col < 7);
			}
			const overlay = tui.showOverlay(new Text("ZZalphaZZ", 0, 0), { anchor: "top-left", width: 9, nonCapturing: true });
			tui.renderNow();
			const frame = tui.getScreenLines();
			assert.equal(stripTerminalSequences(frame[0]), "ZZalphaZZ");
			const painted = await cells(frame, 9);
			assert.ok(painted[0].every((cell) => cell.inverse));
			release(terminal, [8, 0]);
			// Baseline scroll copying uses the producer row, not overlay text or canonical prose.
			assert.equal(copied[0], "  alpha");
			overlay.hide();
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("uses whole-selection baseline fallback when a narrow overlay replaces only selected margins", async () => {
		const { tui, terminal, copied } = fixture([new Text("alpha beta", 2, 0), paragraph()], 9);
		try {
			drag(terminal, [0, 0], [8, 1]);
			tui.renderNow();
			const canonical = await cells(tui.getScreenLines(), 9);
			for (let col = 0; col < 9; col++) {
				assert.equal(canonical[0][col].inverse, col >= 2 && col < 7);
				assert.equal(canonical[1][col].inverse, col >= 2 && col < 6);
			}
			const overlay = tui.showOverlay(new Text("ZZ", 0, 0), { row: 0, col: 0, width: 2, nonCapturing: true });
			tui.renderNow();
			assert.deepEqual(overlay.getBounds(), { row: 0, col: 0, width: 2, height: 1 });
			const frame = tui.getScreenLines();
			assert.equal(stripTerminalSequences(frame[0]), "ZZalpha  ");
			const painted = await cells(frame, 9);
			assert.ok(painted[0].every((cell) => cell.inverse));
			assert.ok(painted[1].every((cell) => cell.inverse));
			release(terminal, [8, 1]);
			// Baseline scroll copying uses producer rows, not overlay text or canonical prose.
			assert.equal(copied[0], "  alpha\n  beta");
			overlay.hide();
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("keeps wrapped-text selections canonical with disjoint overlays before or after drag", async () => {
		for (const bounds of [
			{ row: 2, col: 0, width: 9, height: 1 },
			{ row: 1, col: 7, width: 2, height: 1 },
		]) {
			for (const showBeforeDrag of [false, true]) {
				const { tui, terminal, copied } = fixture([new Text("alpha beta", 2, 0), paragraph()], 9);
				try {
					if (!showBeforeDrag) {
						drag(terminal, [0, 0], [6, 1]);
						tui.renderNow();
						const canonical = await cells(tui.getScreenLines(), 9);
						assert.equal(canonical[0][0].inverse, false);
						assert.equal(canonical[1][6].inverse, false);
					}
					const overlay = tui.showOverlay(new Text("ZZ", 0, 0), {
						row: bounds.row, col: bounds.col, width: bounds.width, nonCapturing: true,
					});
					tui.renderNow();
					assert.deepEqual(overlay.getBounds(), bounds);
					const initial = tui.getScreenLines();
					if (showBeforeDrag) drag(terminal, [0, 0], [6, 1]);
					tui.renderNow();
					const frame = tui.getScreenLines();
					const painted = await cells(frame, 9);
					for (let row = 0; row < 2; row++) {
						for (let col = 0; col < 9; col++) {
							assert.equal(painted[row][col].inverse, col >= 2 && col < (row === 0 ? 7 : 6));
						}
						assert.equal(stripTerminalSequences(frame[row]), stripTerminalSequences(initial[row]));
					}
					assert.equal(painted[bounds.row][bounds.col].chars, "Z");
					assert.equal(painted[bounds.row][bounds.col].inverse, false);
					release(terminal, [6, 1]);
					assert.equal(copied[0], "alpha beta");
				} finally { tui.stop({ preserveScreen: true }); }
			}
		}
	});

	it("compares overlay bounds with screen rows for a docked, scrolled canonical selection", async () => {
		const { tui, terminal, copied, scroll } = fixture([new Text("skip\nskip\nalpha beta", 2, 0), paragraph()], 9, 5);
		try {
			tui.setLayoutRoot(new VStack([new Text("dock", 0, 0), { component: scroll, basis: 0, grow: 1 }]));
			tui.renderNow();
			scroll.scrollTo(2);
			tui.renderNow();
			const overlay = tui.showOverlay(new Text("ZZ", 0, 0), { row: 3, col: 0, width: 2, nonCapturing: true });
			tui.renderNow();
			assert.deepEqual(overlay.getBounds(), { row: 3, col: 0, width: 2, height: 1 });
			drag(terminal, [0, 1], [8, 2]);
			tui.renderNow();
			const painted = await cells(tui.getScreenLines(), 9);
			assert.ok(painted[0].every((cell) => !cell.inverse));
			assert.ok(painted[3].every((cell) => !cell.inverse));
			assert.equal(painted[3][0].chars, "Z");
			for (let row = 1; row <= 2; row++) {
				for (let col = 0; col < 9; col++) {
					assert.equal(painted[row][col].inverse, col >= 2 && col < (row === 1 ? 7 : 6));
				}
			}
			release(terminal, [8, 2]);
			assert.equal(copied[0], "alpha beta");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("falls back when an overlay replaces a selected mapped empty row without a canonical mask", async () => {
		const { tui, terminal, copied } = fixture([new Text("\nalpha", 2, 0), paragraph()], 9);
		try {
			drag(terminal, [0, 0], [8, 1]);
			tui.renderNow();
			const canonical = await cells(tui.getScreenLines(), 9);
			assert.ok(canonical[0].every((cell) => !cell.inverse));
			tui.showOverlay(new Text("012345678", 0, 0), { anchor: "top-left", width: 9, nonCapturing: true });
			tui.renderNow();
			const painted = await cells(tui.getScreenLines(), 9);
			assert.ok(painted[0].every((cell) => cell.inverse));
			assert.ok(painted[1].every((cell) => cell.inverse));
			release(terminal, [8, 1]);
			assert.equal(copied[0], "\n  alpha");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("falls back to Pi's original painting and copying for a mutated presentation-only row", () => {
		const text = new Text("abc", 0, 1);
		const rows = text.render(9);
		rows[0] = "界a";
		const { tui, terminal, copied } = fixture([text, paragraph()], 9);
		try {
			drag(terminal, [0, 0], [1, 0]);
			tui.renderNow();
			assert.equal(tui.getScreenLines()[0], "\x1b[7m界\x1b[27ma\x1b[0m\x1b]8;;\x07");
			release(terminal, [1, 0]);
			assert.equal(copied[0], "界");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("keeps HStack children on row fallback and propagates ordinary vertical Container rows", () => {
		const container = new Container();
		container.addChild(new Text("alpha beta", 2, 0));
		const hstack = new HStack([new Text("x", 0, 0), new Text("y", 0, 0)]);
		const { tui, terminal, copied } = fixture([container, hstack, paragraph()], 9);
		try {
			drag(terminal, [0, 0], [8, 1]);
			release(terminal, [8, 1]);
			assert.equal(copied[0], "alpha beta");
			tui.resetTextSelection();
			drag(terminal, [0, 2], [8, 2]);
			release(terminal, [8, 2]);
			assert.equal(copied[1], "x  y");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("validates canonical copy against the painted scroll offset before a queued render", async () => {
		const { tui, terminal, copied, scroll } = fixture([
			new Text("alpha beta", 2, 0), new Text("tail\n".repeat(12), 0, 0),
		], 9, 5);
		try {
			drag(terminal, [0, 0], [8, 1]);
			tui.renderNow();
			const frame = tui.getScreenLines();
			const writeCount = terminal.writes.length;
			scroll.scrollBy(1);
			assert.equal(scroll.scrollTop, 1);
			const copying = tui.copyActiveSelectionToClipboard();
			// No await or render between scroll and copy: the transcript on screen is still at offset zero.
			assert.equal(terminal.writes.length, writeCount);
			assert.deepEqual(tui.getScreenLines(), frame);
			assert.equal(copied[0], "alpha beta");
			const painted = await recordedCells(terminal);
			for (let row = 0; row < 2; row++) {
				for (let col = 0; col < 9; col++) assert.equal(painted[row][col].inverse, col >= 2 && col < (row === 0 ? 7 : 6));
			}
			assert.equal(await copying, true);
			tui.renderNow();
			assert.equal(await tui.copyActiveSelectionToClipboard(), true);
			assert.equal(copied[1], "alpha beta");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("copies the same canonical frame used by the mask underneath an overlapping flash", async () => {
		const { tui, terminal, copied } = fixture([new Text("alpha beta", 2, 0), paragraph()], 9);
		try {
			drag(terminal, [0, 0], [8, 1]);
			tui.renderNow();
			const canonical = await recordedCells(terminal);
			tui.flash("ZZZZ", 60000);
			tui.renderNow();
			const flashed = await recordedCells(terminal);
			assert.equal(flashed[0][0].inverse, false);
			assert.equal(flashed[0][2].inverse, true);
			assert.equal(flashed[0][4].chars, "Z");
			assert.notEqual(flashed[0][4].chars, canonical[0][4].chars);
			assert.deepEqual(flashed[1], canonical[1]);
			for (let col = 0; col < 9; col++) assert.equal(flashed[1][col].inverse, col >= 2 && col < 6);
			release(terminal, [8, 1]);
			assert.equal(copied[0], "alpha beta");
			// The subsequent clipboard flash also must not change the admission decision.
			await Promise.resolve();
			tui.renderNow();
			assert.equal(await tui.copyActiveSelectionToClipboard(), true);
			assert.equal(copied[1], "alpha beta");
		} finally { tui.stop({ preserveScreen: true }); }
	});

	it("uses existing scroll and viewport offsets when a mapped transcript is docked", () => {
		const { tui, terminal, copied, scroll } = fixture([new Text("skip\nalpha beta", 2, 0), paragraph()], 9, 5);
		try {
			tui.setLayoutRoot(new VStack([new Text("dock", 0, 0), { component: scroll, basis: 0, grow: 1 }]));
			tui.renderNow();
			scroll.scrollTo(1);
			tui.renderNow();
			drag(terminal, [0, 1], [8, 2]);
			release(terminal, [8, 2]);
			assert.equal(copied[0], "alpha beta");
		} finally { tui.stop({ preserveScreen: true }); }
	});
});
