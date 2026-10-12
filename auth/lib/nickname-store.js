import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNicknameAvailable } from './nickname.js';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
export const usersStorePath = () => process.env.USERS_FILE || path.join(dataDir, 'users.json');
export const studentsStorePath = () => process.env.STUDENT_ACCOUNTS_FILE || path.join(dataDir, 'student-accounts.json');
function records(file, key) {
  if (!fs.existsSync(file)) return [];
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'))[key];
  if (!Array.isArray(rows)) throw new Error('Account directory is unavailable. Please try again.');
  return rows;
}
// School email and legacy classroom accounts share one display-name namespace.
export function assertStoredNicknameAvailable(nickname, { email = '', studentId = '' } = {}) {
  const rows = [
    ...records(usersStorePath(), 'users'),
    ...records(studentsStorePath(), 'students').filter(row => row.id !== studentId),
  ];
  assertNicknameAvailable(rows, nickname, email);
}
