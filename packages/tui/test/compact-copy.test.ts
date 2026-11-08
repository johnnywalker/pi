import assert from "node:assert/strict";
import { describe, it } from "node:test";
import xterm from "@xterm/headless";
import { getCopyParts, isMappedCopyRow, isTrustedCopyRow, paintCopyMask, resolveCopy } from "../src/compact-copy.ts";
import { Markdown } from "../src/components/markdown.ts";
import { Text } from "../src/components/text.ts";
import { stripTerminalSequences, wrapTextWithAnsi, type WrapTraceRow } from "../src/utils.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

function all(lines: string[], mode: "character" | "row" = "character") {
	return resolveCopy(lines, { row: 0, column: 0 }, { row: lines.length - 1, column: Infinity }, mode);
}

describe("compact-copy experimental producer selection", () => {
	it("copies soft wraps without margins and shares exact clipboard/highlight intervals", () => {
		const text = new Text("alpha beta", 2, 1);
		const lines = text.render(9);
		assert.deepEqual(lines, ["         ", "  alpha  ", "  beta   ", "         "]);
		assert.deepEqual(all(lines), {
			text: "alpha beta",
			masks: [{ row: 1, x0: 2, x1: 7 }, { row: 2, x0: 2, x1: 6 }],
		});
		assert.deepEqual(resolveCopy(lines, { row: 2, column: 6 }, { row: 1, column: 2 }), all(lines));
		assert.deepEqual(resolveCopy(lines, { row: 1, column: 7 }, { row: 1, column: 9 }), { text: "", masks: [] });
	});

	it("paints the resolved fullscreen mask without inverting margins or losing inline resets", async () => {
		const lines = new Text("\x1b[31malpha\x1b[0m beta", 2, 0).render(9);
		const selection = all(lines);
		assert.equal(selection.text, "alpha beta");
		const terminal = new xterm.Terminal({ cols: 9, rows: 3, allowProposedApi: true });
		const painted = selection.masks.map((mask) => paintCopyMask(lines[mask.row], mask));
		await new Promise<void>((resolve) => terminal.write(painted.join("\r\n"), resolve));
		for (const mask of selection.masks) {
			const row = terminal.buffer.active.getLine(mask.row)!;
			for (let column = 0; column < 9; column++) {
				assert.equal(Boolean(row.getCell(column)!.isInverse()), column >= mask.x0 && column < mask.x1);
			}
		}
		terminal.dispose();
	});

	it("restores inverse at a painted mask's right boundary using original SGR state", async () => {
		for (const [source, inverse] of [
			["\x1b[7mabcd\x1b[27m", true],
			["\x1b[1;7mabcd\x1b[22;27m", true],
			["\x1b[7mab\x1b[0mcd", false],
			["\x1b[38;5;7mabcd", false],
			["\x1b[48;2;7;7;7mabcd", false],
			["\x1b[7;38;2;0;27;0mabcd", true],
			["\x1b[58;5;7mabcd", false],
			["\x1b[58;2;7;7;7mabcd", false],
			["\x1b[7;58;2;0;27;0mabcd", true],
			["\x1b[7;38:2::7:8:9mabcd", true],
			["\x1b[7;48:2::0:27:0mabcd", true],
			["\x1b[7;58:2::0:27:0mabcd", true],
			["\x1b[38:5:7mabcd", false],
			["\x1b[48:5:7mabcd", false],
			["\x1b[58:5:7mabcd", false],
			["\x1b[7;38:2::7:8:9;mabcd", false],
			["\x1b[7;48:2::7:8:9;;mabcd", false],
			["\x1b[7;;1;44mabcd", false],
		] as const) {
			const terminal = new xterm.Terminal({ cols: 8, rows: 1, allowProposedApi: true });
			try {
				await new Promise<void>((resolve) => terminal.write(paintCopyMask(source, { row: 0, x0: 1, x1: 3 }), resolve));
				const row = terminal.buffer.active.getLine(0)!;
				assert.equal(Boolean(row.getCell(1)!.isInverse()), true);
				assert.equal(Boolean(row.getCell(2)!.isInverse()), true);
				assert.equal(Boolean(row.getCell(3)!.isInverse()), inverse);
				assert.equal(row.getCell(3)!.getChars(), "d");
			} finally { terminal.dispose(); }
		}
	});

	it("uses endpoint affinity for an already expanded word versus the whole visual row", () => {
		const lines = new Text("alpha   beta", 1, 0).render(7);
		assert.equal(resolveCopy(lines, { row: 0, column: 1 }, { row: 0, column: 6 }).text, "alpha");
		assert.equal(resolveCopy(lines, { row: 0, column: 0 }, { row: 0, column: 7 }, "row").text, "alpha   ");
	});

	it("preserves hard newlines, meaningful indentation, blank anchors, and normalized tabs/CRLF", () => {
		const source = "first\r\n\tindented\n\nlast";
		const lines = new Text(source, 1, 0).render(10);
		assert.equal(all(lines).text, "first\n   indented\n\nlast");
		assert.equal(all(lines, "row").text, "first\n   indented\n\nlast");
		assert.ok(all(lines).masks.every((mask) => mask.x0 >= 1 && mask.x1 <= 9));
	});

	it("copies a selected hard boundary at an exclusive content start but not a collapsed empty row", () => {
		for (const paddingX of [0, 2]) {
			const lines = new Text("a\nb", paddingX, 0).render(8);
			assert.deepEqual(lines, [`${" ".repeat(paddingX)}a`.padEnd(8), `${" ".repeat(paddingX)}b`.padEnd(8)]);
			for (const column of [0, paddingX]) {
				assert.deepEqual(resolveCopy(lines, { row: 0, column: paddingX }, { row: 1, column }), {
					text: "a\n", masks: [{ row: 0, x0: paddingX, x1: paddingX + 1 }],
				});
			}
			const blank = new Text("a\n\nb", paddingX, 0).render(8);
			assert.deepEqual(resolveCopy(blank, { row: 1, column: paddingX }, { row: 1, column: paddingX }), {
				text: "", masks: [],
			});
			assert.deepEqual(resolveCopy(blank, { row: 0, column: paddingX }, { row: 1, column: paddingX }), {
				text: "a\n", masks: [{ row: 0, x0: paddingX, x1: paddingX + 1 }],
			});
			assert.deepEqual(resolveCopy(blank, { row: 0, column: paddingX }, { row: 2, column: paddingX }), {
				text: "a\n\n", masks: [{ row: 0, x0: paddingX, x1: paddingX + 1 }],
			});
		}
	});

	it("retains newline-only boundaries and never consumes an empty row's following newline", () => {
		const lines = new Text("a\n\nb", 0, 0).render(8);
		assert.deepEqual(resolveCopy(lines, { row: 0, column: 1 }, { row: 1, column: 0 }), { text: "\n", masks: [] });
		assert.deepEqual(resolveCopy(lines, { row: 1, column: 0 }, { row: 1, column: 4 }), { text: "", masks: [] });
	});

	it("falls back for mutated spacing and preserves ANSI-split graphemes while painting", () => {
		const lines = new Text("abc", 0, 1).render(3);
		lines[0] = "界a";
		assert.deepEqual(resolveCopy(lines, { row: 0, column: 1 }, { row: 0, column: 2 }), {
			text: "界", masks: [{ row: 0, x0: 0, x1: 2 }],
		});
		const paint = "👩\x1b[31m‍👩a";
		const result = resolveCopy([paint], { row: 0, column: 1 }, { row: 0, column: 2 });
		assert.equal(result.text, "👩‍👩");
		assert.equal(stripTerminalSequences(paintCopyMask(paint, result.masks[0])), "👩‍👩a");
	});

	it("trusts zero-width OSC/SGR decorations but rejects text, whitespace and cursor-command mutations", () => {
		const lines = new Text("alpha beta", 2, 1).render(9);
		const expected = all(lines);
		lines[0] = "\x1b]133;A\x07" + lines[0];
		lines[1] = "\x1b[31m" + lines[1].replace("alpha", "al\x1b[1mpha") + "\x1b[0m";
		lines[2] += "\x1b]133;B\x1b\\\x1b]133;C\x07";
		assert.ok(lines.every((_, row) => isTrustedCopyRow(lines, row)));
		assert.ok(isMappedCopyRow(lines, 1));
		assert.ok(isMappedCopyRow(lines, 2));
		assert.deepEqual(all(lines), expected);
		for (const mutation of ["\x1b[1G", "\x1b[2K", "x", " "]) {
			const original = lines[1];
			lines[1] = mutation + original;
			assert.equal(isTrustedCopyRow(lines, 1), false);
			assert.equal(isMappedCopyRow(lines, 1), false);
			lines[1] = original;
		}
		lines[0] += "x";
		assert.equal(isTrustedCopyRow(lines, 0), false);
	});

	it("snaps Unicode endpoints as whole graphemes without retaining glyph maps", () => {
		const lines = new Text("e\u0301界👩‍👩‍👧‍👦🇳🇿", 1, 0).render(24);
		assert.deepEqual(resolveCopy(lines, { row: 0, column: 3 }, { row: 0, column: 4 }), {
			text: "界", masks: [{ row: 0, x0: 2, x1: 4 }],
		});
		assert.deepEqual(resolveCopy(lines, { row: 0, column: 5 }, { row: 0, column: 6 }), {
			text: "👩‍👩‍👧‍👦", masks: [{ row: 0, x0: 4, x1: 6 }],
		});
		assert.equal(resolveCopy(lines, { row: 0, column: 1 }, { row: 0, column: 2 }).text, "e\u0301");
		assert.equal(getCopyParts(lines)?.[1].rows.runs.length, 1);
	});

	it("keeps contiguous URLs contiguous through wrapping and ANSI/OSC styling", () => {
		const url = "https://example.test/" + "long-token".repeat(12);
		const lines = new Text(`\x1b]8;;${url}\x07\x1b[4m${url}\x1b[24m\x1b]8;;\x07`, 1, 0).render(18);
		assert.equal(all(lines).text, url);
		assert.ok(all(lines).masks.every((mask) => mask.x0 === 1 && mask.x1 <= 17));
	});

	it("records wrap offsets without substituting trace strings for the actual paint", () => {
		for (const source of ["a\u00a0b xyz", "\x1b[31m    a", "a\n    \nb", "界界 e\u0301👩‍👩‍👧‍👦 xyz", "a   a a  a"]) {
			for (const width of [1, 3, 5, 12]) {
				const trace: WrapTraceRow[] = [];
				const paint = wrapTextWithAnsi(source, width, trace);
				assert.deepEqual(paint, wrapTextWithAnsi(source, width));
				const canonical = stripTerminalSequences(source);
				assert.equal(trace.length, paint.length);
				for (let i = 0; i < trace.length; i++) {
					assert.equal(canonical.slice(trace[i].visibleStart, trace[i].visibleEnd), stripTerminalSequences(paint[i]));
				}
			}
		}
	});

	it("retains ANSI-bearing elided indentation at row affinity while masking only visible glyphs", () => {
		const lines = new Text("\x1b[31m    a", 0, 0).render(2);
		assert.deepEqual(lines, ["\x1b[31ma "]);
		assert.deepEqual(all(lines, "row"), { text: "    a", masks: [{ row: 0, x0: 0, x1: 1 }] });
		assert.equal(stripTerminalSequences(paintCopyMask(lines[0], all(lines, "row").masks[0])), "a ");
	});

	it("retains source whitespace at row affinity without highlighting wrap-elided spaces", () => {
		const lines = new Text("a\n    \nb", 0, 0).render(2);
		assert.equal(all(lines, "row").text, "a\n    \nb");
		assert.deepEqual(resolveCopy(lines, { row: 1, column: 0 }, { row: 1, column: 2 }), { text: "    ", masks: [] });
		assert.deepEqual(all(lines, "row").masks, [{ row: 0, x0: 0, x1: 1 }, { row: 2, x0: 0, x1: 1 }]);
	});

	it("maps rendered Markdown text, not formatting syntax, and excludes producer padding", () => {
		const lines = new Markdown("**alpha** `beta`\nnext", 2, 1, defaultMarkdownTheme).render(12);
		assert.equal(all(lines).text, "alpha beta\nnext");
		assert.ok(all(lines).masks.every((mask) => mask.x0 >= 2 && mask.x1 <= 10));
	});

	it("copies code fences/rendered code but excludes decorative code indentation only", () => {
		const lines = new Markdown("```ts\n    alpha beta gamma\n\n  z\n```", 1, 0, defaultMarkdownTheme).render(14);
		assert.equal(all(lines).text, "```ts\n    alpha beta gamma\n\n  z\n```");
		const body = all(lines).masks.find((mask) => stripTerminalSequences(lines[mask.row]).includes("alpha"));
		assert.equal(body?.x0, 3);
		assert.equal(all(lines).masks.filter((mask) => stripTerminalSequences(lines[mask.row]).trim() === "").length, 0);
	});

	it("keeps completed block descriptors and cached-array identities stable during streaming", () => {
		const markdown = new Markdown("```ts\nx\n```\n\nlast", 1, 0, defaultMarkdownTheme);
		const before = markdown.render(30);
		const parts = getCopyParts(before);
		assert.strictEqual(markdown.render(30), before);
		assert.strictEqual(getCopyParts(markdown.render(30)), parts);
		markdown.setText("```ts\nx\n```\n\nlast updated");
		const after = markdown.render(30);
		assert.strictEqual(getCopyParts(after)?.[1].rows, parts?.[1].rows);
		assert.equal(all(after).text, "```ts\nx\n```\n\nlast updated");
		const owner = getCopyParts(after)?.[1].rows.source;
		assert.strictEqual(getCopyParts(markdown.render(18))?.[1].rows.source, owner);
	});

	it("keeps mapped siblings when another row is unsupported or mutated", () => {
		const markdown = new Markdown("alpha beta\n\n- parent\n  - unsupported\n\ngamma delta", 1, 0, defaultMarkdownTheme);
		const lines = markdown.render(10);
		const result = all(lines);
		assert.ok(result.text.startsWith("alpha beta"));
		assert.ok(result.text.endsWith("gamma delta"));
		const textLines = new Text("alpha beta", 2, 0).render(9);
		textLines[0] = "  zeta   ";
		assert.deepEqual(all(textLines), {
			text: "  zeta\nbeta",
			masks: [{ row: 0, x0: 0, x1: 6 }, { row: 1, x0: 2, x1: 6 }],
		});
	});

	it("snaps mutated and unsupported wide-glyph fallback clipboard and masks together", () => {
		for (const glyph of ["界", "👩‍👩‍👧‍👦"]) {
			const paint = `\x1b[31m${glyph}\x1b[0ma`;
			const mutated = new Text("abc", 0, 0).render(3);
			mutated[0] = paint;
			for (const lines of [mutated, [paint]]) {
				for (const [left, right] of [[0, 1], [1, 2]]) {
					const result = resolveCopy(lines, { row: 0, column: left }, { row: 0, column: right });
					assert.deepEqual(result, { text: glyph, masks: [{ row: 0, x0: 0, x1: 2 }] });
					assert.equal(stripTerminalSequences(paintCopyMask(lines[0], result.masks[0])), `${glyph}a`);
				}
				assert.deepEqual(resolveCopy(lines, { row: 0, column: 1 }, { row: 0, column: 1 }), { text: "", masks: [] });
			}
		}
	});

	it("does not connect duplicate block occurrences through reused source ownership", () => {
		const lines = new Markdown("alpha\n\nalpha", 0, 0, defaultMarkdownTheme).render(20);
		assert.equal(all(lines).text, "alpha\n\nalpha");
	});

	it("queries only the selected viewport rows, not all 10,000 retained rows", () => {
		const lines = new Text(Array.from({ length: 10000 }, (_, i) => `row ${i}`).join("\n"), 1, 0).render(30);
		let reads = 0;
		Object.defineProperty(lines, "9000", { get: () => { reads++; return " row 9000".padEnd(30); } });
		resolveCopy(lines, { row: 0, column: 1 }, { row: 20, column: 9 });
		assert.equal(reads, 0);
	});

	it("allows unreachable render generations and their sidecars to be collected", { skip: !globalThis.gc }, async () => {
		let text: Text | undefined = new Text("owner ".repeat(1000), 1, 0);
		let lines: string[] | undefined = text.render(40);
		const weakLines = new WeakRef(lines);
		const weakSource = new WeakRef(getCopyParts(lines)![1].rows.source);
		lines = undefined;
		text = undefined;
		await new Promise<void>((resolve) => setImmediate(resolve));
		globalThis.gc!();
		assert.equal(weakLines.deref(), undefined);
		assert.equal(weakSource.deref(), undefined);
	});
});
