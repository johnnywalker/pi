// Byte-for-byte renderer regressions captured from f9a26365568127461c47a07a37dcb42c140a3ac5.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Text } from "../src/components/text.ts";
import { wrapTextWithAnsi, type WrapTraceRow } from "../src/utils.ts";

// Captured with width 2 for the wrapper and width 4 / padding 1 for Text.
const pinnedRows = [
	{
		name: "colon indexed foreground: \"abcd\"",
		text: "\x1b[38:5:1mabcd",
		wrapper: ["\x1b[38:5:1mab", "cd"],
		textRows: ["    ", " \x1b[38:5:1mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[38:5:1mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon indexed foreground: \"ab cd\"",
		text: "\x1b[38:5:1mab cd",
		wrapper: ["\x1b[38:5:1mab", "cd"],
		textRows: ["    ", " \x1b[38:5:1mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[38:5:1mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon indexed foreground: \"ab\\ncd\"",
		text: "\x1b[38:5:1mab\ncd",
		wrapper: ["\x1b[38:5:1mab", "cd"],
		textRows: ["    ", " \x1b[38:5:1mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[38:5:1mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon RGB foreground: \"abcd\"",
		text: "\x1b[38:2::7:8:9mabcd",
		wrapper: ["\x1b[38:2::7:8:9mab", "cd"],
		textRows: ["    ", " \x1b[38:2::7:8:9mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[38:2::7:8:9mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon RGB foreground: \"ab cd\"",
		text: "\x1b[38:2::7:8:9mab cd",
		wrapper: ["\x1b[38:2::7:8:9mab", "cd"],
		textRows: ["    ", " \x1b[38:2::7:8:9mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[38:2::7:8:9mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon RGB foreground: \"ab\\ncd\"",
		text: "\x1b[38:2::7:8:9mab\ncd",
		wrapper: ["\x1b[38:2::7:8:9mab", "cd"],
		textRows: ["    ", " \x1b[38:2::7:8:9mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[38:2::7:8:9mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon indexed background: \"abcd\"",
		text: "\x1b[48:5:7mabcd",
		wrapper: ["\x1b[48:5:7mab", "cd"],
		textRows: ["    ", " \x1b[48:5:7mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[48:5:7mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon indexed background: \"ab cd\"",
		text: "\x1b[48:5:7mab cd",
		wrapper: ["\x1b[48:5:7mab", "cd"],
		textRows: ["    ", " \x1b[48:5:7mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[48:5:7mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon indexed background: \"ab\\ncd\"",
		text: "\x1b[48:5:7mab\ncd",
		wrapper: ["\x1b[48:5:7mab", "cd"],
		textRows: ["    ", " \x1b[48:5:7mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[48:5:7mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon RGB background with inverse: \"abcd\"",
		text: "\x1b[7;48:2::0:27:0mabcd",
		wrapper: ["\x1b[7;48:2::0:27:0mab", "cd"],
		textRows: ["    ", " \x1b[7;48:2::0:27:0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;48:2::0:27:0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon RGB background with inverse: \"ab cd\"",
		text: "\x1b[7;48:2::0:27:0mab cd",
		wrapper: ["\x1b[7;48:2::0:27:0mab", "cd"],
		textRows: ["    ", " \x1b[7;48:2::0:27:0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;48:2::0:27:0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon RGB background with inverse: \"ab\\ncd\"",
		text: "\x1b[7;48:2::0:27:0mab\ncd",
		wrapper: ["\x1b[7;48:2::0:27:0mab", "cd"],
		textRows: ["    ", " \x1b[7;48:2::0:27:0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;48:2::0:27:0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "indexed underline color: \"abcd\"",
		text: "\x1b[58;5;7mabcd",
		wrapper: ["\x1b[58;5;7mab", "\x1b[5;7mcd"],
		textRows: ["    ", " \x1b[58;5;7mab ", " \x1b[5;7mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[58;5;7mab \x1b[49m", "\x1b[44m \x1b[5;7mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "indexed underline color: \"ab cd\"",
		text: "\x1b[58;5;7mab cd",
		wrapper: ["\x1b[58;5;7mab", "\x1b[5;7mcd"],
		textRows: ["    ", " \x1b[58;5;7mab ", " \x1b[5;7mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[58;5;7mab \x1b[49m", "\x1b[44m \x1b[5;7mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "indexed underline color: \"ab\\ncd\"",
		text: "\x1b[58;5;7mab\ncd",
		wrapper: ["\x1b[58;5;7mab", "\x1b[5;7mcd"],
		textRows: ["    ", " \x1b[58;5;7mab ", " \x1b[5;7mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[58;5;7mab \x1b[49m", "\x1b[44m \x1b[5;7mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "RGB underline color: \"abcd\"",
		text: "\x1b[58;2;7;27;0mabcd",
		wrapper: ["\x1b[58;2;7;27;0mab", "cd"],
		textRows: ["    ", " \x1b[58;2;7;27;0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[58;2;7;27;0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "RGB underline color: \"ab cd\"",
		text: "\x1b[58;2;7;27;0mab cd",
		wrapper: ["\x1b[58;2;7;27;0mab", "cd"],
		textRows: ["    ", " \x1b[58;2;7;27;0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[58;2;7;27;0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "RGB underline color: \"ab\\ncd\"",
		text: "\x1b[58;2;7;27;0mab\ncd",
		wrapper: ["\x1b[58;2;7;27;0mab", "cd"],
		textRows: ["    ", " \x1b[58;2;7;27;0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[58;2;7;27;0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline color: \"abcd\"",
		text: "\x1b[7;58:2::0:27:0mabcd",
		wrapper: ["\x1b[7;58:2::0:27:0mab", "cd"],
		textRows: ["    ", " \x1b[7;58:2::0:27:0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;58:2::0:27:0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline color: \"ab cd\"",
		text: "\x1b[7;58:2::0:27:0mab cd",
		wrapper: ["\x1b[7;58:2::0:27:0mab", "cd"],
		textRows: ["    ", " \x1b[7;58:2::0:27:0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;58:2::0:27:0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline color: \"ab\\ncd\"",
		text: "\x1b[7;58:2::0:27:0mab\ncd",
		wrapper: ["\x1b[7;58:2::0:27:0mab", "cd"],
		textRows: ["    ", " \x1b[7;58:2::0:27:0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;58:2::0:27:0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline: \"abcd\"",
		text: "\x1b[4:2mabcd",
		wrapper: ["\x1b[4:2mab", "cd"],
		textRows: ["    ", " \x1b[4:2mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[4:2mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline: \"ab cd\"",
		text: "\x1b[4:2mab cd",
		wrapper: ["\x1b[4:2mab", "cd"],
		textRows: ["    ", " \x1b[4:2mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[4:2mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline: \"ab\\ncd\"",
		text: "\x1b[4:2mab\ncd",
		wrapper: ["\x1b[4:2mab", "cd"],
		textRows: ["    ", " \x1b[4:2mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[4:2mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline reset: \"abcd\"",
		text: "\x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mabcd",
		wrapper: ["\x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mab", "cd"],
		textRows: ["    ", " \x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline reset: \"ab cd\"",
		text: "\x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mab cd",
		wrapper: ["\x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mab", "cd"],
		textRows: ["    ", " \x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline reset: \"ab\\ncd\"",
		text: "\x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mab\ncd",
		wrapper: ["\x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mab", "cd"],
		textRows: ["    ", " \x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[1;3;4;7;38:2::1:2:3;48:2::4:5:6;4:0mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline reenabled: \"abcd\"",
		text: "\x1b[4m\x1b[4:0;4:1mabcd",
		wrapper: ["\x1b[4m\x1b[4:0;4:1mab\x1b[24m", "\x1b[4mcd"],
		textRows: ["    ", " \x1b[4m\x1b[4:0;4:1mab\x1b[24m ", " \x1b[4mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[4m\x1b[4:0;4:1mab\x1b[24m \x1b[49m", "\x1b[44m \x1b[4mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline reenabled: \"ab cd\"",
		text: "\x1b[4m\x1b[4:0;4:1mab cd",
		wrapper: ["\x1b[4m\x1b[4:0;4:1mab\x1b[24m", "\x1b[4mcd"],
		textRows: ["    ", " \x1b[4m\x1b[4:0;4:1mab\x1b[24m ", " \x1b[4mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[4m\x1b[4:0;4:1mab\x1b[24m \x1b[49m", "\x1b[44m \x1b[4mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "colon underline reenabled: \"ab\\ncd\"",
		text: "\x1b[4m\x1b[4:0;4:1mab\ncd",
		wrapper: ["\x1b[4m\x1b[4:0;4:1mab", "\x1b[4mcd"],
		textRows: ["    ", " \x1b[4m\x1b[4:0;4:1mab ", " \x1b[4mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[4m\x1b[4:0;4:1mab \x1b[49m", "\x1b[44m \x1b[4mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty trailing parameter: \"abcd\"",
		text: "\x1b[7;31;mabcd",
		wrapper: ["\x1b[7;31;mab", "\x1b[7;31mcd"],
		textRows: ["    ", " \x1b[7;31;mab ", " \x1b[7;31mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;31;mab \x1b[49m", "\x1b[44m \x1b[7;31mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty trailing parameter: \"ab cd\"",
		text: "\x1b[7;31;mab cd",
		wrapper: ["\x1b[7;31;mab", "\x1b[7;31mcd"],
		textRows: ["    ", " \x1b[7;31;mab ", " \x1b[7;31mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;31;mab \x1b[49m", "\x1b[44m \x1b[7;31mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty trailing parameter: \"ab\\ncd\"",
		text: "\x1b[7;31;mab\ncd",
		wrapper: ["\x1b[7;31;mab", "\x1b[7;31mcd"],
		textRows: ["    ", " \x1b[7;31;mab ", " \x1b[7;31mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;31;mab \x1b[49m", "\x1b[44m \x1b[7;31mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty middle parameter: \"abcd\"",
		text: "\x1b[7;;1;44mabcd",
		wrapper: ["\x1b[7;;1;44mab", "\x1b[1;7;44mcd"],
		textRows: ["    ", " \x1b[7;;1;44mab ", " \x1b[1;7;44mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;;1;44mab \x1b[49m", "\x1b[44m \x1b[1;7;44mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty middle parameter: \"ab cd\"",
		text: "\x1b[7;;1;44mab cd",
		wrapper: ["\x1b[7;;1;44mab", "\x1b[1;7;44mcd"],
		textRows: ["    ", " \x1b[7;;1;44mab ", " \x1b[1;7;44mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;;1;44mab \x1b[49m", "\x1b[44m \x1b[1;7;44mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty middle parameter: \"ab\\ncd\"",
		text: "\x1b[7;;1;44mab\ncd",
		wrapper: ["\x1b[7;;1;44mab", "\x1b[1;7;44mcd"],
		textRows: ["    ", " \x1b[7;;1;44mab ", " \x1b[1;7;44mcd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;;1;44mab \x1b[49m", "\x1b[44m \x1b[1;7;44mcd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty with colon foreground: \"abcd\"",
		text: "\x1b[7;38:2::7:8:9;mabcd",
		wrapper: ["\x1b[7;38:2::7:8:9;mab", "cd"],
		textRows: ["    ", " \x1b[7;38:2::7:8:9;mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;38:2::7:8:9;mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty with colon foreground: \"ab cd\"",
		text: "\x1b[7;38:2::7:8:9;mab cd",
		wrapper: ["\x1b[7;38:2::7:8:9;mab", "cd"],
		textRows: ["    ", " \x1b[7;38:2::7:8:9;mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;38:2::7:8:9;mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty with colon foreground: \"ab\\ncd\"",
		text: "\x1b[7;38:2::7:8:9;mab\ncd",
		wrapper: ["\x1b[7;38:2::7:8:9;mab", "cd"],
		textRows: ["    ", " \x1b[7;38:2::7:8:9;mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;38:2::7:8:9;mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty with colon background: \"abcd\"",
		text: "\x1b[7;48:2::7:8:9;;mabcd",
		wrapper: ["\x1b[7;48:2::7:8:9;;mab", "cd"],
		textRows: ["    ", " \x1b[7;48:2::7:8:9;;mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;48:2::7:8:9;;mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty with colon background: \"ab cd\"",
		text: "\x1b[7;48:2::7:8:9;;mab cd",
		wrapper: ["\x1b[7;48:2::7:8:9;;mab", "cd"],
		textRows: ["    ", " \x1b[7;48:2::7:8:9;;mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;48:2::7:8:9;;mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
	{
		name: "empty with colon background: \"ab\\ncd\"",
		text: "\x1b[7;48:2::7:8:9;;mab\ncd",
		wrapper: ["\x1b[7;48:2::7:8:9;;mab", "cd"],
		textRows: ["    ", " \x1b[7;48:2::7:8:9;;mab ", " cd ", "    "],
		backgroundRows: ["\x1b[44m    \x1b[49m", "\x1b[44m \x1b[7;48:2::7:8:9;;mab \x1b[49m", "\x1b[44m cd \x1b[49m", "\x1b[44m    \x1b[49m"],
	},
];

describe("pinned ANSI renderer parity", () => {
	for (const { name, text, wrapper, textRows, backgroundRows } of pinnedRows) {
		it(name, () => {
			assert.deepEqual(wrapTextWithAnsi(text, 2), wrapper);
			const trace: WrapTraceRow[] = [];
			assert.deepEqual(wrapTextWithAnsi(text, 2, trace), wrapper);
			assert.equal(trace.length, wrapper.length);
			// Text always enables tracing for its copy sidecar; rows must still match the pinned renderer.
			const component = new Text(text, 1, 1);
			assert.deepEqual(component.render(4), textRows);
			assert.deepEqual(component.render(4), textRows);
			assert.deepEqual(new Text(text, 1, 1, (line) => `\x1b[44m${line}\x1b[49m`).render(4), backgroundRows);
		});
	}
});
