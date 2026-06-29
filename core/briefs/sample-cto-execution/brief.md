# Brief: User Authentication System

## Feature / Vision

Build a complete user authentication system with email/password login, OAuth2 social login (Google, GitHub), session management, and role-based access control. This is the foundation for our SaaS platform's user management.

## Context

- Greenfield Next.js 15 application with PostgreSQL database
- No existing auth system -- this is the first implementation
- API layer uses tRPC with TypeScript
- Deployment target: Vercel (frontend) + Railway (database)
- Team is familiar with Prisma ORM

## Constraints

- 2-week timeline for MVP (email/password + Google OAuth)
- 3-person engineering team (1 senior, 2 mid-level)
- Must support multi-tenancy from day one (users belong to organizations)
- OWASP Top 10 compliance required
- No budget for third-party auth services (no Auth0, Clerk, etc.)

## Success Criteria

- Users can register, login, and reset passwords via email
- Google OAuth login works end-to-end
- Session tokens are httpOnly, secure, with proper expiry
- Role-based access control (admin, member, viewer) enforced at API layer
- All auth endpoints have rate limiting
- Integration tests cover all auth flows
