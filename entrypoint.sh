#!/bin/bash
exec /root/.opencode/bin/opencode serve --port "${PORT_OPENCODE:-4096}" --hostname "0.0.0.0"