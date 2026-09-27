# IRM Platform Development Rules

## Working Scope

- Work on exactly one task at a time.
- Do not implement future phases or features unless explicitly requested.
- Keep the pre-alpha version intentionally small and simple.
- Do not modify files outside the scope of the current task.
- Do not refactor unrelated code.
- Inspect existing code and files before modifying them.
- Prefer simple, maintainable solutions over premature abstraction.
- Never silently change an architectural or product decision. Flag conflicts and request direction instead.

## Current Product Scope

The current pre-alpha scope is limited to:

- User accounts
- Authentication and sessions
- IRM membership requests and manual verification
- Modules
- Documents
- Announcements

The current deployment scope is only:

```text
FST Mohammedia
└── IRM
```

Future support for multiple universities and multiple communities is an architectural design constraint, not current functionality. Keep boundaries and data-model decisions adaptable to that future without implementing multi-university or multi-community features now.

## Technology Decisions

- The backend uses FastAPI, SQLAlchemy, Pydantic, Alembic, and PostgreSQL.
- The frontend uses Next.js, React, TypeScript, and Tailwind CSS.
- Browser authentication uses database-backed, HTTP-only sessions. Do not use JWT-based browser sessions.
- Local document files initially use filesystem storage behind a storage abstraction. Do not introduce S3, MinIO, or similar infrastructure unless explicitly requested.

## Security and Quality

- Keep security and authorization rules explicit.
- Enforce authorization on the backend; do not rely solely on frontend controls.
- After implementation tasks, run checks and tests appropriate to the changed scope.
