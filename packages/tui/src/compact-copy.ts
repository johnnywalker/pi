// Experimental compact copy provenance for simple vertically composed transcript rows.
import {
	extractAnsiCode,
	getActiveInverseAnsi,
	getGraphemeSegmenter,
	stripTerminalSequences,
	visibleWidth,
	type WrapTraceRow,
} from "./utils.ts";

/** Immutable canonical rendered text revision, owned by one producer block. */
export interface CopyBlock {
	readonly text: string;
}

/** One contiguous visible region, not one record per grapheme. */
export interface CopyRun extends WrapTraceRow {
	paint: string;
	x0: number;
	x1: number;
	continuity: number;
}

export interface CopyRows {
	source: CopyBlock;
	runs: (CopyRun | undefined)[];
	/** Original presentation-only rows, so mutation does not silently discard content. */
	spacingPaint?: readonly string[];
}

export interface CopyPart {
	rowStart: number;
	rows: CopyRows;
}

export interface CopyPoint {
	row: number;
	column: number;
}

export interface CopyMask {
	row: number;
	x0: number;
	x1: number;
}

export interface CopyResolution {
	text: string;
	masks: CopyMask[];
}

const provenance = new WeakMap<readonly string[], readonly CopyPart[]>();

/** Attach producer-owned descriptors without traversing or copying their rows. */
export function attachCopyParts(lines: readonly string[], parts: readonly CopyPart[]): void {
	provenance.set(lines, parts);
}

/** Inspect the experimental sidecar; cached render arrays keep the same descriptor identity. */
export function getCopyParts(lines: readonly string[]): readonly CopyPart[] | undefined {
	return provenance.get(lines);
}

/** Whether a queried row still matches its canonical content descriptor. */
export function isMappedCopyRow(lines: readonly string[], row: number): boolean {
	const part = findPart(provenance.get(lines), row);
	const run = part?.rows.runs[row - part.rowStart];
	return run !== undefined && sameCopyPaint(lines[row], run.paint);
}

/** Whether a queried content or presentation-only row still matches its producer descriptor. */
export function isTrustedCopyRow(lines: readonly string[], row: number): boolean {
	const part = findPart(provenance.get(lines), row);
	if (!part) return false;
	const index = row - part.rowStart;
	const paint = part.rows.runs[index]?.paint ?? part.rows.spacingPaint?.[index];
	return paint !== undefined && sameCopyPaint(lines[row], paint);
}

/** Append sidecars for an unchanged vertical child without copying its row descriptors. */
export function appendCopyParts(parts: CopyPart[], lines: readonly string[], rowStart: number): void {
	for (const part of provenance.get(lines) ?? []) {
		parts.push({ rowStart: rowStart + part.rowStart, rows: part.rows });
	}
}

/** Resolve only selected rows; clipboard intervals and margin-free masks share this result. End is exclusive. */
export function resolveCopy(
	lines: readonly string[],
	start: CopyPoint,
	end: CopyPoint,
	mode: "character" | "row" = "character",
	fallback?: (row: number, left: number, right: number) => CopyResolution,
): CopyResolution {
	if (start.row > end.row || (start.row === end.row && start.column > end.column)) {
		[start, end] = [end, start];
	}
	if (mode === "character" && start.row === end.row && start.column === end.column) {
		return { text: "", masks: [] };
	}
	const parts = provenance.get(lines);
	const masks: CopyMask[] = [];
	const chunks: string[] = [];
	let previous: { source: CopyBlock; part: CopyPart; continuity: number; end: number; row: number } | undefined;
	for (let row = Math.max(0, start.row); row <= Math.min(lines.length - 1, end.row); row++) {
		const left = mode === "row" || row !== start.row ? 0 : start.column;
		const right = mode === "row" || row !== end.row ? Infinity : end.column;
		const part = findPart(parts, row);
		const run = part?.rows.runs[row - part.rowStart];
		// The mutable render array is the trust boundary; marker/style decorations do not change its cells.
		if (run && sameCopyPaint(lines[row], run.paint) && part) {
			const source = part.rows.source;
			const connected = previous?.source === source && previous.part === part && previous.continuity === run.continuity && previous.row + 1 === row;
			// An exclusive endpoint at the next content start selects the boundary, not that row's glyphs/newline.
			if (mode === "character" && row === end.row && right <= run.x0) {
				if (connected && previous) chunks.push(source.text.slice(previous.end, run.visibleStart));
				break;
			}
			const x0 = Math.max(left, run.x0);
			const x1 = Math.min(right, run.x1);
			const empty = run.visibleStart === run.visibleEnd;
			if ((x1 <= x0 && !empty) || (empty && (left > run.x0 || right < run.x0))) {
				// A start beyond the last glyph can still own the following hard/soft boundary.
				previous = row === start.row && left >= run.x1
					? { source, part, continuity: run.continuity, end: run.visibleEnd, row }
					: undefined;
				continue;
			}
			const fragment = source.text.slice(run.visibleStart, run.visibleEnd);
			const range = endpointRange(fragment, Math.max(0, x0 - run.x0), Math.max(0, x1 - run.x0), run.x1 - run.x0);
			const from = mode === "row" || (left <= run.x0 && row === start.row) ? run.anchorStart : run.visibleStart + range.start;
			const to = mode === "row" ? run.anchorEnd : run.visibleStart + range.end;
			if (connected && previous) {
				chunks.push(source.text.slice(previous.end, from));
			} else if (chunks.length > 0) {
				chunks.push("\n");
			}
			chunks.push(source.text.slice(from, to));
			if (range.x1 > range.x0) masks.push({ row, x0: run.x0 + range.x0, x1: run.x0 + range.x1 });
			previous = { source, part, continuity: run.continuity, end: to, row };
		} else if (!part || run || !isTrustedCopyRow(lines, row)) {
			// Unsupported or mutated row: live callers retain Pi's original row-copy/highlight policy.
			if (fallback) {
				const result = fallback(row, left, right);
				if (chunks.length > 0) chunks.push("\n");
				chunks.push(result.text);
				masks.push(...result.masks);
			} else {
				const plain = stripTerminalSequences(lines[row]).trimEnd();
				const width = visibleWidth(plain);
				const range = endpointRange(plain, Math.max(0, left), Math.max(0, Math.min(right, width)), width);
				if (chunks.length > 0) chunks.push("\n");
				chunks.push(plain.slice(range.start, range.end));
				if (range.x1 > range.x0) masks.push({ row, x0: range.x0, x1: range.x1 });
			}
			previous = undefined;
		} else {
			// A producer's spacing row is presentation-only and breaks canonical continuity.
			previous = undefined;
		}
	}
	return { text: chunks.join(""), masks };
}

/** Split on stripped grapheme boundaries, preserving original bytes and replaying inverse for the suffix. */
export function splitCopyMask(line: string, mask: CopyMask): { before: string; selected: string; after: string } {
	const plain = stripTerminalSequences(line);
	const range = endpointRange(plain, mask.x0, mask.x1, visibleWidth(plain));
	let rawStart = 0;
	let rawEnd = line.length;
	let offset = 0;
	let index = 0;
	while (index < line.length) {
		if (offset === range.start) rawStart = index;
		if (offset === range.end) {
			rawEnd = index;
			break;
		}
		const ansi = extractAnsiCode(line, index);
		if (ansi) {
			index += ansi.length;
		} else {
			offset++;
			index++;
		}
	}
	return {
		before: line.slice(0, rawStart),
		selected: line.slice(rawStart, rawEnd),
		// Both painters end their injected inverse with 27m; the untouched suffix must inherit the original state.
		after: getActiveInverseAnsi(line.slice(0, rawEnd)) + line.slice(rawEnd),
	};
}

/** Standalone experimental painter; the live path uses TuiAltScreen.applySelectionHighlight instead. */
export function paintCopyMask(line: string, mask: CopyMask): string {
	const { before, selected, after } = splitCopyMask(line, mask);
	let highlighted = "\x1b[7m";
	let index = 0;
	while (index < selected.length) {
		const ansi = extractAnsiCode(selected, index);
		if (ansi) {
			highlighted += ansi.code;
			if (ansi.code.endsWith("m")) highlighted += "\x1b[7m";
			index += ansi.length;
		} else {
			highlighted += selected[index++];
		}
	}
	return `${before}${highlighted}\x1b[27m${after}`;
}

// Compare only the queried row. SGR styles and OSC markers/links are decorations, not cursor/erase commands.
function sameCopyPaint(line: string, paint: string): boolean {
	if (line === paint) return true;
	let left = 0;
	let right = 0;
	while (true) {
		left = skipCopyDecorations(line, left);
		right = skipCopyDecorations(paint, right);
		if (left === line.length || right === paint.length) return left === line.length && right === paint.length;
		if (line[left++] !== paint[right++]) return false;
	}
}

function skipCopyDecorations(line: string, index: number): number {
	while (line[index] === "\x1b") {
		const ansi = extractAnsiCode(line, index);
		if (!ansi || !(ansi.code.startsWith("\x1b]") || /^\x1b\[[0-9;:]*m$/.test(ansi.code))) break;
		index += ansi.length;
	}
	return index;
}

function findPart(parts: readonly CopyPart[] | undefined, row: number): CopyPart | undefined {
	if (!parts) return undefined;
	let low = 0;
	let high = parts.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (parts[mid].rowStart <= row) low = mid + 1;
		else high = mid;
	}
	const part = parts[low - 1];
	return part && row < part.rowStart + part.rows.runs.length ? part : undefined;
}

function endpointRange(text: string, left: number, right: number, width: number): { start: number; end: number; x0: number; x1: number } {
	if (right <= left) return { start: 0, end: 0, x0: 0, x1: 0 };
	if (left === 0 && right >= width) return { start: 0, end: text.length, x0: 0, x1: width };
	if (/^[\x20-\x7e]*$/.test(text)) {
		const start = Math.min(text.length, left);
		const end = Math.min(text.length, right);
		return { start, end, x0: start, x1: end };
	}
	let start = text.length;
	let end = text.length;
	let x0 = 0;
	let x1 = 0;
	let column = 0;
	let found = false;
	for (const { segment, index } of getGraphemeSegmenter().segment(text)) {
		const width = visibleWidth(segment);
		if (column + width > left && column < right) {
			if (!found) {
				start = index;
				x0 = column;
				found = true;
			}
			end = index + segment.length;
			x1 = column + width;
		}
		column += width;
		if (column >= right) break;
	}
	return { start, end, x0, x1 };
}
