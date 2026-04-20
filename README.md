# LOG 結構比對（front-log-compare）

此工具用於比對兩份 `front-log-checker` 匯出的 `JSON(原始)` 檔案。

## 使用方式

1. 在 QA Tools Hub 切到「LOG 結構比對」。
2. 分別上傳舊版與新版 `JSON(原始)`。
3. 選擇匹配鍵（預設 `function_name + event`）。
4. 預設僅比對有 `function_name` 的資料；可視需要取消此條件。
5. 視需要勾選外層欄位比對並填入欄位名稱。
6. 點擊「開始比對」查看 PASS/WARN/FAIL。
7. 差異結果分頁顯示（全部明細 / 整組缺失 / jsondata 結構差異 / 外層差異）。
8. `jsondata 結構差異` 分頁採收合卡片，預設展開，可看每個 path 的比對結果（含 PASS）與舊/新版樣本值，根節點顯示為 `jsondata(根節點)`。
9. `外層差異` 分頁也採收合卡片，預設展開，可查看每個外層欄位的比對結果（含 PASS）與舊/新版樣本值。
10. 如需留存再點「下載差異 CSV」。

## 判定規則（v1）

- 固定比對 `jsondata` 的 path/type。
- 缺欄位：`FAIL`
- 型別改變：`FAIL`
- 多欄位：`WARN`
- 支援忽略欄位（預設：`timestamp,_capturedAt,trace_id,token,host`）。
