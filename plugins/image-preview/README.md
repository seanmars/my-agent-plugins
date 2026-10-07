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
| input 欄位 | `[Image #N]` 文字加上底線與顏色; 正上方的 band 出現 `Pasted [ Image #N ]` chip |
| chip | 點擊開關 hint 卡片, 一次只開一張 |
| `⤢` | 開啟 `image-preview` pane (fullscreen 且寬度 ≥ 110 欄時停靠在右側, 否則顯示在 prompt 上方) |
| `✕` | 關閉卡片 |

## 運作方式

- **圖片來源**: 已送出的圖片取自 `session.append` 的 image block. 草稿中的圖片在偵測到新的 `[Image #N]` 時, 從 clipboard 讀取一次. engine 不提供 composer 內的 pasted content.
- **解碼**: `scripts/image.ps1` 用 `System.Drawing` 解碼 PNG, JPEG, GIF 和 BMP, 並縮到 400px 以內.
- **繪製**: 使用 `Raster`, 每格一個 `▀`, 前景色和背景色各代表一個 pixel. 這個方法不需要 kitty graphics protocol, 所以 Windows Terminal 和 VS Code terminal 都能顯示.

## 限制

- 只支援 Windows (需要 `powershell.exe` 5.1).
- 只支援 terminal surface. 點擊 transcript 內的 chip 需要 fullscreen layout.
- 從檔案拖曳進來的圖片在送出前沒有 preview. 送出後在 transcript 中可以 preview.
- 從 `--resume` 載入的舊訊息沒有 chip, 因為載入不會觸發 `session.append`.

## 需求

- Claude Code ≥ 2.1.291
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`

## 開發

```bash
claude --plugin-dir ./plugins/image-preview --debug   # 存檔即 hot-reload
claude plugin validate ./plugins/image-preview
claude plugin test ./plugins/image-preview
```

`prompt.edit` 在 2.1.291 的 test kit 中無法觸發, 草稿流程需要手動測試.
