"""从工作流快照提取飞书提醒。默认仅预览，可由团队定时任务调用。"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import sqlite3
import sys
import time
import urllib.request


def events(record):
    run = record["run"]
    if run["workflow"] != "pilgrimage-rd":
        raise ValueError("仅支持 pilgrimage-rd")
    for s in record["steps"]:
        result = s["result"]
        if isinstance(result, dict) and result.get("decision") == "退回":
            yield s["name"], f"{s['name']} 评审退回\n{result['markdown']}"
    if run["status"] in ("paused", "stopped", "cancelled"):
        yield run["updatedAt"], f"流程需要关注：{run['detail'] or run['status']}"
    elif run["status"] == "completed":
        yield "completed", "研发协作已完成，PRD、技术方案和测试用例已归档。"


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--send", action="store_true", help="向已配置的飞书群发送")
    args.add_argument("--ledger", help="该群专用的本地投递记录数据库")
    args.add_argument("--page", required=True, help="成员可访问的协作页面地址")
    opts = args.parse_args()
    if opts.send and not (opts.ledger and os.getenv("FEISHU_BOT_WEBHOOK")):
        args.error("发送需要 --ledger 和 FEISHU_BOT_WEBHOOK")
    record = json.load(sys.stdin)
    run = record["run"]
    for key, message in events(record):
        payload = {
            "msg_type": "text",
            "content": {"text": f"{run['title']}\n{message}\n{opts.page}"},
        }
        if not opts.send:
            print(json.dumps(payload, ensure_ascii=False))
            continue
        with sqlite3.connect(opts.ledger, timeout=30) as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS sent (run TEXT, event TEXT, PRIMARY KEY(run,event))"
            )
            db.execute("BEGIN IMMEDIATE")
            if db.execute(
                "SELECT 1 FROM sent WHERE run=? AND event=?", (run["runId"], key)
            ).fetchone():
                continue
            secret = os.getenv("FEISHU_BOT_SECRET")
            if secret:
                timestamp = str(int(time.time()))
                signature = hmac.digest(
                    f"{timestamp}\n{secret}".encode(), b"", hashlib.sha256
                )
                payload.update(
                    timestamp=timestamp, sign=base64.b64encode(signature).decode()
                )
            request = urllib.request.Request(
                os.environ["FEISHU_BOT_WEBHOOK"],
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=10) as response:
                reply = json.load(response)
            if reply.get("code") != 0:
                raise RuntimeError(f"飞书返回错误码 {reply.get('code')}")
            db.execute("INSERT INTO sent VALUES (?,?)", (run["runId"], key))


if __name__ == "__main__":
    main()
