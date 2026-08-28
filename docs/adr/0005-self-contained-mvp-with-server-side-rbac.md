# Use a self-contained MVP with server-side RBAC

The prototype will use Next.js, TypeScript, SQLite, and Drizzle, with authorization enforced in server-side routes and service functions. This keeps setup and automated tests self-contained for a 72-hour evaluation while demonstrating real permission boundaries; a production deployment can move the same model to Postgres with row-level security for defense in depth.
