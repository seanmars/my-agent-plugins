# image-preview

把貼上的圖片變成可點擊的 chip. 點擊後用系統預設的圖片檢視器開啟原圖.

```
> [Image #1] 這張圖哪裡怪怪的?
  ⎿ [ Image #1 ]
```

## 行為

| 位置 | 作用 |
|---|---|
| transcript | 帶圖片的 prompt 下方出現 `[ Image #N ]` chip |
| input 欄位 | 貼上後約 200ms, 正上方的 band 出現 `Pasted [ Image #N ]` chip; `[Image #N]` 文字在下一次按鍵後加上底線與顏色 |
| chip | 點擊後用系統預設程式開啟原圖. 開啟失敗時顯示 toast |

## 運作方式

- **草稿的圖片**: 讀取 Claude Code 為每次貼上快取的檔案 `<temp>/<project>/<session>/images/<n>.<ext>`. `<temp>` 是 temp 根目錄下的 `claude` (Windows) 或 `claude-<uid>` (macOS 和 Linux). temp 根目錄是 `CLAUDE_CODE_TMPDIR`, 沒有設定時是系統的 temp 資料夾. 這個檔案就是實際附加的圖片, 所以從檔案拖曳的圖片也正確.
- **偵測草稿**: 貼上圖片不會觸發 `prompt.edit`, 所以每 200ms 用 `$.prompt.read()` 讀一次輸入框. 只有互動模式的 terminal session 才會啟動這個 timer.
- **已送出的圖片**: 圖片內容取自 `session.append` 的 image block. 編號取自 transcript 該列的 `imagePasteIds`, 所以手打的 `[Image #N]` 不會讓編號標錯. transcript 寫入之前, 先用文字中的標記暫時命名. 取得編號後, session state 改存快取檔案的路徑, 不再保存 base64. transcript 路徑取自 `classic.UserPromptSubmit` 和 `classic.SessionStart`.
- **開啟圖片**: `scripts/open_image.py` 在 Windows 用檔案的預設程式開啟, 在 macOS 用 `open`, 在 Linux 用 `xdg-open`. 沒有快取檔案的圖片先寫到系統 temp 資料夾下的 `claude-image-preview`.
- **輔助腳本**: `scripts/paste_ids.py` 從 transcript 檔尾往回讀取 `imagePasteIds`. 所有腳本都由 `uv run --script` 執行, 不需要額外套件.

## 限制

- 只支援 terminal surface. 點擊 transcript 內的 chip 需要 fullscreen layout.
- 如果手打一個這個 session 貼過的舊編號, 草稿 chip 會開啟那張舊圖, 因為快取裡還有那個檔案. 送出後的 transcript 不受影響.
- 從 `--resume` 載入的舊訊息沒有 chip, 因為載入不會觸發 `session.append`.
- macOS 的快取路徑只在 test kit 中驗證過, 還沒有實機測試.

## 需求

- Claude Code ≥ 2.1.291
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`
- [uv](https://docs.astral.sh/uv/)

## 開發

```bash
claude --plugin-dir ./plugins/image-preview --debug   # 存檔即 hot-reload
claude plugin validate ./plugins/image-preview
claude plugin test ./plugins/image-preview
uv run --script ./plugins/image-preview/scripts/paste_ids.py --path <transcript.jsonl> --uuid <row uuid>
uv run --script ./plugins/image-preview/scripts/open_image.py --path <image>
```

`prompt.edit` 在 2.1.291 的 test kit 中無法觸發, 所以 `[Image #N]` 的上色需要手動測試.
