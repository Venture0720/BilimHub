#!/usr/bin/env node
'use strict';
/**
 * Production Database Initialization
 * Creates only super admin user, no demo data
 */

require('dotenv').config();
const { db, shutdown } = require('./database');
const bcrypt = require('bcryptjs');

async function initProduction() {
  console.log('\n🚀 Initializing PRODUCTION database...\n');

  // Check if super admin already exists
  const existing = await db.get('SELECT id FROM users WHERE role = ? LIMIT 1', ['super_admin']);

  if (existing) {
    console.log('✅ Super admin already exists (id:', existing.id, ')');
    console.log('   Use this account to login and create centers.\n');
    return;
  }

  // Create super admin
  const username = 'admin'; // Простой логин для супер-админа
  const email = process.env.SUPER_ADMIN_EMAIL || 'admin@bilimhub.local';
  const password = process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe@2026!';

  const passwordHash = bcrypt.hashSync(password, 12);

  await db.run(`
    INSERT INTO users (center_id, name, username, email, password_hash, role, is_active)
    VALUES (NULL, ?, ?, ?, ?, 'super_admin', 1)
  `, ['Super Administrator', username, email, passwordHash]);

  console.log('✅ Super admin created!');
  console.log('\n📋 Login credentials:');
  console.log('   Username:', username);
  console.log('   Password: (set via SUPER_ADMIN_PASSWORD env var, or default applied)');
  console.log('\n⚠️  ВАЖНО: Смените пароль после первого входа!');
  console.log('   Profile → Change Password\n');
  console.log('✅ Database ready for production!\n');
}

initProduction()
  .then(() => shutdown())
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });


