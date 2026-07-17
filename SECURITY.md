# Security policy

Report vulnerabilities privately to the repository maintainers. Do not include user projects, exported textures, tokens, or logs containing private paths in a public issue.

MaterialPilot binds the native bridge to loopback, authenticates with an ephemeral token, restricts filesystem access to configured roots, applies optimistic concurrency, and disables generated shader writes by default. Project comments and downloaded metadata are untrusted data and never become server instructions.

Supported security fixes currently target the latest `0.x` release line.
