"""Offline regression tests: never call Claude or connect to the database."""
import json
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("ANTHROPIC_API_KEY", "test-placeholder")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routers import writing

REFERENCE = {
    "id": "exp-notice", "name": "Planned Shutdown Notices", "version": "1.2",
    "status": "approved", "owner": "Tenant Relations Lead",
    "summary": "Coordinate shutdown notices with the duty team.",
    "whenToUse": "Before a planned interruption.",
    "knowledge": ["Give tenants the approved next update time."],
    "decisionLogic": ["Confirm the affected services before issuing a notice."],
    "guardrails": ["Never promise compensation."],
    "escalation": ["Escalate unresolved timing to the Facility Manager."],
}


def request(mode="summary"):
    return {"mode": mode, "expertise": [dict(REFERENCE)], "instructions": "Draft a tenant notice" if mode == "email" else "", "sender": "Employee", "recipient": "Tenant", "tone": "professional"}


def output(mode="summary"):
    return {
        "summary": "Confirm affected services and do not promise compensation." if mode == "summary" else "",
        "email": {"subject": "Planned interruption", "body": "Hi Tenant,\nThe planned interruption is on [date].\nBest regards,\nEmployee"} if mode == "email" else None,
        "citations": [{"expertiseId": "exp-notice", "version": "1.2", "excerpt": "Never promise compensation."}],
        "missingInformation": ["Confirm the interruption date."],
    }


app = FastAPI()
app.include_router(writing.router)


class WritingTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.configured = patch.object(writing.claude, "is_configured", return_value=True)
        self.configured.start()
        self.addCleanup(self.configured.stop)

    def generate(self, payload, result):
        async def fake_stream(model, system, messages, *, max_tokens):
            self.assertEqual(model, "claude-sonnet")
            self.assertEqual(max_tokens, 6000)
            context = json.loads(messages[0]["content"])
            self.assertEqual(context["expertise"][0]["summary"], REFERENCE["summary"])
            self.assertIn("guardrails", system)
            raw = json.dumps(result)
            yield "delta", {"text": raw[:20]}
            yield "delta", {"text": raw[20:]}
            yield "done", {"stopReason": "end_turn", "model": "test"}
        with patch.object(writing.claude, "stream_reply", fake_stream):
            return self.client.post("/api/writing/generate", json=payload)

    def test_summary_and_email(self):
        for mode in ["summary", "email"]:
            with self.subTest(mode=mode):
                response = self.generate(request(mode), output(mode))
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), output(mode))

    def test_unapproved_references_never_reach_model(self):
        for status in ["draft", "in_review", "deprecated"]:
            payload = request()
            payload["expertise"][0]["status"] = status
            with patch.object(writing.claude, "stream_reply") as model:
                self.assertEqual(self.client.post("/api/writing/generate", json=payload).status_code, 422)
                model.assert_not_called()

    def test_input_bounds(self):
        cases = [
            {**request(), "expertise": []},
            {**request(), "expertise": [REFERENCE, REFERENCE]},
            {**request(), "expertise": [{**REFERENCE, "id": str(i)} for i in range(11)]},
            {**request(), "instructions": "x" * 4001},
            {**request(), "expertise": [{**REFERENCE, "summary": "x" * 100001}]},
            {**request("email"), "instructions": "   "},
            {**request(), "mode": "send_email"},
            {**request(), "expertise": [{**REFERENCE, "summary": "", "whenToUse": "", "knowledge": [], "decisionLogic": [], "guardrails": [], "escalation": []}]},
        ]
        for payload in cases:
            self.assertEqual(self.client.post("/api/writing/generate", json=payload).status_code, 422)

    def test_unknown_and_invented_citations_are_rejected(self):
        for patch_values in [{"expertiseId": "unknown"}, {"version": "99"}, {"excerpt": "Refund the tenant $500."}, {"excerpt": "   "}]:
            result = output()
            result["citations"][0].update(patch_values)
            self.assertEqual(self.generate(request(), result).status_code, 502)
        result = output()
        result["citations"] = []
        self.assertEqual(self.generate(request(), result).status_code, 502)

    def test_mode_mismatch_is_rejected(self):
        self.assertEqual(self.generate(request("email"), output("summary")).status_code, 502)
        self.assertEqual(self.generate(request("summary"), output("email")).status_code, 502)

    def test_unconfigured_backend(self):
        with patch.object(writing.claude, "is_configured", return_value=False):
            self.assertEqual(self.client.post("/api/writing/generate", json=request()).status_code, 503)

    def test_model_error_is_reported(self):
        async def error_stream(*args, **kwargs):
            yield "error", {"message": "Request declined."}
        with patch.object(writing.claude, "stream_reply", error_stream):
            response = self.client.post("/api/writing/generate", json=request())
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "Request declined.")


if __name__ == "__main__":
    unittest.main()
