# LOG 結構比對（front-log-compare）

此工具用於比對兩份 `front-log-checker` 匯出的 `JSON(原始)` 檔案，並可獨立啟動，不依賴 `tools-hub`。

## 啟動方式

```bash
cd tools/front-log-compare
npm install
npm start
```

開啟：`http://localhost:3020`

## 使用方式

1. 分別上傳舊版與新版 `JSON(原始)`。
2. 選擇匹配鍵（預設 `function_name + event`）。
3. 預設僅比對有 `function_name` 的資料；可視需要取消此條件。
4. 視需要勾選外層欄位比對並填入欄位名稱。
5. 點擊「開始比對」查看 PASS/WARN/FAIL。
6. 差異結果分頁顯示（全部明細 / 整組缺失 / jsondata 結構差異 / 外層差異）。
7. `jsondata 結構差異` 分頁採收合卡片，預設展開，可看每個 path 的比對結果（含 PASS）與舊/新版樣本值，根節點顯示為 `jsondata(根節點)`。
8. `外層差異` 分頁也採收合卡片，預設展開，可查看每個外層欄位的比對結果（含 PASS）與舊/新版樣本值。
9. 如需留存再點「下載差異 CSV」。

## 判定規則（v1）

- 固定比對 `jsondata` 的 path/type。
- 缺欄位：`FAIL`
- 型別改變：`FAIL`
- 多欄位：`WARN`
- 支援忽略欄位（預設：`timestamp,_capturedAt,trace_id,token,host`）。
