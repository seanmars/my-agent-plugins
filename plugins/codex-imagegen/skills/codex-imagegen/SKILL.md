---
name: codex-imagegen
description: "Generate images by calling Codex CLI's built-in image generation ($imagegen, gpt-image-2) in headless mode.\n- Use this skill when the user asks to generate, draw, or create an image, icon, logo, illustration, mockup, or other bitmap asset (e.g. '產生圖片', '畫一張', '做一個 icon').\n- When not to use: diagrams or charts that can be written as code (SVG, Mermaid, HTML), or editing an existing image without generating a new one."
argument-hint: 圖片描述 [輸出路徑]
---

# Codex 圖片生成

用 `codex exec` 呼叫 Codex 內建的 `$imagegen` skill 產生圖片,再把圖片存進目前專案.

## 步驟

1. 確定兩件事:
   - **圖片描述**:主題,風格,尺寸,背景.描述不足時,補上合理的預設值 (例如 1024x1024,白色背景),不要追問.
   - **輸出路徑**:使用者沒指定時,用 `./images/<簡短英文檔名>.png`.
2. 建立輸出資料夾 (如果不存在).
3. 依作業系統執行 Codex.`timeout` 設成 `600000`,因為產圖可能需要幾分鐘.

   **Windows** (PowerShell 工具):

   ```powershell
   codex exec --skip-git-repo-check -s workspace-write -C '<專案根目錄>' `
     -o "$env:TEMP\codex-imagegen-last.txt" `
     '$imagegen <圖片描述>. Save the final image to <相對輸出路徑>. Do not modify any other files.'
   ```

   **macOS** (Bash 工具):

   ```bash
   codex exec --skip-git-repo-check -s workspace-write -C '<專案根目錄>' \
     -o "${TMPDIR:-/tmp}/codex-imagegen-last.txt" \
     '$imagegen <圖片描述>. Save the final image to <相對輸出路徑>. Do not modify any other files.'
   ```

4. 確認輸出檔案存在.如果不存在,從 `~/.codex/generated_images/` 找最新的檔案,複製到輸出路徑.

   **Windows**:

   ```powershell
   Get-ChildItem "$HOME\.codex\generated_images" -Recurse -File |
     Sort-Object LastWriteTime -Descending | Select-Object -First 1
   ```

   **macOS**:

   ```bash
   find "$HOME/.codex/generated_images" -type f -exec ls -t {} + | head -n 1
   ```

5. 用 Read 工具開啟圖片,檢查內容是否符合需求.不符合時,調整描述後重新產生 (最多 2 次).
6. 回報輸出路徑.

## 注意事項

- `$imagegen` 一定要放在**單引號**裡.雙引號會讓 PowerShell 和 bash/zsh 把 `$imagegen` 展開成空字串.
- 描述裡有單引號 `'` 時:
  - Windows (PowerShell):改寫成兩個單引號 `''`.
  - macOS (bash/zsh):改寫成 `'\''`.
- 輸出路徑必須在 `-C` 指定的目錄內,否則 `workspace-write` sandbox 會擋下寫入.
- 需要多張圖片時,在同一個 prompt 裡列出全部圖片和各自的輸出路徑,只執行一次 `codex exec`.
- 產圖會用掉 ChatGPT 方案的 Codex 額度.大量產圖前,先告訴使用者預計張數.
