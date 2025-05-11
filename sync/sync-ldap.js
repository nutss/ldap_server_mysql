require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ==== CONFIG ====
const {
  MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE,
  LDAP_HOST, LDAP_PORT, LDAP_BASEDN, LDAP_ADMIN_USER, LDAP_ADMIN_PASS
} = process.env;

const pool = mysql.createPool({
  host: MYSQL_HOST,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE
});

const OUTPUT_FILE = path.join(__dirname, 'staff.ldif');

// ==== LDIF TEMPLATE ====
function createLdifEntry(staff) {
  return `
dn: uid=${staff.staff_code},ou=staff,${LDAP_BASEDN}
objectClass: inetOrgPerson
uid: ${staff.staff_code}
cn: ${staff.staff_name}
sn: ${staff.staff_name.split(' ').slice(-1).join(' ') || staff.staff_name}
mail: ${staff.staff_email}
userPassword: ${staff.password}
`.trim();
}

// ==== SYNC TO LDIF ====
async function syncToLDIF() {
  try {
    const [rows] = await pool.query('SELECT * FROM staff');
    const ldif = rows.map(createLdifEntry).join('\n\n');
    fs.writeFileSync(OUTPUT_FILE, ldif, 'utf8');
    console.log(`[${new Date().toISOString()}] ✅ LDIF file written`);
  } catch (err) {
    console.error('❌ MySQL sync failed:', err);
  }
}

// ==== DELETE EXISTING ENTRIES ====
function deleteOldEntries(callback) {
  const cmd = `ldapdelete -x -H ldap://${LDAP_HOST}:${LDAP_PORT} -D "${LDAP_ADMIN_USER}" -w "${LDAP_ADMIN_PASS}" -r "ou=staff,${LDAP_BASEDN}"`;
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('❌ LDAP delete failed:', stderr.trim());
    } else {
      console.log(`✅ Old entries deleted from ou=staff`);
      callback();
    }
  });
}

// ==== IMPORT NEW ENTRIES ====
function importToLDAP() {
  const cmd = `ldapadd -x -H ldap://${LDAP_HOST}:${LDAP_PORT} -D "${LDAP_ADMIN_USER}" -w "${LDAP_ADMIN_PASS}" -f "${OUTPUT_FILE}"`;
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('❌ LDAP import failed:', stderr.trim());
    } else {
      console.log('✅ LDAP import successful\n' + stdout.trim());
    }
  });
}

// ==== MAIN SYNC PROCESS ====
async function fullSync() {
  console.log(`\n[${new Date().toISOString()}] 🔁 Starting sync...`);
  await syncToLDIF();
  deleteOldEntries(() => {
    importToLDAP();
  });
}

// ==== RUN EVERY 1 HOUR ====
fullSync(); // run on start
setInterval(fullSync, 60 * 60 * 1000); // every hour
