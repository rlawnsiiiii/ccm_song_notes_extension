import { describe, expect, it } from "vitest";
import { cleanTitle, searchUrls } from "../src/music/title";

describe("cleanTitle", () => {
  it.each([
    ["[마커스워십] 주를 향한 노래 (인도자: 홍길동) | Official Live", { title: "주를 향한 노래", artist: "마커스워십" }],
    ["주 은혜임을 | 어노인팅 예배 실황 | ANOINTING WORSHIP", { title: "주 은혜임을" }],
    ["Hillsong Worship - What A Beautiful Name (Live)", { title: "What A Beautiful Name", artist: "Hillsong Worship" }],
    ["【제이어스】 예수 늘 함께 (Official M/V)", { title: "예수 늘 함께", artist: "제이어스" }],
    ["나는 믿네", { title: "나는 믿네" }],
  ])("%s", (raw, want) => {
    const c = cleanTitle(raw);
    expect(c.title).toBe(want.title);
    if ("artist" in want) expect(c.artist).toBe(want.artist);
  });
  it("keeps the leader as extra info", () => {
    expect(cleanTitle("[팀] 곡명 (홍길동 인도자)").extra).toContain("홍길동");
  });
  it("builds search links", () => {
    const u = searchUrls("주 은혜임을", "어노인팅");
    expect(u[0]!.url).toContain(encodeURIComponent("주 은혜임을 어노인팅 코드 악보"));
  });
});
