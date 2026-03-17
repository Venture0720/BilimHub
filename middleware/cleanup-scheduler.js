// middleware/cleanup-scheduler.js
// Cron scheduler для автоматической очистки данных

'use strict';
const cron = require('node-cron');
const CleanupOrchestrator = require('../services/cleanup');
const { db } = require('../database');

let dailyJob = null;
let weeklyJob = null;
let monthlyJob = null;

function initCleanupScheduler() {
  console.log('⏰ Initializing cleanup scheduler...');

  const orchestrator = new CleanupOrchestrator();

  // ============================================================================
  // ЕЖЕДНЕВНАЯ ОЧИСТКА (каждый день в 3:00 AM)
  // ============================================================================
  dailyJob = cron.schedule('0 3 * * *', async () => {
    console.log('\n🌙 [CRON] Daily cleanup triggered at', new Date().toLocaleString('ru-RU'));
    try {
      const results = await orchestrator.runDaily();
      console.log('✅ [CRON] Daily cleanup completed:', results);
    } catch (error) {
      console.error('❌ [CRON] Daily cleanup failed:', error);
    }

    // Purge expired password reset tokens
    try {
      const { changes } = await db.run(`DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL`);
      if (changes > 0) console.log(`🔑 [CRON] Purged ${changes} expired/used password reset tokens`);
    } catch (e) { console.error('[CRON] Password reset token cleanup error:', e.message); }
  }, {
    scheduled: true,
    timezone: 'Asia/Almaty' // Казахстанское время
  });

  console.log('  ✅ Daily cleanup job scheduled (3:00 AM every day)');

  // ============================================================================
  // ЕЖЕНЕДЕЛЬНАЯ ОЧИСТКА (воскресенье в 4:00 AM)
  // ============================================================================
  weeklyJob = cron.schedule('0 4 * * 0', async () => {
    console.log('\n📅 [CRON] Weekly cleanup triggered at', new Date().toLocaleString('ru-RU'));
    try {
      const results = await orchestrator.runWeekly();
      console.log('✅ [CRON] Weekly cleanup completed:', results);
    } catch (error) {
      console.error('❌ [CRON] Weekly cleanup failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Almaty'
  });

  console.log('  ✅ Weekly cleanup job scheduled (Sunday 4:00 AM)');

  // ============================================================================
  // ЕЖЕМЕСЯЧНАЯ ОЧИСТКА (1-е число в 5:00 AM)
  // ============================================================================
  monthlyJob = cron.schedule('0 5 1 * *', async () => {
    console.log('\n📊 [CRON] Monthly cleanup triggered at', new Date().toLocaleString('ru-RU'));
    try {
      const results = await orchestrator.runMonthly();
      console.log('✅ [CRON] Monthly cleanup completed:', results);
    } catch (error) {
      console.error('❌ [CRON] Monthly cleanup failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Almaty'
  });

  console.log('  ✅ Monthly cleanup job scheduled (1st day of month, 5:00 AM)');

  console.log('✅ Cleanup scheduler initialized successfully\n');

  // Возвращаем функцию для остановки scheduler (для graceful shutdown)
  return {
    stop: () => {
      console.log('🛑 Stopping cleanup scheduler...');
      if (dailyJob) dailyJob.stop();
      if (weeklyJob) weeklyJob.stop();
      if (monthlyJob) monthlyJob.stop();
      console.log('✅ Cleanup scheduler stopped');
    },

    // Для тестирования - ручной запуск
    async runDailyNow() {
      console.log('🔧 Manual trigger: Daily cleanup');
      return await orchestrator.runDaily();
    },

    async runWeeklyNow() {
      console.log('🔧 Manual trigger: Weekly cleanup');
      return await orchestrator.runWeekly();
    },

    async runMonthlyNow() {
      console.log('🔧 Manual trigger: Monthly cleanup');
      return await orchestrator.runMonthly();
    }
  };
}

module.exports = initCleanupScheduler;

