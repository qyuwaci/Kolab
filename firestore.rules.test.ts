/**
 * Firestore Rules Red-Team Security Test Suite (Phase 0 TDD)
 * Verifies all "Dirty Dozen" attack payloads are rejected with PERMISSION_DENIED.
 */

export interface SecurityTestCase {
  name: string;
  collection: string;
  operation: 'create' | 'update' | 'get' | 'list';
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    name: '1. Privilege Escalation on Signup (role: admin)',
    collection: 'users/attacker1',
    operation: 'create',
    payload: { uid: 'attacker1', role: 'admin', name: 'Attacker', status: 'active' },
    expected: 'PERMISSION_DENIED'
  },
  {
    name: '2. Shadow Ghost Field Injection',
    collection: 'users/u1',
    operation: 'create',
    payload: { uid: 'u1', role: 'creator', name: 'User', status: 'active', isVerifiedAdmin: true },
    expected: 'PERMISSION_DENIED'
  },
  {
    name: '3. Unverified Email Write',
    collection: 'campaigns/c1',
    operation: 'create',
    payload: { id: 'c1', umkmId: 'u1', title: 'Test', niche: 'food', brief: 'Brief text' },
    expected: 'PERMISSION_DENIED'
  },
  {
    name: '4. Cross-User PII Read',
    collection: 'users/userB/private/info',
    operation: 'get',
    expected: 'PERMISSION_DENIED'
  },
  {
    name: '5. Cross-User Wallet Tampering (Decrease balance)',
    collection: 'wallets/userB',
    operation: 'update',
    payload: { userId: 'userB', balance: 0, held: 0 },
    expected: 'PERMISSION_DENIED'
  },
  {
    name: '6. ID Poisoning (1500 char ID)',
    collection: 'campaigns/' + 'a'.repeat(1500),
    operation: 'create',
    expected: 'PERMISSION_DENIED'
  },
  {
    name: '7. Orphaned Application (Non-existent campaignId)',
    collection: 'applications/app1',
    operation: 'create',
    payload: { id: 'app1', campaignId: 'fake_camp', umkmId: 'u1', creatorId: 'c1', status: 'accepted' },
    expected: 'PERMISSION_DENIED'
  },
  {
    name: '8. Terminal Campaign Mutation after completed',
    collection: 'campaigns/c_completed',
    operation: 'update',
    payload: { status: 'open' },
    expected: 'PERMISSION_DENIED'
  },
  {
    name: '9. Spoofed Campaign Owner',
    collection: 'campaigns/c2',
    operation: 'create',
    payload: { id: 'c2', umkmId: 'victim_uid', title: 'Spoof', niche: 'food', brief: 'Brief text' },
    expected: 'PERMISSION_DENIED'
  },
  {
    name: '10. Client Timestamp Spoofing',
    collection: 'campaigns/c3',
    operation: 'create',
    payload: { id: 'c3', umkmId: 'u1', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED'
  },
  {
    name: '11. Admin Spoofing with Unverified Email',
    collection: 'users/victim',
    operation: 'update',
    payload: { status: 'suspended' },
    expected: 'PERMISSION_DENIED'
  },
  {
    name: '12. Blanket Payment Order Query Scrape',
    collection: 'payment_orders',
    operation: 'list',
    expected: 'PERMISSION_DENIED'
  }
];
