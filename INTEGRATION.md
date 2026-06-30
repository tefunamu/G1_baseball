# ⚾ G2 BASEBALL — 合流仕様書（チーム配布用）

あなたの担当パーツは、**この2つのURLを叩くだけ**でゲームに合流できます。
中身（判定・表示）は気にしなくてOK。HTTPでPOSTするだけ。

- ゲームサーバーの場所（ゲームを動かすPC）= `http://YOUR_SERVER_IP:3457`
  - `YOUR_SERVER_IP` は**サーバーを動かすマシンのアドレスに置き換える**。確認方法:
    - Tailscale内（再起動でも不変・推奨）→ サーバー側で `tailscale ip -4`
    - 同じWi-Fi(LAN) → サーバー側で `ipconfig getifaddr en0`（DHCPで変わる可能性あり）
  - 同じマシン上のテストなら `http://localhost:3457`
- 認証なし（LAN/Tailscale内専用の想定）。CORS開放済（Webページから直接叩けます）。

---

## 🟢 スイング検出担当（スマホ等）→ `POST /swing`
プレイヤーが**バットを振った瞬間**に、これを1回叩いてください。

```
POST http://YOUR_SERVER_IP:3457/swing
Content-Type: application/json

（ボディ空でOK。サーバー受信時刻で判定します）
```
- 任意で、振った正確な時刻を送りたい場合のみ:
  ```json
  { "t": 1782803832796 }   // エポックms（省略時はサーバー到着時刻を使用）
  ```
- 返り値の例:
  ```json
  { "ok": true, "result": "homerun", "diff": 39 }
  // result = homerun / hit / foul / swing_miss / (投球前なら ok:false, reason:"no_pitch")
  // diff = 到達時刻との差ms（- が早い / + が遅い）
  ```

curlで動作確認:
```
curl -X POST http://YOUR_SERVER_IP:3457/swing
```

JS（スマホのWebページから）例:
```js
// 加速度センサーで「振った」と判定した瞬間に↓を呼ぶだけ
fetch('http://YOUR_SERVER_IP:3457/swing', { method:'POST' });
```

> ⏱ 精度メモ：BT表示＋通信の遅延があるので、ミリ秒精密ではなく「振った瞬間に即叩く」だけでOK。
> 判定窓は広め（perfect±150ms / hit±350ms / foul±600ms）。当日キャリブレーションで調整します。

---

## 🤖 ピッチャー＝Unitree G1（当日）→ `POST /pitch`
ロボが**ボールを離した瞬間**に、これを1回叩いてください。

```
POST http://YOUR_SERVER_IP:3457/pitch
Content-Type: application/json

{ "speed": "normal" }   // "slow"(2.0s) / "normal"(1.6s) / "fast"(1.2s)
```
- `speed` 省略時は `normal`。
- 返り値:
  ```json
  { "ok": true, "arrival": 1782803832757, "flight": 1600 }
  // ok:false, reason:"busy" は前の投球がまだ進行中（投げ直し不要）
  ```

curl:
```
curl -X POST http://YOUR_SERVER_IP:3457/pitch -H 'Content-Type: application/json' -d '{"speed":"normal"}'
```

Python（G1のSDKスクリプトから）例:
```python
import urllib.request, json
def pitch(speed="normal"):
    req = urllib.request.Request(
        "http://YOUR_SERVER_IP:3457/pitch",
        data=json.dumps({"speed": speed}).encode(),
        headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=3)
# 投球モーションでボールを離す瞬間に pitch() を呼ぶ
```

---

## 補助エンドポイント（デバッグ用）
- `GET /` … ブラウザ用テスト台（PITCH/SWINGボタン＋スコア表示）
- `GET /state` … 現在の状態とスコア `{active, last, score}`
- `GET /health` … `{ok:true}`
- `POST /reset` … スコア初期化

## 流れ（全体）
```
G1 →POST /pitch→ [サーバー] →Even G2に「迫るボール→打て!」表示
スマホ →POST /swing→ [サーバー] 判定 →Even G2に「ホームラン!/空振り…」＋スコア
```
