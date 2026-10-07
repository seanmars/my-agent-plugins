# image-preview

把貼上的圖片變成可點擊的 chip. 點擊後在 chip 下方跳出小 preview 卡片, 卡片右上角的 `⤢` 會在右側開啟大 preview pane.

```
> [Image #1] 這張圖哪裡怪怪的?
  ⎿ [ Image #1 ]
    ╭──────────────────────────────────────────────────╮
    │ Image #1 · 2433×1600                        ⤢ ✕ │
    │ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ │
    │ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ │
    ╰──────────────────────────────────────────────────╯
```

## 行為

| 位置 | 作用 |
|---|---|
| transcript | 帶圖片的 prompt 下方出現 `[ Image #N ]` chip |
| input 欄位 | 貼上後約 200ms, 正上方的 band 出現 `Pasted [ Image #N ]` chip; `[Image #N]` 文字在下一次按鍵後加上底線與顏色 |
| chip | 點擊開關 hint 卡片, 一次只開一張 |
| `⤢` | 開啟 `image-preview` pane (fullscreen 且寬度 ≥ 110 欄時停靠在右側, 否則顯示在 prompt 上方) |
| `✕` | 關閉卡片 |

## 運作方式

- **草稿的圖片**: 讀取 Claude Code 為每次貼上快取的檔案 `<temp>/<project>/<session>/images/<n>.<ext>`. `<temp>` 在 Windows 是 `%TEMP%\claude`, 在 macOS 和 Linux 是 `/tmp/claude-<uid>`, 設定 `CLAUDE_CODE_TMPDIR` 時改用它. 這個檔案就是實際附加的圖片, 所以從檔案拖曳的圖片也正確.
- **偵測草稿**: 貼上圖片不會觸發 `prompt.edit`, 所以每 200ms 用 `$.prompt.read()` 讀一次輸入框.
- **已送出的圖片**: 圖片內容取自 `session.append` 的 image block. 編號取自 transcript 該列的 `imagePasteIds`, 所以手打的 `[Image #N]` 不會讓編號標錯. transcript 寫入之前, 先用文字中的標記暫時命名.
- **解碼**: `scripts/image.py` 用 Pillow 解碼 PNG, JPEG, GIF (第一格), WebP 和 BMP, 並縮到 400px 以內. 腳本由 `uv run --script` 執行, Pillow 依賴宣告在腳本內 (PEP 723).
- **繪製**: 使用 `Raster`, 每格一個 `▀`, 前景色和背景色各代表一個 pixel. 這個方法不需要 kitty graphics protocol, 所以 Windows Terminal 和 VS Code terminal 也能顯示. 支援 24-bit color 的 terminal 顯示效果最好.

## 限制

- 只支援 terminal surface. 點擊 transcript 內的 chip 需要 fullscreen layout.
- 如果手打一個這個 session 貼過的舊編號, 草稿 preview 會顯示那張舊圖, 因為快取裡還有那個檔案. 送出後的 transcript 不受影響.
- 從 `--resume` 載入的舊訊息沒有 chip, 因為載入不會觸發 `session.append`.
- macOS 的快取路徑只在 test kit 中驗證過, 還沒有實機測試.

## 需求

- Claude Code ≥ 2.1.291
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`
- [uv](https://docs.astral.sh/uv/). 第一次解碼時, uv 會下載 Pillow, 需要網路.

## 開發

```bash
claude --plugin-dir ./plugins/image-preview --debug   # 存檔即 hot-reload
claude plugin validate ./plugins/image-preview
claude plugin test ./plugins/image-preview
uv run --script ./plugins/image-preview/scripts/image.py decode --path <image> | head -1
```

`prompt.edit` 在 2.1.291 的 test kit 中無法觸發, 所以 `[Image #N]` 的上色需要手動測試.
