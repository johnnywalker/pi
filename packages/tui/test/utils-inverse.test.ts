// Selection inverse scanning is independent of the wrapper's legacy ANSI replay.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getActiveInverseAnsi } from "../src/utils.ts";

describe("getActiveInverseAnsi", () => {
	it("applies inverse, normal, full resets and empty parameters in order", () => {
		for (const [text, expected] of [
			["plain", ""],
			["\x1b[7m", "\x1b[7m"],
			["\x1b[7;27m", ""],
			["\x1b[27;7m", "\x1b[7m"],
			["\x1b[7;0m", ""],
			["\x1b[0;7m", "\x1b[7m"],
			["\x1b[7m\x1b[m", ""],
			["\x1b[7;;1;44m", ""],
			["\x1b[7;31;m", ""],
			["\x1b[7;38:2::7:8:9;m", ""],
			["\x1b[7;48:2::7:8:9;;m", ""],
			["\x1b[7;;7m", "\x1b[7m"],
			["\x1b[7m\x1b[27m\x1b[7m", "\x1b[7m"],
			["\x1b[7m\x1b[31m\x1b[4:2m", "\x1b[7m"],
			["\x1b[1;4;31;44m", ""],
		] as const) {
			assert.equal(getActiveInverseAnsi(text), expected, JSON.stringify(text));
		}
	});

	it("never interprets any indexed or RGB color payload as inverse or reset", () => {
		for (const color of [38, 48, 58]) {
			for (const payload of [
				"5;7", "5;27", "5;0", "5;",
				"2;7;27;0", "2;0;7;27", "2;27;0;7", "2;;7;27",
				"5:7", "5:27", "5:0", "2::7:27:0", "2::0:7:27", "2::27:0:7",
			]) {
				const sgr = `\x1b[${color}${payload.includes(":") ? ":" : ";"}${payload}m`;
				assert.equal(getActiveInverseAnsi(sgr), "", JSON.stringify(sgr));
				assert.equal(getActiveInverseAnsi(`\x1b[7m${sgr}`), "\x1b[7m", JSON.stringify(sgr));
				assert.equal(getActiveInverseAnsi(`${sgr}\x1b[7m`), "\x1b[7m");
				assert.equal(getActiveInverseAnsi(`\x1b[7m${sgr}\x1b[27m`), "");
			}
			for (const payload of ["5;7", "2;7;27;0", "5:7", "2::0:27:7"]) {
				const group = `${color}${payload.includes(":") ? ":" : ";"}${payload}`;
				assert.equal(getActiveInverseAnsi(`\x1b[7;${group};27m`), "");
				assert.equal(getActiveInverseAnsi(`\x1b[27;${group};7m`), "\x1b[7m");
				assert.equal(getActiveInverseAnsi(`\x1b[7;${group};m`), "");
			}
		}
	});

	it("skips non-SGR terminal strings, including embedded SGR-looking text", () => {
		for (const text of [
			"\x1b]title;\x1b[7m\x07",
			"\x1b_title;\x1b[7m\x1b\\",
			"\x1b[7G",
			"\x1b[?7m",
		]) {
			assert.equal(getActiveInverseAnsi(text), "");
		}
		assert.equal(getActiveInverseAnsi("\x1b[7m\x1b]8;;url\x07\x1b]8;;\x07"), "\x1b[7m");
	});
});
