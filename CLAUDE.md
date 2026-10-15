# Ruhuna IMS — Inventory Management System

## 1. Project purpose

Ruhuna IMS is the inventory and equipment-borrowing application for the Department of Electrical and Information Engineering (DEIE), Faculty of Engineering, University of Ruhuna. It is an existing prototype that is being hardened into a production-ready application.

**Do not start over or replace working features without a clear reason.** First understand the current implementation, identify risks and gaps, then make small, reviewable changes that preserve existing behavior and data unless a change is explicitly approved.

The system should provide traceability for:
- who requested an item;
- who reviewed and recommended/rejected the request;
- which exact physical unit (serial number) was issued;
- which authorized Technical Officer recorded the physical handover and return;
- when each event happened, and who recorded it;
- the condition of the item and any return exceptions.

The developer is a university lecturer who is learning production-grade application development. Explain important design choices in plain language, work incrementally, and do not silently make major policy or architecture decisions.

---

## 2. Hard constraints — read before making changes

### Deployment and network
- The intended deployment is on a University/department server and is accessible only through the university network/Wi-Fi. Do not expose a public endpoint.
- **Current constraint: intranet-only; do not add runtime dependencies on the public internet.** No CDN scripts, Google Fonts, analytics, OAuth providers, external APIs, or third-party email/SMS services unless the developer explicitly changes this constraint after confirming university approval and network/security requirements.
- The earlier proposal to use Resend for notifications is **not approved for implementation under the current constraint**. Do not add Resend or another external email service by assumption. In-app notifications should remain the dependable in-system channel. If email is reconsidered, first discuss an approved university SMTP/internal mail relay or an explicitly approved external provider, outbound-network rules, data disclosure, failure/retry behavior, and deployment configuration.
- Intranet-only does not eliminate the need for authentication, server-side authorization, HTTPS on the internal network where supported, secure session handling, database access controls, backups, patching, logging, and recovery planning.
- All runtime dependencies must be installed through the project package manager and bundled locally.

### Security and data
- Enforce authorization on the server for every protected read and mutation. Hiding UI controls is not authorization.
- Never commit secrets. `.env` is git-ignored. Never hardcode or print secrets. Remove insecure fallback secrets; fail safely if required secrets are missing.
- Do not log passwords, session tokens, TOTP secrets, one-time handover/return codes, or other credentials.
- Ask before destructive database actions, including `prisma migrate reset`, `db push --force-reset`, dropping columns/tables, deleting data, or rewriting migration history. Explain what could be lost first.
- Do not hard-delete inventory or transaction history merely to simplify a workflow. Prefer archival and traceable correction events.
- Treat data from the database, request payloads, and client as untrusted. Validate on the server.

### Change discipline
- Inspect the actual repository and current schema before editing. This file documents known implementation details, but source code and applied migrations must be checked before relying on an assumption.
- Make one focused change at a time. Explain the purpose and list the files changed.
- Preserve unrelated existing features and UI patterns.
- Do not silently add dependencies, change the auth model, rename roles, alter deployment assumptions, or make policy decisions.
- Before finishing, run `npm run build` (or an appropriate type check if a full build cannot run), and relevant tests. Report commands and results honestly.
- Use Windows PowerShell-compatible commands when giving local development instructions.

---

## 3. Current technical stack

Known from the existing prototype; verify the repository before changing versions or APIs.

- Next.js App Router with TypeScript and React
- Tailwind CSS
- Prisma 6.x with PostgreSQL (`prisma-client-js`)
- Custom JWT sessions using `jose` (HS256)
- Password hashing with `bcryptjs`
- Optional TOTP 2FA using `otplib` v13 and `qrcode`
- SweetAlert2 for UI alerts
- Mutations implemented as Next.js server actions in `actions/*.ts` (`'use server'`)

### Common commands

```powershell
npm run dev
npm run build
npx prisma generate
npx prisma migrate dev --name <short_description>
npx prisma migrate deploy
npx prisma db seed
npx prisma studio
```

Use `prisma migrate dev` for schema changes during development and commit the generated migration. Use `prisma migrate deploy` to apply existing migrations in a deployment environment. Do not use `prisma db push` as the normal schema workflow. Do not reset a database without explicit approval.

Environment variables currently documented:
- `DATABASE_URL`
- `JWT_SECRET`

`.env.example` should document variable names without real values.

---

## 4. Known repository layout

Confirm the real structure before editing. Known files/areas include:

```text
actions/        server actions: auth.ts, equipment.ts, borrow.ts, lab.ts, cron.ts
app/
  page.tsx
  login/
  register/
  dashboard/
    inventory/page.tsx
    borrow/page.tsx
    labs/page.tsx
    admin/users/page.tsx
    unauthorized/page.tsx
lib/
  auth.ts
  prisma.ts
prisma/
  schema.prisma
  seed.ts
  migrations/
```

Next.js 16 renamed `middleware.ts` to `proxy.ts`. Check which file exists and keep the actual supported structure; do not create a competing route-protection file.

---

## 5. Existing implementation — preserve and verify

These details describe the current prototype, not necessarily the final production design. Inspect the schema and implementation before changing them.

### Authentication and roles currently in code
- Current Prisma role values are `SUPER_ADMIN`, `LAB_STAFF`, and `BORROWER`. Use these exact values while they remain in the schema. Never casually substitute `ADMIN` or `SUPERADMIN`.
- Registration currently accepts emails ending in `@eie.ruh.ac.lk` or `@eng.ruh.ac.lk`.
- New registrations are `BORROWER`, `isApproved = false`, and cannot log in until approved by an authorized user.
- Seeded users have no password; registration with a seeded email initializes that account and auto-approves it. Review this behavior carefully before production because seeded-account initialization is security-sensitive.
- Session cookie is currently `ims_session`, marked `httpOnly`, with a 24-hour lifetime.
- Current session payload is `{ userId, email, name, role, twoFactorVerified }`.
- TOTP 2FA is optional per user. When enabled, a password login does not establish a fully verified session until the TOTP code is verified.
- The current implementation has a staff helper in `actions/borrow.ts` and a Super Admin helper in `actions/lab.ts`. Reuse/refactor consistently rather than creating conflicting authorization paths.

### Current permission model
- `BORROWER`: browse inventory, submit requests, see their own requests.
- `LAB_STAFF` and `SUPER_ADMIN`: currently have broad staff capabilities, including inventory management and borrow workflow actions.
- `SUPER_ADMIN`: currently manages labs and coordinators.
- These broad `LAB_STAFF` permissions do **not yet** express the proposed distinction between Laboratory Coordinators and Technical Officers, nor lab-scoped authorization. Do not claim that the production target is already enforced merely because the current role check passes.

### Current data model
- `Lab`: currently has `name`, `coordinators String[]`, and `instructors String[]`. The `coordinators` array stores **User IDs**; `instructors` stores plain-text names. Resolve coordinator IDs to users before display. This is a legacy shape to review, not a reason to keep an inflexible array forever.
- `Equipment`: a catalog/type row, with fields such as name, brand, model, remarks, and `labId`.
- `EquipmentUnit`: one individually tracked physical item with a unique `serialNumber`. Never confuse the catalog/type with a physical unit.
- Current `EquipmentUnit` fields include `status` (`AVAILABLE` / `ISSUED`), `condition` (`WORKING` / `DAMAGED` / `UNDER_REPAIR`), and `assetStatus` (`RECEIVED` / `NOT_RECEIVED`). Understand how all three are used before changing them.
- `BorrowLog`: a borrowing transaction/request. It has `userId` (borrower), `equipmentId` (requested equipment type), and `unitId` (specific unit, assigned at issue in the current model), plus audit fields such as `approvedById`, `issuedById`, `returnedById`, dates, `status`, and notes. Named user relations include `Borrower`, `ApprovedBy`, `IssuedBy`, and `ReturnedBy`.
- Legacy `Equipment.quantity` / `availableQuantity` columns may exist. They are documented as unused; counts should be computed from `EquipmentUnit` rows. Verify references before dropping them.
- Inventory currently shows one collapsed row per equipment type; staff can expand to physical units; borrowers do not see unit-level details.
- Adding a type matching an existing type in the same lab (case/whitespace-insensitive) currently merges units into that type. Staff can also use a `+Units` action.
- Serial numbers may currently be generated as placeholders and corrected by staff. Do not treat placeholder identifiers as verified real serial numbers.

### Current borrow lifecycle
The current code documents `PENDING → APPROVED → ISSUED → RETURNED`, with `REJECTED` and `OVERDUE` statuses. `checkAndUpdateOverdueLogs` in `actions/cron.ts` updates overdue logs. Inspect the implementation before changing status semantics.

- Issuing currently requires choosing a specific `EquipmentUnit` by serial number.
- Issue and return updates currently use `prisma.$transaction` and re-check unit state to prevent double issue. Preserve and strengthen this protection.
- `EquipmentUnit.status` is documented as changing only through the borrow workflow. Do not add an independent manual status editor that can create an issued unit without a corresponding active loan.
- Setting condition to `DAMAGED` or `UNDER_REPAIR` should remove the unit from the set eligible for issue.
- Server actions should return `{ success: true, data? }` or `{ success: false, error: string }`.
- After mutations, revalidate actual routes such as `/dashboard/inventory`, `/dashboard/borrow`, and `/dashboard/labs`.
- Client mutations currently use `useTransition` and `Swal.fire(...)`.

---

## 6. Agreed production business rules

These are the target rules agreed during design discussion. They may not yet exist in the code. Implement them incrementally, after checking how they map to the current schema.

### 6.1 People, roles, and laboratory assignments

The intended real-world responsibilities are:

- **Super Admin:** department-wide administration. Only this role creates/edits lab records, assigns or changes Laboratory Coordinators, and assigns/unassigns Technical Officers to/from labs.
- **Laboratory Coordinator:** academic staff responsible for reviewing and recommending/rejecting borrow requests for their assigned lab(s).
- **Technical Officer (TO):** non-academic staff responsible for physical issue and return operations for their assigned lab(s).
- **Borrower:** student or staff member who requests equipment and can view their own transactions.

A person must not hold both the Laboratory Coordinator and TO operational roles. A single account should represent one person; do not create duplicate accounts to model different lab assignments.

The current `LAB_STAFF` role does not adequately distinguish Coordinator from TO. Before implementation, inspect all role-dependent code and plan a safe migration. Do not simply rename `LAB_STAFF` or globally grant its existing permissions to both new roles. Preserve current users and access deliberately during migration.

**RBAC plus lab scope:**
- Role determines the kinds of actions a person may perform.
- Active assignment determines which lab(s) they may perform those actions in.
- For every protected operation, the server must validate the active account/session, role permission, active lab assignment, resource's lab, and valid current transaction/item state.
- A coordinator assigned to Lab A must not review requests for Lab B merely because they are a coordinator.
- A TO assigned to Lab A must not issue or complete returns for Lab B merely because they are a TO.
- Lab assignments and user account status are separate. Removing a TO from one lab unassigns them from that lab; it does not delete/deactivate the account or erase their history.
- Only Super Admin manages lab assignments. Preserve historical assignment context where it matters for audit.
- Every operational lab should have an assigned Coordinator and TO. A vacancy can exist administratively, but borrowing/issue operations should not proceed without the required responsible staff. Exact behavior for a temporary vacancy should be implemented transparently, not by routing to an unrelated staff member.
- Whether one Coordinator may cover multiple labs is awaiting confirmation from Dr. Iromi. Do not hard-code a one-coordinator-per-lab restriction until this policy is confirmed. TOs may be assigned to multiple labs when required.
- User account deactivation is a separate administrative action from removing a lab assignment.

### 6.2 Coordinator decisions and separation of duties

- Only the Coordinator assigned to the lab associated with the requested unit/equipment may review that request.
- Other Coordinators should not see or act on the request solely because they hold the Coordinator role.
- The Coordinator can recommend or reject a pending request. Record the decision, actor, timestamp, and rejection reason where applicable.
- A Coordinator may, for v1, recommend their own borrowing request. This is a consciously accepted limitation, not independent approval. Preserve the fact that requester and recommender are the same person in the audit record; do not represent it as separation of duties.
- A TO must not issue an item to themselves. The physical issue/return operation must be performed by an authorized person other than the borrower when they are the TO responsible for that transaction. Do not invent a substitute procedure without discussing it first.

### 6.3 Inventory: equipment types and physical units

Keep the distinction:
- `Equipment` is the catalogue/type (e.g. a model of multimeter).
- `EquipmentUnit` is an individually tracked physical item (e.g. serial number DMM-014).

The borrowing and reservation rules apply to a specific physical unit, not merely to the catalogue type. The system must not allocate the same unit to two requests/loans at once.

The initial workflow is for individually tracked, reusable assets. Consumables managed by quantity (e.g. resistors or solder) require a separate stock-movement model and workflow; do not force them into the unique-unit model without a design discussion.

### 6.4 Four equipment availability states

The intended user-facing availability model has exactly four states:

1. **Available** — fit for use, not reserved, and not currently issued. Eligible to be requested.
2. **Reserved** — a Coordinator has recommended a request for this specific unit. It is allocated to that request and cannot be approved/issued to another borrower.
3. **Issued** — the TO has recorded physical handover. The unit has an active loan and is not available, even when overdue.
4. **Unavailable** — not eligible for issue, for example due to damage, maintenance, missing status, or another recorded reason.

Do not add a fifth equipment availability state just for “return pending.” Return progress belongs to the borrowing/return workflow. During a pending return, the unit remains unavailable for allocation and must not become Available until the TO finalizes the return and confirms the unit is fit for use.

**Important implementation caution:** the existing schema already has `status`, `condition`, and `assetStatus`. Do not blindly add a second status field or duplicate the same business fact in multiple columns. Inspect the current model and propose a clear source of truth before changing the schema. The four states may be represented by a well-defined computed/effective availability derived from loan/reservation/condition data, or by a carefully normalized stored state with consistent transactional updates. Explain the trade-off before choosing. `RECEIVED` / `NOT_RECEIVED` is not, by itself, a complete availability model.

Borrower-facing inventory should show only Available units/types as requestable. A Reserved item should disappear from the **available-to-borrow list**, but remain visible in staff inventory and administrative views with its status. Hiding an item in the UI is not enough: the server and database transaction logic must reject stale, duplicate, or conflicting requests.

### 6.5 Reservation and request lifecycle

The request/loan record and the equipment availability state are related but distinct concepts.

The intended request lifecycle is:

- `PENDING`: submitted; awaiting Coordinator decision.
- `APPROVED` (or an explicitly chosen equivalent such as `RECOMMENDED`): Coordinator has recommended it and the specific unit is Reserved.
- `REJECTED`: terminal decision; retain history.
- `CANCELLED`: borrower cancels before physical issue; retain history.
- `EXPIRED`: an approved reservation was not collected by its defined deadline; retain history and release the reservation if the unit remains fit for use.

The existing code uses `APPROVED`; prefer mapping the business word “recommended” to the existing state where possible rather than adding synonyms unnecessarily. If a schema change is justified, document the migration and update every dependent query/UI/action consistently.

Rules:
- A borrower may cancel their own request while it is pending. Record who cancelled and when. A cancelled request cannot later be recommended or issued.
- A pending request that is not reviewed should be flagged as waiting/overdue for review under a defined policy; do not automatically reject it unless policy explicitly requires that.
- Once a request is recommended, reserve the unit immediately. Do not wait for the borrower to reconfirm collection intent.
- A recommended reservation needs a defined collection deadline. If it expires before issue, mark the request expired and release the reservation only if the unit is still fit for use.
- If an approved request's handover code expires, invalidate/regenerate the code under the controlled recovery rule; do not expire an already issued loan.
- If the unit becomes damaged/unavailable before physical issue, block issue and resolve/cancel the reservation without losing the request history.
- Enforce all transitions server-side and atomically. Re-check the current request, unit, assignment, reservation, and code state at the moment of mutation.
- Never delete cancelled, rejected, expired, or completed transactions merely to clean up a queue.

### 6.6 Equipment issue workflow

1. Borrower selects a requestable item and submits a request. The request must be associated with the correct lab and requested catalogue/unit context.
2. The request is visible only to the responsible Coordinator(s) and the borrower; it is not actionable by Coordinators of unrelated labs.
3. Coordinator recommends or rejects it. Record the actor, timestamp, and reason where applicable.
4. Upon recommendation, the unit becomes Reserved and cannot be allocated to a second request. Notify the borrower/TO in the application. Email notifications remain subject to the intranet/no-external-service constraint in Section 2.
5. Generate a one-time handover code for the approved request. Do not display the code in the borrower's application. The code may be sent through an approved notification channel only after that channel is approved.
6. If the borrower does not receive the code, the assigned Coordinator may use a controlled “Reveal code” or regeneration action for an active, approved, not-yet-issued request. Restrict this action to authorized staff and audit every reveal/regeneration. Do not display codes in ordinary lists, logs, or general request detail.
7. Borrower presents the code to an authorized TO. TO verifies it in their authenticated session, checks the exact physical item and its condition, and records the physical handover.
8. In one atomic operation, validate the code and state, confirm the TO is assigned to the unit's lab, bind the loan to the exact unit, mark the loan Issued, change effective availability to Issued, consume the code, and record actor/time. Reject stale/replayed codes and concurrent attempts.

### 6.7 One-time codes

- Use a cryptographically secure random generator. Do not use predictable counters, timestamps, or `Math.random()`.
- Use at least six digits unless a threat/risk review justifies another format. Four-digit codes have only 10,000 possibilities and are too easy to guess.
- Codes must be single-use, expire after a defined practical period, be rate-limited on verification attempts, and be invalidated on cancellation, expiry, issue, or relevant state changes.
- Do not store/log plaintext codes if avoidable; store a verifier/hash suitable for the code's low entropy and enforce rate limiting. Never expose codes to borrowers in ordinary application views.
- A code confirms participation in the workflow; it is not proof by itself that physical handover or return occurred and is not a substitute for authentication.
- Code verification and the related state transition must be atomic. Handle duplicate submissions and simultaneous requests safely.
- Do not decide final expiry durations or retry limits without documenting a practical default and explaining it to the developer.

### 6.8 Return workflow

1. Borrower physically returns the item to an authorized TO.
2. TO inspects the item and records condition, missing accessories, damage, and notes as appropriate.
3. Only when the TO initiates return confirmation should the system generate a one-time return code. The code is shown to the TO to present to the borrower; it is not visible to the borrower before this point.
4. Borrower enters the code in their own authenticated session.
5. The TO explicitly completes the return. Record the physical return, borrower acknowledgement, TO actor, timestamps, and inspection result.
6. Until the TO finalizes the return, the unit remains effectively Issued and cannot be allocated to another borrower.
7. On finalization, set effective availability to Available only if the unit is fit for use. If damaged, missing accessories requiring restriction, or under repair, set/derive Unavailable and preserve the exception details.
8. A code entry alone does not complete the return. A return cannot be completed twice; duplicate or stale actions must be safely rejected.
9. If a return is interrupted or the borrower cannot enter the code, do not silently mark the unit available. Provide an authorized, auditable resolution path rather than an undocumented bypass.

### 6.9 Overdue loans

- An overdue loan remains active and the unit remains Issued until a real return is finalized.
- Overdue status must never release the unit or make it available to another borrower.
- Use the in-app dashboard as the authoritative view for outstanding/overdue loans.
- Email reminders and their timing are not approved under the current intranet-only constraint. Discuss approved channels and a reasonable schedule before implementing reminders. Avoid excessive or duplicate notifications.
- Due dates and reminder schedules are policy decisions; do not invent a final institutional policy silently.

### 6.10 Audit trail and historical integrity

For important actions, preserve who did what and when, including:
- request submission, recommendation/rejection, cancellation and expiry;
- reservation, issue, return initiation and finalization;
- condition changes and unavailability reasons;
- user approval/deactivation, role changes, lab assignment/unassignment;
- code reveal/regeneration and security-relevant failures;
- exceptional corrections to historical records.

Record the acting user, event/action, relevant entity IDs, timestamp, and reason where relevant. Distinguish when an event actually occurred from when it was entered if delayed entry is supported.

Do not silently edit or delete completed transaction history. If correction is required, preserve the original record and add a traceable correction/reversal with actor, timestamp, reason, and corrected values. Restrict audit access and protect logs from ordinary users who could alter the events they are meant to record. Never log secrets or one-time codes.

A simple, dependable audit trail is preferred over an elaborate event-sourcing architecture. Do not introduce event sourcing unless a concrete need is established.

### 6.11 Notifications

- A database transaction is authoritative; delivery of a notification must not decide whether a request, issue, or return succeeded.
- The current hard constraint is no external runtime services. Keep workflows usable through the application itself.
- If an approved notification service is later introduced, design for failures, retries, duplicate prevention, and minimal disclosure. Do not send sensitive codes or unnecessary student/staff details through an unapproved third party.
- Never claim an email was sent merely because the database mutation succeeded. Track delivery outcomes separately if an approved channel is implemented.

---

## 7. Lab and asset administration

- Only `SUPER_ADMIN` may create/edit/delete lab records and manage Coordinator/TO assignments.
- Prefer archiving/retiring a lab, equipment type, or unit over hard deletion when records or transactions refer to it.
- Never remove the ability to understand historical transactions because a person was unassigned or an item/lab was retired.
- The earlier prototype roadmap suggested hard deletion for units/types with zero borrow history only. Reassess this against foreign keys, audit requirements, and real data before implementing. Never hard-delete a record with transaction history.
- An operational lab should have both a Coordinator and a TO assigned. Prevent new operational workflows from being orphaned, and show a clear warning/status if a lab lacks staffing.
- When a TO leaves one lab, unassign them from that lab only; do not deactivate their account or remove other assignments.
- Confirm the Coordinator multi-lab policy with Dr. Iromi before enforcing cardinality constraints.

---

## 8. Security and session hardening roadmap

Review and improve incrementally:
1. Remove any hardcoded `JWT_SECRET` fallback in `lib/auth.ts`; fail safely when missing.
2. Make `getSession()` confirm the user still exists and is active/approved as appropriate, and ensure role/assignment changes take effect safely.
3. Ensure cookie flags are appropriate for deployment (`httpOnly`, `secure` under HTTPS, `sameSite`, path, and expiry).
4. Review session invalidation, login throttling, password-reset/account-recovery design, and TOTP recovery before production.
5. Validate authorization in every server action and protected data query, including lab scope and ownership.
6. Review CSRF protections and Next.js server-action assumptions for the deployed version.
7. Avoid leaking stack traces, database internals, secrets, or codes to clients.
8. Review dependency vulnerabilities and keep production dependencies patched.
9. Verify database access is limited to the application/server administrators and that backups can be restored.
10. Do not describe the application as secure merely because it is intranet-only.

The current `VerificationToken` model is documented as unused legacy. Confirm there are no references and obtain approval before removing it.

---

## 9. Database and migration workflow

- `prisma/schema.prisma` and the migration history are the schema source of truth; inspect both before changes.
- Use `npx prisma migrate dev --name <short_description>` in development. Commit migration files.
- Use `npx prisma migrate deploy` to apply existing migrations on a server/fresh clone.
- Do not use `prisma db push` as the normal workflow, and do not rewrite migration history casually.
- For schema changes, generate Prisma Client (`npx prisma generate`) and restart the development server if the client appears stale.
- Preserve real prototype data during migrations. Plan backfills and compatibility for existing users, role values, coordinator IDs, borrow logs, and equipment-unit status fields.
- A schema migration is not complete just because Prisma accepts it. Check how old rows map into the new model, handle null/legacy values, verify foreign keys/uniqueness, and test core flows.
- `prisma/seed.ts` uses `upsert`. Nested `create` blocks run only when a parent is first created, so reseeding may not add nested equipment/units to an existing database.
- After a database reset, user IDs and sessions may change; users may need to log in again.
- Ask before resets, forced resets, dropping columns/tables, deleting records, or destructive data backfills.

### Concurrency and integrity
- Reservation, issue, and return transitions must be atomic and safe against simultaneous requests.
- Re-check current state inside the database transaction, not only before opening it.
- Use database constraints and appropriate locking/conditional updates where suitable; do not rely only on client-side disabling.
- A unit must never be reserved for two active requests or have two active loans.
- If two Coordinators attempt to recommend competing requests for the same unit, only one transition may succeed.
- Handle transaction failures with a clear user-facing error while preserving the original valid state.

---

## 10. Current roadmap — prioritize in safe increments

This is a working roadmap, not permission to implement everything in one large change. Check the repository and existing work before starting each item.

### Priority 1 — inspect and establish a baseline
- Inspect schema, migrations, auth helpers, proxy/middleware, every server action, and the main inventory/borrow/lab pages.
- Run the existing build and tests; record baseline failures before unrelated edits.
- Map current behavior to the target business rules and identify where it already works versus where it is missing.
- Do not make broad changes until the developer agrees on the next focused task.

### Priority 2 — security and audit basics
- Remove the hardcoded JWT secret fallback.
- Verify session users still exist and are active/approved.
- Ensure all server actions enforce authorization and ownership/scope.
- Record missing rejection actor and other essential audit fields where justified.
- Avoid destructive edits to existing records.

### Priority 3 — define roles and lab-scoped assignments
- Design a safe transition from `LAB_STAFF` to Coordinator and TO responsibilities.
- Replace/normalize the `Lab.coordinators String[]` and plain-text TO/instructor representation only after inspecting references and planning a data-preserving migration.
- Add active lab-scoped assignments and server-side authorization checks.
- Preserve the current account identities and historical actor references.
- Do not enforce the unanswered Coordinator multi-lab policy until confirmed.

### Priority 4 — request reservation and availability integrity
- Map the four target availability states onto the existing `status`, `condition`, and `assetStatus` model without duplicating facts.
- Reserve a specific unit when a request is recommended.
- Hide Reserved/Issued/Unavailable items from the borrower's available list while retaining staff visibility.
- Add cancellation and reservation-expiry behavior, with a defined deadline chosen with the developer.
- Preserve atomic checks against duplicate reservations and issues.

### Priority 5 — issue/return confirmation and codes
- Implement or strengthen one-time handover and return confirmation only after agreeing on schema, expiry, rate limits, and recovery.
- Keep codes out of borrower views, logs, and ordinary request lists.
- Audit Coordinator code reveal/regeneration.
- Ensure TO physical handover and final return actions are explicit, scoped, atomic, and traceable.
- Keep an interrupted return in Issued state until authorized completion.

### Priority 6 — archival, notification policy, deployment readiness
- Add archive/restore behavior for equipment/labs as appropriate; preserve historical references.
- Keep in-app notifications/work queues usable without internet.
- Discuss any proposed email relay/provider separately; do not add an external provider under the current constraint.
- Review backups/restore, HTTPS, production secrets, migrations, monitoring, and operational recovery.

Do not assume this roadmap order is immutable; explain dependencies and ask the developer before a major change in priority.

---

## 11. UI and coding conventions

- Keep the existing visual style unless a UI redesign is requested: Tailwind utilities, slate/blue/emerald/rose palette, rounded-xl cards, compact `text-xs`/`text-sm` tables, and existing modal patterns.
- Use Prisma enums/types from `@prisma/client` rather than duplicating status/role strings.
- Keep function signatures consistent with their implementations.
- Keep server actions focused, validate inputs, handle errors, and return the established `{ success: true, data? }` / `{ success: false, error }` shape where practical.
- Revalidate actual route paths after mutations.
- Use `useTransition` and existing SweetAlert2 conventions where appropriate.
- Avoid adding a dependency when a small, clear solution can be implemented with the existing stack. If a dependency is genuinely useful, explain why and verify that it can be installed and bundled for intranet use.

---

## 12. Working agreement with the developer

Before implementing a task:
1. Restate the requested behavior in plain language.
2. Inspect the actual code/schema paths involved and identify current behavior.
3. Identify conflicts with existing features, data, authorization, or deployment constraints.
4. Propose the smallest safe change and explain any schema/data migration.
5. Ask before making a major policy decision or destructive change.

During implementation:
- Change one coherent feature at a time.
- Preserve working behavior unless the task explicitly changes it.
- Do not make unrelated refactors.
- Keep authorization checks server-side.
- Do not silently change status meanings, role semantics, network requirements, or data-retention behavior.

Before finishing:
- Summarize what changed and why.
- List files changed and migrations created.
- State tests/build commands run and their actual outcomes.
- Mention anything not verified, any follow-up migration/deployment step, and any known limitation.
- Never claim a feature, security control, migration, or test is complete unless it has actually been implemented and verified.
