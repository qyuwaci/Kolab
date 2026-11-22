# Kolab Firestore Security Specification

## 1. Data Invariants
1. **Identity & Role Integrity**: A user document `/users/{userId}` can only be created when `request.auth.uid == userId`, `request.auth.token.email_verified == true`, and `role` is `'umkm'` or `'creator'`. Self-assigning `'admin'` is strictly forbidden.
2. **PII Isolation**: Email, phone numbers, and bank account numbers are isolated in `/users/{userId}/private/{docId}` and readable/writable only by `isOwner(userId)` or `isAdmin()`.
3. **Campaign Ownership**: A campaign `/campaigns/{campaignId}` can only be created by an authenticated user whose `umkmId == request.auth.uid` and can only be updated/cancelled by that owner (unless already terminal `'completed'` or `'cancelled'`, except by `isAdmin()`).
4. **Application & Submission Integrity**: An application requires an existing open campaign (`exists(/databases/$(database)/documents/campaigns/$(incoming().campaignId))`) and `creatorId == request.auth.uid`. A submission requires an existing application.
5. **Payment & Wallet Guard**: Payment orders `/payment_orders/{orderId}` cannot be created with `status == 'settled'` directly; they start as `'pending'` and transition to `'settled'` or `'expired'` once, locked after terminal state.
6. **Temporal Integrity & Size Bounds**: Every document enforces server timestamps (`request.time`) on `createdAt`/`updatedAt`, regex-checked IDs (`^[a-zA-Z0-9_-]+$`), and explicit `.size()` bounds on all strings.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Privilege Escalation on Signup**: `POST /users/attacker1` with `{ uid: "attacker1", role: "admin", ... }` -> Denied (role enum only allows `umkm` | `creator`).
2. **Shadow Ghost Field**: `POST /users/u1` with `{ ..., isVerifiedAdmin: true }` -> Denied (`hasOnly` rejects unknown keys).
3. **Unverified Email Write**: Authenticated user with `email_verified: false` writing `/campaigns/c1` -> Denied.
4. **Cross-User PII Read**: User A reading `/users/userB/private/info` -> Denied.
5. **Cross-User Wallet Tampering**: User A updating `/wallets/userB` -> Denied.
6. **ID Poisoning**: Creating `/campaigns/` with 1,500-char doc ID or invalid chars `../admin` -> Denied (`isValidId` regex + max length 128).
7. **Orphaned Application**: Creating `/applications/app1` with non-existent `campaignId: "fake_camp"` -> Denied (`exists()` check fails).
8. **Terminal Campaign Mutation**: Updating `/campaigns/c_completed` once `status == 'completed'` -> Denied.
9. **Spoofed Campaign Owner**: Creating `/campaigns/c2` with `umkmId: "other_user"` -> Denied (`umkmId == request.auth.uid`).
10. **Client Timestamp Spoofing**: Creating `/campaigns/c3` with `createdAt: Timestamp(2020-01-01)` -> Denied (`createdAt == request.time`).
11. **Admin Spoofing via Email Unverified**: Request with `token.email: "kikynepth@gmail.com"` and `token.email_verified: false` -> Denied.
12. **Blanket Collection Query Scrape**: Unauthenticated or cross-owner `list` on `/payment_orders` without matching `userId == request.auth.uid` -> Denied.
