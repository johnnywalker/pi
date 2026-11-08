// Canonical copy metadata for supported Markdown headings and flat lists.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMappedCopyRow, isTrustedCopyRow, resolveCopy } from "../src/compact-copy.ts";
import { Markdown } from "../src/components/markdown.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

function all(lines: string[], mode: "character" | "row" = "character") {
	return resolveCopy(lines, { row: 0, column: 0 }, { row: lines.length - 1, column: Infinity }, mode);
}

describe("Markdown heading and list copy", () => {
	it("maps tight unordered items without changing any styled render byte", () => {
		const source = "- alpha beta gamma delta\n- later epsilon zeta eta theta";
		const lines = new Markdown(source, 1, 0, defaultMarkdownTheme).render(16);
		assert.deepEqual(lines, [
			" \x1b[36m- \x1b[39malpha beta   ",
			"   gamma delta  ",
			" \x1b[36m- \x1b[39mlater        ",
			"   epsilon zeta ",
			"   eta theta    ",
		]);
		assert.equal(all(lines).text, source);
		assert.equal(all(lines, "row").text, source);
		assert.deepEqual(all(lines).masks, [
			{ row: 0, x0: 1, x1: 13 }, { row: 1, x0: 3, x1: 14 },
			{ row: 2, x0: 1, x1: 8 }, { row: 3, x0: 3, x1: 15 }, { row: 4, x0: 3, x1: 12 },
		]);
		assert.deepEqual(resolveCopy(lines, { row: 3, column: 3 }, { row: 4, column: 6 }), {
			text: "epsilon zeta eta", masks: [{ row: 3, x0: 3, x1: 15 }, { row: 4, x0: 3, x1: 6 }],
		});
		assert.ok(lines.every((_, row) => isMappedCopyRow(lines, row)));
	});

	it("maps changing-width ordered markers exactly once and retains inter-item newlines", () => {
		const source = "9. alpha beta gamma delta\n10. later epsilon zeta eta theta";
		const lines = new Markdown(source, 1, 0, defaultMarkdownTheme).render(16);
		assert.deepEqual(lines, [
			" \x1b[36m9. \x1b[39malpha beta  ", "    gamma delta ",
			" \x1b[36m10. \x1b[39mlater      ", "     epsilon    ", "     zeta eta   ", "     theta      ",
		]);
		assert.equal(all(lines).text, source);
		assert.equal(all(lines, "row").text, source);
		assert.deepEqual(resolveCopy(lines, { row: 2, column: 0 }, { row: 5, column: 16 }), {
			text: "10. later epsilon zeta eta theta",
			masks: [{ row: 2, x0: 1, x1: 10 }, { row: 3, x0: 5, x1: 12 }, { row: 4, x0: 5, x1: 13 }, { row: 5, x0: 5, x1: 10 }],
		});
		assert.deepEqual(resolveCopy(lines, { row: 4, column: 9 }, { row: 3, column: 5 }), {
			text: "epsilon zeta", masks: [{ row: 3, x0: 5, x1: 12 }, { row: 4, x0: 5, x1: 9 }],
		});
	});

	it("uses existing rendered inline text, real item line breaks and preserved source markers", () => {
		const lines = new Markdown("+ **alpha** beta\n+ gamma  \n  delta", 0, 0, defaultMarkdownTheme,
			undefined, { preserveOrderedListMarkers: true }).render(14);
		assert.equal(all(lines).text, "+ alpha beta\n+ gamma\ndelta");
		assert.ok(lines.every((_, row) => isMappedCopyRow(lines, row)));
		const ordered = new Markdown("3) alpha beta\n3) gamma delta", 0, 0, defaultMarkdownTheme,
			undefined, { preserveOrderedListMarkers: true }).render(12);
		assert.equal(all(ordered).text, "3) alpha beta\n3) gamma delta");
	});

	it("maps heading and paragraph spans without their horizontal margins", () => {
		const source = "# Header wraps across rows\n\nThe body follows the heading.";
		const lines = new Markdown(source, 1, 0, defaultMarkdownTheme).render(16);
		assert.equal(all(lines).text, "Header wraps across rows\n\nThe body follows the heading.");
		assert.ok(lines.every((_, row) => isMappedCopyRow(lines, row) || isTrustedCopyRow(lines, row)));
		assert.ok(all(lines).masks.every((mask) => mask.x0 >= 1 && mask.x1 <= 15));
	});

	it("maps flat loose bullet and ordered lists with their displayed blank separators", () => {
		for (const [source, expected] of [
			["- first item wraps across rows\n\n- second item also wraps across rows", "- first item wraps across rows\n\n- second item also wraps across rows"],
			["9. first item wraps across rows\n\n10. second item also wraps across rows", "9. first item wraps across rows\n\n10. second item also wraps across rows"],
		]) {
			const lines = new Markdown(source, 1, 0, defaultMarkdownTheme).render(16);
			assert.ok(lines.every((_, row) => isTrustedCopyRow(lines, row)), source);
			assert.equal(all(lines).text, expected);
			assert.ok(all(lines).masks.every((mask) => lines[mask.row].trim() !== ""));
		}
	});

	it("maps the normal blank separator between paragraphs and lists without painted glyphs", () => {
		const source = "first paragraph wraps over rows\n\nsecond paragraph wraps over rows\n\n- alpha beta gamma delta\n- later epsilon zeta eta theta";
		const lines = new Markdown(source, 1, 0, defaultMarkdownTheme).render(16);
		assert.ok(lines.every((_, row) => isTrustedCopyRow(lines, row)));
		assert.equal(all(lines).text, source);
		assert.ok(all(lines).masks.every((mask) => lines[mask.row].trim() !== ""));
	});

	it("keeps nested, multi-block, task and overwide lists on explicit baseline fallback", () => {
		for (const source of ["- parent\n  - child", "- first\n\n  second", "- first\n  ```\n  code\n  ```", "- [x] first\n- [ ] second"]) {
			const lines = new Markdown(source, 1, 0, defaultMarkdownTheme).render(16);
			assert.ok(lines.every((_, row) => !isTrustedCopyRow(lines, row)), source);
		}
		for (const source of ["123456789. alpha beta", "- 界界"]) {
			const markdown = new Markdown(source, 0, 0, defaultMarkdownTheme);
			const wide = markdown.render(20);
			assert.ok(wide.every((_, row) => isMappedCopyRow(wide, row)));
			const narrow = markdown.render(2);
			assert.ok(narrow.every((_, row) => !isTrustedCopyRow(narrow, row)));
			assert.ok(markdown.render(20).every((_, row, lines) => isMappedCopyRow(lines, row)));
		}
	});
});
