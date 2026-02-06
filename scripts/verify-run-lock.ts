/**
 * Verification script for global run lock
 *
 * Tests lock acquisition, blocking, refresh, and release behavior.
 * Run with: node dist/scripts/verify-run-lock.js
 */

import { openDb } from "../db/connection.js";
import * as lockRepo from "../db/repos/runLockRepo.js";
import { randomUUID } from "crypto";

console.log("=== Run Lock Verification ===\n");

// Open database
openDb();

// Test 1: Clean state
console.log("1. Checking initial lock state...");
const initialLock = lockRepo.getRunLock();
if (initialLock) {
  console.log("   Found existing lock, releasing...");
  lockRepo.releaseRunLock(initialLock.owner_id);
}
console.log("   ✓ Clean state\n");

// Test 2: Acquire lock (first process)
console.log("2. Acquiring lock (Process A)...");
const ownerA = randomUUID();
const acquireA1 = lockRepo.acquireRunLock(ownerA);
if (acquireA1.ok) {
  console.log(`   ✓ Lock acquired by Process A (${ownerA.substring(0, 8)}...)`);
} else {
  console.log(`   ✗ FAILED: ${acquireA1.reason}`);
  process.exit(1);
}

const lockState1 = lockRepo.getRunLock();
console.log(`   Lock owner: ${lockState1?.owner_id.substring(0, 8)}...`);
console.log(`   Acquired at: ${lockState1?.acquired_at}`);
console.log(`   Expires at: ${lockState1?.expires_at}\n`);

// Test 3: Second process cannot acquire (blocked)
console.log("3. Attempting to acquire lock (Process B)...");
const ownerB = randomUUID();
const acquireB = lockRepo.acquireRunLock(ownerB);
if (!acquireB.ok && acquireB.reason === "LOCKED") {
  console.log(`   ✓ Process B correctly blocked (reason: ${acquireB.reason})`);
} else {
  console.log(
    `   ✗ FAILED: Expected LOCKED, got ${acquireB.ok ? "acquired" : acquireB.reason}`,
  );
  process.exit(1);
}
console.log("");

// Test 4: Process A can refresh its lock
console.log("4. Refreshing lock (Process A)...");
const refreshA = lockRepo.refreshRunLock(ownerA);
if (refreshA) {
  console.log("   ✓ Lock refreshed successfully");
} else {
  console.log("   ✗ FAILED: Could not refresh lock");
  process.exit(1);
}

const lockState2 = lockRepo.getRunLock();
console.log(`   New expires at: ${lockState2?.expires_at}\n`);

// Test 5: Process B cannot refresh (not owner)
console.log("5. Attempting to refresh lock (Process B)...");
const refreshB = lockRepo.refreshRunLock(ownerB);
if (!refreshB) {
  console.log("   ✓ Process B correctly cannot refresh (not owner)");
} else {
  console.log("   ✗ FAILED: Process B should not be able to refresh");
  process.exit(1);
}
console.log("");

// Test 6: Process B cannot release (not owner)
console.log("6. Attempting to release lock (Process B)...");
const releaseB = lockRepo.releaseRunLock(ownerB);
if (!releaseB) {
  console.log("   ✓ Process B correctly cannot release (not owner)");
} else {
  console.log("   ✗ FAILED: Process B should not be able to release");
  process.exit(1);
}
console.log("");

// Test 7: Process A can release
console.log("7. Releasing lock (Process A)...");
const releaseA = lockRepo.releaseRunLock(ownerA);
if (releaseA) {
  console.log("   ✓ Lock released successfully");
} else {
  console.log("   ✗ FAILED: Could not release lock");
  process.exit(1);
}

const lockState3 = lockRepo.getRunLock();
if (!lockState3) {
  console.log("   ✓ Lock removed from database");
} else {
  console.log("   ✗ FAILED: Lock still exists");
  process.exit(1);
}
console.log("");

// Test 8: Process B can now acquire
console.log("8. Acquiring lock (Process B)...");
const acquireB2 = lockRepo.acquireRunLock(ownerB);
if (acquireB2.ok) {
  console.log(`   ✓ Lock acquired by Process B (${ownerB.substring(0, 8)}...)`);
} else {
  console.log(`   ✗ FAILED: ${acquireB2.reason}`);
  process.exit(1);
}
console.log("");

// Test 9: Simulate expired lock takeover
console.log("9. Testing expired lock takeover...");
// Manually set expires_at to the past
import { getDb } from "../db/connection.js";
const db = getDb();
db.prepare(
  "UPDATE run_lock SET expires_at = datetime('now', '-1 seconds') WHERE lock_name = 'global'",
).run();
console.log("   Set lock expiry to the past");

const ownerC = randomUUID();
const acquireC = lockRepo.acquireRunLock(ownerC);
if (acquireC.ok) {
  console.log(
    `   ✓ Process C successfully took over expired lock (${ownerC.substring(0, 8)}...)`,
  );
} else {
  console.log(`   ✗ FAILED: ${acquireC.reason}`);
  process.exit(1);
}

const lockState4 = lockRepo.getRunLock();
if (lockState4?.owner_id === ownerC) {
  console.log("   ✓ Lock ownership transferred correctly");
} else {
  console.log("   ✗ FAILED: Ownership not transferred");
  process.exit(1);
}
console.log("");

// Cleanup
console.log("10. Cleanup...");
lockRepo.releaseRunLock(ownerC);
console.log("   ✓ Lock released\n");

console.log("=== All Tests Passed ✓ ===");
console.log("\nRun lock implementation verified:");
console.log("  - Lock acquisition works");
console.log("  - Lock blocks concurrent processes");
console.log("  - Lock refresh extends expiry");
console.log("  - Lock release works correctly");
console.log("  - Expired locks can be taken over");
console.log("  - Non-owners cannot modify locks");
