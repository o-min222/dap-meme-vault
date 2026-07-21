import assert from "node:assert/strict";
import { activate, detectImageMime, parseTags, queryFromUtterance, titleFromUtterance } from "../dap_meme_vault/plugin.mjs";

assert.deepEqual(parseTags("축하, 박수 #축하\n성공"), ["축하", "박수", "성공"]);
assert.equal(queryFromUtterance("축하 짤 찾아줘"), "축하");
assert.equal(queryFromUtterance("meme 저장소 열어줘"), "");
assert.equal(titleFromUtterance("월요일 출근이 싫은 고양이 짤 만들어줘"), "월요일 출근이 싫은 고양이");
assert.equal(titleFromUtterance("짤 하나 생성해줘"), "");
assert.equal(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
assert.equal(detectImageMime(new Uint8Array([1, 2, 3])), null);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const json = new Map();
const actions = new Map();
let paletteMessage = null;
let pasted = null;
const palettePosts = [];
const blobId = "a".repeat(64);
const palette = {
  destroyed: false,
  isDestroyed() { return this.destroyed; },
  close() { this.destroyed = true; },
  onMessage(callback) { paletteMessage = callback; },
  postMessage(message) { palettePosts.push(message); },
};
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PNG_BYTES_2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const spoken = [];
const imageGen = { next: PNG_BYTES, async generate() { return { bytes: this.next, mime: "image/png", name: "gen.png" }; } };
const ctx = {
  host: {
    bubble: { speak(text) { spoken.push(text); } },
    imageGen,
    storage: {
      async getJson(key) { return json.get(key) ?? null; },
      async setJson(key, value) { json.set(key, structuredClone(value)); },
      // 콘텐츠 해시 흉내: 길이가 다른 PNG는 서로 다른 blob이어야 dedup이 안 걸린다.
      async putBlob(bytes) { return bytes[0] !== 0x89 ? blobId : String(bytes.length % 10).repeat(64); },
      async blobUrl(id) { return `dap-blob://blob/test/${id}`; },
      async deleteBlob() {},
      async usage() { return { jsonKeys: json.size, blobBytes: 3 }; },
    },
    windows: { openPalette() { palette.destroyed = false; return palette; } },
    paste: { async pasteItem(item) { pasted = item; } },
  },
  actions: { registerAction(action) { actions.set(action.id, action.callback); } },
  commands: { addCommand() {} },
  radialMenu: { addItem() {} },
  shortcuts: { registerShortcut() {} },
};

activate(ctx);
assert.equal(actions.get("findMeme")({ text: "축하 짤 찾아줘" }), "'축하'에 맞는 짤을 열었어!");
paletteMessage({ type: "ready" });
await tick();
assert.equal(palettePosts.at(-1).query, "축하");
paletteMessage({ type: "addFile", title: "만세", tags: "축하, 성공", file: { name: "cheer.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff]) } });
await tick(); await tick();
assert.equal(json.get("memes-v1")[0].title, "만세");
paletteMessage({ type: "paste", id: blobId });
await tick(); await tick();
assert.deepEqual(pasted, { kind: "image", blobUrl: `dap-blob://blob/test/${blobId}` });
assert.equal(json.get("memes-v1")[0].useCount, 1);
assert.equal(palettePosts.filter((message) => message.type === "state").at(-1).items[0].useCount, 1);
paletteMessage({ type: "addFile", title: "승리", tags: "성공, 축하", file: { name: "victory.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) } });
await tick(); await tick();
assert.equal(json.get("memes-v1")[0].title, "승리");
assert.deepEqual(json.get("memes-v1")[0].tags, ["성공", "축하"]);

// AI 짤 생성: 즉시 ack → 백그라운드 생성 → vault 저장 + 말풍선 알림.
const ack = actions.get("generateMeme")({ text: "월요일 출근이 싫은 고양이 짤 만들어줘" });
assert.match(ack, /만들어볼게/);
await tick(); await tick(); await tick(); await tick();
assert.equal(json.get("memes-v1")[0].title, "월요일 출근이 싫은 고양이");
assert.deepEqual(json.get("memes-v1")[0].tags, ["생성"]);
assert.match(spoken.at(-1), /다 만들었어/);

// 팔레트의 'AI 생성' 버튼: generate 메시지 → 같은 경로로 생성·저장 (제목/태그는 다이얼로그 값 우선).
imageGen.next = PNG_BYTES_2;
paletteMessage({ type: "generate", prompt: "퇴근하고 싶은 강아지 짤", title: "", tags: "퇴근, 강아지" });
await tick(); await tick(); await tick(); await tick();
assert.equal(json.get("memes-v1")[0].title, "퇴근하고 싶은 강아지");
assert.deepEqual(json.get("memes-v1")[0].tags, ["퇴근", "강아지"]);
assert.ok(palettePosts.some((message) => message.type === "notice" && /만들어볼게/.test(message.message)));
assert.match(spoken.at(-1), /다 만들었어/);

// imageGen 미지원 호스트(구버전 DAP)에서는 안내만 하고 아무것도 하지 않는다.
const bareActions = new Map();
activate({
  ...ctx,
  host: { ...ctx.host, imageGen: undefined },
  actions: { registerAction(action) { bareActions.set(action.id, action.callback); } },
});
assert.match(bareActions.get("generateMeme")({ text: "짤 만들어줘" }), /업데이트/);
console.log("✓ meme-vault helpers");
