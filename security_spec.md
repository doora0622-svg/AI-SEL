# Firestore Security Specification - 文心童書樂園

## 1. Data Invariants
- **Users**: A user can only access their own profile and progress.
- **Books**: Publicly readable. Only admins can create, update, or delete books.
- **Quizzes**: Associated with a book. Publicly readable. Only admins can manage quizzes.
- **SEL Indicators**: Publicly readable. Only admins can manage indicators.
- **Admins**: A collection where the presence of a document named after a user's UID grants administrative privileges.
- **System**: Publicly readable documents for system-wide configuration. Only admins can manage.

## 2. The "Dirty Dozen" Payloads (Denial Expected)

### Identity Attacks
1. **Spoof User Profile**: Authenticated user `user_A` attempts to write to `users/user_B`.
2. **Self-Promotion**: Non-admin user attempts to create a document in `admins/user_A`.
3. **Admin Impersonation**: Non-admin user attempts to update a book's `author` or `title`.

### Integrity Attacks
4. **Invalid Book Type**: Admin attempts to create a book with an unknown `type` (e.g., "mystery").
5. **Missing Required Fields**: Admin attempts to create a book without a `title`.
6. **Large ID Injection**: User attempts to create a document with a 2KB string as an ID.
7. **Malformed Quiz**: Admin attempts to save a quiz question with a negative `correctAnswer` index.

### State & Relationship Attacks
8. **Orphaned Quiz**: Admin attempts to save a quiz for a book ID that doesn't exist.
9. **Feedback Tampering**: User attempts to update their `selFeedback` with a score of 999 (out of range).
10. **Immutable Field Change**: User attempts to change their `nickname` to something else (if we decide nickname is immutable, but here it's probably not, let's say `createdAt` instead).
11. **Timestamp Spoofing**: User attempts to set `createdAt` to a future date instead of `request.time`.
12. **Unauthorized List Scan**: User attempts to list all documents in `users` collection.

## 3. Test Runner Plan
The tests will verify that each of these payloads results in `PERMISSION_DENIED`.
