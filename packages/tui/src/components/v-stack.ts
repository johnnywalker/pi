import { appendCopyParts, attachCopyParts, type CopyPart } from "../compact-copy.ts";
import { getLayoutNode } from "../layout-node.ts";
import { allocateStackSizes, Stack, type StackChild, type StackOptions, visibleStackEntries } from "./stack.ts";

export class VStack extends Stack {
	protected readonly layoutType = "vstack" as const;

	constructor(children: StackChild[] = [], options: StackOptions = {}) {
		super(children, options);
	}

	override render(width: number): string[] {
		const viewport = { width: Math.max(1, width), height: Number.MAX_SAFE_INTEGER };
		const entries = visibleStackEntries(this.entries, viewport);
		const rendered = entries.map((entry) => entry.component.render(viewport.width));
		const sizes = allocateStackSizes(
			entries,
			rendered.map((lines) => lines.length),
			undefined,
			this.gap,
		);
		const lines: string[] = [];
		const copyParts: CopyPart[] = [];
		// Height-dependent visibility and allocated/clipped children need a broader layout mapping policy.
		const simpleRows = this.entries.every((entry) => !entry.visible) && sizes.every((size, i) => size === rendered[i]!.length);
		for (let index = 0; index < entries.length; index++) {
			if (index > 0) {
				for (let gap = 0; gap < this.gap; gap++) lines.push("");
			}
			if (simpleRows && getLayoutNode(entries[index]!.component)?.type !== "scroll") {
				appendCopyParts(copyParts, rendered[index]!, lines.length);
			}
			const childLines = rendered[index]!.slice(0, sizes[index]);
			lines.push(...childLines);
			for (let padding = childLines.length; padding < sizes[index]!; padding++) lines.push("");
		}
		if (copyParts.length > 0) attachCopyParts(lines, copyParts);
		return lines;
	}
}

export type { StackChild, StackEntry, StackEntryOptions, StackOptions } from "./stack.ts";
