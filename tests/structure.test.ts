import { describe, expect, it } from "vitest";
import { findStructure, mergeSections, type BarInfo } from "../src/analysis/structure";

const bar = (i: number, chords: string[], energy: number): BarInfo => ({ startSec: i * 2, endSec: i * 2 + 2, chords, energy });

export function song(): BarInfo[] {
  const bars: BarInfo[] = [];
  let i = 0;
  const add = (prog: string[][], energy: number) => prog.forEach((c) => bars.push(bar(i++, c, energy)));
  const verse = [["7"], ["2"], ["4m"], ["0"], ["7"], ["2"], ["4m"], ["0"]];
  const chorus = [["0"], ["7"], ["2"], ["4m"], ["0"], ["7"], ["2"], ["2"]];
  const bridge = [["9m"], ["4m"], ["0"], ["2"], ["9m"], ["4m"], ["0"], ["2"]];
  add([["0"], ["0"], ["7"], ["7"]].slice(0, 0), 0.02);
  add(verse, 0.02);      // 전주 (instrumental, same as verse harmony)
  add(verse, 0.03);      // 1절
  add(chorus, 0.08);     // 후렴
  add(verse, 0.03);      // 2절
  add(chorus, 0.08);     // 후렴
  add(bridge, 0.05);     // 브릿지
  add(chorus, 0.09);     // 후렴
  return bars;
}

describe("structure", () => {
  it("finds repeated sections and names them", () => {
    const s = findStructure(song());
    expect(s.length).toBe(7);
    const labels = s.map((x) => x.label);
    expect(labels.filter((l) => l === "후렴").length).toBe(3);
    expect(labels).toContain("브릿지");
    expect(labels[1]).toBe("1절");
    expect(labels[3]).toBe("2절");
    expect(s[0]!.startSec).toBe(0);
    expect(s[6]!.endSec).toBe(112);
  });
  it("keeps user sections on re-analysis", () => {
    const detected = findStructure(song());
    const user = [{ startSec: 0, endSec: 16, group: "Z", label: "내 전주", source: "user" as const }];
    const m = mergeSections(user, detected);
    expect(m[0]!.label).toBe("내 전주");
    expect(m.length).toBe(detected.length);
  });
});

import { detectKeyChanges } from "../src/analysis/structure";
import { progressionFrames } from "./synth";

describe("key changes", () => {
  it("detects a whole-step modulation", () => {
    const g: [number, any, number | undefined, number][] = [[7, "maj", undefined, 2], [2, "maj", undefined, 2], [4, "min", undefined, 2], [0, "maj", undefined, 2]];
    const a: [number, any, number | undefined, number][] = [[9, "maj", undefined, 2], [4, "maj", undefined, 2], [6, "min", undefined, 2], [2, "maj", undefined, 2]];
    const frames = progressionFrames([...g, ...g, ...g, ...a, ...a, ...a]);
    const ch = detectKeyChanges(frames, { tonic: 7, mode: "major", confidence: 0.9 });
    expect(ch.length).toBe(1);
    expect(ch[0]!.tonic).toBe(9);
    expect(Math.abs(ch[0]!.atSec - 24)).toBeLessThan(8);
  });
  it("reports nothing for a steady key", () => {
    const g: [number, any, number | undefined, number][] = [[7, "maj", undefined, 2], [2, "maj", undefined, 2], [4, "min", undefined, 2], [0, "maj", undefined, 2]];
    expect(detectKeyChanges(progressionFrames([...g, ...g, ...g, ...g]), { tonic: 7, mode: "major", confidence: 0.9 })).toEqual([]);
  });
});
