import assert from "node:assert/strict";
import { activate, detectImageMime, parseTags, queryFromUtterance } from "../dap_meme_vault/plugin.mjs";

assert.deepEqual(parseTags("축하, 박수 #축하\n성공"), ["축하", "박수", "성공"]);
assert.equal(queryFromUtterance("축하 짤 찾아줘"), "축하");
assert.equal(queryFromUtterance("meme 저장소 열어줘"), "");
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
const ctx = {
  host: {
    storage: {
      async getJson(key) { return json.get(key) ?? null; },
      async setJson(key, value) { json.set(key, structuredClone(value)); },
      async putBlob(bytes) { return bytes[0] === 0x89 ? "b".repeat(64) : blobId; },
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
console.log("✓ meme-vault helpers");
