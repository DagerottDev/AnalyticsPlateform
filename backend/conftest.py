"""Isolate test signing configuration before application modules are imported."""

import os

os.environ["JWT_SECRET"] = "testing-only-signing-secret-for-isolated-tests"
