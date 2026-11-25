import io
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

import notify


class NotificationTest(unittest.TestCase):
    def test_failure_retries_and_success_is_deduplicated(self):
        data = {
            "run": {
                "workflow": "pilgrimage-rd",
                "runId": "r",
                "title": "补给",
                "status": "completed",
            },
            "steps": [
                {
                    "name": "requirements-review-1",
                    "result": {"decision": "退回", "markdown": "缺少 AC"},
                }
            ],
        }
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.dict(
                os.environ, {"FEISHU_BOT_WEBHOOK": "https://example.invalid/bot"}
            ),
            patch.object(
                sys,
                "argv",
                [
                    "notify",
                    "--send",
                    "--ledger",
                    tmp + "/sent.sqlite",
                    "--page",
                    "https://example.invalid/page",
                ],
            ),
            patch.object(notify.urllib.request, "urlopen") as post,
        ):
            post.side_effect = [
                io.BytesIO(b'{"code":1}'),
                io.BytesIO(b'{"code":0}'),
                io.BytesIO(b'{"code":0}'),
            ]
            with (
                patch.object(sys, "stdin", io.StringIO(json.dumps(data))),
                self.assertRaises(RuntimeError),
            ):
                notify.main()
            for _ in range(2):
                with patch.object(sys, "stdin", io.StringIO(json.dumps(data))):
                    notify.main()
            self.assertEqual(post.call_count, 3)
            self.assertIn(
                "已归档", json.loads(post.call_args.args[0].data)["content"]["text"]
            )
